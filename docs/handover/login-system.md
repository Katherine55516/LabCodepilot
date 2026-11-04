# 登录账号体系（managed-account login）

> 产品思考见 [docs/insights/login-system.md](../insights/login-system.md)
>
> 关联执行计划：[docs/exec-plans/active/login-system.md](../exec-plans/active/login-system.md)

AI Native Lab 的远程账号登录体系。用户在系统浏览器完成 OAuth 后，服务端把 `ModelConfig[]` 推下来，镜像到 `api_providers` 表（`source='managed'`），与 BYOK provider 并存。**与现有 OpenAI OAuth 模块（src/lib/openai-oauth*.ts）完全隔离**。

## 架构

```
┌─────────────────── Electron App ──────────────────────────────┐
│                                                                │
│  ┌─────────────────┐         ┌──────────────────────────────┐ │
│  │ Renderer        │  IPC    │  Main Process                │ │
│  │ (Next.js UI)    │ ──────► │                              │ │
│  │                 │ ◄────── │  ┌────────────────────────┐  │ │
│  │ UserMenu        │ 'auth:* │  │ Auth in-memory state   │  │ │
│  │ AccountSection  │  channels│ │  - currentMe           │  │ │
│  │ ProviderManager │         │  │  - isOfflineMode       │  │ │
│  │ (managed tag)   │         │  │  - managedConfigCount  │  │ │
│  └─────────────────┘         │  └────────────────────────┘  │ │
│         ▲                    │                              │ │
│         │ /api/auth/         │  ┌────────────────────────┐  │ │
│         │ managed-providers/*│  │ electron/auth/         │  │ │
│         │ (server-side       │  │  ├─ client.ts          │  │ │
│         │  DB ops)           │  │  ├─ http.ts (Bearer)   │  │ │
│         ▼                    │  │  ├─ callback-server.ts │  │ │
│  ┌─────────────────┐         │  │  ├─ login-window.ts    │  │ │
│  │ Next.js server  │ ◄──HTTP─│  │  ├─ poller.ts          │  │ │
│  │ utility process │ broker  │  │  ├─ broker.ts          │  │ │
│  │ better-sqlite3  │         │  │  ├─ managed-providers  │  │ │
│  └─────────────────┘         │  │  └─ storage.ts (fs)    │  │ │
│         ▲                    │  └────────────────────────┘  │ │
│         │                    └──────────────────────────────┘ │
│         │ Both processes read                                  │
│         │ ~/.codepilot/anlcode/* (token / configs / device id) │
└─────────│──────────────────────────────────────────────────────┘
          │                            │ shell.openExternal
          ▼                            ▼
┌─────────────────────┐    ┌──────────────────────────────┐
│ codepilot.db        │    │ System browser → OAuth       │
│ (api_providers      │    │ ${BACKEND_BASE}/auth/cli/start│
│  has source col)    │    │  → 303 → 127.0.0.1:N/cb      │
└─────────────────────┘    └──────────────────────────────┘
```

## 关键决策

| 决策 | 理由 |
|---|---|
| Token 存文件 `~/.codepilot/anlcode/session_token`（0600），不进 SQLite | 两进程共享需要文件；与 OpenAI OAuth 把 token 存 settings 表的策略刻意区分；权限位提供基础保护 |
| OAuth callback 用 `listen(0)` 随机端口 | 避免与 OpenAI OAuth 固定的 1455 端口冲突，多次登录互不影响 |
| ModelConfig 镜像到 api_providers + `source` 列区分 | 复用现有 provider-resolver 全套逻辑（env 注入、role 模型映射）；不引入新代码路径 |
| main 进程**不直接读 better-sqlite3** | ABI 锁在 Electron 运行时，server utility process 是 DB 唯一写者；main 通过本机 HTTP（broker.ts）调 `/api/auth/managed-providers/*` |
| 启动**不强制**弹登录窗 | 用户决策：与 BYOK 并存；不打扰已配 BYOK 的存量用户 |
| 不轮询 `/api/v1/updates/check` | `electron-updater` 已经负责更新通道，避免双通道 |

## 模块清单

### 主进程（electron/auth/）

