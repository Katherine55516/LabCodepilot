# 办公模式定时任务（对标 Claude Routines）实现调研

> 调研时间：2026-08-04
> 触发：希望在办公模式下做定时任务，体验对齐 Claude 云端 Routines
>
> ⚠️ **本文 §4 的决策 D1 已由用户拍板：走方案 B（服务端调度），定时任务跑在沙箱服务器上，不在用户电脑上跑。**
> 服务端实现读解与落地设计见 **[cowork-server-side-routines.md](cowork-server-side-routines.md)**。
> 本文保留作为**能力对标基线**（§1 的 Claude 三套调度辨析与 U1-U15 验收清单仍然有效），
> 但 §3/§5 的分期建议（先客户端）已被推翻，不要按它施工。
> 相关：[cowork-remote-container.md](cowork-remote-container.md)（办公模式底座）· [handover/cowork-vm-mode.md](../handover/cowork-vm-mode.md)（当前状态）· [exec-plans/active/scheduled-tasks-notifications.md](../exec-plans/active/scheduled-tasks-notifications.md)（**状态表已过期，见 §2**）

---

## 0. 结论速览

**三句话：**

1. **调度机械已经有了，且比想象中完整** —— `src/lib/task-scheduler.ts` 已实现 cron/interval/once、指数退避、抖动、错过补跑、自动过期，10s 轮询，开机自启。真正缺的是**执行引擎**（现在只调一次纯文本生成，**没有工具、没有沙箱、maxTokens 1000**）和**全部 UI**（一个管理界面都没有）。
2. **"跟云端 Routines 体验一致"里有一条做不到便宜** —— Routines 的核心卖点是**关掉电脑也在跑**。本应用的调度器活在 Electron 内嵌的 Next server 里，**关窗即死**（`window-all-closed` → `killServer()`，仅 bridge 活跃时例外）。要真云端，必须把"敲钟 + 驱动 agent"下沉到 cowork-server，并解决**无客户端在场时的凭证获取**（= 交接文档里预留但未做的 RD4 方案 C）。
3. **推荐分三期**：P0/P1 先做**客户端调度 + 真 agent 执行 + 完整 UI**（对齐 Claude **Desktop** scheduled tasks，约占目标体验的 85%，改动集中在本仓库）；P2 做**后台保活**（托盘/防睡眠，把"关窗即死"缩小到"退出才死"）；P3 再评估**服务端调度**（真云端，需动 cowork-server + 账号后端）。数据模型从 P0 就按 P3 的形状设计，避免二次迁移。

**必须先拍板的三个决策**（详见 §4）：谁敲钟（客户端/服务端）、每次运行是"新会话新容器"还是"同一工作区新对话"、补跑语义。

---

## 1. 对标对象拆解：Claude 有三套调度，别搞混

调研中最容易踩的坑：搜"Claude 定时任务"会同时搜到三个不同的东西。官方文档明确把它们并列对比：

| | **云端 Routines** | **Desktop 定时任务** | **`/loop`** |
|---|---|---|---|
| 跑在哪 | Anthropic 云 | 你的机器 | 你的机器 |
| 需要开机 | ❌ 不需要 | ✅ 需要 | ✅ 需要 |
| 需要开着会话 | ❌ | ❌ | ✅ |
| 重启后保留 | ✅ | ✅ | 仅 `--resume` |
| 访问本地文件 | ❌（每次全新 clone） | ✅ | ✅ |
| MCP | 按任务配 connector | 配置文件 + connector | 继承会话 |
| 权限提示 | ❌ 全自主 | 每任务可配 | 继承会话 |
| 最小间隔 | **1 小时** | **1 分钟** | 1 分钟 |

**用户说的"云端 Routines"= 第一列。但注意一个关键事实：** Claude 桌面版把两者收在**同一个「Routines」侧栏入口**下，点「New routine」时再选 **Cloud / Local**。也就是说——**"使用体验一致"在 UI 层不要求我们必须做云端**：桌面版自己就把本地调度摆在同一个入口、同一套表单、同一套详情页里。这给了我们分期的空间。

### 1.1 云端 Routines 的形态（官方文档核实）

一个 routine = **prompt + 若干仓库 + 一个 cloud environment + 若干 connector**，打包保存后自动跑。

