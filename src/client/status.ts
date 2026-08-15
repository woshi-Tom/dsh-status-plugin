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
    cpuPercent: number;
    eventLoopDelayMs: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
    };
    systemMemory: {
      total: number;
      free: number;
      used: number;
    };
    disk: {
      mount: string;
      total: number;
      free: number;
      avail: number;
      used: number;
      percent: number;
    } | null;
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
  reason: 'cpu' | 'memory' | 'eventLoop' | 'disk';
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

/** Format a duration in seconds as "1h 23m" ("45s" under a minute). */
export function formatUptime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  if (safe < 60) return `${safe}s`
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

/** One point of the panel trend chart: CPU and memory fractions (0..1). */
export interface TrendPoint {
  cpuPercent: number
  memoryUsed: number
}

/** Format a 0..1 ratio as a percentage with one decimal. */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}