# 沙箱定时任务（服务端调度 · 对标 Claude Routines）

> 创建时间：2026-08-04
> 最后更新：2026-08-04
> 分支：`scheduler`
> 调研与设计：[docs/research/cowork-server-side-routines.md](../../research/cowork-server-side-routines.md)（服务端实读 + 五个断点 + 客户端设计）
> 能力对标基线：[docs/research/cowork-scheduled-routines.md](../../research/cowork-scheduled-routines.md)（Claude 三套调度辨析 + U1-U15 验收清单）
> 交互原型：[docs/research/prototypes/scheduled-routines-prototype.html](../../research/prototypes/scheduled-routines-prototype.html)（七屏 v2）

## 一句话

定时任务跑在**公司沙箱服务器**上（关掉客户端、关掉电脑照常运行），客户端只做**管理 / 拉取 / 展示**。
涉及三个仓库：`LabCodepilot`（客户端）、`apps/cowork-server`（沙箱控制面）、`codeagent-server`（账号后端）。

## 状态

| Phase | 内容 | 仓库 | 状态 | 备注 |
|-------|------|------|------|------|
| P0 | 技术验证：生产真机验 `claude -p` | — | ✅ 已完成 | 五条结论改变了实现，见「决策日志 2026-08-04 ②」 |
| P1 | 账号后端内部凭证接口 | codeagent-server | ✅ **已上线并联调通过** | 21 单测；生产实测密钥配对成功、取回真实凭证 |
| P2 | 沙箱执行器 `routine-runner` | cowork-server | ✅ **已完成并生产实测** | 成功/401/超时/溢出/并发闸全验；**顺带补完 P0 的成功路径** |
| P3 | 沙箱调度 + 存储 + REST | cowork-server | ✅ **已上线并端到端验证** | selftest-r5 37/37；生产上调度器自主触发跑通全链 |
| P4 | 客户端数据层 + 代理路由 | LabCodepilot | ✅ **完成**（10 单测 / 全量 2646 passed） | 代理层已对**生产沙箱**实测通全部端点 |
| P5 | 客户端同步与物化 | LabCodepilot | ✅ 完成 | 端到端留 P9 打包态验 |
| P6 | 客户端 UI 三层 | LabCodepilot | 📋 待开始 | 依赖 P4 |
| P7 | 创建入口（MCP / 存为定时）+ 通知 + i18n | LabCodepilot | 📋 待开始 | 依赖 P6 |
| P8 | 加固与运维（配额 / 审计 / selftest / 手册） | cowork-server | 📋 待开始 | 依赖 P3 |
| P9 | 端到端联调 + 双文档 + 打包验收 | 全部 | 📋 待开始 | 依赖全部 + P1 |

### 依赖与并行

```
P1 ─────────────────────────────────────────────┐
                                                 │
P0 ✅ ──▶ P2 ──▶ P3 ──┬──▶ P5 ──┐                │
                      │         ├──▶ P7 ──▶ P9 ◀─┘
                      ├──▶ P8   │
                      │         │
        （契约冻结）───┴──▶ P4 ──┴──▶ P6
```

**关键路径 = P2 → P3 → P5 → P7 → P9**，且 P9 还要等 P1。

**加速手段：契约先行。** P3 一开工就把 REST 契约写死成文档（`apps/cowork-server/docs/routines-api.md`），
P4/P6 立刻可以对着契约并行开发，不必等服务端跑通。这能把客户端的工作量从关键路径上摘掉大半。

**P1 越晚启动越危险** —— 它不在关键路径上，但 P9 必须等它；一旦它成为最后一块，前面所有并行的收益都被抵消。

---

## 决策日志

**2026-08-04 ① 十六项设计决策（用户拍板）**