| 文件 | 职责 |
|---|---|
| `types.ts` | ModelConfig / MeInfo / AuthSnapshot / NetworkError / AuthExpiredError |
| `config.ts` | `getBackendBase()` — prod `code-agent.ai-native-lab.com` / dev `localhost:8080` / `process.env.BACKEND_BASE` 覆盖 |
| `paths.ts` | `getAnlcodeDir()` — `{CLAUDE_GUI_DATA_DIR \|\| ~/.codepilot}/anlcode/` |
| `log.ts` | `maskToken()` / `maskConfigsForLog()` 脱敏 |
| `storage.ts` | session_token / device_id / configs.json / configs.hash / selected_config_id 文件 I/O |
| `http.ts` | `apiRequest<T>()` Bearer 注入 + AbortController 超时 + 三态 `probeAuthStatus()` |
| `callback-server.ts` | `startCallbackServer(expectedState)` — 临时 127.0.0.1:0 server + state 校验 |
| `client.ts` | `loginViaBrowser` / `fetchMe` / `registerDevice` / `getConfigs(force?)` / `pickSelectedConfig` / `anlLogout` |
| `managed-providers.ts` | `modelConfigToManagedProviderRow` 字段映射（pure） |
| `broker.ts` | main ↔ Next.js server HTTP 桥（`syncManagedProvidersToServer` / `purgeManagedProvidersOnServer` / `getManagedProviderCountFromServer`） |
| `login-window.ts` | 独立 BrowserWindow 生命周期 + `'success'\|'skipped'\|'cancelled'` 三态 |
| `poller.ts` | 10 分钟 configs hash 后台轮询（**无 updates 轮询**） |

### 静态资源（electron/login/）

`index.html` + `login.js` + `login-style.css` — 480x460 独立窗口，单按钮 + 可选 skip 链接。electron-builder 配置已加入 `extraResources` 把整个目录复制到 `Resources/login/`。

### 数据层（src/lib/）

- `lib/db.ts` 新增列（含幂等 `safeAddColumn` 迁移）：
  - `source TEXT NOT NULL DEFAULT 'local'`
  - `managed_config_id TEXT NOT NULL DEFAULT ''`
  - `managed_extra_json TEXT NOT NULL DEFAULT '{}'`
  - 索引：`idx_api_providers_managed_config_id`
- 新增函数：
  - `getProvidersBySource(source: 'local'|'managed'): ApiProvider[]`
  - `setManagedProviders(rows: ManagedProviderRow[]): { upserted, pruned }` — 事务内 upsert + prune
  - `purgeManagedProviders(): number`
- `lib/auth-shared/paths.ts` — `getAnlcodeDir()` 的 server 端镜像（**与 electron 端不共享代码**，仅文档约定一致）

### API 路由（src/app/api/auth/）

| 路由 | 方法 | 调用方 | 行为 |
|---|---|---|---|
| `/api/auth/managed-providers/sync` | POST | main 进程 (broker) | 接收 `ManagedProviderRow[]` → `setManagedProviders` |
| `/api/auth/managed-providers/purge` | POST | main 进程 (broker) | `purgeManagedProviders()` |
| `/api/auth/managed-providers/count` | GET | main 进程 (broker) | 返回 managed 行数 |

> 安全：Next.js server 只监听 127.0.0.1（main.ts 设 `HOSTNAME: '127.0.0.1'`），外部不可达；renderer 也能访问这些端点但是 trusted。

### IPC 协议（electron/preload.ts 暴露 `window.electronAPI.auth`）

| Channel | 方向 | Payload | 返回值 |
|---|---|---|---|
| `auth:run-login-flow` | renderer→main | (无) | `{ ok: true } \| { ok: false, error: string }` |
| `auth:skip-login` | renderer→main | (无) | `{ ok: true }` |
| `auth:get-state` | renderer→main | (无) | `AuthSnapshot`（不含 token） |
| `auth:trigger-login` | renderer→main | (无) | `{ ok, outcome?, error? }` |
| `auth:logout` | renderer→main | (无) | `{ ok: true }` |
| `auth:refresh-configs` | renderer→main | (无) | `{ ok, count?, error? }` |
| `auth:probe` | renderer→main | (无) | `{ alive, offline }` |
| `auth:changed` | main→renderer (push) | `AuthSnapshot` | — |

`AuthSnapshot` 结构：

