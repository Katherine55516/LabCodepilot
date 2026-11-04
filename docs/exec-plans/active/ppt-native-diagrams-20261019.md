# PPT 原生图形组件 M1/M2（2026-10-19）

> 方案与根因：`ppt-gamma-results-20261013/PPT_Media_Component_Diversity_Plan_20261019.md`、`PPT_Native_Diagrams_and_Remaining_Root_Causes_20261019.md`

## 范围
新增分层图、流程箭头、卡片网格、指标卡、环形图五种原生组件；识别出的来源结构自动转换成这些组件，并证明原文每个单元格都在图里。

## 改动
| 文件 | 内容 |
|---|---|
| `lib/ppt-diagram-cards.mjs`（新） | `chooseTableDiagram`、`tableDiagramComponent`（附 `sourceRows`）、`diagramCardPlan`（1–4 列；最低 14pt；指标卡数值自适应放大；分层图层名行内）、`flowConnectors`（只连同一行）、`diagramCoverage` |
| `ppt-density-capacity.mjs` | 表格来源默认转为图形（`tableRepresentation==='table'` 或 ASCII 图投影表时除外）；图形列表不再拆成单条要点；测量走 `diagramCardPlan` |
| `ppt-source-artifacts.mjs` | 写入 `pointLayout`（variant / headingFontSizePt / inlineHeading / accent）；含图形的组合放不下时自动改用原表格；流程卡片带主色 |
| `ppt-presentation-policy.mjs` | `full_source` 合同标记 `tableRepresentation: 'table'` |
| `ppt-process-cards.mjs` | 列间距 0.32 英寸，给箭头留空间 |
| `ppt/render-tree.mjs` | 图形卡片按最终尺寸重新排版；流程卡片加 `variant: flow` 和连接关系 |
| `ppt/render-contract.mjs` | `doughnut` 的数据合同 + SVG（圆环 + 换行图例） |
| `ppt-render.mjs` | PPTX：环形图；色带、卡片、指标卡样式；行内层名（字体按文字切分后重新加粗）；原生箭头连接线，命名为 `AIMate decor:` 且不计入实例 |
| `ppt-export-integrity.mjs` | 导出清单的卡片富文本与行内层名、放大数字一致 |
| `ppt-object-integrity.mjs` | 表格来源同时认可图形节点的覆盖证明 |
| `ppt/exporters/preview.mjs`、`src/components/ppt/canvas/PptCanvas.tsx`、`types.ts` | 预览和画布：样式、行内层名、指标卡字号、箭头（SVG 带命名空间） |

## 验证
- `selftest-ppt-native-diagrams.mjs`（新）；完整 selftest、PPT 单元测试、typecheck 与同基线的改动前版本对比（结果见补丁说明）。
- 离线重放知识库 41 页：含表格的页面 25 → 7，含图形的页面 0 → 25；完整性 0 个问题；PPTX 结构校验通过（本机没有 soffice，可见性检查未运行）。
