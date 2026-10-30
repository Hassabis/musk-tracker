import type { Post } from '../src/lib/types.ts'
export const EASTERN = 'America/New_York'
export const DAY = 86_400_000
export function dateKey(value: string | number | Date, timezone = EASTERN) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
export function shiftDate(date: string, amount: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + amount * DAY).toISOString().slice(0, 10)
}
export function dayStart(date: string, timezone = EASTERN) {
  const target = Date.parse(date + 'T00:00:00Z')
  let result = target
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(result))
    const v = Object.fromEntries(p.map(x => [x.type, x.value]))
    const asUTC = Date.parse(`${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}Z`)
    result += target - asUTC
  }
  return result
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('XTracker 返回了未知的数据结构')
  return value as Record<string, unknown>
}
function iso(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('XTracker 记录缺少有效的发帖时间')
  return new Date(value).toISOString()
}
export function normalizePost(value: unknown, now = new Date().toISOString()): Post {
  const raw = object(value)
  const id = raw.id
  if (typeof id !== 'string' || !id) throw new Error('XTracker 记录缺少稳定 ID；已停止导入以避免漏记')
  const platformId = typeof raw.platformId === 'string' ? raw.platformId : typeof raw.tweetId === 'string' ? raw.tweetId : null
  const text = typeof raw.content === 'string' ? raw.content : typeof raw.text === 'string' ? raw.text : ''
  const createdAt = iso(raw.createdAt)
  // Keep unknown categories unknown: never classify replies/reposts by text alone.
  const typeValue = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
  const type = ['tweet', 'post', 'original'].includes(typeValue) ? 'original' : ['retweet', 'repost'].includes(typeValue) ? 'repost' : ['quote', 'quote_tweet'].includes(typeValue) ? 'quote' : typeValue === 'reply' ? 'reply' : 'unknown'
  return { id, platformId, text, createdAt, importedAt: typeof raw.importedAt === 'string' ? iso(raw.importedAt) : null, firstSeen: now, lastSeen: now, type, url: platformId && /^\d+$/.test(platformId) ? `https://x.com/elonmusk/status/${platformId}` : null, raw }
}
export function assertPosts(value: unknown, start: number, end: number) {
  if (!Array.isArray(value)) throw new Error('XTracker posts 不是数组；需要检查 API 结构')
  const posts = value.map(v => normalizePost(v))
  if (posts.some(p => Date.parse(p.createdAt) < start || Date.parse(p.createdAt) > end)) throw new Error('XTracker 返回了查询时间范围外的记录；未将该区间标为已同步')
  return Array.from(new Map(posts.map(p => [p.id, p])).values())
}
export function csvCell(value: unknown) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
export function safePolymarketURL(value: unknown) {
  if (typeof value !== 'string') return null
  try { const u = new URL(value); return u.protocol === 'https:' && ['polymarket.com','www.polymarket.com'].includes(u.hostname) ? u.href : null } catch { return null }
}

/** Past calendar days require their entire interval; a stale observation must
 * never turn an unfinished yesterday into a complete day after midnight. */
export function dayCoverage(start: number, end: number, now: number, observedThrough: number | null, covered: (start: number, end: number) => boolean) {
  if (observedThrough === null || start > now || start > observedThrough) return false
  const requiredEnd = end < now ? end : Math.min(now, observedThrough)
  return observedThrough >= requiredEnd && covered(start, requiredEnd)
}
