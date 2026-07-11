# 执行成功回归用例自动生成 Playwright 脚本

> 状态：已完成 | 分支：V3.1.0_dev | 创建：2026-07-09 | 完成：2026-07-10
>
> 目标：保持现有「需求分析 → 用例设计 → 测试执行 → 测试报告」四节点不变；测试报告成功收口后，后台为本轮 `status=pass` 且 `tags` 含「回归测试」的每条用例生成、校验并可选回放一个独立 Playwright TypeScript 脚本。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 流程形态 | 不新增「自动化脚本」节点，不扩展 `TestStep` / `stepStatus` |
| 触发时机 | `wrapReportStream` 确认报告文件存在且流无错误后，提交后台任务；报告响应不等待生成 |
| 生成对象 | `cases.json.tags` 含 `回归测试`，且权威 `run.json.tests[].status === 'pass'`；整轮 `circuitBroken` 时暂停生成 |
| 产物 | 每用例一个 `AI_LabTest/scripts/<任务>/<环境>/<用例ID>.spec.ts`，同目录 `manifest.json` 管状态/指纹 |
| 重复执行 | `runHash` 仅去重同一报告任务；`caseHash + normalizedTraceHash + generator/template/runtime version` 决定脚本是否重写 |
| 失败策略 | 后台软失败，不改变测试执行/报告结果；UI 显示缺口并可只重试失败项 |
| 安全边界 | 模型只返回 JSON Schema 结构化代码，不获得 Write/Bash；平台校验路径、AST、敏感信息并原子发布 |
| 持久化 | MVP 使用文件 manifest + 文件锁恢复，不新增 SQLite schema |

## 1. 数据流

```text
执行 Agent SSE
  ├─ @@CASE_START {id}
  ├─ tool_use / tool_result（提取 Ran Playwright code，先脱敏）
  └─ @@RESULT
       ↓
wrapExecutionStream
  ├─ 现有确定性 reduce → run.json
  └─ 新增逐用例 trace → report/<任务>/.data/<任务>-<环境>.trace.jsonl
       ↓
wrapReportStream 报告成功
  └─ enqueueScriptJob(jobKey=project+task+env+runHash)，立即结束报告响应
       ↓
script-job-manager（全局并发 1 + singleflight + .generation.lock）
  ├─ join cases.json + run.json，代码筛 eligible cases
  ├─ 结构化生成（每批 ≤5，遗漏项单独重试一次）
  ├─ 静态安全/语法/Playwright --list/可安全时真实回放
  └─ .tmp → 原子 rename；manifest 记录 verified/needs_review/failed/stale/outdated
       ↓
ReportStepPanel 只在「产出资料」显示状态/查看/重试/运行，不增加流程节点
```

## 2. 数据模型

### 2.1 Trace

```ts
interface ScriptTraceAction {
  caseId: string;
  sequence: number;
  toolName: string;
  playwrightCode?: string;
  success: boolean;
  usesMock: boolean;
  timestampOffsetMs: number;
}
```

- 用 `@@CASE_START` 建立归属，`@@RESULT` 关闭；用 `tool_use_id` 配对工具结果。
- 只保留可重放代码/受控元数据；不落完整 snapshot、cookie、token、密码、绝对路径。
- `browser_route` 标 `usesMock`；用例外工具调用忽略。

### 2.2 Manifest

```ts
type ScriptJobStatus = 'queued' | 'running' | 'done' | 'partial' | 'error' | 'stale';
type ScriptCaseStatus = 'verified' | 'needs_review' | 'failed' | 'stale' | 'outdated';

interface ScriptManifest {
  version: 1;
  taskName: string;
  env: string;
  latestRunHash: string;
  jobStatus: ScriptJobStatus;
  generatorVersion: string;
  runtimeVersion: string;
  counts: { eligible: number; generated: number; verified: number; needsReview: number; failed: number };
  cases: ScriptManifestCase[];
}
```

- `runHash` 含时间/耗时，不能作为脚本语义指纹。
- 脚本指纹去除执行时间、耗时、证据文件名、base origin 和秘密；语义不变则不改脚本 mtime。
- 新版本失败时保留旧正式脚本，记录 `outdated`；当前不再符合条件则 `stale`，不自动删除。

## 3. 实施阶段

### Phase 0 — POC 与契约锁定

- 用本仓库 `@playwright/mcp@0.0.76` 验证 tool result 的 `Ran Playwright code` 提取。
- 验证打包态必须复用 MCP 内嵌 Playwright 1.61-alpha / 同 revision headless shell，不能误用顶层 1.58 runtime。
- 锁定结构化输出 schema、trace/manifest schema、脚本模板与敏感信息替换规则。

### Phase 1 — 轨迹采集与候选筛选

- 改 `executionPrompt`：每用例任何浏览器动作前输出 `@@CASE_START {id,index}`。
- 新增 `script-trace.ts`：帧状态机、tool_use/tool_result 配对、Playwright code section 提取、脱敏、归一化/哈希、原子写 trace。
- `wrapExecutionStream` 同时观察 text/tool_use/tool_result；权威 run.json 写完后以 runHash 关联 trace。
- 新增纯函数 `selectEligibleCases`，严格按 cases/run join；重复/缺失 ID 明确报错，禁止静默遗漏。

### Phase 2 — 后台任务、生成、幂等与恢复

- 新增 `script-job-manager.ts`：singleflight、全局并发 1、按任务环境文件锁、新运行优先、超时 running 恢复。
- `wrapReportStream` 成功后写 queued manifest 并 enqueue，不 await；无候选直接 `done(0)`。
- 新增 `script-generator.ts`：模型 JSON Schema 输出；每批≤5，缺失项单独重试；模型不具文件工具权限。
- 新增 `script-validator.ts`：路径/大小/导入/危险 Node API/test+expect/秘密/绝对路径/locator 质量检查；`.tmp` 原子发布。

