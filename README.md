# dsh-status-plugin

English | [中文](README.zh.md)

A status plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). Two planes in one package:

- **Host plane** — HTTP endpoints exposing the running harness's runtime health as JSON: process, listener, API-key presence, memory, uptime, and the live plugin inventory.
- **Client plane** — a header badge in the web UI (top-right of a conversation session) that shows uptime, opens a detail panel, and raises toasts when the host reports overload or memory-pressure alerts.

- **Package**: `dsh-status-plugin`
- **Runtime**: host (ESM) + browser bundle (a CJS factory wrapped for the dsh client-modules `__ModuleLoader__` contract), built with `tsc` + esbuild to `lib/`.
- **Language**: TypeScript.

## Install

```sh
dsh plugin --profile web add dsh-status-plugin
```

The CLI reconciles `dsh.profile.bundles` automatically: because the manifest declares `dsh.bundle.patch`, the package joins the profile's bundle layer stack. Stop the running process and restart the profile to load it:

```sh
dsh web   # or: dsh --profile <name>
```

Verify the plugin joined the composed tree without booting:

```sh
dsh --profile web --dump-config
```

The client manifest (`package.json` → `dsh.client`) declares the browser entry; the profile's client-modules scanner picks it up and injects `dsh-status-plugin/client.js` into the web app automatically — no bundle or overlay configuration needed.

## Usage

<img width="2560" height="1313" alt="abcddf52074cd98f465253a6619de744" src="https://github.com/user-attachments/assets/c6c6e322-4a11-425d-9682-6b5f48f05b7a" />

<img width="422" height="600" alt="image" src="https://github.com/user-attachments/assets/17b45005-adce-43be-9577-56c973351b78" /> <img width="399" height="710" alt="image" src="https://github.com/user-attachments/assets/3d2d3b23-220a-4bbb-afe9-a2e2fcd00696" />



The plugin registers three exact routes on the profile's web server:

```
GET /api/status          # JSON snapshot on demand
GET /api/status/metrics  # Prometheus text exposition format
GET /api/status/events   # Server-Sent Events stream
```

### `GET /api/status`

Example response:

```json
{
  "ok": true,
  "timestamp": "2026-08-14T03:50:00.000Z",
  "host": {
    "hostname": "host",
    "platform": "linux",
    "arch": "x64",
    "nodeVersion": "v22.23.2",
    "pid": 23185,
    "cwd": "/root/.dsh",
    "uptimeSeconds": 3600,
    "loadAvg": [0.1, 0.1, 0.1],
    "cpuPercent": 12.4,
    "eventLoopDelayMs": 2.3,
    "memory": { "rss": 123456, "heapTotal": 654321, "heapUsed": 432100, "external": 12345 },
    "systemMemory": { "total": 17179869184, "free": 4294967296, "used": 12884901888 },
    "lanAddresses": ["192.168.5.227"]
  },
  "webServer": {
    "host": "0.0.0.0",
    "port": 3080,
    "url": "http://localhost:3080"
  },
  "apiKey": {
    "configured": true,
    "source": "env"
  },
  "plugins": {
    "entries": [
      { "entryId": "llm", "moduleName": "@deepseek-ai/dsh-llm", "enabled": true, "fiberPhase": "active" }
    ]
  }
}
```

### Fields

| Field | Source |
|---|---|
| `host.*` | `process` + `node:os` (pid, uptime, process memory, LAN IPv4 addresses); `cpuPercent` is CPU utilization sampled from `os.cpus()` deltas and works on every platform; `eventLoopDelayMs` is the mean event-loop delay (`perf_hooks`) since the last sample; `loadAvg` is the Unix load average — always `[0, 0, 0]` on Windows; `systemMemory.*` is machine-wide memory (`os.totalmem()` − `os.freemem()`) |
| `webServer.*` | `ctx.webServer` (bind host and actual listening port) |
| `apiKey` | `DEEPSEEK_API_KEY` in `process.env`, else the working directory `.env` or `$DSH_HOME/.env` (the exact layers the dsh CLI loads — `~/.env` is deliberately **not** checked) — **presence only, never the value**; an empty assignment (`` DEEPSEEK_API_KEY="" ``) does not count as configured |
| `plugins.entries` | `ctx.pluginInventory.list()` (live Cordis Loader entry state) |

