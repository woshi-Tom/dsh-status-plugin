import { cpus, type CpuInfo } from 'node:os';

/** Per-core CPU time counters as reported by `os.cpus()`. */
export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** One CPU snapshot: the times of every core at one instant. */
export type CpuSnapshot = Array<{ times: CpuTimes }>;

/**
 * CPU utilization between two `os.cpus()` snapshots, as a percentage (0..100).
 * Deltas are clamped at zero to survive counter rollover; cores present in
 * only one snapshot are ignored.
 * @param previous - the earlier snapshot.
 * @param current - the later snapshot.
 * @returns the share of non-idle CPU time over the interval.
 */
export function computeCpuPercent(previous: CpuSnapshot, current: CpuSnapshot): number {
  let idleDelta = 0;
  let totalDelta = 0;
  const cores = Math.min(previous.length, current.length);
  for (let index = 0; index < cores; index++) {
    const a = previous[index];
    const b = current[index];
    if (a === undefined || b === undefined) continue;
    const idle = Math.max(0, b.times.idle - a.times.idle);
    const busy =
      Math.max(0, b.times.user - a.times.user) +
      Math.max(0, b.times.sys - a.times.sys) +
      Math.max(0, b.times.nice - a.times.nice) +
      Math.max(0, b.times.irq - a.times.irq);
    idleDelta += idle;
    totalDelta += idle + busy;
  }
  if (totalDelta === 0) return 0;
  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

let previous = cpus();

/**
 * Current CPU utilization since the previous call (or module load), as a
 * percentage (0..100). Sampling cadence is caller-driven: alert polls and
 * status collection both advance the window, so the returned value is the
 * utilization over the elapsed interval.
 */
export function cpuUtilization(): number {
  const current = cpus() satisfies CpuSnapshot;
  const percent = computeCpuPercent(previous, current);
  previous = current;
  return percent;
}