# 沙箱定时任务（服务端调度 · 对标 Claude Routines）— 技术交接文档

> **本文件的目标：读完这一份就能完整恢复上下文并无缝接上后续开发，不必回看会话记录。**
> 产品思考见 [docs/insights/cowork-scheduled-routines.md](../insights/cowork-scheduled-routines.md)
> 最后更新：2026-08-10 · 分支 `scheduler` @ `3d461cc`（**P9 完成，功能全部交付**，未推送）
> 执行计划（进度/决策/验收）：[docs/exec-plans/completed/cowork-scheduled-routines.md](../exec-plans/completed/cowork-scheduled-routines.md)
> 调研与设计：[research/cowork-server-side-routines.md](../research/cowork-server-side-routines.md)（服务端实读 + 客户端设计）·
> [research/cowork-scheduled-routines.md](../research/cowork-scheduled-routines.md)（Claude 三套调度辨析 + U1-U15 验收清单）
> 交互原型（七屏 v2）：[research/prototypes/scheduled-routines-prototype.html](../research/prototypes/scheduled-routines-prototype.html)
> 底座：[handover/cowork-vm-mode.md](cowork-vm-mode.md)（办公模式远程容器沙箱）

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
| P6 | 客户端 UI 三层 | ✅ 完成（含三语 i18n） |
| P7 | 创建入口（MCP / 存为定时） | ✅ 完成 |
| P8 | 加固与运维（配额/审计/手册） | ✅ 完成 |
| P9 | 端到端 + 双文档 + 验收 | ✅ **完成**（2026-08-10，见 §K.5） |

**功能已全部交付。** 后续工作只剩 §L 的未决项与清理，没有未完成的施工。

## A.3 现在这个功能已经能干什么

**服务端整条链路是活的。** 现在用 curl 就能建一个定时任务，到点它会自己在沙箱里跑完整的
agent 回合、产出文件、记录历史 —— 全程不需要任何客户端。已在生产上实测过（§K.3）。

**客户端的数据链路也通了**：P4 铺好数据层与 `/api/routines/*` 代理，P5 做完拉取与物化 ——
`POST /api/routines/sync` 一调，服务端的运行就变成本地会话（幂等、失败也物化、不进办公列表）。

**界面也做完了**：侧边栏「文生图」下方的「定时任务」入口 → 三层导航（列表 / 详情+运行历史 / 某次运行的
只读回放）。第三层直接复用现有聊天渲染，工具调用折叠、Markdown、产物下载全都现成。

**三条创建路径都通了**：定时任务页点「新建」/ 办公对话里说一句（`codepilot-routines` 五工具，
只在办公会话注册）/ 办公会话顶栏「存为定时任务」（用最后一条指令预填）。

⚠️ **本机定时任务工具已按用户决定下线**（`codepilot_schedule_task` 等三个）。它们建的任务跑在
用户电脑上、关机就不跑，而那套界面早已隐藏 —— 与沙箱定时任务并存时模型会挑错，且挑错的表现是
「已创建」而非报错。**两条通往模型的路径都删干净了**（MCP 与 native runtime 的 AI SDK 各一份），
`routines-mcp.test.ts` 按路径列举锁住。引擎 `task-scheduler.ts` 与 `/api/tasks/*` 暂留（见 §L.2）。

## A.4 下一步

**施工已结束**，剩下的都不是这个功能的欠账：

1. §L.1 的四项未决（内部凭证接口的 admin 页 / 404 歧义 / 旧调度器清理时机 / 内网地址拦截策略）
2. 用量后台**前端**还没展示 P8 加的 routine 字段（后端已回，加字段向后兼容）
3. 分支未推送（`scheduler` 与 codeagent-server 的 `main` 都领先远端，等用户指示）

✅ **服务端改动已全部上生产**（2026-08-10 核准）：`verify-deployment.sh` 报 45/45 源码完全一致，
`selftest-r5` 在生产上 **49 passed / 0 failed**（P8 加了第 5 组后从 37 增至 49）。

---

# §B 仓库 / 分支 / commit

