import { statfsSync, type StatsFs } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * Working-disk usage snapshot. Scope is deliberately the working disk only:
 * the filesystem the harness actually runs on, so a full disk that would
 * break the harness is what gets reported — not the full mount table (which
 * would leak internal topology, the same privacy concern `exposeLanAddresses`
 * addresses).
 */
export interface DiskUsage {
  /** Mount point (or path) the probe was taken on. */
  mount: string;
  /** Total capacity in bytes. */
  total: number;
  /** Free bytes as reported to the superuser (`bfree`). */
  free: number;
  /** Bytes available to unprivileged users (`bavail`; excludes reserved blocks). */
  avail: number;
  /** Consumed bytes (`total - free`). */
  used: number;
  /** Usage fraction 0..1, df-style: `used / (used + avail)`. */
  percent: number;
}

/**
 * Turn one `statfs` result into a {@link DiskUsage}. The percent follows the
 * convention users see from `df`: consumed bytes over consumed-plus-available
 * bytes, so reserved blocks (e.g. the 5% ext4 keeps for root) do not make an
 * almost-empty filesystem read as fuller than it is.
 */
export function computeDiskUsage(mount: string, stat: StatsFs): DiskUsage {
  const total = stat.blocks * stat.bsize;
  const free = stat.bfree * stat.bsize;
  const avail = stat.bavail * stat.bsize;
  const used = total - free;
  const denominator = used + avail;
  const percent = denominator > 0 ? used / denominator : 0;
  return { mount, total, free, avail, used, percent };
}

/**
 * Probe disk usage for the first readable target. Returns `null` only when
 * every target fails (removed mount, permission denied, …) — a missing disk
 * snapshot must never take down the status endpoint or the alert monitor.
 */
export function collectDiskUsage(targets: string[]): DiskUsage | null {
  for (const target of targets) {
    try {
      return computeDiskUsage(target, statfsSync(target));
    } catch {
      // unreadable or missing target: try the next candidate
    }
  }
  return null;
}

/** Probe targets for the working disk: the process cwd, then the OS temp dir. */
export function workingDiskTargets(): string[] {
  return [process.cwd(), tmpdir()];
}