| # | 决定 |
|---|---|
| D1 | 谁敲钟 = **服务端调度**（跑沙箱服务器，不占用户电脑） |
| D2 | **routine 独占一个持久 workspace**，多次运行状态累积 |
| D3 | 凭证走 **RD4-C**：服务端向账号后端直取 |
| D4 | 凭证接口用**单独的 `APP_COWORK_INTERNAL_SECRET`** + 强制 `exp ≤ 60s` + 审计 + 频控 |
| D5 | P1 **等用户明确指示再启动** |
| D6 | 最小调度间隔 **15 分钟** |
| D7 | 并发上限 **4** |
| D8 | 每用户日配额 **20 次/天** |
| D9 | 建 routine 时**可选模型**，默认取账号下发配置的**第一个** |
| D10 | 一次性 routine 触发后**自动禁用 + 标记「已运行」** |
| D11 | 连续失败 **10 次自动 disable** |
| D12 | 运行历史**暂时永久保留** |
| D13 | routine 数量上限 **每用户 50 个** |
| D14 | 离线期间**不推送**，打开 app 时汇总呈现 |
| D15 | routine **不能访问内网**（维持现有 egress 拒私网四段） |
| D16 | 旧 `src/lib/task-scheduler.ts` 界面早已隐藏、无冲突；新功能稳定后单独起 PR 清理 |

**D4 的理由**（采纳了对复用 `COWORK_AUTH_SECRET` 的异议）：沙箱是**跑不可信 agent 代码**的机器，
被攻破概率本就高于账号后端。复用同一密钥会让「攻破沙箱」从「冒充用户访问沙箱」直接升级为
「批量导出全体用户的模型 API key」—— 这是质变而非量变。

**2026-08-04 ② P0 实测的五条结论（已改变实现方案）**

1. **不需要给 shim 加 `--oneshot`** —— stdin 写 4 字节零长帧就是现有协议的优雅 EOF，shim **零改动**
2. **必须走 shim** —— 绕开直连 claude 会丢掉全部 5 个办公 skill（实测 14 个 vs 19 个）
3. **`result.subtype` 是陷阱** —— 401 全失败的回合 `subtype` 仍是 `"success"`，真信号是 `is_error` + `api_error_status`
4. **坏凭证不快速失败** —— 401 触发 10 次指数退避，实测烧 **181 秒**才 exit 1
5. result 消息自带 `duration_ms` / `total_cost_usd` / `usage` → 配额与用量统计免费拿到

**2026-08-04 ③ 客户端交互改版（用户反馈，原型 v2）**

- 侧边栏按钮文案「定时」→「**定时任务**」，位置从与「文生图」并排改为其**下方竖排**
- **定时任务产生的会话不再混进办公对话列表** —— 原设计会让用户「很乱很疑惑」。
  改法是拆开**存储复用**与**导航归属**：仍物化成 `chat_sessions`（渲染零成本复用），
  但办公列表查询加 `routine_id IS NULL`，只能从「定时任务」页经**三层面包屑**进入
- 第三层新增「← 上一次 / 下一次 →」：横向比对连续几天的结果是定时任务特有的浏览需求

**2026-08-04 ④ 分支与备份**

- `vm_cowork` 的 4 个本地 commit（含用量后台 P0）此前从未推送，GitHub 提示「无可合并内容」属实；已合入 `para` 并推送
- 新增 `apps/cowork-server/deploy/verify-deployment.sh` 部署漂移检测；实测生产**落后**仓库 3 个文件，无生产独有代码
- 本功能全部工作在 `scheduler` 分支（从 `para` 拉出）

---

## P0 · 技术验证 ✅

在生产建 uid=`s0-probe` 探针会话跑完全部验证，**结束后已清理零残留**。
结论见「决策日志 ②」，完整记录见 [research 文档 §0.5](../../research/cowork-server-side-routines.md)。

**唯一未验项**：成功路径（需真实凭证）。机制面全证，风险低。用户已提供测试 key，可随时补跑。

---

## P1 · 账号后端内部凭证接口 ✅ 代码完成

