export const locales = ['zh', 'en', 'ja', 'ko', 'es'] as const
export type Locale = typeof locales[number]
export const localeNames: Record<Locale, string> = {zh:'中文', en:'English', ja:'日本語', ko:'한국어', es:'Español'}
export const intlLocales: Record<Locale, string> = {zh:'zh-CN', en:'en-US', ja:'ja-JP', ko:'ko-KR', es:'es-ES'}
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}
const countries: Record<string, Locale> = {
  CN:'zh', HK:'zh', MO:'zh', TW:'zh', US:'en', JP:'ja', KR:'ko',
  ES:'es', MX:'es', AR:'es', BO:'es', CL:'es', CO:'es', CR:'es', CU:'es',
  DO:'es', EC:'es', SV:'es', GQ:'es', GT:'es', HN:'es', NI:'es', PA:'es',
  PY:'es', PE:'es', PR:'es', UY:'es', VE:'es',
}
export function resolveLocale(country?: string | null, acceptLanguage = ''): Locale {
  if (country && /^[A-Z]{2}$/i.test(country)) return countries[country.toUpperCase()] || 'en'
  const preferences = acceptLanguage.split(',').map((part, index) => {
    const [tag, quality] = part.split(';').map(value => value.trim())
    return {language:tag.toLowerCase().split('-')[0], quality:quality?.startsWith('q=') ? Number(quality.slice(2)) : 1, index}
  }).filter(item => Number.isFinite(item.quality) && item.quality > 0)
    .sort((a,b) => b.quality-a.quality || a.index-b.index)
  return preferences.find(item => isLocale(item.language))?.language as Locale || 'en'
}
