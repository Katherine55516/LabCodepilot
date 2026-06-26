# 测试报告就地展示 + 产物预览 + 缺陷结构化 + 执行端接口/录像采集

> 创建时间：2026-06-26
> 最后更新：2026-06-26
>
> 入口需求：测试报告节点完成后，要在工作台流程页**就地展示测试报告**（当前只显示占位文字「详细执行过程见下方对话 ↓」）。参照 ai-lab-test-framework 的「产出资料 / 本步产物 · 点开修改」逻辑。
> 设计已通过原型逐项确认（见决策日志），范围从「报告展示」扩展到「产物预览 + 缺陷报告结构化 + 执行端接口信息/录像采集」。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 设计定稿（原型确认 + 决策） | ✅ 已完成 | 本次会话，含 5 份原型 |
| Phase 1 | 执行端结构化采集（`@@RESULT` 加 `api` + 录像起停 + prompt 改写） | ✅ 已完成 | `prompts.ts` + `rules/test-execution.md` |
| Phase 2 | 数据穿透（reduce 类型/归约 + reports API 带出 + 证据分类） | ✅ 已完成 | `reduce.ts`(ApiInfo/sanitizeApi+单测) + `reports/route.ts`(xlsxFile) |
| Phase 3 | 缺陷报告结构化模板（defect prompt 改写） | ✅ 已完成 | `defect/route.ts` 接口信息逐子项 |
| Phase 4 | 面板就地展示（概览 + 产物列表 + 内嵌全文 + 失败态） | ✅ 已完成 | `ReportStepPanel`（InlineTestingPanel.tsx） |
| Phase 5 | 产物预览（md 渲染/编辑弹窗 + xlsx 表格 + 证据截图/录像查看） | ✅ 已完成 | `PreviewModal`/`MdPreview`/`XlsxPreview` + 新 `report-xlsx` route |
| Phase 6 | i18n + CDP 验证 + 交接/洞察文档 | ✅ 已完成 | i18n×3 locale；CDP mock 验证；handover+insights 文档 |

进度图例：📋 待开始 / 🔄 进行中 / ✅ 已完成 / ⏸ 暂缓

> **代码层全部完成并通过 typecheck/单测 + CDP（mock 报告 done 态）验证。** 唯一剩余：录像起停 + 接口实采需一次「带失败用例的真实执行」验证（POC，见开放问题 #1），通过后本计划移至 `completed/`。

## 决策日志

- 2026-06-26：**展示形态 = 混合式**。报告节点完成后，面板用「概览条 + 产物列表 + 内嵌报告全文」三段式，而非只列文件或只渲染全文。理由：既满足「展示测试报告」（内嵌全文），又复刻截图 2 的「产出资料」列表；且 `ReportView` 渲染器与报告数据均已存在，成本低。
- 2026-06-26：**产物清单 = 测试报告.md + 测试报告.xlsx + 缺陷报告.md** 三项。
- 2026-06-26：**md 预览方式 = markdown 渲染**（`ReactMarkdown`），带「预览 / 编辑」切换；编辑复用 CodeMirror `MarkdownEditor`，存回 `POST /api/files/write`。测试报告与缺陷报告共用此预览壳。
- 2026-06-26：**Excel 预览方式 = 表格**（解析 .xlsx → HTML 表渲染），**只读 + 导出**，不做单元格编辑（Excel 是从 markdown 派生的可选交付物，要改应改源头）。
- 2026-06-26：**缺陷报告 = 逐条结构化模板**，字段：标题 / 缺陷编号 / 环境·被测地址 / 前置条件 / 重现步骤 / 预期结果 / 实际结果 / 错误信息 / 接口信息（方法·URL·状态码·请求体·响应体）/ 期望行为·验收标准。守 QA 铁律：不含修复方案/优先级/指派。
- 2026-06-26：**接口信息采集 = 执行阶段结构化采集**（而非 best-effort 或生成时现采）。给 `@@RESULT` 加可选 `api` 字段，改执行 prompt 让 AI 用已开的 network 能力抓失败请求，穿透 run.json。理由：最可靠，缺陷报告 api 字段才不为空。
- 2026-06-26：**Excel 证据列含截图 + 录像**，各自成独立文件、关联到具体用例，应用内表格可直接打开（截图灯箱 / 录像内联播放）；导出的 .xlsx 证据列存为指向文件的超链接。
- 2026-06-26：**录像粒度 = 每条用例单独一段**（`browser_start_video({filename:"TC-xxx.webm"})` / `browser_stop_video`），天然关联到具体用例。
- 2026-06-26：**录像范围 = 只留失败 + 部分通过**。实现上每条用例都起停录像，结束判定 pass 则丢弃该段、fail/partial 才保留进证据（失败与否要跑完才知道，不能事后补录）。
- 2026-06-26：**证据模型不改 schema**，沿用 `evidence: string[]`，截图/录像按扩展名（.png/.jpg vs .webm/.mp4）分类。

