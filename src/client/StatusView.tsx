import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatBytes, formatPercent, formatUptime, type StatusEvent, type StatusPayload } from './status.ts'
import { alertReason, alertValueText, Row, Section, StatCard, TrendChart } from './status-ui.tsx'
import { useStatusData } from './useStatusData.ts'
import css from './status.css'

/** Registration-side face: the same status data channels the badge rides. */
export interface StatusViewInjected {
  /** Read a fresh status snapshot over HTTP. */
  fetchStatus: () => Promise<StatusPayload>
  /** Subscribe to the status SSE stream; returns an unsubscribe function. */
  subscribe: (
    onEvent: (event: StatusEvent) => void,
    onConnectionChange: (connected: boolean) => void,
    headers?: Record<string, string>,
  ) => () => void
}

/** Full component props assembled by the conversation-view slot renderer. */
export type StatusViewProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'dsh-status'>
  & InjectFace<StatusViewInjected>

/** The full-page status view: the whole conversation pane expands to the monitor. */
export function StatusView({ fetchStatus, subscribe, t }: StatusViewProps): ReactNode {
  const { snapshot, error, connected, alerts, trend, retry } = useStatusData(fetchStatus, subscribe)
  const alertList = Object.values(alerts)
  return (
    <section className={css.view} aria-label={t('status')}>
      <header className={css.viewHeader}>
        <strong>{t('status')}</strong>
        {connected === false ? <span className={css.viewState} data-state="disconnected">{t('disconnected')}</span> : null}
      </header>
      {snapshot === null && !error ? <p className={css.status}>{t('loading')}</p> : null}
      {error ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
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
          <div className={css.viewStats}>
            <StatCard label={t('cpu')} value={`${snapshot.host.cpuPercent.toFixed(1)}%`} />
            <StatCard
              label={t('systemMemory')}
              value={formatPercent(snapshot.host.systemMemory.used / Math.max(snapshot.host.systemMemory.total, 1))}
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
            <TrendChart points={trend} t={t} width={720} height={160} />
          </section>
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
          <footer className={css.viewFooter}>
            <span>{`${t('lastUpdate')} ${new Date(snapshot.timestamp).toLocaleTimeString()}`}</span>
          </footer>
        </>
      ) : null}
    </section>
  )
}
