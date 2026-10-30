import { useI18n } from '../i18n'
import { useState } from 'react'
import type { Day } from '../lib/types'
export function DailyChart({days,onSelect,mode}:{days:Day[];onSelect:(date:string)=>void;mode:'bar'|'line'}) {
  const {t:tr,locale,number:n}=useI18n()

  const [hover,setHover]=useState<number|null>(null)
  const max=Math.max(5,...days.map(d=>d.count??0));const ceiling=Math.ceil(max/4)*4
  const width=840,height=234,left=35,right=10,top=18,bottom=30,plot=height-top-bottom
  const step=(width-left-right)/Math.max(days.length,1)
  const points=days.map((d,i)=>d.count===null?null:{x:left+step*(i+.5),y:top+plot-(d.count/ceiling)*plot})
  const segments:string[]=[];let segment=''
  points.forEach(p=>{if(!p){if(segment)segments.push(segment);segment=''}else segment+=`${segment?' L':'M'}${p.x},${p.y}`});if(segment)segments.push(segment)
  const any=days.some(d=>d.count!==null)
  const hovered=hover===null?null:days[hover]
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tr("每日发帖数量趋势，空白日期尚未同步")}>
    {Array.from({length:5},(_,i)=>{const y=top+plot*(i/4);return <g key={i}><line x1={left} y1={y} x2={width-right} y2={y} stroke="var(--line)" strokeDasharray="3 5"/><text x={left-10} y={y+4} textAnchor="end" className="axis-label">{n(ceiling*(4-i)/4)}</text></g>})}
    {days.map((d,i)=>{const x=left+step*i;const h=(d.count??0)/ceiling*plot;return <g key={d.date} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(i)} onBlur={()=>setHover(null)} onClick={()=>d.count!==null&&onSelect(d.date)} onKeyDown={e=>{if(e.key==='Enter')onSelect(d.date)}} tabIndex={d.count!==null?0:undefined} role={d.count!==null?'button':undefined} aria-label={tr("{p0}：{p1} 条", {p0: d.date, p1: d.count??tr("未同步")})}>
      <rect x={x+2} y={top} width={Math.max(1,step-4)} height={plot} fill={hover===i?'var(--green-wash)':'transparent'} rx="4"/>
      {d.count!==null&&mode==='bar'&&<rect x={x+step*.2} y={top+plot-h} width={step*.6} height={Math.max(d.count>0?2:0,h)} rx="3" fill={i===days.length-1?'var(--accent)':'var(--bar)'} />}
      {d.count!==null&&mode==='line'&&<circle cx={points[i]!.x} cy={points[i]!.y} r={hover===i?5:2.5} fill="var(--accent)"/>}
      {(i===0||i===days.length-1||(i%Math.max(1,Math.ceil(days.length/8))===0&&i<days.length-2))&&<text x={x+step*.5} y={height-8} textAnchor="middle" className="axis-label">{new Intl.DateTimeFormat(locale,{timeZone:'UTC',month:'2-digit',day:'2-digit'}).format(new Date(d.date+'T12:00:00Z'))}</text>}
      <title>{d.date} · {d.count===null?tr("未同步"):d.count+tr(" 条")}</title>
    </g>})}
    {mode==='line'&&segments.map((d,i)=><path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5"/>)}
  </svg>{!any&&<div className="chart-empty"><span className="empty-signal">↗</span><strong>{tr("等待第一批记录")}</strong><span>{tr("连接 XTracker 后显示每日趋势")}</span></div>}
  {hovered&&hovered.count!==null&&<div className="chart-tip">{hovered.date} <b>{hovered.count} {tr("条")}</b></div>}</div>
}
export function HourChart({data}:{data:{hour:number;count:number|null}[]}) {
  const {t:tr}=useI18n()

  const max=Math.max(1,...data.map(d=>d.count??0));const has=data.some(d=>d.count!==null)
  return <div className="hours"><div className="hour-bars">{data.map(d=><div className="hour-column" key={d.hour} title={`${String(d.hour).padStart(2,'0')}:00 · ${d.count??tr("未同步")}`}><div className={d.count===max?'hour-peak':undefined} style={{height:!d.count?0:`${Math.max(2,d.count/max*100)}%`}}/>{d.hour%6===0&&<span>{String(d.hour).padStart(2,'0')}</span>}</div>)}</div>{!has&&<span className="hour-empty">{tr("等待完整区间数据")}</span>}</div>
}