> 2026-08-04 交付于 codeagent-server `main` 分支 commit `99c044d`（**本地,未推送**）。
> 开发文档：`codeagent-server/docs/cowork-internal-credentials-api.md`（含 golden 向量与部署自检）。
>
> **交付内容**：`app/cowork/internal.py` 路由 + `verify_sandbox_token()` + `ModelCredentialsResponse`
> + `APP_COWORK_INTERNAL_SECRET` 配置 + 21 条单测 + 三处 env 透传 + 开发文档。
> 全仓 155 passed；ruff/mypy 回到改动前基线（63/57，新增文件零告警）。
>
> **实现中确认的一件事（会影响 P2）**：`auth_style` 默认是 **`api_key` 而不是 `auth_token`**。
> 核实自客户端真实推断链路 —— managed 配置映射成 `provider_type='anthropic'` 且 extra_env 不含
> `ANTHROPIC_AUTH_TOKEN`，经 `inferAuthStyleFromLegacy` 落 `api_key` 分支（注入 `x-api-key`）。
> P2 的 runner 据此设 `ANTHROPIC_API_KEY`；本文早前草案里写的 `auth_token` 是错的。
>
> **剩余**：部署到生产（`docker compose up -d --build backend` + 配 `APP_COWORK_INTERNAL_SECRET`）、
> 与 P2 真实联调。

**目标**：让沙箱在没有客户端在场时，凭 uid 换到该用户的模型凭证。

### 契约

```
GET /api/v1/internal/cowork/model-credentials?uid=<用户UUID>&config_id=<可选>
Authorization: Bearer <HMAC token, uid=__sandbox__, 必带 exp>

200 → { base_url, auth_token, auth_style, config_id, config_name,
        default_models: { opus, sonnet, haiku } }
404 → 无套餐 / 无可见配置 / 未开通（同一响应防探测）
409 → 用户在 new-api 不存在（沿用 /configs 既有语义）
```

**取数零新增逻辑** —— 复用 `ConfigService.list_for_client(user_id, username)`
（`app/config_set/service.py:43`，内含套餐门控）+ `ApiKeyService.ensure_active`
（`app/api_key/service.py:53`，懒建 new-api key）。

### 文件

| 文件 | 改动 |
|---|---|
| `app/cowork/internal.py` | **新建**：路由 + `__sandbox__` token 校验依赖 |
| `app/cowork/service.py` | 加 `verify_sandbox_token()` + `resolve_internal_secret()` |
| `app/cowork/schemas.py` | `ModelCredentialsResponse` |
| `app/deps.py` | `SandboxAuthDep` |
| `app/config.py` | `APP_COWORK_INTERNAL_SECRET` |
| `docs/cowork-internal-credentials-api.md` | **新建**：契约 + golden 向量（照抄 `cowork-config-api.md` 写法） |
| `tests/cowork/test_internal_credentials.py` | 验签通过/失败/过期、uid 不存在 404、无套餐 404、new-api 缺号 409 |
| `.env.production.example` + `docker-compose.yml` | ⚠️ **透传新变量** —— A.5④ 踩过：compose 漏透传导致接口对所有人 404 |

### 验收
- pytest 全绿；沙箱侧能用 `__sandbox__` token 换到可用凭证并真调通模型
- 错误密钥 / 过期 token / 越权 uid 三种情况均被正确拒绝且**不泄漏原因差异**
- 审计里能查到「谁在什么时候为哪个 uid 取过凭证」，且**日志中无 key 本体**

---

## P2 · 沙箱执行器

**目标**：`cowork-server` 能自己发起并跑完一轮 agent，拿到结构化结果。

### 内容

新建 `apps/cowork-server/lib/routine-runner.mjs`：

```js
const args = ['exec', '-i', '-u', '1000', '-w', '/workspace',
  '-e', `ANTHROPIC_BASE_URL=${baseUrl}`, '-e', `ANTHROPIC_AUTH_TOKEN=${cwkToken}`,
  containerName, 'python3', SHIM, '--',          // ← 必须走 shim（P0 结论 2）
  '-p', prompt, '--output-format', 'stream-json', '--verbose',
  '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])];
const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(Buffer.alloc(4));                 // ← 零长帧 = 优雅 EOF（P0 结论 1）
```

**四个护栏**（交互回合有人盯着，定时任务没有）：

| 护栏 | 值 | 依据 |
|---|---|---|
| **401 立即中止** | 见首条 `api_retry` 且 `error_status:401` 即 kill，标 `credential_error` | P0 结论 4：不做就白烧 181 秒 |
| 硬超时 | `COWORK_ROUTINE_TIMEOUT_MS` 默认 15min，SIGTERM → 3s → SIGKILL | claude 可能卡住 |
| 输出上限 | transcript ≤ 8MB | 防盘打爆 |
| 并发闸 | `COWORK_ROUTINE_CONCURRENCY` 默认 **4**（D7） | 32 核 / 每容器 2 核 |

