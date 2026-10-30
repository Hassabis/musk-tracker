import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from './app.ts'
import { Store } from './store.ts'
import { normalizePost } from './domain.ts'

async function request(store:Store,url:string,authorization?:string){
  let code=200,body=''
  const response={
    destroyed:false,headersSent:false,
    setHeader(){},flushHeaders(){},
    writeHead(status:number){code=status;this.headersSent=true},
    write(chunk:string){body+=chunk;return true},
    end(chunk=''){body+=chunk},
  }
  await createApp(store).handler({method:'GET',url,headers:{authorization}} as IncomingMessage,response as unknown as ServerResponse)
  return {code,body:JSON.parse(body)}
}
test('JSON export preserves source records and includes only public filter metadata',async()=>{
  const store=new Store(':memory:')
  try{
    store.ingest([normalizePost({id:'export-fixture',createdAt:'2026-10-29T12:00:00Z',content:'Source text'})],Date.parse('2026-10-29'),Date.parse('2026-10-30')-1)
    const result=await request(store,'/api/router?__route=export&format=json&from=2026-10-29&to=2026-10-29&timezone=UTC&_vercel_share=private-fixture&path=export')
    assert.equal(result.code,200)
    assert.deepEqual(result.body.filters,{format:'json',from:'2026-10-29',to:'2026-10-29',timezone:'UTC'})
    assert.equal(result.body.posts[0].raw.content,'Source text')
    assert.equal(JSON.stringify(result.body).includes('private-fixture'),false)
  }finally{store.db.close()}
})
test('collector rejects missing and revoked credentials before starting a sync',async()=>{
  const store=new Store(':memory:'),previous=process.env.CRON_SECRET
  try{
    process.env.CRON_SECRET='current-fixture'
    assert.equal((await request(store,'/api/cron')).code,401)
    assert.equal((await request(store,'/api/cron','Bearer revoked-fixture')).code,401)
    assert.equal(store.runs().length,0)
  }finally{
    if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous
    store.db.close()
  }
})
