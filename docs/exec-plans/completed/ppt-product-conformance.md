# PPT 产品流程与交互补齐

> 创建时间：2026-09-20
> 最后更新：2026-09-20

## 目标

在完整保留 Cowork 执行、服务端项目持久化、Run/DAG/Event、SSE、IR v3、共享 Render Tree、Command Journal、质量门禁、版本快照、外部 PPTX 保守编辑和真实 PPTX/PDF 导出的前提下，把 `requirements.md` 与 `prototype.html` 中的产品流程和交互补齐到正式实现。

## 状态

| Phase | 内容 | 状态 | 验收重点 |
|---|---|---|---|
| P0 | 前端模块边界与单一编辑器 | ✅ 已完成 | 移除双编辑器；统一 draft/publish/history 状态 |
| P1 | Workspace、内部确认框、Task Center | ✅ 已完成 | 导入/模板/任务入口、配额、任务状态与重试 |
| P2 | Prompt/Paste/Import 创建向导 | ✅ 已完成 | Chooser、分步输入、大纲、模板/模型/页数确认 |
| P3 | Update 三步向导 | ✅ 已完成 | 上一版+进展、设置、大纲+模板预览 |
| P4 | Progressive generation UI | ✅ 已完成 | SSE 真状态、page rail、canvas、后台、空白页 |
| P5 | Template Center 与项目治理细节 | ✅ 已完成 | 严格分类、sticky、上传/删除/预览内部弹窗 |
| P6 | 连续画布和完整编辑交互 | ✅ 已完成 | 缩略图、连续页、格式/布局/媒体/AI/版本恢复 |
| P7 | i18n、响应式、无障碍、反馈 | ✅ 已完成 | 三语、键盘、焦点、桌面 CDP 与 390px Playwright |
| P8 | 回归、构建与文档 | ✅ 已完成 | PPT 自测、全仓测试、PPT smoke、CDP、webpack build |

## 不变量

1. Cowork 服务端仍是跨设备唯一事实源；前端不创建本地项目副本。
2. 不回退为浏览器定时器模拟任务；所有进度由 snapshot + SSE + 持久事件产生。
3. LLM 不输出页面坐标；IR、布局、质量检查和导出继续由确定性代码控制。
4. Web 画布、预览、PPTX/PDF 和 QA 继续消费 Render Tree；兼容旧项目时只允许显式 fallback。
5. 编辑继续使用服务端命令、乐观 revision、持久 Undo/Redo 和 revision snapshot。
6. `.doc/.xls` 只有存在可靠 Cowork 转换器时才接收；在此之前显示明确转换提示，不伪装支持。

## 实施拆分

### P0/P1

- 把 Project、Slide、Task、Outline 类型移入 PPT 领域类型文件。
- Workspace 二级导航补齐最近、全部、收藏、模板、任务、文件夹、回收站及配额。
- 所有删除、清空、未保存退出和模板删除改为 AIMate 内部对话框。
- 新增 Task Center，直接消费 Project/Run 状态；支持打开、转入前台、取消和重试。
- 完成项目只挂载一套编辑器。

### P2/P3

- 新建 Chooser 与 Prompt/Paste/Import 页面式向导。
- Prompt chips、页数识别、建议页数和 `-/+` 调整。
- Paste 保留图片输入，提供读取状态、来源失效提示和层级大纲编辑。
- Import 提供文件/补充内容双栏与统一 Review 页。
- Update 严格按 Source → Template/LLM/Pages → Outline/Preview 排列。

### P4

- generation monitor 使用 Run snapshot、事件 replay 与 project nodes 构建逐步 Page Rail。
- 画布展示已完成页和当前真实节点；不伪造模型 token 流。
- 增加显式转入后台；空白页通过真实 command/API 写入，不只改前端动画。

### P5/P6

- 模板分类对齐需求，保留现有生产模板并映射到严格产品分类。
- 上传、删除、预览采用内部 modal；预览包含说明、标签和使用入口。
- 单一编辑器实现连续页面、缩略图 Grid/List、搜索定位、格式、语义版式、真实媒体块、对象 AI、Presentation、Export chooser。
- 接入 revision list/restore、冲突 reload、Saved/Unsaved 和三选项退出保护。

### P7/P8

- 同步 `en.ts`、`zh.ts`、`zh-HK.ts`。
- 桌面 CDP 与 390px 手机视口验证；键盘、焦点与响应式布局检查。
- 运行 PPT 全部服务端自测、`npm run test`、PPT Playwright smoke、CDP console/screenshot、`next build --webpack`。

## 决策日志

- 2026-09-20：用户要求保留全部超出原型的后端能力，只补产品功能、流程、生成过程和交互。
- 2026-09-20：生成过程展示真实节点完成顺序；因为内容页是有界并行 DAG，不伪造“模型严格串行”的事实。视觉上按完成事件渐进出现，并明确并行状态。
- 2026-09-20：现有九类生产版式继续保留；原型四种布局作为快捷视图映射，不删除质量门禁使用的语义版式。
- 2026-09-20：实际可用模型目录继续作为模型选择事实源，不恢复原型硬编码模型列表。

## 完成记录

- 2026-09-20：P0–P8 全部完成；生产后端能力保持不变，前端产品流统一到 Cowork 项目、Run 和对象级编辑模型。
- 2026-09-20：Node 22 全仓门禁通过：2799 passed、0 failed、1 skipped；PPT 服务端自测 6/6、PPT Playwright 8/8、TypeScript 和 webpack production build 通过。
- 2026-09-20：桌面浏览器实测新建、粘贴文本和图片入口；390px Playwright 视口无横向溢出且图片入口可见。刷新后无新增运行时错误，未登录环境只出现预期的 PPT API 401。
- 2026-09-20：生产构建仍报告既有 `src/app/api/claude-status/route.ts` ESM import warning，不影响构建，也不属于 PPT 模块。
