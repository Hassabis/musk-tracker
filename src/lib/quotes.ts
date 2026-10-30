export type Level = { price: number; size: number }
export type OutcomeQuote = {
  assetId: string; name: string; price: number | null; bid: number | null; ask: number | null;
  last: number | null; lastAt: string | null; updatedAt: string | null;
  bids: Level[]; asks: Level[]; bookReady: boolean;
}
export type MarketQuote = {
  id: string; conditionId: string; label: string; question: string; closed: boolean;
  volume: number | null; volume24h: number | null; outcomes: OutcomeQuote[];
}
export type MarketSnapshot = {
  trackingId: string; title: string; url: string; closed: boolean; endDate: string | null;
  volume: number | null; volume24h: number | null; liquidity: number | null;
  markets: MarketQuote[]; metadataAt: string; receivedAt: string | null;
  state: 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error'; error: string | null;
}
export type PricePoint = { time: number; price: number; resolution: number }
export type PriceHistory = { assetId: string; interval: string; points: PricePoint[]; fetchedAt: string }
