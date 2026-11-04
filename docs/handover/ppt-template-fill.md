# PPT 上传模板：模板页识别与原生填充（fill-template-first MVP）

> 产品思考见 [docs/insights/ppt-template-fill.md](../insights/ppt-template-fill.md)
> 媒体规则见 [docs/handover/ppt-template-media-slots.md](./ppt-template-media-slots.md)

## 范围

只作用于卡片流中 `templateFidelity.mode==='preserve'` 的上传模板。两个会话分工（用户 2026-11-03）：

- 媒体侧（本文）：模板页描述（profile）、原生填充（binding）、固定页在媒体相关流程中的处理、离线重放。
- 主流程侧（Codex，`claude/ppt-hand-deck-cards-20261102`）：按内容匹配模板页、按页面容量写作、在大纲各处理步骤中保持已填充页不动。

首期类型：标题+正文（title-body）、图文（text-figure）、左右对比（compare）、步骤（steps）、并列卡片（cards）。循环图、议程花瓣、任意 SmartArt、特殊组合图不识别，走现有排版回退。

## 接口：模板页描述

`apps/cowork-server/lib/ppt-template-fill-profile.mjs`

- `fillProfiles(project)`：从 `templateFidelity.sourceCatalog` 为每个模板页生成一个 profile，只看页面自己的文本槽、图片和编号标记，不看页面名字。
- 每个 profile 的字段：
  - 基本信息：`version`、`profileId`（`fill-<页号>`）、`page`、`lastPage?`、`kind`（无法识别时为 null，并带 `reason`）。
  - 块：`blocks`；`blockSlots[]` 每项为 `{heading:{shapeId,cap}|null, body:{shapeId,cap,items?}, kicker?:{shapeId}, extraShapeIds?}`。
  - 导语与总结：`lead`、`summary`。
  - 图位：`figures`、`figureSlots[]`。
  - 结构标记：`numbered`、`paired`、`stackMayHoldFewer`、`groupHeadingShapeIds`。
- 容量：结构按模板标称容量识别；cap 用模板原字号（低于 12 pt 时按 12 pt）在原生文本框上实测（`slotFit`），单位是视觉单位（`fillUnits`，即 `templateVisualUnits`）。写作和绑定用同一把尺子。
- 识别规则：
  - 块上方无标题的正文是导语（可横跨两栏）。
  - 块下方的整宽正文是总结行。
  - 同一栏内、标题块下方的正文是该块的第二正文。
  - 块内的小标签是 kicker，绑定时写入 01/02/03。
  - 以下情况记为无法识别：带标题和不带标题的块混用；正文容量相差超过 2.5 倍；标称标题容量相差超过 2 倍；图片互相叠放（层叠插画，如环形图）；编号标记多于块（议程/花瓣）。
- `profileAccepts(profile,{kind,blocks,figures})` 的规则：
  - 类型必须一致；步骤可以用卡片页（卡片按 1…N 编号），并列卡片不能用步骤页（步骤页的连接线暗示了顺序）。
  - 块数必须相等，竖排堆叠的页面可以少一块（N−1）。
  - 图数不超过图位数；text-figure 至少要有一张图。
  - 有图位的对比页必须图位全满（figures === slots，Fable 2026-11-03）。
- `blocksFit(profile,written,{lead,summary})`：检查每块的标题和正文是否在 cap 内；如果页面有标题位，每块都必须写标题（否则报 `heading_missing`）。
- 契约测试：`selftest-ppt-template-fill-contract.mjs`，样例在 `test/fixtures/fill-profiles/{mood-board,capabilities,deal-review}.json`，两个会话都运行。

## 大纲字段（主流程写入，绑定读取）

```
outlineItem.templateFill = { page, profileId, kind, blocks, figures, citedFigures, segment, sticky: true, status: 'filled'|'fill_fallback', reason? }
outlineItem.fillBlocks = [{ heading, body }]
outlineItem.fillLead? / outlineItem.fillSummary?
outlineItem.sourceImageIds   // 填充页上展示的图，按引用顺序
```

## 绑定

`apps/cowork-server/lib/ppt-template-fill-bind.mjs`

- `fillCheck`：以下情况不是填充页，卡片带着全部内容走现有主题版式：
  - 页面不在指定的模板页上（`bind_frame`）。
  - 结构不符（`bind_shape`）。
  - 文字超出 cap（`bind_fit`）。
  - 卡片引用的图多于图位（`figures_exceed_slots`）。这条与 `filledPage` 一起，使配图逻辑和调度不把这类页当作固定页。
- `fillNativeSlots`：返回与原生槽位方案相同的结构 `{texts, leaveOut, fonts, plain}`，所以调度评分为 0，容量拆分跳过该页，`cardPageDraft` 按原生页输出。
  - 块、kicker、导语、总结写入对应槽位。
  - 没用到的块、第二正文、导语和总结、分组标题连同装饰一起去掉。
  - 对比页的胶囊图标去掉，避免出现序号；对比页不借用模板照片。
