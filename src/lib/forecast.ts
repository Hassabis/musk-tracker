export type ForecastReason = 'not_started' | 'ended' | 'stale' | 'count_mismatch' | 'history_incomplete' | 'insufficient_history' | 'official_pending' | 'horizon_too_long'
type ForecastBase = { trackingId:string; asOf:string; endDate:string; current:number|null }
export type Forecast = ForecastBase & (
  {state:'unavailable'; reason:ForecastReason} |
  {state:'ready'; median:number; mean:number; lower:number; upper:number; remainingHours:number;
    samples:number; historyDays:number; method:'historical'|'adaptive'; distribution:number[];
    validation:{samples:number; mae:number; baselineMae:number; coverage:number}|null}
)

/** Only explicit count labels are accepted; never infer bounds from a question or year. */
export function countRange(label:string):{lower:number;upper:number}|null {
  const text=label.trim(),between=/^(\d+)\s*[-–—]\s*(\d+)$/.exec(text)
  if(between){const lower=Number(between[1]),upper=Number(between[2]);return lower<=upper?{lower,upper}:null}
  const above=/^(\d+)\s*(?:\+|or more|and above)$/i.exec(text)
  if(above)return {lower:Number(above[1]),upper:Infinity}
  const below=/^(?:<\s*|less than\s+|under\s+)(\d+)$/i.exec(text)
  if(below)return {lower:0,upper:Number(below[1])-1}
  const atMost=/^(\d+)\s*(?:or fewer|or less)$/i.exec(text)
  return atMost?{lower:0,upper:Number(atMost[1])}:null
}
export function rangeChance(forecast:Forecast|null,label:string):number|null {
  const range=countRange(label)
  if(forecast?.state!=='ready'||!range)return null
  return Math.min(1,Math.max(0,forecast.distribution.reduce((sum,p,additional)=>sum+(forecast.current!+additional>=range.lower&&forecast.current!+additional<=range.upper?p:0),0)))
}
