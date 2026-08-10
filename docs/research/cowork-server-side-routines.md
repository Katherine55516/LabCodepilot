# 定时任务跑在沙箱服务器上 —— cowork-server 实现读解与方案设计

> ✅ **已实现并上线（2026-08-10）**。本文的设计已全部落地，实现以
> **[handover/cowork-scheduled-routines.md](../handover/cowork-scheduled-routines.md) 为准**
> （本文是设计期快照，细节与最终实现可能有出入）；产品思考见
> [insights/cowork-scheduled-routines.md](../insights/cowork-scheduled-routines.md)。
>
> 调研时间：2026-08-04
> 前置：[cowork-scheduled-routines.md](cowork-scheduled-routines.md)（对标 Claude Routines 的能力清单与三方案对比）
> **决策已定**：走该文 §3 的**方案 B（服务端调度）** —— 定时任务在沙箱服务器上跑，不依赖用户电脑
> 底座文档：[handover/cowork-vm-mode.md](../handover/cowork-vm-mode.md) · [research/cowork-remote-container.md](cowork-remote-container.md)

---

## 0. 结论速览

读完 `apps/cowork-server/` 全部 1874 行后的判断：

**这套实现对定时任务的适配度出乎意料地高。** 容器编排、多用户隔离、配额、出网管控、文件通道、凭证代理、审计——定时任务需要的基础设施**全部现成**。会话容器里本来就躺着一个真的 `claude` 二进制，服务端本来就在 `docker exec` 它。所以"服务端自己跑一个 agent 回合"不是新造轮子，是**换一种方式调用已有的轮子**。

**五个断点，只有一个是真的贵：**

| # | 断点 | 成本 | 说明 |
|---|---|---|---|
| ① | **凭证**：真 key 只在客户端本地加密库里，服务端拿不到 | 🔴 高 | 唯一需要动账号后端的地方。但注入点零改动（见 §3.1） |
| ② | 执行方式：现有 exec 是"给 SDK 当管道"，定时任务要"自己起一轮" | 🟢 低 | `claude -p` + 复用 shim，改动约 40 行 |
| ③ | 状态持久化：cowork-server 现在是**完全无状态**的 | 🟡 中 | 加一个文件型 store，不引新依赖 |
| ④ | **TTL 会把跑到一半的定时任务容器回收掉** | 🟢 低 | 但不修就是线上事故（见 §3.4） |
| ⑤ | 结果回传：run 产生在服务端，展示面在客户端 SQLite | 🟡 中 | 拉取 + 本地物化 |

**一句话方案**：给 cowork-server 加一个 `routines` 模块（REST + 调度循环 + 执行器 + 文件型 store），routine 自己持有一个 sid（= 一个容器 + 一个持久 volume），到点由服务端 `docker exec` 跑 `claude -p`，transcript 落盘，客户端上线后拉回来物化成会话。

---

## 0.5 S0 实测结果（2026-08-04，生产服务器真机）

在生产上建了一个 uid=`s0-probe` 的探针会话跑完全部验证，**结束后已清理，零残留**（真实用户的 8 个容器 / 27 个卷、5 条 egress 规则均未受影响）。

### ✅ 证实的

| # | 结论 | 证据 |
|---|---|---|
| 1 | `-p --output-format stream-json --verbose --dangerously-skip-permissions` **全部被接受**，首条即 `{"type":"system","subtype":"init",...}`（含 cwd / session_id / tools / model / permissionMode） | 直接跑通 |
| 2 | **不需要给 shim 加 `--oneshot`** —— 往 stdin 写 4 字节零长帧（`printf '\0\0\0\0'`）就是现有协议的优雅 EOF，shim **零改动**即可跑 one-shot | `docker exec -i … cowork-shim.py -- -p "hi" … < 零长帧` 直接出 init 消息 |
| 3 | **绕开 shim 会丢掉全部 5 个办公 skill** —— 直连 claude 只有 14 个内置 skill；经 shim 是 19 个，多出 `docx-manipulation` / `xlsx-manipulation` / `pptx-manipulation` / `pdf-extraction` / `office-cn`，且 `cwd=/workspace` 正确 | 两次 init 消息的 `skills` 数组对比 |
| 4 | **退出码经 shim 正确传播** | `--version` → 0；`--no-such-flag` → 1 |
| 5 | result 消息自带 `duration_ms` / `total_cost_usd` / `usage`（4 类 token）/ `num_turns` / `modelUsage` —— **配额与用量统计免费拿到** | 见下方 result 样本 |
| 6 | 容器内默认模型 `claude-opus-4-8[1m]`，`permissionMode` 已是 `bypassPermissions` | init 消息 |

### 🔴 两个会直接导致 bug 的发现

**① `subtype: "success"` 是陷阱 —— 判成败绝不能看它。**

一个 401 全程失败的回合，最后一条是：
```json
{"type":"result","subtype":"success","is_error":true,"api_error_status":401,
 "duration_ms":180784,"num_turns":1,"result":"Failed to authenticate. API Error: 401 …",
 "total_cost_usd":0,"terminal_reason":"completed"}
```
**`subtype` 字面就是 `"success"`，而 `is_error: true`。** 这比 Claude 官方文档警告的"绿色状态不代表任务成功"更险——字段名本身就在误导。

> **runner 判定口径（写死）**：`ok = (exitCode === 0) && (result.is_error !== true) && (result.api_error_status == null)`。**任何情况下不读 `subtype`。**

**② 坏凭证不会快速失败，而是烧 181 秒。**

401 触发 `max_retries: 10` 的指数退避（0.5s → 1s → 2.2s → 4.4s → 8.3s → 16.6s → 38.5s → 38.3s …），实测**总耗时 181 秒**才 exit 1。这正是交接文档 A.5⑤ 记的"卡 2 分 23 秒"同一现象。

对定时任务的影响比交互回合严重得多：没人盯着，一个凭证配错的 routine 每次触发白占一个容器 3 分钟，N 个 routine × 每天 M 次会持续挤占并发额度。

> **runner 必须做的**：流式解析 stdout，**看到第一条 `{"type":"system","subtype":"api_retry","error_status":401}` 就主动 abort**（kill + 标记 `credential_error`），不等它退避完。非 401 的 retry（429/5xx）可以让它退避。

### ⚠️ 勘误：先前读的是旧分支

本文 §1 最初基于 `para` 分支的 `apps/cowork-server/`（255 行 index.mjs）。**生产实际跑的是 `vm_cowork` 分支**（316 行 + `lib/admin.mjs`，已核实 `/opt/cowork-server/lib/admin.mjs` 存在）。差异 342 行，且**其中两项直接改善了本方案**：

**(a) 服务间通道已经存在。** `lib/admin.mjs` + `index.mjs` 的 `/admin/*` 分支：账号后端用共享密钥自签 uid=`__admin__` 的 token（`app/cowork/usage_service.py:sign_admin_token`，TTL 300s），沙箱侧只认这个 uid，其余一律 404 防枚举。已有端点：`GET /admin/audit?offset=` / `GET /admin/stats` / `GET /admin/session/:id/{files,file,archive}` / `DELETE /admin/session/:id`。