## 关键设计 / 复用盘点

整套需求大部分基础设施已存在，新增主要是「把已有能力接到工作台流程页 + 执行端补采集」。

**已可复用（无需新建）：**

| 能力 | 位置 | 说明 |
|------|------|------|
| 报告渲染器 `ReportView` | `InlineTestingPanel.tsx` ≈1559-1658 | 概览指标卡 + 逐用例结果表 + 证据灯箱（`mediaUrl()`→`/api/test/media`）。纯展示，吃 `caseResults`/`fourState`，**零额外请求**。目前仅「报告」Tab 用。 |
| 报告数据 API | `src/app/api/test/reports/route.ts` | 返回 `markdown`/`defectMarkdown` 全文 + `counts`/`funcCounts`/`passStr`/`tests`。报告全文已内联，客户端只需 `ReactMarkdown` 渲染。 |
| markdown 渲染 | `react-markdown` + `remark-gfm`（已引入） | 配方见 `InlineTestingPanel.tsx` ≈1956-1962（`prose prose-sm`）。 |
| markdown 编辑器 | `src/components/editor/MarkdownEditor.lazy.tsx` | CodeMirror，`{value,onChange,onSave,editable}`，⌘S→onSave。`SkillEditor` 是编辑/预览模板。 |
| 文件写回 | `POST /api/files/write` | 路径加固，供「点开修改」保存。 |
| 媒体服务 | `src/app/api/test/media/route.ts` | MIME 已含 png/jpg/webp/gif + **webm/mp4**；视频支持 HTTP Range（206）拖动播放——「录像内联回放」本就是设计内。 |
| 证据清扫 | `src/lib/test/evidence.ts` | `sweepStrayEvidence` + `sniffMediaExt`（已识别 webm 魔数），自动把媒体文件归集进证据目录。 |
| xlsx 解析 | `exceljs`（已是依赖） | `import/route.ts:87` 已用 `wb.xlsx.load`，可复用解析 .xlsx → 表格行。 |
| 录像工具 | `@playwright/mcp@0.0.76` `browser_start_video`/`browser_stop_video`/`browser_video_chapter` | 归在 `--caps=devtools` 能力组，**当前启动 `--caps devtools,network` 已开启**，执行器现在就能调，无需改启动参数。 |
| 弹窗壳 | `InlineTestingPanel.tsx` ≈1429-1483（cases 编辑器模态） | `fixed inset-0 z-50 bg-black/50` 模式，预览弹窗可复刻。 |

**待新建 / 改造：**
- `@@RESULT` JSON schema 增 `api`；`RawResult`/`ReducedTest`/`RunJson` 类型增 `api?`（`reduce.ts`）。
- 执行 prompt 增「失败接口信息采集」「fail/partial 录像起停」两段指令（`prompts.ts`）。
- defect 生成 prompt 改结构化模板（`defect/route.ts`）。
- 报告步详情卡：替换占位符为三段式展示（`InlineTestingPanel.tsx`）。
- 产物预览弹窗：md 渲染/编辑 + xlsx 表格 + 证据查看（`InlineTestingPanel.tsx`）。
- 新增「读+解析 .xlsx → JSON 行」的 API route（供表格预览）。
- reports API 增「检测同目录 .xlsx 是否存在」（产物列表 Excel 行显隐）。

