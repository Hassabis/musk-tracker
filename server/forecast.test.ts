import test from 'node:test'
import assert from 'node:assert/strict'
import { buildForecast, forecastDistribution } from './forecast.ts'
import { countRange, rangeChance } from '../src/lib/forecast.ts'
import { DAY } from './domain.ts'
import type { Tracking, Status } from '../src/lib/types.ts'

function fixture(){
  const now=Date.parse('2026-10-30T05:00:00Z'),timestamps:number[]=[]
  for(let day=0;day<180;day++)for(let hour=0;hour<24;hour++)timestamps.push(now-day*DAY-hour*3_600_000)
  const tracking:Tracking={id:'fixture',startDate:new Date(now-6*DAY).toISOString(),endDate:new Date(now+11*3_600_000).toISOString(),official:145,local:145,title:'Test',isActive:true,url:null,checkedAt:new Date(now).toISOString(),raw:{}}
  const status:Status={state:'idle',lastSuccess:new Date(now).toISOString(),lastAttempt:new Date(now).toISOString(),error:null,archived:timestamps.length,currentRecords:timestamps.length,sourceTotal:timestamps.length,archiveDifference:0,historyVerifiedAt:new Date(now).toISOString(),earliest:new Date(now-180*DAY).toISOString(),sourceLastSync:new Date(now).toISOString(),backfillCursor:null,startedAt:new Date(now).toISOString(),coverageDays:180}
  return {now,timestamps,tracking,status,observedThrough:now,coverage:[{start:now-180*DAY,end:now}]}
}
test('forecast mixtures retain zero, normalize and handle large counts without underflow',()=>{
  for(const samples of [[{lambda:0,weight:1}],[{lambda:2,weight:.5},{lambda:20,weight:.5}],[{lambda:1200,weight:1}]]){
    const d=forecastDistribution(samples)
    assert.ok(d.every(p=>Number.isFinite(p)&&p>=0))
    assert.ok(Math.abs(d.reduce((a,b)=>a+b,0)-1)<1e-10)
    assert.ok(Math.abs(d.reduce((sum,p,k)=>sum+p*k,0)-samples.reduce((sum,s)=>sum+s.lambda*s.weight,0))<1e-8)
  }
  assert.equal(forecastDistribution([{lambda:0,weight:1}])[0],1)
})
test('rolling forecasts preserve the official floor and cannot use future posts',()=>{
  const data=fixture(),f=buildForecast(data)
  assert.equal(f.state,'ready')
  if(f.state!=='ready')return
  assert.ok(f.lower>=data.tracking.official!&&f.lower<=f.median&&f.median<=f.upper)
  assert.equal(f.validation?.samples,14)
  assert.deepEqual(buildForecast({...data,timestamps:[...data.timestamps,data.now+1000,data.now+DAY]}),f)
  assert.equal(rangeChance(f,'0-99'),0)
  const sum=['0-159','160-179','180+'].reduce((total,label)=>total+rangeChance(f,label)!,0)
  assert.ok(Math.abs(sum-1)<1e-10)
})
test('count labels accept only explicit inclusive ranges and open tails',()=>{
  assert.deepEqual(countRange('320–339'),{lower:320,upper:339})
  assert.deepEqual(countRange('580+'),{lower:580,upper:Infinity})
  assert.deepEqual(countRange('<20'),{lower:0,upper:19})
  assert.equal(countRange('Elon Musk October 2026'),null)
  assert.equal(countRange('339-320'),null)
})
test('forecast quality gates reject mismatch, incomplete history, stale data and long horizons',()=>{
  const data=fixture(),reason=(f:ReturnType<typeof buildForecast>)=>f.state==='unavailable'?f.reason:'ready'
  assert.equal(reason(buildForecast({...data,tracking:{...data.tracking,official:144}})),'count_mismatch')
  assert.equal(reason(buildForecast({...data,coverage:[{start:data.now-10*DAY,end:data.now}]})),'history_incomplete')
  assert.equal(reason(buildForecast({...data,now:data.now+181_000})),'stale')
  assert.equal(reason(buildForecast({...data,tracking:{...data.tracking,endDate:new Date(data.now+8*DAY).toISOString()}})),'horizon_too_long')
  assert.equal(reason(buildForecast({...data,tracking:{...data.tracking,official:null}})),'official_pending')
})
test('ended and future periods never display a forecast as a settled result',()=>{
  const data=fixture()
  const closed=buildForecast({...data,now:Date.parse(data.tracking.endDate)})
  assert.equal(closed.state,'unavailable');if(closed.state==='unavailable')assert.equal(closed.reason,'ended')
  const future=buildForecast({...data,tracking:{...data.tracking,startDate:new Date(data.now+DAY).toISOString()}})
  assert.equal(future.state,'unavailable');if(future.state==='unavailable')assert.equal(future.reason,'not_started')
})
