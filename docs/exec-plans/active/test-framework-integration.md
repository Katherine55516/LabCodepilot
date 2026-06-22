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

- **2026-06-22 / 执行步证据采集收口**：补齐框架 runner.js 的证据收口（让截图/录像可靠落到 `AI_LabTest/report/_evidence/{任务}-{env}/`）。① 新增 `src/lib/test/evidence.ts`（纯 fs，单测 5 例）：`sniffExt`（magic number → png/jpg/webm/gif）、`sweepStrayEvidence`（把本轮 mtime≥runStart、名字像证据 TC-*/媒体后缀 的文件从项目根 + report/ 顶层移进证据目录）、`normalizeEvidenceExt`（无后缀文件按 magic 补后缀）、`writeMcpLauncherShim`（写 chdir 垫片到 tmpdir）。② `buildPlaywrightMcp` 改为经垫片启动：`command=execPath, args=[shim,...flags]`，`env` 注入 `AILAB_MCP_CWD=证据目录绝对路径`、`AILAB_MCP_CLI=cli.js`、`ELECTRON_RUN_AS_NODE=1`（打包态 execPath=Electron），并预建证据目录使 chdir 目标存在（stdio MCP 不支持 cwd，故用垫片 chdir 让相对名写入落到证据目录）。③ 路由 `wrapExecutionStream` done 分支：先 `sweepStrayEvidence` + `normalizeEvidenceExt`，再归约写 run.json（捕获 `runStartMs` 传入）。**canUseTool 改写截图路径未做**：`streamClaude` 自管 canUseTool（权限/bypass），调用方不便注入，硬塞要改共享聊天路径（违反隔离）；`--output-dir` + 垫片 chdir + 运行后扫散落 已覆盖绝大多数散落，故放弃 canUseTool 这层。**验证**：① evidence 单测 5 例全过（sniff/sweep 按名+mtime/normalize/shim 内容）；② curl 执行路由实测：MCP 经垫片启动**无报错**（dev 日志 mcpServers=2 已连，无 chdir/ENOENT）、证据目录已建、run.json 落盘、run_json 帧补发；tsc 通过。**仍需真跑验证**（无凭证跑不到浏览器实操）：chdir 后截图真正落入证据目录、sweep 真移散落文件。环境账号配置 + baseUrl 接入执行为下一轮。

- **2026-06-22 / 执行步 run.json 确定性归约（落盘 + 前端读）**：把执行结果从「AI 自写 run.json、内存态、刷新即丢」升级为「代码确定性归约 + 落盘 + 前端读」。① 新增 `src/lib/test/reduce.ts`（移植 framework runner.js 的 harvestResults + reduceResults）：纯函数——从流式文本里抓 `@@RESULT` 行 → 四态计数 + 状态归一（passed→pass、skipped/flaky→partial 等）+ **ENV_HINT 重分类**（fail 且报错命中连接/DNS/超时关键词 → 改判 blocked，非应用 bug）+ **401 熔断**（>50% 的 fail 带 401 → circuitBroken）+ status/passStr。② 单测 `src/__tests__/unit/test-reduce.test.ts`（12 例全过）锁住归约逻辑。③ 路由 `/api/test/run` 执行步用 `wrapExecutionStream` 包装 streamClaude 的 SSE：原样转发每帧给前端 + 服务端累计 text 帧 → 流结束时 `reduceFromText` → 写 `AI_LabTest/report/{任务}/{任务}-{env}.run.json` + 末尾补发 `{type:'run_json'}` 帧。④ 执行 prompt 改为「不要自己写汇总，平台据 @@RESULT 确定性归约」。⑤ 前端 runStep 处理 `run_json` 帧 → 用归约结果覆盖 fourState/caseResults（含 env-reclass/401），circuitBroken 时报告页顶部红条警告。新 i18n：test.report.circuitBroken。**验证**：① reduce 单测 12 例全过（含 ENV 重分类、401 熔断、中文连接词）；② curl 直打执行路由（dev 无凭证→走到 NO_CREDENTIALS error 帧）实测**末尾仍补发 run_json 帧 + run.json 正确落盘**（schema：module/env/time/status/counts/passStr/circuitBroken/tests）；tsc 通过。③ 前端 run_json 消费为 tsc 干净的简单 handler，喂给上轮已视觉验证的报告视图，circuitBroken 红条为 4 行条件渲染（代码级验证，真遇 401 熔断时显现）。**仍待真跑验证**：证据采集收口（MCP 垫片 chdir / canUseTool 改写 filename / sweepStrayEvidence 扫散落 / normalizeEvidenceExt 补后缀）——需真浏览器跑 + 凭证，下一轮做。