- **三种触发器，可组合**：Schedule（周期 or 一次性）、API（每 routine 独立 endpoint + bearer token，POST `/fire`，可带 `text`）、GitHub（PR/Release 事件 + 过滤器）
- **Schedule 细节**：预设 hourly / daily / weekdays / weekly；自定义 cron 要走 CLI `/schedule update`；**最小间隔 1 小时**，更密的表达式会被拒；时间按**本地时区**输入并自动换算；**有确定性 stagger**（同一 routine 每次偏移固定，用于削峰）
- **一次性运行**：触发后**自动禁用**，Web UI 标记为 "Ran"；一次性运行**不计入每日 routine 配额**
- **全自主执行**：没有权限模式选择器、运行中没有任何审批弹窗 —— 能力边界完全由"选了哪些仓库 + environment 的网络策略 + 挂了哪些 connector"决定
- **每次运行 = 一个新 session**，和你其他会话并列，点开能看 Claude 干了什么、review 改动、开 PR、继续对话
- **详情页**：仓库、connector、prompt、schedule、API token、GitHub 触发器 + **历史运行列表**
- **Run now** 可附带一次性 text；`text` 会被包进 `<routine-fire-payload>` 块并标注为**不可信数据**，prompt 必须显式 opt-in 才会照做（防 token 泄漏后被当指令注入）
- **配额**：每账号**每日运行数上限**，另外照常吃订阅用量
- ⚠️ 文档明确提示：运行列表里的绿色状态**只代表会话正常退出，不代表任务成功**

### 1.2 Desktop 定时任务的形态（更贴近我们要做的）

- 入口：侧栏 **Routines** → New routine → **Local**
- 字段：**Name**（转 kebab-case 做磁盘目录名，全局唯一）、**Description**（列表里显示）、**Instructions**（输入框内嵌**权限模式选择器 + 模型选择器**，下方选**工作目录**和**是否用独立 worktree**）、**Schedule**
- Schedule 预设：**Manual**（只能手动 Run now）/ Hourly / Daily（时间选择器，默认 9:00）/ Weekdays / Weekly（时间 + 星期）。更细的间隔靠"在对话里用自然语言说"
- **每分钟检查一次**；到点起一个**全新 session**，出现在侧栏 **Scheduled** 分组下；**触发时发系统通知**
- **错过补跑（重要且反直觉）**：启动或唤醒时检查过去 **7 天**，**只为最近一次错过的时间补跑一次**，更早的全部丢弃。会为补跑单独发通知。文档明确提醒写 prompt 时要加时间护栏（"9 点的任务可能 23 点才跑"）
- 睡眠期间的调度**直接跳过**；提供 **Keep computer awake** 设置项
- **历史含 skipped 记录并给原因**：电脑睡眠 / 上一次还在跑 / 其他定时任务占用中
- 权限：每任务独立权限模式；Manual 模式下遇到没权限的工具会**挂起等审批**，会话留在侧栏；建议建完先 Run now 一次把常用工具设为 always-allow
- 删除任务会**归档它创建的所有会话**，另有 checkbox 决定是否删磁盘文件
- 任务可以在运行中**用 `update_scheduled_task` MCP 工具改自己的调度/prompt**（例如发现有 release 分支就把 code review 提前）
- 存储：`~/.claude/scheduled-tasks/<name>/SKILL.md`，YAML frontmatter 放 name/description，正文是 prompt；**schedule/folder/model/enabled 不在文件里**

### 1.3 "体验一致"翻译成验收清单

把上面两节压成可勾选的 UI/行为项（后文各期对照这张表）：

