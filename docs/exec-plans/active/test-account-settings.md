# 测试账号设置（Test Account Settings）

> 创建时间：2026-06-22
> 最后更新：2026-06-22

在 CodePilot 设置中新增「测试账号」面板，用于配置测试时访问的系统/环境/账号，并导出到 AI_LabTest 的 `environments.json` 供测试框架消费。对标 AI_LabTest 桌面端「环境配置」对话框，但**支持多个系统**。

## 背景与契约（已核验源码）

AI_LabTest 框架源码：`/Users/yeqb001/Documents/trae_projects/ai-lab-test-framework`

关键事实：
1. **AI_LabTest 是「单系统单文件」**：一个 `{projectRoot}/AI_LabTest/environments.json` 描述**一个系统**，环境固定为 `local` + `sit` 两个（`allowedEnvs` 硬编码白名单，UAT/生产永不入白名单）。没有「systems」概念，也不支持第三个环境。
   - ⇒ CodePilot 的「多个系统」= **多个 AI_LabTest 工作区目录**，每个系统指向一个 `projectRoot`，导出到该目录的 `environments.json`。
2. **`environments.json` 运行时 schema**（以 renderer `ecBuildJson()` 实际写出的为准，**不是** 模板文件 — 模板已陈旧）：
   ```jsonc
   {
     "$schema": "环境注册表 — 由 AI_LabTest 读取以决定测试目标、账号与登录方式。UAT/生产永不在白名单内。",
     "default": "local",
     "allowedEnvs": ["local", "sit"],
     "environments": {
       "local": {
         "label": "...", "frontendBaseUrl": "...|TBD", "apiBaseUrl": "...|TBD",
         "healthEndpoint": "...|/", "defaultAccount": "<某 account.key>",
         "accounts": [ /* 见下 */ ], "tag": "local"
       },
       "sit": { /* 同上, tag: "SIT" */ }
     }
   }
   ```
   - 空 URL → 字面量 `"TBD"`；空 health → `"/"`；不写 `outOfScope`/`notes`/`tokenStorage`。
3. **三种账号形态（authType 由「形状」推断）**：
   - 密码：`{ key, role, username, password }`（**不写** authType）
   - token：`{ key, role, token, capturedAt, storageType, storageKey }`（**不写** authType，靠 `token` 字段识别；header 类型不要预置 `Bearer `）
   - 获取登录态：`{ key, role, authType: "capture" }`（**仅此三字段**）
   - 读取侧判定：`a.authType === 'capture' ? 'capture' : (a.token ? 'token' : 'password')`
4. **登录态 blob 不在 environments.json 内**，而是独立 Playwright `storageState` 文件：
   - 路径：`{projectRoot}/AI_LabTest/.auth/{env}.{safeKey}.storageState.json`
   - `safeKey = String(key).replace(/[^A-Za-z0-9_-]/g, '_')`（必须完全一致，否则 runner 找不到）
   - 形状（Playwright 标准 storageState）：
     ```jsonc
     { "cookies": [{name,value,domain,path,expires,httpOnly,secure,sameSite}],
       "origins": [{ "origin": "https://x", "localStorage": [{name,value}] }] }
     ```
   - sessionStorage 不在 Playwright storageState 内（已知限制，可接受）
   - 空（cookies 与 origins 均空）视为抓取失败，应拒绝。
5. **对接方式 = 文件系统总线**：两端同机，CodePilot 直接把 `environments.json` + `.auth/*.storageState.json` 写进共享的 `{projectRoot}/AI_LabTest/` 即可，无需新增 API/IPC（叫醒接口与本功能无关）。
6. **重放归 AI_LabTest 负责**：CodePilot 只需「抓取 + 按格式导出」，无需实现重放。capture 账号若**没有** storageState 文件，runner 会把所有需登录用例判为 blocked，所以 capture 账号必须连带导出 storageState 文件。

## 用户已确认的范围决策（2026-06-22）

- 获取登录态：**v1 完整实现**（抓取侧；重放在 AI_LabTest）
- 导航：**系统下拉 + 环境标签页（local/SIT）**
- 数据去向：**导出到 `AI_LabTest/environments.json`**（含 `.auth/` 登录态文件）
- 密钥存储：**明文存本地库**（与 AI_LabTest 一致，且 DB 仅本机）

