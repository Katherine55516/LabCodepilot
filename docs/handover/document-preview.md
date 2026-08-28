# 应用内文档预览（PDF / DOCX / XLSX / PPTX）— 技术交接

> 产品思考见 [docs/insights/document-preview.md](../insights/document-preview.md)
> 执行计划归档于 [docs/exec-plans/completed/document-preview.md](../exec-plans/completed/document-preview.md)

在文件树中点击 `.pdf / .docx / .xlsx / .pptx` 四类文档，像现有代码/Markdown 预览一样，在左侧 PreviewPanel 直接渲染——**纯前端、完全离线、首屏零增量**。本特性不是新造预览体系，而是在既有「按扩展名分发渲染器」的 PreviewPanel 骨架上加一层文档渲染器。分四个 Phase 交付（P0 基础设施 → P1 PDF+Excel → P2 Word → P3 PowerPoint），目标读者：需要独立接手维护这块能力的开发者。

---

## 1. 目录结构

```
scripts/
  copy-doc-assets.js                 # 【新】从 node_modules/pdfjs-dist 拷 5 类浏览器侧静态资产到 public/pdf/

src/
  components/
    editor/
      PdfViewer.tsx                  # 【新】react-pdf 渲染 PDF（worker + 4 类 URL 资产离线化 + 缩放 + 多页）
      XlsxViewer.tsx                 # 【新】SheetJS 解析 → 复用 DataTableViewer 渲染表格（多 sheet 切换）
      DocxViewer.tsx                 # 【新】docx-preview 渲染 + 三层强制 XSS 防护
      PptxViewer.tsx                 # 【新】@aiden0z/pptx-renderer 渲染（echarts 二级懒加载 + 兜底）
      DataTableViewer.tsx            # 【复用，未改】rows+header 预解析入口接 Excel 解析结果
    layout/panels/
      PreviewPanel.tsx               # 【改】4 类扩展集合 + isDocumentPreview 短路 + 4 个 next/dynamic + 渲染分发
      FileTreePanel.tsx              # 【改】NON_PREVIEWABLE 放开 pdf/docx/xlsx/pptx，仅保留 doc/xls/ppt 拦截
  app/api/files/
    serve/route.ts                   # 【改】MIME_TYPES 补 4 条文档 MIME（规范化响应头）
    raw/route.ts                     # 【改·顺带修 bug】Content-Disposition 中文文件名 RFC 5987 编码
  i18n/{en,zh,zh-HK}.ts              # 【改】docPreview.error/pages/zoomIn/zoomOut/pptxNotice

public/pdf/                          # 【构建产物，.gitignore】worker + cmaps/ + standard_fonts/ + wasm/ + iccs/ + .version
package.json                         # 【改】4 个新依赖 + vendor:doc-assets 脚本 + 四入口挂载

docs/
  handover/document-preview.md       # 本文
  insights/document-preview.md       # 产品思考
  exec-plans/completed/document-preview.md  # 归档计划（含 P0-P3 决策日志全文）
```

---

## 2. 架构总览

四点架构契合（均已读源码确认），让这层接入只需「加渲染器」而非改骨架：

1. **PreviewPanel 本就是按扩展名分发的渲染器**——已按扩展名路由到 Sandpack（`.jsx/.tsx`）/ CodeMirror（可编辑文本）/ DataTableViewer（`.csv/.tsv`）/ MediaView（图音视频），每个重型库用 `next/dynamic(ssr:false)` 独立成 chunk。四个文档渲染器照搬此模式。
2. **取二进制字节的通道现成**——`/api/files/serve`（`baseDir` 从会话 DB 记录派生、不信任客户端、>10MB 流式）。客户端 `fetch(fileServeUrl).arrayBuffer()` 喂给渲染库。文档是二进制，**必须走 serve，不能走 `/api/files/preview`**（后者对二进制返回 415 `binary_not_previewable`）。
3. **运行形态天然离线**——生产是 Electron 内跑打包好的 Next standalone server（`http://127.0.0.1:3000`），worker/字体等本地资源由本地服务提供，无需 CDN。PDF 资产复用 `public/asr-worklet.js` 验证过的 public-worker 离线模式。
4. **防护件与表格渲染器已在依赖里**——`dompurify` 已装；`DataTableViewer` 的 `rows+header` 预解析入口（`DataTableViewerProps.rows / .header`）可直接接 Excel 解析结果。

