# 测试框架集成（对话内嵌测试）

> 创建时间：2026-06-22
> 最后更新：2026-06-22
>
> 把 `ai-lab-test-framework` 的 AI 测试能力集成进 LabCodepilot，形态为「对话内嵌测试」——测试是对话的第三种模式（代码 / 计划 / 测试），不是独立页面。
> 原型：`~/Downloads/testing-inline-prototype.html`（v2）。本文档先锁定作用域/模式模型，再开工。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 设计决策（作用域 / 模式 / 视图 / 布局模型） | 🔄 进行中 | 本文档 |
| Phase 1 | 内嵌测试 **UI 骨架**：侧边栏测试入口 + 上半面板（看板/流程/报告）+ 弹窗，**空状态**、不接引擎 | ✅ 已完成 | 侧边栏入口 + 三视图空态 + 新建任务/环境配置弹窗 + i18n；入口状态走 PanelContext（无竞态）；已移除 /test 与 composer chip |
| Phase 2 | **引擎落点调研 + POC**：用 LabCodepilot 的 claude-agent-sdk 运行时跑框架规则；Playwright 接入验证 | 🔄 进行中 | 调研完成 + 2.0 POC 跑通（独立路由调 streamClaude，零聊天改动，止于 dev 无凭证）；待 2.0b Playwright 冒烟 + 后续步骤 |
| Phase 3 | 看板（项目测试主页：任务列表 + 新建任务，**无代码分析/无模块自动发现**） | 📋 待开始 | 任务直接创建 |
| Phase 4 | 步骤 1-2 需求/用例（含导入 .docx/.xlsx、门控批准） | 📋 待开始 | 工作流起点 |
| Phase 5 | 步骤 3 执行（AI 驱动 Playwright + 四态自判 + 证据） | 📋 待开始 | 核心 |
| Phase 6 | 步骤 4 报告（双轨通过率 + xlsx 导出 + 历史对比） | 📋 待开始 | |
| Phase 7 | 环境配置 + 凭证（safeStorage）+ `AI_LabTest/` 写白名单安全 | 📋 待开始 | 复用现有安全体系 |
| Phase 8 | i18n 三件套 + 设计 token 映射 + 打磨 | 📋 待开始 | |

## 决策日志

