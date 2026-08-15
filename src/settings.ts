import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';

/**
 * Runtime-tunable subset of the plugin config. These are the fields a user
 * may change from the settings UI without restarting the harness — every
 * other Config field (authToken, allowedOrigins, webhookUrl, capacity caps)
 * stays in cordis.yml, deliberately: secrets and channel endpoints must not
 * be reachable from the browser settings surface.
 */
export interface RuntimeSettings {
  /** CPU utilization fraction (0..1) at which the host reports an overload alert. */
  cpuWarning: number;
  /** System memory pressure fraction (0..1) above which the host reports a memory alert. */
  memoryWarning: number;
  /** Working-disk usage fraction (0..1) above which the host reports a disk alert. */
  diskWarning: number;
  /** Mean event-loop delay (ms) above which the host reports a stall alert. */
  eventLoopWarning: number;
  /** Recovery margin as a fraction of each threshold. */
  hysteresis: number;
  /** Interval between heartbeat snapshot pushes to SSE subscribers. */
  heartbeatMs: number;
  /** Interval between alert monitor samples. */
  checkIntervalMs: number;
  /** Include LAN IPv4 addresses in status snapshots. */
  exposeLanAddresses: boolean;
  /** Per-IP request cap per minute on the HTTP endpoints; 0 disables limiting. */
  rateLimitPerMinute: number;
}

/** Defaults shared by the plugin Config and the runtime settings schema. */
export const RUNTIME_DEFAULTS = {
  cpuWarning: 0.8,
  memoryWarning: 0.85,
  diskWarning: 0.9,
  eventLoopWarning: 100,
  hysteresis: 0.1,
  heartbeatMs: 30_000,
  checkIntervalMs: 5_000,
  exposeLanAddresses: false,
  rateLimitPerMinute: 300,
} as const satisfies Record<keyof RuntimeSettings, number | boolean>;

/**
 * Settings namespace owned by the status plugin. Registered as the `base`
 * layer of the plugin's cordis.yml entry config, with the user's settings
 * document overriding it — the standard optional-settings consumer wiring.
 */
export const SETTINGS_NAMESPACE = settingsNamespace('dsh-status');

/** Schema resolving the runtime settings section (defaults, then entry, then user). */
export const RuntimeSettingsSchema: z<RuntimeSettings> = z.object({
  cpuWarning: z.number().min(0).max(1).default(RUNTIME_DEFAULTS.cpuWarning),
  memoryWarning: z.number().min(0).max(1).default(RUNTIME_DEFAULTS.memoryWarning),
  diskWarning: z.number().min(0).max(1).default(RUNTIME_DEFAULTS.diskWarning),
  eventLoopWarning: z.number().min(0).default(RUNTIME_DEFAULTS.eventLoopWarning),
  hysteresis: z.number().min(0).max(0.5).default(RUNTIME_DEFAULTS.hysteresis),
  heartbeatMs: z.number().min(1_000).default(RUNTIME_DEFAULTS.heartbeatMs),
  checkIntervalMs: z.number().min(1_000).default(RUNTIME_DEFAULTS.checkIntervalMs),
  exposeLanAddresses: z.boolean().default(RUNTIME_DEFAULTS.exposeLanAddresses),
  rateLimitPerMinute: z.natural().default(RUNTIME_DEFAULTS.rateLimitPerMinute),
});
