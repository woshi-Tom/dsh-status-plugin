import type { ReactNode } from 'react'
import type { StatusLocaleKey } from './locales.ts'
import { formatBytes, formatPercent, formatUptime, type AlertEvent, type StatusPayload, type TrendPoint } from './status.ts'
import css from './status.css'

/** Localized message function handed to the panel. */
type T = (key: StatusLocaleKey, params?: Record<string, unknown>) => string

/** Panel props: snapshot and alert state with the shell chrome hooks. */
export interface StatusPanelProps {
  t: T
  snapshot: StatusPayload | null
  alerts: Partial<Record<AlertEvent['reason'], AlertEvent>>
  connected: boolean | null
  loading: boolean
  error: boolean
  trend: TrendPoint[]
  onRetry: () => void
  onClose: () => void
}

/** One labeled value row in a detail grid. */
function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className={css.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Section card with a heading and a detail grid. */
function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className={css.section}>
      <h3>{title}</h3>
      <dl className={css.grid}>{children}</dl>
    </section>
  )
}

/** Alert reason in localized copy. */
function alertReason(t: T, reason: AlertEvent['reason']): string {
  if (reason === 'cpu') return t('alertCpu')
  if (reason === 'memory') return t('alertMemory')
  return t('alertEventLoop')
}

/**
 * Value/threshold text for one alert. CPU and memory are 0..1 fractions shown
 * as percentages; the event-loop delay is a millisecond duration and must not
 * go through `formatPercent` (it would read as an absurd percentage).
 */
function alertValueText(alert: AlertEvent): { value: string; threshold: string } {
  if (alert.reason === 'eventLoop') {
    return { value: `${alert.value.toFixed(1)} ms`, threshold: `${alert.threshold.toFixed(1)} ms` }
  }
  return { value: formatPercent(alert.value), threshold: formatPercent(alert.threshold) }
}

const TREND_WIDTH = 300
const TREND_HEIGHT = 64
const TREND_PAD = 4

/** Mini line chart of CPU and memory fractions over the last snapshots. */
function TrendChart({ points, t }: { points: TrendPoint[]; t: T }): ReactNode {
  if (points.length < 2) return <p className={css.trendEmpty}>{t('trendEmpty')}</p>
  const stepX = (TREND_WIDTH - TREND_PAD * 2) / (points.length - 1)
  const yFor = (value: number): number =>
    TREND_HEIGHT - TREND_PAD - (Math.min(Math.max(value, 0), 100) / 100) * (TREND_HEIGHT - TREND_PAD * 2)
  const path = (pick: (point: TrendPoint) => number): string =>
    points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'}${(TREND_PAD + index * stepX).toFixed(1)},${yFor(pick(point)).toFixed(1)}`,
    ).join(' ')
  return (
    <svg className={css.trend} viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`} role="img" aria-label={t('trend')}>
      <line
        x1={TREND_PAD} y1={TREND_HEIGHT - TREND_PAD}
        x2={TREND_WIDTH - TREND_PAD} y2={TREND_HEIGHT - TREND_PAD}
        className={css.trendAxis}
      />
      <path d={path(point => point.memoryUsed * 100)} className={css.trendMem} fill="none" />
      <path d={path(point => point.cpuPercent)} className={css.trendCpu} fill="none" />
    </svg>
  )
}

/** Render the expanded status panel: alerts, process, resources, service, plugins. */
export function StatusPanel({ t, snapshot, alerts, connected, loading, error, trend, onRetry, onClose }: StatusPanelProps): ReactNode {
  const alertList = Object.values(alerts)
  return (
    <div className={css.panel} role="dialog" aria-label={t('clickForDetails')}>
      <header className={css.panelHeader}>
        <strong>{t('status')}</strong>
        <button type="button" className={css.panelClose} aria-label={t('close')} onClick={onClose}>×</button>
      </header>
      {loading ? <p className={css.status}>{t('loading')}</p> : null}
      {connected === false ? <div className={css.failure}><p role="alert">{t('disconnected')}</p></div> : null}
      {error ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={onRetry}>{t('retry')}</button>
        </div>
      ) : null}
      {snapshot !== null ? (
        <>
          {alertList.length > 0 ? (
            <div className={css.alertBanner} data-active>
              <strong>{t('alertActive')}</strong>
              {alertList.map(alert => (
                <p key={alert.reason}>
                  {alertReason(t, alert.reason)}：
                  {t('alertValue', alertValueText(alert))}
                </p>
              ))}
            </div>
          ) : null}
          <Section title={t('process')}>
            <Row label={t('pid')} value={String(snapshot.host.pid)} />
            <Row label={t('hostname')} value={snapshot.host.hostname} />
            <Row label={t('platform')} value={`${snapshot.host.platform} ${snapshot.host.arch}`} />
            <Row label={t('nodeVersion')} value={snapshot.host.nodeVersion} />
            <Row label={t('uptime')} value={formatUptime(snapshot.host.uptimeSeconds)} />
            <Row label={t('cwd')} value={snapshot.host.cwd} />
          </Section>
          <Section title={t('resources')}>
            <Row label={t('cpu')} value={`${snapshot.host.cpuPercent.toFixed(1)}%`} />
            <Row label={t('eventLoop')} value={`${snapshot.host.eventLoopDelayMs.toFixed(1)} ms`} />
            <Row label={t('loadAverage')} value={snapshot.host.loadAvg.map(value => value.toFixed(2)).join(' / ')} />
            <Row label={t('systemMemory')} value={`${formatBytes(snapshot.host.systemMemory.used)} / ${formatBytes(snapshot.host.systemMemory.total)} (${formatPercent(snapshot.host.systemMemory.used / Math.max(snapshot.host.systemMemory.total, 1))})`} />
            <Row label={t('processMemory')} value={formatBytes(snapshot.host.memory.rss)} />
            <Row label={t('heap')} value={`${formatBytes(snapshot.host.memory.heapUsed)} / ${formatBytes(snapshot.host.memory.heapTotal)}`} />
          </Section>
          <section className={css.section}>
            <h3>{t('trend')}</h3>
            <TrendChart points={trend} t={t} />
          </section>
          <Section title={t('service')}>
            <Row label={t('listen')} value={`${snapshot.webServer.host}:${snapshot.webServer.port}`} />
            <Row label={t('apiKey')} value={snapshot.apiKey.configured ? `${t('apiKeyConfigured')} (${snapshot.apiKey.source === 'env' ? t('sourceEnv') : t('sourceFile')})` : t('apiKeyMissing')} />
          </Section>
          <Section title={t('plugins')}>
            <Row
              label={t('pluginCount', { count: String(snapshot.plugins.entries.length) })}
              value={t('pluginActive', { active: String(snapshot.plugins.entries.filter(entry => entry.enabled && entry.fiberPhase === 'active').length) })}
            />
          </Section>
          <footer className={css.panelFooter}>
            <span>{`${t('lastUpdate')} ${new Date(snapshot.timestamp).toLocaleTimeString()}`}</span>
          </footer>
        </>
      ) : null}
    </div>
  )
}
