import { useEffect, useState } from 'react'
import type { Tracking } from '../lib/types'
import type { Forecast, ForecastReason } from '../lib/forecast'
import { rangeChance } from '../lib/forecast'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

const reasonText:Record<ForecastReason,string>={not_started:'周期尚未开始',ended:'周期已结束',stale:'等待最新同步后预测',count_mismatch:'官方与归档计数待核对',history_incomplete:'历史覆盖不足，暂不预测',insufficient_history:'历史样本不足，暂不预测',official_pending:'等待官方计数',horizon_too_long:'剩余超过 7 天，暂不预测'}

export function useForecast(tracking:Tracking){
  const [result,setResult]=useState<Forecast|null>(null),[failed,setFailed]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    const load=async()=>{
      try{
        const response=await fetch('/api/forecast?'+new URLSearchParams({tracking:tracking.id}),{signal:controller.signal})
        if(!response.ok)throw Error('Forecast unavailable')
        const body:Forecast=await response.json()
        if(!controller.signal.aborted){setResult(body);setFailed(false)}
      }catch{if(!controller.signal.aborted){setResult(null);setFailed(true)}}
    }
    void load();const timer=window.setInterval(load,60_000)
    return()=>{controller.abort();window.clearInterval(timer)}
  },[tracking.id,tracking.official,tracking.checkedAt])
  const forecast=result?.trackingId===tracking.id&&result.current===tracking.official?result:null
  const visible:Forecast|null=forecast?.state==='ready'&&Date.now()-Date.parse(forecast.asOf)>180_000?{...forecast,state:'unavailable',reason:'stale'}:forecast
  return {forecast:visible,failed}
}
export function ForecastSummary({forecast,failed=false,compact=false}:{forecast:Forecast|null;failed?:boolean;compact?:boolean}){
  const {t:tr,number:n,time}=useI18n()
  const ready=forecast?.state==='ready'?forecast:null
  return <section className={`forecast-summary ${compact?'forecast-compact':'panel'}`} aria-label={tr('统计预测')}>
    <div className="forecast-heading"><h2><Icon name="activity" size={15}/>{tr('统计预测')}</h2>{ready&&!compact&&<time dateTime={ready.asOf}>{tr('截至 {p0} ET',{p0:time(ready.asOf)})}</time>}</div>
    {!ready?<p className="forecast-empty">{forecast?.state==='unavailable'?tr(reasonText[forecast.reason]):failed?tr('预测暂时不可用'):tr('正在计算预测')}</p>:<>
      <div className="forecast-values"><div><span>{tr('预计最终发帖')}</span><strong>{n(ready.median)}<small>{tr('条')}</small></strong></div><div><span>{tr('80% 预测区间')}</span><b>{n(ready.lower)}–{n(ready.upper)}</b></div></div>

    </>}
  </section>
}
export function MarketPrediction({tracking}:{tracking:Tracking}){const state=useForecast(tracking);return <ForecastSummary {...state} compact/>}
export function ForecastChance({forecast,label}:{forecast:Forecast|null;label:string}){
  const {percent}=useI18n(),chance=rangeChance(forecast,label)
  return <>{chance===null?'—':chance>0&&chance<.01?`<${percent(.01)}`:percent(chance)}</>
}