→ **凭证接口不需要新的密钥体系**，只需把同一套 HMAC 反向用一次（见 §9）。

**(b) `exec_end` 审计事件已经有了。** `exec-bridge.mjs` 在 exec 退出时写 `audit('exec_end', {sessionId, detail: uid, code, durationMs})`，注释写明这是"回合成败/时长的唯一结构化来源"。而账号后端的 `usage_service.py` 已经在**惰性增量拉取** `/admin/audit` 落 PG（`CoworkAuditEvent`）供 admin 用量后台。

→ **routine 的用量统计几乎免费**：runner 只要照写 `routine_fire` / `routine_end` 事件，就自动流进已有管线。审计截断上限也已从 4MB 调到 64MB 正是为此。

### ✅ 成功路径（用真实凭证补跑，全链路通过）

走的是**完整的生产路径**，不是简化版：`POST /session/:id` 起容器 → `POST /session/:id/cred` 经 cred-proxy 登记真凭证拿 `cwk_` 一次性 token → `docker exec` 经 shim + 零长帧 EOF 跑 `claude -p` → 文件通道取回产物。

```
exit=0   耗时 94s   17 行 stream-json
消息分布: system/init ×1 · system/api_retry ×12 · assistant ×2 · user ×1 · result/success ×1
[cowork-shim] 预制 skill 已挂载: 5 个 → /home/agent/.claude/skills     ← stderr 实证
[工具调用] Write
[文本] 已在当前目录创建 s0-report.md，内容写为一行 "S0 verified"。

result: subtype=success  is_error=False  api_error_status=None  terminal_reason=completed
        duration_ms=93618  num_turns=2  total_cost_usd=0.1302
        usage: in=22415 out=90 cache_read=22016
        modelUsage=['deepseek-v4-flash[1m]']

文件通道验证: GET /session/:id/files → /workspace/s0-report.md (11B)
              GET /session/:id/file  → "S0 verified"  ← 内容逐字节正确
```

**三个额外收获：**

**① CLI 别名模型原样可用。** 传的是 `--model "deepseek-v4-flash[1m]"`，`modelUsage` 的键就是它本身。memory 里记过的坑「managed 模型 id 可能是 CLI 别名，只有 SDK 子进程能解析，走 `@ai-sdk` 直连会 503」**在这条路径上不存在** —— 因为跑的就是 CLI。这反而比客户端的辅助 AI 路径更稳。

**② 实测撞上 12 次 `429 rate_limit`，claude 自行退避后成功。** 这从正面印证了护栏设计的分寸：**401 立即中止、429/5xx 让它退避**。如果一刀切"见 retry 就 kill"，这次本该成功的运行会被误杀。

**③ 正常运行也可能到 90s+。** 94 秒里绝大部分是等 429 退避。所以**超时不能设短**，15 分钟是合理的；同时也说明并发上限要按"每个 routine 可能占容器好几分钟"来估，不能按理想耗时算。

**结论：S0 全部完成，S2 的技术不确定性已清零。**

> ⚠️ 本次用的测试 key 属一次性用途，**请在 newapi 后台轮换**。服务端侧已 `DELETE /cred` 废止 + `shred` 擦除临时文件 + 删会话（容器/卷归零），真实用户的 8 容器 / 27 卷 / 5 条 egress 规则未受影响。

---

## 1. cowork-server 实现读解

> ⚠️ 下文行号基于 **`vm_cowork` 分支**（= 生产部署版）。`para` 分支的版本较旧，缺 `lib/admin.mjs`。

### 1.1 全貌

```
apps/cowork-server/           (vm_cowork = 生产版)  运行时依赖只有 ws 一个
├── index.mjs              316   HTTP + WS 单入口，路由/鉴权/空闲回收/管理面
├── lib/
│   ├── orchestrator.mjs   240   容器 per 会话编排（docker labels 作事实源）
│   ├── files.mjs          201   文件通道四 op（短命 helper 容器直读 volume）
│   ├── admin.mjs          139   管理面数据源：审计增量读 + docker 现查统计
│   ├── cred-proxy.mjs     127   凭证代理编排 + 经 stdin 注入
│   ├── authz.mjs           69   HMAC token 验签取 uid，无状态
│   ├── exec-bridge.mjs     65   WS ↔ docker exec 帧桥 + exec_end 审计
│   └── audit.mjs           42   append-only JSONL 审计（64MB 软截断）
├── container/
│   ├── cowork-shim.py     166   容器内解帧器 + 预制 skill 软链
│   └── cred-proxy.py      154   sidecar：校验 cwk_ token → 注入真 key → 转发
├── client/forwarder-remote.mjs 61  客户端侧：SDK 以为它是 claude
└── image/Dockerfile             自建镜像：claude + shim + cred-proxy + 5 个办公 skill
```

### 1.2 三个值得记住的设计决策

**① 控制面无状态，docker labels 就是数据库。**
`orchestrator.mjs:114` `sessionOwner()` 从容器 label `cowork.uid` 读属主，回退 volume label。`listSessions()`（`:203`）扫**容器 ∪ volume**——容器可以被 TTL 回收，volume 还在就代表会话还在。server 重启后从 labels 完整重建认知，**进程内 Map 只是缓存**。

这个设计很干净，但**定时任务是第一个真正需要持久状态的功能**（prompt 文本、cron 表达式、运行历史都塞不进 label）。这是 §3.3 要处理的。

**② 鉴权无状态：HMAC token 自带 uid。**
`authz.mjs:34` `signToken(uid)` = `base64url({uid,exp}) + "." + HMAC_SHA256`。server 只有一个 `COWORK_AUTH_SECRET`，验签取 uid，**不存用户表**。账号后端用同一密钥签发。所有 op 按 `cowork.uid` label scope，跨用户访问返回 **404 而非 403**（防枚举，`index.mjs:141`）。

→ 定时任务**完全复用**：客户端创建 routine 时带着自己的 Bearer token，uid 从签名里来，无需任何新鉴权。

**③ 凭证三层隔离（RD6）。**
```
客户端 ──真key──> cowork-server ──docker exec stdin──> cred-proxy 容器 tmpfs /creds/<token>.json
                       │                                        ↑
                       └──返回 cwk_xxx token──> 会话容器 ────HTTP──┘
                                              ANTHROPIC_BASE_URL=http://cowork-proxy:8791
```
真 key **不落宿主盘**（走 docker exec stdin，`cred-proxy.mjs:107`）、**不进会话容器**、**不进 argv**（避免进程表泄漏）。会话容器只见一次性 `cwk_` token。

**`cred-proxy.mjs:17-19` 的注释已经把定时任务需要的路径写好了：**

> credSource 预留(RD4)：registerCredentials 是唯一登记入口。方案 A 由 REST 路由（客户端 TLS 交 key）喂；**将来切方案 C（服务端向账号后端直取）时，服务端自己拉取后喂同一入口，proxy 容器/会话容器侧零改动。**

这是本次调研最省事的一条发现 —— 断点①的注入点早就留好了。

