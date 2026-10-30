import { useI18n } from '../i18n'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Tracking } from '../lib/types'
import type { MarketSnapshot, OutcomeQuote, PriceHistory, PricePoint } from '../lib/quotes'
import { MarketPicker } from './MarketPicker'
import { Icon } from './Icon'
import { SegmentedControl } from './agentui/SegmentedControl'
import { ReasoningText } from './agentui/ReasoningText'
import './market-live.css'


function useQuotes(trackingId:string) {
  const {t:tr}=useI18n()

  const [snapshot,setSnapshot]=useState<MarketSnapshot|null>(null)
  const [error,setError]=useState(''),[transport,setTransport]=useState<'connecting'|'ready'|'offline'>('connecting')
  const [retry,setRetry]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();let stream:EventSource|undefined,check:ReturnType<typeof setInterval>|undefined,lastSeen=Date.now(),cancelled=false
    setSnapshot(null);setError('');setTransport('connecting')
    async function start(){
      try{
        const response=await fetch(`/api/markets/${encodeURIComponent(trackingId)}`,{signal:controller.signal})
        const body=await response.json();if(!response.ok)throw Error(body.error||tr("行情暂时不可用"))
        if(cancelled)return
        setSnapshot(body)
        if(body.state==='closed'){setTransport('ready');return}
        stream=new EventSource(`/api/markets/${encodeURIComponent(trackingId)}/stream`)
        stream.onopen=()=>{lastSeen=Date.now();setTransport('ready');setError('')}
        stream.onmessage=event=>{
          try{const next:MarketSnapshot=JSON.parse(event.data);if(next.trackingId!==trackingId)return;lastSeen=Date.now();setSnapshot(next);setTransport('ready');setError('');if(next.state==='closed'){stream?.close();clearInterval(check)}}catch{setError(tr("行情数据格式异常"))}
        }
        stream.addEventListener('heartbeat',()=>{lastSeen=Date.now();setTransport('ready')})
        stream.onerror=()=>setTransport('offline')
        check=setInterval(()=>{if(Date.now()-lastSeen>35_000)setTransport('offline')},5000)
      }catch(e){if(!cancelled){setError((e as Error).message);setTransport('offline')}}
    }
    void start()
    return()=>{cancelled=true;controller.abort();stream?.close();clearInterval(check)}
  },[trackingId,retry])
  return {snapshot,error,transport,retry:()=>setRetry(v=>v+1)}
}