```ts
{
  authenticated: boolean
  offline: boolean
  me: { username, display_name, email?, plan? } | null
  managedConfigCount: number
}
```

**Token 永不进 IPC**，只有脱敏用户信息暴露给 renderer。

## 启动序列

**强制登录**：主窗 `loadURL(server)` 被推迟到 `bootAccountState` 完成之后；未登录用户永远卡在登录窗 / LOADING_HTML，不会看到任何应用 UI。

```
app.whenReady()
  ├─ 现有：loadUserShellEnv / resolveSystemProxy / ABI check
  ├─ 注册所有 IPC handlers（含 auth:*）
  ├─ createWindow()  ← 仅显示 LOADING_HTML，不指向 server
  ├─ startServerOnStablePort()  ← server 端口落定
  ├─ setBrokerServerPort(serverPort)
  ├─ ★ await bootAccountState()  ← 阻塞，强制门
  │     ├─ probe 200          → fetchMe → registerDevice → getConfigs(force) → syncManagedFromConfigs → start poller
  │     ├─ probe 网络错        → 用 configs.json 缓存 + isOfflineMode=true（仅在已有 token 时）
  │     ├─ probe 401 / 无 token → openLoginWindow({ allowSkip: false })
  │     │       ├─ 'success'   → IPC handler 已跑过 postLoginSequence，broadcast → 返回
  │     │       └─ 其他（cancelled/skipped） → app.quit()
  ├─ mainWindow.loadURL(server)  ← 此时才把主窗指向真正的 UI
  └─ 现有：bridge auto-start  ← 也在登录之后，避免未登录预热远程通道
```

## 字段映射

```
ModelConfig (server)          api_providers row (DB)
─────────────────────         ──────────────────────────
id                          → managed_config_id (列)
                              + id = "managed-{id}" (前缀防碰撞)
name                        → name
description                 → notes
base_url                    → base_url
auth_token                  → api_key
sort_order                  → sort_order
                              + provider_type/protocol 硬编码 'anthropic'
model                       → role_models_json.default → ANTHROPIC_MODEL
default_opus_model          → role_models_json.opus    → ANTHROPIC_DEFAULT_OPUS_MODEL
default_sonnet_model        → role_models_json.sonnet  → ANTHROPIC_DEFAULT_SONNET_MODEL
default_haiku_model         → role_models_json.haiku   → ANTHROPIC_DEFAULT_HAIKU_MODEL
subagent_model              → env_overrides_json       → CLAUDE_CODE_SUBAGENT_MODEL
effort_level                → env_overrides_json       → CLAUDE_CODE_EFFORT_LEVEL
extra (free-form)           → managed_extra_json.extra
完整原始对象                 → managed_extra_json.raw (forward-compat)
```

## 与 OpenAI OAuth 的隔离边界

严格不互相 import；不共享 token 存储、回调端口、UI 入口、命名前缀。

| 维度 | OpenAI OAuth（保留） | 本系统 |
|---|---|---|
| Token 存储 | `settings` 表（DB） | `~/.codepilot/anlcode/session_token`（文件 0600） |
| 回调端口 | 固定 1455 | `listen(0)` 随机 |
| Callback 路径 | `/auth/callback` | `/cb` |
| OAuth 流程 | PKCE 自实现 | 服务端 OAuth gateway（只校验 state） |
| 入口位置 | ProviderManager 内 OpenAI Codex 卡片 | NavRail 底部 UserMenu / Settings/Account 分区 |
| Provider 注册 | 虚拟 provider，resolver 内 ensureTokenFresh | `api_providers` 实体行 + `source='managed'` |
| 代码命名 | `openai-oauth*` | `electron/auth/*` / `account*` / `managed*` |

## 本地文件存储

`~/.codepilot/anlcode/`：

| 文件 | 内容 | 权限 |
|---|---|---|
| `session_token` | Bearer | 0600（Unix 生效，Windows 忽略 chmod 错误） |
| `device_id` | 稳定 UUID（首次生成）| 默认 |
| `configs.json` | ModelConfig[] 镜像 | 默认 |
| `configs.hash` | ETag/hash | 默认 |
| `selected_config_id` | 用户选中的 managed config id | 默认 |

**登出**清 `session_token` + `selected_config_id`（保留 `device_id` 和 `configs.json`，下次登录回归更快）。
**全新重置**：`clearAll()` 删整个 `anlcode/` 目录。

