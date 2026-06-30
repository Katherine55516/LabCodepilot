# 执行计划：应用内文档预览（PDF / DOCX / XLSX / PPTX）

> 状态：📋 待开始（计划待审阅）｜ 负责人：（待定）｜ 创建：2026-06-29｜ 最后更新：2026-06-29

> 产品思考见 [docs/insights/document-preview.md](../../insights/document-preview.md)（待 Phase 完成后补）
> 完整可行性调研（选型对比 + 对抗验证全文）浓缩在本计划 §2–§3 与项目记忆 `doc-preview-feasibility.md`

---

## 1. 背景与目标

**需求**：在文件树中点击 `pdf / docx / xlsx / pptx` 四类文档，像现有代码预览一样，在左侧弹出预览框直接渲染——无需外部应用、无需联网。

**现状**：[`FileTreePanel.tsx:169`](../../../src/components/layout/panels/FileTreePanel.tsx) 的 `NON_PREVIEWABLE` 集合**主动拦掉**了这四类（点击直接 `return`，无反应）。这是接入的第一处改动点。

**核心判断（多智能体调研 + 对抗验证，2026-06-27）**：可行，且应该做。四类格式都能**纯前端、完全离线**渲染，套用现有预览骨架，**首屏 0 增量**（全部 `next/dynamic` 懒加载），安装包增量约 **3–6 MB**。这不是重构，是「在现有分发器上加一层渲染器」。

**可行性档位（诚实预期）**：

| 格式 | 难度 | 保真度预期 |
|------|------|-----------|
| **PDF** | 易 | 高（像素级、可选中/搜索；中文需配 cmaps） |
| **XLSX** | 易 | 中（值 + 多 sheet + 合并；放弃单元格样式） |
| **DOCX** | 中 | 中高（版式接近 Word，非像素级；XSS 须强制防护） |
| **PPTX** | 难 | 中（文字/表格/图片体面；动画/SmartArt/特效结构性丢失） |

---

## 2. 关键调研结论（复用现有基础设施）

四点架构契合（均已读源码确认）：

1. **预览面板已是「按扩展名分发渲染器」结构**——[`PreviewPanel.tsx`](../../../src/components/layout/panels/PreviewPanel.tsx) 已按扩展名路由到 Sandpack / CodeMirror / DataTableViewer / MediaView，每个重型库用 `next/dynamic(ssr:false)` 独立成 chunk。新渲染器照抄此模式。
2. **取二进制字节的通道现成**——[`/api/files/serve`](../../../src/app/api/files/serve/route.ts)（`baseDir` 从 DB 派生、不信任客户端、>10MB 流式）。客户端 `fetch(fileServeUrl).arrayBuffer()` 喂给渲染库。文档是二进制，**走 serve，不能走 `/api/files/preview`**（后者对二进制返回 415 `binary_not_previewable`）。`fileServeUrl` 已在 `PreviewPanel.tsx:476-480` 构造好。
3. **运行形态天然离线**——生产是 Electron 内跑打包好的 Next standalone server（`http://127.0.0.1:3000`），worker/字体等本地资源由本地服务提供，**无需 CDN**。已有 [`public/asr-worklet.js`](../../../public/asr-worklet.js)（`useVoiceInput.ts:75` 以 `'/asr-worklet.js'` 绝对路径引用）是验证过的 public-worker 先例。
4. **防护件与表格渲染器已在依赖里**——`dompurify@3.3.3`、`papaparse@5.5.3` 已装；`DataTableViewer` 的 `rows+header` 预解析入口（`DataTableViewerProps`）可直接接 Excel 解析结果。

---

## 3. 推荐技术栈

| 格式 | 推荐库 | 版本 | 许可证 | 离线 | 集成难度 |
|------|--------|------|--------|------|---------|
| **PDF** | `react-pdf`（内核 `pdfjs-dist`） | 10.4.1（pin pdfjs 5.4.296） | MIT + Apache-2.0 | 需本地化 **4 类**资产 | 低 |
| **XLSX** | `xlsx`（SheetJS CE）→ 复用 `DataTableViewer` | **0.18.5**（锁 registry 版） | Apache-2.0 | 纯客户端 | 低 |
| **DOCX** | `docx-preview`（+ jszip 传递依赖） | 0.3.7 | Apache-2.0 | 纯客户端 | 中（XSS） |
| **PPTX** | `@aiden0z/pptx-renderer` | 1.2.1 | Apache-2.0 | echarts 切独立 chunk | 中 |

