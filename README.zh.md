# dsh-status-plugin

中文 | [English](README.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的状态插件，一个包内含两个平面：

- **Host 平面** — 以 JSON 形式暴露运行中 harness 的运行时健康状态：进程、监听器、API Key 是否存在、内存、运行时长，以及实时的插件清单。
- **Client 平面** — Web UI（会话右上角）的头部徽标：显示运行时长，点击展开详情面板；当 host 上报过载或内存压力告警时弹出提示。

- **包名**：`dsh-status-plugin`
- **运行时**：host + 浏览器 bundle（ESM），使用 `tsc` + esbuild 构建到 `lib/`。
- **语言**：TypeScript（ESM）。

## 安装

```sh
dsh plugin --profile web add dsh-status-plugin
```

CLI 会自动协调 `dsh.profile.bundles`：因为 manifest 声明了 `dsh.bundle.patch`，该包会加入 profile 的 bundle 层栈。重启 profile 以加载：

```sh
dsh-manage.sh restart   # 或：dsh web
```

Client manifest（`package.json` → `dsh.client`）声明了浏览器入口；profile 的 client-modules 扫描器会自动拾取并注入 `dsh-status-plugin/client.js` 到 Web 应用——无需任何 bundle 或 overlay 配置。

## 用法

<img width="2560" height="1313" alt="abcddf52074cd98f465253a6619de744" src="https://github.com/user-attachments/assets/c6c6e322-4a11-425d-9682-6b5f48f05b7a" />

插件在 profile 的 web 服务器上注册两个精确路由：

```
GET /api/status          # 按需获取 JSON 快照
GET /api/status/events   # Server-Sent Events 流
```

### `GET /api/status`

响应示例：

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

### 字段说明

| 字段 | 来源 |
|---|---|
| `host.*` | `process` + `node:os`（pid、运行时长、内存、负载、LAN IPv4 地址） |
| `webServer.*` | `ctx.webServer`（绑定 host 与实际监听端口） |
| `apiKey` | `DEEPSEEK_API_KEY` 在 `process.env`，否则依次在 `~/.env` 或 `$DSH_HOME/.env` 中检查（按 loadLayeredEnv 优先级）——**只报告是否存在，绝不报告值** |
| `plugins.entries` | `ctx.pluginInventory.list()`（Cordis Loader 条目的实时状态） |

API Key 检查只报告 key 是否已配置及其来源；值本身永远不会离开进程。

### `GET /api/status/events`（SSE）

host 向已打开的浏览器流推送——由服务器决定页面何时需要新状态，空闲页面零请求：

- **`snapshot`** — 完整状态快照，连接时立即发送，之后每 `heartbeatMs`（默认 30 秒）一次。每个快照卡片分解为 `host.*` 中的 `loadAvg` 与内存字段，供告警驱动的 UI 使用。
- **`alert`** — 指标越过阈值（进入告警）或恢复（离开告警）时发送。每次状态转换都发送，并在**连接时重新同步**，因此中途打开的页面也能得知正在进行的告警：

```
event: snapshot
data: {"ok":true,"timestamp":"...","host":{...},"plugins":{...}}

event: alert
data: {"active":true,"reason":"load","value":4.39,"threshold":2}
```

默认阈值（可通过 profile 的 cordis.yml 中插件配置覆盖）：

| 配置 | 默认值 | 含义 |
|---|---|---|
| `loadWarning` | `2` | 1 分钟负载均值超过该值时触发过载告警 |
| `memoryWarning` | `0.85` | RSS 占总内存比例超过该值时触发内存告警 |
| `heartbeatMs` | `30000` | 快照推送间隔 |
| `checkIntervalMs` | `5000` | 告警监控采样间隔 |

浏览器侧使用原生 `EventSource` 订阅（断线自动重连），并渲染：

- 会话头部的一个紧凑徽标（状态圆点 + 运行时长，点击展开）；
- 详情面板：进程/资源/服务/插件四个分区与最近更新时间；
- 每次告警转换弹出 toast（6 秒自动消失），告警激活期间徽标脉冲闪烁。

### 失败行为

- 处理器内收集错误返回 `500`，带 `{ "ok": false, "error": "<message>" }` ——结构化的、不泄漏堆栈、绝不挂起 socket。
- `pluginInventory` 可选：服务缺失时 `plugins.entries` 返回 `[]` 而不是报错。
- 响应携带 `cache-control: no-store`（运行时数据不可缓存）；SSE 流使用 `text/event-stream` 并带 `x-accel-buffering: no`。

## 环境要求

- 带 web bundle（`@deepseek-ai/dsh-web-app`）的 dsh profile——提供 `ctx.webServer` 和 `ctx.pluginInventory`。
- Node `^22.19 || >=24`。
- 浏览器入口渲染在会话头部（`conversation.session.header.utilities` 槽位）；空白/首页不显示。

## 开发

```sh
pnpm install
pnpm run build          # host tsc + client 类型检查 + esbuild bundle
npm pack --dry-run      # 验证 tarball 内容（files 白名单）
```

## 发布

本包是一个 dsh *bundle*：npm tarball 携带 `cordis.patch.yml`，manifest 的 `dsh.bundle.patch` 指向它，因此把包安装到任意 dsh profile 即自动挂载插件层。为便于在 [dsh plugin topic](https://github.com/topics/dsh-plugin) 中被发现，请给仓库打 `dsh-plugin` 标签。

## License

MIT
