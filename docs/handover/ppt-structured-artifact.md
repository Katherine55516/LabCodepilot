# PPT Structured Artifact Runtime 交接

> 完成日期：2026-09-20
> 范围：P0–P7

## 结果

PPT Workspace 已从“生成后保存整份 JSON”升级为 Cowork 服务端托管的结构化制品系统。生成过程、对象、布局、编辑命令、草稿和发布版本均有持久化身份，可以跨设备观察、恢复和继续编辑。

## 最终模块边界

### 服务端

`apps/cowork-server/lib/ppt/` 是新架构的领域边界：

- `repository.mjs`：项目快照、revision、append-only JSONL、原子写入和单项目串行队列。
- `ir.mjs` / `migrations.mjs` / `assets.mjs`：Presentation IR v3、稳定 ID、旧数据迁移和按 hash 管理的媒体引用。
- `dag-planner.mjs` / `run-service.mjs` / `event-store.mjs` / `recovery.mjs`：持久化 Run、DAG、Event、重放、取消和进程重启恢复。
- `render-tree.mjs` / `layout-registry.mjs`：以整数 EMU 为唯一布局结果；预览、质量检查、PPTX 和 PDF 共用该结果。
- `command-schema.mjs` / `command-service.mjs` / `command-history.mjs`：对象命令、幂等、乐观并发、冲突检测和补偿式 Undo/Redo。
- `quality-service.mjs` / `publish-service.mjs`：草稿与发布分离，发布时执行完整质量门禁。
- `import-pptx.mjs`：读取外部 PPTX 原生 shape ID 和 geometry；导出时重新打开原包并做保守修改。
- `api.mjs`：结构化 API、SSE、revision restore、对象 AI 编辑和增量预览。
- `exporters/`：PPTX、PDF 和 SVG preview adapter。

旧 `ppt-*.mjs` 继续承担 M1–M5 兼容入口，逐步把数据交给上述领域模块。

### 前端

- `PptWorkspace.tsx`：兼容外壳、项目库和 M1–M5 旧编辑入口。
- `generation/PptGenerationMonitor.tsx`：SSE snapshot + event replay、DAG 状态和取消。
- `canvas/PptCanvas.tsx`：Render Tree 画布、选择、拖动和缩放。
- `inspector/PptInspector.tsx`：对象内容属性。
- `history/PptHistory.tsx`：持久命令历史。
- `editor/StructuredPptEditor.tsx`：组合画布、属性、历史、Undo/Redo、AI 对象编辑和发布。
- `types.ts`：前端只读 Render Tree / Run view model。

## 数据流

```text
输入/导入
  -> Project + IR v3 snapshot
  -> persisted Run + DAG nodes
  -> append-only Events
  -> SSE(snapshot first, then replay/live events)
  -> semantic nodes
  -> shared Render Tree (EMU)
  -> browser canvas / SVG / PPTX / PDF / quality checks

编辑
  -> Command(baseRevision + stable slide/node ID)
  -> per-project serialized writer
  -> conflict check + journal append + revision snapshot
  -> affected-slide Render Tree rebuild
  -> draft
  -> publish quality gate
  -> published artifact
```

## API

- `GET|DELETE /ppt/projects/:id/run`
- `GET /ppt/projects/:id/events`：JSON 或 `text/event-stream`；支持 `Last-Event-ID`。
- `GET|POST /ppt/projects/:id/commands`
- `POST /ppt/projects/:id/undo|redo|publish|ai-edit`
- `GET /ppt/projects/:id/revisions`
- `POST /ppt/projects/:id/revisions/:revision/restore`
- `GET /ppt/projects/:id/slides/:slideId/preview?format=svg`
- `GET /ppt/runs/:runId?projectId=:projectId`

## 关键不变量

1. 模型只生成语义内容，不生成 ID、坐标、版本号和发布状态。
2. slide/node ID 在编辑、重排、恢复和跨设备打开后保持稳定。
3. Event seq 在一个 run 中严格递增；SSE 先发 snapshot，再补历史事件并进入实时流。
4. 所有项目 mutation 经过同一 project queue；command ID 重试只提交一次。
5. stale command 只在目标集合不相交时自动 rebase；相交返回 409 和冲突详情。
6. Undo/Redo 追加补偿操作，不删除历史。
7. PPTX/PDF/Web/QA 不再各自计算布局，只消费 Render Tree。
8. 编辑只产生草稿；显式 publish 通过质量门禁后才替换可导出文件。
9. 外部 PPTX 只允许安全对象编辑；未知对象锁定，并依靠原始 OOXML package 保留。

