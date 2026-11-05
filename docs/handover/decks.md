# Decks：卡片式 AI 演示模块（按 Gamma 逆向报告复刻）

> 产品思考见 [docs/insights/decks.md](../insights/decks.md) · 依据：[Gamma 逆向报告集](../research/gamma-reverse/README.md) · 执行计划：[exec-plans/active/decks-gamma-replica.md](../exec-plans/active/decks-gamma-replica.md)

Decks 是与 `/ppt` 并行的新模块，路由 `/decks`，分支 `claude/decks-gamma-replica`，作为下一版本的备用实现。它按逆向报告复刻了 Gamma 的架构（文档模型、异步任务与逐卡阶段、媒体托管、导出），完整工作流（输入 → 设置 → 可编辑大纲 → 逐卡生成 → 编辑 → 演示 / 导出），以及内容与媒体的处理规则。

界面使用本仓库的设计体系；主题、装饰图是原创。没有 Gamma 的名称、Logo 或素材，也不涉及其代码（Gamma 闭源，一切按公开行为重新实现）。

## 1. 目录结构

```
src/lib/decks/
├── types.ts          # 共享契约：Deck → Card → Block、版式、设置、任务、编辑提案、媒体、主题、API 形状
├── settings.ts       # 输入解释：textMode / amount / tone / audience / language / numCards / cardSplit；`---` 切卡；图片 URL 规则
├── prompts.ts        # 三个模型任务的提示词：大纲、逐卡、编辑（内容原则见 §5）
├── model.ts          # 模型适配：provider（用户配置的服务商）+ 确定性 mock；JSON 回复解析
├── engine.ts         # 工作流：创建、大纲任务、构建任务（逐卡阶段、并发 3）、检查与打磨、AI 编辑提案、排队指令、版本恢复、装饰图
├── store.ts          # SQLite 持久化：decks / deck_versions / deck_jobs / deck_media / deck_proposals；媒体文件目录
├── media.ts          # 媒体：公网 HTTPS 抓取（私网拒绝、无重定向、10 MB）、格式嗅探、只收位图
├── blocks.ts         # 块工具：id、行内 Markdown、文字量与容量估算、模型输出清洗
├── themes.ts         # 8 个原创主题
├── accent-art.ts     # 原创装饰图：按主题色与种子生成的 SVG（确定性）
├── client.ts         # 前端 API 客户端 + useDeckLive（SSE，断线退回 2 s 轮询）
├── http.ts           # 路由共享的错误映射（route.ts 只导出 handler）
├── export-pptx.ts    # 原生 PPTX 导出（pptxgenjs）
└── export-png.ts     # 浏览器端 PNG zip 导出（html-to-image + jszip）

src/app/api/decks/…   # 见 §3
src/app/decks/        # page.tsx 列表 · new/ 创建 · [id]/ 按状态路由 · [id]/present 演示 · [id]/print 打印 PDF
src/components/decks/ # CardView（唯一卡片渲染器）· create/ · outline/ · generation/ · editor/ · ThemePicker · i18n（模块内字典）
```

## 2. 数据模型与数据流

**文档模型**（报告 01 §2）：Deck 对应 Gamma 的 file，Card 对应 slide，Block 对应块；整份文档存为一条 JSON。

- **Card**：`layout{accent: none|left|right|top|background, accentMediaId?, accentSeed?, align}`、`hidden`、`notes`、`stage`、`issues`。
- **Block**：heading / paragraph / bullets / numbered / image / table / chart / callout / quote / code，以及智能版式 timeline / steps / metrics / grid / columns，外加 divider。
- **画布**：逻辑宽度 1280，16:9 时高 720，与 Gamma 实测画布一致；按容器缩放。

