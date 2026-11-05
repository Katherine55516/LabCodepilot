# Decks Gamma 兼容 API（Gamma 公共 API v1.0 over Decks）

> 产品思考见 [docs/insights/decks.md](../insights/decks.md) · Decks 模块交接见 [decks.md](decks.md) · 旧 `/ppt` 引擎的同类门面见 [ppt-gamma-compat.md](ppt-gamma-compat.md) · Gamma 契约见 [gamma-reverse/08-api-reference.md](../research/gamma-reverse/08-api-reference.md)

用 Gamma 公共 API 的请求/响应形状驱动 Decks。Decks 本身就复刻了 Gamma 的文档模型（file → card → block）和任务流程（大纲 → 逐卡阶段 queued/writing/imaging/checking/polishing/done），所以这一层比旧 `/ppt` 门面的映射直接得多：格式、九种尺寸、textMode、amount、语言、cardSplit、图片来源、页眉页脚基本都是一一对应，进度来自 Decks 构建任务的真实逐卡阶段。

## 1. 目录结构

| 文件 | 作用 |
|---|---|
| `src/lib/decks/gamma-api.ts` | 上半部分是纯函数：请求校验与映射（`parseClassicGeneration` / `parseAgentGeneration` / `readHeaderFooter` / `outlineFromBreaks` / `applyTemplate`）、状态投影（`generationView` / `toGenerationStatus`）、元数据（`toGammaMetadata`）、主题（`toGammaThemes`）。下半部分是 `handleDecksGammaRequest`：鉴权、路由、调用 Decks engine/store；依赖可注入（apiKey、时钟、并发计数、logo 抓取） |
| `src/app/api/decks/gamma/v1.0/[...path]/route.ts` | 只导出 GET/POST（以及 runtime/dynamic），读取 key 后交给 handler |
| `src/__tests__/unit/decks-gamma-api.test.ts` | 13 个用例（node:test，临时数据目录 + 可闸门控制的 mock 模型） |

没有新表、没有 schema 迁移：生成元数据存在 deck 文档 JSON 的扩展字段 `gammaApi` 上，编辑记录存在 `globalThis.__decksGammaApi`（内存），其余全部由 Decks 已有的 id 推导。

## 2. API 路由

基址：`http://localhost:<port>/api/decks/gamma/v1.0`（静态段 `gamma` 优先于 `/api/decks/[id]`；deck id 均为 `deck_*`，不会撞名）。

| 方法 | 路径 | 返回 |
|---|---|---|
| POST | `/generations` | Classic 创建 → **200** `{generationId, warnings?}`（warnings 为一个字符串，同 Gamma） |
| GET | `/generations/{id}` | Classic 轮询：pending（含 `progress`，见差异）/ completed（顶层 `gammaId`、`gammaUrl`、`exportUrl?`）/ failed（`error{message,statusCode}`） |
| POST | `/agent/generations` | Gamma 5 创建 → **202** `{generationId, status:'pending', warnings:[{code,message}]}` |
| GET | `/agent/generations/{id}` | pending：`gamma?`、`progress?`、`warnings:[]`、`updatedTime`；completed：`gamma`、`result.summary`、`exportUrl?`、`warnings`、`updatedTime`、`credits:{}`；failed：`error{reason:'generation_failed',message,statusCode:500}`、`credits:{}` |
| POST | `/agent/gammas/{gammaId}/edits` | `{prompt, quality?, disableConnectors?}` → **201** `{editId, gammaUrl}`；进行中再提交 → 409 `edit_in_progress`（带运行中的 `editId`） |
| GET | `/agent/edits/{editId}` | `{status, editId, gammaId, gammaUrl, pageId, updatedTime}` + completed 的 `result.summary`、`credits:{}` / failed 的 `error{reason:'edit_failed',…}` |
| GET | `/gammas/{gammaId}` | GetGammaResponse：`id, title, type:'regular', url, thumbnailUrl:null, description, author:null, createdTime, updatedTime, themeId, archived:false` |
| POST | `/gammas/{gammaId}/export` | `{exportAs}` → 200 `{exportId}`；pdf/png → 400 `unsupported_export` |
| GET | `/exports/{exportId}` | `{exportAs:'pptx', exportId, status, gammaId, exportUrl?, error?}` |
| GET | `/themes` | ListThemesResponse：`{data:[{id,name,type:'standard',colorKeywords,toneKeywords}], hasMore, nextCursor}`，支持 `query`、`limit`(1–50)、`after`、`type` |
| GET | `/files/{deckId}.pptx?expires&signature` | 签名下载，**无需 key**，约 7 天有效，内容为 `buildDeckPptx` 实时生成 |

