import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import { installSettingsSection } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { AlertMonitor, type AlertEvent, type AlertReason } from './alerts.js';
import { isAuthorized, isOriginAllowed } from './auth.js';
import { renderMetrics } from './metrics.js';
import { RateLimiter } from './rate-limit.js';
import { RUNTIME_DEFAULTS, RuntimeSettingsSchema, SETTINGS_NAMESPACE, type RuntimeSettings } from './settings.js';
import { SseHub, DEFAULT_MAX_SUBSCRIBERS, DEFAULT_MAX_BUFFERED_BYTES } from './sse.js';
import { collectStatus, sendJson, type StatusResponse } from './status.js';
import { postWebhook, type WebhookPayload } from './webhook.js';

export interface Config {
  cpuWarning: number;
  memoryWarning: number;
  diskWarning: number;
  eventLoopWarning: number;
  hysteresis: number;
  heartbeatMs: number;
  checkIntervalMs: number;
  /** Optional bearer token required by both endpoints; empty disables authentication. */
  authToken: string;
  /** Exact origins allowed to call the endpoints; empty disables origin checks. */
  allowedOrigins: string[];
  /** Include LAN IPv4 addresses in status snapshots (default hides them). */
  exposeLanAddresses: boolean;
  /** Per-IP request cap per minute on the HTTP endpoints; 0 disables limiting. */
  rateLimitPerMinute: number;
  /** Greatest number of concurrent SSE streams accepted. */
  maxSubscribers: number;
  /** Per-stream write-buffer cap (bytes) before a slow subscriber is dropped. */
  maxBufferedBytes: number;
  /** Optional webhook URL notified on every alert transition; empty disables. */
  webhookUrl: string;
  /** Webhook request timeout in milliseconds. */
  webhookTimeoutMs: number;
}

export const Config: z<Config> = z.object({
  cpuWarning: z.number().min(0).max(1).default(RUNTIME_DEFAULTS.cpuWarning),
  memoryWarning: z.number().min(0).max(1).default(RUNTIME_DEFAULTS.memoryWarning),
  diskWarning: z.number().min(0).max(1).default(RUNTIME_DEFAULTS.diskWarning),
  eventLoopWarning: z.number().min(0).default(RUNTIME_DEFAULTS.eventLoopWarning),
  hysteresis: z.number().min(0).max(0.5).default(RUNTIME_DEFAULTS.hysteresis),
  heartbeatMs: z.number().min(1_000).default(RUNTIME_DEFAULTS.heartbeatMs),
  checkIntervalMs: z.number().min(1_000).default(RUNTIME_DEFAULTS.checkIntervalMs),
  authToken: z.string().default(''),
  allowedOrigins: z.array(z.string()).default([]),
  exposeLanAddresses: z.boolean().default(RUNTIME_DEFAULTS.exposeLanAddresses),
  rateLimitPerMinute: z.natural().default(RUNTIME_DEFAULTS.rateLimitPerMinute),
  maxSubscribers: z.natural().min(1).default(DEFAULT_MAX_SUBSCRIBERS),
  maxBufferedBytes: z.natural().min(1_024).default(DEFAULT_MAX_BUFFERED_BYTES),
  webhookUrl: z.string().default(''),
  webhookTimeoutMs: z.natural().min(100).max(60_000).default(5_000),
});

/** The runtime-tunable subset of a resolved plugin config. */
function pickRuntime(config: Config): RuntimeSettings {
  return {
    cpuWarning: config.cpuWarning,
    memoryWarning: config.memoryWarning,
    diskWarning: config.diskWarning,
    eventLoopWarning: config.eventLoopWarning,
    hysteresis: config.hysteresis,
    heartbeatMs: config.heartbeatMs,
    checkIntervalMs: config.checkIntervalMs,
    exposeLanAddresses: config.exposeLanAddresses,
    rateLimitPerMinute: config.rateLimitPerMinute,
  };
}

/** Per-reason alert thresholds derived from the runtime settings. */
function thresholdsOf(runtime: RuntimeSettings): Record<AlertReason, number> {
  return {
    cpu: runtime.cpuWarning,
    memory: runtime.memoryWarning,
    disk: runtime.diskWarning,
    eventLoop: runtime.eventLoopWarning,
  };
}

