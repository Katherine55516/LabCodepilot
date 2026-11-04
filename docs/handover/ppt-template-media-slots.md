# PPT 上传模板的媒体：槽位规则、图片读取、不重复与图表可读性

> 产品思考见 [docs/insights/ppt-template-media-slots.md](../insights/ppt-template-media-slots.md)
> 执行计划见 [docs/exec-plans/active/ppt-template-media-slots-20261102.md](../exec-plans/active/ppt-template-media-slots-20261102.md)

## 范围

只作用于卡片流（`cardsFlow`）中 `templateFidelity.mode==='preserve'` 的上传模板。内置模板不受影响。

## 数据流

1. **模板导入**（`lib/ppt/import-pptx.mjs`，IR 版本 `pptx-ir-15`）
   - Python 对每张幻灯片图片和继承图片调用 `image_pixels()`，用 PIL 在 256 px 上做像素分析，得到 `{flat, top4, edges, continuousTone}`。
   - 系统没有 tesseract 时，额外附带一个 ≤1024 px 的 `ocrImage`。
   - `importEditablePptx` 随后调用 `readTemplatePictures()`（`lib/ppt-template-picture-read.mjs`），用内置 tesseract.js（eng + chi_sim，best_int，离线）读取 `ocrImage`。结果按图片哈希缓存在 `$COWORK_STATE_DIR/ppt/picture-reads`，读后删除副本。
2. **认证**（`pictureCertificate`）：L1 = 读取结果为 `no_text` 或 `numbers_only`、`continuousTone`、无超链接。只有像素分析时不认证。认证图片的角色为 `template_decoration`（`templateMediaRole`），设计视图不退役它。
3. **槽位**（`lib/ppt-chrome-slots.mjs`）
   - `chromeSlot`：图片贴页边 1% 以内，且宽或高 ≥25%。
   - 外框槽位里的认证画作在所有页型都保留。
   - 内容页的内容槽位只放该页引用的源文图表。
4. **不重复**
   - `repeatedChrome` 按计划页序推演：同一张画第一次免费；第二次需与上次相隔 ≥5 页，且内容池（`contentPool`：除封面与结尾页版式外的认证外框画作）中同尺寸类（`sameSlotSize`，两边各在 25% 内）的画都已出现过；不允许第三次。台账的重复条目附 `pool`。
   - 被拦下的画由 `applyChromeFallback` 换成模板最常用深色填充的纯色 PNG（`derivedFrom:'chrome-fallback'`），记入 `templateOmissions`（`approvalBasis:'template_picture_repeat'`），导出器照常写出。
5. **排版调度**（`lib/ppt-card-pages.mjs` `mediaCost`、`lib/ppt-template-fidelity.mjs` `rescheduleTemplateFidelity`）
   - 外框槽位里的认证画作不计内容页照片成本。
   - 主题页没有任何视觉元素时计 `NO_VISUAL_COST`（250）。视觉元素包括外框画作、源文图表、图表、流程或图解、编号组合图、图标（`ownVisual`）。表格或公式页按内容计，仍为 80（`OBJECT_NO_VISUAL_COST`）。
   - 页面出现纯色面板时，每块计 `SAME_PHOTO_COST`（60）；与相邻页的面板挨着时再计 `THEME_OVERFLOW_COST`（1000）。
   - 版式复用上限 `layoutReuseCap = max(2, floor(N/5))` 是硬规则。前面页面已用满上限的版式，只在没有未超限且 `cardFrameFits` 为真的版式时才可选用；`cardFrameFits` 要求正文字号放得下、标题放得下、不是章节头。兜底写入 `templateFidelity.reuseCapFallbacks`。媒体平衡步骤（`balanceTemplateMedia`）不会把页面移到超限版式。
   - `headerFrameReason`（`lib/ppt-template-roles.mjs`）：标题位于认证横幅正下方，且正文区 ≥40% 高、标题 ≥60% 宽时，不算章节头。
   - 退役组合图（≥3 张尺寸相近、各 ≤8% 页面的 `old_template_content` 图片落在正文区，如花瓣、圆环）的页面不做稀疏放大，按正文字号排版（`retiredAssembly`）。
   - 拆分卡片的各部分（标题带 k/n，或相邻页同属一张卡片）不做稀疏放大，保持同一正文字号（`cardPart`）。
