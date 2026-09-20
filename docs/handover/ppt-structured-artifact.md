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
- structured 自测覆盖：stable ID、run recovery、event seq、SSE replay、shared Render Tree、PPTX geometry、幂等/rebase/conflict、Undo/Redo、revision、外部 PPTX 未知对象保留。
- Playwright：PPT Workspace 8 个 smoke 场景通过，包括对象编辑、历史、AI、Undo/Redo、publish，以及无模型的外部 PPTX 保真导入。
- 全仓库：2800 tests，2799 passed，1 skipped，0 failed。
- TypeScript 和 PPT 目录 ESLint 通过。
- Node 运行要求：本机验证使用 Node 22；系统 Node 18 与当前 `better-sqlite3` ABI 不匹配。
