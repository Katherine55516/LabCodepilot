# 上传附件存储迁移 + 存储治理（uploads-storage-relocation）

> 创建时间：2026-06-23
> 最后更新：2026-06-23
> 产品思考见 [docs/insights/uploads-storage-relocation.md](../../insights/uploads-storage-relocation.md)（Phase 6 补）

## 背景与问题

发送**截图**或 **@文件**后，后端会把附件落盘到 `path.join(workDir, '.codepilot-uploads')`，其中 `workDir = session.working_directory`（用户用 Claude 操作的项目根）。由此产生三个问题：

1. **污染用户工程目录**：附件写进用户自己的代码仓库根目录，而非 app 缓存目录。
2. **被用户工程的 git 跟踪**：本项目 `.gitignore:61` 虽忽略了 `.codepilot-uploads/`，但该规则只对 AI Native Lab 自身仓库生效；当工作目录是**另一个 git 项目**时，附件目录被那个项目的 git 跟踪——这是同事反馈的现象。
3. **无任何存储治理**：文件名 `${Date.now()}-${safeName}`，每发一次写一个新文件，无 TTL / 无容量上限 / 无去重 / 删除会话不级联清理，**只增不减**。

项目内已有正确范式：AI 媒体库 `.codepilot-media` 落在 `path.join(dataDir, '.codepilot-media')`（统一缓存根 `~/.codepilot/`），且有删除 API。uploads 应对齐该范式。

### 现状写入点（三处，逻辑一致）

| 位置 | 路径 | 触发场景 |
|------|------|----------|
| [chat/route.ts:210-225](../../../src/app/api/chat/route.ts) | `workDir/.codepilot-uploads` | 桌面端聊天主路径 |
| [conversation-engine.ts:130-155](../../../src/lib/bridge/conversation-engine.ts) | `workDir/.codepilot-uploads` | Bridge（Telegram 等远程）路径 |
| [claude-client.ts:200-222](../../../src/lib/claude-client.ts) | `workDir/.codepilot-uploads` | `getUploadedFilePaths` 兜底（注释：正常流程不触发） |

### 现状读取 / 关联点

- 落盘后元数据以 `<!--files:[{id,name,type,size,filePath}]-->正文` 存进消息 content（`filePath` 为**绝对路径**）。
- UI 渲染：[FileAttachmentDisplay.tsx:21](../../../src/components/chat/FileAttachmentDisplay.tsx) → `if (f.filePath) return '/api/uploads?path=' + filePath`。
- 服务路由：[uploads/route.ts:37-44](../../../src/app/api/uploads/route.ts)，安全校验用 `resolved.includes('.codepilot-uploads')` 做**子串**匹配（非锚定根，目录穿越隐患，已记于 [security-audit-remediation.md:211](./security-audit-remediation.md)）。
- 统一缓存根：`dataDir = process.env.CLAUDE_GUI_DATA_DIR || ~/.codepilot`，Electron 主进程在 [main.ts:728](../../../electron/main.ts) 注入。
- 会话删除入口：`deleteSession` [db.ts:1152](../../../src/lib/db.ts)（挂级联清理点）。
- 同类问题：AI 生成图也写 `session.working_directory/.codepilot-images`（[image-generator.ts:386](../../../src/lib/image-generator.ts)）——同根问题，Phase 5 一并处理。

## 目标

1. 附件统一落到 `~/.codepilot/`，不再污染用户工程、不被用户工程 git 跟踪。
2. 补齐存储治理：会话删除级联清理 + 容量/过期上限。
3. 收口 `/api/uploads` 子串校验为锚定根校验。
4. 兼容存量数据（旧消息附件不丢图）。
5. `working_directory` 为空时也能正确落盘（现状空串会退化为相对路径，新方案不再依赖它）。

## 目录契约（锁定）

```
~/.codepilot/.codepilot-uploads/
  <sessionId>/
    <timestamp>-<safeName>
```

