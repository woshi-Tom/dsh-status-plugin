import { freemem, totalmem } from 'node:os';
import { cpuUtilization } from './cpu.js';

/** A measurable health indicator of the host. */
export type AlertReason = 'cpu' | 'memory';

/** A single alert transition broadcast to subscribers. */
export interface AlertEvent {
  active: boolean;
  reason: AlertReason;
  value: number;
  threshold: number;
}

/** Per-reason value samplers, injectable for tests. */
export interface AlertSamplers {
  cpu: () => number;
  memory: () => number;
}

/** System memory pressure as a fraction of total memory (0..1). */
export function computeSystemUsage(total: number, free: number): number {
  if (total <= 0) return 0;
  return (total - free) / total;
}

/** Current system memory pressure (0..1), sampled live. */
export function systemMemoryUsage(): number {
  return computeSystemUsage(totalmem(), freemem());
}

/**
 * Threshold monitor for host health indicators. Runs a periodic check over
 * CPU utilization and system memory pressure; emits an event only when an
 * indicator crosses its band (entering alert) or recovers (leaving alert),
 * never on unchanged state. Thresholds are deployment config, not constants.
 * An active alert clears only when the value drops below
 * `threshold * (1 - hysteresis)`, so a value hovering around the threshold
 * does not flap between alert and recovery on consecutive polls.
 */
export class AlertMonitor {
  private readonly active = new Set<AlertReason>();
  private readonly lastValue = new Map<AlertReason, number>();
  private readonly samplers: AlertSamplers;

  /**
   * Create the monitor.
   * @param thresholds - per-reason thresholds as fractions (0..1): `cpu` is
   * the sampled CPU utilization, `memory` the system memory pressure.
   * @param hysteresis - recovery margin as a fraction of the threshold.
   * @param check - called for every status transition (enter or leave).
   * @param samplers - value sources; defaults to live CPU/memory sampling.
   */
  constructor(
    private readonly thresholds: Record<AlertReason, number>,
    private readonly hysteresis: number,
    private readonly check: (event: AlertEvent) => void,
    samplers?: AlertSamplers,
  ) {
    this.samplers = samplers ?? { cpu: () => cpuUtilization() / 100, memory: systemMemoryUsage };
  }

  /** Sample CPU utilization and memory pressure against the thresholds. */
  poll(): void {
    this.pollReason('cpu', this.samplers.cpu());
    this.pollReason('memory', this.samplers.memory());
  }

  /** Current threshold-breach events, for synchronizing new SSE subscribers. */
  current(): AlertEvent[] {
    return [...this.active].map(reason => ({
      active: true,
      reason,
      value: this.lastValue.get(reason) ?? 0,
      threshold: this.thresholds[reason],
    }));
  }

  /** Compare one indicator and emit a transition event when its state flips. */
  private pollReason(reason: AlertReason, value: number): void {
    this.lastValue.set(reason, value);
    const threshold = this.thresholds[reason];
    const wasAlert = this.active.has(reason);
    const isAlert = wasAlert
      ? value >= threshold * (1 - this.hysteresis)
      : value > threshold;
    if (isAlert === wasAlert) return;
    if (isAlert) this.active.add(reason);
    else this.active.delete(reason);
    this.check({ active: isAlert, reason, value, threshold });
  }
}