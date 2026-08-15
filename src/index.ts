import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { AlertMonitor, type AlertEvent, type AlertReason } from './alerts.js';
import { isAuthorized, isOriginAllowed } from './auth.js';
import { renderMetrics } from './metrics.js';
import { RateLimiter } from './rate-limit.js';
import { SseHub, DEFAULT_MAX_SUBSCRIBERS, DEFAULT_MAX_BUFFERED_BYTES } from './sse.js';
import { collectStatus, sendJson, type StatusResponse } from './status.js';
import { postWebhook, type WebhookPayload } from './webhook.js';

/** CPU utilization fraction (0..1) at which the host reports an overload alert. */
const DEFAULT_CPU_WARNING = 0.8;
/** System memory pressure fraction (0..1) above which the host reports a memory alert. */
const DEFAULT_MEMORY_WARNING = 0.85;
/** Mean event-loop delay (ms) above which the host reports a stall alert. */
const DEFAULT_EVENT_LOOP_WARNING = 100;
/** Recovery margin as a fraction of each threshold: an alert clears below `threshold * (1 - hysteresis)`. */
const DEFAULT_HYSTERESIS = 0.1;
/** Interval between heartbeat snapshot pushes to SSE subscribers. */
const DEFAULT_HEARTBEAT_MS = 30_000;
/** Interval between alert monitor samples. */
const DEFAULT_CHECK_INTERVAL_MS = 5_000;
/** Per-IP request cap per minute on the HTTP endpoints; 0 disables limiting. */
const DEFAULT_RATE_LIMIT_PER_MINUTE = 300;

export interface Config {
  cpuWarning: number;
  memoryWarning: number;
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
  cpuWarning: z.number().min(0).max(1).default(DEFAULT_CPU_WARNING),
  memoryWarning: z.number().min(0).max(1).default(DEFAULT_MEMORY_WARNING),
  eventLoopWarning: z.number().min(0).default(DEFAULT_EVENT_LOOP_WARNING),
  hysteresis: z.number().min(0).max(0.5).default(DEFAULT_HYSTERESIS),
  heartbeatMs: z.number().min(1_000).default(DEFAULT_HEARTBEAT_MS),
  checkIntervalMs: z.number().min(1_000).default(DEFAULT_CHECK_INTERVAL_MS),
  authToken: z.string().default(''),
  allowedOrigins: z.array(z.string()).default([]),
  exposeLanAddresses: z.boolean().default(false),
  rateLimitPerMinute: z.natural().default(DEFAULT_RATE_LIMIT_PER_MINUTE),
  maxSubscribers: z.natural().min(1).default(DEFAULT_MAX_SUBSCRIBERS),
  maxBufferedBytes: z.natural().min(1_024).default(DEFAULT_MAX_BUFFERED_BYTES),
  webhookUrl: z.string().default(''),
  webhookTimeoutMs: z.natural().min(100).max(60_000).default(5_000),
});

export default {
  name: 'status',
  inject: ['webServer'],
  Config,
  apply(ctx: Context, config: Config) {
    const hub = new SseHub(config.maxSubscribers, config.maxBufferedBytes);
    const limiter = new RateLimiter(config.rateLimitPerMinute);
    const thresholds: Record<AlertReason, number> = {
      cpu: config.cpuWarning,
      memory: config.memoryWarning,
      eventLoop: config.eventLoopWarning,
    };
    const monitor = new AlertMonitor(thresholds, config.hysteresis, (event: AlertEvent) => {
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
          sendJson(res, 200, collectStatus(ctx, config.exposeLanAddresses));
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
          res.end(renderMetrics(collectStatus(ctx, config.exposeLanAddresses)));
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
          hub.attach(req, res, collectStatus(ctx, config.exposeLanAddresses), monitor.current());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.logger.warn('status: SSE attach failed: %s', message);
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(`${JSON.stringify({ ok: false, error: 'internal error' })}\n`);
        }
      },
    }));

    // The monitor must not be able to take down the harness it watches: a
    // throwing collection inside a timer callback becomes an uncaughtException
    // and crashes the process, so every timer body is isolated and logged.
    const heartbeat = setInterval(() => {
      try {
        hub.broadcast('snapshot', collectStatus(ctx, config.exposeLanAddresses));
      } catch (error) {
        ctx.logger.warn('status: snapshot collection failed: %s', error instanceof Error ? error.message : String(error));
      }
    }, config.heartbeatMs);
    const sampler = setInterval(() => {
      try {
        monitor.poll();
      } catch (error) {
        ctx.logger.warn('status: alert sampling failed: %s', error instanceof Error ? error.message : String(error));
      }
    }, config.checkIntervalMs);
    ctx.effect(() => {
      return () => {
        clearInterval(heartbeat);
        clearInterval(sampler);
        hub.dispose();
        limiter.dispose();
      };
    });
  },
};
