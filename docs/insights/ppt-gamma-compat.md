# PPT Gamma 兼容 API：为什么做、为什么这样做

> 技术实现见 [docs/handover/ppt-gamma-compat.md](../handover/ppt-gamma-compat.md) · Gamma 逆向调研见 [docs/research/gamma-reverse-engineering-20261105.md](../research/gamma-reverse-engineering-20261105.md)

## 用户问题

- 用户要求“review gamma.app 并 reverse coding”。Gamma 是闭源的，网页端有 Cloudflare 人机校验，能被完整、合法逆向的只有它**公开的契约**：API、MCP 工具、参数语义和行为说明。这份契约本身就编码了 Gamma 的产品设计：内容如何处理（textMode/amount）、媒体从哪来（10 种 image source、自动 accent 图、URL 转存）、页数是软目标、审阅停顿如何折叠成异步任务。
- 我们的 PPT 引擎只能在应用里点着用。Gamma 已经让脚本、自动化平台（Zapier/Make/n8n）和 Agent 成为一等调用方，Gamma 5 发布后“由 Agent 调用生成 PPT”是增长最快的入口之一。

## 为什么是“兼容 Gamma 的 API”，而不是自造一套

1. **零学习成本**：已有 Gamma 集成的人换个 base URL 就能用；Gamma 文档、示例、轮询代码可以直接复用。
2. **契约已被验证**：Gamma 用 Classic → Gamma 5 两代 API 磨出来的形状（create/poll、进度阶段、具名 warnings、export 链接一周过期）比我们从零设计更稳。
3. **反向检验我们的引擎**：映射每个参数都要回答“引擎真的能做到吗”，答不上来的就是差距清单（见调研 §9）。

## 关键取舍

- **宁可 400，也不假装支持**：Gamma 有 60 种语言、4 种格式、9 种尺寸、PNG 导出；引擎只做得到其中一部分。静默降级会让自动化调用方拿到错误产物还以为成功，所以不能做的直接拒绝，能部分做到的接受并给出具名警告。
- **审阅停顿折叠为失败 + 链接**：我们的引擎在“要点陈述了来源没有的数字”等情况下会停下来等作者。Gamma API 没有“等人”的状态。我们选择返回 failed + 引擎原话 + 打开项目的链接，而不是无限 pending，因为调用方需要一个终态。
- **图片 URL 走 Gamma 的宽松语义**：Gamma 抓不到图就静默跳过；我们的应用内路径把引用图视为必需，会阻断整份稿件。对 API 调用方采用 Gamma 语义（抓取、嵌入、跳过并汇总告知），因为自动化场景里一张失效的图不应让整份稿件失败。
- **默认关闭**：需要显式设置 key 才开启，因为它让本机之外的进程能消耗用户的模型额度。

## 已知局限

- 模型调用依赖桌面端 worker：AIMate 窗口关闭时任务会停在 pending（BYOK 设计本身的约束）。
- 不支持编辑（`/agent/gammas/{id}/edits`）、单独导出任务、PNG、来源 URL/文件上传、多页站点、分析统计。
- 没有设置 key 的界面，暂靠环境变量。
- 图片只能嵌入 ≤512 KB 的 PNG/JPEG（引擎媒体契约），无缩放。

## 未来方向

1. 设置页加 API key 生成/轮换与调用记录。
2. 编辑：把 `edits` 映射到引擎已有的 ai-edit / proposals（一次一页、整组接受/恢复，正是 Gamma 的语义）。
3. MCP server：把同一套 service 暴露为 MCP 工具（`generate`、`get_generation_status`、`read_gamma`），让 Claude/ChatGPT 直接调用。
4. 媒体：accent 图提供器（themeAccent → 图库 → AI 生成）是与 Gamma 最大的媒体差距，见调研 §9。
5. 应用内粘贴路径提供“跳过无法读取的图片”选项，与 API 语义对齐。