### 1.3 一次 exec 回合现在是怎么走的

```
SDK query()
 └ pathToClaudeCodeExecutable = forwarder-remote.mjs        ← SDK 以为这是 claude
    └ WS ws(s)://server/session/<sid>/exec  (Bearer token)
       ├ 首个 text message = {argv, env}                    ← env 白名单 ANTHROPIC_*/CLAUDE_*/COWORK_*
       └ 后续 binary = [u32 BE len][bytes] 帧流，零长 = EOF
          └ index.mjs:211 ensureContainer(sid, uid)         ← 归属校验在这里
             └ exec-bridge.mjs:31
                docker exec -i -e... <容器> python3 cowork-shim.py -- <claude argv>
                   └ shim 解帧 → 喂 claude stdin
                      claude stdout 裸流 → shim stdout → WS binary → forwarder → SDK
```

**关键点：agent loop 在客户端**（SDK 在 Next server 里跑），服务端只是一根**哑管道**。这正是定时任务必须改的地方——服务端要能自己发起一轮，不能等客户端。

### 1.4 shim 里那个容易被忽略的职责

`cowork-shim.py:29` `link_preinstalled_skills()`：把镜像里 `/opt/cowork-skills/` 的 5 个办公 skill（docx / xlsx / pptx / pdf / office-cn）**逐个软链**进 `~/.claude/skills/`。

为什么必须每次启动做：HOME 是 orchestrator 挂的 **tmpfs**（`orchestrator.mjs:166`），容器每次创建都是空的，镜像里写死没用。

**⚠️ 这意味着"绕开 shim 直接 `docker exec claude`"会静默丢失全部办公 skill。** 定时任务恰恰最需要这些（"每天生成 xlsx 报表"）。所以执行器**必须走 shim**，见 §3.2。

### 1.5 空闲回收的续命逻辑

`index.mjs:62-71` + `:236-248`：
- `lastActive: Map<sid, ms>` —— **只有 WS exec 打开/关闭时更新**（`execOpened`/`execClosed`），文件 op 不算活跃
- `activeExec: Map<sid, count>` —— 有活跃连接的会话**绝不回收**
- reaper 每 60s 扫 `listRunning()`，超 `IDLE_TTL_MS`（默认 30min）且无活跃连接 → `docker stop`（保留 volume）
- server 重启后 `lastActive` 为空 → 给一个 TTL 宽限

→ **服务端发起的 exec 不经过 WS，所以完全不在这套续命机制里。** 这是断点④，见 §3.4。

---

## 2. 适配度评估：哪些能直接用

| 定时任务需要 | 现有实现 | 位置 | 状态 |
|---|---|---|---|
| 隔离的执行环境 | 硬化容器（cap-drop ALL / no-new-privileges / 非 root / 2c2g/512pids） | `orchestrator.mjs:152-171` | ✅ 直接用 |
| 持久工作区 | 会话专属 named volume，与容器生命周期解耦 | `orchestrator.mjs:88` | ✅ 直接用 |
| 多用户隔离 | `cowork.uid` label + 跨用户 404 | `orchestrator.mjs:129` | ✅ 直接用 |
| 鉴权 | HMAC token 验签取 uid | `authz.mjs:48` | ✅ 直接用 |
| 凭证不进容器 | cred-proxy sidecar + cwk_ 一次性 token | `cred-proxy.mjs:94` | ✅ 注入点直接用 |
| 产物取回 | 文件通道四 op（helper 容器直读 volume，**会话容器不用醒**） | `files.mjs` | ✅ 直接用 |
| 出网管控 | DOCKER-USER 拒私网四段 | `setup-egress.sh` | ✅ 直接用（但见 R5） |
| 审计 | append-only JSONL，10 类事件 | `audit.mjs` | ✅ 加事件即可 |
| 办公 skill | 镜像预制 + shim 软链 | `Dockerfile:70` | ✅ 走 shim 就有 |
| 开机自启/守护 | systemd `cowork-server` | `deploy/cowork-server.service` | ✅ 直接用 |
| **自主发起一轮 agent** | ❌ 服务端只是哑管道 | — | 🔴 要做 |
| **持久化状态** | ❌ 完全无状态 | — | 🔴 要做 |
| **凭证来源（无客户端）** | ❌ 只有客户端喂 | — | 🔴 要做 |

**九项现成、三项要做。** 这就是为什么服务端调度这条路比它听起来便宜。

---

## 3. 五个断点与解法

### 3.1 断点①：凭证 —— 唯一需要动账号后端的地方

**问题**：真 key（managed provider 的 `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`）来自 `claude-client.ts:974`，它读的是客户端本地 SQLite 里**用 safeStorage 主密钥加密的列**。这个密钥绑定用户机器的钥匙串。**服务端在原理上拿不到。**

**两条路：**

**(a) RD4 方案 C —— 服务端向账号后端直取（推荐，详细设计见 §9）**
```
cowork-server ──HMAC token(uid=__sandbox__)──> codeagent-server
  GET /api/v1/internal/cowork/model-credentials?uid=<用户 UUID>
  → { realKey, realBase, authStyle }
     └ 喂进现有的 cred.registerCredentials(routineSid, {...})   ← 零改动
```
账号后端**本来就持有**这些 managed 凭证（它就是下发方）。而且 —— **服务间信道已经存在**：账号后端现在就在用共享密钥自签 uid=`__admin__` 的 token 调沙箱 `/admin/audit` 拉用量（§0.5 勘误 (a)）。本接口只是把同一套 HMAC **反向用一次**，不引入新密钥体系。

**(b) 客户端预存 —— 更便宜但有致命缺陷**
客户端创建 routine 时把凭证存到服务端，之后一直用。
**❌ 不推荐**：凭证存在 cred-proxy 容器的 **tmpfs**（`cred-proxy.mjs:77`）+ server 进程内 `tokenBySession` Map（`:45`），**server 重启或 proxy 容器重建就全没了**。而定时任务的全部意义就是"客户端长期不在也要跑"——凭证恰好在客户端离线最久的时候失效，这是自相矛盾的设计。要修就得给凭证做持久化，那反而比 (a) 更危险（长期落盘的真 key）。

**建议**：走 (a)。这是唯一需要跨仓库协调的一项，应当**最先启动**（账号后端加接口的排期是关键路径）。

**新增安全面**（必须同时做）：
- cowork-server ↔ codeagent-server 用独立的 service secret，与 `COWORK_AUTH_SECRET` **分开**
- 该接口只能内网访问 / IP 白名单
- 取凭证事件进审计（`cred_fetched`，只记 uid，绝不记 key）

### 3.2 断点②：执行方式 —— `claude -p` + 复用 shim

现有 `exec-bridge.mjs` 是为"给 SDK 当管道"设计的：等 WS header、解帧、双向泵。定时任务不需要交互，只需要**跑完一轮、拿到结果**。

**做法（S0 实测后简化）**：~~给 shim 加 one-shot 模式~~ —— **shim 零改动**。往 stdin 写一个 4 字节零长帧就是现有协议的优雅 EOF，claude 在 `-p` 模式下 prompt 来自 argv、本就不需要 stdin。

