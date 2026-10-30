import type { IncomingHttpHeaders } from 'node:http'
import { resolveLocale } from '../src/i18n/locale.ts'
export function localeResponse(headers:IncomingHttpHeaders){
  const raw=headers['x-vercel-ip-country'], country=(Array.isArray(raw)?raw[0]:raw)||null
  const accept=headers['accept-language']
  return {locale:resolveLocale(country,Array.isArray(accept)?accept[0]:accept),country}
}
