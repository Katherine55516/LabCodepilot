# PPT Structured Artifact Runtime

> 创建时间：2026-09-20
> 最后更新：2026-09-20

## 目标

在现有 M1–M5 PPT Workspace 上完成以下能力，并保持 Cowork 服务端为跨设备事实源：

1. 持久化 Run / DAG / Event，可恢复、可回放、可跨设备观察。
2. 使用稳定 slide/node ID 的 Presentation IR v3。
3. Web 预览、质量检查、PPTX/PDF 导出消费同一份 Render Tree。
4. 服务端 Command Journal、持久化 Undo/Redo、冲突检测和版本恢复。
5. 基于 Render Tree 的对象级编辑器和受限 AI 编辑。
6. 增量页面预览、发布版本、外部 PPTX 的保守导入与未知对象保留。

## 状态

| Phase | 内容 | 状态 | Gate |
|---|---|---|---|
| P0 | 基线、Repository、单项目串行写入 | ✅ 已完成 | 原子 snapshot、append-only log、project queue |
| P1 | 稳定 ID、IR v3、v2 migration、asset refs | ✅ 已完成 | stable slide/node/item ID；读取时迁移 |
| P2 | Run/DAG/Event、replay、恢复、取消/重试 | ✅ 已完成 | 同 runId 恢复；event seq 单调 |
| P3 | Snapshot + SSE 生成过程 UI | ✅ 已完成 | snapshot-first、seq replay、实时订阅与取消 |
| P4 | Shared Render Tree | ✅ 已完成 | Web/PPTX/PDF/QA 共用 EMU geometry |
| P5 | Command Journal、Undo/Redo、冲突与恢复 | ✅ 已完成 | 幂等、disjoint rebase、409 conflict、补偿命令 |
| P6 | 对象级可视化编辑器、AI 对象编辑 | ✅ 已完成 | 选择/拖动/缩放/属性/历史/受限 AI patch |
| P7 | 增量发布、完整版本恢复、PPTX 保守导入 | ✅ 已完成 | 草稿/发布分离；未知原生对象保留 |
| P8 | 全量测试、文档、部署验收 | ✅ 已完成 | 自测、typecheck、E2E、CDP、webpack build 通过 |

## 决策日志

- 2026-09-20：保留 Cowork 服务端作为唯一事实源；客户端只保存临时 selection 和 optimistic state。
- 2026-09-20：Cowork Server 当前为 Node 18、单进程文件存储；首版采用 per-project append-only journal + 串行 writer + 原子 snapshot，不新增原生数据库依赖。多实例部署前必须迁移到事务数据库。
- 2026-09-20：Event log 是运行历史，Project/Run snapshot 是可重建 read model；snapshot 保存 `lastAppliedSeq`。
- 2026-09-20：IR 使用稳定随机 ID。模型只生成语义内容；ID、geometry、版本和 provenance 由代码生成。
- 2026-09-20：Render Tree 使用 EMU 整数作为 canonical geometry，Python exporter 不再自行选择布局。
- 2026-09-20：Undo/Redo 追加 compensating command，不删除历史。
- 2026-09-20：外部 PPTX 首版只映射可安全解析的原生对象；未知对象作为 locked foreign object 保存原始 package，导出时保留。

## 模块边界

```text
apps/cowork-server/lib/ppt/
  api.mjs
  repository.mjs
  migrations.mjs
  ir.mjs
  assets.mjs
  run-service.mjs
  dag-planner.mjs
  event-store.mjs
  recovery.mjs
  command-service.mjs
  command-schema.mjs
  command-history.mjs
  layout-registry.mjs
  render-tree.mjs
  quality-service.mjs
  import-pptx.mjs
  exporters/{pptx,pdf,preview}.mjs

src/components/ppt/
  workspace/
  generation/
  editor/
  canvas/
  inspector/
  history/
  presentation/
```

旧的 `ppt-*.mjs` 在迁移期间作为兼容入口，避免一次改动破坏现有自测和部署脚本。

## 验收重点

- 服务重启后恢复同一个 runId，已成功节点不重复调用模型。
- SSE 断线使用 event seq 补齐，Snapshot 与 Event replay 一致。
- slide/node ID 在重排、编辑和版本恢复中保持稳定。
- Web、PPTX、PDF 和 overlap/overflow QA 使用相同 Render Tree bounds。
- command 重试幂等，Undo/Redo 跨刷新和跨设备持久化。
- 编辑只重建受影响页预览；发布时执行完整 `review → repair → publish`。
- 旧 IR、旧项目、旧导出 API 保持可用。

## 完成记录

- Cowork 自测：`selftest:ppt`、M2、M3、M4、M5、structured 全部通过。
- structured 场景覆盖稳定 ID、恢复、SSE replay、共享 Render Tree、PPTX geometry、command 幂等/rebase/conflict、Undo/Redo、revision 和未知外部对象保留。
- Playwright PPT smoke：8/8 通过。
- 全仓库：2800 tests，2799 passed，1 skipped，0 failed；TypeScript 与 PPT ESLint 通过。
- `next build --webpack` 通过。普通 `next build` 因仓库已有 Next 16 Turbopack/webpack 配置冲突失败，正式打包脚本本身使用 webpack。
- CDP 实测 `/ppt` 桌面和 390×844 响应式页面，console 无 warning/error；结构化编辑器另由 Playwright 实际浏览器覆盖。
- 单实例文件仓库已经闭环；多实例生产部署前须把 repository port 迁移到事务数据库。
