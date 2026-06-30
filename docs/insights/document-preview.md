# 应用内文档预览（PDF / DOCX / XLSX / PPTX）— 产品思考

> 技术实现见 [docs/handover/document-preview.md](../handover/document-preview.md)
> 执行计划归档于 [docs/exec-plans/completed/document-preview.md](../exec-plans/completed/document-preview.md)

这份文档回答"为什么这样做，而不是其他方式"。技术细节看交接文档；本文只写思路。

---

## 用户问题（项目起点）

AI Native Lab 已经能在文件树里预览代码、Markdown、CSV、图片/音视频。但 AI agent 在工作目录里产出和处理的文件，**有相当一部分是 Office 四件套 + PDF**——agent 写的报告（.docx）、整理的数据表（.xlsx）、生成的演示（.pptx）、下载的资料（.pdf）。

这四类文档此前的体验是**死的**：文件树里点击它们，`NON_PREVIEWABLE` 集合直接 `return`，毫无反应。用户要看内容，得切到系统的 Word / Excel / PowerPoint / 预览器——离开应用、打断心流。这与"代码点开就能看"的预览体验割裂。

**诉求很朴素**：这四类文档之前被主动拦掉，希望像代码预览一样，点开就能在应用内看。

---

## 核心设计决策

### 决策 1：纯前端离线渲染，不做服务端转换

**场景**：四类文档怎么渲染成可视内容？

**备选**：
- (a) **服务端转换** — 捆绑 LibreOffice headless，把文档转成 PDF/图片再回传前端
- (b) **纯前端离线** — 在浏览器侧用 JS 库直接解析 OOXML/PDF 渲染

**选 (b)。三条理由，每条都是硬约束**：

1. **体积**：LibreOffice headless 捆绑 ~800MB-1GB+ / 平台 / 架构。本项目刚因为打包体积暴涨做过专门优化（commit 37cf768 把 release-win 排除出 standalone，避免 macOS 包体积涨 3 倍），再塞个 LibreOffice 与既有体积纪律直接冲突。
2. **隐私**：本项目有一条铁律——**绝不向外发用户数据**。服务端转换若走云服务就违背了；本地转换又回到体积问题。纯前端渲染，用户文件的字节从不离开本机渲染进程。
3. **架构契合**：PreviewPanel 本就是「按扩展名分发渲染器」+ `next/dynamic` 懒加载的结构，加四个渲染器是顺势而为，不是另起炉灶。首屏零增量，安装包增量约 3-6 MB。

**代价**：纯前端库吃不了 `.doc/.ppt/.xls` 老二进制，保真度也有天花板（尤其 PPT）。这两个代价我们选择**诚实承担并明示用户**，而不是为了"全都能看"去背 LibreOffice 的体积包袱。

> LibreOffice 不是永久排除——若未来检测到用户系统已装 LibreOffice，可作为「高保真/吃老格式」的可选增强启用，但**不捆绑、不默认**。

### 决策 2：四类同等优先，但分阶段按"感知价值 ÷ 难度"排序交付

**场景**：四类一起做还是分批？先做哪个？

四类难度和风险差异很大：

| 格式 | 难度 | 风险点 |
|------|------|--------|
| PDF | 易 | 离线资产链（中文 cmaps / JPEG2000 wasm） |
| Excel | 易 | 几乎无（复用现有表格渲染器） |
| Word | 中 | **XSS**（文档内容注入同源 DOM） |
| PowerPoint | 难 | **保真度**（动画/SmartArt 结构性丢失） |

**交付顺序：基础设施(P0) → PDF+Excel(P1) → Word(P2) → PowerPoint(P3)**。理由：

- **PDF+Excel 先行**：最易、感知价值最高。PDF 像素级 + Excel 复用现有 DataTableViewer，能最快让用户摸到"点开就能看"的核心价值，验证整条分发骨架 + 取字节通道。
- **Word 居中**：难点不在渲染（docx-preview 现成），在**安全**。它单独成一个 Phase，是因为 XSS 防护值得独立设计和验证，不能混在 MVP 里赶工。
- **PowerPoint 殿后**：难点不在能不能渲染，在**管理用户预期**。它需要诚实的保真度沟通（见决策 4），放最后让前三类先稳住口碑。

每个 Phase 独立可交付、独立 commit、独立 CDP 验证。

### 决策 3：选型——每类都选"能复用 / 持续维护 / 离线"的那个

技术选型经过多智能体对抗验证（2026-06-27，含 PDF 离线 / PPTX 保真 / XSS 三项专门对抗）。几个关键纠偏：

