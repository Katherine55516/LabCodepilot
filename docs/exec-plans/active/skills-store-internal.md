# 技能市场（内部）— 客户端接入 codeagent-server Skills 商店

> 创建时间：2026-07-27
> 最后更新：2026-07-28（Phase 0-3 完成）
>
> 服务端契约：codeagent-server `docs/skills-store-api.md`（commit `acb6240`，已合入 main）。
> 服务端为 Lab AI Hub 的 BFF 纯代理，本方案只覆盖客户端层。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 调研 + 主进程骨架：zip 解压库选型 POC、HubSkillsClient（list/detail/download 透传 + 错误码映射）、IPC + preload + 类型声明 | ✅ 已完成 | 选型定稿 **yauzl@3.4.0**（MIT，唯一依赖 pend）：POC 实测其默认（decodeStrings）即拒绝 `../`/绝对路径条目，中文文件名正确解码，symlink 经 externalFileAttributes 高 16 位识别拒绝；extract-zip 落选（会创建 symlink 条目且无大小/条目数上限口子）。core 26 条单测全过 |
| Phase 1 | UI：Skills 页第三个 tab「技能市场（内部）」+ 列表/搜索/分页 + 详情页 | ✅ 已完成 | CDP mock 全链路验证（三 tab/徽章/详情/搜索/分页 20→40→45/错误与登录门禁/重试恢复/无 electronAPI 隐藏 tab）；修一处窄弹窗标题被徽章按钮挤没的布局 bug（header flex-wrap）；动作按钮 Phase 2 前禁用；en 外部市场文案对齐为 Marketplace (External) | 
| Phase 2 | 安装链路：install / uninstall / update（zip 下载解压 + 台账 + zip-slip 防护 + skill 缓存失效） | ✅ 已完成 | 解压/落位层拆为独立 `skills-store-fs.ts`（不依赖 electron）→ 单测用手工 zip 字节流驱动真实 yauzl 循环（slip/symlink/中文名/原子替换 7 条）；变更操作 promise 链串行化防台账并发丢写；新增 `POST /api/skills/refresh` 失效 Next 侧发现缓存；CDP 验证装/卸/更全链路 + 修一处详情页安装状态取组件 state 不随 prop 更新的 bug | 
| Phase 3 | 状态联动：isInstalled 合并、可更新徽章、DEPRECATED 处理、台账自愈、与「我的技能」互通 | ✅ 已完成 | 大头已在 Phase 0-2 顺手落地；本阶段:修「我的技能」DELETE 对 installed 技能只删 SKILL.md 的既有 bug（孤儿残留+永久占 slug,外部市场同受益,整目录删除+根围栏）；台账 fs 层迁至 skills-store-fs（CODEPILOT_SKILLS_ROOT_OVERRIDE 注入口）+4 条集成测试（round-trip/自愈持久化/legacy 单文件删/损坏容错）；核查结论:「我的技能」按 frontmatter name 匹配,与内部 dirName 无错位风险 | 
| Phase 4 | i18n（en/zh/zh-HK 手工）+ 单测 + 真实链路验证 + CDP UI 验证 + 交接/产品两份文档 | 📋 待开始 | |

## 决策日志

- 2026-07-27: **D1 调用链路走主进程 IPC，不走 Next API route。** 登录 token 只在主进程（与问题反馈 `feedback:submit` 同边界，「token 绝不下发 renderer」），且 zip 落盘/解压本就该在主进程做。与外部市场（Next route + `npx skills` CLI）路线不同是刻意的：外部市场无鉴权、依赖外部 CLI；内部市场带登录态、自管安装。
- 2026-07-27: **D2 安装目录名 slug 优先，冲突时加 id 后缀。** 服务端文档建议目录名用 `id`（cuid），但目录名即 Claude Code 的 skill 标识，会出现在斜杠命令里，纯 cuid 不可读。折中：常态用 `slug`；安装时若该目录已被**不同 skillId** 占用，改用 `{slug}--{id 前 8 位}`。台账 key 始终是 `skillId`，不受目录名影响。
- 2026-07-27: **D3 自建台账文件，不复用 `~/.agents/.skill-lock.json`。** 那是外部 `skills` CLI 的私产（skill-reconcile.ts 明确不碰）。内部市场台账放 `~/.claude/skills/.internal-store.json`，与安装产物同根、随目录删除天然失效。
- 2026-07-27: **D4 安装进度用轻量 spinner + toast，不复用 InstallProgressDialog。** 该对话框是为流式 CLI stdout 设计的；内部安装是「下载 zip + 解压」两步，秒级完成，流式日志没有内容可展示。
- 2026-07-27: **D5 tab 可见性：mount 时 probe 一次。** `SKILLS_NOT_CONFIGURED`（503）→ 隐藏 tab（服务端契约要求）；未登录 → tab 显示、内容为「登录后可用」空态；其他错误 → 显示错误态可重试。probe 结果会话级缓存。
- 2026-07-27: **D6 一期不做：AI 翻译按钮、categoryId 分类过滤、view 切换、updatedAfter 增量。** 内部技能以中文为主无需翻译；Hub 未提供分类枚举端点；view=all 已含公开+私有（详情用 `isOwn` 徽章区分）；浏览场景用不上增量参数。均可二期补。