```js
// lib/routine-runner.mjs（新建）
const args = [
  'exec', '-i', '-u', '1000', '-w', '/workspace',
  '-e', `ANTHROPIC_BASE_URL=${baseUrl}`,           // cred-proxy
  '-e', `ANTHROPIC_AUTH_TOKEN=${cwkToken}`,        // 一次性 token
  containerName, 'python3', SHIM, '--',            // ← 必须走 shim,否则丢 5 个办公 skill
  '-p', prompt,
  '--output-format', 'stream-json', '--verbose',
  '--dangerously-skip-permissions',                // 办公模式本来就是这个模式
  ...(model ? ['--model', model] : []),
];
const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(Buffer.alloc(4));                  // ← 零长帧 = 优雅 EOF,就这一行
```

**为什么 `--dangerously-skip-permissions` 是对的**：办公模式的交互回合本来就走 `bypassPermissions`（`claude-client.ts:382`），容器内已经强制非 root（`orchestrator.mjs:158`，正是因为 claude 禁止 root + 该参数）。这同时天然满足了 Claude Routines 的"全自主、无审批"语义。

**必须配套的四个护栏**（交互回合有人盯着，定时任务没有）：
| 护栏 | 值 | 理由 |
|---|---|---|
| **401 立即中止** | 见到首条 `api_retry` 且 `error_status:401` 即 kill | **S0 实测：不做就白烧 181 秒**（§0.5 ②） |
| 硬超时 | `COWORK_ROUTINE_TIMEOUT_MS`，默认 15min | claude 可能卡住；超时 SIGTERM → 3s 后 SIGKILL |
| 输出上限 | transcript 单次 ≤ 8MB | 防日志盘打爆 |
| 并发上限 | `COWORK_ROUTINE_CONCURRENCY`，默认 4 | 32 核 / 每容器 2 核，见 R4 |

**成败判定（S0 实测后写死，见 §0.5 ①）**：
```js
const ok = exitCode === 0 && result?.is_error !== true && result?.api_error_status == null;
// 绝不读 result.subtype —— 它在 401 全失败时仍然是 "success"
```

### 3.3 断点③：状态持久化 —— 文件型 store，不引依赖

cowork-server 的运行时依赖只有 `ws` 一个，这个克制值得保留。routine 状态用文件型 store：

```
$COWORK_STATE_DIR (默认 /data/cowork-state)     ← 数据盘 1TB，systemd 用户 cowork 可写
└── routines/
    └── <uid>/
        ├── <routineId>.json          # 定义 + 调度状态（原子写:.tmp + rename）
        └── <routineId>.runs.jsonl    # 运行历史（append-only，尾部 N 条即可，软截断同 audit.mjs）
```

**routine 记录：**
```jsonc
{
  "id": "rt_a1b2c3…",              // 也是它的 sid → 容器 cowork-<sid>、volume cowork-ws-<sid>
  "uid": "<账号 UUID>",
  "name": "每日销售日报",
  "description": "汇总昨天的数据出 xlsx",
  "prompt": "…自包含的完整指令…",
  "model": "claude-opus-4-7",       // 可空 = 服务端默认
  "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" },
  //          | { "kind": "once", "fireAt": "2026-08-10T09:00:00+08:00" }
  //          | { "kind": "manual" }
  "enabled": true,
  "nextRunAt": "2026-08-05T09:03:00+08:00",   // 已含 stagger
  "lastRunAt": null,
  "consecutiveErrors": 0,
  "createdAt": "…", "updatedAt": "…"
}
```

**关键决策：routine 的 id 直接当 sid 用。**
`orchestrator.mjs` 的 sid 约束是 `/^[a-f0-9]{1,64}$/`（`:45`），所以 routineId 生成为 32 位 hex 即可。这样一来：
- routine 拥有**自己的容器 + 自己的持久 volume**，与用户的交互会话完全隔离
- 多次运行**共享同一个 workspace**（办公任务通常有状态：昨天的表今天要接着写）
- `ensureContainer` / `removeContainer` / 文件通道 / 归属校验 / reconcile **全部零改动直接可用**
- 两次运行之间容器被 TTL 回收，下次 `docker start` 秒级复用 —— 资源占用只有一个 volume

这同时回答了前一份调研里的决策 D2（每次运行是否新容器）：**一个 routine 一个持久 workspace，每次运行是一条独立 run 记录**。

**⚠️ reconcile 必须排除 routine 会话**：`index.mjs:83` 的 `/reconcile` 收客户端的 `keep` 列表删孤儿。客户端不知道 routine 的 sid，会把它们全当孤儿删掉。解法：routine 的容器/volume 打额外 label `cowork.kind=routine`，`orchestrator.reconcile()` 跳过这类。**不修就是"用户打开 app → 所有定时任务工作区被清空"。**

### 3.4 断点④：TTL 会回收跑到一半的容器

reaper（`index.mjs:236`）只认 WS 连接。服务端发起的 exec 不经 WS ⇒ `activeExec` 为 0、`lastActive` 可能是很久以前（如果这个 sid 之前被交互用过）⇒ **routine 跑到第 30 分钟被 `docker stop`**。

**解法**：把续命机制从"WS 专属"提升为通用的活跃登记。
```js
// index.mjs 现有的 execOpened/execClosed 已经是正确的抽象，
// routine-runner 起 exec 前后调用同一对函数即可 —— 不需要新机制。
execOpened(routineSid);
try { await runOnce(...); } finally { execClosed(routineSid); }
```
一行一行都是现成的，**只是需要有人记得调**。这条属于"不写进文档就一定会踩"的类型。

### 3.5 断点⑤：结果回传与展示

run 发生在服务端，但用户的展示面是客户端 SQLite。

**服务端存**：`<routineId>.runs.jsonl` 每行一条 run 元数据；transcript（stream-json 原文）单独落 `runs/<runId>.jsonl`。

**新增 REST**（沿用现有鉴权与 uid scope）：
```
GET    /routines                    列出本 uid 的 routine
POST   /routines                    创建
PATCH  /routines/:id                改（prompt/schedule/enabled/model）
DELETE /routines/:id                删（连容器 + volume）
POST   /routines/:id/run            立即运行（可带一次性 text）
GET    /routines/:id/runs?since=    运行历史
GET    /runs/:runId/transcript      取 stream-json 原文
```

**客户端物化**：app 启动 + 每 N 分钟拉 `?since=<本地最新>`，把新 run 转成本地 `chat_sessions` + `messages`（transcript 重放），在办公列表里以「定时」分组呈现，并对离线期间的运行发一条汇总通知（"你不在时跑了 3 次，2 成功 1 失败"）。产物走已有文件通道，零新增。

**诚实边界**：run 完成时用户如果没开 app，**当时收不到通知**（bridge 也在客户端）。要做真正的即时推送需要服务端出站通道，是独立议题，不进本期。

---

## 4. 调度循环设计

放在 `lib/routine-scheduler.mjs`，随 `index.mjs` 启动（和 `cred.ensureProxy()` 同级）：