6. **源文图表可读性**
   - PDF 抽取（`lib/ppt-source.mjs`）对矢量图记录 `figureText`：有字形时为 `{source:'glyphs', share, boxWidthPt}`，`share` = 第 10 百分位字号 ÷ 图框宽度。
   - 没有字形的矢量图（标签是曲线）和位图示意图，附带 4× 只读副本 `ocrImage`。`measureFigureText` 用 tesseract.js 读出第 10 百分位词框高度 ÷ 副本宽度，结果 `source` 为 `ocr`、`ocr_unread`（少于 3 个词）或 `ocr_failed`；按 `figure-<sha>` 缓存。已缓存的哈希通过 `PPT_FIGURE_KNOWN` 传给 Python，重复导入不再渲染副本。
   - `legibleBeside`（`lib/ppt-card-figure-layout.mjs`）判断图能否放在要点旁：
     - 有 share 时，share × 放置宽度（pt）需 ≥7 pt；
     - 读不出时，矢量图放置尺寸需 ≥1.75 倍印刷尺寸，位图示意图需 ≥40% 内容宽度；
     - 照片与游戏画面豁免。
     - 不满足时 `fitCardFigures` 返回 null，图留在图页。
   - 图页上多张图并排时，每张已测量的图都要 ≥7 pt（`figurePageFits` 调用 `figureTextReads`）。否则后一张另起一页；低于完整篇幅时进入备注，并在保留图的说明末行写"Figure 8: see notes"（`figureNotePointers` → `sourceImageComponents(image, notePointer)`；完整性检查接受带记录指针的说明）。
   - 图页标题取自图注（`captionLeadTitle`），只需在图页能用的版式上放得下（`figurePhotoCost>0` 的照片版式不计），不再退回为前一张卡片标题的截断。
7. **台账**（`lib/ppt-deck-media-metrics.mjs`，挂在 preserve 台账的 `deck` 上）
   - 指标：`coverage`、`contentCoverage`、`repeats`、`frames`、`overCap`（含页码）、`chromePictures`、`chromePanels`、`panelShare`、`figureText`（每张图的依据与放置后字号或倍率）。
   - 警告（都不阻断导出）：`media_coverage_low`、`template_picture_repeat`、`layout_reuse_cap_exceeded`、`figure_text_small`。

## 手工稿标准（M1–M6）与 Codex 验收修复

- **配色（M1）**：`lib/ppt-template-palette.mjs` 的 `usedTemplatePalette` 在 `fidelityFromImported` 时为上传模板派生 `panel`、`onPanel`、`accent`、`foreground`（`derivedFrom:'template-slides'`）。`ppt-card-pages.mjs` 的 `cardPanel` 给卡片、步骤卡写 `pointLayout.panelFill/panelText`；导出器（`ppt-point-cards-python.mjs`）、SVG 预览（`ppt/exporters/preview.mjs`）、编辑器画布（`PptCanvas.tsx`）都按 `panelText` 填充整卡并用浅色字；面板会清除 KPI 色调遗留的透明度。渲染树（`ppt/render-tree.mjs`）重算步骤卡时保留面板颜色。
- **标记与竖轴（M2）**：`cardMarkers` 给 grid/compare 卡写 `markers`；`diagramCardPlan` 为标记预留 `MARKER_IN` 宽度。`processCardPlan` 在 `content.rail` 且 ≤6 步时单列排布并返回 `rail`；三个渲染器画竖线与圆点（名称 `AIMate decor:rail*`、`AIMate decor:marker*`）。KPI 卡上限 8。
- **编号组合图（M3）**：`assemblyPlan` 作为 `nativeCardSlots` 的后备；`setKeptAssembly` 让 `autoTemplateMediaOmissions` 不退役保留的块。
- **图卡（M4）**：`figurePills`（`ppt-density-packing.mjs`）给 2–3 图的图页生成标题条；`wideFigureFit` 把标题条放在各自图上方；`bindSourceMedia` 同时传入备注指针。
- **公式卡（M5）**：`equationPoint` 判定只含一个公式的要点，节点 `style.fill` 为深色底。
- **文字形式生成器标记（M6）**：`BUILDER_MARK_SCRIPT` 增加 `builder_text`。
- **插图不重复（B）**：`repeatedArtwork`（`ppt-media-preserving-layout.mjs`），`regionArtwork` 不再提供被拦下的插图。
- **长稿画作次数（D）**：`paintingUseLimit`；`PANEL_COST=150`；结尾页面板计成本；被替换为面板的画不算视觉元素。
- **图表旁表头（F）**：`ppt-source-artifacts.mjs` 对 chart 组件不加表头行。