export function MarketLive({tracking,markets,onChange,zone}:{tracking:Tracking;markets:Tracking[];onChange:(id:string)=>void;zone:string}) {
  const {t:tr,locale,preciseTime:time,cents,percent,amount}=useI18n()

  const {snapshot,error,transport,retry}=useQuotes(tracking.id)
  const [marketId,setMarketId]=useState(''),[outcomeName,setOutcomeName]=useState('Yes'),[showClosed,setShowClosed]=useState(false)
  const [period,setPeriod]=useState<'1h'|'1d'|'1w'|'max'>('1d')
  const [history,setHistory]=useState<PriceHistory|null>(null),[historyError,setHistoryError]=useState(''),[historyLoading,setHistoryLoading]=useState(false)
  const [historyRetry,setHistoryRetry]=useState(0)
  const all=snapshot?.markets||[],active=all.filter(m=>!m.closed),closed=all.filter(m=>m.closed)
  const visible=showClosed||!active.length?all:active
  const leading=[...active].sort((a,b)=>(b.outcomes.find(o=>o.name==='Yes')?.price??-1)-(a.outcomes.find(o=>o.name==='Yes')?.price??-1))[0]
  const selected=all.find(m=>m.id===marketId)||leading||all[0]
  const quote=selected?.outcomes.find(o=>o.name===outcomeName)||selected?.outcomes[0]
  // Pin the first useful selection; price changes must not move the user's focus.
  useEffect(()=>{if(!marketId&&selected)setMarketId(selected.id)},[marketId,selected?.id])
  const assetId=quote?.assetId
  useEffect(()=>{
    setHistory(null);setHistoryError('');setHistoryLoading(true)
    if(!assetId){setHistoryLoading(false);return}
    const controller=new AbortController()
    const load=async()=>{
      try{
        const response=await fetch(`/api/markets/${tracking.id}/history?${new URLSearchParams({asset:assetId,interval:period})}`,{signal:controller.signal})
        const body=await response.json();if(!response.ok)throw Error(body.error||tr("历史行情暂时不可用"))
        if(!controller.signal.aborted){setHistory(body);setHistoryError('')}
      }catch(error){if(!controller.signal.aborted)setHistoryError((error as Error).message)}finally{if(!controller.signal.aborted)setHistoryLoading(false)}
    }
    void load();const timer=setInterval(()=>void load(),60_000)
    return()=>{controller.abort();clearInterval(timer)}
  },[tracking.id,assetId,period,historyRetry])
  const live=transport==='ready'&&snapshot?.state==='live'
  const state=transport==='offline'?tr("连接中断"):snapshot?.state==='closed'?tr("已结束"):live?tr("实时行情"):snapshot?.state==='reconnecting'?tr("正在重连"):tr("连接行情中")
  const eventError=error||snapshot?.error
  function choose(id:string){setMarketId(id);setOutcomeName('Yes')}
  return <div className="market-live">
    <div className="market-toolbar"><MarketPicker markets={markets} value={tracking.id} onChange={onChange} className="market-period"/><div className={`quote-status ${live?'is-live':''}`} role="status"><span className={`status-dot ${live?'good':'muted'}`}/>{state}{snapshot?.receivedAt&&<time>{time(snapshot.receivedAt,zone)} {zone==='UTC'?'UTC':'ET'}</time>}</div>{snapshot?.url&&<a className="text-button market-source" href={snapshot.url} target="_blank" rel="noreferrer">Polymarket <Icon name="external" size={13}/></a>}</div>
    {eventError&&<div className="notice" role="status"><Icon name="info" size={15}/><span>{eventError}</span><button onClick={retry}>{tr("重新连接")} <Icon name="refresh" size={13}/></button></div>}
    {!snapshot?<section className="panel quote-loading">{error?<button className="button" onClick={retry}>{tr("重试行情连接")}</button>:<ReasoningText phrases={[tr("正在读取市场行情")]} indicator={<Icon name="refresh" className="spin" size={16}/>}/>}</section>:<>
      <section className="market-summary panel" aria-label={tr("市场概况")}><div className="market-count-primary"><span>{tr("周期发帖")}</span><strong>{tracking.official?.toLocaleString(locale)??'—'}<small>{tr("条")}</small></strong></div><div className="market-volume"><span>{tr("24h 成交额")}</span><strong>{amount(snapshot.volume24h)}</strong></div><div><span>{tr("总成交额")}</span><strong>{amount(snapshot.volume)}</strong></div><div><span>{tr("流动性")}</span><strong>{amount(snapshot.liquidity)}</strong></div><div className="market-deadline"><span>{tr("截止时间 · ET")}</span><strong>{time(tracking.endDate,'America/New_York',true)}</strong></div></section>
      <div className="quote-layout">
        <section className="panel quote-panel"><div className="panel-heading"><h2>{tr("数量区间")}</h2>{!!closed.length&&!!active.length&&<button className={`quote-filter ${showClosed?'selected':''}`} aria-pressed={showClosed} onClick={()=>setShowClosed(v=>!v)}>{tr("已结束")} {closed.length}<Icon name="down" size={12}/></button>}</div>
          <div className="quote-table-scroll"><table className="quote-table"><thead><tr><th>{tr("推文数")}</th><th title={tr("YES 买一与卖一的中间价；缺少双边报价时留空")}>YES</th><th title={tr("NO 买一与卖一的中间价")}>NO</th><th>{tr("买一 / 卖一")}</th></tr></thead><tbody>{visible.map(m=>{const yes=m.outcomes.find(o=>o.name==='Yes'),no=m.outcomes.find(o=>o.name==='No');return <tr key={m.id} className={`${selected?.id===m.id?'selected':''} ${m.closed?'resolved':''}`} onClick={()=>choose(m.id)}><td><button aria-label={tr("查看 {p0} 条行情", {p0: m.label})} aria-pressed={selected?.id===m.id} onClick={e=>{e.stopPropagation();choose(m.id)}}>{m.label}<Icon name="chevron" size={12}/></button>{m.closed&&<small>{tr("已结束")}</small>}</td><td><span className="probability-bar" style={{width:`${(yes?.price??0)*100}%`}}/><b>{percent(yes?.price)}</b></td><td>{percent(no?.price)}</td><td className="bid-ask-cell">{m.closed?'—':<><span>{cents(yes?.bid)}</span><i>/</i><span>{cents(yes?.ask)}</span></>}</td></tr>})}</tbody></table></div>
          <div className="quote-table-note">{tr("YES / NO 为盘口中间价 · 每份价格以美分计")}</div>
        </section>
        <div className="market-detail-column">{selected&&quote&&<>
          <section className="panel price-panel" data-outcome={quote.name}><div className="panel-heading"><div><h2>{selected.label} {tr("条")}</h2><div className="selected-price"><strong>{cents(quote.price)}</strong><span>{quote.name} {selected.closed?tr("结束价格"):tr("中间价")}</span></div></div><div className="outcome-switch-wrap"><SegmentedControl value={outcomeName} onChange={setOutcomeName} label={tr("合约方向")} options={selected.outcomes.map(o=>({value:o.name,label:o.name,icon:<span>{o.name.toUpperCase()}</span>}))}/></div></div>
            <div className="price-periods"><SegmentedControl value={period} onChange={setPeriod} label={tr("价格走势周期")} options={[{value:'1h',label:tr("最近一小时"),icon:<span>1H</span>},{value:'1d',label:tr("最近一天"),icon:<span>1D</span>},{value:'1w',label:tr("最近一周"),icon:<span>1W</span>},{value:'max',label:tr("全部历史"),icon:<span>{tr("全部")}</span>}]}/></div>
            {historyLoading&&!history?<div className="price-chart-empty"><ReasoningText phrases={[tr("正在读取价格走势")]}/></div>:historyError&&!history?<div className="price-chart-empty"><span>{historyError}</span><button className="text-button" onClick={()=>setHistoryRetry(v=>v+1)}>{tr("重试")}</button></div>:<PriceChart points={history?.points||[]} quote={live&&!selected.closed?quote:undefined} zone={zone} period={period}/>}
            {historyError&&history&&<p className="quote-history-warning">{tr("走势更新失败，显示上次结果")}</p>}
          </section>
          <section className="panel orderbook-panel"><div className="panel-heading"><h2>{quote.name.toUpperCase()} {tr("盘口")}</h2><span className="quiet">{quote.updatedAt?`${time(quote.updatedAt,zone)} ${zone==='UTC'?'UTC':'ET'}`:selected.closed?tr("已结束"):tr("等待报价")}</span></div>
            {selected.closed?<div className="book-empty">{tr("市场已结束")}</div>:!quote.bookReady?<div className="book-empty">{live?tr("暂无盘口"):tr("等待行情连接")}</div>:<><div className="book-sides"><BookSide levels={quote.bids} side="bid"/><BookSide levels={quote.asks} side="ask"/></div><div className="book-footer"><span>{tr("价差")} <b>{quote.bid!==null&&quote.ask!==null?cents(quote.ask-quote.bid):'—'}</b></span><span>{tr("最近成交")} <b>{cents(quote.last)}</b>{quote.lastAt&&<time>{time(quote.lastAt,zone)}</time>}</span></div></>}
          </section>
        </>}</div>
      </div>
      <div className="market-provenance"><span>{tr("行情 · Polymarket CLOB")} <span>／</span> {tr("发帖计数 · XTracker")}</span><span>{tr("市场资料读取于")} {time(snapshot.metadataAt,zone)} {zone==='UTC'?'UTC':'ET'}</span></div>
    </>}
  </div>
}