**成败判定写死**（P0 结论 3）：
```js
const ok = exitCode === 0 && result?.is_error !== true && result?.api_error_status == null;
// 绝不读 result.subtype
```

非 401 的 retry（429 / 5xx）**让它退避**，不要一见 retry 就杀。

### 验收 ✅（2026-08-04 生产真机，探针 uid=`p2probe`，跑完已清理零残留）

| 项 | 结果 |
|---|---|
| 手工触发跑完 | ✅ `success` / exit 0 / 6.8s / $0.153 / 3 turns |
| transcript 落盘 | ✅ 7 行 5826 B |
| **产物真在卷里** | ✅ 经文件通道读出 `/workspace/hello.txt` (5B) = `"P2 OK"`，会话容器未唤醒 |
| cwd / 模型 / skill | ✅ `/workspace`、`deepseek-v4-flash[1m]`（CLI 别名可解析）、**19 个 skill 含全部 5 个办公 skill** |
| 401 立即中止 | ✅ **3 秒**（P0 基线 181 秒，60×） |
| 硬超时 | ✅ 阈值调 4s 实测 `timeout`，走的是与 401 相同的 kill 路径 |
| 输出上限 | ✅ 阈值调 2KB 实测 `output_overflow` |
| 并发闸 | ✅ `CONCURRENCY=0` → `skipped`/`concurrency_limit`，零容器 |
| 未配后端 | ✅ `credential_error: not_configured`，归类清晰 |

**🐛 实测抓到一个真 bug（已修，注释留档）**：`--` 之后**不能再写 claude 二进制路径** ——
`cowork-shim.py` 自己会 `Popen([CLAUDE_BIN] + argv)`。多写一次会让它变成 claude 的
**第一个位置参数**，而 `-p/--print` 是布尔开关、prompt 走位置参数 → `/opt/cowork/claude`
成了真正的 prompt，用户写的指令被丢掉。而回合照样 **exit=0 / status=success / 花掉 $0.39**，
模型一本正经地介绍「/opt/cowork/claude 是什么」。**只有读输出才发现** ——
这是「绿色不等于任务达成」最好的活标本，也是 P0 结论 ③ 的现场复现。

**未验**：无。四个护栏 + 成功路径 + 产物取回全部实测过。

### 交付
| 文件 | 说明 |
|---|---|
| `lib/backend-credentials.mjs` | 向账号后端取凭证（P1 对端）+ `CredentialError` 归类（not_configured / backend_unreachable / not_provisioned / newapi_user_missing / rate_limited / backend_error） |
| `lib/routine-runner.mjs` | 执行器本体 + 四护栏 + 成败判定 + 用后即废凭证 |
| `routine-once.mjs` | 手工触发 CLI（验收工具 + 日后排障入口），支持 `COWORK_TEST_REAL_*` 绕开账号后端联调 |

三个文件已部署生产，但 **`index.mjs` 尚未引用它们** —— 对现网服务零影响，等 P3 接线。

---

## P3 · 沙箱调度 + 存储 + REST ✅ 代码完成

