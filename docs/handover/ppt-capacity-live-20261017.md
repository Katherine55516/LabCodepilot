# 大纲容量诊断与逐页流式预览

2026-10-17，本聊天代码实现完成；用户要求今天暂停验收，不能据此宣称已全部通过。工作树application-local-run17。

## 根因与修复

自动遍历所有模板原页被当成内容硬合同，导致模型正常返回仍报capacity_invalid。可选版式无法适配时记录警告，用户固定对象仍必须保留，真实来源/字号/页数的限制不放松；旧v1合同也不例外。project-view保留outlineCorrections给前端。

诊断优先使用本地capacity/schema/coverage原因，模型调用信息仅可展开作上下文。编译成功的候选仍可有blocking来源对象容量问题，此时不能显示“无需修正”或直接生成。编辑候选后重新送服务端校验。

逐页画布以slide.id保持挂载，整稿revision变化不能重建所有画布。真实节点状态、后端阶段或当前run/epoch的draft才证明开始；预绑定模板不证明。无renderTree的首屏也走真实draft。

SSE与HTTP快照可能乱序；同job选择高seq，不同job比较updatedAt。epoch从编辑账本或node回退。writer JSON的文字从未闭合、字符串闭合到完整对象保持连续，清除已进入block的重复typing，保留全文前缀；不以计时动画模拟进度。

## 验收边界

原10页项目c0b…真实重试解除模板覆盖误报，但7页原始对象仍超容量。sourceSHA bc57ec…/N10保留，未强行生成。截图见本轮outputs。

完整Gamma源SHA4719e…的新23页项目b842…由correction负责真实审查、导出及全部页面验收。本聊天在3193独立前端实例验证。跨聊天协调已获用户授权；共同提交由correction负责，不整树夹带无关临时文件，不自动push。

最终日志、文件哈希和参考patch：outputs/ppt-capacity-live-20261017/。handoff-scope.json列共享文件；补丁含既有整合内容，仅供核对，不能盲目应用。

## 历史前端验证（不代表最终整合验收）

Chrome全PPT界面62/62通过，随后新增wizard恢复红例精确复现；sourceSignature变化时清analyzedProject后5/5定向通过。类型检查exit0在单行修复之前，最终共同type/unit仍须覆盖提交源码。扩展lint0error/18既有warnings，最后两文件lint0error/1既有warning。correction随后报告v11生产构建exit0且sourceUnchanged；standalone实际运行、最新后端与产物一致性、整稿真实LLM及导出仍未验证，不能据本聊天UI结果宣称整体通过。

## 今日收尾与下次工作

用户最新要求：仅完成代码，不再做真实验收、Playwright/浏览器测试、基准测试、导出检查，也不启动测试服务。已通知 `correction` 和 `gh testing`；本聊天3193已停止。最后最小相关单元测试 `ppt-capacity-live.test.ts` 2/2通过，0失败，没有追加全量测试。

下次按[执行计划](../exec-plans/active/ppt-capacity-live-20261017.md)的待验证清单继续：原10页大纲与容量门禁、最终整合源码的真实流式/暂停恢复/UI、完整Gamma内容与密度、production/standalone实际运行、导出及基准、必要的冻结源码全量回归。原项目的7个真实容量阻塞仍未取得正向通过；暂停中的23页旧稿不证明新修复已生效。共享fit候选的后端代码收尾由correction负责。

历史62项UI与随后5项定向结果分别保留，不混写为最后源码的同一次全量通过。用户随后授权先提交今天已完成代码，并在提交说明列明未验证项；共享工作树由correction统一执行一次提交，避免并发index修改。本次不push，也不追加真实验收或启动测试服务。