## 外部 PPTX 编辑边界

- 可编辑：映射到原生 shape 的文本、已识别图片，以及安全的 geometry/style 字段。
- 保留：无法解释的 shape、主题、母版和 package 内其他对象。
- 锁定：未知对象、可能破坏原生关系的结构操作。
- 导出：重新打开原文件并更新映射 shape，保留原文本首个 run 的格式。
- “保真编辑”导入不需要 LLM、模板或目标页数。

## 存储与部署边界

当前 Cowork Server 是单进程文件存储。`repository.mjs` 的原子 rename、append-only journal 和内存 project queue 能保证单实例串行写入；它们不能为多个服务实例提供分布式锁或数据库事务。部署多实例前，应把 Project、Run、Event、Operation、Revision 和 Asset metadata 迁移到支持事务与行锁的数据库，并保留现有 repository 接口。

## 验证

- Cowork PPT 自测：M1、M2、M3、M4、M5、structured 全部通过。
- structured 自测覆盖：stable ID、run recovery、event seq、SSE replay、shared Render Tree、PPTX geometry、chart/table/image/rotation、命令 schema、幂等/rebase/conflict、Undo/Redo、revision、外部 PPTX 未知对象保留。
- Playwright：PPT Workspace 8 个 smoke 场景通过，包括对象编辑、历史、AI、Undo/Redo、publish，以及无模型的外部 PPTX 保真导入。
- 全仓库：2803 tests，2802 passed，1 skipped，0 failed；全仓 smoke 25/25 通过。
- TypeScript 和 PPT 目录 ESLint 通过。
- Node 运行要求：本机验证使用 Node 22；系统 Node 18 与当前 `better-sqlite3` ABI 不匹配。

## 2026-09-21 可视化编辑器加固

- `StructuredPptEditor`、`PptCanvas` 和 `PptInspector` 现在提供连续多页编辑、多选、框选、八向缩放、旋转、吸附参考线、对齐/分布、组合/解组、锁定、层级、剪贴板、快捷键、缩放、页面增删复制排序和图片替换。
- 页面内文字、图片、图表、表格和形状直接渲染；SVG preview、PPTX/PDF 导出和质量检查继续使用同一 Render Tree，避免预览与导出各算一套布局。
- 修复 canonical IR 在对象删除后自动补回 title/body 的根因；对象删除、Undo/Redo、跨页修改和版本恢复均以稳定 slide/node ID 工作。
- mutation API 按命令类型做 fail-closed 校验。内部恢复命令不能从公共接口直接调用；图片在客户端压缩后，服务端继续校验 MIME、签名、字节数和像素上限。
- AI 对象编辑、页面编辑和页面重排只产生受限语义建议，先预览再应用。模型不能设置 ID、坐标、样式、版本或发布状态。
- 外部 PPTX 的结构修改在 UI 与服务端同时关闭，只保留安全对象编辑，防止破坏未知 OOXML 对象、母版和关系。
- 编辑器主流程文案集中在 `zh`、`en`、`zh-HK` 词典；单测检查三套核心 key 完整，并禁止编辑器组件重新写入内联中文。
- Playwright 在桌面和移动 viewport 检查连续画布与交互，包含第二页对象编辑的真实 slide/node 路由断言，避免闭包把命令错误提交到第一页。

## 2026-09-23 上传模板扩页调度