- **2026-06-22 / 门控模型 + 报告视图（task 8+9，贴原型）**：① **门控**：`StepStatus` 加 `review`（待批准）；`HUMAN_GATED=[requirement,cases]` —— 需求/用例跑完落 `review`、执行/报告落 `done`。流水线步骤名后给人工门控步加 ✋。`runStep` 成功后按 HUMAN_GATED 决定 review/done。`approveStep` 把 review→done。**自动链**用一个仅依赖 `[stepStatus,runningStep]` 的 effect：发现「非门控 + idle + 上一步 done」的步就自动 `runStep`——即 用例批准后 执行→报告 自动连跑。下方对话出现**门控条**（`reviewStep` 存在时）：「✋ {步骤}已完成，请审阅产物后批准 [✓ 批准]」。② **报告视图**：执行步解析 `@@RESULT` 帧时除累计四态外，存进 `caseResults`（id/status/actual/error/evidence）；`ReportView`=指标行（功能验证通过率=pass/(总-阻塞)、用例总数、执行通过率=pass/总、缺陷=fail）+ 结果表（ID/实际结果/状态四态chip/证据/原因）+「只列事实」注。报告 tab 有 caseResults 才渲染表，否则空态。③ 新 i18n：test.stepStatus.review、test.gate.approve/pending/auto、test.convo.empty/placeholder；复用既有 test.report.*、test.state.*。**dev 验证**（CLAUDE.md 推荐的 mock 法）：因 dev 无凭证（NO_CREDENTIALS）真跑每步必失败，故用 CDP 注入 fetch 拦截 `/api/test/run` 返回模拟 SSE（text/tool_use/@@RESULT），实测全链路：需求→待批准+门控条→批准→已完成→用例→待批准→批准→**执行/报告自动连跑**→四步全绿；报告页指标 50%/3/33%/1 + 三行结果表（TC-001通过/TC-002未通过/TC-003阻塞）四态色正确；控制台无报错、tsc 通过。mock 验证后已 `window.fetch` 还原。④ composer 仍禁用（多轮答门控/追加指令 = 后续；当前门控用按钮）。**技术债**：组件 761 行超 eslint max-lines(500)，非阻塞；后续把 modals/ReportView/helpers 拆到 parts 文件。**剩余（后续轮）**：执行步证据/run.json 确定性归约（现 AI 自写）、环境账号配置 + baseUrl 接入执行、看板任务卡步骤圆点（需 per-task 状态）、打包态完整规则、真实凭证下端到端跑通。

- **2026-06-22 / 按原型重做流程：回到「测试面板上 + 测试对话下」分屏**：用户重新提供 `testing-inline-prototype.html`（v2，364 行），要求流程按原型设计，并选择「回到上下分屏（贴原型）」。读原型确认其流程设计：① 流程视图 = 横向 4 步流水线（状态圆点 + 当前步描边）+ 当前步详情卡（执行 = 四态 chips 通过/未通过/部分/阻塞 + 进度条 + 当前用例）；② **门控模型**：需求/用例 = 人工门控（✋ 待批准→批准），执行+报告 = 自动链；③ 执行细节流到**下方对话**（不在面板内）；④ 报告视图 = 指标行 + 结果表。**本轮实现（task 6+7）**：把 `InlineTestingPanel` 从全屏单视图改成分屏——进入某任务的「流程」时区域上下分：上 = 测试面板（横向 4 步流水线 + 当前步详情卡），下 = 测试对话（agent 运行流以气泡呈现 + composer 占位）。看板/报告仍全高。`runStep` 改为把 SSE 流推进 `convo` 气泡（ai/tool/user/error）并对执行步的 `@@RESULT` 帧累计四态 + 抓当前用例（`▶`）。流水线步骤可点（受门控解锁约束）运行，状态驱动圆点/徽章。**dev 实测**（/tmp/ailab-demo「订单创建流程」任务）：分屏布局/横向流水线/当前步详情卡/下方对话/composer 占位全对；点「运行任务」→ 下方对话出现「▶ 运行『需求分析』」气泡 + 错误气泡 `No API credentials`（dev 无 key 同边界），流水线「需求分析→失败」，控制台无报错，tsc 通过。**注**：组件 648 行触发 eslint max-lines 警告（非阻塞，`eslint --fix` 无 --max-warnings）；加报告视图时拆分模块。**下一轮（task 8+9）**：门控模型（需求/用例人工批准 + 执行/报告自动链，对话内门控条）、报告视图（指标行 + 结果表，读 run.json）、看板任务卡步骤圆点。composer 当前禁用（门控应答接入后启用）。