## 详细设计

### 1. 背景与目标

服务端（codeagent-server `acb6240`）已上线 Skills 商店 BFF：代理 Lab AI Hub 开放 API，客户端带自己的登录态调 `/api/v1/skills*`，服务端注入 userUuid 转发。客户端目标：

- 设置 → Skills 页在「我的技能」「技能市场（外部）」右侧新增 **「技能市场（内部）」** tab；
- 功能对齐外部市场：搜索、列表、详情、安装/卸载、已安装徽章；
- 额外承接内部市场特有语义：版本更新检查（contentHash/ETag）、已下架（DEPRECATED）处理、私有技能（isOwn）标识。

### 2. 现状与服务端契约摘要

**客户端现状**（`src/components/skills/`）：

- `SkillsManager.tsx`：`viewTab: "local" | "marketplace"` 两段式分段控件；
- 外部市场三件套 `MarketplaceBrowser / MarketplaceSkillCard / MarketplaceSkillDetail`，走 Next route `/api/skills/marketplace/*`（skills.sh 无鉴权 + `npx skills` CLI 安装）；
- 本地技能发现扫 `~/.claude/skills/` 与 `~/.agents/skills/` 双根（`skill-discovery.ts`），`skill-reconcile.ts` 把 agents 根镜像进 claude 根。

**服务端契约要点**（权威见 codeagent-server `docs/skills-store-api.md`）：

| 端点 | 说明 |
|---|---|
| `GET /api/v1/skills` | 列表；`view=store/own/all`、`keyword`、`page/pageSize(≤100)`；返回 `{items, pagination}`；用户在 Hub 无档案时兜底空列表 |
| `GET /api/v1/skills/{skillId}` | 详情（`guide`/`fileManifest`/`dependencies` 等）；`withContent=1` 仅 INLINE 型返回 `inlineContent` |
| `GET /api/v1/skills/{skillId}/download` | zip 流；透传 `ETag`(=contentHash)/`Content-Disposition`/`Content-Length`；带 `If-None-Match`（上次 ETag **原文含引号**）命中 304 |

- 错误 body `{"detail": {"code", "message"}}`，**分支只认 code**：`SKILL_NOT_VISIBLE`/`SKILL_NOT_DOWNLOADABLE`/`USER_NOT_ACTIVE`/`RATE_LIMITED`(带 Retry-After)/`SKILL_NOT_FOUND`/`HUB_UNAVAILABLE`(502)/`SKILLS_NOT_CONFIGURED`(503)；
- 响应字段可能新增，**客户端必须忽略未知字段**——不建 zod 强校验模型，DTO 只声明用到的字段；
- 不支持指定版本下载，装到的永远是当前可下载版；
- zip ≤ 50MB，客户端需防 zip-slip。

### 3. 总体架构

```
Renderer（InternalStoreBrowser 等）
   │ window.electronAPI.skillsStore.*        ← 新增 IPC 面
   ▼
Electron main（electron/skills-store.ts 新增）
   │ Bearer <登录 token>（loadToken，复用 feedback 同源）
   │ getBackendBase()（复用 electron/auth/config.ts）
   ▼
codeagent-server /api/v1/skills*  ──►  Lab AI Hub
```

安装产物落 `~/.claude/skills/<dirName>/`（打包版 Claude Code 原生可加载，无需 reconcile 镜像），台账落 `~/.claude/skills/.internal-store.json`。

### 4. 主进程模块（Phase 0 / 2）

**新文件 `electron/skills-store-core.ts`**（纯逻辑，无 electron 依赖，可单测——对照 `feedback-core.ts` 的拆分姿势）：

- `parseHubError(status, body)` → `{code, message, retryAfter?}`；未知形状归一为 `HUB_UNAVAILABLE`；
- 台账读写：`readLedger() / writeLedger()`，schema：