```
POST /api/decks ──► normalizeSettings ──► extractImageUrls ──► rehostInputImages（抓取并本地托管，失败汇总为 warning）
                └► outline 任务：model.planOutline ──► deck.outline，status=outline_ready
作者审阅大纲（合并 / 增删 / 排序 / 逐卡指令）──► PUT /outline
POST /generate ──► build 任务：每张卡片 queued → writing（writeCard）→ imaging（图片来源）→ checking（容量）→ polishing（去侧图 / 精简）→ done
                    并发 3，逐卡写回；job.progress 由各卡阶段算出（percent 不回退）
                └► 排队指令：按顺序作为整份编辑执行并自动应用（每条留版本）
编辑：PUT /:id（手动保存，baseVersion 冲突 409）· POST /edits（范围编辑 → 提案）→ apply / discard · versions → restore
GET /events（SSE，400 ms 检查变化）──► useDeckLive ──► 页面按 deck.status 显示大纲 / 生成流 / 编辑器
```

## 3. API 路由（`src/app/api/decks`，均只导出 handler）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST | `/api/decks` | 列表 / 创建（201，含 outline 任务） |
| GET | `/api/decks/themes` | 主题列表 |
| GET / PUT / DELETE | `/api/decks/:id` | 读取（deck、最近任务、未决提案、媒体）/ 保存（需 `baseVersion`，冲突 409）/ 软删除 |
| POST | `/api/decks/:id/duplicate` | 复制 |
| PUT / POST | `/api/decks/:id/outline` | 保存大纲（仅 outline_ready）/ 重写大纲（可带指令与卡片数，202） |
| POST | `/api/decks/:id/generate` | 开始逐卡生成（202；有任务在跑时 409 `job_in_progress`；失败的 deck 可凭大纲重试） |
| POST | `/api/decks/:id/instructions` | 生成中排队；未在生成时按整份编辑执行 |
| DELETE | `/api/decks/:id/instructions/:qid` | 撤回尚未执行的排队指令 |
| POST | `/api/decks/:id/stop` | 停止生成：已完成的卡片保留，未开始的丢弃，排队指令照常执行（202） |
| POST | `/api/decks/:id/edits` | 范围编辑 `{scope: deck\|card\|block, instruction}`（202；一次一个，409 `edit_in_progress`） |
| POST | `/api/decks/:id/proposals/:pid/apply\|discard` | 应用（基于提案版本，冲突 409 `version_conflict`）/ 丢弃 |
| GET / POST | `/api/decks/:id/versions` · `/versions/:v/restore` | 版本列表 / 恢复 |
| POST | `/api/decks/:id/media` | `{url}` 抓取，或原始图片字节上传（201） |
| POST | `/api/decks/:id/cards/:cardId/accent` | 装饰图：regenerate / clear / set |
| GET | `/api/decks/:id/export?format=pptx` | 原生 PPTX |
| GET | `/api/decks/:id/events` | SSE 快照 |
| GET | `/api/decks/media/:mediaId` | 图片字节（nosniff + `default-src 'none'`） |

## 4. DB schema（`src/lib/db.ts`，仅新增表，`CREATE TABLE IF NOT EXISTS`）

| 表 | 关键列 | 说明 |
|---|---|---|
| `decks` | id, uid, title, status, doc(JSON), version, deleted_at | 一份 deck 一行；uid 隔离账号（本地 dev 为空串） |
| `deck_versions` | (deck_id, version), reason, doc | 每次带 reason 的保存前快照，保留最近 50 个 |
| `deck_jobs` | id, deck_id, kind(outline\|build\|edit), status, progress, payload, queued, error | 进程重启时把未完成任务标为失败 |
| `deck_media` | id, deck_id, mime, origin(upload\|url\|ai), path, meta | 文件在 `<数据目录>/decks-media/` |
| `deck_proposals` | id, deck_id, status, doc | AI 编辑提案（前后对比） |

## 5. 复刻的处理规则（与报告的对应）

