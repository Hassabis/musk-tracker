import type { Tracking } from './types.ts'

export function marketPhase(tracking: Tracking, now = Date.now()) {
  if (Date.parse(tracking.startDate) > now) return 1
  if (Date.parse(tracking.endDate) < now) return 2
  return 0
}

/** Running windows first, nearest close first; upcoming and history follow. */
export function sortMarkets(trackings: Tracking[], now = Date.now()) {
  return [...trackings].sort((a, b) => {
    const phase = marketPhase(a, now)
    const phaseDifference = phase - marketPhase(b, now)
    if (phaseDifference) return phaseDifference
    if (phase === 1) return Date.parse(a.startDate) - Date.parse(b.startDate)
    if (phase === 2) return Date.parse(b.endDate) - Date.parse(a.endDate)
    return Date.parse(a.endDate) - Date.parse(b.endDate)
  })
}
