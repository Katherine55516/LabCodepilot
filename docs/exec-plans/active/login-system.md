# 登录账号体系（managed-account login）

> 创建时间：2026-05-20
> 最后更新：2026-05-20
> Worktree：`beautiful-bhabha-c4a178`
> 关联：源自 bsApp 项目的 `LOGIN_SYSTEM_MIGRATION.md`（位于该项目本地副本）

## 目标

为 CodePilot 引入一套**与现有 BYOK Provider 体系并存**的登录账号机制：
- 用户走系统浏览器 OAuth 登录后端账号
- 服务端下发 `ModelConfig` 列表 → 镜像到 `api_providers` 表（`source='managed'`）
- 与现有 OpenAI OAuth 模块**完全分离**（不同 token 存储、不同回调端口、不同 UI 入口）
- 启动时**强制登录**（关掉登录窗 = app.quit），不再支持跳过 — 见决策日志 2026-05-21

BACKEND_BASE：
- Prod：`https://code-agent.ai-native-lab.com`
- Dev：`http://localhost:8080`
- 覆盖：`process.env.BACKEND_BASE`

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 基础设施：types/config/storage/http/callback-server + DB 迁移 + 单元测试 | ✅ 已完成 | 29 个单测全过 |
| Phase 2 | 主进程集成：client/managed-providers/login-window/poller + broker + main.ts IPC + login HTML | ✅ 已完成 | typecheck 干净 |
| Phase 3 | Renderer UI：UserMenu/AccountSection/ManagedConfigsList + i18n + ProviderManager 适配 + NavRail/Settings 接入 | ✅ 已完成 | AccountCard for SetupCenter 未接入（保留作为可选增强） |
| Phase 4 | provider-resolver 识别 managed source（无需代码改动）+ managed-providers 映射修正 + 单测 | ✅ 已完成 | 7 个映射测试全过 |
| Phase 5 | handover/insights 文档完成 | ✅ 已完成 | E2E 手动验证待用户在打包环境执行 |

## 决策日志

- **2026-05-20**：方案审阅通过，关键决策已固化：
  - 与现有 BYOK Provider 管理**并存**（不替代）；ModelConfig 映射进 `api_providers` 表
  - 服务端复用 bsApp 项目后端（prod `code-agent.ai-native-lab.com` / dev `localhost:8080`）
  - 登录用**独立 BrowserWindow**（非主窗内嵌）
  - Token 持久化到 `~/.codepilot/anlcode/session_token`（文件 + 0600），main 进程和 Next.js standalone server 共享读取
  - 启动**不强制**弹登录窗（与文档原方案不同），用户主动从 UserMenu / SetupCenter / Settings 触发
  - DB schema 改动：`api_providers` 加 3 列（`source` / `managed_config_id` / `managed_extra_json`）
  - **不接 `/api/v1/updates/check`** 轮询：避免与 `electron-updater` 重复
  - **与 OpenAI OAuth 完全分离**：不复用 `openai-oauth*.ts` 任何代码、token、UI 入口、回调端口

- **2026-05-21**：登录从「可选」改为「强制」：
  - 触发：用户改主意，希望未登录用户无法使用应用（产品主张：本应用是登录账号的客户端）
  - 改动：
    - `bootAccountState`：当 `tryUseCachedToken().alive === false` 时，**阻塞**调用 `openLoginWindow({ allowSkip: false })`；用户关掉登录窗 → `app.quit()`
    - `main.ts` 启动序列：把主窗 `loadURL(server)` 推迟到 `await bootAccountState()` 之后；登录期间主窗保持 LOADING_HTML
    - Bridge auto-start 同步推迟到登录之后（避免未登录的远程通道被预热）
  - 受影响行为：
    - 离线模式仍可用，但必须**已经登录过**（有 cached token + 探活网络失败时才离线启动）
    - `auth.skipForNow` i18n 键、login.js 的 skip 按钮代码保留但用不到（hide-UI 模式，便于回滚）
    - 与 BYOK 并存（不变）：登录后仍可同时使用本地 BYOK provider 和 managed provider

## 详细设计

### 数据模型

**`api_providers` 表新增 3 列**（在 db.ts migrations 中追加，幂等 `safeAddColumn`）：

```sql
ALTER TABLE api_providers ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE api_providers ADD COLUMN managed_config_id TEXT NOT NULL DEFAULT '';
ALTER TABLE api_providers ADD COLUMN managed_extra_json TEXT NOT NULL DEFAULT '{}';
```

