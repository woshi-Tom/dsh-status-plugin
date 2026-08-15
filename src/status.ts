import { freemem, homedir, hostname, loadavg, networkInterfaces, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { cpuUtilization } from './cpu.js';
import { collectDiskUsage, type DiskUsage } from './disk.js';
import { eventLoopDelayMs } from './event-loop.js';

/** Node process memory snapshot (os-independent subset of process.memoryUsage). */
export interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

/** One entry of the Cordis Loader inventory. */
export interface PluginEntry {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase: 'active' | 'loading' | 'pending' | 'failed' | 'unloading' | null;
}

/** Snapshot of the Loader inventory as served by the plugin-inventory host service. */
export interface PluginInventorySnapshot {
  entries: PluginEntry[];
}

/** Read-only facade over the host plugin-inventory service. */
export interface PluginInventoryService {
  list(): PluginInventorySnapshot;
}

/** Minimal writer surface of the web server response used by route handlers. */
export interface StatusResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
  end(body: string): void;
  writableLength: number;
}

/** Route registration accepted by the webServer service. */
export interface WebRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: StatusResponse) => void | Promise<void>;
}

/** Web server service face used by this plugin. */
export interface WebServerService {
  host: '127.0.0.1' | '0.0.0.0';
  port: number;
  register(route: WebRoute): () => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServerService;
    pluginInventory?: PluginInventoryService;
  }
}

/** Health/status payload served over HTTP and pushed over SSE. */
export interface StatusPayload {
  ok: true;
  timestamp: string;
  host: {
    hostname: string;
    platform: NodeJS.Platform;
    arch: string;
    nodeVersion: string;
    pid: number;
    cwd: string;
    uptimeSeconds: number;
    loadAvg: number[];
    cpuPercent: number;
    eventLoopDelayMs: number;
    memory: MemoryUsage;
    systemMemory: {
      total: number;
      free: number;
      used: number;
    };
    /** Working-disk usage (cwd, temp dir as fallback); `null` when no probe succeeded. */
    disk: DiskUsage | null;
    lanAddresses: string[];
  };
  webServer: {
    host: '127.0.0.1' | '0.0.0.0';
    port: number;
    url: string;
  };
  apiKey: {
    configured: boolean;
    source: 'env' | 'file' | null;
  };
  plugins: PluginInventorySnapshot;
}

/** A lines-without-`export` prefix DEEPSEEK_API_KEY assignment with a non-empty value (quotes count only with content). */
const API_KEY_PATTERN = /^\s*(?:export\s+)?DEEPSEEK_API_KEY=\s*(?:"[^"]+"|'[^']+'|[^\s"']+)/;

/** True when a `.env` line assigns a non-empty DEEPSEEK_API_KEY value. */
export function lineLooksLikeApiKey(line: string): boolean {
  return API_KEY_PATTERN.test(line);
}

/** First candidate file containing a DEEPSEEK_API_KEY assignment, or null. */
function firstApiKeyFile(...candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf8');
      if (content.split(/\r?\n/).some(lineLooksLikeApiKey)) return candidate;
    } catch {
      // unreadable or missing candidate: try the next layer
    }
  }
  return null;
}

/** How long a detected API-key presence stays valid before re-reading disk. */
export const API_KEY_CACHE_TTL_MS = 60_000;

let apiKeyCache: { value: StatusPayload['apiKey']; at: number } | null = null;

/**
 * Resolve whether an API key is configured, honoring the same layers the dsh
 * CLI loads: inherited environment, then `cwd/.env`, then `$DSH_HOME/.env`
 * (the CLI does not read `~/.env`, so neither do we). The result is cached
 * for a short TTL because every status snapshot used to synchronously re-read
 * up to three files on the event loop.
 */
export function detectApiKey(now: number = Date.now()): StatusPayload['apiKey'] {
  if (apiKeyCache !== null && now - apiKeyCache.at < API_KEY_CACHE_TTL_MS) {
    return apiKeyCache.value;
  }
  const value = detectApiKeyUncached();
  apiKeyCache = { value, at: now };
  return value;
}

/** Un-cached presence probe; exported for tests. */
export function detectApiKeyUncached(): StatusPayload['apiKey'] {
  if (process.env.DEEPSEEK_API_KEY) return { configured: true, source: 'env' };
  const home = homedir();
  const cwd = process.cwd();
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh');
  const source = firstApiKeyFile(join(cwd, '.env'), join(dshHome, '.env'));
  return source ? { configured: true, source: 'file' } : { configured: false, source: null };
}

/** Clear the cached API-key presence (tests). */
export function resetApiKeyCache(): void {
  apiKeyCache = null;
}

/** All non-internal IPv4 addresses of this host. */
export function collectLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  return addresses;
}

/**
 * Collect a fresh status snapshot from the live context.
 * @param ctx - the plugin context.
 * @param exposeLanAddresses - when false, `host.lanAddresses` is `[]` so the
 *   endpoint never discloses internal network topology.
 */
export function collectStatus(ctx: Context, exposeLanAddresses = true): StatusPayload {
  const memory = process.memoryUsage();
  const webServer = ctx.webServer;
  const inventory = (ctx.reflect.get('pluginInventory', false) as PluginInventoryService | undefined)?.list?.() ?? { entries: [] };
  const total = totalmem();
  const free = freemem();
  return {
    ok: true,
    timestamp: new Date().toISOString(),
    host: {
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
      cwd: process.cwd(),
      uptimeSeconds: Math.round(process.uptime()),
      loadAvg: loadavg(),
      cpuPercent: cpuUtilization(),
      eventLoopDelayMs: eventLoopDelayMs(),
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
      },
      systemMemory: { total, free, used: total - free },
      disk: collectDiskUsage([process.cwd(), tmpdir()]),
      lanAddresses: exposeLanAddresses ? collectLanAddresses() : [],
    },
    webServer: {
      host: webServer.host,
      port: webServer.port,
      url: webServer.host === '0.0.0.0' ? `http://localhost:${webServer.port}` : `http://${webServer.host}:${webServer.port}`,
    },
    apiKey: detectApiKey(),
    plugins: inventory,
  };
}

/** Serialize a payload with no-store semantics and a trailing newline. */
export function sendJson(res: StatusResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}