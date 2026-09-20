# PPT Workspace M2 交接

## 数据流

`/ppt` UI → Next `/api/ppt/[...segments]` 账号校验与透传 → Cowork 控制面 `handlePpt` → 按 uid 的项目/文件夹 JSON → 项目独立 Cowork 容器。

三种输入均形成项目：Prompt 直接进入大纲节点；Paste 由服务端确定性分段，编辑原文会清空旧大纲与节点；File 先校验大小、类型、签名并保存原始字节，`ingesting` 节点在容器中运行无模型解析脚本，成功后进入大纲。任务状态与原始文件均在服务端持久化，`recoverPptJobs` 可恢复解析、大纲或逐页生成。

来源段保存 `id/location/text`。大纲保存章节、标题、主张和最多十个有效来源编号；逐页内容节点按引用拿有界摘录，模型只返回受 schema 限制的标题/要点。HTML 忽略脚本与样式；Office ZIP 检查解包大小与路径；无可抽取文本时报错。支持 `.md/.markdown/.html/.htm/.docx/.pdf/.xlsx/.pptx`，拒绝旧 `.doc/.xls`。

## 项目管理与导出

- 项目及文件夹按 uid 隔离，项目上限 50 个活跃项。文件夹 CRUD、收藏、置顶、标签、搜索/排序/筛选、复制、批量移动、回收站、恢复和永久删除在服务端执行。永久删除同时清理项目 JSON、原始上传文件和 Cowork 项目卷。
- 列表 API 只给首张幻灯片、大纲首项和精简来源；详情 API 返回完整 IR。UI 需要完整数据时必须 GET 单个项目。
- PDF 由 `ppt-pdf.mjs` 在项目 Cowork 容器内从当前 deck IR 确定性渲染，缓存键为项目 `revision`；内容编辑会清掉 PDF 缓存标记。成功文件以受账号保护的流下载。演示视图由同一 deck IR 构建，支持 Esc 和箭头翻页。

## 文件地图

- `apps/cowork-server/lib/ppt-source.mjs`：格式校验、粘贴归一化和容器内解析脚本。
- `apps/cowork-server/lib/ppt-api.mjs`：工作流、项目/文件夹 API、批量与导出。
- `apps/cowork-server/lib/ppt-store.mjs`：原子项目 JSON、文件夹 JSON 和原始文件存储。
- `apps/cowork-server/lib/ppt-pdf.mjs`：容器内 PDF 渲染。
- `src/app/api/ppt/[...segments]/route.ts`：桌面账号守卫和远端代理。
- `src/components/ppt/PptWorkspace.tsx`：三种输入、大纲、项目库、演示 UI。
- `apps/cowork-server/selftest-ppt-m2.mjs`、`src/__tests__/e2e/ppt-workspace.spec.ts`：本地 API、格式和浏览器流程验证。

## 验证与待办

本地 `node apps/cowork-server/selftest-ppt-m2.mjs`、PPT Playwright 3 条与全仓 `npm run test` 通过。测试样本的 DOCX、PDF、XLSX、PPTX 均由 Python 真实生成并被解析器读取。当前宿主 Python 无 `matplotlib`，PDF 文件内容测试被明确跳过；Cowork 镜像 Dockerfile 声明预装该包。远端 PPT 控制面仍返回 404，需部署后运行：三输入创建→容器解析→大纲编辑→生成→跨设备打开→PPTX/PDF 下载打开→复制/回收站/永久删除→服务重启恢复。PDF 的中文字体和版式需要在容器中检查。