- **2026-06-22 / Phase 2.0b Playwright 冒烟通过（第二大未知证实）**：① Chromium 已由 `@playwright/test` 缓存，但版本不匹配 → `npx playwright install chromium`（下了 v1208，~91MB，在全局 ms-playwright 缓存，不入库）。② 装 `@playwright/mcp@0.0.76`（dependency，带 cli.js，支持 --browser/--headless/--isolated/--caps/--output-dir/--viewport-size）。③ 裸 chromium 冒烟：launch+navigate+read OK。④ **关键**：给 `/api/test/run` 加 `step:'execution'` 模式，按运行注入 Playwright MCP（`{type:'stdio', command:process.execPath, args:[node_modules/@playwright/mcp/cli.js, --browser chromium --headless --isolated --caps devtools,network --output-dir <AI_LabTest/report/_evidence> --viewport-size 1280,800]}`）。curl 实测：status 帧暴露 **38 个 `playwright__browser_*` 工具**、无 MCP 连接错误 → **LabCodepilot 运行时能 spawn+连上 Playwright MCP 并把浏览器工具给到 agent**。仅 LLM 步缺凭证（同边界）。注：打包版需 `ELECTRON_RUN_AS_NODE=1`（runner.js 同款，留待打包步）。**结论：Phase 2 两大未知全部可行。**
- **2026-06-22 / Phase 2.0 POC 跑通（零聊天代码改动）**：新增独立路由 `src/app/api/test/run/route.ts`，用合成 sessionId 调 `streamClaude`（自定义 systemPrompt=需求分析规则 + workingDirectory=项目路径 + bypassPermissions），返回 SSE。**坑**：`streamClaude` 依赖运行时注册表，需 `import { predictNativeRuntime } from '@/lib/runtime'`（副作用注册），否则报 "No agent runtime registered"。面板流程视图加「运行任务」按钮 → fetch 该路由 → 解析 SSE 帧（text/tool_use/error）显示到日志。dev 实测：链路全通，provider 解析为 Qwen3.7-Max，仅止于 `No API credentials`（dev 无 key，与普通聊天同边界）——有凭证环境即可真跑。**结论：方案第一大未知（零侵入编程驱动 agent）证实可行。** 注：POC 用 bypassPermissions + prompt 约束写 AI_LabTest/；硬写白名单(包 canUseTool, 加 additive option)留待后续步骤。
- **2026-06-22 / Phase 2.0 调研结论（方案确认：混合 = 复用 SDK 运行时 + 薄复刻执行胶水）**：
  - **可编程跑 agent ✓**：`src/lib/claude-client.ts` 的 `streamClaude(options)` 可传自定义 `systemPrompt`/`workingDirectory`/`mcpServers`/`permissionMode`/`canUseTool` 并流式回传——这就是跑"测试步骤"的钩子（无需用户输入消息）。入口链：`/api/chat` → `streamClaude` → `streamClaudeSdk` → SDK `query()`。也有 `generateTextViaSdk()`(非流式、无 MCP) 备用。
  - **MCP 可按运行注入 ✓**：`mcpServers` 参数 + `toSdkMcpConfig()`，可只为执行步加 `@playwright/mcp`。
  - **Playwright 未打包 ✗（必须补）**：仅有 `@playwright/test` devDep，无 `@playwright/mcp`、无运行时 Chromium。Phase 2 需加 `@playwright/mcp` + Chromium 供给（注意打包：electron-builder extraResources / after-pack）。
  - **写白名单可行 ✓**：包一层 `canUseTool`（claude-client.ts:861）即可——Write/Edit 限定 `AI_LabTest/`、并把截图/录像 filename 重写到 evidenceDir 绝对路径（和框架 runner.js 同招）。会话可扩展 `chat_sessions` schema(db.ts)。
  - **可 vendoring 的（方法学，markdown 规则）**：requirement-discovery / requirement-review / requirement-completeness / test-case-completeness / test-execution / test-report / test-workflow（仿 `scripts/vendor-gsd-prepare.js`）。
  - **必须复刻的（确定性引擎逻辑，非 LLM，源自 framework/app/src/main/engine/runner.js）**：① `buildMcpServer`(--browser chromium --isolated --caps devtools,network --output-dir --storage-state，headed/headless) ② `reduceResults` 四态归并 + `ENV_HINT` 重分类 + 401 熔断 ③ `@@RESULT {json}` 流式解析(harvestResults) ④ run.json schema ⑤ evidence 目录管理(清理/嗅探扩展名/视频关联) ⑥ 登录态注入(password/token/capture)。
  - **数据格式**：cases.json(id/priority/caseType/steps[content,expected]/oracle/verification_nature/cleanup)、run.json(counts/passStr/tests[]/videos/circuitBroken/durationMs)、environments.json(allowedEnvs/accounts[]/tokenStorage)。
  - **修订后 Phase 2 子步**：2.0 POC(需求步, 无浏览器, 跑通 streamClaude+规则+白名单+面板流式+写工件) → 2.0b Playwright MCP 冒烟(加依赖+Chromium, 能 navigate) → 2.1 vendoring 规则 → 2.2 需求/2.3 用例(门控+导入) → 2.4 执行(Playwright+四态+证据+@@RESULT 解析) → 2.5 报告(md+xlsx) → 2.6 持久化(任务/项目落库)+凭证 safeStorage+环境配置真接。