### 登出行为（强制登录配套）

`auth:logout` IPC handler 完成 `anlLogout()` + `postLogoutSequence()` 后会 fire-and-forget 调 `rePromptLoginAfterLogout()`：

1. `mainWindow.loadURL(LOADING_HTML)` — 把主窗内容换成 loading 占位，旧 React tree 销毁
2. `openLoginWindow({ allowSkip: false })` 阻塞等待
3. `'success'` → `mainWindow.loadURL(serverURL)` 回到主界面（postLoginSequence 已在 `auth:run-login-flow` 内跑过）
4. 其他结局（cancelled）→ `app.quit()`

这样**应用永远不会处于"主窗可见但未登录"的状态**，与启动 gate 对称。代价：切账号体验是"退出 → 立刻看到登录窗 → 重登"，不需要重启进程。

## 错误处理矩阵

| 场景 | 检测 | 行为 |
|---|---|---|
| 无 token 启动 | `loadToken() === null` | unauthenticated；UI 显示登录入口 |
| 探活 401 | `apiRequest` 抛 `AuthExpiredError` | 清 token + purge managed + push 'auth:changed' |
| 网络完全不通 | `fetch` 抛错 → `NetworkError` | `offline: true`；用 `configs.json` 缓存 |
| 服务端 5xx | `apiRequest` 抛 `Error('HTTP 500')` | 启动序列 catch + console.warn 继续 |
| state 不匹配（CSRF）| callback-server 比对 | `rejecter(new Error('state mismatch'))` |
| callback server 超时 | `waitForCallback(10 min)` 超时 | reject + UI 显示"超时，请重试" |
| 用户关登录窗 | `loginWindow.on('closed')` | `settleOutcome('cancelled')` — **不退应用**（与并存模式一致）|

## 单元测试

| 文件 | 覆盖 |
|---|---|
| `auth-log.test.ts` | `maskToken` / `maskConfigsForLog` |
| `auth-storage.test.ts` | token/device_id/configs/selected_config_id 文件 I/O + 0600 权限 + clearAuthState/clearAll |
| `auth-callback-server.test.ts` | state 校验 / OAuth error / 超时 / 404 / 127.0.0.1 绑定 |
| `auth-managed-providers-map.test.ts` | `modelConfigToManagedProviderRow` 字段映射、env_overrides、id 前缀 |
| `db-managed-providers.test.ts` | `setManagedProviders` upsert/prune 事务、保护 local 行、`purgeManagedProviders` |

总计 50+ 测试用例。

## 待手动验证（不在自动化范围）

需要真实 BACKEND_BASE 服务端 + 已打包的 Electron 环境：

- 全新装机：删 `~/.codepilot/anlcode/` → 启动 → UserMenu 点登录 → 浏览器 → 回调 → 主窗 UserMenu 显示用户名
- 缓存复用：再启动免登录
- 离线场景：拔网线 + 已有 token → UI 显示离线 + 仍能进主界面
- CSRF：手改 callback state → 浏览器显示错误页 + main 拒绝
- token 失效：篡改 `session_token` 文件 → 启动应清状态并显示重登入口
- 切账号：登出 → 登录别号 → managed providers 替换（旧的被 prune）
- 双模式：BYOK + managed 同时存在，UI 正确区分
- 登出后 BYOK 仍可用
- 选 managed provider 发起 chat → SDK env 包含 base_url / auth_token / role 模型 / CLAUDE_CODE_EFFORT_LEVEL / CLAUDE_CODE_SUBAGENT_MODEL

## 已知约束

- **Worktree 开发期**：共用 `~/.codepilot/anlcode/`，单实例运行。两个 Worktree 同时启动会争抢 token 文件
- **better-sqlite3 ABI**：本机开发环境如果跳过 node-gyp 编译，跑 `db-managed-providers.test.ts` 会因 ABI 不匹配失败（与现有 `db-shutdown.test.ts` 相同）；CI 上正常
- **Sentry**：登录/登出时未调用 `Sentry.setUser` — 后续可加（属于增强项）
- **效率**：`getManagedProviderCountFromServer` 每次 push 'auth:changed' 时不会自动 refresh，managedConfigCount 只在 `syncManagedFromConfigs` 时更新
