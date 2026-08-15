/**
 * Client mirror of the host's `dsh-status` settings namespace — the
 * runtime-tunable subset of the plugin config a user may change from the
 * settings page without restarting the harness. The wire validates against
 * the host's serialized schema; this mirror types the fields the form edits.
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
