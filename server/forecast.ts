import { DAY, EASTERN, dateKey, shiftDate } from './domain.ts'
import type { Tracking, Status } from '../src/lib/types.ts'
import type { Forecast, ForecastReason } from '../src/lib/forecast.ts'
import { covers, type Coverage } from './archive.ts'

const LOOKBACK=84, CONTEXT=7, HOLDOUT=14, CALIBRATION=28
const localClock=new Intl.DateTimeFormat('en-CA',{timeZone:EASTERN,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
function parts(time:number){return Object.fromEntries(localClock.formatToParts(time).map(p=>[p.type,p.value]))}
function historicalOrigin(origin:number,date:string){
  const p=parts(origin),desired=Date.parse(`${date}T${p.hour}:${p.minute}:${p.second}Z`)
  let result=desired
  for(let i=0;i<4;i++){
    const v=parts(result),seen=Date.parse(`${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}Z`)
    if(seen===desired)return result
    result+=desired-seen
  }
  return null // A nonexistent wall-clock time at a DST transition is not a sample.
}
function upperBound(times:number[],value:number){let low=0,high=times.length;while(low<high){const mid=(low+high)>>>1;if(times[mid]<=value)low=mid+1;else high=mid}return low}
function count(times:number[],start:number,end:number){return upperBound(times,end)-upperBound(times,start)}
function weekday(date:string){return new Date(date+'T12:00:00Z').getUTCDay()}
type Window={count:number;ratio:number;weight:number}
function windows(times:number[],origin:number,horizon:number,floor:number){
  const currentWeek=count(times,origin-CONTEXT*DAY,origin),date=dateKey(origin),dow=weekday(date),samples:Window[]=[]
  for(let back=1;back<=LOOKBACK;back++){
    const pastDate=shiftDate(date,-back),start=historicalOrigin(origin,pastDate)
    if(start===null||start+horizon>origin||start-CONTEXT*DAY<floor)continue
    const previousWeek=count(times,start-CONTEXT*DAY,start)
    samples.push({count:count(times,start,start+horizon),ratio:Math.min(2,Math.max(.5,Math.sqrt((currentWeek+7)/(previousWeek+7)))),weight:2**(-back/28)*(weekday(pastDate)===dow?2:1)})
  }
  return {samples,baseline:currentWeek/(CONTEXT*DAY)*horizon}
}
function rates(samples:Window[],adaptive:boolean){
  const total=samples.reduce((sum,s)=>sum+s.weight,0)
  return samples.map(s=>({lambda:s.count*(adaptive?s.ratio:1),weight:s.weight/total}))
}
function expectation(samples:Window[],adaptive:boolean){return rates(samples,adaptive).reduce((sum,s)=>sum+s.weight*s.lambda,0)}

/** A mixture of whole historical-window intensities retains burst variation.
 * Poisson count uncertainty is added within each sampled intensity. No RNG is used. */
export function forecastDistribution(samples:{lambda:number;weight:number}[]){
  const maximum=Math.max(0,...samples.map(s=>s.lambda)),limit=Math.ceil(maximum+12*Math.sqrt(maximum+1)+40)
  const logFactorial=Array.from({length:limit+1},()=>0)
  for(let k=2;k<=limit;k++)logFactorial[k]=logFactorial[k-1]+Math.log(k)
  const probabilities=Array.from({length:limit+1},()=>0)
  for(const {lambda,weight} of samples){
    if(lambda===0){probabilities[0]+=weight;continue}
    const mode=Math.floor(lambda),peak=Math.exp(mode*Math.log(lambda)-lambda-logFactorial[mode])
    probabilities[mode]+=weight*peak
    let p=peak
    for(let k=mode+1;k<=limit;k++){p*=lambda/k;probabilities[k]+=weight*p}
    p=peak
    for(let k=mode-1;k>=0;k--){p*=(k+1)/lambda;probabilities[k]+=weight*p}
  }
  const sum=probabilities.reduce((a,b)=>a+b,0)
  return probabilities.map(p=>p/sum)
}
function quantile(distribution:number[],probability:number){let sum=0;for(let i=0;i<distribution.length;i++){sum+=distribution[i];if(sum>=probability)return i}return distribution.length-1}

export function buildForecast({tracking,status,observedThrough,coverage,timestamps,now=Date.now()}:{
  tracking:Tracking;status:Status;observedThrough:number|null;coverage:Coverage[];timestamps:number[];now?:number
}):Forecast {
  const observed=observedThrough??NaN,asOf=Number.isFinite(observed)?observed:now,end=Date.parse(tracking.endDate),start=Date.parse(tracking.startDate)
  const base={trackingId:tracking.id,asOf:new Date(asOf).toISOString(),endDate:tracking.endDate,current:tracking.official}
  const unavailable=(reason:ForecastReason):Forecast=>({...base,state:'unavailable',reason})
  if(now<start)return unavailable('not_started')
  if(now>=end)return unavailable('ended')
  if(tracking.official===null||!Number.isSafeInteger(tracking.official)||tracking.official<0)return unavailable('official_pending')
  if(!status.lastSuccess||now-Date.parse(status.lastSuccess)>180_000||!Number.isFinite(observed)||now-observed>180_000||status.error)return unavailable('stale')
  const horizon=end-asOf
  if(horizon>7*DAY)return unavailable('horizon_too_long')
  const sorted=timestamps.filter(t=>Number.isFinite(t)&&t<=asOf).sort((a,b)=>a-b)
  // Both the archive count and the model cutoff must reconcile with the official counter.
  const local=upperBound(sorted,Math.min(asOf,end))-upperBound(sorted,start-1)
  if(local!==tracking.official)return unavailable('count_mismatch')
  const ordered=[...coverage].sort((a,b)=>a.start-b.start),floor=Math.max(asOf-180*DAY,Date.parse(status.earliest||base.asOf))
  if(!covers(ordered,floor,asOf))return unavailable('history_incomplete')
  const current=windows(sorted,asOf,horizon,floor)
  if(current.samples.length<21)return unavailable('insufficient_history')

  // Older rolling origins select one of two fixed models. The latest 14 origins
  // stay out of model selection and measure error at this exact forecast horizon.
  const cases:{samples:Window[];baseline:number;actual:number}[]=[]
  const date=dateKey(asOf)
  for(let back=1;back<=90&&cases.length<CALIBRATION+HOLDOUT;back++){
    const origin=historicalOrigin(asOf,shiftDate(date,-back))
    if(origin===null||origin+horizon>asOf)continue
    const historical=windows(sorted,origin,horizon,floor)
    if(historical.samples.length<21)continue
    cases.push({...historical,actual:count(sorted,origin,origin+horizon)})
  }
  const heldout=cases.slice(0,HOLDOUT),calibration=cases.slice(HOLDOUT)
  const error=(values:typeof cases,adaptive:boolean)=>values.reduce((sum,c)=>sum+Math.abs(quantile(forecastDistribution(rates(c.samples,adaptive)),.5)-c.actual),0)/values.length
  const adaptive=calibration.length>=14&&error(calibration,true)<error(calibration,false)
  const distribution=forecastDistribution(rates(current.samples,adaptive))
  const validation=heldout.length>=7&&calibration.length>=14?{
    samples:heldout.length,
    mae:heldout.reduce((sum,c)=>sum+Math.abs(quantile(forecastDistribution(rates(c.samples,adaptive)),.5)-c.actual),0)/heldout.length,
    baselineMae:heldout.reduce((sum,c)=>sum+Math.abs(Math.round(c.baseline)-c.actual),0)/heldout.length,
    coverage:heldout.filter(c=>{const d=forecastDistribution(rates(c.samples,adaptive));return c.actual>=quantile(d,.1)&&c.actual<=quantile(d,.9)}).length/heldout.length,
  }:null
  return {...base,state:'ready',median:tracking.official+quantile(distribution,.5),mean:tracking.official+expectation(current.samples,adaptive),lower:tracking.official+quantile(distribution,.1),upper:tracking.official+quantile(distribution,.9),remainingHours:horizon/3_600_000,samples:current.samples.length,historyDays:LOOKBACK,method:adaptive?'adaptive':'historical',distribution,validation}
}