| # | 体验项 | 属于 |
|---|---|---|
| U1 | 侧栏独立入口（办公 tab 下），列表显示 名称/描述/人类可读调度/下次运行/状态徽标 | 两者 |
| U2 | 新建表单：名称 + 描述 + 指令（内嵌模型选择器）+ 调度预设 | 两者 |
| U3 | 调度预设 Manual/Hourly/Daily/Weekdays/Weekly + 自定义 cron + 一次性 | 两者 |
| U4 | 时间按本地时区，确定性 stagger 削峰 | 两者 |
| U5 | 一次性任务触发后自动禁用，标记 "Ran" | 两者 |
| U6 | **每次运行 = 一个可点开的完整会话**，在会话列表里单独分组 | 两者 |
| U7 | 详情页：Run now（可带一次性文本）/ 暂停恢复 toggle / 编辑 / 删除 | 两者 |
| U8 | **运行历史列表，含 skipped 及原因** | Desktop |
| U9 | 触发时系统通知；补跑也通知 | Desktop |
| U10 | 自然语言创建（"每天 9 点…"直接建任务） | 两者 |
| U11 | 补跑：只补最近一次，丢弃更早 | Desktop |
| U12 | 全自主执行，无审批弹窗 | Cloud |
| U13 | 关机也跑 | **Cloud only** |
| U14 | API 触发器 / GitHub 触发器 | Cloud only |
| U15 | 每日运行数配额 | Cloud |

---

## 2. 本应用现状盘点（已实测，带 file:line）

> ⚠️ **`docs/exec-plans/active/scheduled-tasks-notifications.md` 的状态表把 Phase 1-4 全标成「📋 待开始」，与代码不符。** 实际 Phase 1/2/3 基本已落地，Phase 4（UI）确实没做。该文档需要更正。

### 2.1 已经有的（比预期多）

**调度器 —— [`src/lib/task-scheduler.ts`](../../src/lib/task-scheduler.ts)**

| 能力 | 实现位置 | 说明 |
|---|---|---|
| 10s 轮询 | `task-scheduler.ts:15,57` | `globalThis` 防 HMR 重复启动 |
| 开机自启 | [`src/instrumentation.ts:25`](../../src/instrumentation.ts) | Next server 启动即拉起，不再依赖 `/api/chat` 副作用 |
| cron / interval / once | `task-scheduler.ts:312-341` | 自写 5 字段 cron 解析器，按天扫 4 年（覆盖闰年 2/29） |
| 指数退避 | `task-scheduler.ts:17,346` | 30s→1m→5m→15m，连续 10 次失败自动 disable |
| 确定性抖动 | `task-scheduler.ts:299` | 由 taskId 哈希派生，10% 间隔封顶 15min —— **和 Routines 的 stagger 同思路** |
| 错过补跑 | `task-scheduler.ts:377` | 仅 `once` 类型，启动时**全部立即执行** |
| 自动过期 | `task-scheduler.ts:415` | 周期任务 7 天后自动 disable（除非 `permanent`） |
| 会话内临时任务 | `task-scheduler.ts:22-37` | 内存 Map，不落库 |
| 运行日志 | `db.ts:1076` `task_run_logs` 表 | status/result/error/duration_ms |

**通知 —— [`src/lib/notification-manager.ts`](../../src/lib/notification-manager.ts)**
服务端环形缓冲队列 + 前端轮询 `/api/tasks/notify` 出 Toast；按 priority 分级（low=Toast / normal=+Electron 系统通知 / urgent=+Telegram）。**无渲染窗口时主进程自己轮询** —— [`electron/main.ts:514`](../../electron/main.ts) `startBgNotifyPoll()`，现在只为 bridge 后台模式服务，**可直接泛化**。

**API** —— `/api/tasks/{schedule,list,notify}`、`/api/tasks/[id]/{,run,pause}` 七个路由齐全。

**已有的无头 agent 驱动（关键复用点）** —— [`src/lib/bridge/conversation-engine.ts:87`](../../src/lib/bridge/conversation-engine.ts) `processMessage()`：会话锁 + 续锁、provider 解析链、落用户消息、消费 SSE 流、保存回复、权限请求回调、返回 token usage。**Bridge 已经在无浏览器参与的情况下跑完整 agent 回合了** —— 定时任务要的就是这个，不必重造。

### 2.2 缺的 / 坏的

