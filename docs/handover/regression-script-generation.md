# 成功回归用例自动沉淀 Playwright 脚本

> 产品思考见 [docs/insights/regression-script-generation.md](../insights/regression-script-generation.md)

## 目标与边界

现有测试流程仍只有 `requirement → cases → execution → report` 四个节点。报告流确认报告文件已成功写出后，后台为本轮同时满足以下条件的用例生成一个独立 TypeScript Playwright 脚本：

- `cases.json.tags` 精确包含 `回归测试`；
- 权威 `run.json.tests[].status === "pass"`；
- 整轮没有触发 `circuitBroken`。

脚本生成是报告的软失败副产物，不改变报告 `done`、任务完成态或发版红线口径。

## 数据流

1. `executionPrompt` 要求每条用例在第一个浏览器动作前输出 `@@CASE_START {id,index}`。
2. `wrapExecutionStream` 旁路观察 SSE 的 `text/tool_use/tool_result`，用 tool use ID 配对结果，从 MCP 的 `### Ran Playwright code` 区段提取可重放代码。
3. 执行收口继续使用原有确定性 reducer 写 `run.json`，并以同一 run hash 写 `report/<task>/.data/<task>-<env>.trace.jsonl`。轨迹写入前替换项目路径、base URL、storage state、账号密码和常见 token 形态。
4. `wrapReportStream` 只有在报告文件存在、流无错误且未中断时调用 `enqueueScriptJob`。这里只等待 queued manifest 原子落盘，不等待模型生成或回放。
5. 单进程队列全局并发为 1；同任务环境另有 O_EXCL `.generation.lock`。后台完成结构化生成、静态检查、Playwright `--list`，安全可重放时再真实跑一次，最后原子替换正式脚本。

核心实现：

- `src/lib/test/script-trace.ts`：轨迹状态机、脱敏、JSONL；
- `src/lib/test/script-generator.ts`：资格 join、语义指纹、JSON Schema 生成；
- `src/lib/test/script-validator.ts`：代码大小、导入 allowlist、秘密/绝对路径/外网 URL/危险 API、test/expect、locator 质量；
- `src/lib/test/script-job-manager.ts`：队列、锁、恢复、幂等、旧版本保留；
- `src/lib/test/script-runner.ts`：隔离目录与 MCP 配套 Playwright/runtime/browser；
- `src/lib/test/script-artifacts.ts`：路径、manifest、原子写。

## 产物与幂等

普通任务产物：

```text
AI_LabTest/scripts/<task>/<env>/
  manifest.json
  <case-id>.spec.ts
```

manifest job 状态：`queued/running/done/partial/error/stale`；单用例状态：`verified/needs_review/failed/stale/outdated`。

`runHash` 只去重同一报告触发。是否重写单脚本由以下语义指纹决定：用例内容、去掉时间偏移后的成功轨迹、generator/template/runtime 版本。语义未变时复用正式文件，不改变 mtime；新版本生成或校验失败时保留旧文件并标 `outdated`；本轮失去资格的记录标 `stale`，不自动删除。

## 运行器与安全

模型只进行单轮 JSON Schema 文本生成，`tools: []` 且 `strictMcpConfig: true`，没有 Write/Bash/MCP 权限。平台决定文件路径并在候选临时文件通过所有门槛后 rename。

运行器不依赖被测项目安装 Playwright。它解析 `@playwright/mcp` 内嵌的 Playwright CLI，将该 runtime symlink 到 `~/.codepilot/test-script-runs/<id>` 的隔离目录。浏览器选择顺序：

1. 打包态 `AILAB_RESOURCES_PATH/ms-playwright`；
2. 开发态 `ms-playwright-bundle`；
3. 与内嵌 runtime revision 精确匹配的 Playwright cache。

有头运行仅在能定位系统 Chrome 时启用，否则回落配套 headless shell。输出最多保留末尾 20KB，并再次脱敏；运行目录在结束、超时或 spawn 错误后删除。

自动真实回放采用保守策略：用例疑似写业务数据且没有 cleanup 时只做 `--list` 并标 `needs_review`；使用 browser route mock、弱 locator 或来源缺失也进入待复核。

## 回归用例库

`回归用例库` 是合成执行任务，不拥有重复脚本。聚合前 `/api/test/library/run` 同时写：

- `.data/回归用例库.cases.json`；
- `.data/回归用例库.id-map.json`（本轮 run ID 到 `_source.task/originalId` 的冻结快照）。

报告后的脚本任务用冻结映射把文件写到真实源任务目录；aggregate manifest 保留 `sourceTask/sourceCaseId` 供查看、运行和重试。映射缺失或不安全时才保留在合成任务目录并标 `needs_review`。

## API 与 UI

