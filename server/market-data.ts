import type { Level, MarketSnapshot, OutcomeQuote, PricePoint } from '../src/lib/quotes.ts'

export function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
export function price(value: unknown): number | null {
  const parsed = number(value)
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null
}
function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
  return []
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function timestamp(value: unknown): string | null {
  const raw = number(value)
  const ms = raw === null ? Date.parse(String(value)) : raw < 1e12 ? raw * 1000 : raw
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null
}
export function normalizeEvent(value: unknown, trackingId: string, slug: string): MarketSnapshot {
  const event = record(value)
  if (!event.id || event.slug !== slug || !Array.isArray(event.markets)) throw Error('Polymarket 市场响应不完整')
  const markets = event.markets.map(value => {
    const m = record(value), names = array(m.outcomes), prices = array(m.outcomePrices)
    const ids = m.version === 'v2' ? array(m.positionIds) : array(m.clobTokenIds)
    return {
      id: String(m.id), conditionId: String(m.conditionId || ''), label: String(m.groupItemTitle || m.question || '—'),
      question: String(m.question || ''), closed: m.closed === true, volume: number(m.volume), volume24h: number(m.volume24hr),
      outcomes: names.map((name, i): OutcomeQuote => ({
        assetId: typeof ids[i] === 'string' ? ids[i] as string : '', name: String(name), price: price(prices[i]),
        bid: null, ask: null, last: null, lastAt: null, updatedAt: null, bids: [], asks: [], bookReady: false,
      })),
    }
  })
  if (!markets.length) throw Error('该周期暂无 Polymarket 行情')
  return { trackingId, title: String(event.title || slug), url: `https://polymarket.com/event/${slug}`,
    closed: event.closed === true, endDate: typeof event.endDate === 'string' ? event.endDate : null,
    volume: number(event.volume), volume24h: number(event.volume24hr), liquidity: number(event.liquidity), markets,
    metadataAt: new Date().toISOString(), receivedAt: null, state: event.closed === true ? 'closed' : 'connecting', error: null }
}

// Keep the entire book internally. A zero-sized delta removes a level; slicing
// before applying deltas would lose the next best quote when top levels disappear.
export class OrderBook {
  bids = new Map<number, number>()
  asks = new Map<number, number>()
  ready = false
  time = 0
  replace(bids: unknown, asks: unknown, time: string | null) {
    const at = time ? Date.parse(time) : Date.now()
    if (at < this.time) return false
    const read = (values: unknown) => new Map(array(values).flatMap(value => {
      const row = record(value), p = price(row.price), size = number(row.size)
      return p !== null && size !== null && size > 0 ? [[p, size] as const] : []
    }))
    this.bids = read(bids); this.asks = read(asks); this.ready = true; this.time = at
    return true
  }
  change(side: unknown, rawPrice: unknown, rawSize: unknown, time: string | null) {
    const at = time ? Date.parse(time) : Date.now(), p = price(rawPrice), size = number(rawSize)
    if (!this.ready || at < this.time || p === null || size === null || size < 0 || !['BUY', 'SELL'].includes(String(side))) return false
    const levels = side === 'BUY' ? this.bids : this.asks
    if (size === 0) levels.delete(p); else levels.set(p, size)
    this.time = at
    return true
  }
  write(quote: OutcomeQuote) {
    const sort = (map: Map<number, number>, direction: number): Level[] => Array.from(map, ([price, size]) => ({price, size})).sort((a, b) => direction * (a.price - b.price)).slice(0, 8)
    quote.bids = sort(this.bids, -1); quote.asks = sort(this.asks, 1)
    quote.bid = quote.bids[0]?.price ?? null; quote.ask = quote.asks[0]?.price ?? null
    // No invented midpoints for empty or crossed books.
    quote.price = quote.bid !== null && quote.ask !== null && quote.bid <= quote.ask ? (quote.bid + quote.ask) / 2 : null
    quote.bookReady = this.ready; quote.updatedAt = new Date(this.time).toISOString()
  }
}
export function normalizeHistory(values: unknown): PricePoint[] {
  if (!Array.isArray(values)) throw Error('历史行情响应格式无效')
  const points = new Map<number, PricePoint>()
  for (const value of values) {
    const row = record(value), at = timestamp(row.timestamp), p = price(row.price), resolution = number(row.resolution_seconds)
    if (at && p !== null) points.set(Date.parse(at), { time: Date.parse(at), price: p, resolution: resolution ?? 0 })
  }
  return [...points.values()].sort((a, b) => a.time - b.time)
}