export default {
  name: 'status',
  inject: ['webServer'],
  Config,
  apply(ctx: Context, config: Config) {
    const hub = new SseHub(config.maxSubscribers, config.maxBufferedBytes);
    const limiter = new RateLimiter(config.rateLimitPerMinute);
    const monitor = new AlertMonitor(thresholdsOf(pickRuntime(config)), config.hysteresis, (event: AlertEvent) => {
      hub.broadcast('alert', event);
      if (config.webhookUrl !== '') {
        const payload: WebhookPayload = {
          event: 'alert',
          active: event.active,
          reason: event.reason,
          value: event.value,
          threshold: event.threshold,
          timestamp: new Date().toISOString(),
          hostname: hostname(),
          pid: process.pid,
        };
        void postWebhook(config.webhookUrl, payload, config.webhookTimeoutMs).then(ok => {
          if (!ok) ctx.logger.warn('status: webhook delivery failed');
        });
      }
    });

    /**
     * Live config source: the resolved settings namespace while a settings
     * service is attached, the cordis.yml entry otherwise. `getRuntime` is the
     * thunk `installSettingsSection` points at the authoritative source (the
     * resolved scope re-reads on every call, so a settings-page write is
     * visible at the next refresh without a restart).
     */
    const entry = pickRuntime(config);
    let getRuntime: () => RuntimeSettings = () => entry;
    let runtime: RuntimeSettings = entry;

    /** The monitor must never take down the harness it watches: timer bodies are isolated and logged. */
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let sampler: ReturnType<typeof setInterval> | null = null;
    const armTimers = (): void => {
      if (heartbeat !== null) clearInterval(heartbeat);
      if (sampler !== null) clearInterval(sampler);
      heartbeat = setInterval(() => {
        try {
          hub.broadcast('snapshot', collectStatus(ctx, runtime.exposeLanAddresses));
        } catch (error) {
          ctx.logger.warn('status: snapshot collection failed: %s', error instanceof Error ? error.message : String(error));
        }
      }, runtime.heartbeatMs);
      sampler = setInterval(() => {
        try {
          monitor.poll();
        } catch (error) {
          ctx.logger.warn('status: alert sampling failed: %s', error instanceof Error ? error.message : String(error));
        }
      }, runtime.checkIntervalMs);
    };

    /** Re-apply every runtime-tunable value after a settings change. */
    const refresh = (): void => {
      runtime = getRuntime();
      monitor.updateThresholds(thresholdsOf(runtime), runtime.hysteresis);
      limiter.setCapacity(runtime.rateLimitPerMinute);
      armTimers();
    };

    // Canonical optional-settings wiring: register the runtime subset as the
    // `dsh-status` namespace with the entry config as the base layer; the
    // source thunk follows the resolved scope while attached and falls back
    // to the entry when no settings service exists.
    installSettingsSection(ctx, SETTINGS_NAMESPACE, RuntimeSettingsSchema, entry, {
      setSource: (current) => { getRuntime = current; },
      onChange: refresh,
    });
    refresh();

    /** Shared gate: origin policy, then auth, then per-IP rate limit. */
    const guard = (req: IncomingMessage): 0 | 401 | 403 | 429 => {
      if (!isOriginAllowed(req, config.allowedOrigins)) return 403;
      if (!isAuthorized(req, config.authToken)) return 401;
      const ip = req.socket.remoteAddress ?? 'unknown';
      if (!limiter.allow(ip)) return 429;
      return 0;
    };

    /** Respond 500 with a sanitized body; the real error stays in the log. */
    const fail = (res: StatusResponse, error: unknown): void => {
      ctx.logger.warn('status: handler failed: %s', error instanceof Error ? error.message : String(error));
      sendJson(res, 500, { ok: false, error: 'internal error' });
    };

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/status',
      handler: (req, res) => {
        try {
          const status = guard(req);
          if (status !== 0) {
            sendJson(res, status, { ok: false, error: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'rate limited' });
            return;
          }
          sendJson(res, 200, collectStatus(ctx, runtime.exposeLanAddresses));
        } catch (error) {
          fail(res, error);
        }
      },
    }));

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/status/metrics',
      handler: (req, res) => {
        try {
          const status = guard(req);
          if (status !== 0) {
            sendJson(res, status, { ok: false, error: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'rate limited' });
            return;
          }
          res.writeHead(200, {
            'content-type': 'text/plain; version=0.0.4; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(renderMetrics(collectStatus(ctx, runtime.exposeLanAddresses)));
        } catch (error) {
          fail(res, error);
        }
      },
    }));

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/status/events',
      handler: (req: IncomingMessage, res: StatusResponse) => {
        try {
          const status = guard(req);
          if (status !== 0) {
            sendJson(res, status, { ok: false, error: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'rate limited' });
            return;
          }
          hub.attach(req, res, collectStatus(ctx, runtime.exposeLanAddresses), monitor.current());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.logger.warn('status: SSE attach failed: %s', message);
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(`${JSON.stringify({ ok: false, error: 'internal error' })}\n`);
        }
      },
    }));

    ctx.effect(() => {
      return () => {
        if (heartbeat !== null) clearInterval(heartbeat);
        if (sampler !== null) clearInterval(sampler);
        hub.dispose();
        limiter.dispose();
      };
    });
  },
};