| 规则 | 实现位置 | 报告依据 |
|---|---|---|
| textMode：generate 扩写、condense 浓缩、preserve 保留原文只加结构；tone / audience 只作用于生成 | `settings.ts`、`prompts.ts` MODE_RULES | 03 §1 |
| `\n---\n` 切卡：n 个分隔 → n+1 张；preserve 时逐字保留作者卡片 | `splitByBreaks`、`engine.startOutline` | 03 §2 |
| 卡片数是软目标（±1–2） | 大纲提示词 | 02 §1 |
| 大纲即内容、按观点切分、断言式标题、数字逐字保留、不编造 | 大纲 / 逐卡提示词 | 03 §3 |
| 按内容选组件：数字 → metrics，流程 → steps，日期 → timeline，并列 → grid，表格数据 → table / chart | 逐卡提示词 | 03 §5 |
| 逐卡阶段 queued / writing / imaging / checking / polishing / done / failed；percent 0–99，完成为 100，不回退 | `engine.progressOf`、`store.updateJob` | 02 §2 |
| 装饰图位置 none / left / right / top / background，由写卡模型按内容选择 | `prompts.cardPrompt`、`CardView` | 04 §2 |
| 图片来源：aiGenerated（应用已有图片生成器，失败退回主题图并告知）/ themeAccent（原创 SVG）/ placeholder / inputOnly / noImages | `engine.runBuild` imaging | 04 §1 |
| 输入里的裸 https 图片链接：抓取并本地托管，抓不到跳过并汇总告知；优先用作装饰图 | `settings.extractImageUrls`、`media.rehostInputImages` | 04 §3 |
| 检查与打磨：超出容量先去掉侧图，再让模型精简一次，仍超出则标记 overflow | `engine.runBuild` checking | 02 §8（推断） |
| 生成中输入的指令排队，生成完成后依次执行 | `queueInstruction`、`drainQueue` | 02 §3、06 §2 |
| 编辑：先定范围（整份 / 卡片 / 块）→ 提案（前后对比）→ 整组应用或丢弃；一次一个编辑 | `startEdit`、`applyProposal` | 06 §1–2 |
| 主题只管样式，结构来自内容 | `themes.ts` | 05 §1 |
| 导出：原生 PPTX（可编辑文字、表格、原生图表、形状）、PDF（打印）、PNG zip（一卡一图） | `export-pptx.ts`、`print`、`export-png.ts` | 06 §5 |

## 6. 模型与运行方式

- **provider**：`resolveProvider()` 选出用户已配置的服务商，`generateTextFromProvider` 返回 JSON 回复；图片走 `generateSingleImage`。
- **mock**：确定性、离线可用，用于单测和本地 dev（`DECKS_MODEL=mock`）；没有可用服务商时作为演示模型兜底，并给 deck 加 `demo_model` 警告，界面会显示提示。
- **运行**：任务在 Next 服务进程内执行，登记在 `globalThis.__decksRegistry` 上，所有路由模块共享；每一步都落库，客户端经 SSE 看到真实进度。桌面版的 Next 服务常驻，因此不依赖页面是否打开（与 `/ppt` 的桌面 worker 不同）。

## 7. 安全

- **图片抓取**：只抓公网 HTTPS；所有解析出的地址都必须是公网地址；拒绝重定向；最多 10 MB。
- **只收位图**：拒绝 SVG，因为从本站同源提供的 SVG 能执行脚本。主题 SVG 由代码生成，以 data URL 内联，从不落盘。
- **媒体响应**：带 `x-content-type-options: nosniff` 和 `content-security-policy: default-src 'none'`。
- **跨源**：JSON 和原始字节的 POST 都会触发 CORS 预检，本服务不响应预检，所以网页无法跨源驱动。
- **账号隔离**：按 uid 隔离；读媒体时要求所属 deck 对当前账号可读。

## 8. 测试与验证（2026-11-05）

