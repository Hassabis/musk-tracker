import test from 'node:test'
import assert from 'node:assert/strict'
import { sortMarkets, marketPhase } from '../src/lib/markets.ts'
import type { Tracking } from '../src/lib/types.ts'
const now=Date.parse('2026-10-29T14:00:00Z')
const window=(id:string,startDate:string,endDate:string):Tracking=>({id,title:id,startDate,endDate,isActive:true,url:null,official:0,local:0,checkedAt:null,raw:{}})
test('default market is running and closes soonest, ahead of future monthly markets',()=>{
 const upcoming=window('november','2026-11-01T04:00:00Z','2026-12-01T04:59:59Z')
 const monthly=window('october','2026-10-01T04:00:00Z','2026-11-01T03:59:59Z')
 const weekly=window('weekly','2026-10-23T16:00:00Z','2026-10-30T15:59:59Z')
 const past=window('past','2026-10-16T16:00:00Z','2026-10-23T15:59:59Z')
 assert.deepEqual(sortMarkets([upcoming,monthly,past,weekly],now).map(t=>t.id),['weekly','october','november','past'])
 assert.equal(marketPhase(upcoming,now),1)
})