## 详细设计（分阶段）

### Phase 1 — 执行端结构化采集

**目标**：执行阶段把失败用例的接口信息、fail/partial 用例的录像，结构化地落到 run.json，作为缺陷报告与证据列的数据地基。

**改动**：`src/lib/test/prompts.ts`
1. `@@RESULT` schema 扩展（≈198 行）：增可选 `api` 对象与录像证据约定：
   ```
   @@RESULT {"id","status","actual","evidence":["TC-xxx.png","TC-xxx.webm"],"error",
             "api":{"method","url","status","requestBody","responseBody"}}
   ```
   - `api` 仅在 status=fail/partial 且能定位到关键请求时输出；pass 留空。
   - `requestBody`/`responseBody` 过长时截断（约定上限，见开放问题）。
2. 执行指令增两段：
   - **接口采集**：失败用例用已开的 network 能力（`browser_network_requests` 等）定位与失败现象相关的关键请求，记录 方法/URL/状态码/请求体/响应体到 `api`。
   - **录像**：每条用例 `browser_start_video({filename:"{用例ID}.webm"})` 起、用例结束 `browser_stop_video`；判定为 pass 的录像段丢弃、fail/partial 的保留并写入该用例 `evidence`。

**验收**：跑一个含失败用例的任务，run.json 的失败 `tests[]` 带 `api` 字段、`evidence` 含 `.webm`；pass 用例无录像。

### Phase 2 — 数据穿透

**目标**：让 `api` 与录像证据从 `@@RESULT` 一路流到 reports API。

**改动**：`src/lib/test/reduce.ts`、`src/app/api/test/reports/route.ts`
1. `RawResult`/`ReducedTest`/`RunJson.tests[]` 增 `api?: {method;url;status;requestBody;responseBody}`（≈19-57 行）。
2. `reduceResults` 透传 `api`（不参与四态归约，仅随结果带出）。
3. reports API：run.json 整体序列化，`tests` 自动带出 `api`；额外**扫描同任务目录是否存在 .xlsx**，在响应里给出 `xlsxFile`（产物列表 Excel 行据此显隐）。
4. 证据分类辅助：`evidence: string[]` 按扩展名分 `截图`/`录像`（前端纯函数，不改 schema）。

**验收**：`GET /api/test/reports` 返回的失败用例带 `api`；含录像证据可辨；`reduce.ts` 单测覆盖 `api` 透传。

### Phase 3 — 缺陷报告结构化模板

**目标**：缺陷报告按确认的逐条模板输出，接口信息读 `tests[].api`。

**改动**：`src/app/api/test/defect/route.ts`
- 改 `SYSTEM_PROMPT` 与生成 prompt：输出逐条缺陷，字段 = 缺陷编号 / 环境·被测地址 / 前置条件（读 cases.json `precondition`）/ 重现步骤（`steps[].content`）/ 预期结果（`steps[].expected`）/ 实际结果（run.json `actual`）/ 错误信息（`error`）/ 接口信息（`tests[].api`，无则标「未捕获」）/ 期望行为·验收标准（AI 生成，守铁律）。
- 仍只挑 status=fail 且确属应用 bug 的用例。

**验收**：对含失败用例的任务生成缺陷报告，每条缺陷字段齐全、接口信息块来自 run.json，不含修复方案。

### Phase 4 — 面板就地展示

**目标**：报告步完成后，详情卡替换占位符为「概览条 + 产物列表 + 内嵌全文」；处理失败态。

**改动**：`src/components/test/InlineTestingPanel.tsx`
- 报告步分支（替换 ≈1214-1216 的 `evidenceNote` 占位）：
  - 新增 `reportEntry` state：报告步 `done` 时拉 `GET /api/test/reports`，按 `task===activeTask.name && env===env` 取当前条。
  - **概览条**：复用 `ReportView` 指标卡（功能验证通过率 / 执行通过率 / 失败·阻塞 / 用例总数）；`counts.fail>0` 时显示「交给研发修复（N）」（复用现有 handoff）。
  - **产物列表**：测试报告.md（点开修改）、测试报告.xlsx（存在才显示，导出）、缺陷报告.md（存在→点开修改，不存在→「生成缺陷报告」复用 `/api/test/defect`）。`buildArtifactLabel(task,env)` 格式化展示名。
  - **内嵌全文**：可折叠 `ReactMarkdown` 渲染 `reportEntry.markdown`。
