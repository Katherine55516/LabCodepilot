# 沙箱定时任务（服务端调度 · 对标 Claude Routines）— 技术交接文档

> **本文件的目标：读完这一份就能完整恢复上下文并无缝接上后续开发，不必回看会话记录。**
> 最后更新：2026-08-05 · 分支 `scheduler` @ `2c82e71`（P5 完成，**未推送**）
> 执行计划（进度/决策/验收）：[docs/exec-plans/active/cowork-scheduled-routines.md](../exec-plans/active/cowork-scheduled-routines.md)
> 调研与设计：[research/cowork-server-side-routines.md](../research/cowork-server-side-routines.md)（服务端实读 + 客户端设计）·
> [research/cowork-scheduled-routines.md](../research/cowork-scheduled-routines.md)（Claude 三套调度辨析 + U1-U15 验收清单）
> 交互原型（七屏 v2）：[research/prototypes/scheduled-routines-prototype.html](../research/prototypes/scheduled-routines-prototype.html)
> 底座：[handover/cowork-vm-mode.md](cowork-vm-mode.md)（办公模式远程容器沙箱）
> ⚠️ 产品思考文档（`docs/insights/cowork-scheduled-routines.md`）**尚未写**，属 P9 的交付项。

---

# §A 一分钟恢复（接手先读这一节）

## A.1 这是什么

给办公模式加**定时任务**，对标 Claude 云端 Routines。核心差异化在于：**任务跑在公司沙箱服务器上，
关掉客户端、关掉电脑都照常运行**。客户端不参与执行，只做**管理 / 拉取 / 展示**。

跨三个仓库：`LabCodepilot`（客户端 + 沙箱控制面）、`codeagent-server`（账号后端）。

## A.2 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 技术验证（生产真机验 `claude -p`） | ✅ 完成 |
| P1 | 账号后端内部凭证接口 | ✅ **已上线生产** |
| P2 | 沙箱执行器 `routine-runner` | ✅ **已上线生产** |
| P3 | 沙箱调度 + 存储 + REST | ✅ **已上线生产** |
| P4 | 客户端数据层 + 代理路由 | ✅ 完成（无 UI） |
| P5 | 客户端同步与物化 | ✅ 完成（无 UI） |
| **P6** | **客户端 UI 三层** | 📋 **下一步，见 §I** |
| P7 | 创建入口（MCP / 存为定时）+ 通知 + i18n | 📋 依赖 P6 |
| P8 | 加固与运维（配额/审计/手册） | 📋 |
| P9 | 端到端 + 双文档 + 打包验收 | 📋 |

## A.3 现在这个功能已经能干什么

**服务端整条链路是活的。** 现在用 curl 就能建一个定时任务，到点它会自己在沙箱里跑完整的
agent 回合、产出文件、记录历史 —— 全程不需要任何客户端。已在生产上实测过（§K.3）。

**客户端的数据链路也通了**：P4 铺好数据层与 `/api/routines/*` 代理，P5 做完拉取与物化 ——
`POST /api/routines/sync` 一调，服务端的运行就变成本地会话（幂等、失败也物化、不进办公列表）。

**但还看不到任何界面**（P6 才做）。现在只能用 curl 打 `/api/routines/sync` 验证。

## A.4 下一步

**P6：客户端 UI 三层。** 具体怎么做见 §I，那一节是自足的施工说明。

---

# §B 仓库 / 分支 / commit

| 仓库 | 分支 | HEAD | 与 GitHub |
|---|---|---|---|
| `LabCodepilot` | **`scheduler`**（本功能全部工作在这） | `2c82e71` | ⬆️ 领先远端 2 个 commit（P5 + 交接文档，待推送） |
| `LabCodepilot` | `para`（scheduler 的父分支） | `537173f` | 已同步 |
| `codeagent-server` | `main` | `99c044d` | 已同步 |

`scheduler` 从 `para` 拉出，本功能的 commit（新→旧）：