```jsonc
// ~/.claude/skills/.internal-store.json
{
  "version": 1,
  "skills": {
    "<skillId(cuid)>": {
      "slug": "pdf-toolkit",
      "dirName": "pdf-toolkit",          // 实际安装目录名（见 D2）
      "displayName": "PDF 工具箱",
      "contentHash": "a11bc3…",
      "etag": "\"a11bc3…\"",             // 下载响应 ETag 原文（含引号），If-None-Match 用它
      "downloadVersion": 4,
      "installedAt": "2026-07-27T12:00:00Z"
    }
  }
}
```

- `resolveDirName(slug, skillId, ledger, existingDirs)` → slug 可用则 slug，被不同 skillId 占用则 `{slug}--{id.slice(0,8)}`；
- zip 解压安全：逐条目校验 `path.resolve(target, entry)` 必须在 target 内（zip-slip）、解压前校验 zip ≤ 50MB、条目数上限（如 2000）、拒绝符号链接条目。

**新文件 `electron/skills-store.ts`**（胶水）：

- `hubFetch(path, init)`：`getBackendBase()` + `loadToken()` + `Authorization: Bearer`，超时（列表/详情 10s、下载 60s，对齐服务端）；401 → `not-logged-in`；
- IPC handlers（见 §6）；
- 安装事务：临时目录解压 → 校验含 `SKILL.md` → rename 进 `~/.claude/skills/<dirName>` → 写台账 → `invalidateSkillCache()`（通知嵌入式 Next 侧：复用现有主进程→Next 的缓存失效通道，若无则安装后由 renderer 调一次 `/api/skills` 自然重扫）；失败则清理临时目录，不留半成品；
- 更新：先详情预取比对 contentHash，不同则带 `If-None-Match` 下载；304 视为已最新（只修台账）；下载成功后先解压到临时目录、校验通过再原子替换旧目录。

**依赖（Phase 0 调研项）**：项目现无 zip 解压依赖（仅 `tar`）。候选 `yauzl`（流式、成熟、自己写守卫）vs `extract-zip`（yauzl 封装、内置路径校验）。倾向 **extract-zip**（electron 生态常用、体量小），POC 验证：中文文件名、深层目录、恶意路径样本。确认与 electron-builder 打包（asar unpack 无需——纯 JS）兼容后定稿。

### 5. Renderer 模块（Phase 1 / 3）

**新组件 `src/components/skills/internal/`**（对照外部三件套）：

- `InternalStoreBrowser.tsx` — 左列表右详情。搜索防抖 300ms + 请求序号守卫（抄 MarketplaceBrowser 的 seqRef 模式）；分页与外部不同：服务端是**真分页**（page/pageSize），无限滚动 = page+1 **追加**（外部是加大 limit 整体替换，不要照抄注释里的那套理由）；`pagination.totalPages` 判断 hasMore；
- `InternalSkillCard.tsx` — displayName + slug + 徽章：已安装 ✓ / 可更新（台账 contentHash ≠ 列表 contentHash）/ 已下架（state=DEPRECATED）/ 我的（isOwn）；
- `InternalSkillDetail.tsx` — 头部：displayName、slug、版本（downloadVersion）、isOwn/state 徽章、安装｜更新｜卸载按钮（spinner 内联，见 D4）；正文：`guide`（markdown，ReactMarkdown+remarkGfm，复用外部详情样式）+ `fileManifest` 文件清单折叠区；INLINE 型另请求 `withContent=1` 展示 `inlineContent` 预览。

**SkillsManager 改动**：

- `ViewTab = "local" | "marketplace" | "internal"`，分段控件追加第三段「技能市场（内部）」（外部右侧）；
- mount 时 `skillsStore.probe()`（即 list page=1,pageSize=1）：503 `SKILLS_NOT_CONFIGURED` → 不渲染该段（D5）；`window.electronAPI?.skillsStore` 不存在（纯浏览器 dev）→ 同样不渲染；
- 内部安装/卸载完成后回调 `fetchSkills()` 刷新「我的技能」（已装内部技能落在 `~/.claude/skills` → 以 `source: "installed", installedSource: "claude"` 出现在 Installed 分组，天然互通）。

**错误码 → UI 行为**：

| code | UI |
|---|---|
| （IPC 层 not-logged-in） | 空态：「登录后可浏览内部技能市场」+ 触发登录按钮（`electronAPI.auth.triggerLogin`） |
| `SKILLS_NOT_CONFIGURED` | 隐藏 tab |
| `HUB_UNAVAILABLE` | 错误态 + 重试按钮 |
| `RATE_LIMITED` | toast「操作过于频繁，{n} 秒后再试」，按钮禁用 n 秒 |
| `USER_NOT_ACTIVE` | 空态：「账号未激活/已禁用，请联系管理员」 |
| `SKILL_NOT_VISIBLE` / `SKILL_NOT_FOUND` | 详情页错误态；列表刷新移除该项 |
| `SKILL_NOT_DOWNLOADABLE` | toast：已下架技能不可安装；已装的保留本地并停止更新 |

