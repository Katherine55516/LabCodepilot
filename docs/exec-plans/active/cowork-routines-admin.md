# 定时任务管理后台（cowork-routines-admin）

> 创建时间：2026-08-21
> 跨仓库：LabCodepilot（apps/cowork-server 管理面）+ codeagent-server（admin API + admin web）
> 底座：[handover/cowork-scheduled-routines.md](../../handover/cowork-scheduled-routines.md)（定时任务全貌）·
> [active/cowork-usage-admin.md](cowork-usage-admin.md)（管理面三层范式的先例，本计划完全复刻其架构）

## 背景与调研结论

用户（admin）需要在后台管理系统里管理全体用户的定时任务。调研核实的关键事实：

1. **数据在哪**：routine 定义与运行历史**只存在沙箱服务器**的文件里
   （`/data/cowork-state/routines/<uid>/<id>.json` + `<id>.runs.jsonl` + `runs/<runId>.jsonl` 原文）。
   账号后端 PG 只有审计事件流（`routine_create/fire/end/delete` + `cred_fetched`，detail 以 uid
   开头可归属）。→ **管理列表必须走沙箱实时代理**，PG 审计只用于用量统计（已有）。
2. **现成积木**：store 已有跨用户 `listAllRoutines()`（调度器 tick 在用）；`listRuns()` 带
   since/limit；run 记录含 `status/skipReason/durationMs/costUsd/numTurns/exitCode`——
   **管理面最关心的花费数据已经在记**。`view()` 序列化含
   `enabled/nextRunAt/lastRunAt/lastStatus/consecutiveErrors/disabledReason`。
3. **范式先例**（cowork-usage-admin 已趟通，直接复刻）：
   - 沙箱 `/admin/*` 只认 `__admin__` token（D3：账号后端用 `COWORK_AUTH_SECRET` 自签，零新密钥）；
   - admin 动作写 `admin_*` 审计、detail 以 uid 开头 → 经拉取器回流 PG → 对全体 admin 可见（UD3 制衡）；
   - 账号后端 admin API JOIN users 换人名（人名解析必须在服务端，24c134b 的教训）；
   - 文件读取是毫秒级操作，无 df 式性能危险，不需要快照层。
4. **顺带收账**：用量后台前端至今未展示 P8 加的 routine 字段
   （`overview.today_routine_runs`、`per_user.routine_runs_*`、`per_session.routine_runs`，
   见 handover §L.2）——本计划 P1 一并补上。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| P0 | cowork-server 管理面：`/admin/routines*` 四端点 + 审计留痕 + selftest | ✅ 完成 | selftest-admin **35/35 生产实测**（2026-08-21）。三个附带产出：① selftest 改**不清场**（与 r5 同姿态：只动测试自身资源，可与活跃用户并存——原全局 `docker rm -f` 会杀真实会话，被迫等无人窗口）；② selftest 的 **state 目录 tmp 隔离**（不设的话生产跑会把自测 routine 写进真实用户目录）；③ `view()` 从 routine-api 导出复用。未决 1/2/3 已拍板：不做代跑 / 接受无硬锁 / 历史先永久保留 |
| P1 | codeagent-server admin API 代理 + pytest + 用量页 routine 字段补显 | ✅ 完成 | admin_routines.py 五端点(列表 JOIN users/历史/停启/删/transcript 流式);沙箱不可达 502 不降级(与用量页 live 降级刻意不同 —— 没有本地数据可退,假空列表会被读成「没有任务」);pytest 26 过(MockTransport 模拟沙箱);用量页补 today_routine_runs 卡 + 用户表定时列 + 会话表「定时任务」标(§L.2 旧账清);web build 过 |
| P2 | admin web「定时任务」页（列表/筛选/运行历史/停用/删除） | ⏳ 待开工 | |
| P3 | 部署（沙箱 install.sh + 账号后端 pull）+ 生产验证 | ⏳ 待开工 | |

## 决策日志

- 2026-08-21: **AD1 管理能力边界 = 看 + 停 + 删，不代建不代改**。admin 可全局查看、停用/恢复、
  删除任意用户的 routine；**不提供**替用户创建、改 prompt/schedule、立即运行——改内容等于 admin
  替用户说话，立即运行花的是用户的日配额和真金白银（每次 ~$0.1+），都需要用户本人意志。
