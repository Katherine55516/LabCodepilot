# PPT hard-rule remediation

> 创建/更新：2026-10-08。依据 `docs/research/ppt-hard-rules-vs-gamma-current-audit-20261008.md` 第11–17节。

## 状态

| Phase | 内容 | 状态 | 验收 |
|---|---|---|---|
| A | 发布路径统一策略、locked/背景 collision | 核心完成 | generic/native同硬错误矩阵；合法叠放通过 |
| B | 对象实例导出合同与reopening核验 | 核心完成 | 6份负向文件拒绝；真实生产导出正例 |
| C | mandatory完整义务、Prompt/critic/local apply | 核心完成 | 不截断尾部条件；未知/过期/未完成审查阻断 |
| D | 媒体角色与可核验处置 | 核心完成 | prose不能冒充diagram；自动适配不伪装批准 |
| E | 实际成品可见检查、版本失效和全路径回归 | 核心完成 | 真实PPTX/PDF、所有PPT自检、npm test |

## 决策日志

- 保留当前工作区前轮未提交改动；在现有checkout实施，不重置历史证据。
- 不改变用户workflow，不自动commit/push；新增内部合同和检查进入既有DAG、proposal和publish。
- 生产门禁使用真实快照/版本；模拟critic仅用于确定性测试隔离，不能当真实语义准确率。
- 优先解决五项P0；任何仍未支持的复杂渲染/模型能力明确记录，不用passed掩盖。

## 实施与验收

1. 研究反例保留；正式自检改为拒绝损坏稿，并补生产正例。
2. 发布不删issues；规则在检测处准确判断applicability。
3. 实例合同由Render Tree和可见canonical对象共同构建，generic/native输出映射重开文件核对。
4. 完整义务的source/hash、计划/候选/review版本一并失效；局部改写不得删除mandatory。
5. 媒体等价/自动适配/用户批准分开；source/brand/diagram/unknown占位和来源义务贯通。
6. 真实PPTX/PDF和必要UI验证、全部PPT backend selftests和npm test；记录skip及实际引擎。

## 结果

本轮核心实施和本地验证完成，详见 [交接](../../handover/ppt-hard-rule-remediation.md) 与 [产物](../../../outputs/ppt-hard-rule-remediation-20261008/README.md)：新增25组hard rules测试，6份实际损坏PPTX拒绝，32个PPT脚本全部exit 0，npm test 2808 pass/0 fail/1 skip。generic/native真实PPTX和LibreOffice PDF、7页图片人工复核通过。diff检查通过。

测试发现并修复原生负柱方向（invertIfNegative）、表/清单/摘要字体盒高度、timeline编号、合法chart workbook安全兼容和模板cache消费者版本不一致。版本升级：Prompt/rubric8，render/manifest/verifier/disposition2，obligation1，parser pptx-ir-4。

本轮未修改前端组件、不改变用户workflow、未commit/push。真实LLM、Windows/PowerPoint、部署镜像、任意复杂遮挡/diagram拓扑/复杂chart、token-aware长输入分区尚未验收或实现，记录到tech-debt-tracker；不是本轮通过项。旧稿保留，新证书不沿用旧版本；不可核验时阻断。
