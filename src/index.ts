import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { AlertMonitor, type AlertEvent, type AlertReason } from './alerts.js';
import { isAuthorized } from './auth.js';
import { SseHub, DEFAULT_MAX_SUBSCRIBERS, DEFAULT_MAX_BUFFERED_BYTES } from './sse.js';
import { collectStatus, sendJson, type StatusPayload, type StatusResponse } from './status.js';

/** CPU utilization fraction (0..1) at which the host reports an overload alert. */
const DEFAULT_CPU_WARNING = 0.8;
/** System memory pressure fraction (0..1) above which the host reports a memory alert. */
const DEFAULT_MEMORY_WARNING = 0.85;
/** Recovery margin as a fraction of each threshold: an alert clears below `threshold * (1 - hysteresis)`. */
const DEFAULT_HYSTERESIS = 0.1;
/** Interval between heartbeat snapshot pushes to SSE subscribers. */
const DEFAULT_HEARTBEAT_MS = 30_000;
/** Interval between alert monitor samples. */
const DEFAULT_CHECK_INTERVAL_MS = 5_000;

export interface Config {
  cpuWarning: number;
  memoryWarning: number;
  hysteresis: number;
  heartbeatMs: number;
  checkIntervalMs: number;
  /** Optional bearer token required by both endpoints; empty disables authentication. */
  authToken: string;
  /** Greatest number of concurrent SSE streams accepted. */
  maxSubscribers: number;
  /** Per-stream write-buffer cap (bytes) before a slow subscriber is dropped. */
  maxBufferedBytes: number;
}

export const Config: z<Config> = z.object({
  cpuWarning: z.number().min(0).max(1).default(DEFAULT_CPU_WARNING),
  memoryWarning: z.number().min(0).max(1).default(DEFAULT_MEMORY_WARNING),
  hysteresis: z.number().min(0).max(0.5).default(DEFAULT_HYSTERESIS),
  heartbeatMs: z.number().min(1_000).default(DEFAULT_HEARTBEAT_MS),
  checkIntervalMs: z.number().min(1_000).default(DEFAULT_CHECK_INTERVAL_MS),
  authToken: z.string().default(''),
  maxSubscribers: z.natural().min(1).default(DEFAULT_MAX_SUBSCRIBERS),
  maxBufferedBytes: z.natural().min(1_024).default(DEFAULT_MAX_BUFFERED_BYTES),
});

export default {
  name: 'status',
  inject: ['webServer'],
  Config,
  apply(ctx: Context, config: Config) {
    const hub = new SseHub(config.maxSubscribers, config.maxBufferedBytes);
    const thresholds: Record<AlertReason, number> = {
      cpu: config.cpuWarning,
      memory: config.memoryWarning,
    };
    const monitor = new AlertMonitor(thresholds, config.hysteresis, (event: AlertEvent) => {
      hub.broadcast('alert', event);
    });

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/status',
      handler: (req, res) => {
        try {
          if (!isAuthorized(req, config.authToken)) {
            sendJson(res, 401, { ok: false, error: 'unauthorized' });
            return;
          }
          sendJson(res, 200, collectStatus(ctx));
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    }));

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/status/events',
      handler: (req: IncomingMessage, res: StatusResponse) => {
        try {
          if (!isAuthorized(req, config.authToken)) {
            sendJson(res, 401, { ok: false, error: 'unauthorized' });
            return;
          }
          hub.attach(req, res, collectStatus(ctx), monitor.current());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(`${JSON.stringify({ ok: false, error: message })}\n`);
        }
      },
    }));

    // The monitor must not be able to take down the harness it watches: a
    // throwing collection inside a timer callback becomes an uncaughtException
    // and crashes the process, so every timer body is isolated and logged.
    const heartbeat = setInterval(() => {
      try {
        hub.broadcast('snapshot', collectStatus(ctx));
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
      };
    });
  },
};