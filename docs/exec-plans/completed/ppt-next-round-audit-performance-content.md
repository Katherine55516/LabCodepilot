# PPT 下一轮审计、性能与内容完整性

> 创建时间：2026-10-03
> 最后更新：2026-10-03

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| 0 | 源码工作流、历史问题、Gamma 同源对照、Before 基线 | 已完成 | 38项登记；原文为真值，冻结Before |
| 1 | 模板分层限制、安全校验、预注册 IR、缓存 | 已完成 | 原始12MB模板实跑；managed与安全边界自检 |
| 2 | Source Inventory、Coverage v2、结构保留、merge/split、完整性 QA | 已完成 | 5张源表完整；研究/商业/架构/稀疏输入回归 |
| 3 | Trace、关键路径优化、Cold/Warm 多场景 benchmark | 已完成 | 七入口与10页各cold/warm×3；22页fresh×3 |
| 4 | 回归、最终 PPTX 渲染、文档、diff review、commit | 实现与本地PPT验收完成 | 全应用19条Chat/Search失败、真实模型/远端验证未完成；不push |

## 决策日志

- 2026-10-03：用户显式要求依照 `codex_prompt_ppt_next_round_with_gamma_content_benchmark.md` 完整实施与提交。现有工作区的 5 个 PPT 源码修改属于上一轮同源测试修复，纳入本轮回归和提交；其他未跟踪历史产物不混入提交。
- 2026-10-03：保留所有创建、页数控制、编辑和发布产品行为。性能数据区分模拟模型的本机引擎时间与真实模型/远端沙箱时间，不据模拟值宣称达到 Gamma 实际端到端性能。
- 2026-10-03：Gamma 是参考产物，用户原文是内容覆盖事实源。原生模板保持字号；结构保留依靠 typed blocks / IR 与确定性布局，不缩小字号掩盖不足。

## 详细设计

阅读当前 UI/API/Run/DAG/IR/来源规划/模板/渲染/质量/编辑/恢复代码，逐入口建立状态与转移矩阵。冻结当前 22 页 Factor Zoo、Gamma 对照、代表性 fixtures 和基线数据。基于 trace 实测确定瓶颈后实施 versioned bounded caches、server-managed template pre-ingestion、安全限制与 binary-reference 上传链。内容侧建立可复用 Inventory 和 Coverage Map v2，保留 table/equation/process/checklist/summary，按 presentation question、role、关系和 layout capacity 决定 merge/split，并加入 underfill/fragmentation/end-section QA。

验收包括附件 DoD、所有 PPT selftests、跨域结构回归、七类入口每项至少三轮 cold/warm benchmark、模板边界与恶意包测试、前端真实运行/CDP 验证、全仓 `npm run test`，以及最终 22 页样例渲染与完整性比较。环境不可用项目须报告为未验证，禁止伪造完成。

## 最终证据与未满足项

- 详见 [审计](../../research/ppt_next_round_audit.md)、[性能](../../research/ppt_performance_benchmark.md)、[变更/迁移/回归](../../research/ppt_changes.md)。
- PPT selftests 25/25；npm run test 2808通过/1跳过；smoke33；PPT UI16（14专项+2模板复用）与真实开发态CDP通过。22页原始模板真实导出并渲染全部页面，保留29条确定性警告。
- 全仓E2E52通过/112跳过/19失败（Chat/Search），未独立确认Before，因此不声称满足“Regression全通过”。本轮PPT实现完成，跨模块与生产环境未验收项进入tech-debt-tracker。
- 提交范围为PPT相关代码、测试、三份要求文档、索引、交接与规范化证据；历史无关outputs/开发日志不混入。
