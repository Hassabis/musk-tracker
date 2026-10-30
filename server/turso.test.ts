import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { TursoHTTP, TursoStore, type SqlClient, type Statement } from './turso.ts'
import { normalizePost, DAY } from './domain.ts'

function fixture(){
  const db=new DatabaseSync(':memory:')
  const sql:SqlClient={
    async query(sql,args=[]){const stmt=db.prepare(sql);if(stmt.columns().length)return {rows:stmt.all(...args),changes:0,lastId:null};const result=stmt.run(...args);return {rows:[],changes:Number(result.changes),lastId:result.lastInsertRowid}},
    async transaction(statements:Statement[]){db.exec('BEGIN IMMEDIATE');try{for(const statement of statements)db.prepare(statement.sql).run(...statement.args||[]);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}},
  }
  return {db,sql,store:new TursoStore(sql)}
}
test('cloud archive preserves first seen, revisions, removals and coverage boundaries',async()=>{
  const {store,db}=fixture(),start=Date.parse('2026-10-29T00:00:00Z'),end=start+DAY-1
  const post={id:'one',createdAt:'2026-10-29T12:00:00Z',content:'original'}
  await store.ingest([normalizePost(post,'2026-10-29T13:00:00Z')],start,end)
  const changed=normalizePost({...post,content:'edited'},'2026-10-29T14:00:00Z')
  await store.ingest([changed],start,end);await store.ingest([changed],start,end)
  assert.equal((await store.posts(start,end))[0].firstSeen,'2026-10-29T13:00:00Z')
  assert.equal((await store.posts(start,end))[0].text,'edited')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM revisions').get()!.n,2)
  await store.ingest([],start,end)
  assert.equal(await store.count(start,end),0)
  assert.equal((await store.posts(start,end,true)).length,1)
  assert.equal(await store.covered(start,end),true)
  assert.equal(await store.covered(start-1,end),false)
  db.close()
})
test('failed cloud import never removes the previous archive or certifies new coverage',async()=>{
  const {store,sql,db}=fixture(),start=Date.parse('2026-10-29T00:00:00Z'),end=start+DAY-1
  await store.ingest([normalizePost({id:'old',createdAt:new Date(start+1000).toISOString(),content:'saved'})],start,start+2000)
  const real=sql.transaction.bind(sql)
  sql.transaction=async statements=>{if(statements.some(s=>s.sql.startsWith('UPDATE posts SET present=0')))throw Error('interrupted');await real(statements)}
  await assert.rejects(store.ingest([normalizePost({id:'new',createdAt:new Date(start+3000).toISOString(),content:'new'})],start,end),/interrupted/)
  assert.ok((await store.posts(start,end)).some(post=>post.id==='old'))
  assert.equal(await store.covered(start,end),false)
  db.close()
})
test('distributed collector lease cannot be stolen and enforces the sync cooldown',async()=>{
  const {store,db}=fixture()
  assert.equal(await store.acquireLease('first'),true)
  assert.equal(await store.acquireLease('second'),false)
  await store.releaseLease('second')
  assert.equal(await store.acquireLease('second'),false)
  await store.releaseLease('first')
  await store.set('lastAttempt',new Date().toISOString())
  assert.equal(await store.acquireLease('second',55_000),false)
  assert.equal(await store.acquireLease('second'),true)
  await store.releaseLease('second');db.close()
})
test('SQL-over-HTTP binds values and retains zero and null without exposing credentials',async()=>{
  let sent:any
  const client=new TursoHTTP('libsql://database.example','fixture-secret',async(_input,init)=>{
    sent=JSON.parse(String(init?.body))
    return Response.json({results:[{type:'ok',response:{type:'execute',result:{cols:[{name:'zero'},{name:'missing'}],rows:[[{type:'integer',value:'0'},{type:'null'}]],affected_row_count:0,last_insert_rowid:null}}},{type:'ok',response:{type:'close'}}]})
  })
  assert.deepEqual((await client.query('SELECT ?,NULL',["a'); DROP TABLE posts;"])).rows,[{zero:0,missing:null}])
  assert.equal(sent.requests[0].stmt.sql,'SELECT ?,NULL')
  assert.equal(sent.requests[0].stmt.args[0].value,"a'); DROP TABLE posts;")
  const failing=new TursoHTTP('https://database.example','fixture-secret',async()=>Response.json({results:[{type:'error',error:{code:'SQLITE_BUSY',message:'unsafe internal data'}}]}))
  await assert.rejects(failing.query('SELECT 1'),error=>error instanceof Error&&error.message.includes('SQLITE_BUSY')&&!error.message.includes('fixture-secret')&&!error.message.includes('unsafe'))
})
test('conditional batch errors fail a transaction even when HTTP returned 200',async()=>{
  const client=new TursoHTTP('https://database.example','fixture',async()=>Response.json({results:[{type:'ok',response:{type:'batch',result:{step_results:[{},null,null,{}],step_errors:[null,{code:'SQLITE_CONSTRAINT'},null,null]}}},{type:'ok',response:{type:'close'}}]}))
  await assert.rejects(client.transaction([{sql:'INSERT invalid'}]),/SQLITE_CONSTRAINT/)
})