The API key check reports only whether a key is configured and where it was found; the value itself never leaves the process. The check result is cached for 60 s, so snapshots do not re-read `.env` files on the event loop.

> **Privacy note (0.2.1+):** `host.lanAddresses` is `[]` by default. Set `exposeLanAddresses: true` if you need the LAN IPv4 addresses in the payload.

### `GET /api/status/events` (SSE)

The host pushes to open browser streams — the server decides when the page needs new state, so idle pages make zero requests:

- **`snapshot`** — a full status snapshot, emitted immediately on connect and then every `heartbeatMs` (default 30 s). Each snapshot card dissects to `cpuPercent`, `eventLoopDelayMs`, `loadAvg`, `systemMemory`, and process-memory fields inside `host.*` for alert-driven UIs.
- **`alert`** — emitted when an indicator enters or leaves its alert band. Entering requires `value > threshold`; an active alert only clears when the value drops below `threshold × (1 − hysteresis)`, so a value hovering near the threshold does not flap. Reasons: `cpu`, `memory` (Linux memory pressure uses `/proc/meminfo` `MemAvailable`, not raw `freemem()` — page cache no longer causes false alarms), and `eventLoop` (mean event-loop delay in ms). Events are emitted on every transition and **re-synchronized on connect** so a page that opens mid-alert still learns about it:

```
event: snapshot
data: {"ok":true,"timestamp":"...","host":{...},"plugins":{...}}

event: alert
data: {"active":true,"reason":"cpu","value":0.87,"threshold":0.8}
```

