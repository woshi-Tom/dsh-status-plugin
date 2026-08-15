# dsh-status-plugin

中文 | [English](README.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的状态插件，一个包内含两个平面：

- **Host 平面** — 以 JSON 形式暴露运行中 harness 的运行时健康状态：进程、监听器、API Key 是否存在、内存、磁盘、运行时长，以及实时的插件清单。
- **Client 平面** — Web UI（会话右上角）的头部徽标：显示运行时长，点击展开详情面板；当 host 上报过载、内存压力或磁盘告警时弹出提示；另有「状态」设置页可实时调整告警阈值。

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
<img width="422" height="600" alt="image" src="https://github.com/user-attachments/assets/312a1c4f-d169-4ce1-847b-c13d536c9eed" />

插件在 profile 的 web 服务器上注册三个精确路由：

```
GET /api/status          # 按需获取 JSON 快照
GET /api/status/metrics  # Prometheus 文本暴露格式
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
    "eventLoopDelayMs": 2.3,
    "memory": { "rss": 123456, "heapTotal": 654321, "heapUsed": 432100, "external": 12345 },
    "systemMemory": { "total": 17179869184, "free": 4294967296, "used": 12884901888 },
    "disk": { "mount": "/", "total": 107374182400, "free": 64424509440, "avail": 60129542144, "used": 42949672960, "percent": 0.416 },
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
| `host.*` | `process` + `node:os`（pid、运行时长、进程内存、LAN IPv4 地址）；`cpuPercent` 是基于 `os.cpus()` 增量采样得到的 CPU 利用率，全平台可用；`eventLoopDelayMs` 是自上次采样以来的事件循环平均延迟（`perf_hooks`）；`loadAvg` 是 Unix 负载均值——在 Windows 上恒为 `[0, 0, 0]`；`systemMemory.*` 是机器级内存（`os.totalmem()` − `os.freemem()`）；`disk` 是**工作盘**——对 `process.cwd()` 执行 `fs.statfsSync`，失败时回退到系统临时目录，即 harness 实际运行所在文件系统（只有所有探测都失败才为 `null`）；`disk.percent` 采用 `df` 惯例 `used / (used + avail)`，保留块（ext4 为 root 预留的 5%）不会高估使用率 |
| `webServer.*` | `ctx.webServer`（绑定 host 与实际监听端口） |
| `apiKey` | `DEEPSEEK_API_KEY` 在 `process.env`，否则在 `cwd/.env` 或 `$DSH_HOME/.env` 中检查（与 dsh CLI 实际加载的层完全一致——`~/.env` 刻意**不**检查）——**只报告是否存在，绝不报告值**；空赋值（如 `DEEPSEEK_API_KEY=""`）不算已配置 |
| `plugins.entries` | `ctx.pluginInventory.list()`（Cordis Loader 条目的实时状态） |

API Key 检查只报告 key 是否已配置及其来源；值本身永远不会离开进程。检查结果缓存 60 秒，快照不会反复在事件循环上读 `.env` 文件。

> **隐私说明（0.2.1+）：** `host.lanAddresses` 默认为 `[]`。需要 LAN IPv4 地址时请设置 `exposeLanAddresses: true`。

### `GET /api/status/events`（SSE）

host 向已打开的浏览器流推送——由服务器决定页面何时需要新状态，空闲页面零请求：

- **`snapshot`** — 完整状态快照，连接时立即发送，之后每 `heartbeatMs`（默认 30 秒）一次。每个快照卡片分解为 `host.*` 中的 `cpuPercent`、`eventLoopDelayMs`、`loadAvg`、`systemMemory` 与进程内存字段，供告警驱动的 UI 使用。
- **`alert`** — 指标进入或离开告警区间时发送。进入需要 `value > threshold`；激活中的告警只有在值回落到 `threshold × (1 − hysteresis)` 以下才解除，因此徘徊在阈值附近的值不会反复翻转。告警原因：`cpu`、`memory`（Linux 内存压力改用 `/proc/meminfo` 的 `MemAvailable`，不再用裸 `freemem()`——page cache 不再造成误报）、`eventLoop`（事件循环平均延迟，毫秒）、`disk`（工作盘使用率，`df` 口径）。每次状态转换都发送，并在**连接时重新同步**，因此中途打开的页面也能得知正在进行的告警：

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
| `diskWarning` | `0.9` | 工作盘使用率超过该值时触发磁盘告警 |
| `eventLoopWarning` | `100` | 事件循环平均延迟（毫秒）超过该值时触发阻塞告警 |
| `hysteresis` | `0.1` | 恢复余量：告警只在值低于 `threshold × (1 − hysteresis)` 时解除 |
| `heartbeatMs` | `30000` | 快照推送间隔 |
| `checkIntervalMs` | `5000` | 告警监控采样间隔 |
| `authToken` | `''` | 三个路由都要求的共享密钥；留空禁用鉴权。见[鉴权](#鉴权) |
| `allowedOrigins` | `[]` | 允许调用路由的精确 `Origin` 值；留空禁用 Origin 校验。见[鉴权](#鉴权) |
| `exposeLanAddresses` | `false` | 快照中包含 `host.lanAddresses`（默认关闭以保护隐私） |
| `rateLimitPerMinute` | `300` | 每个客户端 IP 在所有路由上的每分钟请求上限；`0` 禁用 |
| `maxSubscribers` | `32` | SSE 订阅者上限；超限的新连接收到错误响应 |
| `maxBufferedBytes` | `65536` | 每个订阅者的写缓冲高水位；超过的慢消费者会被丢弃 |
| `webhookUrl` | `''` | 每次告警转换时通知的 webhook 地址；留空禁用。见[Webhook 通知](#webhook-通知) |
| `webhookTimeoutMs` | `5000` | webhook 请求超时（毫秒） |

### 运行时设置（设置页）

自 0.4.0 起插件注册了一个 **`dsh-status` 设置命名空间**（`@deepseek-ai/dsh-settings`）。当 profile 挂载了设置服务时，Web UI 设置面板会出现一个**「状态」设置页**（贡献到 `settings.section` 槽位），以下字段可**实时调整——写入后无需重启 harness 立即生效**：

| 字段 | 默认 | 生效时机 |
|---|---|---|
| `cpuWarning`、`memoryWarning`、`diskWarning`、`eventLoopWarning` | 同上 | 实时——告警监控器在下一个采样周期按新阈值判定 |
| `hysteresis` | `0.1` | 实时 |
| `heartbeatMs`、`checkIntervalMs` | 同上 | 实时——定时器重新挂载 |
| `exposeLanAddresses` | `false` | 实时——下一个快照即生效 |
| `rateLimitPerMinute` | `300` | 实时——限流器容量被替换 |

**安全边界。** 设置页刻意只编辑这个子集。`authToken`（密钥）、`allowedOrigins`、`webhookUrl`/`webhookTimeoutMs`（通知端点）、`maxSubscribers`/`maxBufferedBytes`（hub 容量）都留在 cordis.yml——密钥与端点绝不暴露到浏览器表面。没有设置服务时，插件完全按 entry 配置运行，与之前一致。

设置传输仅限 loopback（与 SSE 鉴权约束同类）：远程机器上的浏览器无法读写该命名空间，页面会显示不可用状态。每个字段旁的「重置」按钮可清除用户覆盖，使该字段重新继承 cordis.yml 的 entry 值。

### 鉴权

设置 `authToken` 后，三个路由都要求携带该令牌，可通过任一通道：

- `GET /api/status` 与 `GET /api/status/metrics` — `Authorization: Bearer <token>` 请求头，或 `?token=<token>`。
- `GET /api/status/events` — `?token=<token>` 查询参数，或在客户端使用 fetch 流订阅器时携带 `Authorization` 请求头（见下文）；原生 `EventSource` 无法设置自定义请求头。

被拒绝的请求返回 `401` 与 `{ "ok": false, "error": "unauthorized" }`。比较是恒时间的（`crypto.timingSafeEqual`），错误的令牌不会泄漏长度。由于查询参数可能出现在日志和历史记录中，请优先使用请求头鉴权，SSE 流请尽量放在仅 loopback 的 web 服务器上。

**Origin 策略。** 设置 `allowedOrigins` 为精确 Origin 列表（如 `["https://dsh.example.com"]`），可在 web 服务器超出 loopback 可达时拒绝跨域浏览器读取。不带 `Origin` 头的请求（curl、服务器、同源导航）始终放行。空列表（默认）接受所有 Origin。

**速率限制。** 每个路由按客户端 IP 限制为 `rateLimitPerMinute` 次请求（默认 300，`0` 禁用）。超限返回 `429` 与 `{ "ok": false, "error": "rate limited" }`。

**支持请求头鉴权的 SSE 客户端。** 内置徽标没有接收 host 令牌的通道，因此启用 `authToken` 会使徽标的状态视图不可用。自定义 UI 可调用导出的 `createSseClient(url, headers, onEvent, onConnectionChange)` 订阅——传入 `{ Authorization: 'Bearer <token>' }` 即可获得带请求头鉴权的 SSE，并自带指数退避自动重连。

浏览器侧通过基于 `fetch` 的 SSE 读取器订阅（指数退避自动重连，尊重服务器下发的 `retry:` 帧），并渲染：

- 会话头部的一个紧凑徽标（状态圆点 + 运行时长，点击展开）；
- 详情面板（0.5.0 起改为 Tab 分区）：**概览**页签——告警横幅、四个关键资源卡片（CPU/内存/磁盘/事件循环延迟）与最近 60 个快照的 CPU/内存趋势图；**详情**页签——完整的进程/资源/磁盘/服务/插件分区；底部显示最近更新时间；
- 会话视图环中的整页**「状态」页签**（0.5.1 起）：整个会话主区切换为监控视图——更大的统计卡片、宽幅趋势图与全部分区。通过会话页签条切换（面板内有一行提示指引）；徽标无法编程式切换视图——shell 将 per-session 的 chat store 留在内部，视图切换由用户点击页签完成；
- 每次告警转换弹出 toast（6 秒自动消失），告警激活期间徽标脉冲闪烁；
- 流断开且 90 秒未收到快照时圆点变灰——监控组件在失联时必须显示"未知"，而不是继续显示"健康"。首个连接尚未建立时圆点同样是灰色，徽标在有数据之前绝不宣称健康。

### Webhook 通知

设置 `webhookUrl` 可在每次告警转换（进入与恢复）时收到 JSON POST。载荷：

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

投递是 fire-and-forget：失败或超时的请求只记日志，绝不干扰告警管线，因此即使通知通道不可用，harness 也会继续监控。可对接任意支持 webhook 的服务（Slack、钉钉、企业微信、ntfy 等）。

### Prometheus 指标

`GET /api/status/metrics` 以 Prometheus 文本暴露格式（`text/plain; version=0.0.4`）提供快照，供现有监控栈抓取：

```
dsh_status_up 1
dsh_status_uptime_seconds 3600
dsh_status_cpu_percent 12.4
dsh_status_event_loop_delay_ms 2.3
dsh_status_loadavg_1 0.5
dsh_status_process_rss_bytes 123456
dsh_status_system_memory_used_bytes 12884901888
dsh_status_disk_total_bytes{mount="/"} 107374182400
dsh_status_disk_free_bytes{mount="/"} 64424509440
dsh_status_disk_avail_bytes{mount="/"} 60129542144
dsh_status_disk_used_bytes{mount="/"} 42949672960
dsh_status_disk_percent{mount="/"} 0.416
dsh_status_api_key_configured 1
dsh_status_plugins_total 42
dsh_status_plugins_active 40
```

该端点与其他路由一样受 `authToken`、`allowedOrigins` 与 `rateLimitPerMinute` 约束。

### 失败行为

- 处理器内收集错误返回 `500`，带 `{ "ok": false, "error": "internal error" }` ——已脱敏，不泄漏内部信息或堆栈；真实错误信息进入 host 日志。
- `pluginInventory` 可选：服务缺失时 `plugins.entries` 返回 `[]` 而不是报错。
- 响应处理器与两个周期定时器（heartbeat 与告警采样）都做了异常隔离：收集抛错只记日志，绝不作为 uncaughtException 传播出去导致被监控的 harness 崩溃。
- 响应携带 `cache-control: no-store`（运行时数据不可缓存）；SSE 流使用 `text/event-stream` 并带 `x-accel-buffering: no`。
- SSE 流有界：最多 `maxSubscribers` 个并发订阅者；写缓冲超过 `maxBufferedBytes`（或 socket 写入停滞）的订阅者会被丢弃，慢消费者无法拖死进程。插件卸载会结束所有打开的流。

## 环境要求

- 带 web bundle（`@deepseek-ai/dsh-web-app`）的 dsh profile——提供 `ctx.webServer` 和 `ctx.pluginInventory`。
- Node `^22.19 || >=24`。
- 浏览器入口渲染在会话头部（`conversation.session.header.utilities` 槽位）；空白/首页不显示。
- 设置页（0.4.0+）需要 web 组合里包含设置面（`@deepseek-ai/dsh-client-ui-settings` 与设置 shell）——标准 bundle 自带。缺省时徽标与面板照常工作，只是没有设置页。
- 面板中的负载均值行是 Unix 概念：Windows 上恒为 `0.00`。CPU 利用率与内存指标全平台可用。

## 开发

```sh
pnpm install
pnpm run build          # host tsc + client 类型检查 + esbuild bundle
pnpm test               # vitest 单元测试
pnpm run lint           # biome lint（不自动改格式）
npm pack --dry-run      # 验证 tarball 内容（prepack 会自动执行构建）
node scripts/check-pack.mjs  # 验证 tarball 包含 lib/ 引用的每个模块
```

## 发布

本包是一个 dsh *bundle*：npm tarball 携带 `cordis.patch.yml`，manifest 的 `dsh.bundle.patch` 指向它，因此把包安装到任意 dsh profile 即自动挂载插件层。为便于在 [dsh plugin topic](https://github.com/topics/dsh-plugin) 中被发现，请给仓库打 `dsh-plugin` 标签。

## License

MIT