| 仓库 | 分支 | HEAD | 与 GitHub |
|---|---|---|---|
| `LabCodepilot` | **`scheduler`**（本功能全部工作在这） | `3d461cc` | ⬆️ 领先远端（P8/P9 未推送） |
| `LabCodepilot` | `para`（scheduler 的父分支） | `537173f` | 已同步 |
| `codeagent-server` | `main` | `51d5141` | ⬆️ 领先远端（P8 的归属修复未推送） |

`scheduler` 从 `para` 拉出，本功能的 commit（新→旧）：

```
（P9）
3d461cc fix(client): 定时任务模型下拉跨 provider 重复
b039b4e fix(client): 定时任务汇总通知的标点改全角
526d92b docs: P8 完成 —— 交接文档与执行计划收口
f43d264 feat(cowork-server): P8 加固 —— cred_fetched + 归属契约 + 运维手册
abf2478 docs: P7 完成收口
6e5bbee feat(client): P7 定时任务创建入口 + 下线本机定时任务工具
f4b9b65 / 1f77aff / 400cfac   （沙箱护栏,非本功能）
f1fa1d7 docs(handover): 记录 P6 的 commit 引用
aa94c2f feat(client): P6 定时任务界面 —— 侧边栏入口 + 三层导航
0f79815 docs(handover): 更正 P5 的 commit 引用
4ca3f31 feat(client): P5 定时任务同步与物化 —— 服务端运行变成本地会话
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
| G4 | **必须走 shim** | 绕开直连 claude 会丢掉全部 5 个办公 skill（实测 14 vs 19），skill 靠 shim 每次启动软链。⚠️ 2026-08-05 `400cfac` 后 HOME **已从 tmpfs 换成持久状态卷**（TTL 回收会清空 tmpfs，导致 `--resume` 必挂）——本条早前写的「HOME 是 tmpfs」已作废，但「必须走 shim」不变 |
| G5 | **账号的角色模型不会自动过河** | 首次端到端跑在容器内置默认模型上（账号配的是 `qwen3.7-max[1m]`，实际跑 `claude-opus-4-8[1m]`），网关恰好放行所以没报错。已注入 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` 等 |
| G6 | **`/data` 是 root:root，服务非 root 跑** | `ensureStateDir()` EACCES → 服务一切正常但**定时任务永远不触发**。`install.sh` 已建目录并 chown；`index.mjs` 该失败改为显式吼两行 |
| G7 | **自检会污染生产审计日志** | `audit.mjs` 在**模块加载时**读 `COWORK_AUDIT_FILE`，必须在任何 import 之前设。曾写进去 2 行 `r5probe` 事件（已留档不改，append-only） |
| G8 | **`readBody` 返回原始字符串不是 JSON** | `index.mjs` 的既有调用方都自己 parse。当对象用会让所有字段读成 undefined，表现是创建全报「name is required」 |
| G9 | **selftest-r1..r4 会清场** | 它们 reconcile 掉全部受管容器与网络，**有活跃用户时绝不能跑**。`selftest-r5` 刻意不清场，可在生产跑 |
| G10 | **远端命令里的 glob 会被远端 shell 展开** | `verify-deployment.sh` 拼 ssh 命令时必须 `printf '%q '` 转义模式，用 `%s` 会让 `.env*` / `*.log` 提前展开、find 静默失效 |
| G11 | **`{0 && <X/>}` 会把 `0` 渲染出来** | `enabled` 是 SQLite 的 1/0 不是布尔。P6 的暂停卡片上因此多出两个孤零零的「0」，肉眼看才发现。写 `!!r.enabled &&` |
| G12 | **中文文案要用全角标点** | app 既有 271 条中文文案用「，：（）」，新写的用了半角，混在一起很扎眼。写完扫一遍 |
| G13 | **同一套工具可能有两份实现** | 下线本机定时任务时只删了 MCP 那份，以为干净了 —— native runtime 走的是 AI SDK 的 `tool()`，`builtin-tools/notification.ts` 里有**第二份**，模型在那条路径上照样能调。删工具/加工具都要按「通往模型的路径」而不是按文件核一遍 |
| G14 | **读完即焚的数据要等确认用得上再读** | 「存为定时任务」的预填挂在 sessionStorage，早期在挂载时就取 —— 碰上未开通/离线（渲染的是空态、没有表单）草稿被静默吃掉，用户退回去也找不回来 |
| G15 | 🔴 **审计 `detail` 必须以 uid 开头** | 账号后端按这条解析用量归属（`usage_service.parse_audit_line`）。routine_* 写成 `"<uid> success"` 而原规则要求**整串**是 uid，于是四个事件里三个落成 `uid=NULL` —— **不报错**，只是用量后台里定时任务那部分永远是空的。已在解析侧放宽 + `selftest-r5` 第 5 组按源码锁死 |
| G16 | **去重层级要跟渲染形态走** | `prependRoleModels` 只在单个 provider 内按 id 去重，聊天页按 provider 分组渲染所以够用；而 `RoutinePanel` 把所有 managed 配置**拍平**成一个列表 —— 本账号 14 个配置各带 opus/sonnet/haiku 别名，同 value 出现 14 次。后果不止 React key 告警：Radix Select 按 value 匹配，同 value 的多项**用户根本选不动**。拍平时按 value 去重、保留第一个（与 D9 同义）。教训：复用一个「已经去过重」的列表前，先确认它的去重范围和你的渲染范围是不是同一个 |
| G17 | **半角标点会从 i18n 之外的地方漏进来** | P6 把界面文案统一成全角后，`routine-sync.ts` 里**写死**的汇总通知仍是半角 —— 它不走 i18n 字典，当时的排查只扫了 i18n 文件。扫标点时要按「用户能看到的字符串」而不是「i18n 文件」来找（`b039b4e`） |

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
| `deploy/OPERATIONS.md` | **P8 改**：新增第 10 章「定时任务」+ 补 §1/§3/§5。运维在服务器上直接读的 runbook |
| `selftest-r5.mjs` | **P8 改**：加第 5 组「审计归属契约」12 项 |

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

