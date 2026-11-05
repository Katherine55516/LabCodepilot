# Decks：按 Gamma 逆向报告复刻的卡片式演示模块（下一版本备用）

> 分支：`claude/decks-gamma-replica`（worktree `.ppt-build/decks-replica`）· 依据：[Gamma 逆向报告集](../../research/gamma-reverse/README.md)
> 交接：[handover/decks.md](../../handover/decks.md) · 产品：[insights/decks.md](../../insights/decks.md)

## 目标

在现有应用里新增一个独立模块 **Decks**（路由 `/decks`），按逆向报告复刻 Gamma 的：
- 架构：文档模型 File → Card → Block、异步任务与阶段进度、媒体托管、导出渲染。
- 功能与工作流：输入 → 设置 → 可编辑大纲 → 逐卡生成（queued / writing / imaging / checking / polishing / done）→ 编辑 → 演示 / 导出。
- 内容处理：textMode generate / condense / preserve、文字量、语气、受众、输出语言、`\n---\n` 切卡、卡片数软目标。
- 媒体处理：图片来源（AI 生成 / 主题装饰图 / 占位 / 仅输入图 / 无图）、装饰图位置（无 / 左 / 右 / 上 / 背景）、输入图片 URL 抓取并本地托管、抓不到静默跳过并汇总告知。
- 前端界面：列表、创建、设置、大纲审阅（合并 / 增删 / 排序 / 逐卡指令）、生成流、编辑器（缩略图栏、卡片画布、版式面板、按范围的 AI 编辑与前后对比 / 恢复）、演示模式、导出。

**不复刻**：Gamma 的名称、Logo、视觉识别（界面用本仓库的设计体系，主题与装饰图为原创）；Gamma 闭源，实现按公开行为重写，不涉及其代码。

## 与现有 `/ppt` 的关系

完全并行、互不修改。`/ppt` 走 cowork 远程引擎 + 桌面模型 worker；Decks 在本机 Next 服务内运行，用用户已配置的服务商（`generateTextFromProvider` / `generateSingleImage`），数据存本机 SQLite，因此本地 dev 无需登录即可完整验证（另有确定性 mock 模型用于测试）。

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| Phase 0 | 契约：类型、主题、DB 表、API 形状、执行计划 | ✅ 已完成 | |
| Phase 1 | 引擎：输入解释、大纲、逐卡构建、媒体、检查/打磨、AI 编辑与版本、任务运行器、模型适配（真实 + mock） | ✅ 已完成 | 另加停止、撤回排队指令、失败重试 |
| Phase 2 | API 路由（只导出 handler）、导出 PPTX（pptxgenjs）/ PNG zip / 打印 PDF、媒体服务 | ✅ 已完成 | |
| Phase 3 | 前端：列表、创建、大纲、生成流、编辑器、演示、导出；导航入口；i18n | ✅ 已完成 | 导航入口在“办公”标签，与 /ppt 同位 |
| Phase 4 | 单测、`npm run test`、dev server（非默认端口 + mock 模型）CDP 截图桌面/移动、控制台无报错 | ✅ 已完成 | 记录见交接文档 §8；真实服务商端到端未跑（无凭据） |
| Phase 5 | 第二轮细化：推荐版式、元素检查器、logo 图片、Plan/Express、文件导入、Gamma 兼容 API 指向 Decks | ✅ 已完成 | 见交接文档 §8b |
| Phase 6 | MCP 工具、PDF 导入、真实服务商验收 | 📋 待开始 | 技术债务 #36 |

## 决策日志

- 2026-11-05：模块名 Decks，独立路由与库目录 `src/lib/decks/`、`src/components/decks/`，不改 `/ppt`。
- 2026-11-05：本机运行而非 cowork 远程：可在本地 dev 完整验证、无桌面 worker 依赖（Gamma 的模型在服务端运行，这里对应本机 Next 服务端）。
- 2026-11-05：块模型自定义 JSON（非 ProseMirror 文档）：Gamma 的编辑器基于 ProseMirror，但其内部 schema 不可见（报告 01 🔴）；自定义块类型可直接映射到 PPTX 原生对象。
- 2026-11-05：装饰图用原创 SVG 生成（按主题色与种子），不使用 Gamma 素材或第三方图库，避免授权问题；AI 生成走应用已有图片生成器。
- 2026-11-05：导出：PPTX 用 `pptxgenjs@4.0.1`（MIT），PNG zip 用 `jszip@3.10.1` + 已有 `html-to-image`，PDF 走浏览器打印样式。
- 2026-11-05：pptxgenjs 4.0.1 的两个问题在写出后修补 zip：混排段落重复的 pPr（非法 OOXML）与 Node 下 SVG 回退图损坏（换成主题色渐变 PNG）。
- 2026-11-05：补上 Gamma 有而初版缺的三项：停止生成（保留已完成卡片）、撤回排队指令、失败重试。
- 2026-11-05（第二轮）：导入意图采用 Gamma 的“提示词决定”模式，但做成三选一（原样 / 换主题 / 精简），比自由文本更可预期；兼容 API 的生成一律走 Express，因为 Gamma API 没有审阅停顿。
- 2026-11-05（第二轮）：卡片编号导出为 PowerPoint 原生页码字段（而非文本框），在 PowerPoint 中可以自动重排，再导入时也能被识别和跳过。

## 详细设计

见交接文档 [handover/decks.md](../../handover/decks.md)。