错误体统一为 Gamma 的 `{message, statusCode, code?}`（409 额外带 `editId`）。`gammaId` 参数接受 deck id，也接受 `gen_` 生成 id（同 Gamma MCP）。

### id 方案

| id | 形式 | 如何解析 |
|---|---|---|
| generationId | `gen_<deck id 后缀>`（`deck_abc` ↔ `gen_abc`），符合 Gamma 的 `^gen_[A-Za-z0-9]+$` | 直接推导；只有带 `gammaApi` 元数据（经本 API 创建）且 flavor 匹配的 deck 才作为生成响应，否则 404（Classic 与 Agent 互查也是 404） |
| gammaId | deck id | — |
| editId | Decks 编辑任务的 job id（`job_*`） | `store.getJob` → deck；内存记录补充 proposalId 与结果 |
| exportId | `exp_<deck 后缀>_<随机 hex>` | 直接推导出 deck，重启后仍可查 |

所有查找都经过按账号隔离的 Decks store（`getDeck` 带 uid），换账号后旧 id 一律 404（测试覆盖）。

## 3. 字段映射（Gamma → Decks）

### Classic `POST /generations`

| Gamma | Decks | 说明 |
|---|---|---|
| `inputText` | `settings.inputText` | 1–400,000 字符；行内图片 URL 由 `createDeck` 按 Gamma 规则抓取托管 |
| `textMode` | `settings.textMode` | 直通；省略时用 Decks 自动规则（≤1500 字符 generate，否则 condense） |
| `format` | `settings.format` | presentation / document / social 直通；`webpage` → 400 `unsupported_format` |
| `numCards` | `settings.numCards` | 整数 1–100，61–100 夹到 60 并警告 `num_cards_adjusted`，>100 → 400（Gamma 的计划上限）；省略 → 10（Gamma Classic 默认） |
| `cardSplit: inputTextBreaks` | 预备大纲 `CreateDeckRequest.outline` | 按 `\n---\n` 切段；每段首个标题（或首行）作卡片标题，其余行去掉列表符作要点；跳过规划器；`numCards` 被忽略；>60 段 → 400 |
| `additionalInstructions` | `settings.additionalInstructions` | ≤5000 |
| `title` | `CreateDeckRequest.title` | ≤500（引擎截到 200） |
| `themeId` | `settings.themeId` | 必须是 Decks 主题 id（`GET /themes`），否则 400 `unknown_theme` |
| `exportAs: pptx` | 完成时返回签名 `exportUrl` | — |
| `exportAs: pdf / png` | 不出文件，警告 `export_failed` | 按 Gamma 规则"导出失败只是警告，不让生成失败"；PDF/PNG 在应用内（打印 / PNG zip）产出 |
| `textOptions.amount` | `settings.amount` | 四档直通；`preserve` 下警告 `ignored_text_options` |
| `textOptions.tone` / `audience` | `settings.tone` / `audience` | `preserve` 下 Decks 自己给 `ignored_text_options` |
| `textOptions.language` | `settings.language` | 映射表 `GAMMA_LANGUAGES`：en/en-gb/en-in→en、zh-cn、zh-tw、ja/ja-da→ja、ko、es/es-419/es-es/es-mx→es、fr、de、pt-br、it、ru、ar/ar-sa→ar、hi、id、vi、th、tr、nl、pl；变体合并时警告 `language_adjusted`；其余（如 pt-pt、sv）→ 400 `unsupported_language`；省略 → `auto`（跟随输入语言） |
| `imageOptions.source` | `settings.imageSource` | aiGenerated / themeAccent / placeholder / noImages 直通；pictographic / pexels / giphy / web* → `themeAccent` + 警告 `image_source_unsupported`；省略 → aiGenerated（Gamma 默认；无图像服务商时 Decks 退回主题装饰图并警告 `ai_images_unavailable`） |
| `imageOptions.style` | `settings.imageStyle` | 仅 aiGenerated 生效，否则警告 `ignored_image_options` |
| `imageOptions.model` | — | 警告 `ignored_image_model`（用设置里配置的图像模型） |
| `cardOptions.dimensions` | `settings.dimensions` | 九种直通；与 format 不匹配时退回该格式默认（presentation 16x9 / document pageless / social 1x1）并警告 `dimensions_adjusted`；不在九种内 → 400 |
| `cardOptions.headerFooter.<六个位置>` | `deck.headerFooter.<同名>` | `text` → `{type:'text', value}`；`cardNumber` → `{type:'cardNumber'}`；`image` + `themeLogo` → `{type:'logo', size}`（Decks 主题没有 logo 图，显示 deck 标题字标，警告 `theme_logo_as_text`）；`image` + `custom` → `{type:'logo', size, mediaId}`，`src` 必须 https，创建后经 `fetchPublicImage` 抓取并 `storeImage` 托管，失败警告 `header_footer_image_skipped` 退回字标 |
| `hideFromFirstCard` / `hideFromLastCard` | 同名 | 直通 |
| `sharingOptions.*`、`folderId(s)` | — | 与 Gamma 同名警告 `ignored_workspace_access` / `ignored_external_access` / `ignored_email_options` / `ignored_folder_id` |
| `publish` | — | 警告 `ignored_publish` |
| `pages` | — | 400 `unsupported_pages` |
| 其他字段 | — | 400 `unknown_field` |