Default thresholds (configurable via the plugin config in the profile's cordis.yml):

| Config | Default | Meaning |
|---|---|---|
| `cpuWarning` | `0.8` | CPU utilization above which a CPU overload alert fires |
| `memoryWarning` | `0.85` | system memory pressure above which a memory alert fires |
| `eventLoopWarning` | `100` | mean event-loop delay (ms) above which a stall alert fires |
| `hysteresis` | `0.1` | recovery margin: an alert clears only below `threshold × (1 − hysteresis)` |
| `heartbeatMs` | `30000` | snapshot push interval |
| `checkIntervalMs` | `5000` | alert monitor sampling interval |
| `authToken` | `''` | shared secret required on all three routes; empty disables auth. See [Authentication](#authentication) |
| `allowedOrigins` | `[]` | exact `Origin` values allowed to call the routes; empty disables origin checks. See [Authentication](#authentication) |
| `exposeLanAddresses` | `false` | include `host.lanAddresses` in snapshots (off by default for privacy) |
| `rateLimitPerMinute` | `300` | per-IP request cap per minute across all routes; `0` disables |
| `maxSubscribers` | `32` | SSE subscriber cap; new connections over the cap fail with an error response |
| `maxBufferedBytes` | `65536` | per-subscriber write-buffer high-water mark; a slow consumer over it is dropped |
| `webhookUrl` | `''` | webhook URL notified on every alert transition; empty disables. See [Webhook notifications](#webhook-notifications) |
| `webhookTimeoutMs` | `5000` | webhook request timeout in milliseconds |

### Authentication

When `authToken` is set, all three routes require it. The token can travel in either channel:

- `GET /api/status` and `GET /api/status/metrics` — `Authorization: Bearer <token>` header, or `?token=<token>`.
- `GET /api/status/events` — `?token=<token>` query parameter, or the `Authorization` header when the client uses the fetch-stream subscriber (see below); a native `EventSource` cannot set custom headers.

A rejected request answers `401` with `{ "ok": false, "error": "unauthorized" }`. Comparison is constant-time (`crypto.timingSafeEqual`), so a wrong token does not leak its length. Because the query parameter can appear in logs and history, prefer header auth and keep the SSE stream on a loopback-only webserver.

**Origin policy.** Set `allowedOrigins` to a list of exact origins (e.g. `["https://dsh.example.com"]`) to reject cross-origin browser reads when the web server is reachable beyond loopback. Requests without an `Origin` header (curl, servers, same-origin navigation) always pass. An empty list (the default) accepts every origin.

**Rate limiting.** Every route is limited to `rateLimitPerMinute` requests per client IP (default 300, `0` disables). Exceeding the cap answers `429` with `{ "ok": false, "error": "rate limited" }`.

**Header-auth SSE client.** The bundled badge has no channel to receive the host's token, so enabling `authToken` disables the badge's status views. Custom UIs can subscribe with the exported `createSseClient(url, headers, onEvent, onConnectionChange)` — pass `{ Authorization: 'Bearer <token>' }` and get header-authenticated SSE with automatic exponential-backoff reconnects.

The browser side subscribes through a `fetch`-based SSE reader (auto-reconnects with exponential backoff, honoring the server's `retry:` frame when present) and renders:

- a compact badge in the conversation header (status dot + uptime, click to open);
- a detail panel with process/resource/service/plugin sections, an event-loop row, a CPU/memory trend chart over the last 60 snapshots, and the last update time;
- a toast on every alert transition (auto-dismisses after 6 s) plus a pulsing badge while an alert is active;
- a gray badge dot when the stream is disconnected or no snapshot arrived for 90 s — a monitoring widget must say *unknown*, not *healthy*, when it loses contact. The dot is also gray while the first connection is still being established, so the badge never claims health before it has data.

### Webhook notifications

Set `webhookUrl` to receive a JSON POST on every alert transition (enter and recover). The payload:

```json
{
  "event": "alert",
  "active": true,
  "reason": "cpu",
  "value": 0.87,
  "threshold": 0.8,
  "timestamp": "2026-08-14T03:50:00.000Z",
  "hostname": "host",
  "pid": 23185
}
```

Delivery is fire-and-forget: a failed or timed-out request is logged and never disturbs the alert pipeline, so the harness keeps monitoring even when the notification channel is down. Wire it to any webhook-capable service (Slack, DingTalk, 企业微信, ntfy, …).

### Prometheus metrics

`GET /api/status/metrics` serves the snapshot in Prometheus text exposition format (`text/plain; version=0.0.4`) for scraping by existing monitoring stacks:

```
dsh_status_up 1
dsh_status_uptime_seconds 3600
dsh_status_cpu_percent 12.4
dsh_status_event_loop_delay_ms 2.3
dsh_status_loadavg_1 0.5
dsh_status_process_rss_bytes 123456
dsh_status_system_memory_used_bytes 12884901888
dsh_status_api_key_configured 1
dsh_status_plugins_total 42
dsh_status_plugins_active 40
```

The endpoint honors `authToken`, `allowedOrigins`, and `rateLimitPerMinute` exactly like the other routes.

### Failure behavior

- A collection error inside a handler returns `500` with `{ "ok": false, "error": "internal error" }` — sanitized, no internals or stack leaked; the real message goes to the host log.
- `pluginInventory` is optional: when the service is absent, `plugins.entries` is `[]` rather than an error.
- Response handlers and both periodic timers (heartbeat and alert sampler) are exception-isolated: a throwing collection is logged, never propagated as an uncaught exception that could crash the harness the plugin monitors.
- Responses carry `cache-control: no-store` (runtime data must not be cached); the SSE stream uses `text/event-stream` with `x-accel-buffering: no`.
- SSE streams are bounded: at most `maxSubscribers` concurrent streams; a subscriber whose write buffer exceeds `maxBufferedBytes` (or whose socket write stalls) is dropped so a slow consumer cannot pin the process. Plugin teardown ends every open stream.

## Requirements

- dsh profile with the web bundle (`@deepseek-ai/dsh-web-app`) — provides `ctx.webServer` and `ctx.pluginInventory`.
- Node `^22.19 || >=24`.
- The browser entry renders in the conversation session header (`conversation.session.header.utilities` slot); it is not shown on the empty/home screen.
- The load-average row in the panel is a Unix concept: on Windows it is always `0.00`. CPU utilization and memory metrics work on every platform.

## Development

```sh
pnpm install
pnpm run build          # host tsc + client typecheck + esbuild bundle
pnpm test               # vitest unit tests
pnpm run lint           # biome lint (no auto-formatting)
npm pack --dry-run      # verify tarball contents (prepack runs the build)
node scripts/check-pack.mjs  # verify the tarball contains every module lib/ imports
```

## Publish

This package is a dsh *bundle*: the npm tarball ships `cordis.patch.yml` and the manifest's `dsh.bundle.patch` points at it, so installing the package into any dsh profile automatically mounts the plugin layer. Tag the repository `dsh-plugin` for discoverability in the [dsh plugin topic](https://github.com/topics/dsh-plugin).

## License

MIT