```js
// 60s tick —— 与 reaper 同频，复用 unref() 惯例
const tick = setInterval(async () => {
  for (const r of await store.listDue()) {          // nextRunAt <= now && enabled
    if (running.size >= CONCURRENCY) break;         // 超并发留到下一 tick
    if (await store.dailyCount(r.uid) >= DAILY_CAP) { skip(r, 'daily_cap'); continue; }
    fire(r);                                        // 不 await，队列由 running.size 控
  }
}, 60_000);
tick.unref?.();
```

**每次 fire 的完整链路：**
```
1. store.markRunning(r)                          写 run 记录 status=running
2. cred = await fetchCredentials(r.uid)          ← RD4-C，账号后端
3. {token,baseUrl} = cred.registerCredentials(r.id, cred)   ← 现有函数，零改动
4. orch.ensureContainer(r.id, r.uid)             ← 现有函数（docker start 复用）
5. execOpened(r.id)                              ← 断点④，否则被 TTL 回收
6. runOnce()  docker exec … shim --oneshot … claude -p    超时 15min
7. execClosed(r.id) + transcript 落盘 + store.finish(r, status)
8. cred.revokeCredentials(r.id)                  ← 用完即废，不留长期凭证
9. computeNextRun(r) + audit('routine_fire'|'routine_error')
```

**第 8 步很重要**：跑完立刻废止 token，服务端在两次运行之间**不持有任何有效凭证**。这让"服务端能自主发起 agent"这件事的攻击窗口只存在于运行期间。

**cron 求值与时区**：客户端已有 `getNextCronTime()`（`src/lib/task-scheduler.ts:456`，按天扫 4 年、覆盖闰年）和 `getJitter()`（`:299`，确定性 stagger）。这两个是**纯函数、零依赖**，直接移植到服务端。但服务器时区与用户时区不同，routine 记录必须带 `tz`，求值时按 `tz` 而非服务器本地时区 —— 这是客户端版本不需要、服务端版本必须补的一点。

**补跑**：服务端常驻，理论上不会错过。但 server 重启/宕机期间可能跳过 ⇒ 启动时扫 `nextRunAt` 已过去的，**只补最近一次**（照抄 Claude Desktop 语义），更早的记 `skipped` 并注明原因。

---

## 5. 分期

| 期 | 内容 | 阻塞依赖 | 验收 | 状态 |
|---|---|---|---|---|
| **S0** | 生产真机验 `claude -p stream-json`：argv / 输出形状 / 退出码 / shim 差异 / EOF 方式 / **成功路径全链路** | 无 | 拿到真实样本 | ✅ **全部完成**（§0.5），技术不确定性清零 |
| **S1** | 账号后端内部凭证接口（RD4-C，§9）+ 沙箱侧取数客户端 | **关键路径** | cowork-server 能用 uid 换到可用凭证 | 📋 |
| **S2** | `routine-runner.mjs` + 四护栏（401 立即中止 / 超时 / 输出上限 / 并发）+ 成败判定口径 | S0 ✅ | 手工触发一条 routine 跑完，transcript 落盘 | 📋 （**shim 零改动**） |
| **S3** | store + 调度循环 + REST 七个端点 + `cowork.kind=routine` label + reconcile 排除 + `execOpened` 续命 | S2 | 建一条 cron routine，客户端全程关闭，到点自动跑完 | 📋 |
| **S4** | 客户端全套（§10）：代理路由 + 拉取物化 + UI + MCP 工具 | S3 | 打开 app 看到离线期间的运行记录，可点开看全过程 | 📋 |
| **S5** | 配额（per-uid 日上限）、`routine_*` 审计事件、`OPERATIONS.md` 补章、selftest-r5 | S3 | selftest 覆盖：调度触发/401 快失败/超时/并发上限/跨用户 404/凭证用后即废 | 📋 |

**S1 是关键路径**，建议立刻确认账号后端的接口排期，其余各期可并行准备。
S0 已把 S2 的不确定性基本清空（唯一剩项是成功路径，风险低）。

---

## 6. 风险登记册

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **reconcile 误删 routine 工作区** | 用户打开 app → 定时任务工作区全清空 | `cowork.kind=routine` label + reconcile 跳过。**S3 必做，不可延后** |
| R2 | **TTL 回收跑到一半的容器** | 长任务在第 30 分钟被 stop | 复用 `execOpened/execClosed`（§3.4） |
| R3 | 服务端持有可自主发起 agent 的能力 | 攻击面从"哑管道"升级为"能主动花钱的执行器" | 用后即废凭证 + 硬超时 + 日配额 + `routine_fire` 审计 + 内部接口内网限定 |
| R4 | 并发打满 | 32 核，每容器 2 核，N 用户同点触发 | 并发上限默认 4 + 确定性 stagger + 超出留到下 tick |
| R5 | **出网禁私网** | "每天读内网系统出报表"这类 routine 直接失败 | 现有 DOCKER-USER 规则拒私网四段。需求出现时按 `setup-egress.sh` 尾注定向放行，并重评横移风险 |
| R6 | token 无人看管地烧 | 跑飞的 routine 没人喊停 | 日配额 + 连续失败自动 disable（照抄客户端的 10 次阈值） |
| R7 | 磁盘增长 | transcript + volume 累积 | transcript 软截断（同 `audit.mjs:24` 手法）+ volume 随 routine 删除清理 + 数据盘 1TB 有余量 |
| R8 | 无 KVM，隔离仍是硬化 runc | 与现有会话同等级，不新增风险但也不减 | 维持现状（RD3 已否决 Kata/gVisor-KVM，RD9 userns-remap 已生效） |

---

## 7. 决策登记册（2026-08-04 用户拍板，全部已定）

| # | 议题 | 决定 | 影响的阶段 |
|---|---|---|---|
| D1 | 谁敲钟 | **服务端调度** —— 跑在沙箱服务器，不占用户电脑 | 全局 |
| D2 | 运行的工作区形态 | **routine 独占一个持久 workspace**（一个 volume，多次运行累积状态） | S3 |
| D3 | 凭证来源 | **RD4-C**：服务端向账号后端直取 | S1 |
| D4 | **凭证接口密钥** | **单独 `APP_COWORK_INTERNAL_SECRET`** + 强制 `exp ≤ 60s` + 审计 + 频控。**不复用 `COWORK_AUTH_SECRET`** | S1 |
| D5 | S1 启动时机 | **等用户明确指示再开始** | S1 |
| D6 | 最小调度间隔 | **15 分钟** | S3 |
| D7 | 并发上限 | **4** | S2/S3 |
| D8 | 每用户日配额 | **20 次/天** | S5 |
| D9 | 模型选择 | 建 routine 时**可选**；默认 = 账号体系下发配置的**第一个** | S4 |
| D10 | 一次性 routine 触发后 | **自动禁用 + 标记「已运行」**（照抄 Claude） | S3/S4 |
| D11 | 连续失败 | **10 次自动 disable** | S3 |
| D12 | 运行历史保留 | **暂时永久保留**（用户量小、磁盘充足；到量再定策略） | S3 |
| D13 | routine 数量上限 | **每用户 50 个** | S3 |
| D14 | 离线期间通知 | **不推送**，打开 app 时汇总呈现 | S4 |
| D15 | routine 访问内网 | **不允许**（维持现有 egress 拒私网四段） | 无需改动 |
| D16 | 旧 `task-scheduler.ts` | 界面早已隐藏、无冲突；新功能稳定后单独起 PR 清理 | S4 后 |