## 审查后的保守与通用规则（2026-11-02）

- 读图：`pictureTextOutcome` 中任意文字体系 ≥2 字母、置信度 ≥70 的词 → `uncertain`；系统 tesseract 返回 `lettered`，`pictureCertificate` 视为有文字。缓存文件名带规则版本（`.r2.json`），模板 IR 为 `pptx-ir-16`。
- `chromeSlot` 贴边容差 3%。
- `usedTemplatePalette(slides, palette, size)`：深色填充需 ≥1% 全部幻灯片面积才成为 `panel`。
- `componentSurface(palette)`：组件外观（面板或强调色 + 可读文字）。标记、竖轴、公式卡、图卡以 `templateFidelity.mode==='preserve'` 启用，不再要求深色面板。
- `assignSourceImages`：`legibilitySplit` 的图组保留为第二个图页。
- 徽章编号：`numberedMarkers(..., live)` 用页面实际形状判断底色；重新锚定的模板图标用调整后的位置；克隆图标留在 `templateComponentClones` 中（重复绑定仍有编号），只在页面节点中排除。
- KPI：任何数字需单行显示，否则该列数不作为候选。

## 第三、四轮对照手工稿评审（P1–P6 与 live 修复，Fable 2026-11-02 验收于 9772a09a）

- **数字卡（P1）**：`withTableRows`（`ppt-outline-cards.mjs`）按表分组；≤3 行纯数字小表在引用卡片的要点数不超过 5 时留在该卡，作为要点下方一行数字卡（`themeComponentParts` 的 tile row）；否则单独成卡（1 行的小表留下）。数字卡卡片最多 8 个（`TILES_MAX`）。`sanitizeCardTopic`（写作回复两次未通过时的兜底）对数字行卡片同样用 8 的上限，超出的要点进备注，不再丢弃。写作模型写成"名称：数字"并引用表格的要点，数字须与表格某个单元格整体一致才进数字卡（`tableRowPoint`）。
- **富文本卡（P2）**：步骤、网格、对比卡的条目带 `headingRich/bodyRich`，三个渲染器一致绘制公式、代码与强调。
- **箭头组合图（P4）**：横幅类同尺寸组图（≤1.2 in 高、≥4:1，如箭头）在内容页一律退役；其他同尺寸小图（≤10% 页面面积）只有块数等于要点数才整组保留（`artworkSets`、`wholeSets`）；大于 10% 的画作各自独立。重复版式的图标轮换标 `iconRotation`，仍视为模板样例图标（`isSampleIcon`），以编号标记代替。
- **并列要点与竖轴（P3）**：写作提示要求并列要点带 ≤3 词标签，"process" 只用于编号步骤。上传模板上，竖轴只给编号步骤（`numberedPoints`）；未编号的并列要点 3–6 条、无标签、每条 ≤220 字符、正文字号放得下、页面无源图时显示为带编号的正文卡片（`markerCards`，`bodyOnly`），列数均衡（3/2×2/3/3，末行居中）；连续 3–6 条引用同一源程序（ProcessBlock 或源文中 1./2./3. 有序列表）的要点显示为竖轴步骤，顺序按源文，其余要点为文字（`procedureRun`）；一条要点用 ";" 连接 3–6 个步骤时拆成步骤。`fitThemePage` 在正文字号放不下时退回为要点。
- **组合图提示（P6）**：`ppt-template-assemblies.mjs` 的 `templateAssemblyHints` 把模板组合图的块数与标签长度写进写作提示，任务记录 `assemblyOffered`。
- **变化预算**：`balanceCardShapes` 可计入编号步骤，但不改变其形状。
- **数字检查（numberGuard，`ppt-api.mjs`）**：只对卡片自身要点节点的失败生效，按整数匹配移动要点；标题（含拆分计数）的失败交给门禁的页面标记。每次移动在 `numericNotes` 记录数字、节点与要点。
- **图旁要点保留标签**：`normalizeSlide` 的 commentary 与 `bindSourceMedia` 的文字都写成"标签：正文"。
- **表格行门禁**：行标签只在页面正文节点（不含标题、眉标、导航）中匹配，备注中的行计为 noted（`metrics.notedTableRows`），每条结果写明缺失的行号范围（`missingRowRange`）。卡片稿中被卡片要点引用的书面表格（`writtenTable`）丢失行时为 `cited_table_rows_missing`：错误，属于 `BLOCKING_CODES`，且不降为页面标记（`DECK_CODES`），阻止导出。其他表格仍为 `source_table_rows_missing`，保持原级别（警告，严格覆盖时为错误），不阻止导出（Fable，联合验收 CodePilot PDF 后）。
- **样例图标的媒体保留计数**：编号标记节点带 `markerFor`（被替换图标的 shapeId）；媒体台账中 `sample_icon_marker` 记录只有在发布页面上存在对应标记时才算已验证的改编（`markerShown`），否则计为丢失。
- **上下标属于富文本**：`richParts` 与卡片形状判断把 baseline≠0 的片段（`g~φ~`、`H~2~O`、`mc^2^`）视为富文本，卡片条目带 `bodyRich`，导出校验比较渲染后的文字。