## 设计结论（由契约推导，非可选项）

- 每个「系统」必须绑定一个**项目目录**（AI_LabTest 工作区 `projectRoot`），否则无法导出/抓取。用现成 `window.electronAPI.dialog.openFolder` 选择。
- 环境固定 `local` + `SIT` 两个标签页（AI_LabTest 白名单约束），不开放自定义环境名。
- 抓取用 **Electron `BrowserWindow`**（CodePilot 原生），不引入 Playwright 运行时（`@playwright/test` 仅 devDependency，打包不含浏览器）。输出严格组装成 Playwright `storageState` 形状。
- 抓取（获取登录态）仅在 Electron 环境（`electron:dev` / 打包版）可用；纯 `npm run dev` 下该按钮置灰并提示。CRUD/导出在两种环境都可用。

## CodePilot 数据模型（SQLite，明文）

新表 `test_account_systems`（镜像 `api_providers` 的存法：一行一系统，嵌套数据存 JSON TEXT 列）：

```sql
CREATE TABLE IF NOT EXISTS test_account_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_root TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  environments_json TEXT NOT NULL DEFAULT '{}',  -- { local: TestEnv, sit: TestEnv }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

类型（`src/types/index.ts`，新增 `// ===== Test Accounts =====` 区块）：

```ts
export type TestEnvKey = 'local' | 'sit';
export type TestAuthMethod = 'password' | 'token' | 'capture';
export type TestTokenStorage = 'header' | 'localStorage' | 'sessionStorage' | 'cookie';

export interface TestLoginAccount {
  key: string;                 // 角色 key，env 内唯一；导出为 accounts[].key
  role: string;
  authMethod: TestAuthMethod;
  username?: string;           // password
  password?: string;           // password（敏感，明文）
  token?: string;              // token（敏感，明文，header 不预置 Bearer）
  capturedAt?: string;         // token
  storageType?: TestTokenStorage; // token
  storageKey?: string;         // token
  // capture：blob 不入库，状态由 .auth 文件存在性派生
}

export interface TestEnvironment {
  label: string;
  frontendBaseUrl: string;
  apiBaseUrl: string;
  healthEndpoint: string;
  defaultAccountKey: string;   // 导出为 environments[env].defaultAccount
  accounts: TestLoginAccount[];
}

export interface TestAccountSystem {           // DB 行
  id: string; name: string; project_root: string; sort_order: number;
  environments_json: string;                   // { local: TestEnvironment, sit: TestEnvironment }
  created_at: string; updated_at: string;
}
```

## 内部模型 → environments.json 字段映射

| CodePilot | environments.json | 备注 |
|---|---|---|
| (常量) | `$schema` | 运行时串 |
| (常量) | `default` = `"local"` | |
| (常量) | `allowedEnvs` = `["local","sit"]` | |
| env.label | `label` | |
| env.frontendBaseUrl | `frontendBaseUrl` | 空→`"TBD"` |
| env.apiBaseUrl | `apiBaseUrl` | 空→`"TBD"` |
| env.healthEndpoint | `healthEndpoint` | 空→`"/"` |
| env.defaultAccountKey | `defaultAccount` | 必须等于某 account.key |
| env.accounts | `accounts` | 需登录则不可空 |
| (常量) | `tag` | local→`"local"`，sit→`"SIT"` |
| 密码账号 | `{key,role,username,password}` | 不写 authType |
| token 账号 | `{key,role,token,capturedAt,storageType,storageKey}` | 不写 authType |
| capture 账号 | `{key,role,authType:"capture"}` + 独立 storageState 文件 | |

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 调研 + 契约核验 + 本执行计划 | ✅ 已完成 | 两轮 workflow 已核验 AI_LabTest 源码 |
| Phase 1 | 类型 + i18n（en/zh/zh-HK）骨架 | 📋 待开始 | `TestAccount*` 类型 + `testAccounts.*` 命名空间 + `settings.testAccounts` 标签 |
| Phase 2 | 持久化：`test_account_systems` 表 + CRUD + API 路由 | 📋 待开始 | 镜像 `api_providers` / `/api/providers`；明文 |
| Phase 3 | 设置面板 UI：系统下拉 + local/SIT 标签 + 账号编辑 + 脏标记保存；接入 SettingsLayout | 📋 待开始 | 密码/token 全功能；capture UI 占位（按钮在 Phase 5 接通）；CDP 验证 |
| Phase 4 | 导出到 `environments.json`：API 路由 + 精确字段映射 + 文件夹选择 + 导出按钮 | 📋 待开始 | 单测校验输出 schema；TBD/"/" 强制；authType 发射规则 |
| Phase 5 | 获取登录态：Electron 主进程 BrowserWindow + IPC（start/finish/cancel/status/clear）+ preload + electron.d.ts + storageState 组装 + 写 `.auth/` | 📋 待开始 | Electron-only；cookie 字段映射；多 origin localStorage 抓取；electron:dev 烟测 + 单测 |
| Phase 6 | 验证 + 文档（handover + insights）+ 自检（test/smoke）+ exec-plan 收尾 | 📋 待开始 | 导出文件回灌 AI_LabTest 校验；docs 双向链接 |

