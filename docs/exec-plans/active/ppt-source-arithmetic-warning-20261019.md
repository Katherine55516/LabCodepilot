# PPT 来源数量冲突：从读取失败改为必须确认的来源警告（2026-10-19）

## 问题
在“基于上一版更新”时报错：`原始输入的分组数量矛盾：2\times3\times3 = 18，原文却写 27。请核对并修改输入后重新读取；原文不会被自动更改。`

- 检查本身没错：q 因子模型的 2×3×3 独立分组是 18 个组合，原文（中英文两段）写成了 27。
- 处理方式有四个问题：
  1. 在读取阶段（以及粘贴、文件创建时）用 HTTP 422 直接中止，更新任务无法继续；
  2. 质量门里同一条是 `error`，就算用户确认保留原文，成稿也会被永久拦住；
  3. 表达式原样显示 LaTeX（`2\times3\times3`）；
  4. 中英文两段重复报同一条。

## 改动
- `ppt-source-arithmetic.mjs`：冲突按“表达式 + 声称值”去重；表达式显示为 `2×3×3`。
  - 新增 `withSourceArithmeticWarnings(source)`：把冲突作为**必须确认的来源警告**挂到 `source.mediaWarnings`（`cause: source_inconsistency`）。
  - `inspectSourceArithmetic`：用户确认保留原文后降为 `warning`（披露，不改原文）。
- `ppt-api.mjs`：读取阶段和创建阶段（粘贴、提示词来源）都改为挂警告，不再抛 422。流程沿用 P0-3 的输入就绪机制：大纲照常生成；`/generate` 在警告未处理前返回 409 `source_warnings_unresolved`；用户可以修改输入，也可以确认“保留原文”。
- 前端：
  - `PptM3`（基于上一版更新）第 2、3 步显示来源警告并支持确认，有未处理项时禁用“生成”；
  - `PptSourceWarnings` 对 `source_inconsistency` 显示“保留原文并继续 / 已确认保留原文”；
  - i18n（zh / en / zh-HK）。

## 验证
- 新增 `selftest-ppt-source-arithmetic-warning.mjs`：去重、显示、幂等、原文不变；HTTP 链路 409 → 保留原文 → 解除拦截；质量门降为 warning。
- `selftest-ppt-postmortem-api.mjs` 改为新约定：项目会创建（201），原文不变，第一次模型调用前警告已经存在。用隔离的模拟依赖，不影响后续用例。
