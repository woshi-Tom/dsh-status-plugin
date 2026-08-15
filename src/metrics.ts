import type { StatusPayload } from './status.js';

/**
 * Render a status snapshot in Prometheus text exposition format so the
 * harness can be scraped by existing monitoring stacks. Only gauges are
 * emitted; the snapshot is point-in-time state, not counters.
 */
export function renderMetrics(payload: StatusPayload): string {
  const lines: string[] = [];
  const gauge = (name: string, help: string, value: number): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
  };

  gauge('dsh_status_up', 'Whether the status endpoint answered', 1);
  gauge('dsh_status_uptime_seconds', 'Process uptime in seconds', payload.host.uptimeSeconds);
  gauge('dsh_status_cpu_percent', 'CPU utilization sampled from os.cpus() deltas', payload.host.cpuPercent);
  gauge('dsh_status_event_loop_delay_ms', 'Mean event-loop delay over the last sampling interval', payload.host.eventLoopDelayMs);
  gauge('dsh_status_loadavg_1', '1-minute load average', payload.host.loadAvg[0] ?? 0);
  gauge('dsh_status_loadavg_5', '5-minute load average', payload.host.loadAvg[1] ?? 0);
  gauge('dsh_status_loadavg_15', '15-minute load average', payload.host.loadAvg[2] ?? 0);
  gauge('dsh_status_process_rss_bytes', 'Process resident set size in bytes', payload.host.memory.rss);
  gauge('dsh_status_process_heap_used_bytes', 'V8 heap used in bytes', payload.host.memory.heapUsed);
  gauge('dsh_status_process_heap_total_bytes', 'V8 heap reserved in bytes', payload.host.memory.heapTotal);
  gauge('dsh_status_system_memory_total_bytes', 'Total system memory in bytes', payload.host.systemMemory.total);
  gauge('dsh_status_system_memory_used_bytes', 'Used system memory in bytes', payload.host.systemMemory.used);
  gauge('dsh_status_system_memory_free_bytes', 'Free system memory in bytes', payload.host.systemMemory.free);
  gauge('dsh_status_api_key_configured', 'Whether a DEEPSEEK_API_KEY is present', payload.apiKey.configured ? 1 : 0);
  gauge('dsh_status_plugins_total', 'Plugins in the loader inventory', payload.plugins.entries.length);
  gauge(
    'dsh_status_plugins_active',
    'Plugins enabled with an active fiber',
    payload.plugins.entries.filter(entry => entry.enabled && entry.fiberPhase === 'active').length,
  );

  return `${lines.join('\n')}\n`;
}