- **2026-06-22 / 任务可点击 → 流程视图**：任务卡之前是静态 div（点了没反应）。改为：点任务 → `setSelectedTask` + 切到「流程」lens；流程视图按所选任务展示 4 步管线（需求→用例→执行→报告，未接引擎前各步"未开始"）+ "执行引擎接入中"占位 + ← 返回任务。切项目/返回会重置 selectedTask。已验证。
- **2026-06-22 / 项目从文件夹选择（用户决策）**：「添加项目」不再手填名称，改为**选择文件夹**——复用 `useNativeFolderPicker`（Electron 原生对话框）+ `FolderPicker`（浏览器 `/api/files/browse` 浏览对话框，与聊天"选择文件夹"同一套）。选中后项目名 = 文件夹 basename、path = 完整路径。移除了手填的 `AddProjectModal`。已验证：dev 浏览到 `/Users/jiah/AILab/ai-lab-test-framework` 选中 → 项目卡含真实路径。
- **2026-06-22 / 看板改为全屏多项目工作台（用户决策）**：① 打开「测试」后面板**占满整个内容区、盖住下方聊天框**（`InlineTestingPanel` 根节点改 `absolute inset-0 z-30`，ChatView/NewChatPage 根容器加 `relative`）；② 看板从"单当前项目"改为**多项目管理**——两级：项目层（项目列表 + 添加项目）→ 点项目进任务层（任务列表 + 新建任务 + 环境配置 + 返回）；③ 新增 `添加项目` 弹窗。数据用本地组件状态（真实、用户录入、非 mock，暂不持久化），添加项目/新建任务当场生效。已验证全链路：添加项目→进项目→新建任务→收起回聊天，无回归。
- **2026-06-22 / Phase 1 完成（弹窗 + 竞态修复）**：补完 `新建任务`（任务名 + 目标入口URL/鉴权 + 导入用例/需求/模板 + local/SIT 警告，无模块字段）和 `环境配置`（local/SIT 页签 + 前端/接口地址 + user/admin 账号 + safeStorage 说明）两个弹窗（Phase 1 为 inert 表单，仅开关）。**竞态修复**：原先侧边栏按钮用 `CustomEvent` 通知聊天视图开面板，存在"事件早于监听器挂载→首点无效"的竞态；改为把 `testPanelOpen` 提升到 **PanelContext**（`usePanel.ts` + AppShell），侧边栏 `setTestPanelOpen(true)` 直接驱动、聊天视图直接读，彻底消除竞态。已删除 `open-testing-panel` 事件 + `sessionStorage` 标志。
- **2026-06-22 / 测试入口（Routines 式，最终）**：入口定为**仅侧边栏按钮**——在**"新建对话"下方**（Claude Desktop Routines 位置）加「测试」按钮；按用户要求**移除了 composer 的「测试」mode chip**（ModeIndicator 还原为仅 代码/计划）。点击逻辑：若已在 `/chat` → 派发 `open-testing-panel` CustomEvent；否则设 `sessionStorage` 一次性标志并 `router.push('/chat')`。ChatView 与 NewChatPage 均监听事件 + 读标志 → `testPanelOpen`。纯增量、原侧边栏/聊天零回归。
  - ⚠️ **HMR 陷阱**：编辑 `ModeIndicator`（增删 Tab）时若 dev 在跑，服务端会缓存旧 SSR → `/chat` 报 hydration mismatch（服务端有 `-trigger-test`、客户端没有）。**重启 dev（清 `.next`）即消失**，非真 bug。
