const origin=process.env.MUSK_ORIGIN||'https://musk-tracker.vercel.app'
const secret=process.env.CRON_SECRET
if(!secret)throw Error('CRON_SECRET is not configured')
const url=new URL('/api/cron',origin)
if(url.protocol!=='https:')throw Error('The collection endpoint must use HTTPS')
const response=await fetch(url,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(285_000)})
if(!response.ok)throw Error(`Collection failed: HTTP ${response.status}`)
const body=await response.json()
if(!body.ok||body.status?.error)throw Error('Collection did not complete successfully')
console.log(JSON.stringify({archived:body.status.archived,lastSuccess:body.status.lastSuccess,historyVerifiedAt:body.status.historyVerifiedAt}))
