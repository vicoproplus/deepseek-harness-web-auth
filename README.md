# dsh-web-auth

为 deepseek-harness（DSH）web 控制面（`http://127.0.0.1:3080`）的 `/api` 端点强制 Bearer token 鉴权的 Cordis 插件，修复 **CWE-306（关键功能缺少身份认证）**。

DSH 的 web UI 控制面暴露了 `session.create`、`commands.execute`、`settings.update`、`credentials.set` 等高危 API，默认情况下任何能访问该端口的人都可以直接调用——本插件为全部 `/api` 端点加一层共享密钥（Bearer token）校验，未认证请求按配置返回 `401` 或 `403`，不转发到 API 网关。

---

## 漏洞背景（Discussion #853）

本插件是针对 deepseek-harness 的公开安全报告 [Discussion #853：unauthenticated local/remote code execution via the dsh web UI control plane](https://github.com/deepseek-ai/deepseek-harness/discussions/853)（验证于 `@deepseek-ai/dsh@0.1.0-rc.6`）实现的修复。报告定级：默认 loopback 部署 **High** / 绑定非 loopback 接口 **Critical**，关联 **CWE-306（关键功能缺少身份认证）** 与 **CWE-749（暴露危险方法或函数）**。

### 漏洞概要

`dsh web` 控制面（默认 `http://127.0.0.1:3080`）通过纯 `node:http` 服务暴露完整 agent 控制面，**没有任何认证层**——无 token、无 cookie、无 TLS。唯一防护是一个 Host 头 / Origin 围栏，而源码自身注明它"不是认证层"（`dsh-client-connection`）。该围栏只拦截浏览器侧攻击（跨站 Origin、伪造 Host / DNS rebinding、`sec-fetch-site: cross-site` 均验证返回 403）；任何**非浏览器本地进程**可轻易通过围栏，以用户权限获得任意命令执行。若 webserver 被绑定到非 loopback 接口（经用户 cordis patch 即可，因围栏校验的是客户端提供的 `Host` 头而非 socket 对端），则升级为**未认证远程 RCE**，包括被钉在"仅 loopback"的特权方法。

### 攻击链（报告已验证）

60+ 个无认证 RPC 方法组合即可完成提权与任意命令执行：

| 步骤 | 无认证调用 | 效果 |
|------|-----------|------|
| 1 | `POST /api/session.create`（调用方自选 cwd） | 创建会话 |
| 2 | `POST /api/commands/execute`，line 为 `/permission danger-full-access` | 静默切换为无沙箱 + 永不需要审批 |
| 3 | `POST /api/session.prompt` 指示 bash 工具执行命令 | 任意命令以用户权限执行 |
| 辅助 | `GET /api/events.mux` | 广播所有会话事件，含工具调用参数与待审批 rpcIds |
| 辅助 | `POST /api/respond` | 应答审批提示，可自我批准沙箱提权 |
| 辅助 | `GET /api/session.export?sessionId=…` | 下载完整会话日志 |

另有 15 个"特权"方法（`settings.*`、`credentials.*`、`llm.discoverModels`、`host.openPath` 等）被固定到 loopback——但仅通过**客户端提供的 Host 头**校验，攻击者发送 `Host: 127.0.0.1:<port>` 即可绕过。

### 根因

报告将根因归结为架构决策：v1 明确将 TLS / 认证排除在范围外（"TLS, auth … deliberately out of scope for the dev-facing v1"），威胁模型仅覆盖恶意网页。这遗漏了三点：

1. **本地多进程现实**——loopback 不是多进程机器上的安全边界，任何本地进程（恶意软件、不受信脚本、低权限程序）都可访问该端口；
2. **围栏信任客户端头而非连接对端**——Host 头由调用方自报，可任意伪造；
3. **审批机制可经同一无认证 API 观察与应答**——`events.mux` 泄露 rpcIds，`respond` 可自批准提权。

### 本插件的修复对照

| 报告建议修复 | 本插件实现 |
|-------------|-----------|
| 1. 每次启动随机 bearer token，经 `tapIndex` 注入 index.html | ✅ `tokenMode: auto`（`crypto.randomBytes(32)`）+ `ctx.webServer.tapIndex` 注入 `window.__DSH_AUTH_TOKEN__`；`manual` 模式供固定密钥场景 |
| 2. 校验 socket peer 为 loopback 而非仅 Host 头 | ⚠️ 部分：`0.0.0.0` 绑定被启动守卫拒绝（见下条），token 认证覆盖全部 `/api`；socket peer 校验仍需 host 侧 webserver 配合 |
| 3. 移除 / 门控 `0.0.0.0` 绑定字面量 | ✅ `allowNetworkExposure` 显式高危开关，默认拒绝在 `0.0.0.0` 上启动 |
| 4. 对 `/permission`、`/api/respond`、`session.export` 等要求认证 | ✅ 高危方法均已纳入内置 `endpoints` 清单（`commands.execute`、`respond`、`session.export`、`settings.*`、`credentials.*`、`llm.discoverModels`、`host.openPath` 等） |
| 5. 防止 `danger-full-access` 静默成为默认 preset | ⚠️ 超出插件范围：由 host 侧 `permission.defaultPreset` 控制，用户侧需保持 `workspace-write` |
| 6. `llm.discoverModels` 不得向调用者指定 URL 发送存储的 provider key | ⚠️ 超出插件范围：该端点已纳入认证拦截，但 URL 策略需 host 侧修复 |

> **已知缺口**：`GET /api/events.mux`（事件广播流）不在内置 `endpoints` 清单中，且若其走 WebSocket 升级，`exact` 路由 handler 无法拦截升级握手。需要收紧事件流的部署请经 `endpoints` 配置扩展，或依赖 host 侧修复。

### 用户侧缓解（与本插件叠加，来自报告）

- 不使用 `dsh web` 时保持停止；运行期间视所有本地进程为可控制 agent
- 切勿经 cordis patch 把 webserver 绑定到 `0.0.0.0`（本插件默认拒绝，见 `allowNetworkExposure`）
- 保持 `permission.defaultPreset` 为 `workspace-write`
- 需要远程访问时，在**认证 TLS 反向代理**之后运行，而非直接暴露端口

---

## 功能特性

- **全量端点拦截**：内置当前 DSH API 的完整端点清单（34 个），逐端点在 web server 上注册精确路由；新增 API 可经配置扩展，无需改代码
- **两种 Token 模式**：
  - `auto`：启动时随机生成 32 字节（64 位 hex）共享密钥，打印到日志并注入页面全局量 `window.__DSH_AUTH_TOKEN__`，开箱即用、零配置
  - `manual`：由管理员配置固定密钥，页面脚本提示输入一次并存入 `localStorage`，自动包装同源 `/api` 请求附加 `Authorization` 头；密钥**不落地**页面脚本
- **时序安全比对**：两侧先经 SHA-256 归一为等长摘要再 `timingSafeEqual`，杜绝长度侧信道与时间侧信道
- **可配置拒绝码**：`401`（未认证语义）或 `403`（隐藏端点存在性，弱化攻击面探测）
- **网络暴露守卫**：默认拒绝在 `0.0.0.0` 监听下启动（远程未认证 RCE 的 Critical 升级条件），需显式 `allowNetworkExposure: true` 才放行
- **流式转发与背压**：鉴权通过后桥接至 API 网关，保留 SSE 流式回写，socket 缓冲满时等待 `drain`，避免无界缓冲；载波体上限 300 MiB（超限返回 `413`）
- **HMR 热更新**：修改 profile 补丁层中的 `config` 自动卸载重载，无需重启进程

---

## 架构概览

插件遵循 Cordis 约定：导出 `name` + `inject` + `apply(ctx, config)`。

```
apply(ctx, config)
├─ 0.0.0.0 守卫：host 为 0.0.0.0 且未显式放行 → 抛错拒绝启动
├─ resolveToken(config)：auto 随机生成 / manual 读取配置（缺失即启动失败）
└─ ctx.effect(() => { ...; return disposer })   ← 可逆副作用，卸载自动清理
   ├─ 为每个 endpoint 注册精确路由 handler
   │   └─ createAuthHandler：校验 Authorization → 通过则 forwardToApi 转发
   └─ ctx.webServer.tapIndex：注入鉴权引导脚本到 index.html
```

- `src/index.ts` — 插件入口：`name` / `Config` / `apply` / 能力注册
- `src/auth-handler.ts` — 请求校验器：解析 `Authorization: Bearer <token>`，未通过返回 `rejectStatus`
- `src/token.ts` — 密钥解析与时序安全比对
- `src/endpoints.ts` — 内置 `/api` 端点清单（不含前导 `/api`）
- `src/forward.ts` — 校验通过后把 `node:http` 请求桥接到 API 网关（流式 + 背压 + 体积上限）
- `src/inject.ts` — `tapIndex` 转换：向 `index.html` 注入鉴权引导脚本

---

## 环境要求

| 组件 | 要求 |
|------|------|
| Node.js | 22.19+ 或 24+（harness 运行依赖 `node:module.stripTypeScriptTypes`） |
| pnpm | 11.7.0（Corepack 解析） |
| git | 2.26+ |
| deepseek-harness | 已构建：`lib/` 产物（`build:lib`）+ web bundle（`build:web`） |

> **bun 环境备注**：本机 `node/pnpm` 若是指向 bun 的符号链接，bun 1.4.x 未实现 `stripTypeScriptTypes`，harness 无法在纯 bun 下运行 web profile——构建可用 bun，**运行 dsh 服务须用真实 Node 22.19+**（见下）。

---

## 安装与挂载

### 1. 前置：确保 harness 已构建

在 deepseek-harness 仓库根目录：

```bash
pnpm run build:lib && pnpm run build:web
# 或整体：pnpm run build
```

未构建时 web profile 会崩溃（`MissingClientBundleError`），服务无法稳定监听。

### 2. 编写 patch 文件（cordis.yml）

本仓库附带了现成模板：

| 文件 | 用途 |
|------|------|
| `cordis.yml` | Windows 路径模板（`file:///` URL），默认 `rejectStatus: 401` |
| `cordis-401.yml` | 同 Windows 模板，明确 401 |
| `cordis-403.yml` | Windows 模板，`rejectStatus: 403` |
| `cordis.linux.yml` | Linux 路径模板（绝对路径），供本机挂载验证使用 |

```yaml
# cordis.yml 示例（Linux：name 用绝对路径）
- insert:
    - id: web-auth
      name: '/path/to/dsh-web-auth/src/index.ts'
      config:
        tokenMode: auto        # auto | manual
        rejectStatus: 401      # 401 | 403
        allowNetworkExposure: false
```

> **Windows 环境约束**：插件 `name` 用裸盘符路径（如 `E:/...`）会被 ESM loader 拒绝（`ERR_UNSUPPORTED_ESM_URL_SCHEME`），必须写成 `file:///E:/...` URL 形式。

### 3. 启动 web profile 并挂载

在 deepseek-harness 仓库根目录：

```bash
pnpm dsh --profile web --patch /path/to/dsh-web-auth/cordis.yml
```

> **注意**：使用父级 `--profile web --patch <file>` 形式；`dsh web --patch ...` 会报 `unknown option '--patch'`（web 子命令拒收父级选项）。

启动后打开 `http://127.0.0.1:3080`，页面会自动携带凭据；API 请求需要 `Authorization: Bearer <token>`。

### 4. 验证挂载

```bash
# 未认证请求 → 401（或按配置 403）
curl -i http://127.0.0.1:3080/api/session.list

# auto 模式：从服务日志取 token（dsh-web-auth token: <64位hex>）
TOKEN=<从日志获取>

# 带 token 请求 → 正常转发
curl -i -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/api/session.list
```

---

## 配置项

所有配置均可经 `cordis.yml` 的 `config` 覆盖，默认值写在 schema：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `token` | `string` | 无 | 共享密钥。`tokenMode: manual` 时必填（缺失即启动失败）；`auto` 时忽略 |
| `enabled` | `boolean` | `true` | 插件总开关，`false` 时不注册任何拦截 |
| `endpoints` | `string[]` | 内置 34 个端点 | 需拦截的 `/api` 端点清单（不含前导 `/api`），新增 API 必须同步追加 |
| `rejectStatus` | `401 \| 403` | `401` | 未认证响应码。403 可隐藏端点存在性 |
| `tokenMode` | `'auto' \| 'manual'` | `'auto'` | 密钥来源：启动随机生成 / 手动配置 |
| `allowNetworkExposure` | `boolean` | `false` | 允许 `0.0.0.0` 网络暴露（配合反向代理 / 手动模式），默认拒绝启动 |

### 内置端点清单（`endpoints` 默认值）

```
session.create        session.prompt    session.list      session.search
session.history       session.models    session.selectModel  session.rename
session.fork          session.export    session.cancel    session.attachment
commands.execute      respond
settings.describe     settings.update   settings.replace  settings.mutate
settings.openDocument credentials.describe  credentials.set  credentials.unset
host.describe         host.pickDirectory  host.openPath
llm.discoverModels    llm.providers     llm.models
agentPreset.list      agentPreset.read  agentPreset.copy
agentPreset.remove    agentPreset.openDocument
```

> 覆盖 `endpoints` 时须提供完整列表（patch 按 id 整行替换，非深合并）。新增 DSH API 方法时请同步更新本清单或经配置扩展。

---

## Token 模式详解

### `auto`（默认，零配置）

- 启动时 `crypto.randomBytes(32)` 生成 64 位 hex 密钥
- 日志打印 `dsh-web-auth token: <hex>`，供服务端调用方（curl / 脚本 / 反向代理）读取
- 页面注入 `<script>window.__DSH_AUTH_TOKEN__="<hex>"</script>`，前端凭据开箱即用
- 缺点：每次重启密钥变化，适合本地单机使用

### `manual`（固定密钥，适合共享/生产）

- 密钥经 `config.token` 提供（**建议用环境变量注入**，见下）
- 页面脚本不落地密钥：提示用户输入一次，存入 `localStorage`，之后自动包装同源 `/api` 请求附加 `Authorization: Bearer <token>`
- 密钥轮换：更新配置并 HMR 重载即可，无需重启；页面保留的旧值会在下一次请求被拒绝后重新提示

### 密钥安全注入（推荐）

不要在 `cordis.yml` 里写明文密钥。经环境变量注入：

```yaml
- insert:
    - id: web-auth
      name: '/path/to/dsh-web-auth/src/index.ts'
      config:
        tokenMode: manual
        token: !!js process.env.DSH_WEB_AUTH_TOKEN
```

启动前导出环境变量即可，代码与配置中不出现明文。

---

## HMR 热替换验证

修改 DSH 实际监听的补丁层（`~/.dsh/profiles/<profile>/cordis.patch.yml` 或 `$DSH_HOME/cordis.patch.yml`）中的 `config`，保存后插件自动卸载重载，**无需重启**：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: web-auth
      name: '/path/to/dsh-web-auth/src/index.ts'
      config:
        tokenMode: auto
        rejectStatus: 403      # 从 401 改为 403
        allowNetworkExposure: false
```

```bash
# 改前：无 token → 401；保存后：无 token → 403（配置已生效）
curl -i http://127.0.0.1:3080/api/session.list
```

> **注意**：config-only HMR 只监听 profile/home 补丁层，`--patch overlay` 文件（如 `cordis.yml`）**不注册进 HMR 监听列表**，改它不触发重载。HMR 前须确认 harness 已构建。

---

## 运行测试

```bash
node --experimental-strip-types --test tests/*.spec.ts
# 或：pnpm test
```

覆盖：

- `auth-handler.spec.ts` — 无头 / 非 Bearer / 错 token → 拒绝且不转发；正确 token → 转发；`rejectStatus` 可配置 403
- `token.spec.ts` — auto 生成 64 位 hex 且每次不同；manual 缺失抛错；时序安全比对（相同/不同/长度不等）
- `inject.spec.ts` — auto 注入全局量且保留 HTML；manual 注入提示标记与 fetch 包装且**不含密钥**

---

## 安全注意事项

- **0.0.0.0 守卫是硬约束**：`webServer` 绑定 `0.0.0.0` 且未显式 `allowNetworkExposure: true` 时启动即失败——这是远程未认证 RCE 漏洞报告的 Critical 升级条件，请勿随意放行
- **拒绝码选 403 更安全**：对未认证请求返回 403（而非 401）不暴露「端点存在但需认证」这一信息，弱化扫描
- **密钥禁止硬编码**：`token` 只经环境变量（`process.env.*`）注入；`cordis.yml`、settings、日志均不应出现明文
- **端点清单需同步维护**：DSH 新增 API 方法后必须同步到 `endpoints`，否则新端点裸奔
- **auto 模式密钥仅存于内存与页面全局量**：重启即失效，不要用于跨进程共享场景

---

## 目录结构

```
dsh-web-auth/
├── cordis.yml            # Windows 挂载模板（file:/// URL）
├── cordis-401.yml        # 401 变体模板
├── cordis-403.yml        # 403 变体模板
├── cordis.linux.yml      # Linux 挂载模板（绝对路径）
├── package.json
├── src/
│   ├── index.ts          # 插件入口：name/inject/apply/Config
│   ├── auth-handler.ts   # Bearer 校验器
│   ├── token.ts          # 密钥解析 + 时序安全比对
│   ├── endpoints.ts      # 内置端点清单
│   ├── forward.ts        # 转发桥接（流式 + 背压 + 上限）
│   └── inject.ts         # index.html 鉴权脚本注入
└── tests/                # node:test 单测
```