- 正文样式（plain）：正文、导语、总结用样例里的正文 run，而不是粗体标签 run；导出时项目符号改为 `buNone`，按 schema 顺序插入，并删除重复的 pPr。传递链为 `slotPlain` → `templateSlotPlain` → `content.plainBody`。
- `applyFillPictures`：图片放进模板图位，示意图完整放入（contain），照片和截图铺满并裁切（cover），图注在图位内部，完整图注进备注；图位放不下的图仍不会丢。导出时 `fillFigure` 与 G2 借用图一样，允许在首次使用的图位上替换图片。
- 图页使用模板图位（M2）：`figureSlotPlan` / `figureSlotDraft`。只有每个图位都放一张图、且每张图在图位宽度下都清晰（7 pt 下限；OCR 未读出时按 40% 宽度）才使用。图位下方的块写入图的标签和缩短后的图注，否则保留现有的代码绘制图页。`slide.figureSlots` 记录用了哪些图位，或者没用的原因（`slot_count`、`legibility`、`caption_cap`）。
- 导语带过空时改为副标题（Fable 2026-11-03，Q6 (b)）：`leadToSubtitle`。
  - 条件：导语文字不到导语带容量的 30%（`LEAD_MIN_SHARE`，容量为 cap × 栏数）。卡片已有不同的 lead 时不处理。
  - 做法：文字经 `bindCardLead` 放到标题下方；导语槽、包住它们的框（shape 和 foreign）以及栏间分隔线都去掉，记为 `card_group_omitted`，并设置 `slide.fillLeadAsSubtitle`，校验据此允许省略 foreign 节点。
  - 副标题放不下（冲突或超过一行）时，导语带保留原文字；多栏导语再走 `mergeLeadColumns`。
  - 导语带下方的块整体上移（`shiftBelowBand`），块内间距不变。第一块移到导语带原来的顶部，与副标题的间距不小于模板中标题到导语带的间距。页脚和页码不动。
  - 上移量按模板原位置计算；文字适配缓存的原始位置一起更新；编号标记等代码节点记录各自已移的量。因此重新绑定或拖动后重排不会重复上移。用户移动过的节点保持原位。
  - 上移量不足 0.4 in 时不移动。结果记在 `slide.fillBandShift`（`band_dropped_shift`，含移动高度或不移动的原因）。
- 绑定副标题时，没有填充、没有线条、也没有文字的框不算冲突（例如 Capabilities t3 标题下的空 "Text 1"）。
- 主题页卡片行（Q6 (a)）：`centreRow` 保留卡片行的实测高度，并在内容区内垂直居中，不再拉伸到整个内容区（原来的 `stretchRow` 会使卡片偏高、文字只占上部）。
- 固定页的保护：
  - 调度时固定在 `templateFill.page`，排版复用上限在这里只作偏好。
  - 配图逻辑不从固定页取要点，也不把图移入固定页。

## 钩子

- `ppt-card-pages.mjs`：`nativeCardSlots` 遇到填充页时返回 `fillNativeSlots` 的结果；`cardPageDraft` 带上 `slotPlain`。
- `ppt-template-fidelity.mjs`：重新调度时固定填充页；绑定时调用 `applyFillPictures`；写入槽位文字时设置 `plainBody`。
- `ppt-api.mjs`：`normalizeSlide` 中处理 `templateSlotPlain` 和 `applyFillPictures`；图页使用 `figureSlotDraft`，满足条件时跳过 `bindSourceMedia`。
- `ppt-card-figure-layout.mjs`：配图时跳过固定页（`fixedByFill`）。
- `ppt/import-pptx.mjs`：导入时读取 `presetAdjust`（prstGeom 的 adj 值）；导出时支持 `plainBody`，并允许 `fillFigure` 替换图片。
- `ppt/native-shape.mjs`：圆角矩形按 adj/100000 × 短边计算圆角，横纵分别计算（修复 Mood t5 卡片被画成拱形的问题）。

## 编辑器

- `PptWorkspace` / `PptCreateWizard` / `PptCardOutline`：生成被拒时（大纲保存返回 409，或请求前就被拦下，如缺少模型、BYOK 检查不通过），在按钮旁显示原因，并提供“去第 N 页”按钮。原因：大纲抽屉是全屏覆盖层，原来的错误横幅被它挡住，看起来像按钮没反应。

## 离线重放

用已保存的项目和匹配好的大纲重放模板匹配与填充，不调用模型：`scratchpad/fill-replay.mjs <项目.json.gz> <大纲.json> <输出目录>`。它会按当前代码重建每一页，并导出 PPTX，用 LibreOffice 渲染后检查。

## 测试

- `selftest-ppt-template-fill-contract.mjs`
- `selftest-ppt-template-fill-bind.mjs`：块、导语、N−1、kicker、对比页、图与图注、超 cap 回退、图多于图位、图页图位、圆角。
- 相邻测试：figure-pairing、inline-figures、diagram-labels、figure-placement、template-fidelity、layout-only-export、card-pages。

## 未完成

- 一张图的图页落在两图位的对比页上时保持代码绘制。如果要用上一图位的模板页，需要调整调度。
- 主题页的卡片放在模板照片行上方（如 85a2621c p17），属于版式改动，不在本轮。
- 编辑器缩略图中文乱码（A3）在 Chromium 中无法复现，嵌入的模板字体不包含 CJK，需要用户的截图和环境信息。
- 页面类型扩展（循环、议程、主次结构、SmartArt）、其余模板的样例、按渲染结果校准 cap：下一轮。