**S0 已全部完成**（§0.5），S2 的技术不确定性清零。

### 由决策派生的实现约束（写进代码时对照）

- **D2 + D13** → routine 建的 volume 是长期资产，`reconcile` 必须排除（§3.3），且创建时校验 `count(routines by uid) < 50`
- **D6** → 建 routine 时校验 cron 表达式的最小间隔 ≥ 15min；UI 的预设里**不提供**「每 5 分钟」这类选项
- **D7** → 并发闸放 runner；超出的 due routine 留到下一 tick，且要 `log` 出来（不能静默丢）
- **D9** → routine 记录存 `config_id` + `model`，创建时从 `/api/v1/internal/cowork/model-credentials` 的 `default_models` 或客户端已有的 managed 列表取第一个作默认
- **D12** → transcript 不做轮转，但**审计日志仍有 64MB 软截断**（那是另一回事，别混淆）
- **D14** → 客户端拉到多条离线运行时合并成一条汇总通知，不逐条弹

---

## 8. 附：一次定时运行的完整时序（目标态）

```
09:03  routine-scheduler tick
        ├ store.listDue() → rt_a1b2…（cron "0 9 * * 1-5" + stagger 3min）
        ├ 并发 1/4，日配额 3/20 → 放行
        ├ fetchCredentials(uid) ────────> codeagent-server（service secret）
        │                          <──── {realKey, realBase, authStyle}
        ├ registerCredentials(rt_a1b2…) ─ docker exec stdin ─> cred-proxy tmpfs
        │                          <──── {token: cwk_…, baseUrl: http://cowork-proxy:8791}
        ├ ensureContainer(rt_a1b2…, uid)   docker start（volume 里还是昨天的工作区）
        ├ execOpened(rt_a1b2…)             ← 挡住 reaper
        ├ docker exec -i … python3 cowork-shim.py --oneshot -- \
        │     /opt/cowork/claude -p "<prompt>" --output-format stream-json \
        │     --verbose --dangerously-skip-permissions --model …
        │     └ shim 先 link 5 个办公 skill → 起 claude（cwd=/workspace）
        │        └ claude 经 cred-proxy 出网 → 生成 昨日销售日报.xlsx 落 /workspace
        ├ transcript → /data/cowork-state/runs/run_xxx.jsonl
        ├ execClosed + revokeCredentials（服务端不再持有任何有效凭证）
        └ audit('routine_fire') + computeNextRun → 明天 09:03

09:41  reaper: rt_a1b2… 空闲超 TTL → docker stop（volume 保留，明天 start 复用）

14:20  用户打开 app
        └ 拉 /routines/rt_a1b2…/runs?since=… → 物化成本地会话
           → 办公列表「定时」分组出现「每日销售日报」，点开看全过程
           → 产物卡片走已有文件通道下载 xlsx
```

---

## 9. 账号后端内部凭证接口（S1）

代码位置：`/Users/yuanqi/project/codeagent-server/`。已读 `app/cowork/{router,service,usage_service}.py`、`app/config_set/service.py`、`app/api_key/service.py`。

### 9.1 凭证在账号后端的真实来源

读代码确认的链路（不是推测）：

```
uid（= Claims.sub = 用户 UUID）
 └ ConfigService.list_for_client(user_id, username)      app/config_set/service.py:43
    ├ repo.get_user_plan_id(user_id)                     ← 套餐门控，拿不到套餐返回空集
    ├ repo.list_visible(only_enabled=True, plan_id)      ← 该套餐可见的 managed 配置
    └ ApiKeyService.ensure_active(user_id, username)     app/api_key/service.py:53
       └ ActiveKey.plaintext                             ← 懒创建：没有就去 new-api 建一个
 → ConfigItem { base_url, auth_token, model, default_opus_model, … }
```

**关键认知**：`base_url` 属于配置行，`auth_token` 属于「用户 × new-api」，两者在 `list_for_client` 里被拼到一起。所以内部接口**不需要新的取数逻辑，直接复用 `ConfigService`**。

### 9.2 接口契约

```
GET /api/v1/internal/cowork/model-credentials?uid=<用户 UUID>&config_id=<可选>
Authorization: Bearer <HMAC token, uid=__sandbox__, 必带 exp>

200 → { "base_url": "...", "auth_token": "...", "auth_style": "auth_token",
        "config_id": "...", "config_name": "...",
        "default_models": { "opus": "...", "sonnet": "...", "haiku": "..." } }
404 → 该 uid 无套餐 / 无可见配置 / cowork 未开通   （同一响应，不区分原因，防探测）
409 → 用户在 new-api 不存在（沿用 /configs 的既有语义）
```

`config_id` 省略时取 `sort_order` 最小的 enabled 配置。routine 记录里存 `config_id`，保证「建 routine 时选的哪套模型，将来就一直用哪套」，不会因为管理员调 `sort_order` 而漂移。

`default_models` 一并返回，让沙箱侧能把 routine 存的 `"opus"` 这类逻辑名解析成真实模型 id —— 复用 managed 的模型别名体系（memory 记过：managed 模型 id 可能是 `claude-opus-4-7[1m]` 这类 CLI 别名，而这里**恰好就是在跑 CLI**，别名天然可解析，比走 `@ai-sdk` 直连更稳）。

### 9.3 鉴权：为什么建议**另起一个密钥**

现成的路子是复用 `COWORK_AUTH_SECRET`（账号后端已经用它自签 `__admin__` 调沙箱）。技术上可行，但**这里必须停一下**：

| | 现在 | 加了本接口之后 |
|---|---|---|
| 拿到 `COWORK_AUTH_SECRET` 能干什么 | 冒充任意用户访问**沙箱**（会话、文件） | 再加一条：**批量导出全体用户的模型 API key** |

密钥存在沙箱服务器的 `/opt/cowork-server/.env`。沙箱是**跑不可信 agent 代码**的机器 —— 它被攻破的概率本来就高于账号后端，而这个改动会让"攻破沙箱"直接升级成"拖走所有人的模型凭证"。**这是一次质变，不是量变。**

**建议**：
- 单独的 `APP_COWORK_INTERNAL_SECRET`（沙箱侧 `COWORK_INTERNAL_SECRET`），与 `COWORK_AUTH_SECRET` 分开轮换
- token **必须带 `exp`**，TTL ≤ 60s（`sign_cowork_token` 已支持 `ttl_sec`，直接可用）
- 保留 uid `__sandbox__`（用户 uid 恒为 UUID，不可能碰撞 —— 与 `__admin__` 同一论证）
- 落审计：记 `requested_uid` + 调用方 IP + 时间，**绝不记 key 本体**
- 频控：同一 uid 每分钟 ≤ N 次（正常情况一个 routine 触发只取一次）
- 网络层：接口只挂在内部路由前缀，配合反代限制来源 IP