- 2026-08-21: **AD2 数据源 = 沙箱实时代理，不落 PG**。定义/历史是沙箱文件的单一事实源，量级小
  （≤50/用户）读取毫秒级；复制进 PG 就要养同步。人名映射由账号后端 JOIN users 完成（同 24c134b）。
- 2026-08-21: **AD3 admin 停用走既有 `disabledReason` 字段**，写「管理员停用：<原因>」——客户端
  详情页本来就展示停用原因，用户侧透明是免费的。恢复 = 清 reason + 重算 nextRunAt（复用用户侧
  PATCH 的语义）。
- 2026-08-21: **AD4 不做硬锁（v1）**。admin 停用后用户可以在客户端重新启用——内部工具靠审计
  留痕 + 当面沟通治理；真出现拉锯再加 `adminLocked` 字段，先不为想象中的对抗做建设。
- 2026-08-21: **AD5 审计事件二枚**：`admin_routine_disable` / `admin_routine_delete`
  （enable 复用 disable 事件、detail 里带 `enable`），detail 格式 `"<uid> <补充>"`（🔴 G15：
  必须以 uid 开头否则用量归属静默丢失）。`admin_remove`/`admin_download` 先例同款，回流后台事件可见。
- 2026-08-21: **AD6 transcript 只给下载不做回放（v1）**。管理端看原文 = 下载 `runs/<runId>.jsonl`
  （复用 admin_download 审计）；在 admin web 里渲染回放需要移植客户端整套 transcript 解析器，
  收益配不上成本。
- 2026-08-21: **AD7 页面独立成页不塞进用量页**。「沙箱用量」已有三张卡，定时任务有自己的
  列表/详情/历史三层，塞一起两边都挤。侧边栏新增「定时任务」，与「沙箱用量」并列；用量页会话表
  里 sid 恰为 routineId 的行可以后续做跳转（P2 可选项）。
- 2026-08-21: **AD8 admin 删除必须三方联动**：store 定义与历史 + 容器/卷（orchestrator）+ 凭证
  （cred revoke）——与用户侧 DELETE 同一条清理链，漏一方就是泄漏（routine 卷是持久卷）。

## 详细设计

### 数据流

```
admin web「定时任务」 → codeagent-server /admin/cowork/routines/*（AdminClaims,JOIN users 换人名）
                          └─ 代签 __admin__ token → cowork-server /admin/routines*（文件直读,毫秒级）
admin 停用/删除 → 同链路反向 → 沙箱写 admin_routine_* 审计 → 拉取器回流 PG → 后台事件可见（UD3）
```

### cowork-server 新增（index.mjs `/admin/` 分支内接线，全部挂 `__admin__` 鉴权）

```
GET    /admin/routines                     全量列表（listAllRoutines + view + uid）+ 全局元信息
                                           {routines:[{...view, uid}], meta:{dailyCap, minIntervalMs,
                                            concurrency, maxPerUid, runsToday:{success,failure,skipped},
                                            costTodayUsd}}
GET    /admin/routines/:id/runs?uid=&since=&limit=   运行历史（store 按 uid 分目录,uid 必传）
PATCH  /admin/routines/:id                 body {uid, enabled, reason?}
                                           停用：enabled=false → disabledReason=`管理员停用：<reason>`,
                                             nextRunAt=null；审计 admin_routine_disable,
                                             detail=`<uid> ${id} <reason 截断>`
                                           恢复：enabled=true → 清 consecutiveErrors/disabledReason,
                                             重算 nextRunAt；审计同事件 detail 带 enable
DELETE /admin/routines/:id?uid=            AD8 三方联动清理；审计 admin_routine_delete
GET    /admin/runs/:runId/transcript       流式回原文（复用 handleTranscript 的读取,绕 owner 校验）;
                                           审计 admin_download（detail=`<uid> transcript ${runId}`）
```

要点：
- `runsToday`/`costTodayUsd` 由 `listAllRoutines()` × `listRuns(since=todayStartIso)` 现算——
  量级 = 用户数 × 当日运行数，文件读取毫秒级，不需要缓存层；真变慢再套用量后台的快照模式。
- PATCH/DELETE 的 uid 来自请求方（admin 列表里有），服务端仍以 `getRoutine(uid,id)` 命中为准，
  打不中一律 404（防枚举，同用户面）。
