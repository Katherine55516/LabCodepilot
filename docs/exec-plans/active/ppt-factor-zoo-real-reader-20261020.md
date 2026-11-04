# Factor Zoo / Process Improvement 真实 Qwen 验收与读取阻塞修复

用户要求：完整 04_factor_zoo_overview.md、指定 Process Improvement 原生模板、slides/qwen3.8-max 真实生成后评审；保留 3141。本计划仅修复本轮实际阻塞，不扩展为全面重构，不跳过硬门禁。

## 已观察证据

- real API probe 返回 success/actualModel=qwen3.8-max。
- 原模板有真实封面，但带描述段落，角色判断要求 body=0，创建报 template_role_unavailable:cover。已加紧凑且主标题显著的封面规则，保留指标内容页负例。
- Qwen 拒绝 obligationSchema.uniqueItems，已移除 wire 提示，服务端两组 ID 仍检查唯一。
- 182 单元、41,415 字符全文；读取首轮133,437字符prompt/44,229实际输入token。10页候选失败于引用偏移、参与者缺证据、supportRoles不全。整份修复发生8192token截断，末轮14页仍失败。
- 原文自身存在2×3×3与27组合矛盾；不能把原文错误当成系统改写成果，也不能静默改原件。

## 执行顺序

1. 保留每轮真实响应、原文/模板hash、错误及usage；增加两处已修复的领域回归。
2. 给模型完整的按ID定位的来源单元；不要求LLM自行计数字符。只对同一原始单元中唯一出现的逐字引用派生UTF-16位置；不模糊匹配、不补造证据、不移除参与者。raw response保持原样。
3. 读取合同修复支持 obligation evidence、group supportRoles、relation evidence 的明确路径delta；页数、分组ownership及正确字段冻结。缺失参与者的引用必须由真实模型返回，不能由代码伪造。
4. 首轮提示明确可选关系注释不要冗余，必要条件合同须逐参与者引用；严格来源/模板/页数规则不变。现有有界8192输出不先盲目扩大。
5. 域回归通过后在同一3143真实重测完整输入。若仍失败，保留明确失败诊断，不能标成成功或绕过正式导出。
6. 若正式发布，核对实际PPTX/PDF并逐页评审，生成研究报告，清楚区分代码验收、模型语义质量及来源问题。原始读取排查单轮未要求commit；后续本轮延续请求已明确授权全部验收通过后commit，仍不push。

## 验收

- 唯一原文quote偏移可修；重复quote没有有效显式定位仍拒绝；拼写变化/未知ID/缺参与者/重复ID仍拒绝。
- 证据delta不得更改reader推荐N、ownership、关系参与者，正确字段保持。
- 服务端真实读取、outline、writer、critic、native export全部使用Qwen；任何gate失败不可伪装成功。

## 本轮终态

读取阻塞修复完成，相关领域回归及npm3024通过/1跳过/0失败。真实Qwen新读取10页建议、仅reason字段delta后通过。随后10页及主动调整到12页的同项目大纲均有9页容量阻断；writer未启动、publishedRevision=0，无本轮正式PPTX。更多API重试不能解决selection/ownership膨胀：10页原始61个页面owners，ledger163个可见，编译最终168个，0 summaryText/summaryGraph。下一轮结构性方案已列入研究报告P0/P1；不在本轮静默扩大实施范围或绕过导出门禁。计划留active表示整稿验收目标仍未完成，而不是报告已成功。

## 2026-10-21 续跑状态（未通过）

在 outline-first 新流程（`9d6ae8f1` + 7 项真实阻塞修复）下重新真实运行同源同模板：读取、逻辑大纲、容量分配与逐页物化已通过，后续修复/审查链仍失败，无正式 PPTX/PDF。详见 [编辑取舍与容量闭环计划](ppt-factor-zoo-editorial-ownership-capacity-20261020.md) 末节。本计划的整稿真实验收目标**仍未达成**，保持 active。
