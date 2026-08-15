import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { StatusPanel } from './StatusPanel.tsx'
import { formatUptime, type AlertEvent, type StatusEvent, type StatusPayload } from './status.ts'
import { useStatusData } from './useStatusData.ts'
import css from './status.css'

/** Registration-side face providing the status data channels. */
export interface StatusBadgeInjected {
  /** Read a fresh status snapshot over HTTP. */
  fetchStatus: () => Promise<StatusPayload>
  /** Subscribe to the status SSE stream; returns an unsubscribe function. */
  subscribe: (
    onEvent: (event: StatusEvent) => void,
    onConnectionChange: (connected: boolean) => void,
    headers?: Record<string, string>,
  ) => () => void
}

/** Full component props assembled by the header slot renderer. */
export type StatusBadgeProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'dsh-status'>
  & InjectFace<StatusBadgeInjected>

/** One transient toast shown on an alert transition. */
type Toast = { kind: 'alert' | 'recovered'; event: AlertEvent }

const TOAST_DISMISS_MS = 6_000

/** Render the compact header status badge and its click-to-open panel. */
export function StatusBadge({ fetchStatus, subscribe, t }: StatusBadgeProps): ReactNode {
  const [toast, setToast] = useState<Toast | null>(null)
  const [open, setOpen] = useState(false)

  // Toasts belong to the badge surface alone: the data loop is shared, the
  // transition observer is not. Stable identity keeps the subscription alive.
  const onTransition = useCallback((event: AlertEvent): void => {
    setToast({ kind: event.active ? 'alert' : 'recovered', event })
  }, [])

  const { snapshot, error, connected, alerts, trend, retry } = useStatusData(fetchStatus, subscribe, onTransition)

  useEffect(() => {
    // Toast auto-dismiss, deliberately separate from the data loop so the
    // timer never resets on snapshot re-renders.
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), TOAST_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const alerting = Object.keys(alerts).length > 0

  const state: 'healthy' | 'alert' | 'disconnected' | 'unknown' =
    connected === null ? 'unknown'
      : !connected ? 'disconnected'
        : alerting ? 'alert'
          : 'healthy'

  const reasonLabel = (reason: AlertEvent['reason']): string =>
    reason === 'cpu' ? t('alertCpu') : reason === 'memory' ? t('alertMemory') : reason === 'disk' ? t('alertDisk') : t('alertEventLoop')

  return (
    <div className={css.badgeRoot}>
      {toast !== null ? (
        <div className={css.toast} data-kind={toast.kind} role="status">
          <strong>{toast.kind === 'alert' ? t('alertActive') : t('alertRecovered')}</strong>
          <span>{reasonLabel(toast.event.reason)}</span>
          <button type="button" className={css.toastClose} aria-label={t('close')} onClick={() => setToast(null)}>×</button>
        </div>
      ) : null}
      <button
        type="button"
        className={css.badge}
        data-state={state}
        data-open={open ? 'true' : undefined}
        aria-expanded={open}
        aria-label={`${t('clickForDetails')}${!connected ? `, ${t('disconnected')}` : alerting ? `, ${t('alerting')}` : ''}`}
        onClick={() => setOpen(current => !current)}
      >
        <span className={css.dot} aria-hidden="true" />
        <span className={css.uptime}>
          {snapshot === null ? '—' : formatUptime(snapshot.host.uptimeSeconds)}
        </span>
        <span className={css.chevron} aria-hidden="true" />
      </button>
      {open ? (
        <StatusPanel
          t={t}
          snapshot={snapshot}
          alerts={alerts}
          connected={connected}
          error={error}
          loading={snapshot === null && !error}
          trend={trend}
          onRetry={retry}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}
