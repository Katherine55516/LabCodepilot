# 技能市场（内部）— 技术交接

> 产品思考见 [docs/insights/skills-store-internal.md](../insights/skills-store-internal.md)
> 执行计划（含决策日志）见 [docs/exec-plans/completed/skills-store-internal.md](../exec-plans/completed/skills-store-internal.md)
> 服务端契约权威：codeagent-server `docs/skills-store-api.md`（acb6240 引入）

设置 → Skills 的第三个 tab「技能市场（内部）」，浏览/安装组织内 Lab AI Hub 发布的技能。
服务端是 Hub 的 BFF 纯代理（不落库不镜像），客户端负责浏览 UI 与本地安装事务。

## 1. 架构与数据流

```
InternalStoreBrowser / InternalSkillCard / InternalSkillDetail   (renderer)
   │ window.electronAPI.skillsStore.{probe,list,detail,install,update,uninstall}
   ▼
electron/skills-store.ts        主进程胶水:hubFetch(Bearer token)+IPC+安装事务
electron/skills-store-fs.ts     解压/落位/台账 fs 层(无 electron 依赖,可单测)
electron/skills-store-core.ts   纯逻辑(错误归一/台账/目录名/zip 守卫,无 fs)
   │ GET /api/v1/skills[/{id}[/download]]  Authorization: Bearer <登录 token>
   ▼
codeagent-server(BFF,注入 userUuid、Hub per-app token 只在服务端)
   ▼
Lab AI Hub /open/skills*(数据权限判定全部在 Hub 侧)
```

**为什么走主进程 IPC 而不是 Next route（决策 D1）**：登录 token 只在主进程
（与问题反馈同边界，绝不下发 renderer / 嵌入式 Next）；zip 落盘解压也归主进程。
对照:外部市场（skills.sh）走 Next route + `npx skills` CLI,因其无鉴权、由外部 CLI 管安装。

## 2. 文件清单

| 文件 | 职责 |
|---|---|
| `electron/skills-store.ts` | hubFetch(token/超时/错误信封)、list/detail/probe、install/update/uninstall 事务、IPC 注册、变更串行化 |
| `electron/skills-store-fs.ts` | extractZip(yauzl+守卫)、replaceDirAtomic、skillsRootDir、loadLedgerHealed/saveLedger |
| `electron/skills-store-core.ts` | parseHubFailure、台账 parse/serialize/heal、mergeInstallState、resolveDirName、zip 守卫常量与判定 |
| `src/components/skills/internal/` | 三件套 UI（Browser 状态机/Card 徽章/Detail 动作与正文） |
| `src/components/skills/SkillsManager.tsx` | 第三 tab + probe 决定可见性（模块级会话缓存） |
| `src/app/api/skills/refresh/route.ts` | 技能发现缓存失效（主进程写盘后由 renderer 补一枪） |
| `src/types/electron.d.ts` | `skillsStore` IPC 面 + `InternalStoreSkill` DTO（只声明用到的字段） |
| `src/__tests__/unit/skills-store-{core,fs}.test.ts` | 核心分支单测 + 手工 zip 字节流驱动的解压/台账集成测试 |

## 3. 本地安装模型

- **安装根**：`~/.claude/skills/`（打包版 Claude Code 原生可加载，无需 reconcile 镜像）。
- **目录名（决策 D2）**：常态 = Hub `slug`；被占用（外部安装/用户自建/其他 skillId）时
  `{slug}--{skillId 前 8 位}`。刻意偏离服务端文档的「目录名用 cuid」建议——目录名即
  斜杠命令名，纯 cuid 不可读。台账 key 恒为 `skillId`，重装/更新沿用原目录名不漂移。
- **台账（决策 D3）**：`~/.claude/skills/.internal-store.json`（schema v1）：

```jsonc
{ "version": 1, "skills": { "<skillId(cuid)>": {
    "slug": "...", "dirName": "...", "displayName": "...",
    "contentHash": "...",          // 更新检查比对源
    "etag": "\"...\"",             // 下载响应 ETag 头原文(含引号) — If-None-Match 原样回传,勿拿 contentHash 拼
    "downloadVersion": 4, "installedAt": "ISO8601" } } }
```

- **自愈**：每次读台账校验 `<dirName>/SKILL.md` 存在，死条目移除并回写——用户从
  「我的技能」删除只动目录不动台账，靠这里兜底。损坏台账归零空账（只影响徽章，不伤已装文件）。
- **「我的技能」互通**：内部安装的技能以 `source:"installed", installedSource:"claude"`
  自然出现在 Installed 分组（`/api/skills` 每请求新鲜读盘）。其 DELETE 对 installed
  技能按**整目录**删除（Phase 3 修复；带根围栏），slug 随之释放。