- **失败态**：报告步 `error` 时，显示失败摘要 + 「重新运行」，不渲染空报告。

**验收**：报告步完成 → 面板显示概览 + 产物列表 + 全文；失败 → 显示失败摘要。CDP 截图验证。

### Phase 5 — 产物预览

**目标**：产物列表点开后的预览：md 渲染/编辑、xlsx 表格、证据截图/录像查看。

**改动**：`src/components/test/InlineTestingPanel.tsx` + 新增 xlsx 解析 route
- **预览弹窗**（复刻 ≈1429 模态壳）：
  - md（测试报告/缺陷报告）：默认 `ReactMarkdown` 预览；「编辑」切 `MarkdownEditor`，⌘S 存回 `POST /api/files/write`。
  - xlsx：新增 `GET /api/test/report-xlsx`（或扩展现有），服务端用 `exceljs` 解析 → 返回表头+行；前端渲染只读表格，含 序号/用例ID/标题/状态/期望/实际/结论/证据 列 + 导出。
  - 证据列：截图按扩展名走灯箱（复用 `ReportView` 的 `mediaUrl`）、录像走内联 `<video>`（`/api/test/media` 已支持 Range）。
- **导出 .xlsx 内的证据**：证据列写为指向证据文件的超链接（相对/`file://` 路径）。

**验收**：点开测试报告.md/缺陷报告.md 渲染正确、可编辑保存；点开 Excel 显示表格；证据截图灯箱、录像可播放可拖动。

### Phase 6 — 收尾

**目标**：i18n、验证、文档。

- i18n：`src/i18n/zh.ts` + `en.ts` 同步新增 key（产出资料/本步产物/点开修改/预览/编辑/录像/截图/接口信息 等）。
- 自检：`npm run test`（typecheck + 单测）；UI 改动跑 `npm run test:smoke`；CDP 实测报告步展示 + 预览 + 录像播放（本地无登录体系，managed 数据用 mock，报告/证据用真实跑出的产物）。
- 文档：`docs/handover/test-report-display.md`（架构/数据流/schema/路由/MCP 工具）+ `docs/insights/test-report-display.md`（用户问题/设计理由），互相反链。

**验收**：自检通过；两份文档产出并反链；本计划移至 `completed/`。

## 依赖项

- `@playwright/mcp@0.0.76` 的 `browser_start_video`/`browser_stop_video`（devtools cap，已开）。
- `exceljs`（已是依赖）。
- `react-markdown` + `remark-gfm`、CodeMirror `MarkdownEditor`、`POST /api/files/write`、`/api/test/media`（均已存在）。

## 开放问题 / 风险

1. **录像起停可靠性**：`browser_start_video`/`browser_stop_video` 在单会话内多次起停、按 filename 落盘的实际行为需在 Phase 1 POC 验证（含命名、输出目录、与 `--output-dir` 关系）。若 MCP 实测不支持「pass 段丢弃」，退化为「全部保留 + 前端只展示 fail/partial」。
2. **接口请求体/响应体体量与脱敏**：大 body 需截断（约定上限，如 4KB）；潜在敏感数据（token/密码）是否脱敏——待确认默认策略。
3. **xlsx 是按需交付物**：报告步默认只写 .md，.xlsx 由 `anthropic-skills:xlsx` 按需生成、命名规则也与 .md 不同（`{模块}-report-{ENV}-{date}.xlsx`）。产物列表 Excel 行需「检测存在才显示 + 提供导出/生成入口」，reports API 的扫描要兼容该命名。
4. **大报告渲染性能**：超长 markdown 内嵌渲染的性能；必要时折叠默认收起、懒渲染。
5. **失败用例无关键请求**：纯前端缺陷可能没有可定位的接口，`api` 标「未捕获/无」需在模板与表格里优雅处理。