| 缺口 | 现状 | 严重度 |
|---|---|---|
| **执行引擎是残废的** | `task-scheduler.ts:156-170` 调 `generateTextFromProvider`，`maxTokens: 1000`，**无工具、无 MCP、无文件访问、完全不进沙箱**。所谓"定时任务"目前只能定时生成一段文字 | 🔴 阻断 |
| **零 UI** | 全仓只有 `AssistantWorkspaceSection.tsx` 提了一嘴，没有列表页/表单/详情页/历史 | 🔴 阻断 |
| **和办公模式零关系** | 现有任务落到助理 workspace 的会话里（`task-scheduler.ts:200-221`），跟 `sandbox_enabled` 会话、跟容器沙箱毫无关联 | 🔴 阻断 |
| **没有 owner_uid** | `scheduled_tasks` 表（`db.ts:1041`）**无账号字段**，而办公会话强制账号隔离（`db.ts:1189` `SESSION_VISIBLE_WHERE`）。多账号切换时 **A 的定时任务会在 B 登录时执行并把结果写进 B 能看到的会话** | 🔴 正确性/安全 |
| **关窗即死** | `electron/main.ts:2971` `window-all-closed` → `killServer()`，仅 `isBridgeActive()` 时保活 + 起托盘 | 🟠 |
| **补跑语义不对** | `once` 任务启动时**全部执行**（`task-scheduler.ts:390-409`），Claude 是**只补最近一次**；周期任务**完全不补** | 🟠 |
| **7 天自动过期** | Routines 不会自己过期，我们会（`task-scheduler.ts:19,415`）。语义冲突，要么去掉要么改成显式选项 | 🟡 |
| **无 timezone 列** | 表里没有（`db.ts:1041` DDL 与 exec-plan 设计不一致），cron 用 `new Date()` 按机器本地时区求值 —— **恰好符合** Claude 语义，但换时区/跨设备无记录 | 🟡 |
| **一次运行 ≠ 一个会话** | 结果是 `addMessage` 追加到某个已有会话（`task-scheduler.ts:221`），不是 U6 要的独立会话 | 🟠 |

### 2.3 办公模式底座（决定方案边界）

- 会话即 `sandbox_enabled=1`，不绑项目目录，侧栏平铺（[`ChatListPanel.tsx:520`](../../src/components/layout/ChatListPanel.tsx)）
- 执行链：`decideCowork()`（[`cowork-poc.ts:37`](../../src/lib/cowork-poc.ts)）→ `getCoworkBackend()` → **remote 容器**；SDK 的 `pathToClaudeCodeExecutable` 被换成转发器，**agent loop 跑在客户端，真 claude 跑在香港服务器的容器里**
- **容器 per 会话** + 会话专属持久 volume；空闲 TTL 30 分钟后 `docker stop`（volume 保留），下次 `docker start` 复用
- 每会话配额 `COWORK_CPUS=2 / MEM=2g / PIDS=512`
- 凭证：客户端把 key 交给服务端内存（RD4 方案 A），cred-proxy sidecar 容器持有，会话容器只拿一次性 `cwk_` token
- 出网：DOCKER-USER 规则**拒绝全部私网四段**（10/8、172.16/12、192.168/16、169.254/16），公网放行
- 办公模式走 `--dangerously-skip-permissions`（`bypassPermissions`）—— **U12「全自主无审批」天然已满足**

**最关键的一条**：SDK query loop 在**客户端**。所以今天的架构下，**没有客户端就跑不了任何一个回合**。这是 P3 必须翻越的墙。

---

## 3. 三条技术路径

### 方案 A — 客户端调度（对齐 Claude **Desktop** 定时任务）

```
Electron 主进程                          香港 cowork-server
┌──────────────────────────────┐        ┌─────────────────────┐
│ Next server(内嵌)            │        │  orchestrator       │
│  ├ task-scheduler ⏰ 10s轮询 │        │   └ 会话容器        │
│  │   └ 到点 → 建会话         │        │       (真 claude)   │
│  ├ runHeadlessTurn()  ←复用  │  WS    │                     │
│  │   └ streamClaude          │────────┼→ exec bridge        │
│  │       └ decideCowork      │        │                     │
│  └ notification-manager      │        └─────────────────────┘
└──────────────────────────────┘
```

**改动清单**