- **安装事务**：详情预取元数据（下载响应无名称/版本，与服务端审计同款姿势）→ 流式下载
  临时文件（Content-Length 预检 + 实收计数双闸 50MB）→ 临时目录解压 → 内容根判定
  （SKILL.md 在 zip 根或唯一外壳目录内）→ `replaceDirAtomic` 落位（备份位+回滚）→ 写台账。
  任一步失败清临时产物不留半成品。install/update/uninstall 经 promise 链**串行化**
  （台账是读-改-写文件）。
- **更新三分支**：hash 相同 → 短路 `updated:false`；ETag 命中 304 → 只对齐台账
  （「不变不传」）；200 → 整目录替换。DEPRECATED（已下架）恒不提示更新、本地保留。

## 4. IPC 面与错误契约

`skillsStore.probe/list/detail/install/update/uninstall`（preload 透传,入参主进程重新收口）。
失败信封 `{ok:false, error, status?, retryAfter?, message?}`，**分支只认 error（code）**：

| error | 来源 | UI 行为 |
|---|---|---|
| `not-logged-in` | 主进程短路或 401 | 登录空态（可触发 triggerLogin） |
| `network` | fetch 失败/超时 | 通用错误 toast / 错误态 |
| `SKILLS_NOT_CONFIGURED` | 服务端 503（未配 Hub） | 隐藏整个 tab（probe/首拉均处理） |
| `HUB_UNAVAILABLE` | 502（Hub 不可用/凭证异常,服务端已报警） | 错误态 + 重试 |
| `RATE_LIMITED` | 429 + Retry-After | toast 带秒数 |
| `USER_NOT_ACTIVE` / `SKILL_NOT_VISIBLE` / `SKILL_NOT_FOUND` / `SKILL_NOT_DOWNLOADABLE` | Hub 业务码透传 | 对应提示；未知码走通用分支 |
| `INVALID_PACKAGE` / `DIR_CONFLICT` | 客户端自有（解压校验/落位冲突） | toast 技能包不合法 等 |

响应字段**可能新增**（契约承诺）：DTO 只声明用到的字段 + 索引签名透传，勿建全量模型。

## 5. 安全清单（方案 §8 落地位）

- token 不出主进程；IPC 入参主进程复验。
- zip：≤50MB 本体双闸、解压后总量 200MB、条目数 2000、symlink 条目拒绝
  （externalFileAttributes 高 16 位）、路径围栏双保险（yauzl 默认校验拒 `../`/绝对路径/
  反斜杠 + core 的 resolve 围栏）。POC 与单测均以恶意样本验证。
- 台账/目录写操作限定安装根内；卸载删目录前二次 resolve 围栏。

## 6. 验证方法

- **单测**：`npm run test`。fs 层用手工构造的 zip 字节流（stored + UTF-8 flag + unix
  mode，见 `skills-store-fs.test.ts` 的 buildZip，零外部依赖）驱动真实 yauzl 循环。
- **UI（CDP mock）**：`npm run dev` + initScript 注入假 `window.electronAPI.skillsStore`
  （本地无登录体系）。已覆盖:三 tab/四类徽章/搜索/真分页追加/错误与登录门禁/按钮态。
- **真实链路（本次已跑通,26 项断言）**：
  1. `docker start anlcode-postgres`；codeagent-server 仓 `uv run alembic upgrade head`；
  2. 假 JWKS(:9101,签 JWT) + 假 Hub(:9102,实现 `/open/skills*` OK 信封/ETag/304/zip)
     一个 node 脚本即可（契约照 `app/skills/client.py`）；
  3. `APP_AUTH_{ISSUERS,AUDIENCES,JWKS_URLS}` 指假 JWKS、`APP_SKILLS_HUB_*` 指假 Hub
     起 `uvicorn app.main:app --port 8080`；
  4. 驱动脚本直接 import `electron/skills-store.ts`（`Module._resolveFilename` 把
     `electron` 指到 shim），配三个 env：`BACKEND_BASE`、
     `CODEPILOT_SKILLS_TOKEN_OVERRIDE`（JWT）、`CODEPILOT_SKILLS_ROOT_OVERRIDE`（临时安装根）。
  已验：列表/搜索/详情/404 透传/安装落盘（中文文件名+台账 etag 原文）/更新三分支/卸载
  幂等/401→not-logged-in；服务端 `skill_download_logs` 恰好记 200 两条、304 不记。
  两个 `CODEPILOT_*_OVERRIDE` 环境变量是**测试注入口**，生产不设。

## 7. 已知局限

- 一期无 AI 翻译按钮、分类过滤、view=store/own 切换、updatedAfter 增量（D6，按需二期）。
- 无「全部更新」批量操作；更新检查依赖用户打开列表（无后台轮询）。
- 台账无锁文件跨进程保护（仅主进程内串行化）；多开应用实例并发安装为未定义行为
  （与全应用单实例假设一致）。
- 安装的技能对话内可用依赖 Claude Code 会话重建（SDK 子进程启动时扫盘）；`/api/skills/refresh`
  只失效应用侧发现缓存。
