# PPT 通用文本、媒体与输入结构契约

> 创建/更新：2026-10-08

## 状态

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 补充研究报告、多输入根因与验收矩阵 | 已完成（本轮范围） |
| 1 | 序列化文本/图片/图表契约，预览、编辑器和导出消费同一规则 | 已完成（本轮范围） |
| 2 | CSV/XLSX/HTML 表格、Markdown/HTML 代码及流程关系保留 | 已完成（本轮范围） |
| 3 | 内容深度 prompts、容量估算、可见损失发布门禁 | 已完成（本轮范围） |
| 4 | 多语言/多领域生产路径测试、实际导出与浏览器回归 | 已完成（本轮范围） |

## 决策日志

- 不修改新建、模型选择、模板选择、确认大纲等 workflow。
- 新增 optional Render Tree contract，旧项目重建时生成；IR text kind 承载 codeBlock，不另建不兼容 schema。
- 保真导出保留原生图片遮罩与字体，不能用 generic exporter 覆盖正确的 native 路由。
- Gamma 为具名密度参考；不固定页数、最低字数，不用重复补密度。
- 可见丢失阻止发布；解析/测量是确定性预测，实际 Office 与真实 LLM 未验证时明确记录。

## 详细设计与验收

统一 point 单位的内边距、段落、软换行与硬换行；图片 crop/contain/cover 与 signed chart domain 在服务端计算并序列化。质量检查消费同一契约，检测固定框越界、长单词、表格单元格和非法图表。代码保留空白与语言，表格保留空单元格、负号、单位；源对象完整性逐字核对代码。规划按独立义务与实际容量分配，所有 required 结构必须可见。

测试输入包含短业务简报、长研究文、双语、CSV/XLSX、带空白代码 Markdown/HTML、混合符号图表、极端宽高图片、表格与有序流程。运行生产 Python 导出/解包校验与 LibreOffice PDF；UI 启动 dev + 浏览器验证，运行 unit/typecheck 与 smoke。保持当前历史产物和运行缓存，不进行未经要求的提交/推送。

## 完成与验收记录

本轮实现跨输入的渲染/结构基础，保留 workflow。报告第 26 节逐项列出实现接缝、测试和未完成项；交接见 `docs/handover/ppt-render-contract.md`，证据见 `outputs/ppt-general-render-contract-20261008/README.md`。

- text/runs/padding/wrap、signed chart、image fit/crop 在 Render Tree 序列化；native external 按真实尺寸/段落，旧缓存在重建/导出边界更新。
- CSV/XLSX/HTML 矩阵、fenced/pre 代码、有序流程结构，required objects/保护媒体；source-adaptive 深度容量与合同 v6。
- 生成/编辑/发布共同阻断容量/数据错误；external publish 不过滤可见损失。
- `npm test`：typecheck + 2808 pass / 1 skipped；smoke 38/38；16 个相关后端脚本通过；生产 PPTX 重开/LibreOffice PDF、中文与 signed bars、ASCII 等宽、CDP 桌面/移动与 4:3 UI 回归。
- 无 chrome-devtools MCP，补做真实 Chromium connectOverCDP；API/model 为测试 fixture，非在线端到端。

范围之外的实际 glyph shaping/ink bounds、超长代码续页、native table 继承样式、复杂拓扑/图表、真实模型 Gamma 多领域盲评仍按报告优先级独立验收，不因本计划完成而标成已实现。未提交/推送；用户已有历史输出与缓存保留。
