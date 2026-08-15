import { describe, expect, it } from 'vitest';
import { renderMetrics } from '../src/metrics.js';
import type { StatusPayload } from '../src/status.js';

const payload: StatusPayload = {
  ok: true,
  timestamp: '2026-08-14T00:00:00.000Z',
  host: {
    hostname: 'host', platform: 'linux', arch: 'x64', nodeVersion: 'v22.0.0',
    pid: 1, cwd: '/tmp', uptimeSeconds: 3600, loadAvg: [0.5, 0.25, 0.1], cpuPercent: 12.4,
    eventLoopDelayMs: 2.3,
    memory: { rss: 1000, heapTotal: 2000, heapUsed: 1500, external: 10 },
    systemMemory: { total: 16_000, free: 4_000, used: 12_000 },
    disk: { mount: '/', total: 1_000_000, free: 600_000, avail: 550_000, used: 400_000, percent: 0.42 },
    lanAddresses: [],
  },
  webServer: { host: '127.0.0.1', port: 1, url: 'http://127.0.0.1:1' },
  apiKey: { configured: true, source: 'env' },
  plugins: { entries: [
    { entryId: 'a', moduleName: 'm', enabled: true, fiberPhase: 'active' },
    { entryId: 'b', moduleName: 'm2', enabled: true, fiberPhase: 'loading' },
  ] },
};

describe('renderMetrics', () => {
  it('emits prometheus gauge lines with HELP and TYPE', () => {
    const text = renderMetrics(payload);
    expect(text).toContain('# HELP dsh_status_cpu_percent');
    expect(text).toContain('# TYPE dsh_status_cpu_percent gauge');
    expect(text).toContain('dsh_status_cpu_percent 12.4');
  });

  it('emits the new event-loop and load metrics', () => {
    const text = renderMetrics(payload);
    expect(text).toContain('dsh_status_event_loop_delay_ms 2.3');
    expect(text).toContain('dsh_status_loadavg_1 0.5');
    expect(text).toContain('dsh_status_loadavg_5 0.25');
    expect(text).toContain('dsh_status_loadavg_15 0.1');
  });

  it('emits api key and plugin inventory metrics', () => {
    const text = renderMetrics(payload);
    expect(text).toContain('dsh_status_api_key_configured 1');
    expect(text).toContain('dsh_status_plugins_total 2');
    expect(text).toContain('dsh_status_plugins_active 1');
  });

  it('emits working-disk gauges labeled by mount point', () => {
    const text = renderMetrics(payload);
    expect(text).toContain('dsh_status_disk_total_bytes{mount="/"} 1000000');
    expect(text).toContain('dsh_status_disk_free_bytes{mount="/"} 600000');
    expect(text).toContain('dsh_status_disk_avail_bytes{mount="/"} 550000');
    expect(text).toContain('dsh_status_disk_used_bytes{mount="/"} 400000');
    expect(text).toContain('dsh_status_disk_percent{mount="/"} 0.42');
  });

  it('omits disk gauges when no disk probe succeeded', () => {
    const noDisk = structuredClone(payload) as StatusPayload;
    noDisk.host.disk = null;
    const text = renderMetrics(noDisk);
    expect(text).not.toContain('dsh_status_disk_');
  });

  it('escapes quotes and backslashes in mount labels', () => {
    const weird = structuredClone(payload) as StatusPayload;
    weird.host.disk = { mount: '/a"b\\c', total: 1, free: 0, avail: 0, used: 1, percent: 1 };
    const text = renderMetrics(weird);
    expect(text).toContain('dsh_status_disk_total_bytes{mount="/a\\"b\\\\c"} 1');
  });

  it('never emits a NaN value', () => {
    const broken = structuredClone(payload) as StatusPayload;
    broken.host.cpuPercent = Number.NaN;
    broken.host.loadAvg = [Number.NaN, Number.NaN, Number.NaN];
    broken.host.disk = { mount: '/', total: Number.NaN, free: Number.NaN, avail: Number.NaN, used: Number.NaN, percent: Number.NaN };
    const text = renderMetrics(broken);
    expect(text).not.toContain('NaN');
  });

  it('ends with a trailing newline', () => {
    expect(renderMetrics(payload).endsWith('\n')).toBe(true);
  });
});
