import type { IncomingMessage, ServerResponse } from 'node:http'
import { Collector } from './sync.ts'
import { DAY, EASTERN, dateKey, dayStart, shiftDate, csvCell, dayCoverage } from './domain.ts'
import type { Dashboard, Day } from '../src/lib/types.ts'
import { sortMarkets } from '../src/lib/markets.ts'
import { QuoteService } from './quotes.ts'
import { covers, type ArchiveStore } from './archive.ts'
import { localeResponse } from './locale.ts'
class InputError extends Error {}

function range(url:URL){
  const zone=url.searchParams.get('timezone')==='UTC'?'UTC':EASTERN
  const today=dateKey(Date.now(),zone),days=Number(url.searchParams.get('days')||30)
  if(!Number.isInteger(days)||days<1||days>366)throw new InputError('days must be between 1 and 366')
  const from=url.searchParams.get('from')||shiftDate(today,1-days),to=url.searchParams.get('to')||today
  if(![from,to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().startsWith(d))||from>to||(Date.parse(to)-Date.parse(from))/DAY>366)throw new InputError('Invalid date range; maximum 366 days')
  return {zone,from,to,start:dayStart(from,zone),end:dayStart(shiftDate(to,1),zone)-1}
}
export function createApp(store:ArchiveStore,{cloud=false}={}){
  const collector=new Collector(store),quotes=new QuoteService()
  let refresh:Promise<void>|undefined
  async function sync(){
    refresh??=collector.sync().finally(()=>{refresh=undefined})
    await refresh
  }
  async function fresh(){
    if(!cloud)return
    const status=await store.status()
    if(!status.lastAttempt||Date.now()-Date.parse(status.lastAttempt)>60_000)await sync()
    else if(refresh&&!status.lastSuccess)await refresh
    if(!(await store.status()).lastSuccess)throw Error('Initial archive sync is pending; please retry shortly')
  }
  async function filtered(url:URL){
    const r=range(url),q=(url.searchParams.get('q')||'').toLowerCase(),type=url.searchParams.get('type')||'all'
    return (await store.posts(r.start,r.end,url.searchParams.get('archive')==='true')).filter(p=>(!q||p.text.toLowerCase().includes(q)||p.id.includes(q))&&(type==='all'||p.type===type))
  }
  async function dashboard(url:URL):Promise<Dashboard>{
    const r=range(url),now=Date.now()
    const [status,observedThrough,posts,coverage,markets]=await Promise.all([store.status(),store.get<number|null>('observedThrough',null),store.posts(r.start,r.end),store.coverage(),store.trackings()])
    const byDay=new Map<string,number>()
    for(const post of posts){const key=dateKey(post.createdAt,r.zone);byDay.set(key,(byDay.get(key)||0)+1)}
    const days:Day[]=[]
    for(let date=r.from;date<=r.to;date=shiftDate(date,1)){
      const start=dayStart(date,r.zone),end=dayStart(shiftDate(date,1),r.zone)-1
      const complete=dayCoverage(start,end,now,observedThrough,(a,b)=>covers(coverage,a,b))
      days.push({date,count:complete?(byDay.get(date)||0):null,observed:byDay.get(date)||0,complete})
    }
    const hourly=Array.from({length:24},(_,hour)=>({hour,count:days.every(day=>day.complete)?0:null as number|null}))
    const formatter=new Intl.DateTimeFormat('en-US',{timeZone:r.zone,hour:'2-digit',hourCycle:'h23'}),types=new Map<string,number>()
    for(const post of posts){const hour=Number(formatter.format(new Date(post.createdAt)));if(hourly[hour].count!==null)hourly[hour].count!++;types.set(post.type,(types.get(post.type)||0)+1)}
    const trackings=sortMarkets(await Promise.all(markets.map(async tracking=>({...tracking,local:await store.count(Date.parse(tracking.startDate),Date.parse(tracking.endDate))}))),now)
    return {status:{...status,collectionMode:cloud?'cloud':'local'},days,trackings,hourly,types:Array.from(types,([type,count])=>({type,count})),latest:posts.slice(0,5),timezone:r.zone,generatedAt:new Date().toISOString()}
  }
  async function handler(req:IncomingMessage,res:ServerResponse){
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff')
    const json=(value:unknown,code=200)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
    const write=async(chunk:string)=>{
      if(res.destroyed)return false
      if(!res.write(chunk))await new Promise<void>(resolve=>{
        const done=()=>{res.off('drain',done);res.off('close',done);resolve()}
        res.once('drain',done);res.once('close',done)
      })
      return !res.destroyed
    }
    try{
      const url=new URL(req.url||'/','http://localhost')
      const route=url.searchParams.get('__route');if(route)url.pathname='/api/'+route
      url.searchParams.delete('__route')
      if(req.method==='GET'&&url.pathname==='/api/locale')return json(localeResponse(req.headers))
      if(req.method==='GET'&&url.pathname==='/api/cron'){
        if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return json({error:'Unauthorized'},401)
        await sync();await collector.backfill();return json({ok:true,status:await store.status()})
      }
      if(req.method==='POST'&&url.pathname==='/api/sync'){
        const origin=req.headers.origin
        if(origin&&new URL(origin).host!==req.headers.host&&!(!cloud&&['http://127.0.0.1:5173','http://localhost:5173'].includes(origin)))return json({error:'Origin not allowed'},403)
        if(collector.busy)return json({accepted:false,message:'A sync is already running'},409)
        if(cloud){await sync();await collector.backfill();return json({accepted:true,completed:true,status:await store.status()})}
        void sync();return json({accepted:true},202)
      }
      if(req.method!=='GET')return json({error:'Method not allowed'},405)
      if(url.pathname==='/api/health')return json({ok:true,status:await store.status()})
      if(url.pathname==='/api/dashboard'||url.pathname==='/api/posts'||url.pathname==='/api/export'||url.pathname.startsWith('/api/markets/'))await fresh()
      const marketRoute=/^\/api\/markets\/([^/]+)(?:\/(stream|history))?$/.exec(url.pathname)
      if(marketRoute){
        const tracking=(await store.trackings()).find(t=>t.id===marketRoute[1])
        if(!tracking)return json({error:'Market period not found'},404)
        try{
          if(marketRoute[2]==='history')return json(await quotes.history(tracking,url.searchParams.get('asset')||'',url.searchParams.get('interval')||'1d'))
          const feed=quotes.feed(tracking),snapshot=await feed.load();if(res.destroyed)return
          if(marketRoute[2]!=='stream')return json(snapshot)
          res.setTimeout(0)
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'})
          feed.attach(res)
          if(cloud){
            const timer=setTimeout(()=>res.end(),240_000)
            await new Promise<void>(resolve=>res.once('close',()=>{clearTimeout(timer);resolve()}))
          }
          return
        }catch(error){return json({error:error instanceof Error?error.message:'Quotes unavailable'},502)}
      }
      if(url.pathname==='/api/dashboard')return json(await dashboard(url))
      if(url.pathname==='/api/posts'){
        const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('size')||20)
        if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>100)throw new InputError('Invalid pagination')
        const posts=await filtered(url);return json({posts:posts.slice((page-1)*size,page*size),total:posts.length,page,size})
      }
      if(url.pathname==='/api/export'){
        const posts=await filtered(url),format=url.searchParams.get('format')||'csv'
        res.setHeader('Content-Disposition',`attachment; filename="musk-posts.${format==='json'?'json':'csv'}"`)
        if(format==='json'){
          const filterKeys=['format','days','timezone','from','to','q','type','archive']
          const filters=Object.fromEntries([...url.searchParams].filter(([key])=>filterKeys.includes(key)))
          const meta={source:'https://xtracker.polymarket.com/api',filters,exportedAt:new Date().toISOString(),status:await store.status()}
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.flushHeaders()
          res.write(JSON.stringify(meta).slice(0,-1)+',"posts":[')
          for(let i=0;i<posts.length;i++)if(!await write((i?',':'')+JSON.stringify(posts[i])))return
          res.end(']}');return
        }
        const fields=['id','platformId','createdAt','type','text','url','importedAt','firstSeen','lastSeen'] as const
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8'})
        res.flushHeaders();res.write('\uFEFF'+fields.join(',')+'\r\n')
        for(const post of posts)if(!await write(fields.map(field=>csvCell(post[field])).join(',')+'\r\n'))return
        res.end();return
      }
      if(url.pathname==='/api/runs')return json(await store.runs())
      return json({error:'Not found'},404)
    }catch(error){if(!res.headersSent)return json({error:error instanceof Error?error.message:'Service unavailable'},error instanceof InputError?400:503);res.end()}
  }
  return {handler,collector,quotes}
}
