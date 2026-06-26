# 测试报告就地展示 + 产物预览 + 执行端接口/录像采集

> 产品思考见 [docs/insights/test-report-inline-display.md](../insights/test-report-inline-display.md)
> 执行计划见 [docs/exec-plans/active/test-report-display-and-evidence.md](../exec-plans/active/test-report-display-and-evidence.md)

测试工作台流程页（`InlineTestingPanel` 的 `flow` 视图）在「测试报告」节点完成后，**就地展示报告**（此前只显示占位文字「详细执行过程见下方对话 ↓」）。同时强化了缺陷报告的接口信息、证据的录像采集。

## 一、用户可见行为

报告步 `done` 后，详情卡（替换原占位）展示三段：
1. **概览条** —— 功能验证通过率 / 执行通过率 / 失败·阻塞 / 用例总数；有失败用例时显示「交给研发修复（N）」。
2. **产出资料列表** —— 测试报告.md（点开修改）、测试报告.xlsx（存在才显示，预览/导出）、缺陷报告.md（有则点开修改，无则「生成缺陷报告」）。
3. **内嵌报告全文** —— 可折叠的 `ReactMarkdown` 渲染。

产物预览（弹窗）：
- **md（测试报告/缺陷报告）**：默认 `ReactMarkdown` 渲染；切「编辑」用 CodeMirror `MarkdownEditor`，⌘S/保存写回。
- **xlsx**：解析为只读表格；证据单元格（`.png`/`.webm` 等）渲染成可点开的 chip → 截图灯箱 / 录像内联播放。

报告步 `error` 时只显示失败提示，不渲染空报告。

## 二、数据流

```
执行步（AI 驱 Playwright MCP）
  ├─ 每条用例 browser_start_video({filename:"{用例ID}.webm"}) / browser_stop_video
  │    → pass 不进 evidence；fail/partial 写 {用例ID}.webm 进 evidence
  ├─ fail/partial：browser_network_requests + browser_network_request
  │    → 关键请求 方法/URL/状态码/请求体/响应体
  └─ 输出 @@RESULT {id,status,actual,evidence[],error,api{...}}     （单行 JSON）
       │
reduce.ts  harvestResults → reduceResults
  ├─ sanitizeApi(r.api)：丢非对象/空捕获，服务端再次截断 body(~4000)
  └─ ReducedTest 带 api? + evidence(含 .webm) → run.json
       │
GET /api/test/reports  （读 run.json + 同目录 .md / -缺陷报告.md / .xlsx）
  → ReportEntry { …, tests[].api, markdown, defectMarkdown, xlsxFile }
       │
ReportStepPanel（报告步 done 时 fetch）→ 概览/产物/全文 + 预览弹窗
```

## 三、Schema 变更（run.json）

`src/lib/test/reduce.ts`：
- 新增 `ApiInfo { method?; url?; status?: number|string; requestBody?; responseBody? }`。
- `RawResult` / `ReducedTest` / `RunJson.tests[]` 增可选 `api?: ApiInfo`。
- `evidence: string[]` 不变，新增约定：可含 `.webm` 录像文件名（fail/partial）。
- 新增 `sanitizeApi(raw): ApiInfo | undefined`（导出，便于单测）；`reduceResults` 透传 `api`（**不参与四态归约**）。

向后兼容：旧 run.json 无 `api` → `tests[].api` 为 `undefined`，消费方按缺省处理。无 schema 迁移（run.json 非 SQLite，纯文件）。

## 四、API 路由

| 路由 | 变更 | 说明 |
|------|------|------|
| `GET /api/test/reports` | 改 | `tests` 自动带出 `api`；新增 `xlsxFile`（同任务目录里含本 env 标签的 `.xlsx` basename，存在才回传） |
| `GET /api/test/report-xlsx` | **新增** | `?projectPath&taskName&file` → exceljs 解析为 `{sheets:[{name,rows:string[][]}]}`；`?download=1` → 回传原 .xlsx（attachment）。路径加固：`isUnsafeSegment(taskName)` + `file` 取 basename，白名单到 `AI_LabTest/report/{taskName}/` |
| `POST /api/files/write` | 复用 | md「点开修改」保存：`{path: rel, baseDir: projectPath, content, overwrite:true, createParents:true}` |
| `GET /api/test/media` | 复用 | 证据截图/录像流式服务，已支持 webm/mp4 + Range（拖动播放） |
| `POST /api/test/defect` | 改 prompt | 结构化缺陷模板，接口信息读 `tests[].api`（见下） |

## 五、Prompt 变更

