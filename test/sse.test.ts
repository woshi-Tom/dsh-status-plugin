import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { SseHub } from '../src/sse.js';
import type { StatusPayload, StatusResponse } from '../src/status.js';

/** Minimal status snapshot satisfying the hub's payload type. */
const payload: StatusPayload = {
  ok: true,
  timestamp: '2026-08-14T00:00:00.000Z',
  host: {
    hostname: 'host', platform: 'linux', arch: 'x64', nodeVersion: 'v22.0.0',
    pid: 1, cwd: '/tmp', uptimeSeconds: 0, loadAvg: [0, 0, 0], cpuPercent: 0,
    memory: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1 },
    systemMemory: { total: 8, free: 4, used: 4 },
    disk: null,
    lanAddresses: [],
  },
  webServer: { host: '127.0.0.1', port: 1, url: 'http://127.0.0.1:1' },
  apiKey: { configured: false, source: '' },
  plugins: { entries: [] },
};

interface FakeRes extends StatusResponse {
  chunks: string[];
  ended: boolean;
}

/** A fake response recording writes and end calls. */
function fakeRes(writeReturns: boolean, writableLength = 0): FakeRes {
  const chunks: string[] = [];
  return {
    chunks,
    ended: false,
    writableLength,
    writeHead() {},
    write(chunk: string): boolean {
      chunks.push(chunk);
      return writeReturns;
    },
    end(body: string) {
      this.ended = true;
      if (body !== undefined && body !== '') chunks.push(body);
    },
  };
}

/** A fake request that can be closed to simulate client disconnect. */
function fakeReq(): IncomingMessage & EventEmitter {
  return new EventEmitter() as IncomingMessage & EventEmitter;
}

describe('SseHub', () => {
  it('accepts a subscriber and emits the initial snapshot and alerts', () => {
    const hub = new SseHub();
    const req = fakeReq();
    const res = fakeRes(true);
    hub.attach(req, res, payload, [{ active: true, reason: 'cpu', value: 0.9, threshold: 0.8 }]);
    expect(hub.size).toBe(1);
    expect(res.chunks[0]).toContain('event: snapshot');
    expect(res.chunks[1]).toContain('event: alert');
  });

  it('broadcasts to every subscriber', () => {
    const hub = new SseHub();
    const resA = fakeRes(true);
    const resB = fakeRes(true);
    hub.attach(fakeReq(), resA, payload, []);
    hub.attach(fakeReq(), resB, payload, []);
    hub.broadcast('snapshot', { ok: true });
    expect(resA.chunks).toHaveLength(2);
    expect(resB.chunks).toHaveLength(2);
  });

  it('removes a subscriber when its request closes', () => {
    const hub = new SseHub();
    const req = fakeReq();
    hub.attach(req, fakeRes(true), payload, []);
    expect(hub.size).toBe(1);
    req.emit('close');
    expect(hub.size).toBe(0);
  });

  it('rejects a new subscriber once the cap is reached', () => {
    const hub = new SseHub(1);
    hub.attach(fakeReq(), fakeRes(true), payload, []);
    expect(() => hub.attach(fakeReq(), fakeRes(true), payload, []))
      .toThrow('max SSE subscribers reached (1)');
  });

  it('drops a subscriber whose write buffer exceeds the high-water mark', () => {
    const hub = new SseHub(32, 1024);
    const res = fakeRes(true);
    hub.attach(fakeReq(), res, payload, []);
    expect(hub.size).toBe(1);
    // Fill the buffer only after attach, whose initial frames would otherwise
    // drop the subscriber before this assertion runs.
    res.writableLength = 4096;
    res.write = (() => false) as unknown as typeof res.write;
    hub.broadcast('snapshot', { ok: true });
    expect(hub.size).toBe(0);
  });

  it('keeps a subscriber whose buffer is below the high-water mark', () => {
    const hub = new SseHub(32, 1024);
    const res = fakeRes(false, 512);
    hub.attach(fakeReq(), res, payload, []);
    hub.broadcast('snapshot', { ok: true });
    expect(hub.size).toBe(1);
  });

  it('drops a subscriber on a throwing write', () => {
    const hub = new SseHub();
    const res = fakeRes(true);
    hub.attach(fakeReq(), res, payload, []);
    expect(hub.size).toBe(1);
    res.write = (() => { throw new Error('socket gone'); }) as unknown as typeof res.write;
    hub.broadcast('snapshot', { ok: true });
    expect(hub.size).toBe(0);
  });

  it('dispose closes and removes every subscriber', () => {
    const hub = new SseHub();
    const resA = fakeRes(true);
    const resB = fakeRes(true);
    hub.attach(fakeReq(), resA, payload, []);
    hub.attach(fakeReq(), resB, payload, []);
    hub.dispose();
    expect(hub.size).toBe(0);
    expect(resA.ended).toBe(true);
    expect(resB.ended).toBe(true);
  });
});