- `source`：`'local'`（BYOK）/ `'managed'`（账号下发）
- `managed_config_id`：服务端 `ModelConfig.id` 原值，用作 upsert 的 lookup key（DB row id 用 `managed-{managed_config_id}` 前缀避免与本地 id 冲突）
- `managed_extra_json`：保留 ModelConfig 中 CodePilot 字段无法覆盖的部分（`default_opus_model`/`default_sonnet_model`/`default_haiku_model`/`subagent_model`/`effort_level`/`extra`），存原始 JSON 以便协议演进

**Settings 表新增 keys**（KV，无需 schema 改动）：

| Key | 含义 |
|---|---|
| `account.me_json` | `/api/v1/me` 缓存（renderer 通过 IPC 拿快照） |
| `account.is_offline` | `'true'/'false'` 当前是否离线模式 |
| `account.last_probe_at` | 上次探活时间（毫秒时间戳） |
| `account.config_version` | 服务端配置版本号（轮询比对） |

> **Token 不进 SQLite**，与 OpenAI OAuth（token 存 settings）刻意区分。

**本地文件**（`~/.codepilot/anlcode/`）：

| 文件 | 内容 | 权限 |
|---|---|---|
| `session_token` | Bearer | 0600 |
| `device_id` | UUID | 默认 |
| `configs.json` | ModelConfig[] 镜像 | 默认 |
| `configs.hash` | ETag/hash | 默认 |
| `selected_config_id` | 用户选中的 managed config id | 默认 |

### 模块清单

```
electron/
├── main.ts                                [改] 启动序列 + IPC handlers + bootAccountState
├── preload.ts                             [改] electronAPI.auth namespace
└── auth/
    ├── types.ts                           [新] MeInfo/ModelConfig/AuthSnapshot/NetworkError/AuthExpiredError
    ├── config.ts                          [新] getBackendBase()
    ├── paths.ts                           [新] anlcode 目录解析
    ├── storage.ts                         [新] token/device_id/configs/selected_config_id 文件 I/O
    ├── http.ts                            [新] apiRequest + Bearer 注入 + probeAuthStatus
    ├── callback-server.ts                 [新] 临时 127.0.0.1 HTTP server
    ├── client.ts                          [新] loginViaBrowser / fetchMe / registerDevice / getConfigs / anlLogout
    ├── managed-providers.ts               [新] ModelConfig[] ↔ api_providers upsert+prune
    ├── poller.ts                          [新] 10min configs hash 轮询
    ├── login-window.ts                    [新] 独立 BrowserWindow 生命周期
    └── log.ts                             [新] token 脱敏 + 日志包装

electron/login/                            [新建] 登录窗静态资源
├── index.html
├── login.js
└── login-style.css

src/lib/
├── auth-shared/                           [新建] 主进程与 Next.js server 共享
│   └── paths.ts                           [新] anlcode 目录解析（HOME → ~/.codepilot/anlcode）
└── provider-resolver.ts                   [改] 识别 source='managed' 走 anthropic protocol（不依赖 openai-oauth）

src/app/api/auth/                          [新建] 仅 renderer ↔ main 桥接（仅必要时）
src/components/
├── account/                               [新建]
│   ├── UserMenu.tsx                       [新]
│   ├── AccountSection.tsx                 [新]
│   └── ManagedConfigsList.tsx             [新]
├── setup/AccountCard.tsx                  [新]
└── layout/Header.tsx                      [改] 嵌入 UserMenu

src/hooks/useAccount.ts                    [新]
src/types/{index,electron}.ts              [改] ApiProvider 加列 + electronAPI.auth 声明
src/i18n/{en,zh}.ts                        [改] auth.* 命名空间
src/lib/db.ts                              [改] 迁移 + getProvidersBySource/setManagedProviders
```

### IPC 协议

`main → renderer`：
- `auth:changed`（push）：状态变化时推送 `AuthSnapshot`

`renderer → main`：
- `auth:get-state` → `AuthSnapshot`
- `auth:trigger-login` → `{ ok: boolean; error?: string }`
- `auth:logout` → `{ ok: true }`
- `auth:refresh-configs` → `{ ok: boolean; count: number; error?: string }`
- `auth:probe` → `{ alive: boolean; offline: boolean }`

`AuthSnapshot` 结构（**不含 token**）：
```ts
{
  authenticated: boolean
  offline: boolean
  me: { username: string; display_name: string; email?: string; plan?: string } | null
  managedConfigCount: number
}
```

### 启动序列