**选型纠偏（对抗验证否决的「看似可选」项）**：
- PDF 用 `react-pdf` 而非裸 `pdfjs-dist`（封装好 worker 生命周期/三层渲染，React 19 原生兼容）；`@react-pdf-viewer` 已停维 2023 + 许可风险，排除。
- XLSX 锁 **0.18.5**：最新 0.20.x 只在官方 CDN 分发，与本仓 npmmirror/HK 网络纪律冲突；0.18.5 读 xlsx/xls/多 sheet/合并全支持。
- DOCX 用 `docx-preview` 而非 `mammoth`：mammoth 设计上丢版式（适合提取正文喂 LLM），不满足「预览像原文档」。
- PPTX 选 `aiden0z` 而非老牌 `PPTXjs`：后者 2022 弃坑（jQuery 栈）；aiden0z 是 2026 年唯一持续迭代的纯前端库，自带协议过滤 + 视觉回归测试。

---

## 4. 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 四类**复用 `kind:'file'`**，不新增 PreviewSource kind，在 `PreviewPanel` 按扩展名分流 | 改动最小；与现有 `isMediaPreview` 短路一致 |
| D2 | 每类一个独立组件（`PdfViewer`/`XlsxViewer`/`DocxViewer`/`PptxViewer`），全部 `next/dynamic(ssr:false)` 懒加载 | 零首屏成本；隔离各库体积；照搬 Sandpack 写法 |
| D3 | 文档走 `fileServeUrl` 取 `arrayBuffer()`，在 `PreviewPanel` 的 `useEffect` 顶部对文档扩展名**短路**跳过文本 fetch | 文档是二进制，preview 文本通道返回 415 |
| D4 | PDF 的 worker/cmaps/standard_fonts/**wasm** 一律当静态资源放 `public/pdf/`，用**绝对路径字符串**加载，**禁用 `new URL(...,import.meta.url)`** | Turbopack 对 worker/wasm asset 发射不可靠 + standalone NFT 跟不到浏览器侧资源（见 `next.config.js` 注释教训）；与 `asr-worklet.js` 同模式 |
| D5 | 新建 `scripts/copy-doc-assets.js` 拷 PDF 资产，仿 `vendor-gsd-prepare.js`，挂 `electron:build` 链 + `predev`（幂等） | build 链已有先例；`dev=next dev` 不走 vendor 链（见 §6 坑） |
| D6 | XLSX **复用 `DataTableViewer`**：SheetJS 解析 → `sheet_to_json(header:1)` → `rows+header` 喂入 | DataTableViewer 已支持预解析入口；职责干净 |
| D7 | DOCX/PPTX 渲染后**强制 `DOMPurify.sanitize`** + `renderAltChunks:false` + 容器 CSP/sandbox | 文档注入 DOM 的 XSS，爆炸半径大（见 §7） |
| D8 | 老二进制 **.doc/.ppt/.xls 不做**，`NON_PREVIEWABLE` 保留拦截，点击给「请另存为新格式」提示 | OLE2/BIFF 纯前端无解；不假装能渲染 |
| D9 | 只读预览，不进 `ViewModeToggle`（edit/source/rendered 三态）；`canEdit`/`canRender` 对文档返回 false | 文档非文本编辑对象 |

---

## 5. 触及文件

**新增：**
- `scripts/copy-doc-assets.js` — `require.resolve('pdfjs-dist/package.json')` 定位包根，拷 `build/pdf.worker.min.mjs` + `cmaps/` + `standard_fonts/` + `wasm/` + `iccs/`（**5 类**，iccs 为 pdfjs 5.x 新增 ICC color profile）→ `public/pdf/`；**断言版本 === `pdfjs.version`**（写 `.version` 戳记）；幂等（戳记一致则秒退）
- `src/components/editor/PdfViewer.tsx` — `react-pdf` `<Document file={{data}} options={memoized}>` map `<Page>`；模块顶层设 `workerSrc='/pdf/pdf.worker.min.mjs'`，options 含 `cMapUrl/cMapPacked/standardFontDataUrl/wasmUrl`；缩放按钮接入头部
- `src/components/editor/XlsxViewer.tsx` — `XLSX.read` → sheet tab 切换 → `sheet_to_json(header:1)` → 喂 `DataTableViewer`
- `src/components/editor/DocxViewer.tsx` — `renderAsync(buf, ref, style, {renderAltChunks:false, ...})` → 渲染后 `DOMPurify.sanitize`
- `src/components/editor/PptxViewer.tsx` — `@aiden0z/pptx-renderer` 渲染；echarts 二级懒加载；try/catch 兜底；fit-to-width

**修改：**
- `src/components/layout/panels/FileTreePanel.tsx`（`NON_PREVIEWABLE` 169-176）— 移除 `pdf/docx/xlsx/pptx`；**保留 `doc/xls/ppt`**；老格式点击给降级提示
- `src/components/layout/panels/PreviewPanel.tsx` — ① 顶部加 4 个扩展集合 + `isDocumentPreview()`；② `useEffect` 短路：`if (!filePath || isMediaPreview(filePath) || isDocumentPreview(filePath)) { setLoading(false); return; }`；③ 4 个 `next/dynamic` 懒加载；④ 渲染分发分支；⑤ PDF/PPTX 头部缩放、XLSX sheet 切换控件
- `src/app/api/files/serve/route.ts`（`MIME_TYPES` 10-33）— 补 `.pdf/.docx/.xlsx/.pptx` 四条 MIME（规范化，`arrayBuffer()` 不依赖它，但为日后 `<iframe>` 兜底留余地）
- `package.json` — 新增 `"vendor:doc-assets": "node scripts/copy-doc-assets.js"`；挂到 `electron:build` 链（`vendor:gsd` 之后、`next build` 之前）+ `predev`/`prebuild` 钩子 + `electron:dev` 链开头（四入口全覆盖，因 `electron:dev` 的 `next dev` 是直接命令不触发 predev）
- `.gitignore` — 加 `public/pdf/`（构建产物不入库）
- `src/i18n/en.ts` / `zh.ts` / `zh-HK.ts` — `docPreview.*`（加载中/错误/不支持旧格式/PPT 排版差异提示）。**zh-HK 手动加，勿跑 gen 脚本**（会回退 ~40 处 HK 术语）

**无需改动：**
- `electron-builder.yml` — `public/ → standalone/public/`（第 93-94 行）已覆盖 `public/pdf/`，零改动
- `src/hooks/usePanel.ts` — 复用 `kind:'file'`，无需新 kind
- `src/lib/db.ts` — 无 schema 变更
- `src/components/editor/DataTableViewer.tsx` — `rows+header` 入口已满足；可选小扩展「首行是否当表头」开关（应对无表头表）

---

## 6. 离线打包关键风险与对策

**① PDF 离线资产是 4 类，不是 3 类（致命级）**
- worker、cmaps、standard_fonts，**再加 `wasm/`**——pdfjs 5.x 把 OpenJPEG/JPEG2000 解码器拆成独立目录；含 JPEG2000 图的 PDF 缺 `wasmUrl` 会抛 `JpxError` 并在离线下发非法网络请求而失败。
- **worker 版本必须 == `pdfjs.version`**，否则 `"API version does not match Worker version"` 直接渲染失败 → 拷贝脚本里断言，不手动放文件。
- **中文 PDF 不配 cmaps 会整页空白**——本项目用户大概率有中文 PDF，cmaps 是命门，必打。

**② dev 模式 build 链不含资产拷贝（易漏的真坑）**
- `dev = next dev` **不走** `vendor:gsd` 链，纯 `npm run dev` 下 `public/pdf/` 不存在 → PDF worker 404、预览白屏。
- 对策：`copy-doc-assets.js` 做成**幂等**（戳记一致秒退），挂 `predev`/`prebuild` 钩子 + `electron:build` 链 + `electron:dev` 链（四入口）双重保险。

**③ Turbopack/standalone 资产解析不确定性**
- 黄金法则：worker/wasm/字体当静态资源放 `public/`，绝对路径字符串加载，禁 `new URL(...,import.meta.url)`（绕开打包器 worker 资产发射这条不确定路径）。`.mjs` MIME 已实证安全（Next standalone 内置 `send` 映射为 `application/javascript`）。

**④ PPTX 保真度结构性损失（非 bug）**
- 动画/转场全丢、OMML 公式/3D/OLE/演讲者备注不渲染；SmartArt 走 PPT 内嵌 fallback 图；图表用 echarts 重绘。
- **echarts 必须切独立 dynamic chunk**（本仓有体积暴涨前科 commit 37cf768），打包后核对未进主包。
- **必须 try/catch + 渲染失败兜底**（降级到「无法预览/下载/系统应用打开」），单坏文件不能白屏整个面板。

---

## 7. 安全：文档注入 XSS 防护（DOCX 为最大爆炸半径）

文档内容注入 DOM，渲染在 Electron 渲染进程**同源上下文**，能调 localhost API 读写用户文件。对 `docx-preview` 0.3.7 逐 sink 审计，**三项防护缺一不可，前两项强制**：

1. **强制 `renderAltChunks: false`**：默认开启，会把内嵌 HTML 塞进**无 sandbox 的 srcdoc iframe**，同源执行脚本——最大爆炸半径来源。
2. **强制渲染后 `DOMPurify.sanitize`**：`renderSymbol` 的 `elem.char → innerHTML` 是无 option 门控的注入面，且 hyperlink href 可为 `javascript:`；须在 `renderAsync` resolve 之后清洗整树。`dompurify@3.3.3` 已在依赖。
3. **强制·纵深防御**：预览容器套 CSP（`script-src 'none'`）或放进 sandbox iframe（不含 `allow-scripts`）。

PPTX 同理叠 `DOMPurify`（aiden0z 自带协议过滤，但纵深防御仍做）。XLSX 走纯文本喂 `DataTableViewer`，无注入面，安全。

---

## 8. 阶段与验收

| Phase | 内容 | 状态 | 验收标准 |
|-------|------|------|---------|
| **P0** | 基础设施：`copy-doc-assets.js` + `package.json` 脚本挂载 + serve MIME + `.gitignore` + `PreviewPanel` 分发骨架与短路逻辑 | ✅ 已完成 | `npm run vendor:doc-assets` 生成 `public/pdf/{worker,cmaps,standard_fonts,wasm,iccs}`（5 类）+ 幂等；`npm run test` 1542 单测全绿；CDP 实测 worker MIME + 资产可达 + 现有预览无回归 |
| **P1** | MVP：**PDF + XLSX**（易档优先，感知价值最高） | ✅ 已完成 | CDP dev 实测：中文 PDF（2 页/缩放/文本层/工具条）渲染正确无空白、多 sheet xlsx 切换正确（复用 DataTableViewer）、console 零报错；typecheck + 1542 单测全绿 |
| **P2** | **DOCX**（中档，重在 XSS） | ✅ 已完成 | docx-preview 渲染 + 三层防护；CDP 实测正常 docx 渲染正确、恶意 docx 的 `javascript:` href 被 DOMPurify 清除、sandbox 隔离、主文档未注入、正常内容不误伤；typecheck + 1542 单测全绿 |
| **P3** | **PPTX**（难档，管理预期） | ✅ 已完成 | aiden0z 渲染 + echarts 懒加载 + try/catch 兜底 + 差异提示；CDP 实测正常 pptx（标题/要点/表格/多 slide/中文）渲染体面、坏 pptx 显示「无法预览」不白屏、console 零报错；typecheck + 1542 单测全绿 |
| **P4** | 文档：交接 `docs/handover/document-preview.md` + 产品思考 `docs/insights/document-preview.md`（互相反向链接） | 📋 待开始 | 两份文档互链；handover 含 4 渲染器/serve 取字节/离线资产/XSS 防护全貌 |

**总工作量约 8–12 人天**（含测试 + 两份功能文档）。每个 Phase 独立可交付、独立 commit。

---

## 9. 决策日志

- 2026-06-27：多智能体可行性调研（10 agent，含 PDF 离线/PPTX 保真/XSS 三项对抗验证）完成，结论存项目记忆 `doc-preview-feasibility.md`。
- 2026-06-29：核实本仓硬事实——`vendor-gsd-prepare.js` 拷资产脚本范式存在、`electron:build` 链含 `vendor:gsd && vendor:gsd:verify && next build`、`electron-builder.yml:93` public 拷贝规则、`DataTableViewerProps` 的 `rows+header` 复用入口、`useVoiceInput.ts:75` public-worker 范式、`dompurify`/`papaparse` 已在依赖。发现 **dev 链不含 vendor:gsd** 的坑，定 D5 双挂载方案。撰写本执行计划待审。
- 2026-06-29：**P0 执行完成**。装 react-pdf 10.4.1（pin pdfjs-dist 5.4.296）；新建 `scripts/copy-doc-assets.js`（拷 worker/cmaps/standard_fonts/wasm/**iccs** 5 类资产 4.2MB + 版本断言 + `.version` 幂等戳记）；`package.json` 挂 `predev`/`prebuild` + `electron:dev`/`electron:build` 链（四入口全覆盖）；serve 补 4 条 MIME；PreviewPanel 加 `isDocumentPreview` 短路 + `DocumentPlaceholder` 占位分发骨架（**未放开 FileTreePanel，零回归**）。验证：typecheck + 1542 单测全绿；CDP dev 实测 worker=`application/javascript`、中文 cmap/wasm（`openjpeg.wasm`+`qcms_bg.wasm`）/icc/字体全部 200 可达、现有 markdown 预览无回归、console 零报错。新增发现并修正计划：① **iccs 是 pdfjs 5.x 第 5 类资产**（对抗验证只列了 4 类），已纳入拷贝并设 `iccUrl`；② `.version` 戳记是 dot-file，Next 不经 HTTP 服务（无害，仅构建期 fs 读，不影响 worker/cmaps 等非 dot 资产）；③ react-pdf 引入 `@napi-rs/canvas` 全平台子包（Node 端 canvas，浏览器不用）→ **P1 待办：确认它不进前端 bundle/standalone（体积巡检）**。
- 2026-06-29：**P1 执行完成**（PDF + XLSX MVP）。装 xlsx 0.18.5（SheetJS CE，锁 registry 版）；新建 `PdfViewer.tsx`（react-pdf + 5 类资产 URL 含 `iccUrl` + 宽度自适应 + 缩放 + 多页 + serve 取字节）、`XlsxViewer.tsx`（SheetJS 解析 → sheet 切换 tab → `sheet_to_json(header:1)` + 表头唯一化 → 复用 `DataTableViewer`）；PreviewPanel 用 `next/dynamic` 接两个渲染器替换占位、header copy 排除文档；FileTreePanel 放开 pdf/xlsx 拦截（保留 docx/pptx 待 P2/P3，doc/xls/ppt 老格式永久拦截）；i18n 三语加 `docPreview.error/pages/zoomIn/zoomOut`。验证：typecheck + 1542 单测全绿；CDP dev 实测——中文 PDF 2 页渲染清晰无空白（cmaps 生效）、文本层可提取、缩放/页数工具条正常；xlsx 双 sheet（员工名单/销售数据）切换数据正确、复用 DataTableViewer 的导出/斑马纹；两类预览 console 均零报错。**@napi-rs/canvas 巡检结论**：pdfjs `NodeCanvasFactory._createCanvas` 用 `createRequire` 运行时 require（非静态 import），浏览器走 `DOMCanvasFactory` 永不触及，dev 实测无报错佐证 → **不进 client bundle**；standalone 体积（NFT 是否误拷平台二进制）留待正式 `electron:pack` 时一并巡检。
- 2026-06-29：**P2 执行完成**（DOCX）。装 docx-preview 0.3.7（+ jszip 3.10.1 传递依赖）；新建 `DocxViewer.tsx` 三层 XSS 防护：① offscreen 渲染设 `renderAltChunks:false` ② 渲染后 `DOMPurify.sanitize` 清洗正文 ③ 结果（含 docx-preview 生成的 `<style>`）注入 `sandbox=""` iframe srcdoc（图片用 `useBase64URL` 内联,因 sandbox 无 allow-same-origin 时 blob: 不可达）；PreviewPanel `next/dynamic` 接入、FileTreePanel 放开 docx。验证：typecheck + 1542 单测全绿；CDP 实测正常 docx 渲染出标题/正文、恶意 docx（jszip 构造含 `javascript:` 超链接）的 `javascript:` href 被 DOMPurify 清除（srcdoc 不含）、sandbox 隔离、`window.__XSS_FIRED__` 未定义（主文档未注入）、正常文本与链接文字仍渲染（防护不误伤）。
- 2026-06-30：**P3 执行完成**（PPTX）。装 `@aiden0z/pptx-renderer` 1.2.2（deps echarts + jszip；peerDep pdfjs-dist ^5 已由 react-pdf 满足）；新建 `PptxViewer.tsx`：`PptxViewer.open(bytes, container, { fitMode:'contain', zipLimits:RECOMMENDED_ZIP_LIMITS, pdfjs:false, renderMode:'list' })`，echarts 随组件 `next/dynamic` chunk 二级懒加载（不进主 bundle）、try/catch 兜底（坏文件落 error 态不白屏）、顶部固定「排版可能有差异」提示；PreviewPanel 接入、FileTreePanel 放开 pptx（doc/xls/ppt 老格式永久拦截）；i18n 三语加 `docPreview.pptxNotice`。验证：typecheck + 1542 单测全绿；CDP 实测正常 pptx（python-pptx 生成，标题页/要点列表/表格/多 slide 竖排/中文）渲染体面 + 差异提示横幅显示、坏 pptx（非 zip）显示「无法预览」不白屏、console 零报错。**安全决策（与 docx 不同）**：aiden0z 是结构化渲染（解析 OOXML 节点后 DOM API 绘制，无 innerHTML 注入面）+ 自带外链协议过滤 + `zipLimits` 限制 ZIP 解析（DoS 防护），故不叠 DOMPurify/sandbox iframe（会破坏 echarts canvas 与 IntersectionObserver 滚动）。**待巡检**：echarts 进独立 chunk 是 dynamic import 架构保证，正式 `electron:pack` 时与 `@napi-rs/canvas` 一起核对未进主 bundle/standalone 体积。
- 2026-06-29：**顺带修复既有 bug** `src/app/api/files/raw/route.ts`：`Content-Disposition` 直接放 `path.basename`（中文文件名）→ HTTP header 非 latin1 抛 `Cannot convert argument to a ByteString`（中文名文件经 raw 取字节 500）。改用 RFC 5987：ASCII 回退名走 `filename=`、原始 UTF-8 名走 `filename*=UTF-8''<pct>`。此 bug 影响所有中文名文件走 raw 通道（DocxViewer 在 PreviewPanel sessionId 为空时 fallback 到 raw 即命中；PDF/XLSX 同理受益）。serve 路由无 `Content-Disposition`，不受影响。
- 2026-06-29：**测试方法备忘**（非产品问题）：CDP 用 `evaluate` 的 `element.click()` 点文件树时，`textContent.includes(名)` 会先匹配到**文件夹 treeitem**（其 textContent 含所有子文件名），点中只 toggle 展开、不打开预览。应按 textContent 最短匹配选真正的文件 treeitem，或用 CDP 原生 `click(uid)`。

---

## 10. 已知局限 / 不做项 / 技术债

**明确不做（纯前端无解，诚实告知用户）：**
- **.doc / .ppt / .xls 老二进制**（OLE2/CFB / BIFF）：所有 JS 库只吃 OOXML。保留 `NON_PREVIEWABLE` 拦截 + 「请另存为 .docx/.pptx/.xlsx」提示。
- **PPTX 高保真/像素级还原**：动画、SmartArt 完整重建、特效、3D 永远做不到。产品文案禁止承诺「与 PowerPoint 完全一致」。

**不做（与离线+体积约束硬冲突，仅列「未来可选增强」）：**
- **LibreOffice headless 转图/转 PDF**：保真天花板且唯一能吃 .doc/.ppt，但捆绑 ~800MB-1GB+/平台/架构，与体积优化（commit 37cf768）直接冲突。仅「检测到系统已装 LibreOffice 时才启用」，不捆绑、不默认。
- **Univer / Handsontable / Aspose**（高保真表格/在线编辑）：服务端依赖或商业付费，只读预览用不上。

**主动降级（MVP 接受，后置增强 → 记入 tech-debt）：**
- **大文件性能**：react-pdf 几百页、DataTableViewer 几万行均无虚拟化，一次性建 DOM 会卡。MVP 加体积/行数上限（如 PDF/Excel >20-30MB 提示过大），虚拟化后置。
- **DOCX/XLSX 单元格样式与精确版式**：docx-preview 不做视口动态重排；SheetJS CE 不读单元格样式（底色/边框）。要样式需换 xlsx-js-style（已停更 2022），非必要不上。
- **PDF 应用内搜索高亮**：浏览器原生选中 + Ctrl+F 开箱可用；自定义高亮搜索框（`customTextRenderer` + PureComponent 重挂坑）按需排期。
- **react-pdf pin 在 pdfjs-dist 5.x**（未升 6.0.227）：功能/安全补丁略滞后，纳入依赖巡检。