- **单测**：`src/__tests__/unit/decks-engine.test.ts`（16 个）：
  - 设置解释、`---` 切卡、图片 URL 规则；
  - 大纲 → 生成全流程与阶段进度；三种图片来源与输入图托管；
  - 编辑提案、应用、恢复、版本冲突；排队指令；停止、撤回、重试；溢出打磨；
  - JSON 解析、块清洗、拒绝 SVG。
- **PPTX 单测**：`src/__tests__/unit/decks-export-pptx.test.ts`（20 个），覆盖所有块类型、五种装饰图位置、隐藏卡片、备注、页眉页脚、尺寸、溢出缩字（≥10 pt）、accentSeed。导出器作者另用 python-pptx 打开、用 LibreOffice 渲染核对过版式。
- **全量**：`npm run test` 3,230 个，0 失败（2 个跳过）。Decks 全部文件 eslint 0 错误 0 警告。
- **本地 dev 实测**：worktree、端口 3031、`DECKS_MODEL=mock`；用 `DECKS_MOCK_DELAY_MS` 模拟模型延迟以观察生成流。用 chrome-devtools 实际操作并截图：
  - 创建页：输入、设置、主题；
  - 大纲：合并后卡片数随之变化，自动保存；
  - 生成流：进度、阶段计数、逐卡状态、指令排队；停止后保留 27/31 张，排队指令照常执行并留版本；
  - 编辑器：缩略图、版式五位置实时预览、AI 范围（卡片）→ 快捷操作“精简” → 前后对比 → 应用（8 条 → 4 条，留版本）；
  - 演示模式：方向键翻页、进度、无应用外壳；图表块饼图比例与图例正确；
  - 打印：Playwright 生成 PDF 5 页、960×540 pt（16:9）；
  - PNG zip：拦截下载，5 张 `card-NN.png`；
  - PPTX 路由：5 页原生文本；
  - 列表页；移动端 390 宽的编辑器与创建页，无横向滚动。
- **控制台**：Decks 请求无 4xx/5xx。仅见既有 PPT 后台轮询（`/api/ppt/projects`、`/api/ppt/model-jobs`）的 401，原因是本地 dev 无登录体系，与本模块无关。
- **未验证**：真实服务商的端到端生成（本环境无模型凭据），只验证了 mock 模型下的逻辑与界面；AI 图片生成路径同理，只测试了失败时退回主题图的分支。

## 9. 已知局限与下一步

- **Gamma 兼容 API**：`/api/ppt/gamma/v1.0` 仍指向 `/ppt` 引擎；改为可选 Decks 引擎在执行计划 Phase 5。
- **未复刻**：文件导入（PPTX/PDF）、MCP 工具、评论与分析、站点发布、多人协作。
- **图片来源**：没有图库/网页图片来源，需要授权的第三方 API。
- **容量判断**：是按行估算，最终以渲染为准；PPTX 导出在内容过多时按比例缩小字号（下限 10 pt）。
- **手动编辑**：表格、图表、指标卡没有手动编辑表单，只能通过 AI 编辑修改；块工具栏在卡片上方，不贴着块浮动。
- **页眉页脚**：logo 槽显示的是文字，不是图片。
- **PPTX 导出**：字体只取主题字体栈的第一项且不嵌入；装饰图 SVG 的 PNG 回退只是渐变色块；饼图图例样式与屏幕上略有不同。
- **mock 模型**：只用于演示和测试，短简报扩写超过 6 张卡时会循环使用模板句式；真实生成质量取决于用户配置的模型。
- **其他实现细节**：
  - **i18n**：Decks 字符串放在模块内字典（`src/components/decks/strings-*.ts`，含中英文），没有并入 `src/i18n/en.ts` / `zh.ts`，原因是多人并行开发时避免改同一个文件；合并回主线时可以迁移进去。
  - **应用外壳**：`AppShell` 在 `/decks/*/present` 和 `/decks/*/print` 上隐藏外壳，和 `/ppt` 的独立模式用同一个开关。
