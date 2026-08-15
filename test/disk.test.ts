import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsFs } from 'node:fs';
import { collectDiskUsage, computeDiskUsage, workingDiskTargets } from '../src/disk.js';

// Mock only statfsSync so collectDiskUsage fallback behavior is testable
// without touching a real filesystem.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, statfsSync: vi.fn() };
});

import { statfsSync } from 'node:fs';

const mockedStatfs = vi.mocked(statfsSync);

/** A realistic ext4-like stat: 1000 blocks × 4096, 5% reserved for root. */
function stat(blocks = 1000, bfree = 950, bavail = 900): StatsFs {
  return { bsize: 4096, blocks, bfree, bavail, files: 0, ffree: 0, type: 0xef53 } as StatsFs;
}

beforeEach(() => {
  mockedStatfs.mockReset();
});

describe('computeDiskUsage', () => {
  it('computes byte totals from blocks and block size', () => {
    const usage = computeDiskUsage('/mnt/data', stat());
    expect(usage.mount).toBe('/mnt/data');
    expect(usage.total).toBe(1000 * 4096);
    expect(usage.free).toBe(950 * 4096);
    expect(usage.avail).toBe(900 * 4096);
    expect(usage.used).toBe(50 * 4096);
  });

  it('uses the df-style percent: used / (used + avail)', () => {
    // 50 blocks consumed, 900 available to the user → 50 / 950.
    expect(computeDiskUsage('/', stat()).percent).toBeCloseTo(50 / 950, 6);
  });

  it('reports 100% when nothing is available to users', () => {
    expect(computeDiskUsage('/', stat(1000, 0, 0)).percent).toBe(1);
  });

  it('reports 0 when nothing is used and nothing is available', () => {
    expect(computeDiskUsage('/', stat(0, 0, 0)).percent).toBe(0);
  });
});

describe('collectDiskUsage', () => {
  it('returns the first target that probes successfully', () => {
    mockedStatfs.mockImplementationOnce(() => stat(100, 90, 80)).mockImplementationOnce(() => stat());
    const usage = collectDiskUsage(['/first', '/second']);
    expect(usage?.mount).toBe('/first');
    expect(mockedStatfs).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next target when the first probe fails', () => {
    mockedStatfs.mockImplementationOnce(() => { throw new Error('no such file'); }).mockImplementationOnce(() => stat());
    const usage = collectDiskUsage(['/missing', '/ok']);
    expect(usage?.mount).toBe('/ok');
    expect(mockedStatfs).toHaveBeenCalledTimes(2);
  });

  it('returns null when every target fails', () => {
    mockedStatfs.mockImplementation(() => { throw new Error('permission denied'); });
    expect(collectDiskUsage(['/a', '/b', '/c'])).toBeNull();
    expect(mockedStatfs).toHaveBeenCalledTimes(3);
  });
});

describe('workingDiskTargets', () => {
  it('probes the working directory first, then the temp dir', () => {
    expect(workingDiskTargets()[0]).toBe(process.cwd());
    expect(workingDiskTargets().length).toBeGreaterThanOrEqual(2);
  });
});