### 渲染器分发表

| 扩展 | 渲染器 | 内核库 | 版本 | 许可证 | 取字节 | 安全策略 |
|------|--------|--------|------|--------|--------|---------|
| `.pdf` | `PdfViewer` | react-pdf（pdfjs-dist） | 10.4.1（pin pdfjs 5.4.296） | MIT + Apache-2.0 | serve→arrayBuffer | 离线资产，无注入面 |
| `.xlsx` | `XlsxViewer` | xlsx（SheetJS CE） | 0.18.5 | Apache-2.0 | serve→arrayBuffer | 纯文本喂表格，无注入面 |
| `.docx` | `DocxViewer` | docx-preview（+ jszip） | 0.3.7 | Apache-2.0 | serve→arrayBuffer | **三层强制 XSS 防护** |
| `.pptx` | `PptxViewer` | @aiden0z/pptx-renderer | 1.2.2 | Apache-2.0 | serve→arrayBuffer | 结构化渲染 + 协议过滤 + zipLimits |

老二进制 `.doc / .ppt / .xls`（OLE2 / BIFF）纯前端无解，仍由 FileTreePanel 的 `NON_PREVIEWABLE` 拦截，不在此列。

---

## 3. 数据流

```
文件树点击 .pdf/.docx/.xlsx/.pptx
  │
  ▼
FileTreePanel.handleFileClick
  └─ ext ∈ NON_PREVIEWABLE? → 仅 doc/xls/ppt 命中并 return；四类新格式放行
  └─ setPreviewFile(path)                    （usePanel 全局 state）
  │
  ▼
PreviewPanel
  ├─ useEffect([filePath]) 顶部短路：
  │     if (!filePath || isMediaPreview || isDocumentPreview) { setLoading(false); return; }
  │     → 文档**不走** /api/files/preview 文本通道（二进制返回 415）
  │
  ├─ fileServeUrl 构造（PreviewPanel.tsx:546-550）：
  │     sessionId 存在 → /api/files/serve?path=&sessionId=   （会话作用域，首选）
  │     否则 fallback   → /api/files/raw?path=               （home 作用域，预会话态）
  │
  └─ 渲染分发（PreviewPanel.tsx:673-682，先于 isDocument 占位与 isMedia）：
        isPdfPreview  → <PdfViewer  fileServeUrl />
        isXlsxPreview → <XlsxViewer fileServeUrl filename />
        isDocxPreview → <DocxViewer fileServeUrl />
        isPptxPreview → <PptxViewer fileServeUrl />
  │
  ▼
各 Viewer（next/dynamic ssr:false，首次点开才拉 chunk）
  └─ fetch(fileServeUrl).arrayBuffer() → new Uint8Array(buf) → 喂内核库渲染
```

**短路与分发的一致性**：`isDocumentPreview()` 同时用于两处——① `useEffect` 顶部短路跳过文本 fetch；② 渲染分发判定。两者用同一组扩展集合（`PDF_/DOCX_/XLSX_/PPTX_EXTENSIONS`），不会出现「短路了但没渲染器」的空窗。Header 的「复制内容」按钮对文档隐藏（`!isMedia && !isDocument`），因为文档没有可复制的文本 `preview.content`；文档也不进 `ViewModeToggle`（无 source/rendered/edit 三态）。

---

## 4. 四类渲染器逐一

### 4.1 PdfViewer（`src/components/editor/PdfViewer.tsx`）

