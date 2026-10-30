import { createServer } from 'node:http'
import { Store } from './store.ts'
import { createApp } from './app.ts'
const store=new Store(process.env.MUSK_DB||'data/musktracker.sqlite')
const {handler,collector,quotes}=createApp(store)
store.set('startedAt',new Date().toISOString());store.set('state','idle')
const server=createServer(handler),port=Number(process.env.PORT||3001)
server.listen(port,'127.0.0.1',()=>{console.log(`MuskTracker API: http://127.0.0.1:${port}`);void collector.sync()})
const refresh=setInterval(()=>void collector.sync(),60_000)
const backfill=setInterval(()=>void collector.backfill(),5_000)
let stopping=false
function stop(){if(stopping)return;stopping=true;collector.stopped=true;quotes.stop();clearInterval(refresh);clearInterval(backfill);server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()}
process.on('SIGINT',stop);process.on('SIGTERM',stop)
server.on('error',error=>{console.error(error);process.exit(1)})
