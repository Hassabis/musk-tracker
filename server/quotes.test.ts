import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvent, normalizeHistory, OrderBook, price } from './market-data.ts'
import { QuoteService } from './quotes.ts'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import type { Tracking } from '../src/lib/types.ts'

const event={id:'event',slug:'musk-test',title:'Musk test',closed:false,markets:[{id:'market',outcomes:'["No","Yes"]',outcomePrices:'["0.6","0.4"]',clobTokenIds:'["101","102"]',closed:false}]}
test('map each outcome to its own asset; unknown values and empty books never become zero',()=>{
  const snapshot=normalizeEvent(event,'tracking','musk-test')
  assert.deepEqual(snapshot.markets[0].outcomes.map(o=>[o.name,o.assetId,o.price]),[['No','101',.6],['Yes','102',.4]])
  assert.equal(price(null),null);assert.equal(price(''),null);assert.equal(price('NaN'),null);assert.equal(price(1.2),null);assert.equal(price('0'),0)
  assert.throws(()=>normalizeEvent(event,'tracking','wrong-slug'))
  const v2=normalizeEvent({...event,markets:[{...event.markets[0],version:'v2',positionIds:['201','202']}]},'tracking','musk-test')
  assert.equal(v2.markets[0].outcomes[1].assetId,'202')
})
test('order book snapshots and deltas preserve depth, remove levels and reject stale updates',()=>{
  const quote=normalizeEvent(event,'tracking','musk-test').markets[0].outcomes[1],book=new OrderBook()
  const at='2026-10-29T15:00:00Z'
  book.replace([{price:'.3',size:'20'},{price:'.4',size:'10'}],[{price:'.6',size:'100'},{price:'.5',size:'30'}],at)
  book.write(quote)
  assert.deepEqual([quote.bid,quote.ask,quote.price],[.4,.5,.45])
  assert.equal(book.change('BUY','.4','0','2026-10-29T15:00:01Z'),true)
  book.write(quote);assert.equal(quote.bid,.3)
  assert.equal(book.change('BUY','.45','10',at),false)
  assert.equal(book.replace([],[],at),false)
  book.change('SELL','.5','0','2026-10-29T15:00:02Z');book.write(quote)
  assert.equal(quote.ask,.6)
  book.replace([],[],'2026-10-29T15:00:03Z');book.write(quote)
  assert.equal(quote.price,null);assert.equal(quote.bid,null);assert.equal(quote.ask,null)
})
test('crossed books have no midpoint and deltas cannot bootstrap an incomplete book',()=>{
  const quote=normalizeEvent(event,'tracking','musk-test').markets[0].outcomes[0],book=new OrderBook()
  assert.equal(book.change('BUY','.4','3',null),false)
  book.replace([{price:'.6',size:10}],[{price:'.5',size:10}],null);book.write(quote)
  assert.equal(quote.price,null)
})
test('history normalizes real API seconds and SDK milliseconds, keeps zero, sorts and deduplicates',()=>{
  const points=normalizeHistory([{timestamp:1793286000,price:0,resolution_seconds:300},{timestamp:1793285700000,price:'.4',resolution_seconds:300},{timestamp:1793286000,price:'.5',resolution_seconds:0},{timestamp:'bad',price:.9},{timestamp:1793286300,price:null}])
  assert.deepEqual(points,[{time:1793285700000,price:.4,resolution:300},{time:1793286000000,price:.5,resolution:0}])
  assert.equal(normalizeHistory([{timestamp:1793286000,price:0}])[0].price,0)
})

test('stream reconnects after disconnect, replaces the book and stops when disposed',async()=>{
  const originalSocket=globalThis.WebSocket,originalFetch=globalThis.fetch
  const sockets:FakeSocket[]=[]
  class FakeSocket extends EventTarget {
    static OPEN=1
    readyState=1
    sent:string[]=[]
    constructor(){super();sockets.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('open')))}
    send(value:string){this.sent.push(value)}
    close(){this.readyState=3;this.dispatchEvent(new Event('close'))}
    receive(value:unknown){this.dispatchEvent(Object.assign(new Event('message'),{data:JSON.stringify(value)}))}
  }
  class Client extends EventEmitter { destroyed=false;writableLength=0;frames:string[]=[];write(value:string){this.frames.push(value);return true}end(){this.emit('close')}destroy(){this.destroyed=true;this.emit('close')} }
  globalThis.WebSocket=FakeSocket as unknown as typeof WebSocket
  globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('gamma-api')?event:[]),{status:200})
  const service=new QuoteService(),client=new Client()
  try{
    const tracking={id:'tracking',url:'https://polymarket.com/event/musk-test'} as Tracking
    const feed=service.feed(tracking);await feed.load();feed.attach(client as unknown as ServerResponse)
    await new Promise(resolve=>setTimeout(resolve,5))
    assert.deepEqual(JSON.parse(sockets[0].sent[0]).assets_ids,['101','102'])
    const book=(bid:string,ask:string,at:string)=>({event_type:'book',asset_id:'102',bids:[{price:bid,size:10}],asks:[{price:ask,size:10}],timestamp:at})
    sockets[0].receive(book('.3','.4','1793286000000'))
    assert.equal(feed.snapshot?.state,'live');assert.equal(feed.quote('102')?.price,.35)
    sockets[0].close();assert.equal(feed.snapshot?.state,'reconnecting')
    await new Promise(resolve=>setTimeout(resolve,1100))
    assert.equal(sockets.length,2);assert.equal(feed.quote('102')?.bookReady,false)
    sockets[1].receive(book('.5','.6','1793286001000'))
    assert.equal(feed.snapshot?.state,'live');assert.equal(feed.quote('102')?.bid,.5)
    sockets[0].receive(book('.1','.2','1793286002000'))
    assert.equal(feed.quote('102')?.bid,.5,'late frames from an old socket are ignored')
    service.stop();assert.equal(sockets[1].readyState,3);assert.equal(feed.listeners.size,0)
  }finally{service.stop();globalThis.WebSocket=originalSocket;globalThis.fetch=originalFetch}
})