- **库**：react-pdf 10.4.1，内核 pdfjs-dist 5.4.296（React 19 原生兼容）。引入 `react-pdf/dist/Page/TextLayer.css` + `AnnotationLayer.css`，否则文本不可选中、链接错位。
- **离线关键**：模块顶层设 `pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs"`（组件经 `next/dynamic(ssr:false)` 懒加载，模块顶层只在客户端执行，安全）。`getDocument` 透传选项 `PDF_OPTIONS` 是**模块级常量**（否则 `<Document>` 每次 render 重载 PDF）：
  ```
  cMapUrl: "/pdf/cmaps/", cMapPacked: true   ← 中文/日文 CID 字体，缺则整页空白
  standardFontDataUrl: "/pdf/standard_fonts/" ← 14 个 PDF 标准字体回退
  wasmUrl: "/pdf/wasm/"                        ← OpenJPEG/JPEG2000 解码器，含此类图缺则 JpxError
  iccUrl: "/pdf/iccs/"                         ← ICC color profile（pdfjs 5.x），缺则部分 PDF 颜色异常
  ```
- **取字节**：`fetch(fileServeUrl).arrayBuffer()` → `setData(new Uint8Array(buf))`；`file = useMemo(() => data ? {data} : null, [data])` 稳定引用（pdfjs 会消费 data buffer，scale 变化不应触发 Document 重载）。
- **布局**：`ResizeObserver` 测容器宽，页面默认 fit 面板宽（面板可在 320~800 拖动）；缩放 0.5~3、步进 0.25；`Array.from({length:numPages})` 多页竖排，每页传 `width={pageWidth}`。
- **保真度**：高——像素级、文本可选、原生 Ctrl+F 搜索可用。

### 4.2 XlsxViewer（`src/components/editor/XlsxViewer.tsx`）

- **库**：xlsx 0.18.5（SheetJS CE）。解析职责在本组件，**展示职责复用 `DataTableViewer`**（它的 `rows+header` 预解析入口正是为此设计）。
- **流程**：`XLSX.read(new Uint8Array(buf), {type:"array"})` → 多 sheet tab 切换（`workbook.SheetNames`，单 sheet 不显示 tab）→ `XLSX.utils.sheet_to_json(ws, {header:1, defval:"", blankrows:false})` 得二维数组（aoa）→ `normalizeHeader` 把首行规范成唯一非空表头 → `<DataTableViewer key={activeSheet} rows header filename />`。
- **`normalizeHeader` 为什么必须有**：DataTableViewer 用 header 值同时做 React key 和行对象属性 key。Excel 首行常有空单元格或重复列名，直接用会 key 冲突（数据互相覆盖 + React warning）。规则：空 → Excel 列字母（A/B/.../AA），重复 → 加 `(n)` 后缀。`key={activeSheet}` 让切 sheet 时重置 DataTableViewer 的排序状态。
- **保真度**：中——多 sheet 切换 + 计算值 + 自动表头。**放弃**单元格样式（CE 不解析底色/边框）、合并单元格还原、公式文本。要样式需换 `xlsx-js-style`（已停更 2022），非必要不上。
- **体积**：SheetJS 整包 ~300KB，因组件 `next/dynamic` 懒加载，`import 'xlsx'` 落在独立 chunk，不点 Excel 不加载。

### 4.3 DocxViewer（`src/components/editor/DocxViewer.tsx`）— 三层强制 XSS 防护

docx-preview 把文档内容注入 DOM，渲染在 Electron 渲染进程**同源上下文**，能调 localhost API 读写用户文件。对 docx-preview 0.3.7 逐 sink 审计，定下三层防护，缺一不可（详见 §6）：

