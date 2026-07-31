# 测试工作台·就地环境配置（Inline Env Config）

> 创建时间：2026-07-28
> 最后更新：2026-07-28（阶段 1 开发 + 验证完成，待打包态实测）
>
> 生产侧配置（设置·测试账号）见 [test-account-settings.md](./test-account-settings.md)；本计划是它的**消费侧就地化延伸** —— 把「项目访问地址 + 登录账号 + 登录态」的配置从设置页搬进测试工作台，消灭跨页往返。
> 消费侧对接现状见 handover [test-account-settings.md](../../handover/test-account-settings.md#测试工作台消费侧本仓对接)。

把测试工作台里「项目环境配置」的编辑能力就地化：项目 = 系统按路径**自动绑定**，流程头用**环境胶囊**一屏展示 env·地址·账号·登录态，点击滑出**右侧抽屉**完成全部配置（复用设置页同一份表单组件，写同一张表）。设置页「测试账号」面板保留为多系统全局总览（双入口）。

## 用户已确认决策（2026-07-28）

| 决策点 | 选择 | 备注 |
|---|---|---|
| 容器形态 | **右侧抽屉** | 复用现成 `src/components/ui/sheet.tsx`，编辑时流程上下文仍可见 |
| 首期范围 | **先做阶段 1** | 阶段 2（胶囊 + 登录态可视/就地抓取）、阶段 3（优先级透明 + 双入口互通）待后续立项 |
| 设置页去留 | **保留双入口** | 设置·测试账号继续作为多系统总览；与抽屉写同一库、同一份保存即同步逻辑 |
| 胶囊/抽屉细节 | 按可交互原型走 | 原型：scratchpad `plan-a-prototype.html`（Artifact 已发布） |

## 现状痛点（改造动机）

| # | 痛点 | 证据 / 现状 |
|---|---|---|
| P1 | 跨页往返打断心流 | 工作台 3 处 `router.push("/settings#test-accounts")`（[InlineTestingPanel.tsx:2300](../../../src/components/test/InlineTestingPanel.tsx#L2300) / :2840 / :3233）；为「改完切回来刷新」写了 focus+visibilitychange+pathname 三重监听（:1423-1457）；为「跳设置卸载测试面板致 SSE 误判失败」做了面板保活（[AppShell.tsx:257](../../../src/components/layout/AppShell.tsx#L257)）—— 补丁摞补丁。 |
| P2 | 同一文件夹选两遍 / 绑定脆弱 | 工作台「添加项目」选一次文件夹，设置页「项目目录」再选一次。**注**：DB 侧匹配 [env-resolve.ts:28-29](../../../src/lib/test/env-resolve.ts#L28) 已用 `normalizeProjectPath`（尾斜杠容差），故「配了却显示未配置」已大幅缓解；剩下的是**双实体各存一份路径**的心智与重复操作。 |
| P3 | 「系统」vs「项目」双实体 | 实为 1:1（`project.path == system.project_root`），却要用户自己理解并维护映射；系统名与项目名可各起各的。 |
| P4 | 登录态是设置页孤岛 | 抓取/重抓/清除只能在设置页；`GET /api/test/env-config` 已返回 `loginState`（账号/已抓/过期/时间，[env-config route](../../../src/app/api/test/env-config/route.ts)），但工作台 UI 零消费 —— 半成品。（阶段 2 处理） |
| P5 | 地址三层优先级不可见 | 任务覆盖 > 执行确认弹窗 > 环境配置，优先级只在 hover title；流程头 🎯 chip 不可点不可改。（阶段 3 处理） |
| P6 | 环境上下文不完整 | 流程头只见 env 下拉 + 地址；账号/登录方式必须去设置页看。（阶段 2 处理） |

## 目标（阶段 1）

根治 P1 / P2 / P3：**不离开工作台**即可完成一个项目的环境+账号配置，目录自动绑定，不再重复选文件夹、不再跳设置页。阶段 1 交付后，配置路径从「9 步·2 次整页跳转·文件夹选 2 遍」降为「3 步·0 跳转·0 重复选择」。

## 数据同步保证（关键设计，回应「与设置页是否同步」）

**是同一份数据的两个入口，不是两份互相同步的副本：**
- 抽屉与设置页写**同一张表** `test_account_systems`（一行一系统），走**同一套 API** `/api/test-accounts/*`，复用**同一份保存逻辑**（保存即自动写 `{project_root}/AI_LabTest/environments.json`，见 [TestAccountsSection `saveActive`](../../../src/components/settings/TestAccountsSection.tsx#L191)）。
- 抽屉表单主体 = 从 `TestAccountsSection` 抽出的**共享组件** `TestSystemEditor`，两处渲染同一份代码 → 字段/校验零漂移。
- 抽屉绑定的系统 = `normalizeProjectPath(project_root) === normalizeProjectPath(项目路径)` 的那一行（`resolve` 接口定位），与 [env-resolve.ts](../../../src/lib/test/env-resolve.ts) DB 兜底、框架 runner 读的**同一条记录**。
- **诚实边界**：设置页与抽屉**同时**开着编辑同一系统 = 后保存覆盖先保存（last-write-wins）。抽屉每次打开重新 GET 最新值；本机单用户，正常流程不撞。非「不同步」，是并发写常规取舍。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| 1.1 | `GET /api/test-accounts/resolve?projectPath=` — 归一化 find；miss 返回未绑定信号（不隐式建库） | ✅ 已完成 | `src/app/api/test-accounts/resolve/route.ts`（Request 版，测试友好） |
| 1.2 | 抽屉首存 find-or-create：无系统时以归一化 `project_root` 自动建，用户无感 | ✅ 已完成 | 落在 `TestEnvDrawer.save`（未绑定→POST 建库→export） |
| 1.3 | 抽取共享组件 `TestSystemEditor`（从 `TestAccountsSection` 拆表单主体，设置页改为消费它） | ✅ 已完成 | `TestSystemEditor.tsx`；设置页经 CDP 回归无回归 |
| 1.4 | 新组件 `TestEnvDrawer`（复用 `ui/sheet.tsx`，内含 `TestSystemEditor` + env 标签 + 保存即同步） | ✅ 已完成 | `src/components/test/TestEnvDrawer.tsx` |
| 1.5 | 工作台接线：项目页「环境配置」按钮 + 流程头未配置 chip + `EnvWarnModal`「去配置」三处 `router.push` → 打开抽屉 | ✅ 已完成 | 三处改 `setEnvDrawerOpen(true)`；`onSaved`→bump `envCfgReload` 重拉 env-config |
| 1.6 | i18n：`en.ts` / `zh.ts` / `zh-HK.ts` 三语同步新键 | ✅ 已完成 | `testEnvDrawer.*` ×3 语 |
| 1.7 | 验证：resolve 单测 + typecheck + CDP 抽屉/绑定验证 | ✅ 已完成（dev 态） | 见下「验证记录」；抓取全链路 + 打包态留阶段 2 |

## 详细设计（阶段 1）

### 1.1 / 1.2 resolve + find-or-create

- 新路由 `src/app/api/test-accounts/resolve/route.ts`：
  - `GET ?projectPath=` → `getAllTestAccountSystems().find(normalizeProjectPath(s.project_root) === normalizeProjectPath(projectPath))`；命中回 `{ system: TestAccountSystemView }`，未命中回 `{ system: null, projectPath }`（**不隐式建库**，避免只读浏览也留脏行）。
  - 与 `env-resolve.ts` 复用同一把归一化尺子，保证「抽屉定位到的系统」== 「工作台读到的目标」== 「框架跑的目标」。
- find-or-create 落在**抽屉首次保存**：若 `resolve` 未命中，保存时 `POST /api/test-accounts`（复用现成建系统接口）并把 `project_root` 存为**归一化路径**、`name` 默认取项目文件夹名；随后照常 PUT + 导出。→ 用户只感知「填完保存」，不感知建系统。

### 1.3 抽取 `TestSystemEditor`

- 从 [TestAccountsSection.tsx](../../../src/components/settings/TestAccountsSection.tsx) 拆出「系统元信息（名称/项目目录）+ env 标签 + 地址三项 + 账号列表（三种登录方式）+ 导出预览」的**纯编辑主体**为 `src/components/settings/TestSystemEditor.tsx`，入参 `{ system, onChange, captureAvailable, showProjectRootPicker }`（受控组件，不自持 fetch）。
- `TestAccountsSection` 降为「系统下拉 + 增删系统 + 加载/保存/导出 + `<TestSystemEditor>`」的容器；抽屉复用同一 `TestSystemEditor`，只是外层容器不同（单系统、目录只读展示、隐藏系统下拉）。
- **红线**：设置页现有交互（系统切换、脏标记、保存即同步、获取登录态、导出预览）全部保持；抽取只是搬运，不改行为。CDP 回归设置页。

### 1.4 `TestEnvDrawer`

- `src/components/test/TestEnvDrawer.tsx`，`props: { projectPath, open, onOpenChange, onSaved }`。
- 打开时 `GET /api/test-accounts/resolve?projectPath=`：命中 → 编辑该系统；未命中 → 以「未绑定」空壳进入（保存时 1.2 建库）。
- 结构：`ui/sheet.tsx`（side="right"）承载 → 顶部「项目目录 + 自动绑定」只读展示 → `<TestSystemEditor>` → 底部「保存并同步」（复用 `saveActive` 同款：PUT + `POST /export`）。
- 抓取登录态按钮：`window.electronAPI.testAuthCapture` 本就全局可用（[test-account-settings handover](../../handover/test-account-settings.md#获取登录态capture--electron-实现)），抽屉直接调用，**无主进程改动**；纯 `npm run dev` 下置灰（与设置页一致）。

### 1.5 工作台接线

- 三处 `router.push("/settings#test-accounts")` → `setEnvDrawerOpen(true)`：
  - 项目页「环境配置」按钮 [:2840](../../../src/components/test/InlineTestingPanel.tsx#L2840)
  - 流程头未配置 chip [:2300](../../../src/components/test/InlineTestingPanel.tsx#L2300)
  - `EnvWarnModal` `onGoConfigure` [:3233](../../../src/components/test/InlineTestingPanel.tsx#L3233)
- 抽屉 `onSaved` → 复用现有 env-config 重拉逻辑（[:1423](../../../src/components/test/InlineTestingPanel.tsx#L1423)），保存后 🎯 地址即时刷新；跳设置的三重 focus/visibility/pathname 监听在阶段 1 保留（阶段 3 视情况精简）。

## 验收标准（阶段 1）

- [ ] 新项目未配置 → 流程头「未配置」chip 点击直接开抽屉（不跳页），填地址+账号保存 → 目录自动绑定、🎯 地址即时出现、`environments.json` 已写。
- [ ] 已配置项目 → 抽屉预填正确（地址/账号/默认），改动保存后设置页打开同一系统显示一致（同一条记录）。
- [ ] 设置页所有原有功能 CDP 回归无回归（系统切换/脏标记/保存即同步/导出预览/获取登录态置灰态）。
- [ ] `npm run test`（typecheck + 单测）通过；resolve 归一化匹配单测覆盖尾斜杠/分隔符差异。
- [ ] 三语 i18n 键齐全。
- [ ] 提交前关闭测试 dev server，清理临时文件。

## 决策日志

- 2026-07-28：方案取向 A（工作台就地配置），容器右侧抽屉，先做阶段 1，保留设置页双入口。原型先行（`plan-a-prototype.html`，Artifact 发布）供用户确认交互后再落码。
- 2026-07-28：数据模型**零迁移** —— 不动 `test_account_systems` 表，纯 UI/API 增量；抽屉与设置页共享 `TestSystemEditor` + 同一 API，保证同步无副本。
- 2026-07-28：`resolve` miss **不隐式建库**，建库延后到抽屉首存，避免只读浏览留脏行。
- 2026-07-28（调研修正）：交接文档记的「project_root 裸字符串比较致『配了却显示未配置』」**已被更新过** —— [env-resolve.ts:28](../../../src/lib/test/env-resolve.ts#L28) 现用 `normalizeProjectPath`（尾斜杠容差）。故 P2 剩「双实体各存一份 + 重复选目录」，阶段 1 只需让 resolve/建库侧沿用同一把归一化尺子（新建时存归一化 `project_root`），不是修 bug。
- 2026-07-28（实现取舍）：`TestSystemEditor` 为受控组件，容器专属职责（系统下拉/增删、保存栏、导出按钮、导出预览、feedback、抓取完成订阅）留父组件；设置页保留原有「systemId 定向抓取完成」逻辑，抽屉用单系统版。导出按钮经 `metaFooter` 插槽注回原布局位置。
- 2026-07-28（文档节奏）：handover/insights 完整文档随**阶段 2/3**（胶囊 + 登录态可视）一并产出（与 regression-library 分期一致）；阶段 1 以本执行计划为交接记录。

## 验证记录（2026-07-28，dev 态）

- **单测**：`test-accounts-route.test.ts` 新增 5 条 resolve 用例（400/未命中不建库/精确匹配/尾斜杠归一化/空 project_root 不匹配）全过；账号+env+dedupe 相关 5 文件共 **55/55 pass**。
- **typecheck**：`tsc --noEmit` exit 0；**eslint** 改动文件 0 error（2 warning 为原生 radio/分段按钮，随抽取原样搬运，抽取前 `TestAccountsSection` 即有，净新增 0）。
- **CDP（`npm run dev` @3000 + chrome-devtools）**：
  - 设置页 `TestSystemEditor` 抽取后**无回归** —— 系统下拉/名称/目录/导出按钮位置/local↔SIT 切换/导出预览 JSON/账号三方式/获取登录态浏览器置灰，均正常，console 无报错。
  - 工作台「环境配置」按钮 → 抽屉滑出，`resolve` 命中既有「简道」系统，**预填与设置页完全一致**（前端地址 + 账号「叶启彬」）—— 同步保证（同一 DB 行）经实测确认；项目目录只读 + 「自动绑定」徽标；抽屉内 local↔SIT 切换正常；console 无报错。
  - 未点「保存并同步」以免改动用户真实 `jiandao/AI_LabTest/environments.json`；保存/find-or-create 路径由单测覆盖（POST 建库 + resolve 匹配全过）。
- **留待阶段 2 / 打包态**：获取登录态端到端抓取（仅 Electron，`electron:dev`/打包版）、抽屉首存建库→export 写盘的桌面全链路实测。

## 阶段 1 打包态验证发现并修复的缺陷（2026-07-28）

**缺陷**：打包版流程头 env 选 `local`（未配置/TBD），🎯 却显示 SIT 地址 + 「任务」徽标。被测项目 `/Users/yeqb001/…/forum-xc-sit`。

**根因（非阶段 1 回归）**：既有的「任务级目标地址覆盖」`targetUrl` 是**跨 env 的单一地址**，显示+执行都优先于环境地址。该任务在 SIT 侧钉了深链 `…/memorabilia`，切到 local 时覆盖仍生效 → 冒充 local 地址。属原划到阶段 3 的 P5（地址优先级不透明），验证时提前暴露。用户选**按 env 隔离覆盖**修复。

**修复**（`InlineTestingPanel.tsx` + i18n，7 触点）：`TaskState.targetUrl: string` → `targetUrlByEnv: Record<env,string>`；加载时旧 `targetUrl` 迁移到该任务项目的当前 `selectedEnv`；`addTask` 种子 / `runStep` 执行解析（按任务项目 env）/ `runExecutionConfirmed` 回写（只动当前 env 键，其它 env 覆盖不变）/ 流程头显示 / `ExecConfirmModal` 初值 全部按 `[env]` 取。附带把「未配置」chip 文案从「去设置·测试账号」改为「点击配置」（阶段 1 已改为开抽屉）。

**验证**：① 真实数据只读模拟：6 条旧覆盖迁移，星闻站测试0723002 → local 回落「未配置目标」、sit 保留深链；② 隔离数据目录 dev + CDP：SIT 显示深链+「任务」徽标、切 local 显示「未配置目标」，console 无关键报错，**真实 `~/.codepilot` 文件未被触碰**；③ typecheck exit 0、eslint 0 error。数据迁移在用户打开修复版打包应用时自然发生。

## 已知边界 / 风险

- 抽取 `TestSystemEditor` 是对生产中的设置页表单的重构 → 最大回归面，靠 CDP 回归 + 单测兜。
- 并发编辑 last-write-wins（见上「数据同步保证」）。
- 获取登录态仅 Electron 可用（阶段 1 抽屉复用该约束，端到端抓取真验在阶段 2 + 打包态）。
- 环境仍固定 local/SIT（AI_LabTest 白名单，见 [test-account-settings 契约](./test-account-settings.md#背景与契约已核验源码)）。

## 阶段 2 / 3 概要（待后续立项，不在本次范围）

- **阶段 2**：环境胶囊（流程头/项目页替换现 env 下拉 + 🎯 chip）；登录态四态徽章（消费已返回的 `loginState`：无需登录/未抓取黄/有效绿显相对时间/已过期红）；抽屉内就地抓取；执行前弹窗过期 → 「重新抓取」快捷入口。
- **阶段 3**：抽屉顶「生效地址」提示条（任务覆盖 > 环境配置，一键清除覆盖）；设置页系统列表 ↔ 工作台抽屉互跳；精简阶段 1 保留的三重刷新监听；更新 handover / insights 文档。