如果嫌两套密钥麻烦，退一步的最小要求是：**至少把 `exp` 和审计做上**，并且明确接受"沙箱失陷 = 凭证全泄"这个风险。这个取舍需要你拍板。

### 9.4 落地文件清单（codeagent-server）

| 文件 | 改动 |
|---|---|
| `app/cowork/internal.py` | **新建**：路由 + `__sandbox__` token 校验依赖 |
| `app/cowork/service.py` | 加 `verify_sandbox_token(token) -> bool`（与 `sign_cowork_token` 对称的验签）+ `resolve_internal_secret()` |
| `app/cowork/schemas.py` | `ModelCredentialsResponse` |
| `app/deps.py` | 依赖注入 `SandboxAuthDep` |
| `app/config.py` | `APP_COWORK_INTERNAL_SECRET` |
| `app/main.py`（或 router 汇总处） | 挂 `/api/v1/internal` 前缀 |
| `docs/cowork-internal-credentials-api.md` | **新建**：契约 + golden 向量（照抄 `cowork-config-api.md` 的写法，那份已被沙箱侧验签实证过） |
| `tests/cowork/test_internal_credentials.py` | 验签通过/失败/过期、uid 不存在 404、无套餐 404、new-api 缺号 409 |
| `.env.production.example` + `docker-compose.yml` | **透传新变量** —— ⚠️ 交接文档 A.5④ 记过：compose 漏透传 `APP_COWORK_*` 导致接口对所有人 404，别再踩 |

---

## 10. 客户端设计（S4）

> 🎨 **配套可交互原型：[prototypes/scheduled-routines-prototype.html](prototypes/scheduled-routines-prototype.html)**（七屏走查，浏览器直接打开）
> 1 入口 · 2 任务列表 · 3 新建表单 · 4 详情与运行历史 · 5 点开一次运行 · 6 对话里直接创建 · 7 离线归来与异常态

### 10.1 角色转变：客户端不再参与执行

这是和现有办公模式**最根本的差别**，先说清楚：

| | 现有办公会话 | 定时任务 |
|---|---|---|
| agent loop 在哪 | **客户端** Next server（SDK query） | **服务端**（`claude -p`） |
| 客户端角色 | 驱动者，关掉就断 | **纯管理与展示前端**，关掉不影响 |
| 消息从哪来 | 本地 SDK 实时流 | 服务端 transcript **重放** |

所以客户端要做的三件事只是：**管理（CRUD）、拉取（同步）、展示（物化成会话）**。

### 10.2 核心设计决策：运行**复用会话渲染，但不进办公对话列表**

> ⚠️ **本节已于 2026-08-04 按用户反馈改版（原型 v2）。**
> ~~初版设计是「一次运行物化成一个办公会话 + 侧边栏加『⏰ 定时』分组」~~ —— 已废弃。
> 用户指出：自动产生的会话混进对话列表会让人**很乱很疑惑**。这个判断是对的。

**问题**：定时任务每天都在产出会话，混进办公对话列表会把用户自己的对话越推越远；而且「我没建过这个对话」本身就令人困惑。

**改后的方案 —— 拆开「存储复用」与「导航归属」两件事：**

| | 决定 |
|---|---|
| 存储与渲染 | **仍然**把每次 run 重放成 `chat_sessions` + `messages` —— 整个聊天 UI、产物卡片、Markdown、代码高亮、下载全部零成本复用 |
| 导航归属 | **不进办公对话列表**。只能从「定时任务」页内进入，靠**三层面包屑导航** |

三层导航（全部发生在「定时任务」这一个页面区域内）：

```
① 任务列表  ──点卡片──▶  ② 任务详情（配置 + 运行历史表）──点历史行──▶  ③ 某次运行的完整过程
   ⏰ 定时任务              ⏰ 定时任务 / 每日销售日报            ⏰ 定时任务 / 每日销售日报 / 08-04 09:03 的运行
```

第三层额外提供**「← 上一次 / 下一次 →」**，让用户横向比对连续几天的结果——这是定时任务特有的浏览需求，普通会话没有。

**实现上这只是一个过滤条件**：office 列表查询加 `AND routine_id IS NULL`，定时任务页按 `routine_id` 查。存储层完全不变，复用的好处一分没丢。

### 10.3 数据模型

**本地是缓存，服务端是权威。** 冲突一律以服务端为准（拉取即覆盖），不做本地编辑合并。

```sql
-- 新表：routine 定义的本地镜像
CREATE TABLE cowork_routines (
  id TEXT PRIMARY KEY,              -- 服务端 routine id（同时也是它的 sid）
  owner_uid TEXT NOT NULL,          -- 账号隔离，与 chat_sessions 同一机制
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  model TEXT,
  config_id TEXT,                   -- §9.2：锁定 managed 配置，防漂移
  schedule_kind TEXT NOT NULL,      -- cron | once | manual
  schedule_expr TEXT NOT NULL DEFAULT '',
  schedule_tz TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT, last_run_at TEXT, last_status TEXT,
  synced_at TEXT NOT NULL,          -- 最后一次与服务端对齐的时间
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- chat_sessions 加两列：标记「这个会话是某次定时运行物化来的」
ALTER TABLE chat_sessions ADD COLUMN routine_id TEXT;
ALTER TABLE chat_sessions ADD COLUMN routine_run_id TEXT;
CREATE INDEX idx_sessions_routine ON chat_sessions(routine_id);
```

**运行记录不单独建表** —— run 就是一个 session，`routine_run_id` 做幂等键（重复拉取不重复物化）。

🔴 **同时必须改办公会话列表的查询**（10.2 改版带来的硬要求）：

```diff
- WHERE sandbox_enabled = 1 AND owner_uid = ?
+ WHERE sandbox_enabled = 1 AND owner_uid = ? AND routine_id IS NULL
```

`db.ts` 里凡是给**办公对话列表**取数的地方都要加这个条件（`SESSION_VISIBLE_WHERE` 附近）。
**漏一处，定时任务的会话就会漏进对话列表** —— 正是本次改版要消除的那个体验问题。
建议加一个单测：造一条 `routine_id` 非空的会话，断言它不出现在办公列表、但能按 `routine_id` 查到。

### 10.4 同步与物化

```
routine-sync.ts
 ├ 触发时机：app 启动 / 打开定时面板 / 每 10 分钟（对齐现有 cowork config 同步节奏）
 ├ 1. GET /routines                    → upsert cowork_routines（按 owner_uid）
 ├ 2. GET /routines/:id/runs?since=<本地最新 run 的时间戳>
 ├ 3. 对每条新 run：
 │     ├ GET /runs/:runId/transcript   → stream-json
 │     ├ replayTranscript() → Message[]
 │     ├ createSession({ sandbox_enabled:1, owner_uid, routine_id, routine_run_id,
 │     │                 title: `${routine.name} · ${本地时间}` })
 │     └ 批量 addMessage()
 └ 4. 有新 run → notification-manager 发通知
       离线期间多条 → 合并成一条汇总（"你不在时跑了 3 次，2 成功 1 失败"）
```

