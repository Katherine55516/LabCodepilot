# PPT 模板确认、生成修改与单页 AI 优化架构接入

> 创建时间：2026-09-29
> 完成时间：2026-09-30（本地实现与回归；真实模型/远端/打包验收边界见交接）
> 需求依据：工作区 requirements.md 第 84–89 节、prototype.html

## 状态

| Phase | 内容 | 状态 |
|---|---|---|
| P0 | Proposal 持久身份/版本/证据校验，命令成功反馈，定向撤回 | 已完成 |
| P1 | 共用模板确认主区域/侧栏、更新页数保留、实际前后预览 | 已完成 |
| P2 | 固定 scope、持久 EditIntent、页级 epoch 与生成写入协调、恢复 | 已完成 |
| P3 | UI 接入、国际化、静态检查和浏览器交互核对、交接 | 已完成 |

## 决策日志

- 复用 IR v3、Run/DAG/Event、Repository、Command Journal、共享 Render Tree，不新增顶层 DAG 阶段或平行服务。
- 模型调用在队列外，短提交在项目队列内；过期 epoch 不提交。
- remaining 固定打开时 pending AI 页集合，排除 running 和 manualBlank；页码只用于显示。
- Proposal 绑定目标 hash 与 source/plan；确认失败保留输入；定向撤回绑定 operationId。
- 页数与原生模板能力边界延续当前规则。
- 保留既有 research/outputs 改动；本次不推送或发版。

## 实施与核对

1. 先补候选与写入安全，再接入生成/局部优化交互。
2. 共用模板组件保留入口步骤，保真 PPTX 编辑维持独立。
3. 优化继承 evidence/contract，候选与画布/导出共用 renderer。
4. 核对取消/迟到请求、固定范围、完成草稿、幂等、冲突、撤回及发布版本。
5. 更新交接和索引，如实记录真实模型/远端环境验收边界。

## 验证结果

- `npm run test`：2806 passed / 1 skipped / 0 failed；`npm run test:smoke`：28 passed。
- 新增生成修改/候选服务自检通过：并行 epoch、固定范围、幂等、目标冲突、图表数据保护、部分失败与仅重试失败页、恢复复用候选、JSONL 尾记录、旧 revision 模板兼容、发布失败保留旧产物。
- 额外 16 项 PPT 历史自检：12 通过；4 项在未改动 HEAD 副本同样失败，记录到 tech-debt-tracker，不降低 QA 门禁放行。
- CDP 8 项真实前端交互检查、桌面/移动截图、0 console/page exceptions；无 chrome-devtools MCP，使用 connectOverCDP 替代。模型与远端桥接采用测试适配，验收边界如实记录。
- 交接：`../../handover/ppt-edit-intent-proposal-architecture.md`；证据：`../../../outputs/ppt-edit-intent-proposal-verification-20260930/summary.json`。

## 接入时修复

- QA 内层 sourceText 与外层同名导致暂时性死区，实际完整检查崩溃。
- 候选与正式提交的原生标题映射不一致；现在共享 finalizeDeck。
- 兼容保存绕过 command journal、丢失并发 metadata；现在统一提交与独立发布产物。
- 定向撤回可能撤错其他页；增加 operationId 和目标冲突检查。
- Prompt/更新入口只用前端估算；改为服务端来源/内容规划，并保留人工预算。
- 生成旧 epoch、迟到取消结果、队列末尾提交唤醒、旧版模板 revision/PDF 快照兼容均补保护。

## 后续环境验收

真实模型内容质量、远端 Cowork HTTP/容器导出、Electron 打包态与 Windows 尚未执行；跨进程事务、跨设备未提交草稿和记录/产物清理另行治理。