1. **`renderAltChunks: false`（第一层）**：docx-preview 默认会把文档内嵌的 HTML 片段塞进一个**无 sandbox 的 `<iframe srcdoc>`**，同源执行脚本——最大爆炸半径来源，必须显式关闭。
2. **渲染后 `DOMPurify.sanitize`（第二层）**：docx-preview 产物含 innerHTML 注入面（`renderSymbol` 的 `elem.char`）+ hyperlink href 可为 `javascript:`。渲染完成后整树清洗（默认移除 `<script>` / `on*` 事件 / `javascript:` href，保留 `class`/`style` 属性与 `data:image` 图片）。
3. **sandbox iframe（第三层·纵深防御）**：渲染结果（含 docx-preview 生成的 `<style>`）放进 `<iframe sandbox="" srcDoc>`（无 `allow-scripts` / 无 `allow-same-origin`），即便前两层漏网，脚本也无法执行、无法触达同源 API。

**流程细节**：offscreen 容器（`position:fixed;left:-99999px;width:816px;visibility:hidden`）跑 `renderAsync`（docx-preview 需真实 DOM 做布局度量）→ 取 `offscreen.innerHTML` 过 DOMPurify → 与 styleDiv 的 `<style>` 组装完整 HTML → 注入 sandbox iframe srcDoc，渲染完立即移除 offscreen 节点（effect cleanup 也兜底移除，防中途切文件残留）。`renderAsync` 选项另含 `inWrapper:true / breakPages:true / renderComments:false / renderChanges:false / experimental:false`。**图片用 `useBase64URL:true` 内联**——sandbox 无 `allow-same-origin` 时 `blob:` URL 不可达，必须 base64。
- **保真度**：中高——版式接近 Word，非像素级。

### 4.4 PptxViewer（`src/components/editor/PptxViewer.tsx`）

- **库**：`@aiden0z/pptx-renderer` 1.2.2（2026 年唯一持续迭代的纯前端 PPTX 库，自带协议过滤 + 视觉回归测试）。peerDep `pdfjs-dist ^5` 已由 react-pdf 满足。
- **调用**：`await PptxViewer.open(new Uint8Array(buf), container, { fitMode:"contain", zipLimits:RECOMMENDED_ZIP_LIMITS, pdfjs:false, renderMode:"list" })`。`fitMode:contain` 适配面板宽；`zipLimits` 限制 ZIP 解析资源（DoS 防护）；`pdfjs:false` 关 EMF/pdfjs fallback，SmartArt 走内嵌位图省 worker 配置；`renderMode:list` 所有 slide 竖排滚动。`viewer.destroy()` 在 effect cleanup 调用（teardown 错误吞掉）。
- **echarts 二级懒加载**：echarts（库依赖，~MB 级）随**组件内** `await import("@aiden0z/pptx-renderer")` 进同一 `next/dynamic` chunk，不进主 bundle、不进首屏，只有首次开 pptx 才拉取（本仓有体积暴涨前科 commit 37cf768，故格外谨慎）。
- **兜底**：整段 try/catch，坏文件/误传 `.ppt` 老格式 → `status:"error"` 显示「无法预览」，**绝不白屏整个面板**。顶部固定一条 `docPreview.pptxNotice`（「排版可能与原文件有差异」）横幅管理预期，仅 `status:"ready"` 时显示。
- **保真度**：中——文本/表格/图片/常规图形体面，图表 echarts 重绘；动画/转场、OMML 公式、阴影/3D、OLE 对象、演讲者备注不渲染，SmartArt 走 PPT 内嵌 fallback 位图。

---

## 5. PDF 离线资产管线（`scripts/copy-doc-assets.js`）

PDF 是四类里唯一需要外部静态资产的格式。脚本从 `node_modules/pdfjs-dist` 拷 **5 类**浏览器侧资产到 `public/pdf/`：

