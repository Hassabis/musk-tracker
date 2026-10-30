import type { Locale } from './locale.ts'
import { messages } from './messages.ts'
export function translate(locale:Locale,key:string|null|undefined,params:Record<string,string|number|null>={}){
  if(!key)return ''
  const template=locale==='zh'?key:messages[locale][key]||messages.en[key]||key
  return template.replace(/\{(\w+)\}/g,(token,name:string)=>params[name]==null?token:String(params[name]))
}
