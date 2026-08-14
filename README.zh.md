# dsh-status-plugin

中文 | [English](README.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的状态插件，一个包内含两个平面：

- **Host 平面** — 以 JSON 形式暴露运行中 harness 的运行时健康状态：进程、监听器、API Key 是否存在、内存、运行时长，以及实时的插件清单。
- **Client 平面** — Web UI（会话右上角）的头部徽标：显示运行时长，点击展开详情面板；当 host 上报过载或内存压力告警时弹出提示。

- **包名**：`dsh-status-plugin`
- **运行时**：host（ESM）+ 浏览器 bundle（CJS factory，按 dsh client-modules 的 `__ModuleLoader__` 契约包装），使用 `tsc` + esbuild 构建到 `lib/`。
- **语言**：TypeScript。

## 安装

```sh
dsh plugin --profile web add dsh-status-plugin
```

CLI 会自动协调 `dsh.profile.bundles`：因为 manifest 声明了 `dsh.bundle.patch`，该包会加入 profile 的 bundle 层栈。停止正在运行的进程并重启 profile 以加载：

```sh
dsh web   # 或：dsh --profile <name>
```

无需启动即可验证插件已加入组合树：

```sh
dsh --profile web --dump-config
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

### 字段说明

| 字段 | 来源 |
|---|---|
| `host.*` | `process` + `node:os`（pid、运行时长、进程内存、LAN IPv4 地址）；`cpuPercent` 是基于 `os.cpus()` 增量采样得到的 CPU 利用率，全平台可用；`loadAvg` 是 Unix 负载均值——在 Windows 上恒为 `[0, 0, 0]`；`systemMemory.*` 是机器级内存（`os.totalmem()` − `os.freemem()`） |
| `webServer.*` | `ctx.webServer`（绑定 host 与实际监听端口） |
| `apiKey` | `DEEPSEEK_API_KEY` 在 `process.env`，否则依次在 `~/.env` 或 `$DSH_HOME/.env` 中检查（按 loadLayeredEnv 优先级）——**只报告是否存在，绝不报告值**；空赋值（如 `DEEPSEEK_API_KEY=""`）不算已配置 |
| `plugins.entries` | `ctx.pluginInventory.list()`（Cordis Loader 条目的实时状态） |

API Key 检查只报告 key 是否已配置及其来源；值本身永远不会离开进程。

### `GET /api/status/events`（SSE）

host 向已打开的浏览器流推送——由服务器决定页面何时需要新状态，空闲页面零请求：

- **`snapshot`** — 完整状态快照，连接时立即发送，之后每 `heartbeatMs`（默认 30 秒）一次。每个快照卡片分解为 `host.*` 中的 `cpuPercent`、`loadAvg`、`systemMemory` 与进程内存字段，供告警驱动的 UI 使用。
- **`alert`** — 指标进入或离开告警区间时发送。进入需要 `value > threshold`；激活中的告警只有在值回落到 `threshold × (1 − hysteresis)` 以下才解除，因此徘徊在阈值附近的值不会反复翻转。每次状态转换都发送，并在**连接时重新同步**，因此中途打开的页面也能得知正在进行的告警：

```
event: snapshot
data: {"ok":true,"timestamp":"...","host":{...},"plugins":{...}}

event: alert
data: {"active":true,"reason":"cpu","value":0.87,"threshold":0.8}
```

默认阈值（可通过 profile 的 cordis.yml 中插件配置覆盖）：

| 配置 | 默认值 | 含义 |
|---|---|---|
| `cpuWarning` | `0.8` | CPU 利用率超过该值时触发 CPU 过载告警 |
| `memoryWarning` | `0.85` | 系统内存压力超过该值时触发内存告警 |
| `hysteresis` | `0.1` | 恢复余量：告警只在值低于 `threshold × (1 − hysteresis)` 时解除 |
| `heartbeatMs` | `30000` | 快照推送间隔 |
| `checkIntervalMs` | `5000` | 告警监控采样间隔 |
| `authToken` | `''` | 两个路由都要求的共享密钥；留空禁用鉴权。见[鉴权](#鉴权) |
| `maxSubscribers` | `32` | SSE 订阅者上限；超限的新连接收到错误响应 |
| `maxBufferedBytes` | `65536` | 每个订阅者的写缓冲高水位；超过的慢消费者会被丢弃 |

### 鉴权

设置 `authToken` 后，两个路由都要求携带该令牌，可通过任一通道：

- `GET /api/status` — `Authorization: Bearer <token>` 请求头，或 `?token=<token>`。
- `GET /api/status/events` — `?token=<token>` 查询参数；原生 `EventSource` 无法设置自定义请求头。

被拒绝的请求返回 `401` 与 `{ "ok": false, "error": "unauthorized" }`。比较是恒时间的（`crypto.timingSafeEqual`），错误的令牌不会泄漏长度。由于查询参数可能出现在日志和历史记录中，`GET /api/status` 请优先使用请求头鉴权，SSE 流请尽量放在仅 loopback 的 web 服务器上。

内置浏览器徽标没有接收 host 令牌的通道（client manifest 无法读取 host 配置），因此启用 `authToken` 会使徽标的状态视图不可用；自定义 UI 可通过上述请求头/查询参数鉴权。需要内置 UI 的实例应保持 `authToken` 为空（默认值），并依赖 web 服务器的 loopback 绑定。

浏览器侧使用原生 `EventSource` 订阅（断线自动重连），并渲染：

- 会话头部的一个紧凑徽标（状态圆点 + 运行时长，点击展开）；
- 详情面板：进程/资源/服务/插件四个分区与最近更新时间；
- 每次告警转换弹出 toast（6 秒自动消失），告警激活期间徽标脉冲闪烁；
- 流断开且 90 秒未收到快照时圆点变灰——监控组件在失联时必须显示"未知"，而不是继续显示"健康"。

### 失败行为

- 处理器内收集错误返回 `500`，带 `{ "ok": false, "error": "<message>" }` ——结构化的、不泄漏堆栈、绝不挂起 socket。
- `pluginInventory` 可选：服务缺失时 `plugins.entries` 返回 `[]` 而不是报错。
- 响应处理器与两个周期定时器（heartbeat 与告警采样）都做了异常隔离：收集抛错只记日志，绝不作为 uncaughtException 传播出去导致被监控的 harness 崩溃。
- 响应携带 `cache-control: no-store`（运行时数据不可缓存）；SSE 流使用 `text/event-stream` 并带 `x-accel-buffering: no`。
- SSE 流有界：最多 `maxSubscribers` 个并发订阅者；写缓冲超过 `maxBufferedBytes`（或 socket 写入停滞）的订阅者会被丢弃，慢消费者无法拖死进程。插件卸载会结束所有打开的流。

## 环境要求

- 带 web bundle（`@deepseek-ai/dsh-web-app`）的 dsh profile——提供 `ctx.webServer` 和 `ctx.pluginInventory`。
- Node `^22.19 || >=24`。
- 浏览器入口渲染在会话头部（`conversation.session.header.utilities` 槽位）；空白/首页不显示。
- 面板中的负载均值行是 Unix 概念：Windows 上恒为 `0.00`。CPU 利用率与内存指标全平台可用。

## 开发

```sh
pnpm install
pnpm run build          # host tsc + client 类型检查 + esbuild bundle
pnpm test               # vitest 单元测试
npm pack --dry-run      # 验证 tarball 内容（prepack 会自动执行构建）
```

## 发布

本包是一个 dsh *bundle*：npm tarball 携带 `cordis.patch.yml`，manifest 的 `dsh.bundle.patch` 指向它，因此把包安装到任意 dsh profile 即自动挂载插件层。为便于在 [dsh plugin topic](https://github.com/topics/dsh-plugin) 中被发现，请给仓库打 `dsh-plugin` 标签。

## License

MIT