## H.3 客户端 `LabCodepilot/src/`（P4 + P5 + P6 已交付）

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
| `lib/routine-ui.ts` | **P6 新建**：预设↔cron 互转、状态色调、格式化。纯逻辑，23 单测 |
| `components/routines/` | **P6 新建**：七个组件（Panel/List/Form/SchedulePicker/Detail/RunView/StatusChip） |
| `app/routines/page.tsx` | **P6 新建**：路由 |
| `app/api/routines/{count,[id]/sessions}` | **P6 新建**：两个**纯本地**读取口，不打沙箱 |
| `components/layout/ChatListPanel.tsx` | **P6 改**：办公 tab 加「定时任务」入口（文生图下方竖排 + 任务数徽标） |
| `i18n/{en,zh,zh-HK}.ts` | **P6 改**：100 个 `routines.*` key ×3 语 |
| `__tests__/unit/routine-ui.test.ts` | **P6**：23 项，重点锁预设↔cron 往返 |

### P5 的四条口径（改同步逻辑前先读）

1. **成败以服务端 run 记录为准**，客户端不重算。原文里的 `result` 只作补充展示 ——
   在客户端再判一次等于给 G1 重开一个口子。
2. **拿不到原文是正常输入**。`credential_error` 在容器起来之前就失败了，服务端根本没写
   transcript，拉取必然 404 —— 这类失败恰恰最需要被看见，必须照样物化。
3. **`skipped` 不物化**（并发满 / 配额用尽 / 上次没结束，无任何产出）。它仍出现在服务端的
   运行历史里，那才是它该待的地方。给它建空会话只会在列表里堆没内容的条目。
4. **从旧到新物化**。`getSessionsByRoutine` 按 `created_at DESC` 排，而 created_at 是物化
   时刻；服务端返回的是新→旧，照单全收会让本地顺序跟真实运行顺序反过来。

### P6 的两条口径