```
2c82e71 feat(client): P5 定时任务同步与物化 —— 服务端运行变成本地会话
24bc996 docs(handover): 沙箱定时任务交接文档
21dc1fe feat(client): P4 定时任务数据层 + 代理路由
5b9e1b7 fix(cowork-server): 账号配置的角色模型没过河
904fb1d docs(exec-plan): P3 代码完成
b24db74 feat(cowork-server): P3 调度 + 存储 + REST(selftest-r5 37 项全过)
c9e8e08 feat(cowork-server): P2 执行器 — 服务端自主跑完一轮 agent
435495a docs(exec-plan): P1 代码完成
5f1423b docs(exec-plan): P0-P9 完整执行计划
0ffae2d docs(research): 原型 v2 — 定时任务会话从办公对话列表中分离
735b4e6 docs(research): 16 条决策登记 + 七屏原型
51c476f Merge branch 'para' into scheduler
513bc8f / cc3592b / ab461fd / 8fa2f32   docs(research): S0 实测与三份调研
```

⚠️ 仓库根目录有一批 **untracked 的用户自有文件**（`cmwork-feature-deck.html`、`docs/user-manual/`、
`preload.js`、`remote-sandbox-*.html` 等）。**commit 时绝不 `git add -A`**（历史踩过）。

---

# §C 架构：一次定时运行是怎么发生的

```
                    ┌───────────────── 沙箱服务器（香港，cowork-prod）─────────────────┐
                    │                                                                  │
   ① 60s tick       │  routine-scheduler.mjs                                           │
                    │    扫 /data/cowork-state/routines/<uid>/*.json                    │
                    │    到点 && enabled && 过配额闸 && 未在跑                           │
                    │             ↓                                                     │
   ② 取凭证         │  backend-credentials.mjs ──HMAC(uid=__sandbox__, exp≤60s)──┐      │
                    │                                                            │      │
   ③ 喂 cred-proxy  │  cred-proxy.mjs ──docker exec stdin──▶ cowork-proxy 容器    │      │
                    │    （真 key 只进 proxy 的 tmpfs，不落宿主盘、不进会话容器）  │      │
                    │             ↓ 返回一次性 cwk_ token                          │      │
   ④ 起容器         │  orchestrator.ensureContainer(sid, uid, kind='routine')     │      │
                    │             ↓                                               │      │
   ⑤ 跑             │  routine-runner.mjs                                         │      │
                    │    docker exec -i -u 1000 … python3 cowork-shim.py --        │      │
                    │      -p "<prompt>" --output-format stream-json --verbose      │     │
                    │      --dangerously-skip-permissions --model <账号配置>         │     │
                    │    stdin 写 4 字节零长帧 = 优雅 EOF                            │     │
                    │             ↓ stream-json                                     │     │
   ⑥ 落盘 + 废凭证  │  runs/<runId>.jsonl + <id>.runs.jsonl；revokeCredentials      │     │
                    └───────────────────────────────────────────────────────────┼──────┘
                                                                                 │
                    ┌──────────── 账号后端 codeagent-server ──────────────────────┘
                    │  GET /api/v1/internal/cowork/model-credentials?uid=&config_id=
                    │    复用 ConfigService.list_for_client（套餐门控）
                    │       + ApiKeyService.ensure_active（懒建 new-api key）
                    └────────────────────────────────────────────────────────────

   ⑦ 客户端（P5 已做）：拉 /routines/:id/runs?since=<水位线> → 取 transcript → 重放成
      chat_sessions + messages（**但不进办公对话列表**，只能从「定时任务」页进）
      入口 POST /api/routines/sync；幂等键 = routine_run_id；失败与拿不到原文都照样物化
```

**最关键的一条认知**：办公模式的交互回合里 **agent loop 在客户端**（SDK 在 Next server 里跑，
服务端只是转发器的哑管道）；而定时任务 **agent loop 在服务端**。这是两条不同的执行路径，
`routine-runner.mjs` 与 `exec-bridge.mjs` 各管一条，别混。

---

# §D 生产实况与运维速查

## D.1 现状（2026-08-05 核准）

```
服务       cowork-server=active  cowork-egress=active  重启次数 0
sidecar    cowork-proxy running  |  egress 规则 5 条
受管资产   21 容器 / 40 卷（真实用户的，勿动）
state      /data/cowork-state  drwx------ cowork:cowork
现存 routine  0 个
.env       COWORK_STATE_DIR / COWORK_BACKEND_URL / COWORK_INTERNAL_SECRET  3/3 已配
部署漂移   43/43 一致（仅 2 个已知无害存量差异，见 D.3）
```

## D.2 速查命令

