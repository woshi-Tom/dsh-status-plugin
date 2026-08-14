/** Client-side mirror of the host status payload fields the UI renders. */
export interface StatusPayload {
  timestamp: string;
  host: {
    hostname: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    pid: number;
    cwd: string;
    uptimeSeconds: number;
    loadAvg: number[];
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
    };
    totalMem: number;
  };
  webServer: {
    host: string;
    port: number;
    url: string;
  };
  apiKey: {
    configured: boolean;
    source: 'env' | 'file' | null;
  };
  plugins: {
    entries: Array<{
      entryId: string;
      moduleName: string;
      enabled: boolean;
      fiberPhase: string | null;
    }>;
  };
}

/** One alert transition pushed by the host monitor. */
export interface AlertEvent {
  active: boolean;
  reason: 'load' | 'memory';
  value: number;
  threshold: number;
}

/** Event delivered to UI subscribers over the status SSE stream. */
export type StatusEvent =
  | { type: 'snapshot'; payload: StatusPayload }
  | { type: 'alert'; payload: AlertEvent }

/** Format a byte count as a human-readable binary quantity. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}

/** Format a duration in seconds as "1h 23m" (or "45s" under a minute). */
export function formatUptime(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${Math.max(totalMinutes, 1)}m`
  return `${hours}h ${minutes}m`
}

/** Format a 0..1 ratio as a percentage with one decimal. */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}