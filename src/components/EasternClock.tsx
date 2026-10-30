import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

const timeZone = 'America/New_York'

export function EasternClock() {
  const { t, locale } = useI18n()
  const [now, setNow] = useState(Date.now)
  const formats = useMemo(() => ({
    date: new Intl.DateTimeFormat(locale, { timeZone, month: '2-digit', day: '2-digit' }),
    time: new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
  }), [locale])

  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return <span className="clock-zone" title={t('美东时间 ET')}>
    <Icon name="clock" size={14} />
    <span className="clock-label">{t('美东时间')}</span>
    <time dateTime={new Date(now).toISOString()}>
      <span className="clock-date">{formats.date.format(now)}</span>
      <span className="clock-value">{formats.time.format(now)}</span>
    </time>
    <span className="clock-abbreviation">ET</span>
  </span>
}