- 新建项目在导入 PPTX 后、生成大纲前，由 `ppt-template-scheduler.mjs` 一次确定 `templateFidelity.slideMap`；Run/DAG 顺序和已创建项目的映射不变。模型只负责填入已选页面的语义槽位。
- 保留全部原页及其相对顺序；封面和结尾各用一次，中间页最多两次，同源页不能相邻。少于 4 页的模板不扩页，其他模板最多输出 `2 × 原页数 − 2` 页。无法满足用户确认页数时，创建 API 返回 400，创建向导同时显示范围与原因。
- 导入时记录图片 SHA-256 与 64 位 dHash；规划器从图片、对象粗位置和配色构造不含正文或图片字节的指纹。在硬约束内优化相邻视觉相似度和复用页分布，不修改原生图片、shape、母版或字体。原生 PPTX 导出继续按持久化映射复制原页，并核对每页组件数量与图片 hash。
- `templateFidelity.reusePlan` 保留复用数、最大单页使用次数及相邻视觉相似度供诊断；老项目不重算。`selftest-ppt-template-scheduler.mjs` 覆盖 1–50 页边界、确定性、视觉优化和 10→15 页的原生导出。

## 2026-09-24 语义版式扩页与长文稿约束

此前「内容页最多两次、最多 `2 × 原页数 − 2`」是旧版规则。当前用户确认页数上限仍为 100；实际可扩页数取决于每张原生 PPTX 页面的安全变体容量。

- `ppt-template-fidelity.mjs` 从原生对象、文本槽位、图片和图解生成每页 profile。`layoutCatalog` 持久记录版式家族、适用角色、语义单元容量、可用几何变体与最大使用次数。标题/正文的字体和原生对象 ID 保持模板语义；模型仍只填写内容。
- 首次出现的模板页保持原版。再次使用时，确定性选择通过重叠检查的内容区镜像、标题与内容区镜像、独立图片卡片重排，或原图裁切/合格用户媒体替换。方向性箭头、连接线和图表不做几何重排；全幅背景及顶部固定装饰保留。没有足够安全变体时停止并报告容量，不做源页循环。
- `ppt-template-scheduler.mjs` 以所有原页的有序首次出现为骨架，独立选择每张新增内容页。评分综合页面角色、视觉意图、语义容量、使用次数、相邻视觉相似度和布局密度。封面、结尾只用一次，禁止相邻同源，并惩罚短周期重复。得到大纲后在现有 outline 节点内重新调度；DAG、IR、Run/Event、导出链不变。
- 现有 outline 节点增加长文稿主张重复/来源缺失检查，并允许一次有界修订。现有内容 QA 对来源稀薄、重复主张、无来源内容页和相邻版式过度相似给出告警；它不会捏造事实或私自改变用户页数。
- 未变图片不再在 Node→Python 导出 JSON 中重复传输 base64；Python 仍从原始 PPTX 复制原生图片。真实 Gamma 模板 10→100 页映射没有相邻同源或两页交替循环，20 页实际导出核对原生对象数量、图片 hash 和坐标通过。

## 2026-09-28 来源证据与语义质量门禁（P0→P4 本地回归）

- 现有 source、outline、content、template 和 quality 节点内部加入 `EvidenceAtom`、页级 `requiredEvidenceIds`、锁定证据优先召回及可见页核验。原有持久化 DAG、IR v3、Run/Event 和原生导出边界不变；来源 chunk 映射不再被当作事实已显示。
- 内容契约记录受众用途、逐页问题/主张/证据/启示，并检查无证据的结果页、数值缺少单位或限定条件、残句、填充和跨页复述。来源不足时应留待补证据或调整标题，不能补造数字。
- 模板调度考虑语义角色、实际槽位密度、读序和非相邻图片复用。复用页只有独立且无文字覆盖的大图框可进行确定性语义媒体替换；其他原生媒体保留并报告语义不匹配，避免图像覆盖文本或图解。
- 质量结果增加事实/叙事/版式/媒体分组及编辑就绪状态。硬性证据缺失阻止发布；`needs_review` 在导出对话框明确提示。媒体分辨率依据显示面积处理，小图标不再产生大量噪声。
- Node 22 本地全量测试 2803 通过、1 跳过；28 个 smoke 场景通过。真实 HTML/Gamma 模板确定性回放抽取 372 个证据原子，旧 49 页样例的关键缺证据页被拦截，并导出可打开的原生 49 页 PPTX。用户限定本轮只做本地回归，真实项目 LLM 与远端 Cowork 环境验收仍待进行；该回放不代表模型生成质量已达职场交付标准。
