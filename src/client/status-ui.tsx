import type { ReactNode } from 'react'
import type { StatusLocaleKey } from './locales.ts'
import { formatPercent, type AlertEvent, type TrendPoint } from './status.ts'
import css from './status.css'

/** Localized message function handed to status surfaces. */
export type T = (key: StatusLocaleKey, params?: Record<string, unknown>) => string

/** One labeled value row in a detail grid. */
export function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className={css.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Section card with a heading and a detail grid. */
export function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className={css.section}>
      <h3>{title}</h3>
      <dl className={css.grid}>{children}</dl>
    </section>
  )
}

/** One overview stat card: label, headline value, and an optional sub-line. */
export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): ReactNode {
  return (
    <div className={css.statCard}>
      <span className={css.statLabel}>{label}</span>
      <strong className={css.statValue}>{value}</strong>
      {sub !== undefined ? <span className={css.statSub}>{sub}</span> : null}
    </div>
  )
}

/** Alert reason in localized copy. */
export function alertReason(t: T, reason: AlertEvent['reason']): string {
  if (reason === 'cpu') return t('alertCpu')
  if (reason === 'memory') return t('alertMemory')
  if (reason === 'disk') return t('alertDisk')
  return t('alertEventLoop')
}

/**
 * Value/threshold text for one alert. CPU, memory and disk are 0..1 fractions
 * shown as percentages; the event-loop delay is a millisecond duration and
 * must not go through `formatPercent` (it would read as an absurd percentage).
 */
export function alertValueText(alert: AlertEvent): { value: string; threshold: string } {
  if (alert.reason === 'eventLoop') {
    return { value: `${alert.value.toFixed(1)} ms`, threshold: `${alert.threshold.toFixed(1)} ms` }
  }
  return { value: formatPercent(alert.value), threshold: formatPercent(alert.threshold) }
}

const DEFAULT_TREND_WIDTH = 300
const DEFAULT_TREND_HEIGHT = 64
const TREND_PAD = 4

/** Mini line chart of CPU and memory fractions over the last snapshots. */
export function TrendChart({ points, t, width = DEFAULT_TREND_WIDTH, height = DEFAULT_TREND_HEIGHT }: {
  points: TrendPoint[]
  t: T
  width?: number
  height?: number
}): ReactNode {
  if (points.length < 2) return <p className={css.trendEmpty}>{t('trendEmpty')}</p>
  const stepX = (width - TREND_PAD * 2) / (points.length - 1)
  const yFor = (value: number): number =>
    height - TREND_PAD - (Math.min(Math.max(value, 0), 100) / 100) * (height - TREND_PAD * 2)
  const path = (pick: (point: TrendPoint) => number): string =>
    points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'}${(TREND_PAD + index * stepX).toFixed(1)},${yFor(pick(point)).toFixed(1)}`,
    ).join(' ')
  return (
    <svg className={css.trend} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('trend')}>
      <line
        x1={TREND_PAD} y1={height - TREND_PAD}
        x2={width - TREND_PAD} y2={height - TREND_PAD}
        className={css.trendAxis}
      />
      <path d={path(point => point.memoryUsed * 100)} className={css.trendMem} fill="none" />
      <path d={path(point => point.cpuPercent)} className={css.trendCpu} fill="none" />
    </svg>
  )
}
