# 测试账号设置（Test Account Settings）

> 产品思考见 [docs/insights/test-account-settings.md](../insights/test-account-settings.md)
> 执行计划见 [docs/exec-plans/active/test-account-settings.md](../exec-plans/active/test-account-settings.md)

设置页内新增「测试账号」面板，配置测试时访问的**系统 → 环境（local/SIT）→ 登录账号**，并导出到 AI_LabTest 的 `environments.json`（含 `.auth/` 登录态文件）供 AI_LabTest 测试框架消费。对标 AI_LabTest 桌面端「环境配置」对话框，但**支持多个系统**。

## 入口

- 应用最左侧导航栏齿轮图标（`NavRail.tsx` / `ChatListPanel.tsx` 的 `/settings` 链接）→ 设置页 → 左侧子栏「测试账号」。
- Hash 直达：`/settings#test-accounts`（与 `#cli`、`#bridge` 同机制，`SettingsLayout` 的 `sidebarItems` 自动支持）。

## 目录结构 / 文件清单

**新增**
| 文件 | 角色 |
|------|------|
| `src/components/settings/TestAccountsSection.tsx` | 面板组件（系统下拉 + local/SIT 标签 + 账号编辑 + 三种登录方式 + 抓取流程 + 脏标记保存 + 实时导出预览） |
| `src/app/api/test-accounts/route.ts` | `GET`（列系统）/ `POST`（建系统） |
| `src/app/api/test-accounts/[id]/route.ts` | `GET` / `PUT` / `DELETE`（单系统） |
| `src/app/api/test-accounts/[id]/export/route.ts` | `POST`：写 `{project_root}/AI_LabTest/environments.json` |
| `src/lib/test-accounts-export.ts` | 纯函数：内部模型 → environments.json（`toEnvironmentsJson`）+ `sanitizeAccountKey`。**前端预览与后端导出同源**，无逻辑漂移 |
| `electron/test-auth-capture/capture-window.ts` | 获取登录态：BrowserWindow 抓取 cookie+localStorage → Playwright storageState 文件 |
| `src/__tests__/unit/test-accounts-export.test.ts` | 锁死 environments.json 契约的单测（9 用例） |

**修改**
| 文件 | 改动 |
|------|------|
| `src/components/settings/SettingsLayout.tsx` | 注册 section（`Section` 类型 + `sidebarItems` + `settingsLabelKeys` + 渲染分支 + 导入 + `ListChecks` 图标） |
| `src/lib/db.ts` | `test_account_systems` 表 + CRUD 助手（`getAll/get/create/update/deleteTestAccountSystem` + `normalizeTestEnv`/`rowToTestSystemView`） |
| `src/types/index.ts` | `// ===== Test Accounts =====` 类型区块 |
| `src/types/electron.d.ts` | `testAuthCapture` namespace 类型 |
| `src/i18n/en.ts` / `zh.ts` / `zh-HK.ts` | `settings.testAccounts` + `testAccounts.*` 命名空间 |
| `electron/main.ts` | `test-auth-capture:*` 五个 ipcMain handler + 导入 |
| `electron/preload.ts` | `testAuthCapture` contextBridge namespace |

## 数据模型与持久化

**SQLite 表 `test_account_systems`**（一行一系统，明文）：