## 手工稿差距 G1/G2/G5（Fable 2026-11-02）

- **G1 版式上的整页图片（`ppt-layout-pictures.mjs`）**：版式或母版上占幻灯片面积 ≥25% 的图片与颜色层从下往上读，找到可见的那一张：其上有不透明颜色层（Mood-Board 米色层盖住深色纹理）则不提升；不透明图片经认证（无文字、连续色调）、其上没有半透明图片且色调层合计 <75% 时，连同其上的色调层（Portfolio 封面 10% 藏青）提升为使用该版式的每页的节点：钉住（不可移动或缩放，可删除）、置于最底层；导出时从版式中删除，避免画两次。删除后不再加回（`layoutPictureDeleted`）。只用于上传模板，媒体指标不把它算作页面视觉元素。
- **G2 纯文字卡片借用模板图片（`ppt-content-slot-pictures.mjs`）**：按页序，纯文字内容卡（无图、表、数字卡、图表、公式卡）显示其版式内容槽位里经认证的图片：该图片在稿中尚未用过时用原图，否则借一张未用过、宽高比相差 ≤25% 的认证内容槽图片，按槽位裁切填满；窄条只用原图。内容槽图片不重复；无图可用时退役该槽位，区域交给卡片。封面与结束页的图片保留给它们。有其他内容的卡片退役这些图片。
- **G5 硬上限**：同一模板页最多用 max(2, floor(N/5)) 次、不在相邻页重复；所有放得下的模板页都到上限时，文字卡改用"仅版式"页（`layoutOnly`，保留模板版式、去掉样例内容，不计入上限并记入台账）；图、表、对象页保留最合适的模板页并记录超限。

## 图文配对（F1–F3、P1–P3、R1/R2、D，Fable 2026-11-02/03）

用户发现手工稿把同一部分的图和解说放在同一页，PPT 模块却把图放在单独的图页、解说在另一页。根因：`assignSourceImages` 为被引用的图建图页，`placeCardFigures` 只在卡片全部要点都放得下时才把图放到卡片上，否则图页保持空白；没有任何步骤把解说图的要点移到图页。

