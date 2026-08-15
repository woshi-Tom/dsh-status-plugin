import { readFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { cpuUtilization } from './cpu.js';
import { collectDiskUsage, workingDiskTargets } from './disk.js';
import { eventLoopDelayMs } from './event-loop.js';

/** A measurable health indicator of the host. */
export type AlertReason = 'cpu' | 'memory' | 'eventLoop' | 'disk';

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
  eventLoop: () => number;
  /** Working-disk usage fraction, or `null` when no disk probe succeeded. */
  disk: () => number | null;
}

/** System memory pressure as a fraction of total memory (0..1). */
export function computeSystemUsage(total: number, free: number): number {
  if (total <= 0) return 0;
  return (total - free) / total;
}

/**
 * Currently available memory as a fraction (0..1) of total memory. On Linux
 * the `MemAvailable` counter from `/proc/meminfo` is used because `freemem()`
 * reports only pages not in use by processes — Linux reclaims page cache under
 * pressure, so a raw `freemem()`-based pressure figure is chronically
 * over-reported. Elsewhere it falls back to `freemem()`.
 */
export function systemMemoryUsage(): number {
  const total = totalmem();
  if (total <= 0) return 0;
  let available = freemem();
  if (process.platform === 'linux') {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf8');
      const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
      if (match?.[1] !== undefined) available = Number(match[1]) * 1024;
    } catch {
      // fall through to freemem()
    }
  }
  return computeSystemUsage(total, available);
}

/**
 * Threshold monitor for host health indicators. Runs a periodic check over
 * CPU utilization, system memory pressure, and event-loop delay; emits an
 * event only when an indicator crosses its band (entering alert) or recovers
 * (leaving alert), never on unchanged state. Thresholds are deployment
 * config, not constants. An active alert clears only when the value drops
 * below `threshold * (1 - hysteresis)`, so a value hovering around the
 * threshold does not flap between alert and recovery on consecutive polls.
 */
export class AlertMonitor {
  private readonly active = new Set<AlertReason>();
  private readonly lastValue = new Map<AlertReason, number>();
  private readonly samplers: AlertSamplers;
  private thresholds: Record<AlertReason, number>;
  private hysteresis: number;

  /**
   * Create the monitor.
   * @param thresholds - per-reason thresholds: `cpu` is the sampled CPU
   *   utilization (fraction 0..1), `memory` the system memory pressure
   *   (fraction 0..1), `eventLoop` the mean event-loop delay in milliseconds,
   *   `disk` the working-disk usage fraction (fraction 0..1).
   * @param hysteresis - recovery margin as a fraction of the threshold.
   * @param check - called for every status transition (enter or leave).
   * @param samplers - value sources; defaults to live sampling.
   */
  constructor(
    thresholds: Record<AlertReason, number>,
    hysteresis: number,
    private readonly check: (event: AlertEvent) => void,
    samplers?: AlertSamplers,
  ) {
    this.thresholds = thresholds;
    this.hysteresis = hysteresis;
    this.samplers = samplers ?? {
      cpu: () => cpuUtilization() / 100,
      memory: systemMemoryUsage,
      eventLoop: eventLoopDelayMs,
      disk: () => collectDiskUsage(workingDiskTargets())?.percent ?? null,
    };
  }

  /**
   * Replace thresholds and the recovery margin at runtime (settings UI).
   * Active alerts keep their state; recovery is re-judged against the new
   * band on the next poll, so lowering a threshold re-alerts promptly and
   * raising one lets an active alert recover on schedule.
   */
  updateThresholds(thresholds: Record<AlertReason, number>, hysteresis: number): void {
    this.thresholds = thresholds;
    this.hysteresis = hysteresis;
  }

  /** Sample every indicator against its threshold. */
  poll(): void {
    this.pollReason('cpu', this.samplers.cpu());
    this.pollReason('memory', this.samplers.memory());
    this.pollReason('eventLoop', this.samplers.eventLoop());
    const disk = this.samplers.disk();
    if (disk !== null) this.pollReason('disk', disk);
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