- `src/lib/test/prompts.ts` `executionPrompt`：`@@RESULT` schema 增 `api`；新增「录像起停（每用例一段、pass 丢弃 fail/partial 保留）」「失败采集接口信息（network 工具）」两步。
- `src/lib/test/rules/test-execution.md`：工具表加 video/network 工具；执行循环加开录/停录/采接口；§4 结果 JSON 示例加 `api` + 录像 evidence。
- `src/app/api/test/defect/route.ts`：`接口信息` 从「method/URL/状态码/响应」扩成逐子项 `方法/URL/状态码/请求体/响应体`，读 `tests[].api`；证据加「录像」。

## 六、执行步用到的 MCP 工具（@playwright/mcp 0.0.76）

| 工具 | 能力组 | 参数 | 自动批准 |
|------|--------|------|---------|
| `browser_start_video` / `browser_stop_video` | `--caps=devtools`（**当前启动已带 `devtools,network`**，无需改启动参数） | start: `{filename, size?}` | 执行步整体 `bypassPermissions:true` + `autoTrigger:true`（见 run/defect route），随测试执行自动批准 |
| `browser_network_requests` | 核心（无需 cap） | — | 同上 |
| `browser_network_request` | 核心（无需 cap） | `{index, part?}` 取单条完整 headers+body | 同上 |

> Playwright MCP 注入逻辑见 `prompts.ts` `buildPlaywrightMcp`（仅执行步注入，启动参数含 `--caps devtools,network --output-dir {evidenceDir}`）。

## 七、关键组件（均在 `src/components/test/InlineTestingPanel.tsx`）

| 组件 | 职责 |
|------|------|
| `ReportStepPanel` | 报告步面板：fetch reports → 概览/产物列表/内嵌全文 + 失败态；defectGen/handoff 内联 |
| `PreviewModal` | 预览弹窗壳（复刻 cases 编辑器的 `fixed inset-0` 模态） |
| `MdPreview` | md 渲染/编辑切换；编辑用 `MarkdownEditor.lazy`，保存走 `/api/files/write` |
| `XlsxPreview` | 调 `/api/test/report-xlsx` 渲染只读表格；证据 chip → 灯箱/`<video>`（复用 `ReportView` 的 mediaUrl/isVid 口径） |

**复用**：`ReportView`（指标卡 + 证据灯箱/录像回放范式）、`funcPassRateStr`（compare.ts，功能验证通过率口径）、`MarkdownEditor.lazy`（CodeMirror）、`react-markdown`+`remark-gfm`。

证据「截图 vs 录像」按扩展名分类（`.png/.jpg…` vs `.webm/.mp4/.mov`），不改 `evidence` schema。

## 八、i18n

新增 key（`en.ts` 为类型源，`zh.ts` / `zh-HK.ts` 同步）：`test.media.image`、`test.report.{deliverables, deliverablesHint, fileXlsx, openEdit, exportFile, tabPreview, tabEdit, save, saving, saved, saveFailed, close, stepFailed, docEmpty, xlsxEmpty, xlsxLoadFailed}`。

## 九、已知边界 / 技术债

- **录像起停可靠性**：`browser_start_video`/`stop_video` 多次起停 + 按 filename 落盘 + 「pass 段丢弃」的实际行为，需一次真实执行验证（POC）。若 MCP 不支持丢弃 pass 段，退化为「全部保留 + 前端只展示 fail/partial」，并由平台侧清理未被任何 `evidence` 引用的录像。
- **接口 body 截断/脱敏**：prompt 要求 ≤4000 字符；`sanitizeApi` 服务端再次截断。敏感数据（token/密码）脱敏策略未实现（开放问题）。
- **xlsx 是按需交付物**：报告步默认只写 .md，xlsx 由 `anthropic-skills:xlsx` 按需生成、命名 `{模块}-report-{ENV}-{date}.xlsx`，reports API 用「含 env 标签的 .xlsx」启发式检测，多份取首个。
- **大报告渲染**：超长 markdown 内嵌渲染未做懒加载/虚拟化。

## 十、验证

- `npm run test`（typecheck + 单测）：通过；新增 `sanitizeApi`/`api` 透传单测（`src/__tests__/unit/test-reduce.test.ts`）。
- CDP（chrome-devtools MCP，dev `--webpack` 端口隔离 + fetch mock 注入报告 done 态）：报告面板三段渲染正确、md 点开修改的预览/编辑（CodeMirror）正常、xlsx 预览表格 + 证据截图/录像 chip 正常、无 console 报错、无 error boundary。
- 真实执行链路（录像/接口实采）需一次带失败用例的真跑验证（同时作为录像 POC）。