- **配对（`pairFigurePages`，`ppt-card-figure-layout.mjs`）**：图页从同一张卡片（`logicalCardId` 相同，R1；没有卡片 ID 时才按标题词根）的页面取要点。引用该图的要点（图注单元、"Figure N"、图所在段落，`pointCitesFigure`）优先，不足 2 条时补最近的要点；拿走后原页少于 2 条则整页并入。图页成为卡片的一部分（`pairedFigurePage`），标题为卡片标题加计数，不再用图注做标题（F2）。版式依次试 图在旁（`card-source-figure-columns`）、图在上（`card-source-figure-below`），都放不下则保留图页（F3）。对象、表格范围、编号步骤、行标签要点的页面不出让要点。已有一张图的页面可再给第二张图出让要点，自己保留图与 2 条要点（P1）。
- **图注（P2）**：图在要点旁时只显示带编号的第一句（≤2 行），否则"Figure N: 主题"；完整图注进备注（`shortenedCaptionNotes`）。纯图页保留完整图注。
- **OCR 未读出文字（用户 2026-11-03，取代 Fable P3）**：OCR 未读出或失败（`figureText.source` 为 `ocr_unread`/`ocr_failed`）不等于没有文字。这类图（含照片、游戏画面、截图）为"不确定"（`uncertainText`），只在宽度 ≥ 内容区 40% 时放在要点旁，否则保留独立图页；不视为可读性已通过，每页给 `figure_text_unmeasured` 警告；从不移入备注。
- **被引用的图从不进备注（R2，用户 2026-11-02）**：取消 11-01 的"每张卡片最多一页图"上限与配不上要点时降级到备注；只有未被引用的图（附录等）可降级。超出页数上限时给 `figure_pages_over_length` 提示，不丢图。
- **计数**：卡片部件编号原本在 `cardOutlinePostProcess` 中执行，配对在其后的 `assessCandidateNow` 中执行，配对产生的新部件没有计数（"X · 1/2 / X (cont.) / X · 2/2"）。现在 `assessOutlineCandidate` 在配对与标题兜底后，对有配对页或刚被兜底改标题的卡片重新编号；其他卡片的标题不变。
- **标题校验**：配对试验只拒绝"试验新造成"的标题不合（以 `raw.slides` 为基线）；原来任一页标题在改写前不合都会拒绝整份稿的所有配对（Capabilities 0 对的根因）。
- **D（Fable 2026-11-03）**：整页并入会让后面的页面前移一位，按位置分配的模板页可能放不下前移页面的标题。配对试验的调度分数（`figureTrialScore`）对试验前标题放得下的普通卡片页加入标题成本，让前移的页面换到标题放得下的模板页（上限与相邻规则不变）；仍放不下时拒绝该配对（B），不为配对改动无关页面的标题。
- **基线（f5 live，2026-11-03，Fable 要求记录）**：被引用图与其要点同页 Mood 5/9（纯图页：legibility 1、titles 3）、Portfolio 4/8（legibility 1、no_points 2、space 1）、Capabilities 5/10（legibility 1、titles 3、no_points 1）。titles 是模板页不足（上限 max(2,floor(N/5))、6 个内容模板页）时 B 的结果，fill-first P2 之后先复查这一项。
- **纯图页的原因（必填）**：留下的每个图页带 `figureOnlyReason`：`no_points`（卡片没有可配的引用要点）、`space`（试过的版式都放不下；图卡路线尚未实现）、`titles`（B 拒绝，`figureOnlyDetail.refusals` 记页码、标题与模板页）；台账 `figurePlacements` 在图内文字 <7 pt 时记为 `legibility`（F3）。配对过的稿件中缺原因的图页记默认原因 `unrecorded` 并给 `figure_only_reason_missing` 警告（不阻断）；选测断言每个纯图页都有记录的原因。生成时退回的图页记为 `space`（`generationFallback`）。所有可配页面都已有图、腾不出 2 条要点时记为 `no_points`。两张图的图页整体配不上时，逐张单独尝试，配上的一张随要点，另一张保留自己的图页；都配不上则保持原页。

## 发布与排版诊断（用户 2026-11-03）

只有确定性的源内容丢失、必要对象损坏或导出文件损坏阻断发布。排版诊断都是提示：图片覆盖率（`media_coverage_low`）、模板图片重复（`template_picture_repeat`）、版式超限（`layout_reuse_cap_exceeded`）、图内文字（`figure_text_small`/`figure_text_unmeasured`）、纯图页原因（`figure_only_reason_missing`）。模板插画保留比例（`media_conservation_blocked`、`media_weighted_conservation_blocked`）已从卡片稿的 `BLOCKING_CODES` 移除，经现有分级降为提示；旧流程的台账级别不变。受保护的模板资产丢失（`template_asset_loss`）、源对象或源图缺失、被引用表格行缺失、导出失败仍阻断。复用现有分级与 warning，不新增门禁层。

## 关键文件

