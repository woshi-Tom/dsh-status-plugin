import { useState, type ReactNode } from 'react'
import { formatBytes, formatPercent, formatUptime, type AlertEvent, type StatusPayload, type TrendPoint } from './status.ts'
import { alertReason, alertValueText, Row, Section, StatCard, TrendChart, type T } from './status-ui.tsx'
import css from './status.css'

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

/** Quick-glance tab: alert status, key resource cards, and the trend chart. */
function OverviewTab({ t, snapshot, trend }: { t: T; snapshot: StatusPayload; trend: TrendPoint[] }): ReactNode {
  const memoryPercent = snapshot.host.systemMemory.used / Math.max(snapshot.host.systemMemory.total, 1)
  return (
    <>
      <div className={css.stats}>
        <StatCard label={t('cpu')} value={`${snapshot.host.cpuPercent.toFixed(1)}%`} />
        <StatCard
          label={t('systemMemory')}
          value={formatPercent(memoryPercent)}
          sub={`${formatBytes(snapshot.host.systemMemory.used)} / ${formatBytes(snapshot.host.systemMemory.total)}`}
        />
        {snapshot.host.disk !== null ? (
          <StatCard
            label={t('disk')}
            value={formatPercent(snapshot.host.disk.percent)}
            sub={`${formatBytes(snapshot.host.disk.used)} / ${formatBytes(snapshot.host.disk.total)}`}
          />
        ) : (
          <StatCard label={t('disk')} value="—" />
        )}
        <StatCard label={t('eventLoop')} value={`${snapshot.host.eventLoopDelayMs.toFixed(1)} ms`} />
      </div>
      <section className={css.section}>
        <h3>{t('trend')}</h3>
        <TrendChart points={trend} t={t} />
      </section>
    </>
  )
}

/** Full-detail tab: process, resources, disk, service, and plugin sections. */
function DetailsTab({ t, snapshot }: { t: T; snapshot: StatusPayload }): ReactNode {
  return (
    <>
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
      {snapshot.host.disk !== null ? (
        <Section title={t('disk')}>
          <Row label={t('diskMount')} value={snapshot.host.disk.mount} />
          <Row label={t('diskUsed')} value={`${formatBytes(snapshot.host.disk.used)} / ${formatBytes(snapshot.host.disk.total)} (${formatPercent(snapshot.host.disk.percent)})`} />
          <Row label={t('diskAvailable')} value={formatBytes(snapshot.host.disk.avail)} />
        </Section>
      ) : null}
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
    </>
  )
}

/** Render the expanded status panel: tabs split the quick glance from the full detail. */
export function StatusPanel({ t, snapshot, alerts, connected, loading, error, trend, onRetry, onClose }: StatusPanelProps): ReactNode {
  const [tab, setTab] = useState<'overview' | 'details'>('overview')
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
          <div className={css.tabs} role="tablist" aria-label={t('status')}>
            <button
              type="button"
              className={css.tab}
              role="tab"
              aria-selected={tab === 'overview'}
              data-active={tab === 'overview' ? 'true' : undefined}
              onClick={() => setTab('overview')}
            >
              {t('overview')}
            </button>
            <button
              type="button"
              className={css.tab}
              role="tab"
              aria-selected={tab === 'details'}
              data-active={tab === 'details' ? 'true' : undefined}
              onClick={() => setTab('details')}
            >
              {t('details')}
            </button>
          </div>
          <p className={css.viewHint}>{t('viewHint')}</p>
          <div className={css.panelBody}>
            {tab === 'overview' ? <OverviewTab t={t} snapshot={snapshot} trend={trend} /> : <DetailsTab t={t} snapshot={snapshot} />}
          </div>
          <footer className={css.panelFooter}>
            <span>{`${t('lastUpdate')} ${new Date(snapshot.timestamp).toLocaleTimeString()}`}</span>
          </footer>
        </>
      ) : null}
    </div>
  )
}