**幂等**：物化前先查 `routine_run_id` 是否已存在，存在则跳过。断网/中途失败重试安全。

**失败的 run 也要物化**，把 `is_error` + 错误文本渲染成一条醒目的消息 —— 定时任务最需要被看见的恰恰是失败。

### 10.5 UI

形态照 Claude 桌面版的 Routines 页，**但入口放在办公 tab 内**（不是设置页 —— 它是工作对象，不是配置项）。

**入口**：`ChatListPanel.tsx` 办公 tab 的功能行现在是 `activeTab === 'office' && <文生图>`（`:719`）。
在它**下方竖排**加一个「**定时任务**」按钮（不并排、文案不简写），右侧带任务数徽标。

**四个界面**：
| 界面 | 内容 |
|---|---|
| ① 任务列表 | 名称 / 描述 / 人类可读调度（"每个工作日 09:00"，由 `schedule_kind+expr+tz` 渲染，**不给用户看裸 cron**）/ 下次运行 / 上次结果 / 状态徽标（运行中·已启用·已暂停·连续失败 N 次）+ 顶部常驻今日配额与 `n/50` |
| 新建・编辑 | 名称 + 描述 + 指令（复用 `MessageInput` 的编辑体验）+ 模型选择器（复用现有 managed 下拉）+ 调度选择器（预设 仅手动/每小时/每天/工作日/每周/指定时间跑一次 + 高级 cron）|
| ② 任务详情 | 面包屑第二层。配置摘要 + 立即运行 / 暂停恢复 / 编辑 / 删除 + **运行历史表**（时间·状态·耗时·成本·结果摘要） |
| ③ 某次运行 | 面包屑第三层。**只读回放**完整过程（复用聊天组件）+ 产物卡片 + 「← 上一次 / 下一次 →」 |

**~~会话列表分组~~** —— 已废弃，见 §10.2。办公对话列表里**不出现任何定时任务会话**。

**调度选择器不暴露裸 cron 作为主路径** —— 预设覆盖 90% 场景，cron 藏在「高级」里。这是 Claude 两个产品面（Web 预设 + CLI cron）的一致做法。**且预设里不提供「每 5 分钟」这类低于 15 分钟的选项**（D6）。

### 10.6 三条创建入口

1. **UI 表单**（主）
2. **对话里自然语言** —— `src/lib/routines-mcp.ts` 注册 `codepilot_routine_{create,list,update,delete,run}`，复刻现有 `notification-mcp` 的注册范式。用户说「每个工作日早上把昨天的数据整理成表发我」直接建出来。**只在办公会话注册**（研发会话没有沙箱，建了也跑不了）。
   🔴 **创建成功的回复必须明说结果去哪**：「运行结果会出现在左侧『⏰ 定时任务』里，不会打扰这个对话」。
   §10.2 改版后结果不再落进对话列表，**没有这一句用户会一直在当前对话里等结果** —— 这是本次改版引入的新失败模式，写进 MCP 工具的 system prompt
3. **从现有办公会话「存为定时任务」** —— 把当前会话的最后一条 user prompt 预填进新建表单。这是最自然的发现路径：用户手动干了一次，觉得每天都要干，顺手固化

### 10.7 门控与降级

- **可用性 = 办公模式可用性**：复用 `/api/cowork/status` 的 `assets.overall`。未开通/非支持平台 → 「定时」按钮**不渲染**（不是置灰 —— 对齐 R5-6 已定的"绝不给不可用的下载按钮"原则）
- **服务端不可达**：列表用本地缓存渲染 + 顶部一条「离线，显示的是上次同步的数据」提示条。**不允许本地新建**（会和服务端状态分叉）
- **换账号**：清空 `cowork_routines` 重拉；物化的 session 靠 `owner_uid` 天然隔离

### 10.8 落地文件清单（LabCodepilot）

**新建**
| 文件 | 职责 |
|---|---|
| `src/lib/routines-client.ts` | 沙箱 REST 客户端（复用 `cowork-backend-remote.ts` 的 `remoteConfig`/`authHeaders` 模式） |
| `src/lib/routine-transcript.ts` | stream-json → `Message[]`（纯函数，好单测） |
| `src/lib/routine-sync.ts` | 拉取 + 幂等物化 + 通知 |
| `src/lib/routines-mcp.ts` | 五个 MCP 工具 |
| `src/app/api/routines/route.ts`<br>`src/app/api/routines/[id]/route.ts`<br>`src/app/api/routines/[id]/run/route.ts`<br>`src/app/api/routines/[id]/runs/route.ts` | 代理层 —— **token 留在 Next server，绝不进 renderer**（沿用现有 cowork 路由的做法） |
| `src/components/routines/{RoutinePanel,RoutineForm,RoutineDetail,RoutineRunHistory,Schedulepicker}.tsx` | UI |

**改**
| 文件 | 改动 |
|---|---|
| `src/lib/db.ts` | `cowork_routines` 表 + `chat_sessions` 两列 + 迁移（`safeAddColumn`）+ 🔴 **办公列表查询加 `routine_id IS NULL`**（§10.3） |
| `src/types/index.ts` | `CoworkRoutine` / `RoutineRun` / `RoutineSchedule` |
| `src/components/layout/ChatListPanel.tsx` | 办公 tab 在「文生图」**下方**加「定时任务」入口（竖排）。**不加会话分组** |
| `src/lib/claude-client.ts` | 办公会话注册 routines MCP |
| `src/i18n/{en,zh,zh-HK}.ts` | 三语键。⚠️ **zh-HK 手工加，别跑 `gen-zh-hk.mjs`**（会回退约 40 个已校对的港式术语） |

### 10.9 和现有 `task-scheduler.ts` 的关系 —— ✅ 已澄清，无冲突

本仓库有一套旧的定时任务（`src/lib/task-scheduler.ts` + `scheduled_tasks` 表 + `/api/tasks/*`，客户端调度、纯文本执行）。

**用户已确认：它在界面上早就隐藏了，用户看不到。** 所以**不存在"两个定时任务"的命名与入口冲突**，新功能可以直接占用「定时任务」这个名字和办公 tab 的入口位置，不需要先做下线。

但有两点仍要注意（不阻塞 S4，作为技术债登记）：

1. **它还在跑。** `src/instrumentation.ts:25` 每次 server 启动都会 `ensureSchedulerRunning()`，10s 轮询照常。UI 隐藏 ≠ 代码停止。虽然表里没数据就没有实际动作，但空转的轮询和它的 `owner_uid` 缺陷都还在。
2. **命名空间要分开。** 新体系用 `cowork_routines` 表 + `/api/routines/*` 路由，与旧的 `scheduled_tasks` + `/api/tasks/*` **完全不重叠**（本文 §10.3/§10.8 已按此设计），两者可以静默共存不打架。

**建议**：S4 完成、新功能稳定后，再单独起一个小 PR 清理旧代码（删 `task-scheduler.ts` + `/api/tasks/*` + 表）。现在不动它，避免给主线增加无关风险。