## 文件清单

**新增**
- `src/components/settings/TestAccountsSection.tsx` — 面板组件
- `src/app/api/test-accounts/route.ts` — GET（列表）/ POST（建系统）
- `src/app/api/test-accounts/[id]/route.ts` — GET / PUT / DELETE（单系统）
- `src/app/api/test-accounts/[id]/export/route.ts` — POST：写 `environments.json`
- `electron/test-auth-capture/capture-window.ts` — 抓取窗口 + storageState 组装（镜像 `electron/auth/login-window.ts`）
- `docs/handover/test-account-settings.md` + `docs/insights/test-account-settings.md`

**修改**
- `src/components/settings/SettingsLayout.tsx` — 注册 section（4 处）
- `src/lib/db.ts` — 建表 + CRUD 助手
- `src/types/index.ts` — 类型区块
- `src/types/electron.d.ts` — `testAuthCapture` namespace 类型
- `src/i18n/en.ts` / `zh.ts` / `zh-HK.ts` — `settings.testAccounts` + `testAccounts.*`
- `electron/main.ts` — `testAuthCapture:*` ipcMain handlers
- `electron/preload.ts` — `testAuthCapture` contextBridge block

## 验收标准

- 设置侧栏出现「测试账号」；可增删多个系统，每系统可选项目目录、配置 local/SIT 两环境、增删账号、选默认账号、切换三种登录方式并保存（明文入库）。
- 点「导出」在 `{projectRoot}/AI_LabTest/environments.json` 生成与 AI_LabTest 运行时 schema 完全一致的文件（字段映射、TBD/"/"、authType 规则、tag 大小写），可被 AI_LabTest `loadEnvCfg` 无损读回。
- capture 账号：在 electron:dev 下点「获取登录态」弹出窗口，登录后点「完成」生成 `{projectRoot}/AI_LabTest/.auth/{env}.{safeKey}.storageState.json`（Playwright storageState 形状，cookies+origins 非空）；面板显示「已捕获」与时间；「清除」可删文件。
- `npm run test` 通过；UI 经 CDP 验证渲染与交互无 console 报错。

## 决策日志

- 2026-06-22：抓取用 Electron BrowserWindow 而非 Playwright —— `@playwright/test` 仅 dev 依赖，打包不含浏览器二进制；BrowserWindow 原生且零新增依赖，输出按 Playwright storageState 形状手工组装（cookie 字段需做 Electron→Playwright 映射：`expirationDate`→`expires`、sameSite 取值归一）。
- 2026-06-22：「多个系统」落地为多个 AI_LabTest 工作区目录 —— AI_LabTest 单文件单系统、环境固定 local/sit，无 systems 概念；每系统绑定一个 projectRoot 是唯一可导出方案。
- 2026-06-22：登录态 blob 不入 CodePilot DB —— 真值是 `.auth/*.storageState.json` 文件存在性；DB 只存可编辑配置（含明文密码/token）。
- 2026-06-22：明文存储 —— 与 AI_LabTest 行为一致（其 environments.json 即明文），DB 仅本机，用户已确认。
