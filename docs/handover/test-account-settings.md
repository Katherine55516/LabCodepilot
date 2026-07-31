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
| `electron/test-auth-capture/capture-window.ts` | 获取登录态：`BaseWindow` + 两个 `WebContentsView`（工具条 + 站点）抓取 cookie+localStorage → Playwright storageState 文件 |
| `electron/test-auth-capture/toolbar.html` / `toolbar.css` / `toolbar.js` | 抓取窗口顶部工具条（「登录完成 / 取消」+ 系统·环境·账号显示）；静态资源，复用主 `preload.js` |
| `src/__tests__/unit/test-accounts-export.test.ts` | 锁死 environments.json 契约的单测（9 用例） |

**修改**
| 文件 | 改动 |
|------|------|
| `src/components/settings/SettingsLayout.tsx` | 注册 section（`Section` 类型 + `sidebarItems` + `settingsLabelKeys` + 渲染分支 + 导入 + `ListChecks` 图标） |
| `src/lib/db.ts` | `test_account_systems` 表 + CRUD 助手（`getAll/get/create/update/deleteTestAccountSystem` + `normalizeTestEnv`/`rowToTestSystemView`） |
| `src/types/index.ts` | `// ===== Test Accounts =====` 类型区块 |
| `src/types/electron.d.ts` | `testAuthCapture` namespace 类型 |
| `src/i18n/en.ts` / `zh.ts` / `zh-HK.ts` | `settings.testAccounts` + `testAccounts.*` 命名空间 |
| `electron/main.ts` | `test-auth-capture:*` ipcMain handler（`start`/`cancel`/`status`/`clear`/`toolbar-finish`/`toolbar-cancel`）+ `registerCaptureNotifier` 推送 done/cancelled + 导入 |
| `electron/preload.ts` | `testAuthCapture` contextBridge namespace（`start`/`cancel`/`status`/`clear` + `toolbarFinish`/`toolbarCancel`/`onToolbarInit` + `onDone`/`onCancelled`） |
| `electron-builder.yml` | extraResources：`electron/test-auth-capture/` 静态资源 → `Resources/test-auth-capture/`（仅 `*.html/*.css/*.js`） |

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
        ├─ start → ipcMain test-auth-capture:start → capture-window.ts 开 BaseWindow（工具条 + 站点视图）
        ├─ 工具条「登录完成」→ test-auth-capture:toolbar-finish → 抓取 → fs.writeFile({root}/AI_LabTest/.auth/{env}.{key}.storageState.json
        └─ 主进程推 test-auth-capture:done/:cancelled → 设置页 onDone/onCancelled 刷新徽章
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

**窗口结构**（v2.2 起，原 BrowserWindow 改为）：`BaseWindow` + 两个 `WebContentsView`：
- `toolbarView`（顶部固定 48px）—— 本地可信 HTML（`toolbar.html`/`.css`/`.js`），**复用主 `preload.js`**（与登录窗口一致；esbuild 把主进程全 bundle 进 `dist-electron/main.js`，故 `__dirname` 指向 `dist-electron/`）。承载「登录完成 / 取消」+ 显示「系统 · 环境 · 账号」。
- `siteView`（下方其余高度）—— 第三方登录页：独立内存 partition、`sandbox:true`、**无 preload**、拒绝所有权限请求、阻止 `window.open` 但放行就地导航。
- `win.on('resize')` → `layoutViews()` 按 `getContentBounds()` 重排两视图。

**抓取流程**（`electron/test-auth-capture/capture-window.ts`）：
1. `start({frontendBaseUrl, username?, password?, projectRoot, env, accountKey, systemLabel?})` —— 开窗，导航 siteView 到 frontendBaseUrl，best-effort 预填账号密码（**不自动提交**，留给用户处理验证码/2FA）；`projectRoot/env/accountKey/systemLabel` 固化在模块状态（`captureTarget`），供工具条就地写盘 + 工具条显示。
2. 用户**在窗口内**登录 → 直接点顶部工具条「登录完成」（**无需切回设置页**，这是相对旧版的核心改进）。
3. `toolbarFinish()`（IPC `test-auth-capture:toolbar-finish`）—— 用 `captureTarget` 抓 `session.fromPartition().cookies.get({})` + 各 origin 的 localStorage（`did-finish-load` 累积，覆盖 SSO 多 origin），组装 storageState 写文件。成功 → 推 `test-auth-capture:done` 给设置页刷新徽章 + 关窗；**cookie+origin 全空** → 返回 `ok:false`、**不关窗**，工具条红字提示「先登录再点登录完成」。
4. 工具条「取消」(`toolbar-cancel` → `cancelCaptureByUser`) 或用户关窗(X) → `'closed'` 推 `test-auth-capture:cancelled` 给设置页清「抓取中」态。
5. `cancel()`（静默，仅 re-entry 守卫 / 程序化关闭，不通知）/ `status()`（文件存在性）/ `clear()`（删文件）。

**IPC**（preload `window.electronAPI.testAuthCapture`）：
- 设置页调用：`start` / `cancel` / `status` / `clear`；订阅推送 `onDone` / `onCancelled`。
- 工具条调用（`toolbar.js`，复用同一 preload）：`toolbarFinish` / `toolbarCancel` / `onToolbarInit`。
- main → 渲染端推送：`test-auth-capture:done` / `:cancelled`（经 `registerCaptureNotifier` 注入的 `(ch,p)=>mainWindow?.webContents.send(ch,p)`，避免 capture-window 反向 import main.ts 造成循环依赖）；main → 工具条：`:toolbar-init`（下发系统·环境·账号显示文案）。
同一时刻只允许一个抓取会话（模块级单例，`start` 先 `cancel`）。

**Electron cookie → Playwright cookie 映射**：`expirationDate`→`expires`（session/缺失→`-1`，否则 `Math.round`）；sameSite：`no_restriction`→`None`、`strict`→`Strict`、`lax`/`unspecified`→`Lax`。

**为何 BaseWindow + WebContentsView**：工具条需要可信 IPC（自带 preload），第三方站点需要零 preload 隔离 —— 两者必须分属不同 `webContents`，无法在单个 BrowserWindow 里共存。`BaseWindow` + 两个 `WebContentsView`（Electron 30+ 官方多视图范式，本项目 40）既给工具条可信通道、又保持站点隔离，比旧版「整窗无 preload、完成按钮留在设置页」更干净。仍用 Electron 原生窗口而非 Playwright：`@playwright/test` 仅 devDependency，打包不含浏览器二进制；原生窗口零新增依赖，输出手工组装成 Playwright storageState 形状即可被 AI_LabTest 重放。

**工具条静态资源打包**：`electron-builder.yml` 把 `electron/test-auth-capture/` 的 `*.html/*.css/*.js` 复制到 `Resources/test-auth-capture/`（**filter 只列静态文件，不可用 `**/*`，否则 `capture-window.ts` 源码会被打进 Resources**）；dev 下从 `process.cwd()/electron/test-auth-capture/` 读，与登录窗口同一约定。

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
- **密码方式自动登录（登录三态，优先级 storageState > 密码 > 无）**：`resolveFromRaw` 现顺带解析 `defaultAccount`（回退 accounts[0]）对应的账号对象为 `resolved.loginAccount`（`{key,authType,username,password}`，authType 按形状推断）。执行步在**无 storageState、且账号为「密码」形态（有用户名+密码）**时，把凭据经 `buildStep({loginCredentials})` 下发进执行 prompt 的🔐块（`prompts.ts` 的 `loginHandlingBlock`），指示执行智能体在被测登录页用 `browser_fill_form`/`browser_type` 自动填充并提交（一次即可、复用会话）；遇验证码/2FA 等二次校验 → 判 `blocked` 并提示改用「获取登录态」。capture 抓过（有 storageState）时仍走登录态注入，不重复自动登录。**凭据明文进 prompt**，与 DB/environments.json 明文模型一致；仅执行路由服务端消费，**不**随展示用 GET 回传渲染端。修复的是「配了密码却在被测登录页无法自动填充」——此前执行侧只认 storageState，密码凭据从不送达浏览器智能体。
- 产物路径 `artifactPaths`、run.json 的 `env` 字段均用解析后的 `env`。

**展示用** `GET /api/test/env-config?projectPath=&env=` → 同一 `resolveProjectEnvWithDb` 结果**去掉明文 `loginAccount`**（改只回传非敏感的 `loginAuthType`），供前端 flow 头部显示目标 + 来源。

**前端**（`InlineTestingPanel.tsx` flow 视图头部）：env 选择器(local/SIT，来自 `allowedEnvs`) + 目标 chip `🎯 {frontendBaseUrl}`（`source==='db'` 时附「来自设置」小标，提示是直接读库未导出）；未配置 → `未配置目标 · 点击配置` 按钮。切 env 触发重新拉取。流程头未配置 chip、项目页「环境配置」按钮和执行前环境警告都打开同一份 `TestEnvDrawer`，抽屉按项目路径绑定系统并复用设置页 `TestSystemEditor`；保存后重拉环境配置。

**项目名称展示（2026-07-30）**：工作台项目的稳定身份仍是 `project.path`，持久化的
`project.name` 仍为文件夹名；界面通过脱敏接口
`GET /api/test-accounts/project-summaries` 只读取 `{id,name,project_root}`，按
`normalizeProjectPath(project_root) == normalizeProjectPath(project.path)` 建立映射。命中且
系统名非空时，项目卡片/详情标题/流程头/报告分组以系统名为主标题，同时保留文件夹名和路径；
未命中、空名或接口失败时回退文件夹名。系统名不写入 `test-workbench.json`，环境配置改名后
由工作台重新拉取摘要即时生效；摘要接口不返回 environments、账号、密码、Token 或登录态。
同一路径重复绑定沿用现有排序后首条 `find()` 语义，本次不增加数据库唯一约束。

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
- 工具条版（v2.2）验证：`tsc -p electron/tsconfig.json` + root `tsc` 对改动文件均 0 error；`build-electron.mjs` 产物含新通道；3 个 Electron POC（scratchpad，已删）实测——① `BaseWindow`+双 `WebContentsView` 构造/布局/resize；② 隔离 partition 真 http 源 cookie+localStorage 抓取 + 默认会话不串；③ **真** `toolbar.html`+**真** `preload.js`：API 暴露、`onToolbarInit` 渲染、抓空→红字不关窗、成功→关窗。全量单测较基线**新增 0 失败**（109 失败均为 better-sqlite3 ABI 环境问题，与本改动无关）。**全 app 端到端**（开应用→点获取登录态→登录→登录完成）受 dev 登录门控限制未跑，构成机制已逐项 POC 覆盖。
- 消费侧对接（`npm run dev` + curl + CDP）：file 路 —— 写样例 `environments.json` → `GET /api/test/env-config` 返回 `source:'file'` + baseUrl ✅，flow 头 `🎯 baseUrl` ✅，切 local↔SIT 换 baseUrl ✅，「环境配置」跳设置 ✅。DB 兜底路 —— `POST /api/test-accounts`（project_root 指向无 environments.json 的目录）→ `GET /api/test/env-config` 返回 `source:'db'` + baseUrl ✅，flow 头 `🎯 baseUrl` + 「来自设置」小标 ✅；有文件时仍 `source:'file'`（文件优先）✅。`test-env-config.test.ts` 9/9（6 file + 3 resolveFromRaw 核心）。