5. **第三层直接复用 `MessageList`**，不另写渲染器。P5 物化出的消息与实时回合同形状，
   所以工具调用折叠、Markdown、产物下载全都现成。另写一个等于重新实现一遍还会慢慢走样。
   定时会话按 id 取消息是**允许的** —— `isSessionVisibleToCurrentUser` 只看 `owner_uid`，
   不看 `routine_id`（F3 的排除只针对列表，不针对访问）。
6. **模型下拉只列 managed 模型，绝不兜底成 sonnet/opus**。留空 = 跟随账号配置的第一个（D9，
   服务端本来就这么兜底）。列一堆本账号未必有的模型，选了就是必然失败，而失败要等到下次触发
   才看得见。

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

# §I P7 创建入口（已交付，`6e5bbee`）

**解决的问题**：让用户**不必先想到「去定时任务页」**也能建定时任务 —— 发现路径问题，不是功能缺口。

| 文件 | 内容 |
|---|---|
| `src/lib/routines-mcp.ts` | 五个 MCP 工具（列表 / 创建 / 改 / 删 / 立即跑），**只在办公会话注册** |
| `src/components/chat/*` | 会话标题栏「⏰ 存为定时任务」，用最后一条指令预填 `RoutineForm` 的 `presetPrompt` |

## I.1 🔴 MCP 创建成功的回复必须明说结果去哪（写死在工具 prompt 里）

改版把定时任务的会话从办公对话列表里摘了出去，于是引入一个**新的失败模式**：用户在对话里说
「以后每天九点给我做日报」，助手答「已创建」，然后用户就在这个对话里**一直等**——
结果永远不会出现在这里。所以工具的成功返回里必须有这么一句（原型第 6 屏原话）：

> 运行结果会出现在左侧「定时任务」里，不会打扰这个对话。

没有这一句，这个功能对第一次用的人就是坏的。**不能指望模型自己想到**，写进工具的 system prompt。

## I.2 其它已落地的约束

- **只在办公会话注册**：研发会话没有沙箱，建了也跑不了。
- 助手把口语转成完整指令并**复述确认**，不静默创建 —— 用户说的「每天给我做个日报」
  离一条能独立跑的指令还差很远，而指令写得对不对是这个功能成败的关键。
- i18n 在 P6 一次做完（100 个 key ×3 语）。⚠️ zh-HK **手工加**，别跑 `gen-zh-hk.mjs`
  （它会把约 40 个已校对的港式词汇 revert 回去）。

---

# §J P8–P9 摘要

| 阶段 | 要点 |
|---|---|
| **P8** 加固 | ✅ 配额与自动停用 P3 就做了；本阶段真活是**审计归属 bug**（见 §G15）+ `cred_fetched` + OPERATIONS.md 第 10 章 |
| **P9** 收尾 | ✅ 生产端到端（§K.5）+ 双文档互链 + 部署核准（45/45、selftest 49 项）。抓到并修掉 2 个真 bug：汇总通知半角标点（`b039b4e`）、模型下拉跨 provider 重复（`3d461cc`，见 §G16） |

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
npm run test                                          # 期望 2723 passed, 0 failed, 1 skipped
npm run test:smoke                                    # 期望 17/17（需 dev server；刚改过代码要先预热路由，
                                                      #   Turbopack 正在编译时 waitForPageReady 会超时误报）