所有 API 生成固定 `settings.mode = 'express'`（Gamma 的 API 没有大纲审阅停顿），`source = {kind:'api'}`。

### Gamma 5 `POST /agent/generations`

| Gamma | Decks |
|---|---|
| `prompt` | `settings.inputText`（textMode 由 Decks 自动决定） |
| `numCards` | 同 Classic 规则；省略 → Decks 默认（8，软目标） |
| `format` | 同 Classic |
| `themeId` | 同 Classic；与 `templateId` 同传 → 400 |
| `templateId` | 本账号已有的 Decks deck id（或其 gen id）。复制外观与结构：主题、图片来源/风格、amount、语言（非 auto 时）、format（请求未指定时）、dimensions（与 format 兼容时）、页眉页脚（logo 的 mediaId 属于模板 deck，复制时去掉，显示字标）、卡片数（请求未指定 numCards 时）。找不到 → 400 `unknown_template`，不替换 |
| `additionalInstructions` / `exportAs` | 同 Classic |
| `quality` | 非 standard 时警告 `ignored_quality` |
| `sourceUrls` / `files`（非空） | 400 `unsupported_source_urls` / `unsupported_files` |
| `disableConnectors` | 接受、忽略（Decks 不接连接器） |
| `sharingOptions` / `folderId` | 同 Classic 警告 |
| 其他字段（含 `textMode`、`textOptions` 等 Classic 字段） | 400 `unknown_field`（同 Gamma） |

## 4. 状态投影