```bash
ssh cowork-prod                                     # 上机
systemctl status cowork-server cowork-egress
journalctl -u cowork-server -f                      # 日志（含 routine 调度）
docker ps -a --filter label=cowork.kind=routine     # 只看定时任务的容器
find /data/cowork-state/routines -name '*.json'     # 现存 routine
apps/cowork-server/deploy/verify-deployment.sh      # 【开发机跑】部署漂移检测
```

**手工触发一次（排障入口）**：
```bash
ssh cowork-prod 'cd /opt/cowork-server; set -a; . ./.env; set +a
  node routine-once.mjs --uid <用户UUID> --prompt "..." --transcript /tmp/x.jsonl'
```

**验密钥配对**（不打印 key；⚠️ 必须用一个**确定能正常用办公模式**的 uid，否则 404 有歧义）：
```bash
ssh cowork-prod 'cd /opt/cowork-server; set -a; . ./.env; set +a
  node -e "import(\"./lib/backend-credentials.mjs\").then(async m=>{try{const c=await m.fetchModelCredentials(process.argv[1]);console.log(\"✅\",c.configName,c.realBase);}catch(e){console.log(\"❌\",e.reason,e.message);}})" <用户UUID>'
```

## D.3 两个已知的无害漂移（别去"修"）

`client/forwarder-remote.mjs` 与 `lib/admin.mjs` 在生产上比仓库旧：
- `admin.mjs` 只差一行注释
- `forwarder-remote.mjs` 在**客户端**执行，服务器上那份是 deploy 时顺带 scp 的死文件，从不运行

方向都是**仓库领先**，无生产独有代码。要清就一条 scp 的事，不清也无害。

## D.4 密钥体系（三把，别搞混）

| 密钥 | 在哪 | 作用 |
|---|---|---|
| `COWORK_AUTH_SECRET` | 沙箱 `.env` + 账号后端 `service_secrets`/env | 签发**用户** token（客户端访问沙箱） |
| `COWORK_INTERNAL_SECRET` | 沙箱 `.env` ↔ 账号后端 `APP_COWORK_INTERNAL_SECRET` | 沙箱**反向**取模型凭证。**必须与上一把不同值** |
| `__admin__` token | 账号后端用 `COWORK_AUTH_SECRET` 自签 | 用量后台拉 `/admin/audit` |

**为什么第二把要独立**：沙箱是跑不可信 agent 代码的机器，被攻破概率天然高。复用同一把会让
「攻破沙箱」从「冒充用户访问沙箱」升级为「批量导出全体用户的模型 API key」—— 质变而非量变。

---

# §E 已拍板的 16 条决策（**别再重新讨论**）

| # | 决定 |
|---|---|
| D1 | 谁敲钟 = **服务端调度**（跑沙箱服务器，不占用户电脑） |
| D2 | **routine 独占一个持久 workspace**，多次运行状态累积 |
| D3 | 凭证走 RD4-C：服务端向账号后端直取 |
| D4 | 凭证接口用**独立密钥** + 强制 `exp ≤ 60s` + 审计 + 频控 |
| D5 | ~~P1 等指示再启动~~（已完成） |
| D6 | 最小调度间隔 **15 分钟** |
| D7 | 并发上限 **4** |
| D8 | 每用户日配额 **20 次/天** |
| D9 | 建 routine 时可选模型，默认取账号下发配置的**第一个** |
| D10 | 一次性 routine 触发后**自动禁用 + 标记「已运行」** |
| D11 | 连续失败 **10 次自动 disable** |
| D12 | 运行历史**暂时永久保留** |
| D13 | routine 数量上限 **每用户 50 个** |
| D14 | 离线期间**不推送**，打开 app 时汇总呈现 |
| D15 | routine **不能访问内网**（维持 egress 拒私网四段） |
| D16 | 旧 `src/lib/task-scheduler.ts`（界面早已隐藏）待新功能稳定后单独起 PR 清理 |

**另一条来自用户反馈的关键改版**：定时任务产生的会话**不进办公对话列表**（原设计放进列表 +
加「定时」分组，用户否掉：「很乱很疑惑」）。改法是拆开**存储复用**与**导航归属** ——
仍物化成 `chat_sessions`（渲染/产物/下载整套零成本复用），但列表查询排除，只能从
「定时任务」页经**三层面包屑**进入。