- **PDF 用 `react-pdf` 而非裸 `pdfjs-dist`**：react-pdf 封装好 worker 生命周期 + 三层渲染（canvas/text/annotation），React 19 原生兼容。`@react-pdf-viewer` 已停维 2023 + 许可风险，排除。
- **Word 用 `docx-preview` 而非 `mammoth`**：mammoth 设计上**丢版式**（适合把正文提取出来喂 LLM），不满足"预览要像原文档"。docx-preview 保留版式接近 Word。
- **Excel 复用 `DataTableViewer`（SheetJS 只做解析）**：DataTableViewer 已有 `rows+header` 预解析入口，职责干净——SheetJS 负责"读出值"，DataTableViewer 负责"画成表"，不重复造表格 UI。
- **PowerPoint 选 `@aiden0z/pptx-renderer` 而非老牌 `PPTXjs`**：PPTXjs 2022 已弃坑（jQuery 栈）；aiden0z 是 2026 年唯一持续迭代的纯前端 PPTX 库，自带协议过滤 + 视觉回归测试。

一条贯穿原则：**能复用现有基础设施就不新造**（Excel 复用表格渲染器、PDF 复用 asr-worklet 的 public-worker 离线模式、DOMPurify 复用已装依赖）。

### 决策 4：诚实的保真度分级，PPT 文案禁止承诺"完全一致"

**场景**：纯前端渲染的保真度参差，怎么对用户表达？

**这是产品诚信问题，不是技术问题。** 我们给四类定了诚实档位：

- **PDF：高**——像素级、可选中、可搜索。用户感知不到与原文件的差异。
- **Excel：中**——值/多 sheet/自动表头够用，但放弃单元格样式（底色/边框）、合并单元格、公式文本。
- **Word：中高**——版式接近 Word，但非像素级。
- **PowerPoint：中**——文字/表格/图片/常规图形体面，但**动画、转场、SmartArt 完整重建、3D、特效、公式、演讲者备注做不到**。

对 PPT 这种保真度天花板明显的格式，我们的处理是：**UI 顶部固定一条"预览 — 排版可能与原文件有差异"的横幅**，主动把预期降下来，而不是让用户自己撞见差异后失望。**产品文案严禁承诺"与 PowerPoint 完全一致"**。

宁可明示局限，也不假装能做到。这与项目在「上下文用量卡片」「文件日志脱敏」等处一以贯之的诚实数据原则一致。

### 决策 5：Word 预览把安全当一等公民

PPT 难在保真，**Word 难在安全**。docx-preview 把文档内容注入 DOM，而预览跑在 Electron 渲染进程的**同源上下文**——能调 localhost API 读写用户文件。一个恶意 `.docx` 的 XSS 爆炸半径，不是"弹个框"，是"读写你硬盘上的文件"。

所以 Word 预览上了**三层强制防护**（关内嵌 HTML iframe + DOMPurify 清洗 + sandbox iframe 隔离），缺一不可。这部分宁可做厚——预览一个文档的便利，不值得用文件系统读写权限去换。

值得一提的是 PPT 反而**不照搬**这三层：aiden0z 是结构化渲染（解析节点后 DOM API 绘制，无 innerHTML 注入面），套 sandbox iframe 反而破坏它的 echarts 图表和滚动懒渲染。安全策略要贴合每个库的实际注入面，而不是一刀切叠防护——叠错了既没收益又砸功能。

---

## 局限与未来方向

**固有局限（接受并明示）**：
- `.doc/.ppt/.xls` 老二进制永远看不了，点击给"请另存为新格式"语义的拦截。
- PPT 高保真无法纯前端实现。
- 大文件（几百页 PDF / 几万行 Excel）无虚拟化会卡——MVP 接受，已记技术债。

**未来可能的方向**：
- **检测到系统已装 LibreOffice 时**启用高保真转换（吃老格式 + 像素级 PPT），不捆绑、不默认——把"体积"和"保真"的矛盾交给用户的本机环境去化解。
- 大文件虚拟化（PDF 按需渲染页、表格行虚拟滚动）。
- PDF 应用内搜索高亮（当前靠浏览器原生 Ctrl+F 兜底）。

**一句话总结这个功能的产品取向**：用最小的体积代价（3-6 MB，首屏零增量）和零隐私让渡（纯本地），把"点开就能看"的预览体验从代码/Markdown 扩展到 Office+PDF；对做不到的部分（老格式、PPT 高保真）诚实明示，而不是背着 LibreOffice 的体积去假装全能。
