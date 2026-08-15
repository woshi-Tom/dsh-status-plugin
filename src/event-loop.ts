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

/**
 * Mean event-loop delay in milliseconds since the previous call (or module
 * load). A high value means timers and I/O callbacks are being starved — the
 * first symptom of a blocked or overloaded process, which CPU and memory
 * percentages can miss.
 */
export function eventLoopDelayMs(): number {
  if (histogram === null) return 0;
  const mean = histogram.mean;
  histogram.reset();
  return mean;
}
