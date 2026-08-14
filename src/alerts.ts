import { loadavg, totalmem } from 'node:os';

/** A measurable health indicator of the host process. */
export type AlertReason = 'load' | 'memory';

/** A single alert transition broadcast to subscribers. */
export interface AlertEvent {
  active: boolean;
  reason: AlertReason;
  value: number;
  threshold: number;
}

/**
 * Threshold monitor for host health indicators. Runs a periodic check over
 * load average and memory usage; emits an event only when an indicator
 * crosses its threshold (entering alert) or recovers (leaving alert), never
 * on unchanged state. Thresholds are deployment config, not constants.
 */
export class AlertMonitor {
  private readonly active = new Set<AlertReason>();

  /**
   * Create the monitor.
   * @param thresholds - per-reason thresholds; load is a 1-minute load-average
   * value, memory a fraction of total memory (0..1).
   * @param check - called for every status transition (enter or leave).
   */
  constructor(
    private readonly thresholds: Record<AlertReason, number>,
    private readonly check: (event: AlertEvent) => void,
  ) {}

  /** Sample the current load average and memory usage against the thresholds. */
  poll(): void {
    const load = loadavg()[0] ?? 0;
    const memoryUsed = process.memoryUsage().rss / Math.max(totalmem(), 1);
    this.pollReason('load', load);
    this.pollReason('memory', memoryUsed);
  }

  /** Current threshold-breach events, for synchronizing new SSE subscribers. */
  current(): AlertEvent[] {
    return [...this.active].map(reason => ({
      active: true,
      reason,
      value: reason === 'load' ? (loadavg()[0] ?? 0) : process.memoryUsage().rss / Math.max(totalmem(), 1),
      threshold: this.thresholds[reason],
    }));
  }

  /** Compare one indicator and emit a transition event when its state flips. */
  private pollReason(reason: AlertReason, value: number): void {
    const threshold = this.thresholds[reason];
    const isAlert = value > threshold;
    if (isAlert === this.active.has(reason)) return;
    if (isAlert) this.active.add(reason);
    else this.active.delete(reason);
    this.check({ active: isAlert, reason, value, threshold });
  }
}