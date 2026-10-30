import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { intlLocales, isLocale, resolveLocale, type Locale } from './locale'
import { translate } from './translate'
export { translate } from './translate'

const preferenceKey = 'musk-language'
export async function detectLocale():Promise<Locale> {
  try { const saved=localStorage.getItem(preferenceKey); if(isLocale(saved))return saved } catch { /* Storage can be disabled. */ }
  try {
    const response=await fetch('/api/locale',{cache:'no-store',signal:AbortSignal.timeout(2500)})
    if(response.ok){const body=await response.json();if(isLocale(body.locale))return body.locale}
  } catch { /* Local/offline visits use browser preferences. */ }
  return resolveLocale(null,navigator.languages?.join(',') || navigator.language)
}
function makeFormats(locale:Locale) {
  const language=intlLocales[locale]
  const number=(value:number|null|undefined,options:Intl.NumberFormatOptions={})=>value==null?'—':new Intl.NumberFormat(language,options).format(value)
  const time=(value:string|number|null|undefined,zone='America/New_York',date=false,seconds=false)=>value?new Intl.DateTimeFormat(language,{timeZone:zone,...(date?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',second:seconds&&!date?'2-digit':undefined,hourCycle:'h23'}).format(new Date(value)):'—'
  return {
    locale:language, number, time,
    preciseTime:(value:string|number|null|undefined,zone:string,date=false)=>time(value,zone,date,true),
    cents:(value:number|null|undefined)=>value==null?'—':`${number(value*100,{maximumFractionDigits:2})}¢`,
    percent:(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat(language,{style:'percent',maximumFractionDigits:2}).format(value),
    amount:(value:number|null|undefined)=>value==null?'—':number(value,{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}),
  }
}
function createValue(language:Locale,setLanguage:(value:Locale)=>void) {
  return {language,setLanguage,...makeFormats(language),t:(key:string|null|undefined,params?:Record<string,string|number|null>)=>translate(language,key,params)}
}
const Context=createContext<ReturnType<typeof createValue>|null>(null)
export function LocaleProvider({initialLocale,children}:{initialLocale:Locale;children:ReactNode}) {
  const [language,setCurrentLanguage]=useState(initialLocale)
  const value=useMemo(()=>createValue(language,next=>{
    setCurrentLanguage(next)
    try{localStorage.setItem(preferenceKey,next)}catch{ /* The selection still works without storage. */ }
  }),[language])
  useLayoutEffect(()=>{document.documentElement.lang=intlLocales[language]},[language])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useI18n(){const value=useContext(Context);if(!value)throw new Error('LocaleProvider is required');return value}