| 文件 | 作用 |
|------|------|
| `lib/ppt-template-picture-read.mjs` | tesseract.js 读取、文字判定、L1 认证、图表文字测量、哈希缓存 |
| `lib/ppt-chrome-slots.mjs` | 外框槽位、不重复推演、纯色面板 |
| `lib/ppt-deck-media-metrics.mjs` | 整份稿的媒体指标与警告 |
| `lib/ppt-card-pages.mjs` | `mediaCost`（面板、上限成本）、`cardFrameFits` 注册、`retiredAssembly` |
| `lib/ppt-template-fidelity.mjs` | 硬上限调度、`setCardFrameFits`、平衡步骤不超限 |
| `lib/ppt-card-figure-layout.mjs` | `legibleBeside` 可读性下限；`pairFigurePages` 图文配对、`pairedCaption`、`figureOnlyReason` |
| `lib/ppt-source.mjs` | PDF 图表文字字号、4× OCR 副本 |
| `lib/ppt-template-palette.mjs` | 模板实际用色、组件外观、图表系列色 |
| `lib/ppt-template-assemblies.mjs` | 组合图识别与写作提示 |
| `lib/ppt-key-number.mjs` | `keyNumber`（避免循环引用的叶子模块） |
| `lib/ppt-content-qa.mjs` | 表格行检查（正文匹配、备注计数） |

## 依赖

`apps/cowork-server/package.json`：`tesseract.js@7.0.0`、`@tesseract.js-data/eng@1.0.0`、`@tesseract.js-data/chi_sim@1.0.0`（4.0.0_best_int 语言包，复制到状态目录，不走 CDN）。

## 测试

- `selftest-ppt-template-picture-read.mjs`：文字判定、认证、缓存、图表文字 share
- `selftest-ppt-chrome-slots.mjs`：外框槽位、不重复推演、纯色面板
- `selftest-ppt-deck-media-metrics.mjs`：覆盖率、重复、上限
- `selftest-ppt-card-pages.mjs`：认证画作列与普通版式的对比；面板排序（未用画作优先于面板，面板相邻计 1000）
- `selftest-ppt-template-fidelity.mjs`：硬上限与兜底记录
- `selftest-ppt-inline-figures.mjs`：可读性下限
- `selftest-ppt-figure-pairing.mjs`：引用识别、部件顺序、整页并入、F3、受保护页面、被引用图不进备注、同名不同卡不交换、P2 图注、P3、纯图页原因、D 试验分数、台账缺原因错误
- `selftest-ppt-card-pages.mjs`：正文卡片、竖轴只给编号与源程序、源文顺序、";" 拆分、数字卡单元格匹配、均衡列与末行居中
- `selftest-ppt-number-guard.mjs`：标题失败不移动要点、整数匹配、台账、跨图页拆分卡片的计数验证
- `selftest-ppt-table-markup.mjs`：小表留卡与单独成卡、兜底路径保留全部 7 行
- `selftest-ppt-visible-depth.mjs`：表格行不经标题匹配、备注计数、丢失行阻止导出
- `selftest-ppt-card-shapes.mjs`、`selftest-ppt-enterprise.mjs`：变化预算不改编号步骤、轮换图标仍是样例图标

## 未完成

- 图卡路线（Fable M4/(3)，下一次提交）：同一卡片的 2–3 张图合为一页图卡，以引用要点的标签为标题、各配一行解说，其余要点留在原页；之后 `space` 才表示"图卡路线已试且失败"。
- 一张卡片的图多于可配的要点对（Mood 的 Vision/Memory/Control：5 张图、5 条要点）时，多出的图保留图页（`no_points`/`titles`）；为每张图另写解说属于写作改动。
- 用户 11-03 提出、尚未处理：Mood-Board 部分页面组件超容量、中文稿封面残留英文、模板图片利用率不足；大纲生成按阶段计时与提速。

- 读取器 A 层（视觉模型探测）与 L2。
- 原生槽位 ≥12 pt。
- 标签槽容量。
- 按文字去除生成器标记。
- AI 配图。
- 拆分卡片标题槽放不下计数时（Fable Q2 兜底），仍可能出现无计数的重复标题并被标记；是否把计数移到眉标需要新的产品决定（Codex）。
- 附录大表分页：CodePilot PDF 的 65 行 API 表（b_0152）附录只显示到第 53 行，第 54–65 行缺失；在 main 上已是警告，属于对象表格分页（Codex 的表格范围），需在下一次合并前修复。