function BookSide({levels,side}:{levels:OutcomeQuote['bids'];side:'bid'|'ask'}) {
  const {t:tr,locale}=useI18n()

  const displayed=levels.slice(0,5),max=Math.max(1,...displayed.map(l=>l.size))
  return <div className={`book-side ${side}`}><div className="book-label"><span>{side==='bid'?tr("买盘"):tr("卖盘")} · ¢</span><span>{tr("数量")}</span></div>{displayed.length?displayed.map(level=><div className="book-level" key={level.price}><i style={{width:`${level.size/max*100}%`}}/><span>{Number((level.price*100).toFixed(2))}</span><b>{level.size.toLocaleString(locale,{maximumFractionDigits:2})}</b></div>):<div className="book-empty-side">{tr("暂无挂单")}</div>}</div>
}

function PriceChart({points,quote,zone,period}:{points:PricePoint[];quote?:OutcomeQuote;zone:string;period:string}) {
  const {t:tr,locale,preciseTime:time,cents}=useI18n()

  const areaId=useId()
  const [hover,setHover]=useState<number|null>(null)
  const series=useMemo(()=>{
    const result=[...points],at=quote?.updatedAt?Date.parse(quote.updatedAt):0
    if(quote?.price!=null&&at&&(result.length===0||at>result[result.length-1].time))result.push({time:at,price:quote.price,resolution:0})
    return result
  },[points,quote?.price,quote?.updatedAt])
  const bounds=useRef<SVGSVGElement>(null)
  if(!series.length)return <div className="price-chart-empty">{tr("该时间段暂无价格记录")}</div>
  const width=560,height=224,left=41,right=16,top=14,bottom=28
  const min=series[0].time,max=Math.max(min+60_000,series.at(-1)!.time)
  const x=(t:number)=>left+(t-min)/(max-min)*(width-left-right),y=(p:number)=>top+(1-p)*(height-top-bottom)
  const paths:{line:string;area:string}[]=[]
  let segment='',startX=0,endX=0
  function finishSegment(){
    if(segment)paths.push({line:segment,area:`${segment} L${endX},${height-bottom} L${startX},${height-bottom} Z`})
    segment=''
  }
  series.forEach((point,index)=>{
    const previous=series[index-1],gap=previous&&point.time-previous.time>Math.max(300_000,previous.resolution*2500,point.resolution*2500)
    if(gap)finishSegment()
    const pointX=Number(x(point.time).toFixed(2))
    if(!segment)startX=pointX
    endX=pointX
    segment+=`${segment?'L':'M'}${pointX},${y(point.price).toFixed(2)} `
  });finishSegment()
  const focus=hover===null?undefined:series[Math.min(hover,series.length-1)]
  function onPointer(clientX:number){const rect=bounds.current!.getBoundingClientRect(),t=min+((clientX-rect.left)/rect.width*width-left)/(width-left-right)*(max-min);let closest=0;for(let i=1;i<series.length;i++)if(Math.abs(series[i].time-t)<Math.abs(series[closest].time-t))closest=i;setHover(closest)}
  return <div className="price-chart"><svg ref={bounds} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tr("{p0}价格走势，共 {p1} 个观测值，最新 {p2}", {p0: quote?.name||'', p1: series.length, p2: cents(series.at(-1)?.price)})} onPointerMove={e=>onPointer(e.clientX)} onPointerLeave={()=>setHover(null)}>
    <defs><linearGradient id={areaId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--blue)" stopOpacity=".19"/><stop offset="100%" stopColor="var(--blue)" stopOpacity=".015"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map(value=><g key={value}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="var(--line)" strokeDasharray="3 5"/><text x={left-9} y={y(value)+3} textAnchor="end" className="price-axis">{value*100}¢</text></g>)}
    {paths.map((path,i)=><g key={i}><path d={path.area} fill={`url(#${areaId})`}/><path d={path.line} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinejoin="round"/></g>)}
    {[0,.5,1].map(fraction=>{const value=min+(max-min)*fraction;return <text key={fraction} x={x(value)} y={height-5} textAnchor={fraction===0?'start':fraction===1?'end':'middle'} className="price-axis">{new Intl.DateTimeFormat(locale,{timeZone:zone,...(['1w','max'].includes(period)?{month:'2-digit',day:'2-digit'}:{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}).format(new Date(value))}</text>})}
    {focus&&<><line x1={x(focus.time)} x2={x(focus.time)} y1={top} y2={height-bottom} stroke="var(--blue)" strokeDasharray="3 4"/><circle cx={x(focus.time)} cy={y(focus.price)} r="4" fill="var(--blue)" stroke="white" strokeWidth="2"/></>}
  </svg>{focus&&<div className="price-tooltip">{time(focus.time,zone,true)} <b>{cents(focus.price)}</b></div>}</div>
}
