# PPT 五点改进交接

## 范围与入口

用户要求：页数可调、精炼且可局部修复的大纲、原模板字体和基本编辑、多选底栏、DL/Gamma 对照，随后 QuantPilot + Mood Board 真模型测试。

先写的方案：[五点改进方案](../exec-plans/active/ppt-five-point-improvements-20261012.md)。实测比较：[DL/Gamma](../research/ppt-five-point-gamma-comparison-20261013.md)。所有本轮产物位于 `outputs/ppt-five-point-improvements-20261012/`。附件中的文字仅作为数据。

## 实现要点

- `PptCreateWizard`：数值输入、加减、手动优先、恢复估算、失效请求 token；不要让迟到估算覆盖手调。
- `PptWorkspace`：真实 bulk API 的底部多选栏、过滤后清理陈旧选择、busy 状态、失败原因弹窗；每次失败自动打开一次，关闭后轮询不会反复弹出。
- `PptInspector` / render contract / native exporter：保留未编辑对象的每个 run 字体、字号、粗斜体；显式对象级样式编辑应用全部目标 run，保留其他文本结构。支持自定义字体、模板字体、小数字号和撤销。
- `ppt-native-text-fit`：保持字体和字号，利用邻居未占用区域扩展文字框；只有实际安全空白才允许向上移动。真实 PDF 字形检查仍有效。
- `ppt-global-outline-plan`、outline delta 系列：全局核心消息/来源账本；短页重复检查；真正不重叠的表格续页允许同主题；metadata、选择、归属、关系和容量修复均限制范围，V2 不回退重写整个大纲。
- `ppt-language-pair-audit`：显式单语 overview/notes 下，对相邻同节结构化中英清单做独立双向完整等价审查；正面且原文 hash 仍匹配才可显示目标语言一次，原文完整进备注。负面、过期、未审查不允许去重。
- `ppt-quality` / `ppt-review-schema`：审查 ID 平铺，后端仍检查精确绑定与每项一次；独立页面批次最多并行 2 个并保留检查点。错误的 claim 证据引用只重审诊断到的 checks，其他 findings/义务冻结，语义失败仍阻止发布。
- `ppt-desktop-model-worker` / `ppt-error`：鉴权、限流、网络、超时、输出截断、HTTP 400 格式问题等安全原因；不向 UI 泄露密钥或完整上游响应。

## 已有证据

- `full-tests-final-complete.log`：最新 `npm run test`，2,887 tests / 709 suites，2,886 pass，0 fail，1 skip。
- `scoped-review-test.log`：完整 report-transactions 专项通过，包括局部引用修复仍保留 unsupported、其他审查不被重写。
- `user-controls-final.log`：字体/字号、真实续页、短稿重复、局部修复、邻居阻挡和语言对正/负/过期检查通过。
- `fonts/native-font-fidelity.json`：Deal Review 107 runs / Mood Board 67 runs，默认往返文字、字体、字号差异 0；显式 Georgia、字号与粗斜体修改往返验证。
- `ui/result.json`：实际 CDP + 生产 API 的页数、多选移动/删除/恢复、移动端底栏、字体字号及撤销通过；使用合成 UI 项目，不冒充模型生成。
- `ui/failure-result.json`：真实失败项目自动弹窗、中文安全原因、Escape 后不再次弹出通过。
- `ui/dl-transport-result.json`：最后 DL 真实 transport 失败在更新后的服务中自动显示原因，Escape 后轮询不重新弹出，浏览器错误为 0。
- `smoke-isolated.log`：原先受开发构建干扰的 6 个流程在隔离源码环境全部通过。完整 50 项首轮 48 通过（`smoke-final-isolated.log`）；插件冷启动及失败弹窗测试同步后，另 2 项在 `smoke-final-synced.log` 全部通过。不能写成一次完整运行 50/50。

## 真模型项目与验收边界

模型 qwen3.8-max，现有本地 BYOK；没有模拟生成结果或降低门槛。

| 项目 | ID | 当前已知证据 |
|---|---|---|
| QuantPilot + Mood Board | `d9d26df0325d2525ddb02445df255c8b` | 30 页；两轮局部修复后 quality_blocked；修复后候选导出通过，未发布 |
| DL 37 页基线 + Deal Review | `4faf702f8e6344a748fd3becd4e8e4fb` | 原生候选通过，重复/语义问题未验收；已暂停，作为对照保留 |
| DL 清单配对修正版 | `03e25aa63a65f3fbae41909bb8e49f1a` | 7 组清单审查通过；29 页大纲通过、正文完成；局部 critic 遇 502 / transport，failed，未发布 |

`diagnostic-candidate.pptx` 和 `candidate-render/candidate.pdf` 是明确标注的未发布诊断稿。候选文件可导出，不等于整稿内容合格。所有 10 页 Gamma、37 页 DL 基线和 30 页 QuantPilot 候选已实际渲染查看，问题写入对照报告。

## 运行与隔离

本轮使用后端 3150 / 前端 3151，独立账户 `ppt-five-point-20261012`。不要停止用户原有 3140/3141 或其他构建。`serve.mjs` 使用真实生产 API、原生 parser/exporter，只替换本地文件 IO。状态在 `live/state`、工作文件在 `live/workspace`。

同目录多个开发构建导致生成路由损坏和偶发 404/水合不一致后，前端改用 `runtime-source/` 的本轮源码快照及独立 `.next`。快照仅供运行，不替代仓库源文件。`drive-production.mjs` 直接调用未替换的 `executeDesktopModelJob`，连接同一生产后端，避免 Next 编译打断模型；通过真实 lease、模型调用和 complete 协议，绝不注入伪造结果。浏览器交互验证单独保留。

如后续恢复，先读各项目 `result.json` / `project-latest.json` 和 `production-driver.log` 确认实时状态，不依据本交接中间状态宣称完成。所有修复优先复用生产 retry 检查点；最终必须确认 `status=completed`、真实 `publishedRevision`、quality 和导出验证，才能交付正式 PPTX/PDF。

没有提交、推送、合并或修改默认分支；当前隔离目录本就有其他未提交工作，不可一键重置或整目录提交。

## 收尾状态与最新证据

本轮有界生产 driver 已退出，无后台模型生成。3150/3151 服务保留供查看检查点，最后加载目录短标签编译修复和不可见数学运算符的 PDF 字形计数修复。两项分别通过真实失败响应回放和实际 29 页重新导出验证，不声称之前模型调用已使用最后版本。

最新文件在 `dl-final-v2/diagnostic-candidate.pptx`、`quantpilot-after-repair/diagnostic-candidate.pptx` 及各自 PDF。29 页与修复后的 30 页均全部渲染查看。DL 的表格删减、公式纵横比/对比及尾部顺序，QuantPilot 的条件/关系缺失与空白收束页，均未宣称解决。

完整测试 2,886 pass / 0 fail / 1 skip；最后的小修复另跑 user-controls 专项及实际导出通过。smoke 是首轮 48 + 剩余 2 复查通过。`code-verification-manifest.json` 记录最终源与运行快照哈希。

控件、保真编辑和批量操作已验证；大纲规划/局部修复机制已实现，DL 29 页通过现有门槛。真实模型整稿尚未可靠达标，因此整体“稳定生成合格 PPT”未完全完成。不得把诊断导出改名为正式成品或关闭质量门禁。
