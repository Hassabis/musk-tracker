import test from 'node:test'
import assert from 'node:assert/strict'
import { dayStart, dateKey, DAY, normalizePost, assertPosts, csvCell, dayCoverage } from './domain.ts'
import { Store } from './store.ts'
test('Eastern midnight respects spring and autumn DST (23/25-hour days)',()=>{
  assert.equal(dayStart('2026-03-09')-dayStart('2026-03-08'),23*3600_000)
  assert.equal(dayStart('2026-11-02')-dayStart('2026-11-01'),25*3600_000)
  assert.equal(dateKey('2026-10-29T03:59:59Z'),'2026-10-28')
  assert.equal(dateKey('2026-10-29T04:00:00Z'),'2026-10-29')
})
test('unknown type is preserved as unknown; missing timestamp fails',()=>{
  const p=normalizePost({id:'fixture',createdAt:'2026-10-29T12:00:00Z',content:'RT not a classification'})
  assert.equal(p.type,'unknown');assert.equal(p.url,null)
  assert.throws(()=>normalizePost({id:'bad'}))
  assert.throws(()=>assertPosts([{id:'bad',createdAt:'2026-10-29T12:00:00Z'}],0,1))
})
test('idempotent imports preserve first-seen, revisions and removed archive rows',()=>{
  const store=new Store(':memory:')
  const start=Date.parse('2026-10-29T00:00:00Z'),end=start+DAY-1
  const fixture={id:'fixture',createdAt:'2026-10-29T12:00:00Z',content:'original'}
  store.ingest([normalizePost(fixture,'2026-10-29T13:00:00Z')],start,end)
  store.ingest([normalizePost({...fixture,content:'edited'},'2026-10-29T14:00:00Z')],start,end)
  assert.equal(store.posts(start,end).length,1)
  assert.equal(store.posts(start,end)[0].firstSeen,'2026-10-29T13:00:00Z')
  assert.equal(store.posts(start,end)[0].text,'edited')
  assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS n FROM revisions').get()!.n),2)
  store.ingest([],start,end)
  assert.equal(store.posts(start,end).length,0)
  assert.equal(store.posts(start,end,true).length,1)
  assert.equal(store.covered(start,end),true)
  assert.equal(store.covered(start-1,end),false)
  store.db.close()
})
test('coverage joins adjacent slices but detects a one-millisecond gap',()=>{
  const s=new Store(':memory:');s.ingest([],100,200);s.ingest([],202,300)
  assert.equal(s.covered(100,300),false);s.ingest([],201,201);assert.equal(s.covered(100,300),true);s.db.close()
})
test('CSV escapes formulas, multiline content and quotes',()=>{
  assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"')
})

test('stale midday data is not a complete yesterday after the calendar rolls over',()=>{
  const start=dayStart('2026-10-29'),end=dayStart('2026-10-30')-1
  const midday=start+12*3600_000
  const stored=(a:number,b:number)=>a>=start&&b<=midday
  assert.equal(dayCoverage(start,end,midday,midday,stored),true)
  assert.equal(dayCoverage(start,end,end+3600_000,midday,stored),false)
  assert.equal(dayCoverage(end+1,end+DAY, end+3600_000,midday,stored),false)
})
test('revisiting the beginning of a covered range does not shrink known coverage',()=>{
  const s=new Store(':memory:');s.ingest([],100,300);s.ingest([],100,150)
  assert.equal(s.covered(100,300),true);s.db.close()
})