- **2026-06-22 / Phase 1 落地（核心）**：「测试」做成 composer 第三个 mode（代码/计划/测试），但 `测试` **不写入持久化、不传给 agent 的 `mode`** —— ChatView 与 NewChatPage 各加一个独立的 `testPanelOpen` UI 状态，`代码/计划` 行为零改动（非侵入）。面板组件 `src/components/test/InlineTestingPanel.tsx`（看板/流程/报告 三视图 + mock），停靠在消息线程上方。注意：composer 有**两处**渲染——`ChatView.tsx`（已开会话）和 `src/app/chat/page.tsx` NewChatPage（新建/空状态），两处都要接。四态色用语义 token（success/error/warning/info）。已移除 `/test` 路由 + `TestWorkspace` + 侧边栏按钮。验证：tsc 0 + dev 截图三视图正常、原聊天零回归。
- **2026-06-22 / 形态**：测试做成**对话模式**（代码/计划/测试并列），不是独立页面。理由：测试流程本身是对话式的（AI 驱动、门控需人批、用户随时改判定），"上半结构化面板 + 下半对话流"最贴切。**推翻 Phase-1 的 `/test` 独立路由方案**（见下"对 Phase-1 的处置"）。
- **2026-06-22 / 去掉代码分析（用户决策）**：移除框架的 Step 1 代码分析（`decompose.js` 自动扫源码出 `modules.json`）。连带影响：① 看板不再展示"业务模块清单（代码分析产物）"那批模块卡；② 新建任务不再"关联业务模块继承入口/鉴权"，改为**手动指定目标（入口 URL + 鉴权）或导入需求/用例**；③ 工作流从需求开始。默认**彻底任务优先、去掉"模块"概念**（若需保留手动维护的模块分组再议）。
- **2026-06-22 / 作用域**：两级模型。**项目级** = 看板(测试任务列表)；**任务级** = 每个测试任务是一条 🧪 对话，跑 需求→用例→执行→报告。
- **2026-06-22 / 视图 vs 对话解耦**：一个任务 = 一条**连续对话**；流程/报告是它的**只读结构化 lens**，切换 lens **不换** chat thread（修正原型 `renderThread(v)` 把对话与视图绑死的问题）。看板是项目级，不是某条对话的 lens。
- **2026-06-22 / 引擎落点（倾向，待 Phase 2 POC 确认）**：复用 LabCodepilot 已有的 `@anthropic-ai/claude-agent-sdk` 运行时来驱动框架的 markdown 规则，**不移植** standalone Electron app 的 CommonJS 引擎。理由：框架的"可移植"形态本就是规则 + 命令；LabCodepilot 自带 agent runtime（另见 [decouple-claude-code.md](decouple-claude-code.md)）。
- **2026-06-22 / 步骤编号**：去掉代码分析后，工作流就是 **4 步（1-based）**：需求 → 用例 → 执行 → 报告。原型里的 "Step 2/3/4/5" 改为 1 开始，且不再有 Step 1 分析。

## 详细设计

### 1. 核心概念：测试 = 对话模式

- composer 模式行：`代码 / 计划 / 测试` 三选一（primary intent，互斥）。
- 选「测试」→ 对话上方浮出**测试面板**；面板与"测试模式"显隐联动。
- 一条 🧪 测试对话默认进入测试模式。

### 2. 作用域模型（两级）

```
测试工作台（点侧边栏「测试」→ 全屏，盖住聊天框）
├── 看板 = 多项目管理
│     ├── 项目层：项目列表 + 添加项目
│     └── 点项目 → 任务层：任务列表 + 新建任务 + 环境配置 + ← 返回
├── 流程 = 单任务执行流程（4 步：需求→用例→执行→报告，后续接引擎）
└── 报告 = 单任务结果（后续）
```

- **导航**：看板「新建任务 / 打开任务」→ 创建/进入**该任务的对话**（自动切到流程 lens）。
- 看板本身是"项目测试主页"，可无独立 chat（或一条轻量项目级对话）。
- **新建任务**：任务名 + 目标（手动入口 URL + 鉴权，或导入需求/用例）→ 智能跳步；不再从代码分析继承模块上下文。

### 3. 面板 / 模式 / 收起 关系