| 文件 | 改动 |
|---|---|
| `src/lib/db.ts` | `scheduled_tasks` 加列：`owner_uid`（🔴 必须）、`sandbox_enabled`、`model`、`description`、`enabled`、`last_session_id`；`task_run_logs` 加 `session_id`、`skip_reason` |
| `src/lib/bridge/conversation-engine.ts` | 把 `processMessage` 里与 `ChannelBinding` 无关的内核抽成 `runHeadlessTurn({sessionId, prompt, model, providerId, abortSignal})`，Bridge 与 scheduler 共用 |
| `src/lib/task-scheduler.ts` | 换执行引擎：`generateTextFromProvider` → 建办公会话 + `runHeadlessTurn`；补跑改「只补最近一次」；加 skipped 记录与原因；账号过滤 |
| `src/lib/routines-mcp.ts` | **新建**：`create/list/update/delete/run_scheduled_task` 五个工具（对齐 U10 自然语言创建 + Claude 的任务自改调度能力） |
| `src/app/api/routines/**` | 在现有 `/api/tasks/*` 上补 detail/history/run-now-with-text |
| `src/components/routines/**` | **新建**：`RoutineList` / `RoutineForm` / `RoutineDetail`（含历史表） |
| `src/components/layout/ChatListPanel.tsx` | 办公 tab 下加「定时」入口；会话列表加 **Scheduled 分组** |
| `src/i18n/{en,zh,zh-HK}.ts` | 三语键 |

**能拿到**：U1–U12（除 U13/U14）。**拿不到**：U13 关机也跑、U14 API/GitHub 触发。
**成本**：中。全在本仓库，不动服务端、不动账号后端。
**诚实边界**：必须在 UI 上明说"应用关闭时不运行，下次启动补跑最近一次" —— Claude Desktop 自己就是这么说的，照抄这个诚实姿态即可。

### 方案 B — 服务端调度（真·云端 Routines）

```
香港 cowork-server
┌───────────────────────────────────────────────────┐
│ routine-store (per uid, /data)                     │
│ routine-scheduler ⏰ 1min tick                      │
│   └ due → ensureContainer(uid, routineId)          │
│        └ docker exec claude -p "<prompt>"          │
│             --output-format stream-json            │
│             --dangerously-skip-permissions         │
│        └ transcript 落盘 → run record              │
│ cred: 向账号后端直取该 uid 凭证 (RD4 方案 C) ⚠️未做 │
└───────────────────────────────────────────────────┘
        ↑ 客户端登录后拉取 runs → 落本地 SQLite → 通知
```

**为什么技术上成立**：容器里**本来就有真的 `claude` 二进制**（`/opt/cowork-assets/claude`，2.1.203）。服务端不需要转发器、不需要客户端 SDK，直接 `claude -p` headless 跑完，把 stream-json 存下来即可。这是 B 相对便宜的地方。

**为什么仍然贵** —— 四个硬前置：

1. **凭证（最大阻塞）**：无客户端在场 ⇒ 方案 A 的"客户端交 key"失效 ⇒ 必须做 **RD4 方案 C**：cowork-server 用服务端密钥向账号后端换该 uid 的模型凭证。交接文档已把 C 列为预留但**未实现**，需要账号后端加接口 + 密钥体系。
2. **结果回传**：run 产生在服务端，客户端 SQLite 是权威展示面 ⇒ 需要 `GET /routines/runs?since=` 拉取 + 本地重放成 chat_session/messages。产物走已有文件通道。
3. **并发与容量**：32 核 / 60G，每会话 2 核 2G ⇒ 理论 ~15-25 并发容器。N 用户 × M routines 同点触发会打满 ⇒ 必须**队列 + 并发上限（建议先 4-8）+ 沿用确定性 stagger**。Claude 自己也是靠 stagger + 每日配额削峰。
4. **配额与审计**：服务端自主发起 agent 并烧公司 token ⇒ 需 per-uid 每日运行上限（= U15）+ `audit.mjs` 加 `routine_fire` 事件。

**额外注意**：现有 egress 规则**拒绝全部私网段**。办公场景很可能要求"每天读内网系统出报表" —— 这类 routine 会被现有出网策略直接拒掉，需要单独定向放行并重新评估横移风险。这不是 B 引入的问题，但 B 会让它变得高频可见。

**能拿到**：U13 真云端，U14 也顺带可行（API 触发器 = 给 routine 发一个 HMAC endpoint，和现有 authz 同构）。
**成本**：高。跨三个仓库（本应用 / cowork-server / 账号后端）。

### 方案 C — 混合（推荐）

A 先落地并把数据模型按 B 的形状设计（routine 是一等实体、run 是一等实体、天然带 uid、`location: 'local' | 'cloud'` 字段预留），B 作为后续增量。UI 完全照抄 Claude 桌面版的做法：**同一个「定时」入口，新建时选「本机运行 / 云端运行」**，P0 阶段云端选项置灰并标"即将支持"。

