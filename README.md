# dsh-status-plugin

A status plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). Two planes in one package:

- **Host plane** — HTTP endpoints exposing the running harness's runtime health as JSON: process, listener, API-key presence, memory, uptime, and the live plugin inventory.
- **Client plane** — a header badge in the web UI (top-right of a conversation session) that shows uptime, opens a detail panel, and raises toasts when the host reports overload or memory-pressure alerts.

- **Package**: `dsh-status-plugin`
- **Runtime**: host + browser bundle (ESM), built with `tsc` + esbuild to `lib/`.
- **Language**: TypeScript (ESM).

## Install

```sh
dsh plugin --profile web add dsh-status-plugin
```

The CLI reconciles `dsh.profile.bundles` automatically: because the manifest declares `dsh.bundle.patch`, the package joins the profile's bundle layer stack. Restart the profile to load it:

```sh
dsh-manage.sh restart   # or: dsh web
```

The client manifest (`package.json` → `dsh.client`) declares the browser entry; the profile's client-modules scanner picks it up and injects `dsh-status-plugin/client.js` into the web app automatically — no bundle or overlay configuration needed.

## Usage

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
    "memory": { "rss": 123456, "heapTotal": 654321, "heapUsed": 432100, "external": 12345 },
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
| `host.*` | `process` + `node:os` (pid, uptime, memory, load, LAN IPv4 addresses) |
| `webServer.*` | `ctx.webServer` (bind host and actual listening port) |
| `apiKey` | `DEEPSEEK_API_KEY` in `process.env`, else the working directory `.env`, `~/.env`, or `$DSH_HOME/.env` (checked in loadLayeredEnv priority order) — **presence only, never the value** |
| `plugins.entries` | `ctx.pluginInventory.list()` (live Cordis Loader entry state) |

The API key check reports only whether a key is configured and where it was found; the value itself never leaves the process.

### `GET /api/status/events` (SSE)

The host pushes to open browser streams — the server decides when the page needs new state, so idle pages make zero requests:

- **`snapshot`** — a full status snapshot, emitted immediately on connect and then every `heartbeatMs` (default 30 s). Each snapshot card dissects to `loadAvg` and memory fields inside `host.*` for alert-driven UIs.
- **`alert`** — emitted when an indicator crosses its threshold (entering alert) or recovers (leaving alert). Emitted on every transition and **re-synchronized on connect** so a page that opens mid-alert still learns about it:

```
event: snapshot
data: {"ok":true,"timestamp":"...","host":{...},"plugins":{...}}

event: alert
data: {"active":true,"reason":"load","value":4.39,"threshold":2}
```

Default thresholds (configurable via the plugin config in the profile's cordis.yml):

| Config | Default | Meaning |
|---|---|---|
| `loadWarning` | `2` | 1-minute load average above which an overload alert fires |
| `memoryWarning` | `0.85` | RSS share of total memory above which a memory alert fires |
| `heartbeatMs` | `30000` | snapshot push interval |
| `checkIntervalMs` | `5000` | alert monitor sampling interval |

The browser side subscribes with a native `EventSource` (auto-reconnects on drop) and renders:

- a compact badge in the conversation header (status dot + uptime, click to open);
- a detail panel with process/resource/service/plugin sections and the last update time;
- a toast on every alert transition (auto-dismisses after 6 s) plus a pulsing badge while an alert is active.

### Failure behavior

- A collection error inside the handler returns `500` with `{ "ok": false, "error": "<message>" }` — structured, no stack leak, never a hung socket.
- `pluginInventory` is optional: when the service is absent, `plugins.entries` is `[]` rather than an error.
- Responses carry `cache-control: no-store` (runtime data must not be cached); the SSE stream uses `text/event-stream` with `x-accel-buffering: no`.

## Requirements

- dsh profile with the web bundle (`@deepseek-ai/dsh-web-app`) — provides `ctx.webServer` and `ctx.pluginInventory`.
- Node `^22.19 || >=24`.
- The browser entry renders in the conversation session header (`conversation.session.header.utilities` slot); it is not shown on the empty/home screen.

## Development

```sh
pnpm install
pnpm run build          # host tsc + client typecheck + esbuild bundle
npm pack --dry-run      # verify tarball contents (files whitelist)
```

## Publish

This package is a dsh *bundle*: the npm tarball ships `cordis.patch.yml` and the manifest's `dsh.bundle.patch` points at it, so installing the package into any dsh profile automatically mounts the plugin layer. Tag the repository `dsh-plugin` for discoverability in the [dsh plugin topic](https://github.com/topics/dsh-plugin).

## License

MIT