- 复用 `dataDir`（与 `.codepilot-media` 同根）。
- 按 `sessionId` 分子目录 → 会话删除可整目录 `rm -rf`。
- 元数据 `filePath` 仍存**绝对路径** → 渲染/读取逻辑零改动，只需路径可达。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 现状梳理 + 契约锁定（本次调研） | ✅ 已完成 | 写入/读取/删除/迁移锚点已定位 |
| Phase 1 | 抽取统一写入 helper + 三个写入点指向新根 | 📋 待开始 | 核心改动，最小可用 |
| Phase 2 | `/api/uploads` 安全收紧（锚定缓存根）+ 兼容历史绝对路径读取 | 📋 待开始 | 顺带修 security-audit #子串匹配 |
| Phase 3 | 存储治理：会话删除级联 + 容量/TTL 清理 | 📋 待开始 | 阈值入 settings |
| Phase 4 | 存量迁移（best-effort 一次性，搬文件 + rewrite filePath） | 📋 待开始 | 失败不阻断 |
| Phase 5 | `.codepilot-images`（AI 生成图）同步迁移 | 📋 待开始 | 可拆分 / 可单独发 |
| Phase 6 | 验证 + 双文档（handover + insights） | 📋 待开始 | CDP 验证截图/@文件渲染 |

## 决策日志

- 2026-06-23: **统一根 = `~/.codepilot/.codepilot-uploads/<sessionId>/`**，对齐 `.codepilot-media` 范式，复用 `dataDir`。理由：单一缓存根便于治理、不污染工程、跨平台一致。
- 2026-06-23: **`filePath` 继续存绝对路径**（不改为相对/逻辑路径）。理由：最小改动，渲染逻辑 `FileAttachmentDisplay` 与 `/api/uploads` 零改造即可读新路径；存量旧消息的绝对路径同样可读，天然向后兼容。
- 2026-06-23: **不再依赖 `working_directory`** 决定落点。理由：根治空串退化为相对路径的隐患，且 Bridge 路径 workDir 来源更杂。
- 2026-06-23（**待 @liyuanqi 确认**）: **清理策略**推荐「会话删除级联（必做）+ 全局容量上限 LRU 淘汰（主）+ TTL（辅，可配）」，阈值入 `settings`（`uploads_max_total_mb` 默认 2048、`uploads_ttl_days` 默认关闭=0）。备选：只做会话级联 + TTL，不做容量 LRU。
- 2026-06-23（**待 @liyuanqi 确认**）: **存量迁移**推荐 Phase 4 做 best-effort：启动时扫描历史消息 fileMeta，凡 `filePath` 落在某工作目录 `.codepilot-uploads/` 的，move 到新根并 rewrite 消息 JSON；失败跳过、不阻断启动。备选：不迁移，靠 Phase 2 的历史绝对路径兼容读取长期托底（实现更省，但旧附件仍残留在各工程目录，git 跟踪问题对存量不解决）。
- 2026-06-23: **@文件双重冗余暂不在本计划去重**。@文件引用的是工作区已有文件，却仍落一份副本——本计划先解决「位置」（副本进缓存而非工程目录）。「@文件复用原件路径、不落副本」需配合「清理时绝不删原件」的隔离保证，复杂度高，列为未来优化 / tech-debt。

## 详细设计

### Phase 1：统一写入 helper

- 新建 `src/lib/uploads-store.ts`，导出：
  - `getUploadsRoot(): string` → `path.join(dataDir, '.codepilot-uploads')`
  - `getSessionUploadDir(sessionId): string` → `<root>/<sessionId>`
  - `persistUploadedFiles({ sessionId, files }): FileMeta[]` → mkdir + 写盘 + 返回元数据（含绝对 `filePath`）
- 改三个写入点调用 helper，删除各自的 `path.join(workDir, '.codepilot-uploads')` 内联逻辑：
  - [chat/route.ts:210-225](../../../src/app/api/chat/route.ts)
  - [conversation-engine.ts:130-155](../../../src/lib/bridge/conversation-engine.ts)
  - [claude-client.ts:200-222](../../../src/lib/claude-client.ts)（`getUploadedFilePaths` 兜底，签名加 `sessionId`）
