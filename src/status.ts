import { homedir, hostname, loadavg, networkInterfaces, totalmem } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';

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
    memory: MemoryUsage;
    totalMem: number;
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

/** A single lines-without-`export` prefix DEEPSEEK_API_KEY assignment. */
const API_KEY_PATTERN = /^\s*(?:export\s+)?DEEPSEEK_API_KEY=.+/;

/** First candidate file containing a DEEPSEEK_API_KEY assignment, or null. */
function firstApiKeyFile(...candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf8');
      if (content.split(/\r?\n/).some((line) => API_KEY_PATTERN.test(line))) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/** Resolve whether an API key is configured, honoring cwd > home > DSH_HOME precedence. */
export function detectApiKey(): StatusPayload['apiKey'] {
  if (process.env.DEEPSEEK_API_KEY) return { configured: true, source: 'env' };
  const home = homedir();
  const cwd = process.cwd();
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh');
  const source = firstApiKeyFile(join(cwd, '.env'), join(home, '.env'), join(dshHome, '.env'));
  return source ? { configured: true, source: 'file' } : { configured: false, source: null };
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

/** Collect a fresh status snapshot from the live context. */
export function collectStatus(ctx: Context): StatusPayload {
  const memory = process.memoryUsage();
  const webServer = ctx.webServer;
  const inventory = (ctx.reflect.get('pluginInventory', false) as PluginInventoryService | undefined)?.list?.() ?? { entries: [] };
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
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
      },
      totalMem: totalmem(),
      lanAddresses: collectLanAddresses(),
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