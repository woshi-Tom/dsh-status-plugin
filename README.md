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

The plugin registers two exact routes on the profile's web server:

```
GET /api/status          # JSON snapshot on demand
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
| `host.*` | `process` + `node:os` (pid, uptime, process memory, LAN IPv4 addresses); `cpuPercent` is CPU utilization sampled from `os.cpus()` deltas and works on every platform; `loadAvg` is the Unix load average — always `[0, 0, 0]` on Windows; `systemMemory.*` is machine-wide memory (`os.totalmem()` − `os.freemem()`) |
| `webServer.*` | `ctx.webServer` (bind host and actual listening port) |
| `apiKey` | `DEEPSEEK_API_KEY` in `process.env`, else the working directory `.env`, `~/.env`, or `$DSH_HOME/.env` (checked in loadLayeredEnv priority order) — **presence only, never the value**; an empty assignment (`` DEEPSEEK_API_KEY="" ``) does not count as configured |
| `plugins.entries` | `ctx.pluginInventory.list()` (live Cordis Loader entry state) |

The API key check reports only whether a key is configured and where it was found; the value itself never leaves the process.

### `GET /api/status/events` (SSE)

The host pushes to open browser streams — the server decides when the page needs new state, so idle pages make zero requests:

- **`snapshot`** — a full status snapshot, emitted immediately on connect and then every `heartbeatMs` (default 30 s). Each snapshot card dissects to `cpuPercent`, `loadAvg`, `systemMemory`, and process-memory fields inside `host.*` for alert-driven UIs.
- **`alert`** — emitted when an indicator enters or leaves its alert band. Entering requires `value > threshold`; an active alert only clears when the value drops below `threshold × (1 − hysteresis)`, so a value hovering near the threshold does not flap. Events are emitted on every transition and **re-synchronized on connect** so a page that opens mid-alert still learns about it:

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
| `hysteresis` | `0.1` | recovery margin: an alert clears only below `threshold × (1 − hysteresis)` |
| `heartbeatMs` | `30000` | snapshot push interval |
| `checkIntervalMs` | `5000` | alert monitor sampling interval |
| `authToken` | `''` | shared secret required on both routes; empty disables auth. See [Authentication](#authentication) |
| `maxSubscribers` | `32` | SSE subscriber cap; new connections over the cap fail with an error response |
| `maxBufferedBytes` | `65536` | per-subscriber write-buffer high-water mark; a slow consumer over it is dropped |

### Authentication

When `authToken` is set, both routes require it. The token can travel in either channel:

- `GET /api/status` — `Authorization: Bearer <token>` header, or `?token=<token>`.
- `GET /api/status/events` — `?token=<token>` query parameter; a native `EventSource` cannot set custom headers.

A rejected request answers `401` with `{ "ok": false, "error": "unauthorized" }`. Comparison is constant-time (`crypto.timingSafeEqual`), so a wrong token does not leak its length. Because the query parameter can appear in logs and history, prefer header auth for `GET /api/status` and keep the SSE stream on a loopback-only webserver.

The built-in browser badge has no channel to receive the host's token (the client manifest cannot read the host config), so enabling `authToken` disables the badge's status views; a custom UI can authenticate by sending the header/query token above. Instances that need the bundled UI should leave `authToken` empty (the default) and rely on the webserver's loopback binding.

The browser side subscribes with a native `EventSource` (auto-reconnects on drop) and renders:

- a compact badge in the conversation header (status dot + uptime, click to open);
- a detail panel with process/resource/service/plugin sections and the last update time;
- a toast on every alert transition (auto-dismisses after 6 s) plus a pulsing badge while an alert is active;
- a gray badge dot when the stream is disconnected or no snapshot arrived for 90 s — a monitoring widget must say *unknown*, not *healthy*, when it loses contact.

### Failure behavior

- A collection error inside the handler returns `500` with `{ "ok": false, "error": "<message>" }` — structured, no stack leak, never a hung socket.
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
npm pack --dry-run      # verify tarball contents (prepack runs the build)
```

## Publish

This package is a dsh *bundle*: the npm tarball ships `cordis.patch.yml` and the manifest's `dsh.bundle.patch` points at it, so installing the package into any dsh profile automatically mounts the plugin layer. Tag the repository `dsh-plugin` for discoverability in the [dsh plugin topic](https://github.com/topics/dsh-plugin).

## License

MIT
