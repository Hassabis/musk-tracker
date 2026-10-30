import type { CSSProperties } from 'react'
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  posts: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  chart: 'M4 3v17h17M8 15v-5M13 15V6M18 15v-8',
  database: 'M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3ZM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  external: 'M14 3h7v7M10 14 21 3M21 14v6H4V3h6',
  refresh: 'M20 7v5h-5M4 17v-5h5M5.1 7a8 8 0 0 1 13.2-2L20 7M4 17l1.7 2A8 8 0 0 0 19 17',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  calendar: 'M4 5h16v16H4zM16 3v4M8 3v4M4 11h16',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  menu: 'M4 6h16M4 12h16M4 18h16',
  activity: 'M2 12h5l3-8 4 16 3-8h5',
}
export function Icon({ name, size = 18, style, className = '' }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style} className={className}><path d={paths[name] || paths.info} /></svg>
}
