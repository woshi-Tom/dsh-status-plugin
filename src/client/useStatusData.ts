import { useCallback, useEffect, useState } from 'react'
import type { AlertEvent, StatusEvent, StatusPayload, TrendPoint } from './status.ts'

/** Mark the stream disconnected after this long without any snapshot (3× the default heartbeat). */
export const STALE_AFTER_MS = 90_000
/** How many trend points the panel keeps (30 s heartbeat → 30 min of history). */
export const TREND_POINTS = 60

/** Live status state shared by the header badge and the full-page view. */
export interface StatusData {
  snapshot: StatusPayload | null
  /** The initial fetch failed; a retry is available. */
  error: boolean
  /** null while the first connection is still being established. */
  connected: boolean | null
  /** Active alert transitions keyed by reason. */
  alerts: Partial<Record<AlertEvent['reason'], AlertEvent>>
  /** Rolling CPU/memory trend points from the snapshots received. */
  trend: TrendPoint[]
  /** Re-run the initial fetch after an error. */
  retry: () => void
}

/**
 * Shared data loop for every status surface: one initial fetch, one SSE
 * subscription with exponential-backoff reconnects, a staleness watchdog, and
 * the rolling trend window. The badge and the full-page view both ride this
 * hook so their numbers never diverge.
 * @param fetchStatus - read a fresh snapshot over HTTP.
 * @param subscribe - open the status SSE stream.
 * @param onTransition - optional observer for every alert transition (the
 *   badge fires toasts here; the full-page view passes nothing).
 */
export function useStatusData(
  fetchStatus: () => Promise<StatusPayload>,
  subscribe: (onEvent: (event: StatusEvent) => void, onConnectionChange: (connected: boolean) => void) => () => void,
  onTransition?: (event: AlertEvent) => void,
): StatusData {
  const [snapshot, setSnapshot] = useState<StatusPayload | null>(null)
  const [error, setError] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [alerts, setAlerts] = useState<Partial<Record<AlertEvent['reason'], AlertEvent>>>({})
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
      } else {
        setAlerts(prev => {
          if (!(alert.reason in prev)) return prev
          const next = { ...prev }
          delete next[alert.reason]
          return next
        })
      }
      onTransition?.(alert)
    }, setConnected)
    const staleness = setInterval(() => {
      if (mounted && Date.now() - lastSnapshotAt > STALE_AFTER_MS) setConnected(false)
    }, STALE_AFTER_MS)
    return () => {
      mounted = false
      unsubscribe()
      clearInterval(staleness)
    }
  }, [fetchStatus, onTransition, subscribe])

  const retry = useCallback(() => {
    setError(true)
    void fetchStatus().then(
      (payload) => { setSnapshot(payload); setError(false) },
      () => setError(true),
    )
  }, [fetchStatus])

  return { snapshot, error, connected, alerts, trend, retry }
}