---

# §F 🔴 三条红线（碰了就是线上事故）

## F1. reconcile 不能删 routine 的工作区
客户端调 `/reconcile` 时传 `keep` 列表，而客户端**根本不知道 routine 的 sid**（那是服务端实体）。
不排掉的话，**用户每打开一次 app 就清空一次自己所有定时任务的累积文件**。

已实现：容器与卷打 `cowork.kind=routine` 标签，`orch.reconcile()` 走
`listSessions(uid, { excludeKind: 'routine' })`。docker 没有「label 不等于」过滤器，
只能正查一次再做差集。`selftest-r5` 第 3 组真建卷、真跑 reconcile 锁住这条。

## F2. TTL 不能回收跑到一半的容器
reaper 只认 WS 连接（`execOpened`/`execClosed`），而定时任务是服务端 `docker exec` 发起的，
不经过 WS。已实现：`index.mjs` 的 `ROUTINE_ACTIVITY = { start: execOpened, end: execClosed }`
传给 runner 与调度器。`selftest-r5` 用正则断言这两处接线在位，防止重构时被摘掉。

## F3. 办公对话列表必须排除 `routine_id`
`src/lib/db.ts` 有**两处**取数口，漏一处就退回用户否掉的那个体验：
- `SESSION_VISIBLE_WHERE`（列表）
- `searchMessages` 的 SQL（搜到一条列表里看不到的会话 = 死路；LEFT JOIN 下要容忍 `IS NULL`）

`routine-session-isolation.test.ts` 10 项锁住。

---

# §G 已经踩过的坑（**别再踩一遍**）