```sql
CREATE TABLE IF NOT EXISTS test_account_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_root TEXT NOT NULL DEFAULT '',      -- AI_LabTest 工作区目录（导出目标）
  sort_order INTEGER NOT NULL DEFAULT 0,
  environments_json TEXT NOT NULL DEFAULT '{}', -- { local: TestEnvironment, sit: TestEnvironment }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

DB 仅本机（`~/.codepilot/codepilot.db`），密码/token **明文**存储（与 AI_LabTest 一致，用户已确认）。**登录态 blob 不入库** —— 真值是 `.auth/*.storageState.json` 文件存在性；DB 只存可编辑配置 + 一个 `captured`/`capturedAt` UI 缓存标志。

类型（`src/types/index.ts`）：`TestAccountSystem`（DB 行）、`TestAccountSystemView`（environments 已解析）、`TestSystemEnvironments`、`TestEnvironment`、`TestLoginAccount`、`TestAuthMethod = 'password' | 'token' | 'capture'`、`TestTokenStorage`、`Create/UpdateTestAccountSystemRequest`。

## 数据流

```
渲染端 TestAccountsSection
  ├─ GET/POST /api/test-accounts           列/建系统
  ├─ PUT/DELETE /api/test-accounts/[id]    存/删系统（脏标记 → PUT）
  ├─ POST /api/test-accounts/[id]/export   写 environments.json（先自动保存脏改动）
  │     └─ db.getTestAccountSystem → toEnvironmentsJson → fs.writeFile({root}/AI_LabTest/environments.json)
  └─ window.electronAPI.testAuthCapture.*  获取登录态（仅 Electron）
        └─ ipcMain test-auth-capture:* → electron/test-auth-capture/capture-window.ts
              └─ BrowserWindow 抓取 → fs.writeFile({root}/AI_LabTest/.auth/{env}.{key}.storageState.json
```

## API 路由

凭据**明文回传**给本地渲染端（UI 需可编辑），不做掩码。

| 方法 路径 | 说明 | 返回 |
|---|---|---|
| `GET /api/test-accounts` | 列系统 | `{ systems: TestAccountSystemView[] }` |
| `POST /api/test-accounts` | 建系统（需 `name`，默认两环境） | `{ system }` 201 |
| `GET /api/test-accounts/[id]` | 单系统 | `{ system }` / 404 |
| `PUT /api/test-accounts/[id]` | 更新（name/project_root/environments/sort_order） | `{ system }` / 404 |
| `DELETE /api/test-accounts/[id]` | 删系统 | `{ success: true }` / 404 |
| `POST /api/test-accounts/[id]/export` | 写 environments.json + 建 `.auth/` 目录 | `{ success, path }` / `PROJECT_ROOT_REQUIRED` 400 / `PROJECT_ROOT_NOT_FOUND` 400 |

## AI_LabTest 契约（导出格式，已核验框架源码）

> 源：`/Users/yeqb001/Documents/trae_projects/ai-lab-test-framework`（`app/renderer/index.html` `ecBuildJson`、`app/src/main/engine/login-capture.js`、`runner.js`）。模板文件 `templates/environments.json.template` 已陈旧，**以 renderer 运行时输出为准**。

`environments.json` 顶层 + 每环境（键序与 AI_LabTest 一致）：

```jsonc
{
  "$schema": "环境注册表 — 由 AI_LabTest 读取以决定测试目标、账号与登录方式。UAT/生产永不在白名单内。",
  "default": "local",
  "allowedEnvs": ["local", "sit"],          // 硬白名单，无第三环境
  "environments": {
    "local": {
      "label": "...", "frontendBaseUrl": "...|TBD", "apiBaseUrl": "...|TBD",
      "healthEndpoint": "...|/", "defaultAccount": "<某 account.key>",
      "accounts": [ /* 见下 */ ], "tag": "local"   // sit 环境 tag 为 "SIT"
    },
    "sit": { ... }
  }
}
```
- 空 URL → 字面量 `"TBD"`；空 health → `"/"`；`defaultAccount` 空时回退到 `accounts[0].key`。
- **不写** `outOfScope` / `notes` / `tokenStorage`（模板遗留字段）。

**三种账号形态（authType 由「形状」推断）**：
- 密码：`{ key, role, username, password }` —— **不写** authType
- token：`{ key, role, token, capturedAt, storageType, storageKey }` —— **不写** authType（靠 `token` 字段识别；header 类型勿预置 `Bearer`，runner 自动加）
- 获取登录态：`{ key, role, authType: "capture" }` —— **仅此三字段**，登录态在独立文件
- AI_LabTest 读取侧判定：`a.authType === 'capture' ? 'capture' : (a.token ? 'token' : 'password')`

## 获取登录态（capture）—— Electron 实现

**职责切分**：CodePilot 只负责**抓取 + 按格式写文件**；**重放由 AI_LabTest** 用 `--storage-state` 完成。

**登录态文件**（Playwright 标准 storageState）：
```
{project_root}/AI_LabTest/.auth/{env}.{sanitize(key)}.storageState.json
sanitize(key) = key.replace(/[^A-Za-z0-9_-]/g, '_')   // 必须与 runner 完全一致
```
形状：`{ cookies: [{name,value,domain,path,expires,httpOnly,secure,sameSite}], origins: [{origin, localStorage:[{name,value}]}] }`。

**抓取流程**（`electron/test-auth-capture/capture-window.ts`）：
1. `start({frontendBaseUrl, username?, password?})` —— 开一个隔离 BrowserWindow（独立内存 partition、sandbox、**无 preload**、拒绝所有权限请求、阻止 `window.open` 但放行就地导航），导航到 frontendBaseUrl，best-effort 预填账号密码（**不自动提交**，留给用户处理验证码/2FA）。
2. 用户在弹窗里手动登录 → 回到 CodePilot 面板点「完成」。
3. `finish({projectRoot, env, accountKey})` —— 抓 `session.fromPartition().cookies.get({})` + 各 origin 的 localStorage（`did-finish-load` 累积，覆盖 SSO 多 origin），组装 storageState 写文件。cookie+origin 全空视为失败。
4. `cancel()` / `status()`（文件存在性）/ `clear()`（删文件）。

**IPC**（preload `window.electronAPI.testAuthCapture`，main `test-auth-capture:*`）：`start` / `finish` / `cancel` / `status` / `clear`。同一时刻只允许一个抓取会话（模块级单例，`start` 先 `cancel`）。

**Electron cookie → Playwright cookie 映射**：`expirationDate`→`expires`（session/缺失→`-1`，否则 `Math.round`）；sameSite：`no_restriction`→`None`、`strict`→`Strict`、`lax`/`unspecified`→`Lax`。

**为何用 Electron BrowserWindow 而非 Playwright**：`@playwright/test` 仅 devDependency，打包不含浏览器二进制；BrowserWindow 原生、零新增依赖，输出手工组装成 Playwright storageState 形状即可被 AI_LabTest 重放。

## 测试工作台消费侧（本仓对接）

> 设置·测试账号是**生产侧**；测试工作台（侧栏「测试」/ `InlineTestingPanel`）是**消费侧**。一个工作台「项目」(文件夹) ↔ 一个系统（其 `project_root` == 该文件夹）。对接两条路（**file-first，DB 兜底**）：用户把系统「项目目录」设成同一文件夹即可——**点导出**生成 `environments.json`（框架真跑也读它），或**不导出**直接由工作台读库。

**两个数据源，同一形态**：
- `src/lib/test/env-config.ts`（纯 fs，无 DB，单测 9/9）：`readEnvFile` 读 `{projectPath}/AI_LabTest/environments.json`；`resolveFromRaw(raw, projectPath, env?, source)` 把已解析对象 → `ResolvedTestEnv { configured, env, frontendBaseUrl(TBD→null), apiBaseUrl, defaultAccount, storageStatePath, allowedEnvs, source }`；`resolveProjectEnv` = file → resolveFromRaw（`source:'file'`）。
- `src/lib/test/env-resolve.ts`（**server-only**，import `@/lib/db`）：`resolveProjectEnvWithDb` —— ①有文件 → 用文件（`'file'`，与框架 runner 读的一致，优先）；②无文件 → `getAllTestAccountSystems().find(s.project_root === projectPath)` → `toEnvironmentsJson(sys)` → resolveFromRaw（`'db'`，免导出）；③都没有 → 未配置（`'none'`）。
- `env`：入参在 `allowedEnvs` 内则用之，否则回退 `default`，再否则 `allowedEnvs[0]`。
- `storageStatePath`：`.auth/{env}.{sanitizeAccountKey(defaultAccount)}.storageState.json` **文件存在**时才返回（`.auth` 由 capture 写盘，与导出无关，两条路都从磁盘读）；`sanitizeAccountKey` 复用导出侧同一函数保文件名一致。

**执行步消费**（`POST /api/test/run` step=execution，用 `resolveProjectEnvWithDb`）：
- `baseUrl = resolved.frontendBaseUrl || body.baseUrl`（**配置为准**，body 仅兜底）→ 进执行 prompt 的测试目标。
- `resolved.storageStatePath` → `buildPlaywrightMcp(projectPath, evidenceDir, storageStatePath)` 注入 `--storage-state`，AI 开跑即已登录。
- 产物路径 `artifactPaths`、run.json 的 `env` 字段均用解析后的 `env`。

**展示用** `GET /api/test/env-config?projectPath=&env=` → 同一 `resolveProjectEnvWithDb` 结果，供前端 flow 头部显示目标 + 来源。

**前端**（`InlineTestingPanel.tsx` flow 视图头部）：env 选择器(local/SIT，来自 `allowedEnvs`) + 目标 chip `🎯 {frontendBaseUrl}`（`source==='db'` 时附「来自设置」小标，提示是直接读库未导出）；未配置 → `未配置目标 · 去设置·测试账号` 按钮。切 env 触发重新拉取。任务页「环境配置」按钮 → `router.push('/settings#test-accounts')`（配置入口已收口到设置，工作台只读消费，原内嵌 EnvModal 已删）。

## 安全模型

- 抓取窗口加载**第三方站点**：独立内存 partition（cookie/localStorage 不污染主会话、随窗口销毁）、`sandbox:true`、**无 preload**（页面拿不到 `electronAPI`/IPC）、`setPermissionRequestHandler` 全拒、`setWindowOpenHandler` deny。
- 凭据明文落 DB —— 本机数据库、与 AI_LabTest 行为一致（其 environments.json 即明文）。导出文件本身也是明文（AI_LabTest 要求）。

## 已知限制

- 环境固定 `local` + `SIT`（AI_LabTest 硬白名单），不支持自定义环境名 / 第三环境。
- 获取登录态仅 Electron（`electron:dev` / 打包版）可用；纯 `npm run dev` 下按钮置灰 + 提示。
- sessionStorage 不抓（Playwright storageState 不含，AI_LabTest 同限制）。
- `captured`/`capturedAt` 是 UI 缓存：在 capture/clear 时更新，不在每次加载时与磁盘 status 对账（避免误标脏）。用户在应用外删了 `.auth` 文件时标志会过期。
- 消费侧：执行步真跑浏览器需 `@playwright/mcp` + Chromium（打包未含、dev 无凭据），故 baseUrl/storageState 注入的**端到端登录态重放**待打包+Chromium 后实测；解析器（文件→baseUrl/storageState）纯 fs 逻辑已单测覆盖。
- 消费侧对接靠「项目目录 == 工作台项目文件夹路径」**字符串完全相等**约定：路径不一致（设错 / 末尾斜杠 / 软链）→ 既匹配不到文件也匹配不到 DB → 显示「未配置目标」。未导出**不再**导致未配置（DB 兜底覆盖）。

## 验证

- `npm run typecheck` ✅（root）；`npx tsx --test src/__tests__/unit/test-accounts-export.test.ts` ✅ 9/9；全量单测 1419/1419 ✅。
- CDP（`npm run dev` @ PORT 3001 + chrome-devtools）：侧栏入口、建系统、local/SIT 标签、访问地址、增账号、三种登录方式切换、获取登录态置灰 + 桌面版提示、脏标记保存、实时导出预览 JSON 字段映射、console 无报错。
- 获取登录态抓取流程需 `electron:dev` 实测（CDP 只连 `npm run dev` 网页）；storageState 组装逻辑由单测 + 契约文档约束。
- 消费侧对接（`npm run dev` + curl + CDP）：file 路 —— 写样例 `environments.json` → `GET /api/test/env-config` 返回 `source:'file'` + baseUrl ✅，flow 头 `🎯 baseUrl` ✅，切 local↔SIT 换 baseUrl ✅，「环境配置」跳设置 ✅。DB 兜底路 —— `POST /api/test-accounts`（project_root 指向无 environments.json 的目录）→ `GET /api/test/env-config` 返回 `source:'db'` + baseUrl ✅，flow 头 `🎯 baseUrl` + 「来自设置」小标 ✅；有文件时仍 `source:'file'`（文件优先）✅。`test-env-config.test.ts` 9/9（6 file + 3 resolveFromRaw 核心）。
