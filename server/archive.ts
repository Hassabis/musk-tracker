import type { Post, Status, Tracking } from '../src/lib/types.ts'
type Result<T> = T | Promise<T>
export type Coverage = {start:number;end:number}
export interface ArchiveStore {
  get<T>(key:string,fallback:T):Result<T>
  set(key:string,value:unknown):Result<void>
  ingest(posts:Post[],start:number,end:number):Result<void>
  posts(start:number,end:number,archived?:boolean):Result<Post[]>
  count(start:number,end:number):Result<number>
  covered(start:number,end:number):Result<boolean>
  coverage():Result<Coverage[]>
  saveTracking(tracking:Tracking):Result<void>
  trackings():Result<Tracking[]>
  status():Result<Status>
  startRun(started:string):Result<string|number|bigint>
  finishRun(id:string|number|bigint,status:string,detail?:string):Result<void>
  runs():Result<unknown[]>
  acquireLease(token:string,minimumInterval?:number):Result<boolean>
  releaseLease(token:string):Result<void>
}
export function covers(ranges:Coverage[],start:number,end:number){
  let next=start
  for(const range of ranges){if(range.end<next)continue;if(range.start>next)return false;next=range.end+1;if(next>end)return true}
  return false
}