```
app.whenReady()
  ├─ 现有：loadUserShellEnv / resolveSystemProxy / ABI check / 缓存清理
  ├─ 注册 IPC handlers（含 auth handlers）
  ├─ 现有：startServerOnStablePort → createWindow → loadURL(server)
  │     ↑ 主窗立即显示，不阻塞登录流程
  ├─ 异步 bootAccountState()：
  │     ├─ tryUseCachedToken()
  │     │     ├─ 无 token → 状态 = unauthenticated（不弹窗）
  │     │     ├─ 探活 200 → fetchMe → registerDevice → getConfigs(force=true) → syncManagedProviders → start poller
  │     │     ├─ 探活 401 → 清 token + purgeManagedProviders → unauthenticated + 推送 'auth:changed'
  │     │     └─ 探活网络错 → 加载 configs.json + me_json → authenticated+offline
  │     └─ webContents.send('auth:changed', state)
  └─ 现有：bridge auto-start
```

用户主动登录：`window.electronAPI.auth.triggerLogin()` → main 起登录窗 + callback server → 完成后跑同样的 fetchMe/registerDevice/getConfigs 序列。

### 与 OpenAI OAuth 隔离边界

| 维度 | OpenAI OAuth（保留） | 本方案（managed-account） |
|---|---|---|
| Token 存储 | `settings` 表 | `~/.codepilot/anlcode/session_token` 文件 |
| 回调端口 | 固定 1455 | `listen(0)` 随机 |
| Callback 路径 | `/auth/callback` | `/cb` |
| OAuth 流程 | PKCE 自实现 | 服务端 OAuth gateway（仅 state） |
| 入口位置 | ProviderManager 内 OpenAI Codex 卡片 | UserMenu / SetupCenter / Settings 独立"账号"分区 |
| Provider 注册方式 | 虚拟 provider，provider-resolver 内部 ensureTokenFresh | `api_providers` 表实体 row + source='managed' |
| 代码命名前缀 | `openai-oauth*` / `openaiOAuth*` | `electron/auth/*` / `accountLogin*` / `managedProvider*` |
| 用户菜单 | 设置页 OpenAI 卡片"重新授权" | UserMenu 顶部"登录/登出"+ Settings"账号" |

**严格不互相 import**。新增 ESLint 约束在 PR 评审中检查。

### 安全

| 风险 | 缓解 |
|---|---|
| token 泄漏 renderer | preload 只暴露 AuthSnapshot 脱敏快照，不导出 token |
| token 进日志 | `electron/auth/log.ts` 全局脱敏（前 8 位 + `...`），按需在 runtime-log.ts 加关键字 |
| callback server 暴露 | 严格 `listen(port, '127.0.0.1')` |
| state CSRF | 32 字节 hex random，回调严格比对 |
| Worktree 开发污染 | Worktree 内启动会共享 `~/.codepilot/anlcode/`，开发期约束：单实例运行 |

### 测试与验证

每个 Phase 必须通过：
- `npm run test`（typecheck + 单测）
- 涉及 UI 改动跑 `npm run test:smoke`
- Phase 2/3：chrome-devtools MCP 验证（截图 + console 无错）

手动专项（Phase 5 收尾）：
- 全新装机：删 anlcode/ → Header 点登录 → 浏览器 → 回调 → 主窗 UserMenu 显示
- 缓存复用：再启动免登录
- 离线：断网启动 → UI 显示离线 + 可用本地 configs
- CSRF：手改 state → 拒绝
- token 失效：篡改 session_token → 启动提示重登
- 切账号：登出 → 登录别号 → managed providers 替换（旧的被 prune）
- 双模式：BYOK + managed 同时存在，UI 正确标识
- 登出后 BYOK 仍可用

## Phase 详细任务

### Phase 1：基础设施

**目标**：所有不依赖 Electron app 实例的纯逻辑模块完成 + 单测通过 + DB 迁移生效。

任务：
- [ ] `electron/auth/types.ts`：MeInfo / ModelConfig / AuthSnapshot / AuthProbeResult / NetworkError / AuthExpiredError
- [ ] `electron/auth/config.ts`：getBackendBase()（含 env / packaged 分支）
- [ ] `electron/auth/paths.ts`：getAnlcodeDir()（基于 `app.getPath('userData')` 或 `~/.codepilot`）
- [ ] `electron/auth/log.ts`：maskToken / maskConfigsForLog
- [ ] `electron/auth/storage.ts`：所有文件 I/O
- [ ] `electron/auth/http.ts`：apiRequest + probeAuthStatus
- [ ] `electron/auth/callback-server.ts`：startCallbackServer
- [ ] `src/lib/auth-shared/paths.ts`：与 electron/auth/paths.ts 同源（避免 import electron）
- [ ] `src/lib/db.ts`：migrations 加 3 列 + `getProvidersBySource(source)` / `setManagedProviders(configs)` 函数
- [ ] `src/types/index.ts`：ApiProvider 加 source / managed_config_id / managed_extra_json
- [ ] 单元测试：`src/__tests__/unit/auth-storage.test.ts`, `auth-http.test.ts`, `auth-callback.test.ts`, `managed-providers.test.ts`
- [ ] `npm run test` 通过