这样 P3 落地时是**给现成 UI 点亮一个开关**，不是重做一遍。

---

## 4. 三个必须先拍板的决策

### D1：谁敲钟 —— 决定"关机能不能跑"

| | A 客户端 | B 服务端 |
|---|---|---|
| 关机/关窗 | ❌ 不跑 | ✅ 跑 |
| 改动范围 | 本仓库 | 三仓库 |
| 凭证 | 复用现状 | **需 RD4-C（未做）** |
| 容量风险 | 无（单机单用户） | 需队列/配额 |

~~**建议**：先 A，把 B 当 P3。~~
✅ **已拍板：走 B（服务端调度）。** 用户明确要求跑在沙箱服务器上、不占用户电脑。
后续读 [cowork-server-side-routines.md](cowork-server-side-routines.md) —— 那份基于对 `apps/cowork-server/` 全量代码的实读，
结论是适配度远高于本文估计（九项基础设施现成、三项要做），B 的成本被本文高估了。

### D2：每次运行 = 新会话新容器，还是同一工作区新对话？

Claude 云端 Routines 是**无状态**的（每次全新 clone 仓库）。但办公模式的会话 = **容器 + 持久 volume**，而办公任务往往是**有状态**的（"每天把新数据追加进这个表"）。

| | 每次新会话 | routine 独占一个持久工作区 |
|---|---|---|
| 对齐 Routines | ✅ | ❌ |
| 容器/volume 数量 | 每次运行 +1 volume，**会膨胀** | 恒定 1 个 |
| 有状态办公任务 | ❌ 每次从零 | ✅ 天然累积 |
| U6「点开看每次运行」 | 天然满足 | 需要"一个 volume，多个会话记录"的解耦 |

**建议**：**routine 持有一个专属持久 workspace（一个 volume），每次运行创建一条独立的会话记录挂在它下面**。既满足 U6（每次运行可点开），又不会让 volume 无限增长，还契合办公场景的有状态需求。这需要打破当前"会话 ↔ 容器 ↔ volume 一对一"的假设，是本方案**唯一的架构性改动**，务必先确认。

### D3：补跑语义

现状：`once` 全部补跑、周期完全不补。Claude：**查过去 7 天，只为最近一次错过补跑一次，更早丢弃，并单独发通知**。

**建议**：直接照抄 Claude 语义（含"补跑单独通知"），并在文案里提醒用户给 prompt 加时间护栏。这是被验证过的设计，且能避免"关了三天，一开机跑了 72 次"的灾难。

---

## 5. 推荐分期

| 期 | 内容 | 覆盖 | 验收 |
|---|---|---|---|
| **P0** | DB 补 `owner_uid` 等列；抽 `runHeadlessTurn`；执行引擎换成真办公 agent 回合；一次运行 = 一个会话 | U6, U12 | 建一个 routine，到点自动起容器跑完，会话列表出现新会话且能点开看全过程 |
| **P1** | 完整 UI（列表/表单/详情/历史）+ Scheduled 分组 + 系统通知 + Routines MCP 工具（自然语言创建） | U1–U11 | CDP 验证四个界面；对话里说"每天 9 点整理昨天的数据"能建出任务 |
| **P2** | 后台保活：泛化 tray + `window-all-closed` 判据加"有 active routine"；powerSaveBlocker + 「保持唤醒」设置项；补跑语义改为只补最近一次 | 逼近 U13 | 关窗后任务仍触发并出系统通知；睡眠跳过并记 skipped 原因 |
| **P3** | 服务端调度（需先做 RD4-C + 账号后端接口）+ 队列/并发上限 + per-uid 日配额 + API 触发器 | U13, U14, U15 | 客户端完全退出，任务仍在服务端跑完；重新登录后拉回运行记录 |

P0+P1 就能上线一个完整可用的功能；P2 是体验补强；P3 是战略选项，**建议等 P0/P1 的真实使用数据再决定是否值得动三个仓库**。

---

## 6. 复用清单（别重造）

