# PPT Visual Editor 完整性加固

> 创建时间：2026-09-21
> 最后更新：2026-09-21

## 状态

| Phase | 内容 | 状态 | Gate |
|---|---|---|---|
| P0 | 真实预览路由、Command/AI schema、图片大小与像素限制 | ✅ 已完成 | 非法 mutation fail-closed；真实缩略图 URL 可用 |
| P1 | 删除/复制/排序/替换、真实图表表格预览、drag draft、AI scope | ✅ 已完成 | 设计文档 P0 编辑闭环；AI 对象/页面 scope 一致 |
| P2 | 多选、八向缩放、旋转、吸附、对齐、组合、锁定、剪贴板、快捷键、缩放 | ✅ 已完成 | 手动操作全部进入 Command Journal，可撤销/重做 |
| P3 | Theme、AI preview/relayout、三语和响应式 | ✅ 已完成 | 简中/英文/繁中无硬编码主流程；窄窗口可用 |
| P4 | 单测、structured selftest、Playwright、全仓测试、浏览器实测 | ✅ 已完成 | 相关门禁与全仓门禁通过 |

## 决策日志

- 2026-09-21：保留 IR v3、共享 Render Tree、Command Journal 和显式 publish 边界；不引入第二套客户端编辑状态。
- 2026-09-21：所有手动和 AI 修改继续走同一个 command API；服务端按 command type 校验 payload，模型输出按 node type 校验。
- 2026-09-21：图片先在客户端缩放压缩，服务端仍独立检查 MIME、字节、像素和 data URL，不能信任客户端。
- 2026-09-21：浏览器、SVG 缩略图和导出共享 Render Tree；浏览器与 SVG 为 chart/table/image 提供真实语义渲染，不再显示类型占位符。
- 2026-09-21：内部补偿命令不再接受公共 API 直接调用；Undo/Redo 和版本恢复通过显式服务端能力调用。
- 2026-09-21：外部 PPTX 继续采用保守编辑边界，客户端同步关闭会改变原始 package 结构的操作。

## 验收范围

1. 修复缩略图真实路由并增加非 mock 测试。
2. 对 slide/node command、AI patch、图片资产实施有界 schema。
3. 补齐编辑器 P0：选择、移动、缩放、文字、图片替换、删除、复制、页面排序、Undo/Redo、保存。
4. 补齐主要 P1/P2 交互：多选、旋转、吸附/参考线、对齐/分布、组合、锁定、层级、剪贴板、快捷键和缩放。
5. AI 明确区分对象与当前页，先显示建议，再由用户应用；页面重排只返回受限 semantic patch。
6. 所有用户可见文案同步 `zh`、`en`、`zh-HK`，桌面与窄窗口均可操作。
7. 全部编辑进入持久化历史并可跨刷新 Undo/Redo；发布后 PPTX/PDF 使用同一 Render Tree。

## 完成结果

- 编辑器具备连续多页画布、对象级选择和编辑、八向缩放、旋转、吸附、对齐/分布、组合、锁定、层级、复制粘贴、页面增删复制排序、图片替换、图表和表格编辑。
- 手动修改与 AI 建议统一提交到 Command Journal；AI 只返回有界语义 patch，应用前可预览，不能生成坐标、样式、ID 或版本字段。
- 修复 IR v3 删除对象后被规范化逻辑重新创建的问题；Undo/Redo、跨页编辑和 revision 恢复均使用稳定 slide/node ID。
- 浏览器画布、SVG preview、PPTX、PDF 和质量检查消费同一 Render Tree；chart、table、image、rotation 和 opacity 均按同一布局结果渲染。
- 编辑器用户可见主流程已覆盖 `zh`、`en`、`zh-HK`，并在桌面和移动窄窗口完成真实浏览器检查。

## 验证记录

- Cowork PPT 自测：M1、M2、M3、M4、M5、structured 全部通过。
- 单元测试：2803 项，2802 通过，1 项按既有条件跳过，0 失败。
- Playwright PPT Workspace：8/8 通过；全仓 smoke：25/25 通过。
- TypeScript、目标 ESLint 和 `git diff --check` 通过；ESLint 仅保留两个大文件的 `max-lines` 可维护性提示，无功能错误。
- Node 22 production build 通过；现有 `claude-status` 路由对 `@anthropic-ai/claude-agent-sdk` 的 ESM import 警告与 PPT 模块无关。