| 资产 | 来源 | 缺失后果 |
|------|------|---------|
| `pdf.worker.min.mjs` | `build/` 单文件 | worker 版本须 == `pdfjs.version`，否则运行时报 `API version does not match Worker version` |
| `cmaps/` | 目录 | 中文/日文 PDF 整页空白（**命门**） |
| `standard_fonts/` | 目录 | 14 个 PDF 标准字体无回退 |
| `wasm/` | 目录 | 含 JPEG2000 图的 PDF 抛 `JpxError` 并发非法网络请求 |
| `iccs/` | 目录 | 部分 PDF 颜色异常（pdfjs 5.x 新增 ICC color profile） |

> ⚠️ 对抗验证最初只列了 4 类资产，**`iccs/` 是 P0 执行中实测发现的 pdfjs 5.x 第 5 类**，已纳入拷贝并在 PdfViewer 设 `iccUrl`。

- **版本同源保证**：拷的就是当前 `node_modules/pdfjs-dist`，worker 与 `pdfjs.version` 天然同源，不会版本不匹配。
- **幂等**：写 `public/pdf/.version` 戳记，再次运行若戳记 == `pdfjs.version` 且 worker 已就位则秒退；升级 react-pdf/pdfjs-dist 后版本变化自动触发重拷（全量 `rmSync` 重建，避免旧版本残留）。
- **断言**：`REQUIRED_AFTER = [pdf.worker.min.mjs, cmaps, wasm]` 拷后缺失即 `process.exit(1)`；`standard_fonts/iccs` 容缺（老版本可能未提供，仅 warn）。
- **为什么用 public 绝对路径而非 `new URL(..., import.meta.url)`**：本项目 `next build` 走 Turbopack + `output:'standalone'`。Turbopack 对 worker/wasm asset 的发射不可靠，且 standalone 的 NFT tracing 跟不到浏览器侧资源。把资产当普通静态文件放 `public/`、绝对路径字符串加载，是与 `public/asr-worklet.js` 同一套已验证的离线模式。`electron-builder.yml` 的 `public/ → standalone/public/` 规则会把 `public/pdf/` 随包带走，**零打包配置改动**。

### 脚本挂载（四入口全覆盖）

```jsonc
// package.json scripts
"predev":  "node scripts/copy-doc-assets.js",   // npm run dev 前自动跑
"prebuild":"node scripts/copy-doc-assets.js",   // next build 前自动跑
"vendor:doc-assets": "node scripts/copy-doc-assets.js",
"electron:dev":  "npm run vendor:doc-assets && concurrently -k \"next dev\" ...",
"electron:build":"npm run vendor:ailab && npm run vendor:ailab:verify && npm run vendor:doc-assets && next build && ...",
```

> **易漏的真坑**：`dev = next dev` 是直接命令，npm 的 `predev` 钩子能覆盖 `npm run dev`，但 `electron:dev` 里内嵌的 `next dev` **不触发 `predev`**——所以 `electron:dev` 链开头显式 `npm run vendor:doc-assets`。四入口（predev / prebuild / electron:dev / electron:build）双重保险，加上幂等秒退，纯 `npm run dev` 不会出现 `public/pdf/` 缺失导致 worker 404、PDF 白屏。

---

## 6. 安全设计对比（三档防护强度）

文档内容渲染在 Electron 渲染进程同源上下文，能访问 localhost API 读写用户文件。三类渲染器按注入面大小采用不同强度：

| 渲染器 | 注入面 | 防护 |
|--------|--------|------|
| **DocxViewer** | 大（innerHTML 注入 + `javascript:` href + 内嵌 HTML iframe） | **三层强制**：`renderAltChunks:false` + 渲染后 `DOMPurify.sanitize` + `sandbox=""` iframe |
| **PptxViewer** | 小（结构化渲染，解析 OOXML 节点后 DOM API 绘制，无 innerHTML 注入面） | 库自带外链协议过滤（`javascript:`/`data:`）+ `zipLimits` DoS 防护；**不叠 DOMPurify/sandbox iframe** |
| **PdfViewer / XlsxViewer** | 无 | PDF 资产离线化无外部加载；Excel 走纯文本喂 DataTableViewer，无注入面 |

