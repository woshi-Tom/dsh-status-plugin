import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { AlertMonitor, type AlertEvent, type AlertReason } from './alerts.js';
import { SseHub } from './sse.js';
import { collectStatus, sendJson, type StatusPayload, type StatusResponse } from './status.js';

/** 1-minute load average at which the host reports an overload alert. */
const DEFAULT_LOAD_WARNING = 2;
/** RSS share of total memory above which the host reports a memory alert. */
const DEFAULT_MEMORY_WARNING = 0.85;
/** Interval between heartbeat snapshot pushes to SSE subscribers. */
const DEFAULT_HEARTBEAT_MS = 30_000;
/** Interval between alert monitor samples. */
const DEFAULT_CHECK_INTERVAL_MS = 5_000;

export interface Config {
  loadWarning: number;
  memoryWarning: number;
  heartbeatMs: number;
  checkIntervalMs: number;
}

export const Config: z<Config> = z.object({
  loadWarning: z.number().min(0).default(DEFAULT_LOAD_WARNING),
  memoryWarning: z.number().min(0).max(1).default(DEFAULT_MEMORY_WARNING),
  heartbeatMs: z.number().min(1_000).default(DEFAULT_HEARTBEAT_MS),
  checkIntervalMs: z.number().min(1_000).default(DEFAULT_CHECK_INTERVAL_MS),
});

export default {
  name: 'status',
  inject: ['webServer'],
  Config,
  apply(ctx: Context, config: Config) {
    const hub = new SseHub();
    const thresholds: Record<AlertReason, number> = {
      load: config.loadWarning,
      memory: config.memoryWarning,
    };
    const monitor = new AlertMonitor(thresholds, (event: AlertEvent) => {
      hub.broadcast('alert', event);
    });

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/status',
      handler: (_req, res) => {
        try {
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
          hub.attach(req, res, collectStatus(ctx), monitor.current());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(`${JSON.stringify({ ok: false, error: message })}\n`);
        }
      },
    }));

    const heartbeat = setInterval(() => {
      hub.broadcast('snapshot', collectStatus(ctx));
    }, config.heartbeatMs);
    const sampler = setInterval(() => {
      monitor.poll();
    }, config.checkIntervalMs);
    ctx.effect(() => {
      return () => {
        clearInterval(heartbeat);
        clearInterval(sampler);
      };
    });
  },
};
