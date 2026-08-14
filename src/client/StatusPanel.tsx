import type { ReactNode } from 'react'
import type { StatusLocaleKey } from './locales.ts'
import { formatBytes, formatPercent, formatUptime, type AlertEvent, type StatusPayload } from './status.ts'
import css from './status.css'

/** Localized message function handed to the panel. */
type T = (key: StatusLocaleKey, params?: Record<string, unknown>) => string

/** Panel props: snapshot and alert state with the shell chrome hooks. */
export interface StatusPanelProps {
  t: T
  snapshot: StatusPayload | null
  alerts: Partial<Record<AlertEvent['reason'], AlertEvent>>
  loading: boolean
  error: boolean
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

/** Render the expanded status panel: alerts, process, resources, service, plugins. */
export function StatusPanel({ t, snapshot, alerts, loading, error, onRetry, onClose }: StatusPanelProps): ReactNode {
  const alertList = Object.values(alerts)
  return (
    <div className={css.panel} role="dialog" aria-label={t('clickForDetails')}>
      <header className={css.panelHeader}>
        <strong>{t('status')}</strong>
        <button type="button" className={css.panelClose} aria-label={t('close')} onClick={onClose}>×</button>
      </header>
      {loading ? <p className={css.status}>{t('loading')}</p> : null}
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
                  {alert.reason === 'load' ? t('alertLoad') : t('alertMemory')}：
                  {t('alertValue', { value: alert.reason === 'load' ? alert.value.toFixed(2) : formatPercent(alert.value), threshold: alert.reason === 'load' ? alert.threshold.toFixed(2) : formatPercent(alert.threshold) })}
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
            <Row label={t('loadAverage')} value={snapshot.host.loadAvg.map(value => value.toFixed(2)).join(' / ')} />
            <Row label={t('memory')} value={`${formatBytes(snapshot.host.memory.rss)} / ${formatBytes(snapshot.host.totalMem)} (${formatPercent(snapshot.host.memory.rss / Math.max(snapshot.host.totalMem, 1))})`} />
            <Row label={t('heap')} value={`${formatBytes(snapshot.host.memory.heapUsed)} / ${formatBytes(snapshot.host.memory.heapTotal)}`} />
          </Section>
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