| Deck / 任务 | Gamma 状态 |
|---|---|
| `outlining` / `outline_ready`，有活动任务 | pending，无 `gamma`、无 `progress`（对应 Gamma 规划阶段） |
| `generating` + build 任务运行中 | pending + `gamma` + `progress{stages, done, total, percent}`：直接取构建任务的逐卡阶段计数；`percent` 夹在 0–99，任务内由 store 保证不回落 |
| `ready` | completed；`result.summary` = 「Created a N-card presentation "标题": 卡片标题…」 |
| `failed` | failed，`error.message` = deck.error / 任务错误 |
| 仍在 outlining/generating 但没有活动任务（应用重启后任务被标 failed、或构建没起来） | failed |

completed 的 `warnings` = 创建时警告 ∪ deck 运行中积累的警告（如 `ai_images_unavailable`、`image_urls_skipped`、`demo_model`），按 code+message 去重。Agent pending/failed 的 `warnings` 恒为 `[]`（同 Gamma）。

## 5. 编辑（原地应用）

1. `POST /agent/gammas/{id}/edits` 先结算该 deck 上已完成但未应用的 API 编辑；有活动编辑任务 → 409 `edit_in_progress`（带 `editId`）；deck 仍在生成 → 409 `generation_in_progress`；无卡片 → 400。
2. 调 `engine.startEdit(deckId, {kind:'deck'}, prompt)`，job id 即 editId，记入内存 `state.edits`。
3. 提案就绪后自动 `engine.applyProposal`（Gamma 的编辑直接生效，跳过 Decks 的 Original/Modified 审阅）。触发点有两个：挂在引擎任务注册表 `globalThis.__decksRegistry.running` 的 promise 上（无人轮询也会应用），以及每次 `GET /agent/edits/{id}`（幂等，结果只记录一次）。应用会产生一个可恢复版本（原因 `API edit: …`），deck `version` 增加。
4. 版本冲突（提案后应用里有人改过 deck）→ failed，`reason: edit_failed`。
5. 找提案：内存里有 proposalId 就用；否则按「同一 deck、instruction 相同、创建时间不早于 job」匹配。重启后内存丢失时，已应用的编辑仍可查（completed），失败的编辑仍可查（failed）；尚未应用的开放提案无法确认来自 API（可能是应用内等人审阅的提案），读作 404，不会被 API 擅自应用。

## 6. 导出

- 生成时 `exportAs: pptx` 和 `POST /gammas/{id}/export` 都返回同一种签名链接：`/files/{deckId}.pptx?expires=<ms>&signature=<hex>`，签名 = HMAC-SHA256(key, `decks:{deckId}.pptx.{expires}`)（复用 `ppt-gamma-service.ts` 的 `signExport`，加 `decks:` 前缀做域隔离，两套门面的链接不能互用）。
- 链接无需 key（Gamma 的 bearer 链接语义），7 天过期，篡改或过期 → 403。下载时仍走账号隔离的 `getDeck`。
- `GET /exports/{id}`：生成中且任务活跃 → pending；无卡片 → failed `no_content`；否则 completed。PPTX 在下载时实时构建，不做快照。

## 7. 鉴权与限流

- key：setting `ppt_gamma_api_key` 或环境变量 `PPT_GAMMA_API_KEY`（与旧门面共用一把 key）；都没有 → 403 `api_disabled`。
- 请求头 `X-API-KEY` 或 `Authorization: Bearer`，常量时间比较；错误 → 401 `unauthorized`。
- **不要求登录**：与旧门面不同，Decks 在未登录时使用 `''` 账号（本地 dev 也能用）；登录后自动按 uid 隔离。
- 并发：本账号已有 3 个生成任务（outline/build，取 `deck_jobs` 与本进程任务注册表的交集，避免把上次进程遗留的 running 行算进去）时，新的 Classic / Agent 生成 → 429 `workspace_concurrency_limit_exceeded` + `Retry-After: 10`。编辑不计入。

## 8. 与 Gamma 的差异

