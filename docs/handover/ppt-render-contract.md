# PPT 通用渲染契约、输入结构与密度

> 2026-10-08；保持当前产品 workflow。研究依据与证据见 [研究报告第 25–26 节](../research/ppt-alpha-mining-layout-content-gamma-review-20261008.md)。

## 数据流与职责

`source extraction → semantic blocks/inventory → source-density packing → Writer + sourceArtifact bindings → Deck IR → Render Tree contracts → editor/SVG/PPTX → PDF conversion`。

- `ppt-source.mjs` 保存 typed table rows、fenced/pre code 原文/语言；`ppt-semantic.mjs` 对代码保持原子，不在普通 chunk limit 下拆代码；`ppt-content-inventory.mjs` 输出 required CodeBlock/TableBlock/ProcessBlock 等义务。
- `ppt-density-capacity.mjs` 用同一文字测量器估算组件尺寸、表格各列行权重；显式 protected template assets 从可写区域扣除。当前选剩余最大矩形，未实现任意多边形 holes packing。
- `ppt-density-packing.mjs` 对 prose 按来源长度/关系锚点与模式估算，不用固定短摘要 cap；不改用户锁定页数，不重复填充。
- `ppt-source-artifacts.mjs` 原样绑定代码、表格等对象；`ppt-object-integrity.mjs` 审查 required 结构和模板媒体。代码内容/语言逐字，缩进变动即失败；保护媒体不能因省空间而自动排除。
- `ppt/render-contract.mjs` 是 pt 文字 padding/paragraph/runs、signed chart domain/SVG、image crop/fit 的权威；`render-contract-python.mjs` 为 generic/native exporter 复用的 frame/picture 函数。浏览器保留 SVG namespace 后经 DOMPurify 消毒。
- `ppt/render-tree.mjs` 给 generic、保真模板和 external native 项目生成契约；external native slides 保留原页尺寸/段落元数据。图表 SVG 内部先用 pt，再转换为 EMU，避免 Chromium 字体大小限制。
- `ppt/render-audit.mjs` 的容量/数据错误通过 `ppt-quality.mjs` 的确定性审查进入生成、编辑及发布。external publish 的原生过滤名单也保留容量/表格/crop/chart 错误，不能过滤掉可见损失。

## 版本与缓存

`renderContractVersion=1`，旧 Render Tree 的增量重建改为全稿重建，generic PPTX exporter 拒绝复用没有当前合同版本的缓存。不是持久 IR migration，不改变节点 ID；旧项目在重建/审查/导出边界获得规则。

Prompt contract 与 review rubric 均为 6。旧模型 review 不给新规则背书。标准/详细模式都保留机制、条件、证据与关系，双语同 claim 只计一个事实但计两份排版空间。自动容量冲突需要重排/减页/拆页决策，不能重复、删除 required 组件或用极小字号凑合。

## 回归运行

使用当前项目已编译的 SQLite 所对应 Node 版本。此机为 Node 22.22.0；Python 使用已配好的 office runtime。示例：

```sh
PPT_TEST_PYTHON=/path/to/office/python3 node apps/cowork-server/selftest-ppt-render-contract.mjs
PPT_CONTRACT_PDF=1 PPT_CONTRACT_OUTPUT=outputs/ppt-general-render-contract-20261008 node apps/cowork-server/selftest-ppt-render-contract.mjs
npm test
PORT=3017 npm run test:smoke
```

PDF 测试要求 `soffice` 在 PATH，测试文件中有本机 bundled Python fallback；部署验收使用容器 Python，不依赖开发者本机路径。新增 UI 用例读取由生产导出/解析 fixture 产生的 JSON：fixture 更改后同步 `src/__tests__/fixtures/ppt-render-contract.json`。浏览器 fixture API 测试不等于真实 Cowork/model 端到端。

负例包括小框/不可断字符串/单字过宽、native capacity、非法 table weights、丢代码缩进/语言、丢保护媒体、非法 pie/crop。实际 PDF 检查 signed bar 矩形与标签、中文、ASCII 等宽 advances；不要只检查 OOXML data cache。

本机完整结果和截图见 [证据 README](../../outputs/ppt-general-render-contract-20261008/README.md)。

## 注意与后续工作

测量是 conservative prediction，不是 glyph shaping/ink bounds。native 未继承到显式 font 的表格仍需更精细解析；复杂 native masks 的预览可能近似，原生保真输出不因此重建。极长代码保留原文并阻止容量不合格发布，尚未实现带行映射的续页；跨格 HTML 表格有 required warning。PDF OCR、任意流程拓扑、复杂多 series 图表和真实模型 Gamma 内容盲评仍有独立验收。

正确保真路径保留原图遮罩；中文字体覆盖/实际显示已有正面证据。不要把旧 generic route 的错误概括成当前所有 native 模板/中文输出失败。字体/渲染引擎差异需用真实转换检查，结构成功不等于画面完全一致。

## 2026-10-13 图片输入和逐页编辑器

- Prompt/paste/file supplement 共用图片入口，最多 16 个用户附件；服务端来源媒体按 SHA256 去重，并可按附件名解析 Markdown 图片引用。PNG/JPG 也可直接作为源文件。
- 原始 DOCX/Office 媒体、HTML 内嵌 SVG、Excel 原生 chart 的 PDF 预览、PDF 矢量图页面都进入来源图片目录。解码或工具失败记录 required `mediaWarnings`，不能静默跳过；外链/本地引用由附件解析，不执行导入 HTML 的 JS。
- 草稿主画布只有已开始页面；真实页面预览完成后立即填入，后续页面按阅读顺序开始。source/media 校验仍有界并行；模型适配器仍按结构化页返回，不模拟 token 打字。
- SVG 文字和表格采用外层 SVG transform 加正常像素 foreignObject，避免对 HTML layer 放大 9525 倍。生成的 native 文字框使用共享测量预留字形高度；来源 canvas 避开保留的前景图片。
- 单一表格/图片/图表及简短说明在标题下区域居中；手动几何优先。修改要求面板固定标题/按钮，主体和历史可以滚动，并保留需求、用户修改、处理结果和草稿。
- 自动容量续页保留原标题；末页标题按语言为“感谢观看”/“Thanks for watching!”，正文结论保留；可见的备注替代文案进入 writer repair 门禁。
- 页面 topic、章节和眉题按实际输入的主要语言生成，独立于旧正文语言提示；明确的中英平行标题只保留主要语言，正文双语证据、技术名称和人工锁定标题保真。末页使用同一语言决策，生成结束语仍可编辑。
- 文件补充图表的媒体 refs 跟随补充段落的 `S` 编号，避免指向主文件同编号段落。
- Tailwind 类发现和 TypeScript 输入限定于源码，避免将 `.ppt-build` 中的整份应用副本/生成产物当成新的源码扫描。
- Next 16.2.1 的 NFT 全目录 glob 在初始追踪阶段跳过，生成目录也从最终追踪中排除；部署所需 external packages 仍通过显式 includes 保留。构建验收使用临时字体响应，不改变产品字体或提交字体文件。
- 验证入口：`selftest-ppt-input-visuals.mjs`、`ppt-progressive-input.spec.ts`，其余回归和限制见本轮执行计划。