- **2026-06-22 / Phase 2 Stage A：接入 framework 执行流程 + flow 视图改上下垂直布局**：把 ai-lab-test-framework V0.3 的执行流程（6 步裁掉「代码库分析」「需求评审」= 需求分析→用例设计→测试执行→测试报告 4 步）移植进工作台。① 规则文件复制进 `src/lib/test/rules/`（requirement-discovery / test-case-completeness / test-execution / test-report，逐字搬自 framework/rules）。② 新增 `src/lib/test/prompts.ts`：4 步的角色 system prompt **逐字搬自框架引擎**（requirements/testcases/runner/report.js），user prompt 按框架 buildPrompt 改写以适配 LabCodepilot「任务」维度——框架以「模块」为单位且带 Step1 的 key/entry/coreApis，这里只有任务名+项目路径，故走 L2/L3 自动回退、不依赖模块元数据；规则用 `loadRule()` 从 `src/lib/test/rules` 读（dev 直接读；打包态 `outputFileTracingExcludes` 剥 `**/*.md` → 回退到 prompt 内置精简规则，完整规则随包属下一轮硬化）。③ `/api/test/run` 改成 4 步（step∈{requirement,cases,execution,report}），仅 execution 注入 Playwright MCP；产物落 `AI_LabTest/`（requirements/{任务}-需求.md → testCase/.data/{任务}.cases.json → report/{任务}/{任务}-{env}.run.json → report/{任务}/{任务}-{env}.md），下一步读上一步产物。④ flow 视图从横向 4 卡片改成**上下垂直布局**：4 步从上到下，每步带状态圆点+徽章（未开始/运行中/已完成/失败）+「运行」按钮（顺序门控：上一步 done 才解锁）+ 可展开的流式日志（复用 `toolUseLabel`）。每步独立 `runStep()` 流 SSE。**dev 实测**：在 /tmp/ailab-demo 建任务进 flow → 垂直布局/连接线/门控（仅需求步可运行）/状态徽章/日志全对；点「运行」需求步 → 链路通到 `streamClaude`、provider 解析为 Qwen3.7-Max，止于 `No API credentials`（dev 有 base URL 无 key，与既有边界一致，非代码缺陷）→ 失败徽章+错误日志渲染正常，控制台无报错。**Stage A 范围**：执行步的证据采集/run.json 确定性归约（现由 AI 自写）、环境账号配置、需求步 2-pass 自审、打包态完整规则——均为下一轮。

- **2026-06-22 / 测试工作台加模型选择器**：头部加 `ModelSelectorDropdown`（复用聊天那套）+ `useProviderModels(providerId, model)`（拉 `/api/providers/models` 的账号下发模型）。选中持久化到 localStorage 并传给 `/api/test/run`。dev 无登录 → 下拉列表为空（显示「暂无托管配置」，触发器为占位「选择模型」），打包登录后账号下发模型才会出现可选——与登录体系一致。**下拉方向修复**：`ModelSelectorDropdown` 原硬编码 `bottom-full left-0`（为底部 composer 设计，向上展开），放到顶部头部会向上溢出看不到。加两个可选 prop——`menuSide`（`'top'`默认/`'bottom'`）+ `menuAlign`（`'left'`默认/`'right'`），靠 tailwind-merge 覆盖（`top-full bottom-auto` / `left-auto right-0`）；测试台传 `menuSide="bottom" menuAlign="right"`，聊天 composer 不传 = 行为不变。已用 DOM 实测：测试台下拉向下展开且右对齐不溢出（菜单 right 1365 < 视口 1440），composer 仍向上左对齐不裁剪。
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