### 6. IPC 面（preload + electron.d.ts）

```ts
skillsStore?: {
  list: (p: { keyword?: string; page?: number; pageSize?: number }) => Promise<
    | { ok: true; items: InternalSkill[]; pagination: {...} }   // items 已由主进程合并 isInstalled/hasUpdate
    | { ok: false; error: 'not-logged-in' | 'network' | HubCode; status?: number; retryAfter?: number }>;
  detail: (skillId: string, opts?: { withContent?: boolean }) => Promise<同上单对象>;
  install: (skillId: string) => Promise<{ ok: true; dirName: string } | { ok: false; ... }>;
  update: (skillId: string) => Promise<{ ok: true; updated: boolean } | { ok: false; ... }>;  // 304 → updated:false
  uninstall: (skillId: string) => Promise<{ ok: true } | { ok: false; ... }>;
}
```

`InternalSkill` DTO 进 `src/types/index.ts`（只声明用到的字段 + 注释「服务端可能新增字段，勿建全量模型」）。

### 7. 已装状态与自愈（Phase 3）

- `list`/`detail` 返回前，主进程用台账合并 `isInstalled` / `hasUpdate`（列表 contentHash ≠ 台账值）；
- **自愈**：合并时校验 `~/.claude/skills/<dirName>/SKILL.md` 仍存在——用户从「我的技能」删除目录后台账残留不产生幽灵「已安装」（学外部市场 search route 的 self-heal），顺手清掉死条目；
- 卸载路径：内部 tab 卸载 = 删目录 + 删台账；「我的技能」删除 = 仅删目录，靠自愈兜底；
- DEPRECATED：本地保留、`hasUpdate` 恒 false、卡片标「已下架」。

### 8. 安全清单

- token 不出主进程；renderer 只见结构化结果（对齐 feedback 边界）；
- IPC 入参在主进程重新校验（skillId 非空字符串等），不信任 renderer；
- zip：≤50MB（Content-Length 预检 + 落盘后复核）、zip-slip 路径守卫、拒符号链接、条目数上限；
- 解压走临时目录 + 原子 rename，失败不留半成品、不覆盖旧版本；
- 台账/目录写操作限定 `~/.claude/skills/` 根内。

### 9. 验证方案（Phase 4）

- **单测**（`npm run test`，核心在 skills-store-core）：错误码解析、台账读写/自愈、resolveDirName 冲突分支、zip-slip 样本拒绝、If-None-Match 取 etag 原文；
- **真实链路**：本地起 codeagent-server（假 JWKS 全链路法，见 `bug-report-feedback` 交接）+ `BACKEND_BASE=http://localhost:8080 npm run electron:dev`；覆盖：列表/搜索/安装/更新(304 与 200 两分支)/卸载/未配置 503 隐藏 tab；
- **CDP UI 验证**（CLAUDE.md 强制）：`npm run dev` + 注入 mock `window.electronAPI.skillsStore` 验证三 tab 切换、列表分页、详情、各错误态渲染；结论按「mock 验证的是逻辑非真实数据」表述；
- 安装后验证 agent 真能用：斜杠命令列表出现 + 会话内可触发该 skill。

### 10. 验收标准

1. 设置 → Skills 出现第三段「技能市场（内部）」，位于「技能市场（外部）」右侧；服务端未配置或纯浏览器环境不出现；
2. 登录态下可搜索/翻页浏览，详情展示 guide 与文件清单；
3. 安装后：已安装徽章即时翻转、「我的技能」Installed 分组出现、斜杠命令可用（无需重启）；
4. Hub 侧改版后（contentHash 变化）卡片出现「可更新」，更新走 If-None-Match，内容未变时 304 不重复传输；
5. 卸载后目录与台账同清；从「我的技能」删除后内部市场不显示幽灵已安装；
6. `npm run test` 全绿；两份文档（`docs/handover/skills-store-internal.md` + `docs/insights/skills-store-internal.md`）互链交付。

### 11. 一期边界（不做）

- AI 翻译按钮（内部内容以中文为主）；
- categoryId 分类过滤 / view=store|own 切换 / updatedAfter 增量（D6，二期视反馈补）；
- 下载审计相关 UI（纯服务端行为，客户端无感知）；
- admin 下载流水查询（属管理端，不进桌面客户端）。
