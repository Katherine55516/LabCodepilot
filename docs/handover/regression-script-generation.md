# 成功回归用例自动沉淀 Playwright 脚本

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
- `POST /api/test/scripts/retry`：按当前 run hash 重试全部缺口或指定 case ID。
- `POST /api/test/scripts/run`：运行指定/全部 `verified|needs_review` 脚本，回写验证时间和审计。

`ReportStepPanel` 的“产出资料”新增第四张“回归自动化脚本”卡，queued/running 每 2 秒轮询；可查看脚本和每条状态、重试缺口、运行单条或全部。它不是流程节点。

## 运维与验证

- 开发态运行 UI 前若刚执行过 Electron 打包，先 `npm rebuild better-sqlite3` 恢复 Node ABI。
- 打包流程的 `after-pack.js` 会再把 better-sqlite3 重编译为 Electron ABI。
- 定向测试：`src/__tests__/unit/test-script-generation.test.ts`、`test-exec-stream.test.ts`。
- 关键检查：同 run 重复报告不改 manifest；相同语义不改脚本 mtime；trace/脚本/输出无真实秘密和本机路径；Next dev 与 standalone 均能解析 MCP 配套 runtime/browser。