| 控件 | 作用 |
|------|------|
| `测试` 模式 chip | 主开关：进入/退出测试上下文（与 代码/计划 互斥） |
| `看板 / 流程 / 报告` 分段 | 面板内**视图/lens 切换**（不换 chat thread；看板↔任务是作用域切换） |
| `✕ 收起` | 仅折叠面板、**保留测试模式**（快捷腾出对话空间） |

### 4. 布局与竖向空间（原型最大隐患）

- 面板默认 `max-height:46vh` 时，看板任务/报告表格/对话都被挤；执行时用户要同时盯进度 + 实时 tool 调用。
- 决策：
  - 分隔条**可拖 + 高度持久化**（按项目或全局存）。
  - **流程** lens：保持上下分屏，对话区设**最小高度**（如 200px），保证 live tool-call 始终可见。
  - **看板 / 报告** lens：支持「**展开占满**」（折叠对话），它们是 review-heavy。
  - **报告**支持全屏/弹出查看（12+ 用例在小面板里滚动体验差）。

### 5. 细节规范

- **i18n**：全部文案走 `src/i18n/en.ts`(源) + `zh.ts` + `zh-HK.ts` 三件套（参考已加的 `nav.test` / `test.*`）。
- **设计 token**：弃用原型自带色变量，映射到 LabCodepilot 语义 token（`bg-card` / `text-muted-foreground` / `border-border` / `bg-accent` 等），随主题切换。
- **跑全部**：对真实环境批量执行有风险 → 加确认 + 每任务各自走存活探测。
- **环境选择器**：面板头的 local/SIT 与环境配置弹窗保持同步。
- **忠于框架的不变量**（必须保留）：四态(通过/未通过/部分/阻塞)、"阻塞≠缺陷"、"报告只列事实不给修复方案/优先级/发布决策"、local/SIT only + 存活探测 + 拒绝 UAT/生产、`AI_LabTest/` 只写白名单 + 业务源码只读、功能验证率 vs 执行率双轨、导入用例/需求→智能跳步。

### 6. 待确认 / 待调研（Phase 2 解决，勿臆造）

- ❓ LabCodepilot 当前**是否打包 Playwright/Chromium**？（测试框架是运行时自下的）—— 影响 Phase 5。
- ❓ 引擎落点最终确认：claude-agent-sdk 跑规则 vs 移植 standalone 引擎（倾向前者，需 POC）。
- ❓ `AI_LabTest/` 写白名单如何在 LabCodepilot 的工具**权限体系**里落地（canUseTool 边界）。
- ❓ 测试凭证复用 LabCodepilot 现有 safeStorage / 列加密体系（见 [credential-encryption.md](../completed/credential-encryption.md)）。

### 对 Phase-1 的处置

已在 `V2.2_test` 分支搭的独立 `/test` 路由方案（[src/app/test/page.tsx](../../../src/app/test/page.tsx)、[TestWorkspace.tsx](../../../src/components/test/TestWorkspace.tsx)、ChatListPanel 的 `/test` navItem、`nav.test`/`test.*` i18n）将被**内嵌测试模式**取代：

- **保留**：`nav.test` / `test.*` i18n 文案大体可复用。
- **改造**：侧边栏「测试」按钮 → 改为"打开当前项目测试看板"的入口（或并入项目右键/对话模式），不再指向独立整页路由。
- **移除/降级**：`/test` 路由与 `TestWorkspace` 整页骨架（除非保留为看板的某种降级展示）。
- 决定在 Phase 1 开工时一并处理，避免两套入口并存。

### 验收标准（Phase 1）

- 在一条对话里切 `测试` 模式 → 浮出测试面板，看板/流程/报告三视图可切、弹窗可开，纯 mock 数据。
- 切 lens 不丢对话；收起/展开/拖拽分隔条正常；原有 代码/计划 模式与聊天**零回归**。
- 文案走 i18n、配色走 token、`tsc --noEmit` 通过、`npm run dev` 实跑 + CDP 截图验证。
