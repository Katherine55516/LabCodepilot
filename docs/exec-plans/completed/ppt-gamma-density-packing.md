# Gamma 密度参照与动态页数规划

> 创建/更新：2026-10-06

## 状态

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 基于密度调研核对估算/规划/写作/布局/QA链路 | 已完成 |
| 1 | 可复用Density Profile、来源统一、语义分组与容量估算 | 已完成 |
| 2 | auto/explicit边界、动态outline与prompt契约 | 已完成 |
| 3 | 组合结构、可见密度与碎页QA | 已完成 |
| 4 | 跨领域/输入/模式/显式数量回归及导出验证 | 已完成 |

## 决策与范围

- 依据 `docs/research/ppt-gamma-density-page-estimation-review-20261006.md`，Gamma参照配置适用于所有主题，不写Factor Zoo分支，不固定10页。
- 章节保留为来源定位，移除逐章至少一页。按实际计划展示内容、结构、语言与模板有效容量组合。
- 输入粗估可校准；手调/明确页数/已确认大纲保持数量。现有产品workflow步骤、来源约束、原生导入、模板风格保持。
- 自动outline在既有调用内返回groupPlan，代码校验和有界packing后冻结，最终写作仍使用既定页数。QA只对尚未确认规划建议修复，不静默改变用户确认后的页数。
- 复用现有字体测量和布局设施，不引入依赖。不以字符数补造事实，不缩字/截断以换密度。
- 实现与测试在当前仓库；本轮不push、不发版。模拟测试与真实模型效果分开报告。

## 验收

- 相同来源在合法Prompt/Paste/File入口得到同一容量逻辑；标准/详细进入估算。
- 小章节可合并，公式/表格完整结构与来源refs仍在；改变heading不造成逐章页面下限。
- auto规划可以从初估校准，explicit/outline/import数量保持；文件解析不被粗估锁死。
- 组合结构实际测量可拟合，QA测量真正可见内容并提供可行merge候选。
- PPT专用回归、全仓typecheck/单元测试；涉及前端交互则启动应用并做CDP/浏览器实测与smoke。

## 实施与验收

- 完成共享 Gamma 密度参照、来源统一投影、标准/详细、实际候选分组、自动syllabus页数校准和确认后冻结。
- 来源结构/解释共享自然高度拟合；修复原生解释导出遗漏、表头颜色与编辑器表格字体/权重不一致；可见密度和可行合并候选进入原有QA。
- planning7、prompt contract3、review rubric3；不修改prototype或其他模块工作流，不引入依赖。
- 全仓typecheck/单测2809（2808通过、1跳过）；既有22组PPT自检通过，新增密度自检21场景；PPT浏览器19项通过，含真实CDP与390×500滚动。
- 模拟模型、真实Python导出，读取PPTX核验单元格与解释；LibreOffice实际渲染核验。真实模型/远端容器/桌面PowerPoint尚未验收，不宣称Factor Zoo已重生成10页。
- 初估仍为投影、模板快速接口仍在原生解析前使用默认画布、有界packing不是全局最优；详见交接的测量边界。
- 交接：[ppt-gamma-density-packing.md](../../handover/ppt-gamma-density-packing.md)。本轮没有commit、push或发版。