- 🔴 恢复启用时**必须**清 `consecutiveErrors`（routine-api update 同款逻辑），否则一恢复就
  再次触发 D11 的 10 次自动停用。
- selftest-admin 加第 6 组：非 admin 404 / 列表形状含 uid 与 meta / disable→用户侧 view 可见
  reason / enable 清计数 / delete 三方归零 / 两枚审计 detail 以 uid 开头（G15 契约断言）。

### codeagent-server admin API（app/admin/ 或 cowork/ 下新模块 admin_routines.py）

```
GET    /admin/cowork/routines             代理列表 + JOIN users 换 display_name（服务端解析,
                                          不让前端拿 uid 反查——24c134b 教训）;支持 ?uid= 过滤
GET    /admin/cowork/routines/{id}/runs   代理运行历史（uid query 透传）
PATCH  /admin/cowork/routines/{id}        代理停用/恢复（body 透传,记 structlog）
DELETE /admin/cowork/routines/{id}        代理删除
GET    /admin/cowork/routines/runs/{run_id}/transcript   流式转发（复用 usage 下载的
                                          StreamingResponse 模式）
```

- 鉴权 `AdminClaims`（admins 组）；token 用 `sign_admin_token`（现成）。
- 超时口径：列表/历史 10s（文件读,快）；transcript 下载 60s 流式（同产物下载）。
- 沙箱不可达 → 502/503 + 明确中文 detail，**不做降级假数据**（管理动作必须真实失败可见）。

### admin web 页面（web/src/pages/CoworkRoutines.tsx，侧边栏与「沙箱用量」并列）

- **顶部统计条**：任务总数 / 启用中 / 今日运行（成/败/跳过）/ 今日花费 $ / 全局配额参数
  （dailyCap · 最小间隔 · 并发）——全部来自列表接口的 meta，零额外请求。
- **任务表**（本地分页即可，全量数据一次到手）：归属人名（服务端解析）/ 名称+描述 /
  调度（cron 或「一次性」+ 时区，human-readable）/ 状态（启用·已停用·管理员停用·已运行 D10）/
  下次触发 / 最近一次（时间+状态色点）/ 连续失败数 / 操作（历史 · 停用/恢复 · 删除）。
  归属筛选下拉复用 usage 的 owners 接口。
- **运行历史抽屉**：点任务展开——每次运行的 startedAt / status（success·failure·skipped+原因）/
  时长 / 花费 / 回合数 / exit code；行尾「原文」按钮下载 transcript（提示会写审计）。
- **停用**：Popconfirm 必填原因（写进 disabledReason，用户在客户端看得到）；
  **删除**：Popconfirm 红色警示「定义、运行历史、容器与卷（含产物）连带删除，不可恢复，操作留审计」。
- 文案全角标点（G12）；`enabled` 是 1/0 注意 `!!`（G11）。

### 用量页顺带补显（P1，收 §L.2 的账）

- 概览卡加「今日定时运行」（`today_routine_runs`）；
- 用户表加「定时任务运行（今日/累计）」列（`routine_runs_today/total`）；
- 会话表 `routine_runs>0 && turns==0` 的行状态标「定时任务」，与普通会话区分
  （回答了「时间轴里 turns=0 的行是什么」的老困惑）。

### 验收标准

1. selftest-admin 第 6 组全过（生产可跑，不清场）；
2. pytest：代理透传 / uid 校验 / 非 admins 403 / 沙箱不可达 502 且报错可读；
3. 真实链路：后台看到全体用户任务及人名；admin 停用后**用户客户端**详情页显示「管理员停用：…」；
   恢复后 nextRunAt 重算且失败计数清零；删除后沙箱定义文件 + 容器 + 两个卷 + 凭证全部归零；
   两枚 admin 审计事件出现在用量后台事件流里且归属正确；
4. 今日花费 $ 与运行历史里 costUsd 逐条求和一致。

## 未决问题（开工前与用户确认）

1. **AD1 的边界是否够用**——是否需要「admin 替用户立即运行一次」做排障？（倾向不做：花用户配额
   与钱；排障已有服务器上的 `routine-once.mjs`）
2. **AD4 不做硬锁**是否接受——admin 停用后用户可自行恢复，仅靠审计与沟通约束。
3. 运行历史**永久保留**（D12）在管理页出现后是否要顺带做保留策略（如 180 天）——涉及用户侧
   数据删除，单独决策，不并入本计划。