- 保证传给 SDK 的文件路径（`getUploadedFilePaths`）继续可用。
- **验收**：截图 / @文件发送后，文件出现在 `~/.codepilot/.codepilot-uploads/<sessionId>/`，工作目录下不再新建 `.codepilot-uploads`；DB 元数据 `filePath` 指向新位置。

### Phase 2：/api/uploads 安全收紧 + 历史兼容

- [uploads/route.ts:37-44](../../../src/app/api/uploads/route.ts) 改为锚定根校验：`path.resolve(filePath)` 必须以 `getUploadsRoot()` / `.codepilot-media` / `.codepilot-images` 的 canonical 根为**前缀**（`resolved.startsWith(root + path.sep)`），替换子串 `includes`。
- 过渡期兼容：若选「不迁移存量」（决策备选），需额外放行历史绝对路径——与锚定根冲突，故**推荐配合 Phase 4 迁移**后直接锚定，不留宽松口子。
- **验收**：新附件可读；构造 `../` 穿越路径返回 403；旧附件（迁移后）可读。

### Phase 3：存储治理

- 会话删除级联：`deleteSession` [db.ts:1152](../../../src/lib/db.ts) 内 `fs.rm(getSessionUploadDir(id), { recursive: true, force: true })`（best-effort，try/catch）。
- 容量/TTL 清理：新增清理函数，启动时 + 低频定时触发；按 `settings` 阈值，超限按 mtime LRU 删最旧、过期按 TTL 删。
- **验收**：删除会话后对应子目录消失；构造超限/过期文件后清理生效；阈值可配。

### Phase 4：存量迁移（best-effort）

- 一次性迁移器（启动时跑一次，幂等，打 marker）：扫描历史消息 fileMeta，`filePath` 命中 `*/.codepilot-uploads/*`（旧工作目录形态）的，move 到 `<新根>/<sessionId>/` 并 rewrite 该消息 content 的 JSON `filePath`。
- 失败（文件已删/无权限）跳过并 log，不阻断启动。
- **验收**：含旧附件的历史会话迁移后仍能渲染缩略图；marker 防重复迁移。

### Phase 5：.codepilot-images 同步迁移

- [image-generator.ts:386](../../../src/lib/image-generator.ts) 的 `session.working_directory/.codepilot-images` → 统一缓存根（沿用本计划目录契约或并入 `.codepilot-media`）。
- 同步 [uploads/route.ts:38](../../../src/app/api/uploads/route.ts) allowedDirs。
- 可独立成小 PR。

### Phase 6：验证 + 文档

- CDP 验证：截图粘贴 + @文件 两条链路落盘位置、缩略图渲染、console 无报错（本地无登录体系，managed 相关用 mock）。
- `npm run test` + `npm run test:smoke`。
- 输出 handover（数据流 / 目录契约 / 迁移逻辑）+ insights（为何统一缓存、清理策略权衡），互相反链。

## 风险与回滚

- **风险**：Phase 4 rewrite 消息 content 需改 DB 行，JSON 替换出错会破坏消息。缓解：迁移前备份 / 仅替换匹配到的 `filePath` 字段、逐条 try/catch、marker 幂等。
- **风险**：清理误删。缓解：清理范围严格限定 `getUploadsRoot()` 下；会话级联用 `force` 但路径来自 `getSessionUploadDir` 拼接，不接受外部输入。
- **回滚**：Phase 1-3 为独立 commit，可逐个 revert；Phase 4 迁移器有 marker，回滚代码即停止迁移，已迁移文件不影响读取（绝对路径仍可达）。

## 验收标准（整体）

1. 截图 / @文件不再在用户工程目录创建 `.codepilot-uploads`，不被用户工程 git 跟踪。
2. 附件落 `~/.codepilot/.codepilot-uploads/<sessionId>/`，新旧附件 UI 均可渲染。
3. 删除会话级联清理；容量/TTL 上限生效且可配。
4. `/api/uploads` 锚定根校验，穿越路径被拒。
5. `working_directory` 为空时落盘正常。

## 关联

- 安全：[security-audit-remediation.md](./security-audit-remediation.md)（uploads 子串校验项 Phase 2 一并收口）
- 技术债：tech-debt-tracker #13（指向本计划）
