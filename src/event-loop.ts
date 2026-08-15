import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Event-loop delay histogram. `monitorEventLoopDelay` is not guaranteed on
 * every platform, so creation is guarded and callers get 0 when unavailable.
 */
let histogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
try {
  histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
} catch {
  histogram = null;
}

/** Nanoseconds in one millisecond — the histogram reports delays in ns. */
const NS_PER_MS = 1e6;

/**
 * Length of one sampling window in milliseconds. The histogram accumulates
 * samples for a full window and is then reset once, so every caller inside the
 * same window reads the same mean. Resetting per read would let the status
 * snapshot and the alert monitor steal each other's samples and hand each
 * other an empty histogram (a `NaN` mean) right after a reset.
 */
const WINDOW_MS = 5_000;

let windowStart = Date.now();
let lastMeanMs = 0;

/**
 * Mean event-loop delay in milliseconds over the current sampling window. A
 * high value means timers and I/O callbacks are being starved — the first
 * symptom of a blocked or overloaded process, which CPU and memory
 * percentages can miss.
 *
 * The mean is recomputed once per window (on the first call after the window
 * elapses) and then cached, so every reader in the same window agrees on the
 * measurement. An empty histogram reads as 0.
 */
export function eventLoopDelayMs(): number {
  if (histogram === null) return 0;
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    const meanNs = histogram.mean;
    histogram.reset();
    windowStart = now;
    lastMeanMs = Number.isFinite(meanNs) ? meanNs / NS_PER_MS : 0;
  }
  return lastMeanMs;
}