- `GET /api/test/scripts`：读 manifest；带 `caseId` 时返回经根目录校验后的脚本文本；同时恢复落盘的 queued/超时 running job。
- `POST /api/test/scripts/retry`：按当前 run hash 重试全部缺口或指定 case ID。**盲目重新生成**——不读失败原因，旧脚本被丢弃。
- `POST /api/test/scripts/run`：运行指定/全部 `verified|needs_review` 脚本。跑通→提升 `verified` 并清 `lastRunError`；失败→**不降级 status**（脚本可能没问题、只是被测应用没起），把 `summarizeRunFailure` 提炼的一行原因写入 `lastRunError/lastRunAt` 持久化。
- `POST /api/test/scripts/repair`：**AI 修复**（手动单点）。把 `lastRunError` + 当前脚本 + 原用例喂回模型定向修（`repairScriptsBatch`），修复稿走生成同款校验/重放管线（`validateAndPublish`），全部通过才原子覆盖旧文件；未通过则旧脚本原样保留。与生成共用 `.generation.lock`。**红线**：prompt 要求只修技术缺陷（定位器/等待/前置），断言如实失败（页面行为 ≠ 用例预期）时必须 `fixed=false` 并给出测试人员能懂的解释——该解释持久化到 `repairNote`，防止"修复"掩盖真缺陷。生成期失败（无落盘脚本）不归 repair 管，走 retry。
- `POST /api/test/scripts/pipeline`：**自动跑通流水线**（`runPipelineForTask`）。运行→失败自动修→再跑，直至全部可修复的脚本通过。入口先探测被测应用可达性（`isSutReachable` 打 `frontendBaseUrl`，4s 超时），不可达直接报错。**终止条件**（`runAndRepairLoop`，`DEFAULT_MAX_REPAIR_ROUNDS=3` 兜底）：① 没有可修复的失败了；② 轮次上限；③ 每条用例只给**一次**定向修复机会——一次带确切失败原因的修复仍跑不通就 park 为「需人工」，不管模型自评 fixed 与否（结构性重跑守红线，不信模型嘴上说的）。**分类**：环境问题（连接被拒，`isEnvironmentFailure`）→ 不喂 AI、归「环境阻塞」；如实失败/修不好 → 归「需人工」并覆盖乐观 repairNote 讲真话。**自动触发**：报告流 `enqueueScriptJob({runPipeline:true})`，生成后在 `executeJob` 内（持锁）接着跑；被测应用不可达则跳过运行、只停在生成态。best-effort：流水线抛错落终态、不抹掉已生成脚本、不卡 `running`。

`ReportStepPanel` 的“产出资料”新增第四张“回归自动化脚本”卡，queued/running 每 2 秒轮询。**卡片只留一条动作主线**：查看脚本 + 「自动跑通」（流水线）+「重试缺口」（仅当存在【生成】缺口——无 manifest / job error/stale / 有用例 failed/outdated 时出现；刻意不含 partial，运行失败置 partial 但重新生成解决不了）。卡片重试完成后自动接流水线（retry 传 `runPipeline:true`）。原卡片级「运行全部」「AI 修复」已删——是流水线的子集，测试人员面对四个按钮会犯选择困难；单条精修（重试/运行所选/AI 修复）收在脚本弹框里。运行失败时卡片红字显示 `N 个脚本运行失败：<原因>`；弹框内按条显示 `lastRunError`（红）与 `repairNote`（蓝）。它不是流程节点。

## 生成/校验的关键决策（按踩坑顺序）

