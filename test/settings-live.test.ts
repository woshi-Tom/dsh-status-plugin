import { afterEach, describe, expect, it } from 'vitest';
import { Context, type Fiber } from '@deepseek-ai/cordis';
import { SettingsProvider } from '@deepseek-ai/dsh-settings';
import type { IncomingMessage } from 'node:http';
import statusPlugin from '../src/index.js';
import { SETTINGS_NAMESPACE } from '../src/settings.js';
import type { StatusPayload, StatusResponse } from '../src/status.js';

/** In-memory settings provider: one raw document, no files. */
class MemorySettings extends SettingsProvider {
  writable = true;
  private doc: Record<string, unknown> = {};

  protected async load(): Promise<Record<string, unknown>> {
    return this.doc;
  }

  protected async persist(ns: string, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = section;
  }
}

/** A status plugin config with every field set explicitly. */
const DEFAULT_CONFIG = {
  cpuWarning: 0.8,
  memoryWarning: 0.85,
  diskWarning: 0.9,
  eventLoopWarning: 100,
  hysteresis: 0.1,
  heartbeatMs: 30_000,
  checkIntervalMs: 5_000,
  authToken: '',
  allowedOrigins: [],
  exposeLanAddresses: false,
  rateLimitPerMinute: 300,
  maxSubscribers: 32,
  maxBufferedBytes: 65_536,
  webhookUrl: '',
  webhookTimeoutMs: 5_000,
};

/** A fake request passing the (disabled) origin/auth/rate-limit gate. */
function fakeReq(): IncomingMessage {
  return {
    headers: {},
    url: '/api/status',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

/** A fake response capturing the JSON body the handler writes. */
function fakeRes(): StatusResponse & { body: string } {
  let body = '';
  const res = {
    body: '',
    writableLength: 0,
    writeHead() {},
    write(chunk: string): boolean {
      body += chunk;
      return true;
    },
    end(chunk: string) {
      if (chunk !== undefined && chunk !== '') body += chunk;
      res.body = body;
    },
  };
  return res;
}

interface Route {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: StatusResponse) => void;
}

/** Mount the plugin on a fresh context (optionally with a settings provider). */
function setup(withSettings: boolean): { ctx: Context; fiber: Fiber; routes: Route[] } {
  const ctx = new Context();
  const routes: Route[] = [];
  ctx.provide('webServer', {
    host: '127.0.0.1',
    port: 3080,
    register(route: Route) {
      routes.push(route);
      return () => {};
    },
  });
  if (withSettings) new MemorySettings(ctx);
  const fiber = ctx.plugin(statusPlugin, DEFAULT_CONFIG);
  return { ctx, fiber, routes };
}

/** Call the /api/status handler and parse the JSON payload. */
function snapshot(route: Route | undefined): StatusPayload {
  if (route === undefined) throw new Error('route not registered');
  const res = fakeRes();
  route.handler(fakeReq(), res);
  return JSON.parse(res.body) as StatusPayload;
}

/** Wait until the next settings commit is reflected, then read the snapshot. */
async function eventually(route: Route, probe: (payload: StatusPayload) => boolean): Promise<StatusPayload> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const payload = snapshot(route);
    if (probe(payload)) return payload;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('settings change was not applied within the wait budget');
}

describe('live settings (installSettingsSection wiring)', () => {
  const fibers: Fiber[] = [];

  afterEach(async () => {
    await Promise.all(fibers.splice(0).map(fiber => fiber.dispose().catch(() => {})));
  });

  it('serves the /api/status route with entry config defaults', async () => {
    const { fiber, routes } = setup(true);
    fibers.push(fiber);
    await fiber;
    const payload = snapshot(routes.find(route => route.path === '/api/status'));
    expect(payload.ok).toBe(true);
    expect(payload.host.lanAddresses).toEqual([]);
  });

  it('applies an exposeLanAddresses settings update without a restart', async () => {
    const { ctx, fiber, routes } = setup(true);
    fibers.push(fiber);
    await fiber;
    const route = routes.find(candidate => candidate.path === '/api/status');

    // Before: LAN addresses hidden (entry default).
    expect(snapshot(route).host.lanAddresses).toEqual([]);

    // The settings UI's write path: one field update, persisted + committed.
    await ctx.settings.update(SETTINGS_NAMESPACE, { exposeLanAddresses: true });

    const payload = await eventually(route as Route, value => value.host.lanAddresses.length > 0);
    expect(payload.host.lanAddresses.length).toBeGreaterThan(0);

    // Clearing the override falls back to the entry value again.
    await ctx.settings.update(SETTINGS_NAMESPACE, { exposeLanAddresses: false });
    await eventually(route as Route, value => value.host.lanAddresses.length === 0);
  });

  it('keeps working when no settings service exists (entry config only)', async () => {
    const { fiber, routes } = setup(false);
    fibers.push(fiber);
    await fiber;
    const payload = snapshot(routes.find(route => route.path === '/api/status'));
    expect(payload.ok).toBe(true);
    expect(payload.host.lanAddresses).toEqual([]);
  });
});