- **Classic 轮询带 `progress`**（Gamma Classic 没有）：额外字段，Gamma 5 客户端读同样形状。Classic 完成/失败时也带 `warnings` 字符串（Gamma 只在创建时给），Classic 不返回 `credits`（该字段在 Gamma Classic 中可选）。
- `credits` 恒为 `{}`：Decks 不计费（Gamma 说明成员 best-effort、未知时省略）。
- 失败 `statusCode` 固定 500，`reason` 固定 `generation_failed` / `edit_failed`。
- 额外警告码：`num_cards_adjusted`、`dimensions_adjusted`、`language_adjusted`、`image_source_unsupported`、`ignored_image_model`、`ignored_image_options`、`ignored_text_options`、`ignored_quality`、`ignored_publish`、`theme_logo_as_text`、`header_footer_image_skipped`，以及 Decks 引擎自己的 `ai_images_unavailable`、`image_urls_skipped`、`demo_model`。`export_failed`、`ignored_folder_id`、`ignored_workspace_access`、`ignored_external_access`、`ignored_email_options` 与 Gamma 同名。
- 默认值：`textOptions.language` 省略时跟随输入（Gamma 默认 en）；`cardOptions.dimensions` 省略时 presentation 16x9 / document pageless / social 1x1（Gamma 默认 fluid / fluid / 4x5），因为 Decks 的 PPTX 导出以固定比例为主。
- `numCards` 上限 60（Gamma 付费计划 100）；Decks 的卡片数同 Gamma 一样是软目标。
- 编辑永远是整个 deck（`scope: deck`），`pageId` 等于 deck id（Decks 没有多页 file）。
- 不支持：`pages` / `publish` / `webpage`、`sourceUrls` / `files`、PDF/PNG 的 API 导出、`/generations/from-template`、`/uploads`、`/folders`、`/gammas/search`、archive/delete、comments、analytics、`/images`。
- 导出链接对应 deck 的当前内容（下载时生成），不是导出那一刻的快照。
- 主题只有 Decks 内置的 8 个 `standard` 主题，没有 custom。
- 页眉页脚的自定义 logo 已托管为 media 并写入 `mediaId`，但截至本文档，`CardView` 与 `export-pptx` 的 logo 槽位只渲染文字（`value` 或 deck 标题）；等渲染器支持 `mediaId` 后自动生效。

## 9. 测试

`npx tsx --test src/__tests__/unit/decks-gamma-api.test.ts`（13 个用例）：

- 纯映射：Classic 全字段映射与警告集合、默认值（10 张、aiGenerated）；400 拒绝（未知主题、语言、webpage、pages、未知字段、numCards>100、非法尺寸、非 https logo、缺 inputText）；inputTextBreaks 预备大纲；主题列表形状与分页。
- 鉴权：403 `api_disabled`、401（错 key / 无 key）、Bearer 头、未知路由 404。
- Classic：创建 200 → 闸门挡住写卡时轮询到 pending + 真实阶段计数（各阶段之和 = total）→ 开闸后 completed → 签名链接下载，JSZip 解析出与卡片数相同的 slide；篡改/过期 403；页眉页脚（含托管 logo）落到 deck；跨 flavor 404。
- inputTextBreaks：4 段 → 4 张卡，标题按原文。
- Agent：202 + 警告（`export_failed`、`ignored_quality`）→ completed（gamma、summary、`credits:{}`、无 exportUrl）；未知字段 400、themeId+templateId 400、未知模板 400；templateId 复制主题/格式/尺寸/页眉页脚。
- 并发：闸门挡住 3 个生成（使用真实计数器）→ 第 4 个 429 + `Retry-After: 10`；放开后可再建。
- 编辑：201 → pending（pageId = deck id）→ 第二个编辑 409 `edit_in_progress` 带 editId → 完成后 deck version 增加、无残留开放提案、再次轮询不重复应用；编辑未知字段 400、未知 editId 404。
- 元数据与导出：GetGammaResponse 字段集合与取值、400/404；pdf 导出 400；pptx 导出 → completed → 下载为 zip。
- 账号隔离：切换 `current_user_uid` 后生成与 gamma 都 404。
