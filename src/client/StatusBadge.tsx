import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { StatusPanel } from './StatusPanel.tsx'
import { formatUptime, type AlertEvent, type StatusEvent, type StatusPayload, type TrendPoint } from './status.ts'
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
/** Mark the stream disconnected after this long without any snapshot (3× the default heartbeat). */
const STALE_AFTER_MS = 90_000
/** How many trend points the panel keeps (30 s heartbeat → 30 min of history). */
const TREND_POINTS = 60

/** Render the compact header status badge and its click-to-open panel. */
export function StatusBadge({ fetchStatus, subscribe, t }: StatusBadgeProps): ReactNode {
  const [snapshot, setSnapshot] = useState<StatusPayload | null>(null)
  const [error, setError] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [alerts, setAlerts] = useState<Partial<Record<AlertEvent['reason'], AlertEvent>>>({})
  const [toast, setToast] = useState<Toast | null>(null)
  const [open, setOpen] = useState(false)
  const [trend, setTrend] = useState<TrendPoint[]>([])

  useEffect(() => {
    let mounted = true
    let lastSnapshotAt = Date.now()
    const record = (payload: StatusPayload): void => {
      setSnapshot(payload)
      setError(false)
      lastSnapshotAt = Date.now()
      const total = Math.max(payload.host.systemMemory.total, 1)
      setTrend(prev => [...prev.slice(-(TREND_POINTS - 1)), {
        cpuPercent: payload.host.cpuPercent,
        memoryUsed: payload.host.systemMemory.used / total,
      }])
    }
    void fetchStatus().then(
      (payload) => { if (mounted) { record(payload); setConnected(true) } },
      () => { if (mounted) setError(true) },
    )
    const unsubscribe = subscribe((event) => {
      if (!mounted) return
      if (event.type === 'snapshot') {
        record(event.payload)
        setConnected(true)
        return
      }
      const alert = event.payload
      if (alert.active) {
        setAlerts(prev => ({ ...prev, [alert.reason]: alert }))
        setToast({ kind: 'alert', event: alert })
      } else {
        setAlerts(prev => {
          if (!(alert.reason in prev)) return prev
          const next = { ...prev }
          delete next[alert.reason]
          return next
        })
        setToast({ kind: 'recovered', event: alert })
      }
    }, setConnected)
    const staleness = setInterval(() => {
      if (mounted && Date.now() - lastSnapshotAt > STALE_AFTER_MS) setConnected(false)
    }, STALE_AFTER_MS)
    return () => {
      mounted = false
      unsubscribe()
      clearInterval(staleness)
    }
  }, [fetchStatus, subscribe])

  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), TOAST_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const alerting = Object.keys(alerts).length > 0
  const retry = useCallback(() => {
    setError(true)
    void fetchStatus().then(
      (payload) => { setSnapshot(payload); setError(false) },
      () => setError(true),
    )
  }, [fetchStatus])

  const state: 'healthy' | 'alert' | 'disconnected' | 'unknown' =
    connected === null ? 'unknown'
      : !connected ? 'disconnected'
        : alerting ? 'alert'
          : 'healthy'

  return (
    <div className={css.badgeRoot}>
      {toast !== null ? (
        <div className={css.toast} data-kind={toast.kind} role="status">
          <strong>{toast.kind === 'alert' ? t('alertActive') : t('alertRecovered')}</strong>
          <span>{toast.event.reason === 'cpu' ? t('alertCpu') : toast.event.reason === 'memory' ? t('alertMemory') : t('alertEventLoop')}</span>
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