| # | 坑 | 现象 / 教训 |
|---|---|---|
| G1 | **`result.subtype` 是陷阱** | 401 全程失败的回合，最后一条仍是 `subtype:"success"`。判定必须用 `exitCode===0 && !is_error && api_error_status==null`，**绝不读 subtype** |
| G2 | **坏凭证不快速失败** | 401 触发 10 次指数退避，实测烧 **181 秒**。runner 见首条 `api_retry(401)` 立即 kill（实测降到 3 秒）。非 401 的 retry（429/5xx）**放行** |
| G3 | **`--` 之后不能再写 claude 二进制路径** | `cowork-shim.py` 自己会 `Popen([CLAUDE_BIN] + argv)`。多写一次会让它变成第一个位置参数，而 `-p` 是布尔开关、prompt 走位置参数 → 路径成了 prompt，用户指令被丢掉。**回合照样 exit=0 / success / 花掉 $0.39**，只有读输出才发现 |
| G4 | **必须走 shim** | 绕开直连 claude 会丢掉全部 5 个办公 skill（实测 14 vs 19）。HOME 是 tmpfs，skill 靠 shim 每次启动软链 |
| G5 | **账号的角色模型不会自动过河** | 首次端到端跑在容器内置默认模型上（账号配的是 `qwen3.7-max[1m]`，实际跑 `claude-opus-4-8[1m]`），网关恰好放行所以没报错。已注入 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` 等 |
| G6 | **`/data` 是 root:root，服务非 root 跑** | `ensureStateDir()` EACCES → 服务一切正常但**定时任务永远不触发**。`install.sh` 已建目录并 chown；`index.mjs` 该失败改为显式吼两行 |
| G7 | **自检会污染生产审计日志** | `audit.mjs` 在**模块加载时**读 `COWORK_AUDIT_FILE`，必须在任何 import 之前设。曾写进去 2 行 `r5probe` 事件（已留档不改，append-only） |
| G8 | **`readBody` 返回原始字符串不是 JSON** | `index.mjs` 的既有调用方都自己 parse。当对象用会让所有字段读成 undefined，表现是创建全报「name is required」 |
| G9 | **selftest-r1..r4 会清场** | 它们 reconcile 掉全部受管容器与网络，**有活跃用户时绝不能跑**。`selftest-r5` 刻意不清场，可在生产跑 |
| G10 | **远端命令里的 glob 会被远端 shell 展开** | `verify-deployment.sh` 拼 ssh 命令时必须 `printf '%q '` 转义模式，用 `%s` 会让 `.env*` / `*.log` 提前展开、find 静默失效 |

---

# §H 文件地图

## H.1 沙箱服务端 `apps/cowork-server/`（**新增/改动**）

| 文件 | 职责 |
|---|---|
| `lib/routine-store.mjs` | 文件型存储（`/data/cowork-state`）。**不引新依赖** —— 控制面运行时只依赖 `ws` |
| `lib/routine-cron.mjs` | **时区感知**的 cron 求值 + 确定性抖动 + 最小间隔校验。按天粗筛再扫分钟，实测 0-3ms |
| `lib/routine-scheduler.mjs` | 60s tick、补跑（只补最近一次）、日配额、连续失败自动停用、`runNow` |
| `lib/routine-runner.mjs` | 执行器：四护栏（401 立即中止 / 15min 超时 / 8MB 输出 / 并发 4）+ 成败判定 + 用后即废凭证 |
| `lib/backend-credentials.mjs` | 向账号后端取凭证，失败按 6 类归因 |
| `lib/routine-api.mjs` | REST 八端点 + 校验（数量上限 / 最小间隔 / 时区 / 一次性时刻） |
| `lib/orchestrator.mjs` | **改**：加 `cowork.kind` 标签 + `listSessionsOfKind` + reconcile 排除（F1） |
| `index.mjs` | **改**：路由接线 + `ROUTINE_ACTIVITY`（F2）+ 启动调度器 |
| `routine-once.mjs` | 手工触发 CLI（验收工具 + 排障入口），支持 `COWORK_TEST_REAL_*` 绕开账号后端联调 |
| `selftest-r5.mjs` | **37 项**，不清场，可在生产跑 |
| `deploy/install.sh` | **改**：建 state 目录并 chown（G6） |
| `deploy/verify-deployment.sh` | 部署漂移检测（开发机跑） |

### 服务端 REST（uid 从 HMAC token 取，跨用户一律 404）
```
GET/POST     /routines                列表 / 创建
GET/PATCH/DELETE /routines/:id        取 / 改 / 删（连容器+卷）
POST         /routines/:id/run        立即运行（429 + reason 表示被限）
GET          /routines/:id/runs?since=&limit=
GET          /runs/:runId/transcript  stream-json 原文
```

### 存储布局
```
$COWORK_STATE_DIR (默认 /data/cowork-state)
├── routines/<uid>/<routineId>.json        定义 + 调度状态（.tmp + rename 原子写）
├── routines/<uid>/<routineId>.runs.jsonl  运行历史（append-only，永久保留）
└── runs/<runId>.jsonl                     transcript 原文
```
**routineId 就是 sid**（32 hex），所以 routine 天然拥有独立容器 `cowork-<id>` 和持久卷
`cowork-ws-<id>` —— orchestrator / 文件通道 / 归属校验 / 删除全部零改动可用。

## H.2 账号后端 `codeagent-server/`

| 文件 | 职责 |
|---|---|
| `app/cowork/internal.py` | `GET /api/v1/internal/cowork/model-credentials`，六道闸 |
| `app/cowork/service.py` | **改**：`verify_sandbox_token()` + `resolve_internal_secret()` + `SANDBOX_UID` |
| `app/cowork/schemas.py` | **改**：`ModelCredentialsResponse` / `DefaultModels` |
| `app/config.py` / `deps.py` / `main.py` | **改**：`APP_COWORK_INTERNAL_SECRET` 接线 |
| `tests/cowork/test_internal_credentials.py` | **21 项**，重心在「什么情况下必须闭嘴」 |
| `docs/cowork-internal-credentials-api.md` | 契约 + 安全论证 + golden 向量 + 部署自检 |

## H.3 客户端 `LabCodepilot/src/`（P4 + P5 已交付）

| 文件 | 职责 |
|---|---|
| `lib/db.ts` | **改**：`cowork_routines` 缓存表 + `chat_sessions` 两列 + F3 过滤 + 幂等键查询；**P5 加**：水位线读写、`purgeCoworkRoutines` 连带清、`getSessionsByRoutine` 的 rowid 兜底排序 |
| `types/index.ts` | **改**：`CoworkRoutine` / `RoutineRun` / `RoutineSchedule` |
| `lib/routines-client.ts` | 沙箱 REST 客户端（复用 `cowork_remote_url/token`，不引新配置） |
| `lib/routines-route-helpers.ts` | 错误映射（Next 的 route.ts **只允许导出 handler**，共享逻辑必须外置） |
| `app/api/routines/**` | 五个代理路由（含 P5 的 `sync`），**token 留 Next server 绝不进 renderer** |
| `lib/claude-content-blocks.ts` | **P5 新建**：内容块归一化，与 `claude-session-parser.ts` 共用一份 |
| `lib/routine-transcript.ts` | **P5 新建**：stream-json 原文 → 消息。纯函数 |
| `lib/routine-sync.ts` | **P5 新建**：拉取 + 幂等物化 + 汇总。网络层依赖注入 |
| `__tests__/fixtures/routine-transcripts/` | **P5 新建**：生产取回的两份真实原文（黄金样本，别改） |
| `__tests__/unit/routine-session-isolation.test.ts` | 10 项，锁 F3 |
| `__tests__/unit/routine-transcript.test.ts` | **P5**：16 项，重放形状 + G1 陷阱 + 失败必须被看见 |
| `__tests__/unit/routine-sync.test.ts` | **P5**：15 项，幂等 / 排序 / 降级 / 失败兜底 |

### P5 的四条口径（改同步逻辑前先读）

1. **成败以服务端 run 记录为准**，客户端不重算。原文里的 `result` 只作补充展示 ——
   在客户端再判一次等于给 G1 重开一个口子。
2. **拿不到原文是正常输入**。`credential_error` 在容器起来之前就失败了，服务端根本没写
   transcript，拉取必然 404 —— 这类失败恰恰最需要被看见，必须照样物化。
3. **`skipped` 不物化**（并发满 / 配额用尽 / 上次没结束，无任何产出）。它仍出现在服务端的
   运行历史里，那才是它该待的地方。给它建空会话只会在列表里堆没内容的条目。
4. **从旧到新物化**。`getSessionsByRoutine` 按 `created_at DESC` 排，而 created_at 是物化
   时刻；服务端返回的是新→旧，照单全收会让本地顺序跟真实运行顺序反过来。

### 关键 DB 契约
```sql
-- chat_sessions 两列（'' 而非 NULL 作缺省，与 owner_uid 等既有列一致）
routine_id      TEXT NOT NULL DEFAULT ''   -- 非空 = 定时运行物化而来，不进办公列表
routine_run_id  TEXT NOT NULL DEFAULT ''   -- 物化幂等键

-- 可用的函数
markSessionAsRoutineRun(sessionId, routineId, runId)
getSessionsByRoutine(routineId) -> ChatSession[]     -- 第二层页面取数
getSessionByRoutineRun(runId)   -> ChatSession|undefined  -- 物化前必查
listCoworkRoutines() / getCoworkRoutine(id) / replaceCoworkRoutines(rows) / purgeCoworkRoutines()
```

### 客户端代理路由的响应约定
| 情况 | 响应 |
|---|---|
| 正常 | `{routines:[...], offline:false}` |
| 沙箱不可达 | `{routines:[缓存], offline:true, error}` → UI 挂横幅 + **禁止新建/编辑** |
| 未开通 | **503 + `{reason:'not_provisioned'}`** → UI **隐藏整个入口**（不是置灰） |
| 服务端校验失败 | 原样透传 400 + 中文消息（如「触发间隔 5 分钟,低于最小间隔 15 分钟」） |

---

# §I 下一步：P6 客户端 UI 三层（施工说明）

**目标**：把七屏原型落地。数据链路已经全通（P4 管理 + P5 物化），P6 只做「看得见」这一层。

> 原型是唯一的形态依据：[research/prototypes/scheduled-routines-prototype.html](../research/prototypes/scheduled-routines-prototype.html)（v2，七屏，明暗都有）。
> 开工前**在浏览器里打开看一遍**，比读任何描述都快。

## I.1 数据都已经备好了，别重造

| 要什么 | 用什么 | 备注 |
|---|---|---|
| routine 列表 | `GET /api/routines` | 已带 `offline` 标记与本地缓存兜底 |
| 建 / 改 / 删 / 立即跑 | `POST /api/routines`、`PATCH·DELETE /api/routines/:id`、`POST /api/routines/:id/run` | 400/429 的中文消息**原样透传**，直接显示 |
| 运行历史（第二层的表） | `GET /api/routines/:id/runs` | 服务端权威，含 `skipped` 及原因 |
| 某次运行的对话（第三层） | `getSessionsByRoutine(routineId)` → `getSessionByRoutineRun(runId)` → 现有会话渲染组件 | **不要另写渲染器**，物化出来的形状与实时回合一致 |
| 拉新运行 | `POST /api/routines/sync` | 恒 200，成败看 body。返回 `summary` 就是那条汇总文案 |

**同步触发点要在 P6 接上**（P5 只提供了能力）：app 启动、打开定时任务页、每 10 分钟
（对齐现有 cowork config 的同步节奏）。`summary` 非 null 时才提示，且**只提示一条**（D14）。

## I.2 要建的文件

| 文件 | 内容 |
|---|---|
| `components/routines/RoutinePanel.tsx` | 三层容器 + 面包屑（① 列表 →② 详情+运行历史 →③ 某次运行） |
| `components/routines/RoutineList.tsx` | 卡片列表 + 顶部配额与 `n/50` |
| `components/routines/RoutineForm.tsx` | 新建/编辑：名称・描述・指令・模型・调度 |
| `components/routines/SchedulePicker.tsx` | 六个预设 + 高级 cron |
| `components/routines/RoutineDetail.tsx` | 配置摘要 + 运行历史表 |
| `components/routines/RoutineRunView.tsx` | 只读回放 + 产物卡片 + 「← 上一次 / 下一次 →」 |
| `components/layout/ChatListPanel.tsx` | **改**：办公 tab 加入口按钮 |

## I.3 四条不能走样的（都是用户明确定过的）

1. **入口位置与文案**：侧边栏在「文生图」**下方竖排**，文字就是「定时任务」四个字 ——
   不并排、不简写。（用户看原型 v1 后当场提的两点修改之一）
2. **办公对话列表不加任何「定时」分组**。定时任务的会话只能从这个页面经三层进入。
   用户否掉混排的原话是「很乱很疑惑」，加个分组等于把否掉的东西换个样子放回去。
3. **调度预设只给六个**：仅手动 / 每小时 / 每天 / 工作日 / 每周 / 指定时间跑一次。
   cron 收进「高级」。**预设里不提供 <15 分钟的选项**（D6：给了用户选、服务端再报错，
   是自己制造挫败）。
4. **未开通 → 整个入口不渲染**，不是置灰（沿用 R5-6 已定原则）。判定看
   `/api/routines/sync` 或列表接口返回的 `notProvisioned`。

## I.4 离线降级

列表用本地缓存渲染 + 顶部横幅，**禁止新建和编辑**（本地改了会与服务端分叉；与其事后合并
冲突不如当场说清楚）。已物化的历史会话照常能看 —— 那是本地数据，不受沙箱可达性影响。

## I.5 验收

- CDP 逐屏验证四个界面 + 三层面包屑跳转，console 无报错
- 明暗主题各验一遍；`npm run lint:colors` 通过（禁止裸色值）
- `npm run test` + `npm run test:smoke` 全绿
- ⚠️ 本地 dev **没有登录体系**，`cowork_remote_url/token` 为空 → 接口会走
  `notProvisioned` 分支。验渲染与过滤逻辑要用 mock（CDP 注入 `fetch` 拦截
  `/api/routines/*` 返回模拟数据），结论要按「验的是逻辑不是真实数据」表述。

---

# §J P7–P9 概要

（P6 是下一步，施工说明在 §I。）

| 阶段 | 要点 |
|---|---|
| **P7** 创建入口 | `routines-mcp.ts` 五工具（**只在办公会话注册**）+「存为定时任务」+ 三语 i18n（⚠️ zh-HK 手工加，别跑 `gen-zh-hk.mjs`）。🔴 **MCP 创建成功的回复必须明说「结果会出现在左侧『定时任务』里，不会打扰这个对话」** —— 结果不再落进当前对话是改版引入的新失败模式 |
| **P8** 加固 | per-uid 日配额已在 store 备好（`countRunsSince`，刻意排除 skipped 防自锁死）；补 `routine_*` 审计进用量管线、`OPERATIONS.md` 章节 |
| **P9** 收尾 | 端到端 + **双文档**（本文件补完 + `docs/insights/cowork-scheduled-routines.md` 并互相反链）+ **打包态验收**（本地 dev 无登录体系、managed 数据为空，凭证链路必须打包后登录才完整） |

---

# §K 验证手册（怎么确认它还活着）

## K.1 服务端健康
```bash
ssh cowork-prod 'systemctl is-active cowork-server; journalctl -u cowork-server --no-pager -o cat | grep "routine scheduler started" | tail -1'
```
看到 `routine scheduler started (tick=60000ms concurrency=4 dailyCap=20)` 即正常。

## K.2 自检
```bash
ssh cowork-prod 'cd /opt/cowork-server && unset COWORK_AUTH_SECRET COWORK_SERVER_TOKEN COWORK_STATE_DIR COWORK_AUDIT_FILE && node selftest-r5.mjs'
```
期望 `✅ 全部通过 — 37 passed, 0 failed`。**不清场，可在生产跑**（仍建议低峰）。

## K.3 真实端到端（会花掉约 $0.1 + 1 次日配额）
```bash
ssh cowork-prod 'cd /opt/cowork-server; set -a; . ./.env; set +a
U=<一个能正常用办公模式的用户UUID>
T=$(sudo -u cowork sh -c "set -a; . /opt/cowork-server/.env; node /opt/cowork-server/sign-token.mjs $U" | tail -1)
H=172.24.185.132:8790
RID=$(curl -s -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d "{\"name\":\"核验\",\"prompt\":\"在当前目录创建 ok.txt 内容写 OK,然后 ls\",\"schedule\":{\"kind\":\"manual\"}}" \
  "http://$H/routines" | python3 -c "import sys,json;print(json.load(sys.stdin)[\"id\"])")
curl -s -X POST -H "Authorization: Bearer $T" "http://$H/routines/$RID/run"; sleep 25
curl -s -H "Authorization: Bearer $T" "http://$H/routines/$RID/runs" | python3 -m json.tool | head -20
curl -s -X DELETE -H "Authorization: Bearer $T" "http://$H/routines/$RID"     # 记得清理'
```

## K.4 客户端
```bash
npm run test                                          # 期望 2677 passed, 0 failed, 1 skipped
npx tsx --test src/__tests__/unit/routine-session-isolation.test.ts   # 10 项，锁 F3
npx tsx --test src/__tests__/unit/routine-transcript.test.ts          # 16 项，重放形状 + G1
npx tsx --test src/__tests__/unit/routine-sync.test.ts                # 15 项，幂等 + 降级
apps/cowork-server/deploy/verify-deployment.sh        # 期望 43/43，仅 2 个已知漂移
```

**物化链路的手工验证**（需要打包版并已登录 —— 本地 dev 没有登录体系，token 为空）：
```bash
curl -X POST http://localhost:3000/api/routines/sync   # 看 materialized / summary
```

---

# §L 未决与待办

## L.1 需要决策
1. **内部凭证接口没有 admin 配置页** —— 另外三项 cowork 配置（地址/签发密钥/开关）都能在 admin
   「办公沙箱」页改且即时生效，`internal_secret` 只能改 env + 重建容器。是否补齐？
2. **该接口的 404 有歧义** —— 「token 不合法」和「该用户无可用配置」返回同一个 404（防探测）。
   收益有限（没密钥的人本来什么都拿不到），但很坑运维。是否改成 401 / 404 分开？
3. **旧 `task-scheduler.ts` 的清理 PR 时机**（D16 已定「新功能稳定后」，具体待定）
4. **建 routine 时若指令含内网地址**：创建前拦截，还是只提示？（D15 已定不可访问内网）

## L.2 已知遗留
- 生产审计日志有 2 行 `r5probe` 的自检事件（G7），append-only 不修改，uid 一眼可辨
- 生产 `/opt/cowork-server/` 下有两个 `.env.bak-*`（改配置时的备份，含密钥，已从漂移检测排除）
- `docs/insights/cowork-scheduled-routines.md` 未写（P9 交付项，CLAUDE.md 强制要求与本文互链）

## L.3 工作方式的一条约定（用户提出）
改源码**默认用编辑工具**而不是 python/sed 脚本 —— 后者会绕过文件状态跟踪、可能静默失败
（`str.replace` 找不到目标时不吭声）、且改动不直观。只有跨多文件的机械替换才用脚本，
且**每个替换必须带 `assert`**。