> 2026-08-04 交付（`b24db74`）。`selftest-r5.mjs` **37 项全过**（生产上跑的）。
>
> **交付**：`routine-store`（文件型存储）· `routine-cron`（**时区感知**求值，实测 0-3ms）·
> `routine-scheduler`（60s tick + 补跑 + 配额 + 自动停用）· `routine-api`（REST 八端点）·
> `orchestrator` 加 `cowork.kind` · `index.mjs` 接线 · `install.sh` 建 state 目录。
>
> **两条红色项已落地并被自检锁住**：reconcile 排除 `kind=routine`；`ROUTINE_ACTIVITY`
> 把 `execOpened/execClosed` 接进 runner 与调度器（自检直接正则断言接线在位）。
>
> **自检抓到三个真问题**（全已修）：① `readBody` 返回原始字符串不是 JSON，当成对象用
> 导致所有创建报「name is required」；② `getRoutine` 的校验在 try 内，路径穿越守卫不可观测；
> ③ **自检把 2 行 `routine_end` 写进了生产审计日志**（audit.mjs 在模块加载时读
> `COWORK_AUDIT_FILE`，我在 import 之后才设）——已修并复验行数不变，已发生的 2 行留档不改。
>
> ### ✅ 生产端到端验收（2026-08-05）
>
> 已重启并配齐 `COWORK_BACKEND_URL` / `COWORK_INTERNAL_SECRET`（后者与 `COWORK_AUTH_SECRET`
> 实测不同值，D4 成立）。用真实账号跑通全链：
>
> | 项 | 结果 |
> |---|---|
> | 密钥配对 | ✅ 取回真实凭证（配置 `Qwen3.7-Max`，`authStyle: api_key` —— 与 P1 从客户端推断链路得出的结论一致） |
> | **调度器自主触发** | ✅ `fireAt 01:33:55` → `ranAt 01:34:27`（一个 tick 内），全程无人工干预 |
> | 一次性自动停用（D10） | ✅ 跑完 `enabled=false` + `ranAt` 落位 |
> | 运行历史 | ✅ `success` / 16.4s / $0.104 / 3 turns / exit 0 |
> | transcript | ✅ 落盘 7690 B，REST 可取，`cwd=/workspace`、**19 个 skill** |
> | 产物 | ✅ 经文件通道读出 `/workspace/e2e.txt` = `"P3 E2E OK\n"` |
> | `cowork.kind=routine` 标签 | ✅ 容器与卷都带上了（reconcile 靠它保命） |
> | 审计链 | ✅ `routine_create → cred_issued → routine_fire → routine_end(code=0) → cred_revoked` |
> | `POST /routines/:id/run` | ✅ `{"started":true}`，15 秒内 success |
>
> **🐛 端到端抓到一个真 bug（已修）**：账号配置的角色模型没过河 —— 首次运行的
> `init.model` 是容器内置默认 `claude-opus-4-8[1m]`，而该账号配的是 `qwen3.7-max[1m]`。
> 网关恰好放行，所以**既没报错也没人发现**，只有去读 transcript 的 init 消息才看得出来。
> 修法：把 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` /
> `CLAUDE_CODE_EFFORT_LEVEL` 按客户端 `managed-providers.ts` 的映射注入容器，
> 且 routine 未显式选模型时退到账号配置的 opus 角色。复验 `model: qwen3.7-max[1m]` ✅。
>
> 探针资源已全部清理（0 个 routine 残留、无 `kind=routine` 的容器/卷）。

**目标**：客户端全程关闭，routine 也能按时自动跑完。

### 存储（文件型，不引新依赖 —— 现在整个服务只依赖 `ws`）

```
$COWORK_STATE_DIR（默认 /data/cowork-state）
└── routines/<uid>/
    ├── <routineId>.json          # 定义 + 调度状态（.tmp + rename 原子写）
    └── <routineId>.runs.jsonl    # 运行历史（append-only，永久保留 D12）