### Phase 3 — Playwright 收集与回放运行器

- 新增 `script-runner.ts`：从 `@playwright/mcp` 安装位置解析配套 Playwright CLI/runtime。
- 在 `~/.codepilot/test-script-runs/<jobId>` 建隔离运行目录，注入 baseURL/storageState/受控凭据和打包浏览器路径。
- 强制 `--list` 收集检查；可安全重复执行时新上下文真实回放；写数据且无 cleanup 的脚本标 `needs_review`。
- 单脚本超时、进程树清理、输出脱敏；不要求被测项目安装 Playwright。

### Phase 4 — API 与报告区 UI

- 新增 `GET /api/test/scripts`、`POST /api/test/scripts/retry`、`POST /api/test/scripts/run`。
- ReportStepPanel「产出资料」新增自动化脚本行：queued/running 轮询；done/partial/error 展示数量；查看脚本、失败项重试、单条/全部运行。
- UI 不改四节点与任务完成语义；后台缺口用 badge/提示呈现。
- i18n 同步 `en.ts`、`zh.ts`、`zh-HK.ts`。

### Phase 5 — 回归库、审计与收尾

- 保留任务 `回归用例库` 不拥有重复脚本；按 `_source.task/_source.originalId` 回写源任务，缺来源标 `needs_review`。
- audit 记录 queued/generated/verified/failed/retry/run-script（best-effort，不阻塞）。
- 补 handover 文档和索引，完成单测、API 集成、真实 MCP POC、CDP、smoke/e2e、mac/Windows 打包边界验证。

## 4. 安全与失败边界

| 风险 | 处理 |
|---|---|
| 临时 MCP ref 不能复用 | 取 tool result 的 Playwright code；拒绝把 ref 写入脚本 |
| 凭据进入代码/模型/磁盘 | 已知值精确替换 + key-pattern 脱敏 + AST/文本二次扫描 |
| 生成代码越权 | JSON Schema 输出；平台写盘；导入 allowlist；禁 `child_process/fs/net/worker_threads` |
| 重复报告/并发执行覆盖 | jobKey singleflight + O_EXCL 文件锁 + 发布前 latestRunHash 比对 |
| 新脚本不可用却覆盖旧脚本 | `.tmp` 通过全部门槛后 atomic rename；失败保留旧版并标 outdated |
| 后台失败拖垮报告 | enqueue 后立即关闭报告流；全部错误收进 manifest，绝不改报告 done |
| 应用重启丢任务 | queued/running 落盘；启动恢复扫描；新 run 胜出 |
| 重放产生业务副作用 | 独立 context + 唯一测试数据 + cleanup；不可安全重放标 needs_review |

## 5. 验收标准

- 四节点及 `TestStep` 联合类型保持不变。
- 报告成功后自动创建后台任务，报告响应不等待。
- 符合条件 N 条时 manifest 必有 N 条记录，禁止静默遗漏。
- 每个成功回归用例一个独立脚本；smoke-only 不生成。
- 相同语义重复运行不改脚本 mtime；变化只更新对应文件。
- 新生成失败不破坏旧脚本；失去资格的旧脚本不进入当前运行集。
- local/SIT 隔离；同一报告重复触发只跑一个 job。
- 重启后 queued/running 可恢复；旧 job 不能覆盖新 run。
- 脚本/trace/日志均无真实凭据与本机绝对路径。
- 开发态与打包态均能用配套 Playwright 收集脚本；可安全用例真实回放通过。
- ReportStepPanel 能查看状态、脚本、重试和运行，console 无报错。
- `npm run test`、`npm run test:smoke`、相关 E2E、`npm run electron:pack` 按风险范围通过。

## 6. 进度

| Phase | 状态 | 备注 |
|---|---|---|
| Phase 0 POC/契约 | ✅ 已完成 | MCP tool result 提取与配套 runtime POC 通过 |
| Phase 1 轨迹/筛选 | ✅ 已完成 | trace 脱敏落盘；严格 cases/run join |
| Phase 2 后台/生成/幂等 | ✅ 已完成 | manifest、singleflight、文件锁、最新 run 胜出、缺口重试 |
| Phase 3 运行器 | ✅ 已完成 | 开发态与 packaged standalone 均真实拉起配套 headless shell |
| Phase 4 API/UI | ✅ 已完成 | 报告区卡片、轮询、脚本预览、单条/全部运行、三语 i18n |
| Phase 5 收尾/验证 | ✅ 已完成 | 回归库冻结来源映射；handover；全量 test/smoke/CDP/mac 打包通过 |

## 7. 完成记录

- `npm run test`：1952 passed / 1 skipped / 0 failed。
- `npm run test:smoke`：6/6 passed。
- CDP：桌面与 390×844 视口验证卡片/弹窗/脚本切换；console 0 error/warning；真实“运行所选”1 passed。
- `npm run electron:pack`：macOS arm64 `.app` / DMG / ZIP 成功；codesign deep strict 与 `hdiutil verify` 通过。
- 使用打包 `.app` 的 `ELECTRON_RUN_AS_NODE` + standalone MCP Playwright + Resources headless shell 实际启动浏览器，输出 `packaged-runner-ok`。
- Windows 未在 macOS 上执行安装包实机回放；实现已覆盖 `.exe` 探测、junction runtime 链接和 standalone cwd，仍需 Windows 发布流水线终验。
