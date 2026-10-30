import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from '../server/app.ts'
import { TursoHTTP, TursoStore } from '../server/turso.ts'
import { localeResponse } from '../server/locale.ts'
let app:ReturnType<typeof createApp>|undefined
export default async function handler(req:IncomingMessage,res:ServerResponse){
  const url=new URL(req.url||'/','http://localhost')
  if(url.pathname==='/api/locale'||url.searchParams.get('__route')==='locale'){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json; charset=utf-8')
    res.end(JSON.stringify(localeResponse(req.headers)));return
  }
  const database=process.env.TURSO_DATABASE_URL,token=process.env.TURSO_AUTH_TOKEN
  if(!database||!token){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Archive storage is not connected'}));return}
  app??=createApp(new TursoStore(new TursoHTTP(database,token)),{cloud:true})
  await app.handler(req,res)
}