└── runs/<runId>.jsonl            # transcript 原文
```

**routineId 直接当 sid 用**（sid 约束就是 `[a-f0-9]{1,64}`）：于是 routine 自动拥有独立容器 + 独立持久 volume，
`ensureContainer` / 文件通道 / 归属校验 / `removeContainer` **全部零改动可用**（D2）。

### 调度循环

60s tick，与现有 reaper 同频。cron 按 routine 自带 `tz` 求值（**不是服务器本地时区**），
移植客户端现成的纯函数 `getNextCronTime` / `getJitter`（`src/lib/task-scheduler.ts:456,299`）。
server 重启后扫过期项，**只补最近一次**，更早的记 `skipped`。

### REST

```
GET/POST   /routines            列出 / 创建（校验 ≤50 个 D13、间隔 ≥15min D6）
PATCH/DELETE /routines/:id      改 / 删（删连容器 + volume）
POST       /routines/:id/run    立即运行
GET        /routines/:id/runs?since=
GET        /runs/:runId/transcript
```

鉴权**完全复用**现有 HMAC（客户端带自己的 Bearer，uid 从签名取）。

### 🔴 两条不做就是线上事故

| # | 事项 | 不做的后果 |
|---|---|---|
| 1 | routine 的容器/volume 打 `cowork.kind=routine` label，`orch.reconcile()` **跳过这类** | 客户端调 reconcile 时不知道 routine 的 sid，会把它们全当孤儿删掉 → **用户打开 app 就清空所有定时任务工作区** |
| 2 | routine 运行期调现成的 `execOpened(sid)` / `execClosed(sid)` | reaper 只认 WS 连接，服务端 exec 不经 WS → **跑到第 30 分钟被 TTL 回收** |

两条的机制都是现成的，纯粹是「要记得调」。

### 验收
- 建一条 cron routine，**客户端全程关闭**，到点自动跑完，产物落在 volume 里
- 跑一次 reconcile，routine 的容器与 volume **完好无损**
- 造一个跑超 30 分钟的 routine，**不被 TTL 回收**
- 跨用户访问他人 routine → 404（不是 403）

---

## P4 · 客户端数据层 + 代理路由

**目标**：客户端能读写服务端的 routine，token 不进 renderer。**契约冻结后即可与 P3 并行。**

| 文件 | 改动 |
|---|---|
| `src/lib/db.ts` | `cowork_routines` 缓存表（含 `owner_uid` / `config_id` / `synced_at`）+ `chat_sessions` 加 `routine_id`、`routine_run_id` 两列 + `safeAddColumn` 迁移 |
| `src/lib/db.ts` | 🔴 **办公对话列表查询加 `AND routine_id IS NULL`**（决策日志 ③）—— `SESSION_VISIBLE_WHERE` 附近所有取数处 |
| `src/types/index.ts` | `CoworkRoutine` / `RoutineRun` / `RoutineSchedule` |
| `src/lib/routines-client.ts` | **新建**：沙箱 REST 客户端（复用 `cowork-backend-remote.ts` 的 `remoteConfig` / `authHeaders` 模式） |
| `src/app/api/routines/{route,[id]/route,[id]/run/route,[id]/runs/route}.ts` | **新建**：代理层，token 留 Next server |

### 验收 ✅
- 新增 `routine-session-isolation.test.ts` **10 项**：routine 会话不进办公列表 / 普通会话不受影响 /
  按 routineId 与 runId 可查 / **搜索也排除** / routine 缓存按 uid 隔离 / 覆盖式同步删远端已无的且不误删他人
- `npm run test`：**2646 passed, 0 failed**（`SESSION_VISIBLE_WHERE` 被改动，既有账号隔离测试仍全绿）
- **代理层对生产沙箱实测**（独立 `CLAUDE_GUI_DATA_DIR`，未碰打包版共用库；uid=`p4probe`，跑完清零）：
  列表 / 创建 / PATCH 停用 / runs / 立即运行 / 删除联动全通；
  服务端 400 中文校验消息**原样透传**（「触发间隔 5 分钟,低于最小间隔 15 分钟」）；
  离线 → 回落缓存且 `offline:true`；未开通 → **503 + `not_provisioned`**（不是 404，UI 要据此隐藏整个入口）

### 实现上的两处取舍
- **`routine_id` 用 `''` 而非 `NULL` 作缺省**：与 `owner_uid` 等既有列一致，SQL 里少一类三值逻辑漏判；
  搜索那处走 LEFT JOIN，额外容忍 `IS NULL`（会话已删的孤儿消息）
- **共享逻辑放 `routines-route-helpers.ts`**：Next 的 route.ts 只允许导出 handler
  （CLAUDE.md 记过：导出别的值会让 webpack 构建期路由校验报错）

---

## P5 · 客户端同步与物化 — ✅ 已完成（2026-08-05）

**目标**：把服务端的运行记录变成本地可看的会话。

| 文件 | 职责 |
|---|---|
| `src/lib/claude-content-blocks.ts` | **新建**：内容块归一化，与 `claude-session-parser.ts` 共用（两处读的是不同文件格式，但块结构同源） |
| `src/lib/routine-transcript.ts` | **新建**：stream-json → 消息（纯函数）。与实时回合同形状，渲染层零改动复用 |
| `src/lib/routine-sync.ts` | **新建**：拉取 + **幂等**物化 + 汇总。网络层走依赖注入，单测能驱动整条链路 |
| `src/app/api/routines/sync/route.ts` | **新建**：`POST`，恒返回 200，成败放 body（同步失败不该让页面加载报错） |
| `src/lib/db.ts` | **改**：水位线读写 + `purgeCoworkRoutines` 连带清 + `getSessionsByRoutine` 加 rowid 兜底排序 |

**同步时机**：app 启动 / 打开定时任务页 / 每 10 分钟 —— 触发接线属 P6（UI）。
**幂等**：物化前查 `getSessionByRoutineRun(runId)`。水位线丢失导致服务端全量返回时，这道闸是最后防线。
**失败照样物化**：`credential_error` 在容器起来之前就失败了，服务端没写 transcript，拉取必然 404 —— 这是正常输入而不是异常。`skipped` 不物化（无产出，只在服务端运行历史里出现）。

**三个只有实读才知道的形状事实**（详见 `src/__tests__/fixtures/routine-transcripts/README.md`）：
原文里**没有用户指令那一条**（要从 routine 定义补）；同一条 assistant 在流式下**拆成多行**；
中间混着 `system/thinking_tokens` 进度噪声。

### 验收 ✅
- ✅ 黄金样本用**生产上取回的真实原文**（两份，未改一字节），断言块序列、配对、元信息
- ✅ 重复 sync 不产生重复会话；水位线倒退也不重复
- ✅ 物化出的会话不在办公对话列表里；顺序与真实运行顺序一致
- ✅ `npm run test` 2677 passed / 0 failed（新增 31 项：transcript 16 + sync 15）
- ⏸ **服务端真跑 3 次的端到端**留到 P9 打包态验收 —— 本地 dev 无登录体系，
  `cowork_remote_url/token` 为空，拉不到真实数据（CLAUDE.md 已载明此限制）

---

## P6 · 客户端 UI 三层

**目标**：把原型 v2 落地。

| 文件 | 内容 |
|---|---|
| `src/components/routines/RoutinePanel.tsx` | 三层容器 + 面包屑路由（① 列表 → ② 详情 → ③ 某次运行） |
| `src/components/routines/RoutineList.tsx` | 卡片列表 + 顶部配额与 `n/50` |
| `src/components/routines/RoutineForm.tsx` | 新建/编辑：名称・描述・指令・模型・调度 |
| `src/components/routines/SchedulePicker.tsx` | 六个预设 + 时间/星期 + 高级 cron。**预设里不提供 <15 分钟的选项**（D6） |
| `src/components/routines/RoutineDetail.tsx` | 配置摘要 + 运行历史表（含 `skipped` 及原因） |
| `src/components/routines/RoutineRunView.tsx` | 只读回放 + 产物卡片 + 「← 上一次 / 下一次 →」 |
| `src/components/layout/ChatListPanel.tsx` | 办公 tab 在「文生图」**下方竖排**加「定时任务」按钮（带任务数徽标）。**不加会话分组** |

**门控**：可用性 = 办公模式可用性，复用 `/api/cowork/status` 的 `assets.overall`；
未开通 → 按钮**不渲染**（不是置灰，沿用 R5-6 已定原则）。

**离线降级**：列表用本地缓存渲染 + 顶部横幅；**禁止新建和编辑**（本地改了会与服务端分叉）。

### 验收
- CDP 逐屏验证四个界面 + 三层面包屑跳转，console 无报错
- 明暗主题各验一遍；`npm run lint:colors` 通过（禁止裸色值）
- `npm run test` + `npm run test:smoke` 全绿

---

## P7 · 创建入口 + 通知 + i18n

| 文件 | 内容 |
|---|---|
| `src/lib/routines-mcp.ts` | **新建**：`codepilot_routine_{create,list,update,delete,run}`，复刻 `notification-mcp` 注册范式。**只在办公会话注册** |
| `src/lib/claude-client.ts` | 办公会话注册上述 MCP |
| `src/components/chat/*` | 会话头部加「⏰ 存为定时任务」，用最后一条 user prompt 预填表单 |
| `src/lib/routine-sync.ts` | 离线期间多条运行 → **合并成一条汇总通知**（D14），不逐条弹 |
| `src/i18n/{en,zh,zh-HK}.ts` | 三语键。⚠️ **zh-HK 手工加，别跑 `gen-zh-hk.mjs`**（会回退约 40 个已校对港式术语） |

🔴 **MCP 工具创建成功的回复必须明说结果去哪**：
「运行结果会出现在左侧『⏰ 定时任务』里，不会打扰这个对话」。
决策 ③ 之后结果不再落进当前对话，**没有这句用户会一直在原对话里等结果** —— 写进工具的 system prompt，不能指望模型自己想到。

### 验收
- 在办公对话里说「每个工作日早上 9 点整理昨天的数据」→ 建出任务且回复含「结果去哪」的说明
- 研发会话里该工具**不存在**
- 三语切换无缺键

---

## P8 · 加固与运维

| 内容 | 说明 |
|---|---|
| per-uid 日配额 | 20 次/天（D8）；超出的运行记 `skipped` 并注明原因，**不静默丢** |
| 连续失败自动停用 | 10 次（D11） |
| `routine_*` 审计事件 | `routine_fire` / `routine_end` / `cred_fetched`（只记 uid，绝不记 key）→ 自动流进账号后端已有的用量拉取管线 |
| `selftest-r5.mjs` | 调度触发 / 401 快失败 / 超时 kill / 并发上限 / 跨用户 404 / 凭证用后即废 / reconcile 不误删 routine |
| `deploy/OPERATIONS.md` | 补「定时任务」章：配置项、排障、配额调整、状态目录位置 |

---

## P9 · 联调 + 文档 + 打包验收

1. **端到端**：客户端建任务 → 关掉客户端 → 服务端按时跑 → 重开客户端 → 汇总通知 → 三层导航看到完整过程 → 下载产物
2. **部署漂移检测**：`apps/cowork-server/deploy/verify-deployment.sh` 返回 0
3. **双文档**（CLAUDE.md 强制）：
   - `docs/handover/cowork-scheduled-routines.md` — 架构、数据流、REST 契约、DB schema、坑
   - `docs/insights/cowork-scheduled-routines.md` — 为什么服务端调度、为什么会话要分离、与 Claude Routines 的异同
   - 两份互相反向链接
4. **打包验收**：macOS DMG 真机跑一遍（本地 dev 无登录体系，managed 数据为空，**必须打包态验**）
5. 本执行计划移入 `completed/`；research 文档标注「已实现」

---

## 风险登记册

| # | 风险 | 缓解 |
|---|---|---|
| R1 | reconcile 误删 routine 工作区 | `cowork.kind=routine` label 排除（P3 硬要求 1）+ selftest 覆盖 |
| R2 | TTL 回收跑到一半的容器 | 复用 `execOpened/execClosed`（P3 硬要求 2） |
| R3 | 办公列表漏了 `routine_id IS NULL` | P4 单测断言；漏一处就退回用户不满意的状态 |
| R4 | 服务端可自主发起 agent 的攻击面 | 凭证用后即废 + 独立密钥 + `exp≤60s` + 硬超时 + 日配额 + 审计 |
| R5 | 并发打满拖垮沙箱 | 上限 4 + 确定性 stagger + 超出留到下 tick 且 `log` 出来 |
| R6 | routine 需要访问内网 | D15 明确不支持；建任务时若指令含内网地址应提前提示，别让它每天失败一次 |
| R7 | P1 成为最后瓶颈 | 尽早启动；P9 之前必须就位 |
| R8 | 运行「成功」不等于任务达成 | 历史表区分「会话正常退出」与「任务达成」；照抄 Claude 的提示语 |

---

## 未决（不阻塞开工）

- 建 routine 时若指令含内网地址，是**创建前拦截**还是**只提示**？
- 运行历史永久保留（D12），到什么量级需要重新评估策略？
- 旧 `task-scheduler.ts` 的清理 PR 何时发（D16 已定「新功能稳定后」，具体时机待定）
