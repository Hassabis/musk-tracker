import type { ServerResponse } from 'node:http'
import type { Tracking } from '../src/lib/types.ts'
import type { MarketSnapshot, OutcomeQuote, PriceHistory } from '../src/lib/quotes.ts'
import { normalizeEvent, normalizeHistory, OrderBook, price, record, timestamp } from './market-data.ts'

const GAMMA = 'https://gamma-api.polymarket.com'
const CLOB = 'https://clob.polymarket.com'
const DATA = 'https://data-api.polymarket.com'
const SOCKET = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
async function readJSON(url: string, init: RequestInit = {}): Promise<unknown> {
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {...init, signal: AbortSignal.timeout(12_000), headers: {'Content-Type': 'application/json', Accept: 'application/json', ...init.headers}})
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status < 500 && response.status !== 429) throw Object.assign(Error(`Polymarket HTTP ${response.status}`), {permanent: true})
        throw Error(`Polymarket HTTP ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      failure = error
      if (record(error).permanent || attempt === 2) break
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt))
    }
  }
  throw Error(failure instanceof Error ? failure.message : '无法连接 Polymarket')
}

class MarketFeed {
  snapshot?: MarketSnapshot
  pending?: Promise<MarketSnapshot>
  listeners = new Set<ServerResponse>()
  books = new Map<string, OrderBook>()
  socket?: WebSocket
  heartbeat?: NodeJS.Timeout
  refresh?: NodeJS.Timeout
  reconnect?: NodeJS.Timeout
  publishTimer?: NodeJS.Timeout
  releaseTimer?: NodeJS.Timeout
  attempts = 0
  lastWire = 0
  lastUsed = Date.now()
  stopped = false
  slug: string
  trackingId: string
  constructor(tracking: Tracking) {
    const url = tracking.url ? new URL(tracking.url) : null
    if (!url || url.hostname !== 'polymarket.com' || !/^\/event\/[a-z0-9-]+\/?$/.test(url.pathname)) throw Error('该周期没有可用的 Polymarket 市场链接')
    this.slug = url.pathname.split('/')[2]; this.trackingId = tracking.id
  }
  assets() { return this.snapshot?.markets.filter(m => !m.closed).flatMap(m => m.outcomes.map(o => o.assetId)).filter(id => /^\d+$/.test(id)) || [] }
  quote(id: unknown): OutcomeQuote | undefined { return this.snapshot?.markets.flatMap(m => m.outcomes).find(o => o.assetId === id) }
  async load(force = false): Promise<MarketSnapshot> {
    this.lastUsed = Date.now()
    if (this.pending) return this.pending
    if (!force && this.snapshot && Date.now() - Date.parse(this.snapshot.metadataAt) < 60_000) return this.snapshot
    this.pending = (async () => {
      const value = await readJSON(`${GAMMA}/events/slug/${encodeURIComponent(this.slug)}`)
      if (this.stopped) throw Error('行情服务已停止')
      const next = normalizeEvent(value, this.trackingId, this.slug), previous = this.snapshot
      const oldAssets = this.assets().join(',')
      if (previous) {
        const oldQuotes = new Map(previous.markets.filter(m => !m.closed).flatMap(m => m.outcomes.map(o => [o.assetId, o] as const)))
        for (const market of next.markets) if (!market.closed) market.outcomes = market.outcomes.map(o => oldQuotes.get(o.assetId) || o)
        next.receivedAt = previous.receivedAt
        if (!next.closed) next.state = previous.state
      }
      this.snapshot = next
      if (this.listeners.size) {
        if (oldAssets !== this.assets().join(',') || next.closed) { this.disconnect(); this.connect() }
        void this.loadLastTrades()
      }
      this.publish()
      return next
    })().finally(() => { this.pending = undefined })
    return this.pending
  }
  async loadLastTrades() {
    const ids = this.assets(), requestedAt = Date.now()
    if (!ids.length || this.stopped) return
    try {
      const result = await readJSON(`${CLOB}/last-trades-prices`, {method: 'POST', body: JSON.stringify(ids.map(token_id => ({token_id})))})
      if (this.stopped || !Array.isArray(result)) return
      for (const value of result) {
        const row = record(value), quote = this.quote(row.token_id)
        if (quote && (!quote.lastAt || Date.parse(quote.lastAt) < requestedAt)) quote.last = price(row.price)
      }
      this.publish()
    } catch { /* A missing last trade must not stop the order-book stream. */ }
  }
  attach(response: ServerResponse) {
    clearTimeout(this.releaseTimer)
    this.listeners.add(response); this.lastUsed = Date.now()
    response.write(`retry: 2500\ndata: ${JSON.stringify(this.snapshot)}\n\n`)
    if (this.listeners.size === 1) {
      this.connect(); void this.loadLastTrades()
      this.refresh = setInterval(() => {
        void this.load(true).catch(error => {
          if (this.snapshot) { this.snapshot.error = `市场资料更新失败：${error.message}`; this.publish() }
        })
      }, 60_000)
    }
    response.on('close', () => {
      this.listeners.delete(response)
      if (!this.listeners.size) {
        clearInterval(this.refresh)
        this.releaseTimer = setTimeout(() => this.disconnect(), 5000)
      }
    })
  }
  publish() {
    if (this.publishTimer || this.stopped) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      const message = `data: ${JSON.stringify(this.snapshot)}\n\n`
      for (const listener of this.listeners) {
        if (listener.destroyed || listener.writableLength > 1024 * 1024) { listener.destroy(); this.listeners.delete(listener) }
        else listener.write(message)
      }
    }, 350)
  }
  connect() {
    if (this.socket || this.stopped || !this.listeners.size || !this.snapshot) return
    clearTimeout(this.reconnect)
    const assets = this.assets()
    if (this.snapshot.closed || !assets.length) { this.snapshot.state = 'closed'; this.publish(); return }
    this.snapshot.state = this.attempts ? 'reconnecting' : 'connecting'
    this.books.clear()
    for (const market of this.snapshot.markets) if (!market.closed) for (const quote of market.outcomes) quote.bookReady = false
    this.publish()
    const socket = new WebSocket(SOCKET); this.socket = socket; this.lastWire = Date.now()
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return
      socket.send(JSON.stringify({assets_ids: assets, type: 'market', custom_feature_enabled: true}))
    })
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastWire > 35_000) { this.fail(socket, '行情连接超时，正在重连'); return }
      if (socket.readyState === WebSocket.OPEN) socket.send('PING')
      for (const response of this.listeners) response.write('event: heartbeat\ndata: {}\n\n')
    }, 10_000)
    socket.addEventListener('message', event => {
      if (socket !== this.socket || !this.snapshot) return
      this.lastWire = Date.now()
      if (event.data === 'PONG') return
      let decoded: unknown
      try { decoded = JSON.parse(String(event.data)) } catch { return }
      for (const value of Array.isArray(decoded) ? decoded : [decoded]) this.apply(record(value))
    })
    socket.addEventListener('error', () => this.fail(socket, '行情连接中断，正在重连'))
    socket.addEventListener('close', () => this.fail(socket, '行情连接中断，正在重连'))
  }
  apply(event: Record<string, unknown>) {
    if (!this.snapshot) return
    const at = timestamp(event.timestamp)
    let changed = false
    if (event.event_type === 'book') {
      const quote = this.quote(event.asset_id)
      if (quote) {
        const book = this.books.get(quote.assetId) || new OrderBook()
        if (book.replace(event.bids, event.asks, at)) { book.write(quote); this.books.set(quote.assetId, book); changed = true }
      }
    } else if (event.event_type === 'price_change' && Array.isArray(event.price_changes)) {
      for (const value of event.price_changes) {
        const change = record(value), quote = this.quote(change.asset_id), book = quote && this.books.get(quote.assetId)
        if (quote && book?.change(change.side, change.price, change.size, at)) { book.write(quote); changed = true }
      }
    } else if (event.event_type === 'last_trade_price') {
      const quote = this.quote(event.asset_id)
      if (quote && (!quote.lastAt || !at || at >= quote.lastAt)) { quote.last = price(event.price); quote.lastAt = at; changed = true }
    } else if (event.event_type === 'market_resolved' || event.event_type === 'new_market') {
      // Do not wait for the next metadata poll after a resolution.
      if (event.event_type === 'market_resolved') for (const market of this.snapshot.markets) {
        if (market.conditionId !== event.market) continue
        market.closed = true
        for (const quote of market.outcomes) { quote.price = event.winning_asset_id === quote.assetId ? 1 : 0; quote.bid = null; quote.ask = null; quote.bids = []; quote.asks = []; quote.bookReady = false }
      }
      changed = true
      void this.load(true).catch(() => {})
    }
    if (changed) {
      this.snapshot.receivedAt = new Date().toISOString()
      this.snapshot.state = this.snapshot.closed ? 'closed' : 'live'; this.snapshot.error = null; this.attempts = 0
      this.publish()
    }
  }
  fail(socket: WebSocket, message: string) {
    if (socket !== this.socket) return
    this.disconnect()
    if (this.snapshot) { this.snapshot.state = 'reconnecting'; this.snapshot.error = message; this.publish() }
    if (this.listeners.size && !this.stopped) this.reconnect = setTimeout(() => this.connect(), Math.min(20_000, 1000 * 2 ** this.attempts++))
  }
  disconnect() {
    clearInterval(this.heartbeat); clearTimeout(this.reconnect)
    const socket = this.socket; this.socket = undefined; socket?.close()
    if (this.snapshot && this.snapshot.state === 'live') this.snapshot.state = 'connecting'
  }
  stop() {
    this.stopped = true; this.disconnect()
    clearInterval(this.refresh); clearTimeout(this.publishTimer); clearTimeout(this.releaseTimer)
    for (const response of this.listeners) response.end()
    this.listeners.clear()
  }
}

export class QuoteService {
  feeds = new Map<string, MarketFeed>()
  historyCache = new Map<string, PriceHistory>()
  feed(tracking: Tracking) {
    for (const [id, feed] of this.feeds) if (!feed.listeners.size && Date.now() - feed.lastUsed > 300_000) { feed.stop(); this.feeds.delete(id) }
    let feed = this.feeds.get(tracking.id)
    if (!feed) { feed = new MarketFeed(tracking); this.feeds.set(tracking.id, feed) }
    return feed
  }
  async history(tracking: Tracking, assetId: string, interval: string): Promise<PriceHistory> {
    const feed = this.feed(tracking), snapshot = await feed.load()
    if (!snapshot.markets.some(m => m.outcomes.some(o => o.assetId === assetId)) || !/^\d+$/.test(assetId)) throw Error('行情资产不属于所选市场')
    if (!['1h', '1d', '1w', 'max'].includes(interval)) throw Error('历史行情周期无效')
    const key = `${assetId}:${interval}`, cached = this.historyCache.get(key)
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30_000) return cached
    const params = new URLSearchParams({token_id: assetId, interval, bucket_seconds: { '1h': '60', '1d': '300', '1w': '1800', max: '10800' }[interval]!})
    const points = []
    for (let page = 0; page < 10; page++) {
      const body = record(await readJSON(`${DATA}/v2/prices-history?${params}`))
      points.push(...normalizeHistory(body.data))
      const pagination = record(body.pagination)
      if (pagination.has_more !== true) break
      if (typeof pagination.next_cursor !== 'string' || page === 9) throw Error('历史行情分页不完整')
      params.set('cursor', pagination.next_cursor)
    }
    const history = {assetId, interval, points: [...new Map(points.map(p => [p.time, p])).values()].sort((a, b) => a.time - b.time), fetchedAt: new Date().toISOString()}
    if (this.historyCache.size >= 100) this.historyCache.delete(this.historyCache.keys().next().value!)
    this.historyCache.set(key, history)
    return history
  }
  stop() { for (const feed of this.feeds.values()) feed.stop() }
}
