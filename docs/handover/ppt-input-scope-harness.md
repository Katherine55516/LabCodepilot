# PPT input scope harness

2026-10-08。详见 [评估与验收报告](../research/ppt-input-scope-harness-review-20261008.md)。

- 原始 prompt/source 是权威；brief/sourceScope、密度、模板、编辑指令与生成 deck 不是新增事实或主题的授权。
- `ppt-input-scope.mjs` 提供 INPUT_FRAMEWORK、frameworkHash 与同一套范围规则；shared promptPolicy 应用于所有写作路径。`source_plus_explanation` 兼容 API 枚举，但只允许框架内必要解释。
- 所有生产 `normalizeModelReview` 调用必须传入第三个 `project` 参数，严格验证 scopeAudit `{frameworkHash,checkedSlideIds,status}`；四个空 finding 数组不能替代审查。not_evaluated 不能发布。
- Prompt/review rubric v7；框架与 generationPolicy 进入 review/plan key。导入 PPTX 不再跳过审查；真正的内容输入导入保存 importedInputScope，设计模板不成为内容来源。
- `ppt/input-scope-service.mjs` 在 AI 内容/title/data/structure 提案保存前审查；应用时验证 framework + actual changed slides candidate hash。其他页改变不破坏目标页提案的并发语义。纯样式/位置和未变化内容不额外调用模型。
- 原生/普通稿 critic 使用完整可见内容，不能截掉文案尾部或丢弃静态模板残留；图片仅送说明，不能把 base64 塞进文字审查。
- 生成中草稿共用限制 Prompt，最终整稿门禁兜底；没有新增 UI 工作流或 outline 审查阶段。真实模型仍可能误判，后续需要跨输入真实模型评测及完整分批审查。

运行 `node apps/cowork-server/selftest-ppt-input-scope.mjs`；模拟模型必须明确提供 scopeAudit。`ppt-scope-test-helpers.mjs` 仅供自检，不得在生产自动补齐模型审查。

## 2026-10-20 模板优先与局部显示投影

完整管线现在为：全文解析/区间识别 → reader 粗解释组/唯一建议 → 用户 N → 全稿 editorialBlueprint/来源与关系 owner → 大纲授权摘要/表格投影 → 冻结来源实际容量 → 页面并发与独立审查 → 原生发布。auto/explicit 共用 reader，不以字符数覆盖建议；容量失败不改变 N。`production_frozen_source_binding` 可纠正通用估算的假溢出，不能替代 writer 最终排版检查。

表格摘要绑定原始行/列/cell 并独立审查。来源摘要的局部 AI 改写保留原始 source 和 selection，使用服务器拥有的 `sourceSummaryProjection` 节点凭证；外部命令不得伪造。候选手改后新 hash 重验，before/after 快照预览不写入，恢复需校验当前目标及计划，保留无关手改。详见 [实施与验收](../research/ppt-template-first-implementation-acceptance-20261020.md)。

版本预览也有独立请求序号：切换 before/after 立即清除旧图，加载期间没有恢复入口，迟到响应不能覆盖最后选择；项目或 revision 改变即失效。版本 API 使用 view=live，避免恢复带回全部原生图片。`ppt-proposal-versions.spec.ts` 注入 after 迟到响应并检查只恢复 before，顺便验证主字体和中文备用字体分列；真实长输入由 `ppt-template-first-live.spec.ts` 复验同一范围及原生导出。