**为什么 PPTX 安全策略与 DOCX 不同**：aiden0z 不走 innerHTML，没有 DOCX 那种注入面；而套 DOMPurify/sandbox iframe 反而会**破坏 echarts canvas 与 IntersectionObserver 滚动**（aiden0z 用它做 slide 懒渲染）。所以 PPTX 不照搬 DOCX 的三层防护，转而依赖库的结构化渲染本质 + 协议过滤 + ZIP 资源上限。这是经过权衡的差异化决策，不是遗漏。

---

## 7. 顺带修复：raw 路由中文文件名 bug（`src/app/api/files/raw/route.ts`）

P2 发现并修复的**既有 bug**：`Content-Disposition` header 的 filename 必须是 latin1（ByteString），中文等非 ASCII 文件名直接放进 header 会抛 `Cannot convert argument to a ByteString`——**所有中文名文件走 raw 通道都 500**。修复用 RFC 5987：

```
inline; filename="<ascii 回退名>"; filename*=UTF-8''<pct-encoded 原始名>
```

ASCII 回退名把非 `\x20-\x7E` 字符替成 `_`、去掉 `"\`。此 bug 影响所有中文名文件走 raw 通道——DocxViewer 在 PreviewPanel `sessionId` 为空时 fallback 到 raw 即命中；PDF/XLSX 同理受益。serve 路由无 `Content-Disposition`，不受影响。

---

## 8. 已知局限 / 待办 / 技术债

**明确不做（纯前端无解，诚实告知用户）**：
- `.doc / .ppt / .xls` 老二进制（OLE2/CFB / BIFF）：所有 JS 库只吃 OOXML，保留 `NON_PREVIEWABLE` 拦截。
- PPTX 高保真/像素级还原：动画、SmartArt 完整重建、特效、3D 永远做不到。

**主动降级（MVP 接受，后置增强 → 已记 tech-debt）**：
- **大文件性能**：react-pdf 几百页、DataTableViewer 几万行均无虚拟化，一次性建 DOM 会卡。虚拟化后置。
- **DOCX/XLSX 单元格样式与精确版式**：docx-preview 不做视口动态重排；SheetJS CE 不读单元格样式。
- **PDF 应用内搜索高亮**：浏览器原生选中 + Ctrl+F 开箱可用；自定义高亮搜索框按需排期。
- **react-pdf pin 在 pdfjs-dist 5.x**（未升 6.x）：纳入依赖巡检。

**待巡检（正式 `electron:pack` 时一并核对）**：
- **`@napi-rs/canvas` 不进 client bundle**：react-pdf 引入此全平台子包（Node 端 canvas）。已确认 pdfjs `NodeCanvasFactory._createCanvas` 用 `createRequire` 运行时 require（非静态 import），浏览器走 `DOMCanvasFactory` 永不触及，dev 实测无报错佐证 → 不进 client bundle；standalone NFT 是否误拷平台二进制留待 `electron:pack` 巡检。
- **echarts 进独立 chunk**：dynamic import 架构保证，正式打包时核对未进主 bundle。

**测试缺口**：文档预览**缺自动化 e2e**（二进制文档难造稳定 fixture），现用 chrome-devtools MCP（CDP）手动验证——中文 PDF/双 sheet xlsx/正常+恶意 docx/正常+坏 pptx 全部 dev 实测过，`npm run test`（typecheck + 1542 单测）全绿。

**CDP 测试备忘**（非产品问题）：CDP 用 `evaluate` 的 `element.click()` 点文件树时，`textContent.includes(名)` 会先匹配到**文件夹 treeitem**（其 textContent 含所有子文件名），点中只 toggle 展开、不打开预览。应按 textContent 最短匹配选真正的文件 treeitem，或用 CDP 原生 `click(uid)`。
