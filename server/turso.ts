import { randomUUID } from 'node:crypto'
import type { Post, Status, Tracking } from '../src/lib/types.ts'
import { covers, type ArchiveStore, type Coverage } from './archive.ts'

type Arg=string|number|null
export type Statement={sql:string;args?:Arg[]}
type Cell={type:string;value?:string|number}
type SqlResult={cols:{name:string}[];rows:Cell[][];affected_row_count:number;last_insert_rowid:string|null}
export interface SqlClient {
  query(sql:string,args?:Arg[]):Promise<{rows:Record<string,unknown>[];changes:number;lastId:string|number|bigint|null}>
  transaction(statements:Statement[]):Promise<void>
}
export class TursoHTTP implements SqlClient {
  url:string; token:string; fetcher:typeof fetch
  constructor(url:string,token:string,fetcher=fetch){
    const parsed=new URL(url.replace(/^(libsql|turso):/,'https:'))
    if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('Invalid database URL')
    this.url=new URL('/v2/pipeline',parsed).href;this.token=token;this.fetcher=fetcher
  }
  async request(requests:unknown[]){
    const response=await this.fetcher(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({requests:[...requests,{type:'close'}]}),signal:AbortSignal.timeout(20_000)})
    if(!response.ok)throw Error(`Database HTTP ${response.status}`)
    const body=await response.json()
    if(!Array.isArray(body.results))throw Error('Invalid database response')
    const error=body.results.find((r:{type:string})=>r.type==='error')
    if(error)throw Error(`Database query failed: ${error.error?.code||'UNKNOWN'}`)
    return body.results[0].response
  }
  statement({sql,args=[]}:Statement){return {sql,args:args.map(value=>value===null?{type:'null'}:typeof value==='number'?{type:Number.isInteger(value)?'integer':'float',value:Number.isInteger(value)?String(value):value}:{type:'text',value}),want_rows:true}}
  async query(sql:string,args:Arg[]=[]){
    const response=await this.request([{type:'execute',stmt:this.statement({sql,args})}])
    const result=response.result as SqlResult
    return {rows:result.rows.map(row=>Object.fromEntries(row.map((cell,i)=>[result.cols[i].name,cell.type==='null'?null:cell.type==='integer'||cell.type==='float'?Number(cell.value):cell.value]))),changes:result.affected_row_count,lastId:result.last_insert_rowid}
  }
  async transaction(statements:Statement[]){
    const steps:Record<string,unknown>[]=[{stmt:this.statement({sql:'BEGIN IMMEDIATE'})}]
    for(const statement of [...statements,{sql:'COMMIT'}])steps.push({condition:{type:'ok',step:steps.length-1},stmt:this.statement(statement)})
    const commit=steps.length-1
    steps.push({condition:{type:'not',cond:{type:'ok',step:commit}},stmt:this.statement({sql:'ROLLBACK'})})
    const response=await this.request([{type:'batch',batch:{steps}}])
    const error=response.result.step_errors?.find((value:unknown)=>value)
    if(error||!response.result.step_results?.[commit])throw Error(`Database transaction failed: ${error?.code||'INCOMPLETE'}`)
  }
}
const schema=[
  'CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,type TEXT NOT NULL,text TEXT NOT NULL,data TEXT NOT NULL,present INTEGER NOT NULL DEFAULT 1,seen_run TEXT)',
  'CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at)',
  'CREATE TABLE IF NOT EXISTS revisions(post_id TEXT NOT NULL,observed_at TEXT NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(post_id,observed_at,raw))',
  'CREATE TABLE IF NOT EXISTS coverage(start INTEGER PRIMARY KEY,end INTEGER NOT NULL,checked_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS trackings(id TEXT PRIMARY KEY,data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sync_runs(id INTEGER PRIMARY KEY,started_at TEXT NOT NULL,ended_at TEXT,status TEXT NOT NULL,detail TEXT)',
  'CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL)',
]
export class TursoStore implements ArchiveStore {
  sql:SqlClient; ready?:Promise<void>
  constructor(sql:SqlClient){this.sql=sql}
  async initialize(){
    this.ready??=this.sql.transaction(schema.map(sql=>({sql}))).catch(error=>{this.ready=undefined;throw error})
    await this.ready
  }
  async get<T>(key:string,fallback:T):Promise<T>{await this.initialize();const result=await this.sql.query('SELECT value FROM meta WHERE key=?',[key]);return result.rows.length?JSON.parse(String(result.rows[0].value)):fallback}
  async set(key:string,value:unknown){await this.initialize();await this.sql.query('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,JSON.stringify(value)])}
  async ingest(posts:Post[],start:number,end:number){
    await this.initialize()
    const run=randomUUID(),now=new Date().toISOString()
    // Publish coverage and removals only after every batch was written successfully.
    // A failed large import retains the previous archive and remains incomplete.
    for(let i=0;i<posts.length;i+=400){
      const chunk=JSON.stringify(posts.slice(i,i+400))
      await this.sql.transaction([
        {sql:`INSERT OR IGNORE INTO revisions SELECT json_extract(item.value,'$.id'),?,json_extract(item.value,'$.raw') FROM json_each(?) item LEFT JOIN posts old ON old.id=json_extract(item.value,'$.id') WHERE old.id IS NULL OR json_extract(old.data,'$.raw')<>json_extract(item.value,'$.raw')`,args:[now,chunk]},
        {sql:`INSERT INTO posts(id,created_at,type,text,data,present,seen_run) SELECT json_extract(value,'$.id'),json_extract(value,'$.createdAt'),json_extract(value,'$.type'),json_extract(value,'$.text'),json(value),1,? FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,type=excluded.type,text=excluded.text,data=json_set(excluded.data,'$.firstSeen',json_extract(posts.data,'$.firstSeen')),present=1,seen_run=excluded.seen_run`,args:[run,chunk]},
      ])
    }
    await this.sql.transaction([
      {sql:'UPDATE posts SET present=0 WHERE created_at>=? AND created_at<=? AND (seen_run IS NULL OR seen_run<>?)',args:[new Date(start).toISOString(),new Date(end).toISOString(),run]},
      {sql:'INSERT INTO coverage VALUES(?,?,?) ON CONFLICT(start) DO UPDATE SET end=MAX(coverage.end,excluded.end),checked_at=excluded.checked_at',args:[start,end,now]},
    ])
  }
  async posts(start:number,end:number,archived=false):Promise<Post[]>{
    await this.initialize()
    const posts:Post[]=[]
    let cursor:Post|undefined
    for(;;){
      const args:Arg[]=[new Date(start).toISOString(),new Date(end).toISOString()]
      if(cursor)args.push(cursor.createdAt,cursor.createdAt,cursor.id)
      const result=await this.sql.query(`SELECT data FROM posts WHERE created_at>=? AND created_at<=? ${archived?'':'AND present=1'} ${cursor?'AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT 400`,args)
      const page:Post[]=result.rows.map(row=>JSON.parse(String(row.data)))
      posts.push(...page)
      if(page.length<400)return posts
      cursor=page.at(-1)
    }
  }
  async count(start:number,end:number){await this.initialize();return Number((await this.sql.query('SELECT COUNT(*) n FROM posts WHERE created_at>=? AND created_at<=? AND present=1',[new Date(start).toISOString(),new Date(end).toISOString()])).rows[0].n)}
  async coverage():Promise<Coverage[]>{await this.initialize();return (await this.sql.query('SELECT start,end FROM coverage ORDER BY start')).rows.map(row=>({start:Number(row.start),end:Number(row.end)}))}
  async covered(start:number,end:number){return covers(await this.coverage(),start,end)}
  async saveTracking(tracking:Tracking){await this.initialize();await this.sql.query('INSERT INTO trackings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',[tracking.id,JSON.stringify(tracking)])}
  async trackings():Promise<Tracking[]>{await this.initialize();return (await this.sql.query('SELECT data FROM trackings')).rows.map(row=>JSON.parse(String(row.data)))}
  async status():Promise<Status>{
    await this.initialize()
    const [meta,counts]=await Promise.all([this.sql.query('SELECT key,value FROM meta'),this.sql.query('SELECT COUNT(*) archived,SUM(present) currentRecords,MIN(created_at) earliest,(SELECT COUNT(*) FROM coverage) coverageDays FROM posts')])
    const values=Object.fromEntries(meta.rows.map(row=>[String(row.key),JSON.parse(String(row.value))]))
    const row=counts.rows[0],currentRecords=Number(row.currentRecords||0),sourceTotal=values.sourceTotal??null
    return {state:values.state||'idle',lastSuccess:values.lastSuccess??null,lastAttempt:values.lastAttempt??null,error:values.error??null,archived:Number(row.archived),currentRecords,sourceTotal,archiveDifference:sourceTotal===null?null:currentRecords-sourceTotal,historyVerifiedAt:values.historyVerifiedAt??null,sourceLastSync:values.sourceLastSync??null,backfillCursor:values.backfillCursor??null,startedAt:values.startedAt||new Date().toISOString(),earliest:row.earliest as string|null,coverageDays:Number(row.coverageDays)}
  }
  async startRun(started:string){await this.initialize();return (await this.sql.query('INSERT INTO sync_runs(started_at,status) VALUES(?,?)',[started,'running'])).lastId!}
  async finishRun(id:string|number|bigint,status:string,detail?:string){await this.sql.query('UPDATE sync_runs SET ended_at=?,status=?,detail=? WHERE id=?',[new Date().toISOString(),status,detail??null,String(id)])}
  async runs(){await this.initialize();return (await this.sql.query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 40')).rows}
  async acquireLease(token:string,minimumInterval=0){await this.initialize();const now=Date.now();return (await this.sql.query(`INSERT INTO leases(name,token,expires_at) SELECT ?,?,? WHERE ?=0 OR NOT EXISTS(SELECT 1 FROM meta WHERE key='lastAttempt' AND json_extract(value,'$')>=?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE leases.expires_at<?`,['collector',token,now+300_000,minimumInterval,new Date(now-minimumInterval).toISOString(),now])).changes===1}
  async releaseLease(token:string){await this.sql.query('DELETE FROM leases WHERE name=? AND token=?',['collector',token])}
}