npx tsx --test src/__tests__/unit/routine-session-isolation.test.ts   # 10 项，锁 F3
npx tsx --test src/__tests__/unit/routine-transcript.test.ts          # 16 项，重放形状 + G1
npx tsx --test src/__tests__/unit/routine-sync.test.ts                # 15 项，幂等 + 降级
npx tsx --test src/__tests__/unit/routine-ui.test.ts                  # 23 项，预设↔cron 往返
apps/cowork-server/deploy/verify-deployment.sh        # 期望 45/45 源码完全一致
```

**物化链路的手工验证**：
```bash
curl -X POST http://localhost:3000/api/routines/sync   # 看 materialized / summary
```

## K.5 P9 生产端到端验收记录（2026-08-10）

**关键前提**：本地 dev 无登录体系，managed 凭证是密文 —— 必须**借打包版的主密钥**起 dev 才能跑通
（配方见 [cowork-vm-mode.md §8](cowork-vm-mode.md)：`npx electron unseal.js /tmp/mk.tmp` →
`CLAUDE_GUI_SECRET_KEY=$(cat /tmp/mk.tmp) PORT=3000 npm run dev`）。不带密钥起的 dev
拿不到凭证，整条链路验不了。

| 验收项 | 结果 |
|---|---|
| 部署漂移 | ✅ **45/45 源码完全一致**（P8 改动已全部上生产） |
| 生产自检 | ✅ `selftest-r5` **49 passed / 0 failed** |
| 客户端建任务 | ✅ 三层导航 → 新建表单 → 一次性任务，写入生产 |
| **调度器自主触发** | ✅ 定 09:00，实际 `startedAt 07:00:13Z`（= 本地 09:00），**全程无人工干预** |
| 运行结果 | ✅ `success` / 9.7s / $0.163 / 2 turns / exit 0 |
| 模型过河（G5 回归位） | ✅ 日志 `spawn model=qwen3.8-max[1m](账号配置) authStyle=api_key` |
| 一次性自动停用（D10） | ✅ 跑完 `enabled=false` + `ranAt` 落位，卡片显示「已运行」 |
| 审计链完整 | ✅ `routine_create → cred_fetched → cred_issued → routine_fire → routine_end(code=0) → cred_revoked`，**六个事件 detail 全部以 uid 开头**（G15 修复生效） |
| 产物真在卷里 | ✅ 直读 `cowork-ws-<id>` 卷：`/workspace/p9-e2e.txt` = `P9 E2E OK`（10B，属主 1000） |
| 同步与物化 | ✅ `POST /api/routines/sync` → `materialized:1 / succeeded:1`，汇总「定时任务：你不在时跑了 1 次 · 1 成功」 |
| 幂等 | ✅ 抹掉水位线重跑 sync，不产生第二条会话 |
| 会话隔离（F3） | ✅ 物化会话不在办公对话列表里，只能从定时任务页进 |
| 三层回放 | ✅ 第三层复用 `MessageList`：用户指令 → Thought → `Edit p9-e2e.txt` → Thought → 结果文本 |
| 删除联动 | ✅ 删任务后定义文件、`cowork-ws-*`、`cowork-st-*` 卷**全部连带清除** |
| 测试 | ✅ `npm run test` 2723 passed / `npm run test:smoke` 17/17 |

**过程中抓到并修掉 2 个真 bug**：汇总通知半角标点（`b039b4e`）、模型下拉跨 provider 重复（`3d461cc`，§G16）。

⚠️ **验收残留已清零**：测试 routine 已删（服务端定义+卷、本地会话+消息+水位线+缓存表）。
生产上现存的另一个 routine（`e2fdf534`「测试」）是**用户自建的，不要动**。

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
- **用量后台前端**还没展示 P8 加的 routine 字段（`overview.today_routine_runs`、
  `per_user.routine_runs_*`、`per_session.routine_runs`）—— 响应是裸 dict，加字段向后兼容，
  UI 更新前只是不显示
- **本机定时任务的引擎与界面暂留**：模型已完全够不着（两条路径的工具都删了），但
  `src/lib/task-scheduler.ts`、`/api/tasks/*` 七个路由、设置页 `AssistantWorkspaceSection`
  与项目页 `TaskList` 仍在。`instrumentation.ts` 启动时仍 `ensureSchedulerRunning()`，
  所以**存量任务仍会照常触发**。清这一层要动 UI，且 `useNotificationPoll` 轮询的
  `/api/tasks/notify` 同时也是普通通知的送达路径（不只服务定时任务），不能一刀切 —— 单独做

## L.3 工作方式的一条约定（用户提出）
改源码**默认用编辑工具**而不是 python/sed 脚本 —— 后者会绕过文件状态跟踪、可能静默失败
（`str.replace` 找不到目标时不吭声）、且改动不直观。只有跨多文件的机械替换才用脚本，
且**每个替换必须带 `assert`**。