| 要做的 | 已有的 | 位置 |
|---|---|---|
| 无头 agent 回合 | `processMessage` | `bridge/conversation-engine.ts:87` |
| cron/interval 解析 | `getNextCronTime` / `parseInterval` | `task-scheduler.ts:456,442` |
| 削峰 stagger | `getJitter` | `task-scheduler.ts:299` |
| 退避与自动禁用 | `applyBackoff` | `task-scheduler.ts:346` |
| 系统通知（含无窗口时） | `notification-manager` + `startBgNotifyPoll` | `notification-manager.ts` / `main.ts:514` |
| 托盘保活范式 | `createTray` + bridge 分支 | `main.ts:440,2971` |
| 沙箱起容器/文件通道 | `decideCowork` / `cowork-backend-remote` | `cowork-poc.ts:37` |
| 账号隔离判据 | `SESSION_VISIBLE_WHERE` / `isSessionVisibleToCurrentUser` | `db.ts:1189,1204` |
| 服务端审计 | `audit.mjs` | `apps/cowork-server/lib/` |

---

## 7. 风险登记册

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **`scheduled_tasks` 无 owner_uid** | A 账号的任务在 B 登录时执行、结果写进 B 可见会话 | P0 必须补列 + 执行前按当前登录 uid 过滤；存量行迁移策略需拍板（建议全部置 disabled 让用户重建） |
| R2 | 定时任务默认 `bypassPermissions` 且**无人值守** | 一个措辞不当的 prompt 可能反复破坏 workspace | 沙箱本身是护栏（碰不到真机）；但要在建任务时明确提示"全自主执行"，并保留 volume 快照/回收策略 |
| R3 | 容器冷启动数秒 + TTL 30min 回收 | 到点触发时容器可能是 stopped，首回合变慢 | 可接受；`ensureReady` 已处理 `docker start` 复用 |
| R4 | 7 天自动过期与 Routines 语义冲突 | 用户建的日报任务一周后悄悄失效 | 去掉或改成显式"有效期"选项，并在到期前通知 |
| R5 | 出网禁私网 | "读内网系统出报表"类 routine 直接失败 | 提前说明边界；确需时定向放行并重评横移风险 |
| R6 | (P3) 服务端并发打满 | 多用户同点触发拖垮沙箱服务器 | 队列 + 并发上限 4-8 + 沿用 stagger + per-uid 日配额 |
| R7 | (P3) 服务端自主烧 token | 无客户端在场，用量归属与止损缺失 | per-uid 日运行上限 + audit `routine_fire` 事件 + 用量上报 |
| R8 | 运行"绿色"≠任务成功 | 用户误以为每天都跑对了 | 照抄 Claude 的提示语；历史列表区分"会话正常退出"与"任务达成" |

---

## 8. 待用户拍板

1. **D1**：认可"先客户端、P3 再评估服务端"，还是一开始就要真云端（则需先启动账号后端 RD4-C 接口）？
2. **D2**：routine 独占一个持久 workspace（推荐），还是每次运行全新容器？
3. **D3**：补跑语义照抄 Claude（只补最近一次 + 7 天窗口）？
4. **入口位置**：办公 tab 下的独立「定时」按钮（与「文生图」并列），还是收进设置页？（推荐前者，对齐 Claude 侧栏 Routines）
5. **最小间隔**：Claude 云端 1 小时、Desktop 1 分钟。我们跑在自家服务器上，建议取 **5 分钟**下限防误建高频任务 —— 是否认可？
6. **存量**：`docs/exec-plans/active/scheduled-tasks-notifications.md` 状态表已过期，是就地更正还是本次一并重写为新执行计划？

---

## 参考来源

- [Automate work with routines — Claude Code Docs](https://code.claude.com/docs/en/routines)
- [Schedule recurring tasks in Claude Code Desktop](https://code.claude.com/docs/en/desktop-scheduled-tasks)
- [Claude Co-work Now Runs in the Cloud — MindStudio](https://www.mindstudio.ai/blog/claude-co-work-cloud-update-scheduled-tasks)
- [Claude Code Routines: The Complete Guide to Scheduled Cloud Agents — makerkit](https://makerkit.dev/blog/tutorials/claude-code-routines-guide)
- 本地 `scheduled-tasks` MCP 工具契约（`create/update/list_scheduled_task` 的 schema，Claude 桌面版实际实现）
