# PPT Workspace M3 交接

## 新版项目与旧版不变量

`POST /ppt/updates` 创建**新项目**。Workspace 旧版须已完成且属于同一 uid；创建时深拷贝其 deck/outline，写入 `update.baseSnapshot`，并记录 `version={rootId,parentId,number}`。上传旧版则保存原始文件为项目的 `base` 输入，没有父项目。新进展可为 Prompt、Paste 或 File；文件原始字节分别保存在 `inputs/<projectId>-base.bin` 与 `-progress.bin`，解析在新项目 Cowork 容器内执行。旧版 JSON/PPTX 从不被更新流程改写。向导给每次提交分配 `requestId`；同账号重复提交完全相同的输入会返回原项目，复用同一 key 提交不同输入会被拒绝。

新版状态继续复用 M1/M2 的 `ingesting → outlining → outline_ready → generating → completed` 工作流和恢复入口。更新规划提示词只给旧版快照与新进展，模型输出页级 `baseSlideId/change/refs`；`normalizeOutline` 验证旧页 ID、唯一映射、来源编号和页数。保留页必须保持原标题与主张，否则降为改写。用户在大纲页能检查差异、编辑映射/章节/标题/主张、增删页并预览选中模板。`diffSummary` 给出保留/改写/新增/移除数量及移除页列表。

生成阶段把 `keep` 页的旧 deck 内容复制为已完成节点（`attempts=0`）；`rewrite/add` 页才调用无工具模型。整个新 deck 按冻结模板 palette 在新项目容器中渲染，旧项目仍可独立打开/导出。父子版本通过 `GET /ppt/projects/:id/versions` 查询。删除上传模板不会影响已有项目的 `templateSpec` 快照。

## 模板兼容性

内置模板有五种类别，均为确定性 palette 布局。个人模板上传接受 `.pptx/.potx/.pdf`、单文件最大 8 MB；`ppt-template.mjs` 在临时 Cowork 容器中检查 ZIP 解包大小/路径、读取页数与示例文本。PPTX/POTX 只有在能稳定提取背景色与强调色时才标记 `mapped` 并允许使用；其他文件（含 PDF）标记 `reference`，只供查看。分析器同时覆盖普通 `slide.background` 和图片化背景：它以有界缩略图恢复主背景与强调色。若导出的模板没有标题 placeholder，则以大字号 run 推断实际标题字体；字体映射优先读取真实文本 run 的 `a:ea`，避免错误回退到未使用的 theme 默认字体。英文始终写入模板的 `a:latin`，简体中文沿用真实文本的 `a:ea`，繁体中文使用模板 `Hant` 字体槽位并写入 `zh-TW`；内置模板提供对应的 Noto CJK TC 槽位。**映射只提取设计色与字体，不承诺重用源模板的任意几何、形状、母版、背景 artwork 或动画。** 项目保存 palette 快照，PPTX/PDF 渲染器读取同一快照。内置模板置顶偏好与个人上传模板分别按 uid 保存。

## 文件地图与验证

- `apps/cowork-server/lib/ppt-api.mjs`：更新创建、版本列表、差异校验、节点复用、模板 API。
- `apps/cowork-server/lib/ppt-template.mjs`：内置模板与容器内兼容性分析。
- `apps/cowork-server/lib/ppt-store.mjs`：版本输入文件、个人模板、模板置顶偏好的原子存储。
- `apps/cowork-server/lib/ppt-render.mjs`、`ppt-pdf.mjs`：冻结 palette 渲染。
- `src/components/ppt/PptM3.tsx`：模板中心、上传、三步更新；`PptWorkspace.tsx`：版本大纲、差异和模板预览。
- `apps/cowork-server/selftest-ppt-m3.mjs`：跨账号、不可用模板拦截、旧版不变、节点复用、双文件解析、真实 PPTX 分析/渲染。

本机验证涵盖 M1/M2/M3 服务端自测、PPT 定向 Playwright 4 条、桌面与窄屏截图。真实远端控制面此前仍对 PPT 路由返回 404；本机无 Docker，无法证明容器内模板分析、跨设备同步、实际 PDF 导出、重启恢复或安装包行为。部署后需按执行计划做这些验收。
