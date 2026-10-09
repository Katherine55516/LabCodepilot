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