- `generateTextViaSdk` 超时参数化：批量 5 条完整 Playwright 文件 60s 必超时，按 `max(120s, n×60s)` 传入。
- SDK result 判读（`interpretSdkResult`）：`outputFormat: json_schema` 的结果在 `structured_output` 而非 `result`；error subtype 无 `result` 字段；`success + is_error` 是错误包不是答案；CLI 退出码 0 可静默结束流→用 assistant 文本兜底并透传 stderr。
- `normalizePlaywrightImport`：模型惯写 `@playwright/test`，但 runner 只 symlink 了 MCP 自带的 `playwright` 包（该包只依赖 playwright-core），`@playwright/test` 不可解析——校验前确定性重写为 `playwright/test`（语义等价，`playwright/test.js` 重导出同套 test/expect）。禁止反向放宽校验。
- `isSafeForAutomaticReplay` 只扫 `steps[].content`（动作），不扫 expected/purpose——否则「+ 新建学科」这类按钮名会把只读用例误判成写操作、永久挡在自动验证外。无结构化 steps 时保守回退扫全文。
- 生成 prompt 要求定位器唯一：`getByRole/getByText` 传字符串 name 必须 `{ exact: true }`（Playwright 默认子串匹配，列表卡片文案极易撞词造成 strict mode violation）；不许用 `.first()` 掩盖歧义。
- `.generation.lock` 僵尸锁判定：除 30 分钟兜底外，额外检查锁记录的 `pid` 是否存活（`process.kill(pid,0)`）——桌面应用被强退/崩溃留下的锁，持有进程已死即立刻抢占，不必等 30 分钟堵死后续任务。
- `enqueueScriptJob` 幂等去重 vs 手动重试：done/partial + 同 runHash + 无 forceCaseIds 的入队会被去重短路（保证报告流重复触发幂等）。**手动「重试缺口」必须传 `forceRefresh:true`**（retry 路由已固定传）——否则用例改了（指纹变了）或上轮有 failed 用例时，重试被静默吞掉、按钮空转（真机踩坑：改完用例预期点重试无任何反应）。forceRefresh 只跳过去重，executeJob 内指纹复用仍生效，没变的用例不烧模型。
- 运行/修复核心（`runScriptCases`/`repairScriptCases`）抽成 lock-free，手动路由（自持锁）与自动流水线（在 `executeJob` 锁内）共用同一份逻辑；`run`/`repair`/`pipeline` 三个手动路由各自 `acquireLock`，与后台生成互斥。
- **静态校验失败的生成期自纠闭环（2026-07-11）**：此前只有【运行时】失败有 `repairScriptsBatch` 回灌闭环，【静态校验】失败（多个 `test()`、标题缺用例 ID、多余 import 等）一次不合规就 dead-end 成 `failed`、无任何自纠——「重试缺口」只是同一 prompt 再赌一次（真机踩坑：网关模型把一条用例拆成多个 `test()` → 「每个脚本必须恰好一个 test(); test 标题必须包含用例 ID」→ 永久 0/1）。修法镜像运行时闭环：`resolveStaticValidContent`（纯函数、注入 repair 便于单测）在静态失败时把**确切校验错误**喂回 `repairScriptsBatch` 一次并复校，改好才采纳、否则保留原始错误。生成 prompt 另加**具体结构骨架**（一个顶层 `test()`、标题以 `scriptCaseId` 开头、用 `await test.step(...)` 分步——`test.step(` 不被校验器的 `/\btest\s*\(/g` 计数）从源头降不合规率；repair prompt 同步这条。
- **重放失败不再 dead-end（2026-07-11）**：`validateAndPublish` 里只读用例生成期【无条件真机重放】，此前重放失败 → `failed()`（**不带 `lastRunError`**）。而 `runScriptCases` 只跑 `verified|needs_review`、`repairScriptCases`/`runAndRepairLoop` 只碰带 `lastRunError` 的——`failed` 落在两个恢复通道之外成死态，被测应用没起时只读用例永久卡 0/1。改为：脚本既已过静态 + collect，就落盘、标 `needs_review` 并把 `replayError` 记进 `lastRunError`，交给既有闭环（运行→自动修 / `isEnvironmentFailure` 停靠 / 手动 AI 修复）在被测应用起来后收口。**collect 失败仍保留 `failed`**（连加载都过不了 = malformed，该重新生成）。恢复态契约抽成导出纯谓词 `isRunnableStatus`/`isFixableCase` 并单测，防后续新增恢复路径漏态。

## 运维与验证

- 开发态运行 UI 前若刚执行过 Electron 打包，先 `npm rebuild better-sqlite3` 恢复 Node ABI。
- 打包流程的 `after-pack.js` 会再把 better-sqlite3 重编译为 Electron ABI。
- 定向测试：`src/__tests__/unit/test-script-generation.test.ts`、`test-exec-stream.test.ts`、`sdk-result-interpret.test.ts`（SDK 四种 result 形态）、`script-import-normalize.test.ts`（import 归一化端到端契约）、`script-replay-safety.test.ts`（重放安全判定 + 失败摘要）、`script-repair.test.ts`（AI 修复载荷红线）、`script-pipeline-classify.test.ts`（环境失败分类器）、`script-validator-structure.test.ts`（一个 test()/标题含 ID/test.step 不计数——复现并守 2026-07-11 真机失败）、`script-static-repair.test.ts`（静态修复决策 `resolveStaticValidContent` + 恢复态契约 `isRunnableStatus`/`isFixableCase`）。
- 流水线端到端真机验证（打包版 + live SUT，两轮）：① R02 注入定位器歧义 → AI 自动诊断补 `exact:true` → 重跑通过（`verified`）；R03 断言如实失败（页面不禁用按钮） → 1 轮内判「需人工」、覆盖乐观 repairNote 讲真话、不 force-pass；终态 `partial` 不卡死。② 证实每条用例只 1 次修复机会、环境不可达跳过、孤儿锁按 pid 存活抢占。
- 关键检查：同 run 重复报告不改 manifest；相同语义不改脚本 mtime；trace/脚本/输出无真实秘密和本机路径；Next dev 与 standalone 均能解析 MCP 配套 runtime/browser。