### Phase 2：主进程集成 + 登录窗

**目标**：用户能从 IPC 触发登录，完成 OAuth 后 token 落盘 + managed providers 写入 DB。

任务：
- [ ] `electron/auth/client.ts`：loginViaBrowser / fetchMe / registerDevice / getConfigs / pickSelectedConfig / anlLogout
- [ ] `electron/auth/managed-providers.ts`：syncManagedProviders / purgeManagedProviders（事务 upsert + prune）
- [ ] `electron/auth/login-window.ts`：openLoginWindow（resolve `'success' | 'skipped' | 'cancelled'`）
- [ ] `electron/auth/poller.ts`：startBackgroundPolling（仅 configs hash，**无 updates**）
- [ ] `electron/login/index.html` + `login.js` + `login-style.css`
- [ ] `electron/main.ts`：注册 auth IPC handlers + bootAccountState + Sentry.setUser
- [ ] `electron/preload.ts`：暴露 electronAPI.auth
- [ ] `src/types/electron.d.ts`：声明 ElectronAuthAPI
- [ ] `electron-builder.yml`：确保 `electron/login/**` 打进 app
- [ ] 手动验证：从 DevTools console 调用 `window.electronAPI.auth.triggerLogin()` 走通登录

### Phase 3：Renderer UI

**目标**：用户能从 UI 入口登录/登出/查看账号信息。

任务：
- [ ] `src/i18n/{en,zh}.ts`：auth.* 命名空间
- [ ] `src/hooks/useAccount.ts`
- [ ] `src/components/account/UserMenu.tsx`：顶栏头像 + 下拉菜单
- [ ] `src/components/account/AccountSection.tsx`：设置页"账号"分区
- [ ] `src/components/account/ManagedConfigsList.tsx`：只读列表
- [ ] `src/components/setup/AccountCard.tsx`：SetupCenter 新卡片
- [ ] `src/components/layout/Header.tsx`：嵌入 UserMenu
- [ ] `src/components/settings/ProviderManager.tsx`：managed source 标识 + 禁用编辑/删除
- [ ] `npm run test`
- [ ] `npm run test:smoke`
- [ ] chrome-devtools 截图验证（暗/亮主题、登录/未登录/离线三态）

### Phase 4：provider-resolver 集成

**目标**：选中 managed provider 后能正常发起 chat。

任务：
- [ ] `src/lib/provider-resolver.ts`：识别 source='managed' 时走 anthropic protocol（用 row 里 api_key，不读 session_token）
- [ ] 端到端测试：登录 → managed provider 在 ProviderManager 显示 → 设为活跃 → 发起 chat → 成功收到流式响应
- [ ] 双模式测试：local + managed 同时存在，切换正常
- [ ] `npm run test`

### Phase 5：离线 + 轮询 + 边界 + 文档

**目标**：所有边界场景符合预期；文档完整。

任务：
- [ ] 离线模式 UI（UserMenu 显示离线点）
- [ ] 启动 + 后台 10min 轮询（仅 configs hash）
- [ ] 登出清理：anlLogout / purgeManagedProviders / clearAuthState / Sentry.setUser(null) / 推送 'auth:changed' / 自动切回本地 provider
- [ ] token 失效提示：401 时 UI toast + 重登入口
- [ ] 切账号验证：登出 → 登录别号 → managed prune 正确
- [ ] `docs/handover/login-system.md`：架构、IPC、协议、存储路径、与 OpenAI OAuth 隔离边界
- [ ] `docs/insights/login-system.md`：为什么做、为什么这么做（并存 vs 替代、文件 vs DB token、独立窗 vs 嵌入）
- [ ] CLAUDE.md / ARCHITECTURE.md 不需要改（不引入新顶层概念）
- [ ] 全部手动专项测试通过

## 风险与待定

- **服务端实测**：BACKEND_BASE 在 dev / prod 下行为是否完全一致（Phase 1 http.ts 单测时先 curl 实际端点验证）
- **device_id 与 ChannelBindings**：channel_bindings 表里也有 device 概念，初步判断无关；Phase 5 收尾时复核
- **Sentry user 关联**：登录后 setUser({ id, email })，登出 setUser(null)
- **Worktree 隔离**：开发期共用 `~/.codepilot/anlcode/`，约束单实例运行
