# 测试用量上报（客户端 → codeagent-server → 管理端）

> 产品思考见 [docs/insights/test-usage-upload.md](../insights/test-usage-upload.md)
>
> 前置：本地统计口径见 [handover/test-usage-stats.md](./test-usage-stats.md)（事件流水 + 纯函数聚合）。
> 本文档是那份文档里预留的「二期上报」的落地。

把本地 `test_stats_events` 按**北京自然日**聚合成计数，上报到 codeagent-server，管理员在管理端
「测试用量统计」菜单查看。跨两个仓库：LabCodepilot（客户端）+ codeagent-server（服务端 + 管理端 Web）。

---

## 1. 全景数据流

```
①客户端 LabCodepilot（Electron）
   触发(4类) → main 去抖 → [loopback] 内嵌 Next 按天重算 → main 附 device_id 后 POST
                                                                    │ Bearer
②服务端 codeagent-server                                            ▼
   POST /api/v1/me/test-usage → 逐天 GREATEST upsert → Postgres test_usage_daily
                                                                    │
③管理端 Web                                                          ▼
   GET /api/v1/admin/test-usage(+/summary,/trend) → 「测试用量统计」页
```

**为什么绕 loopback**：主进程读不了 SQLite（better-sqlite3 的 ABI 绑在内嵌 Next 服务上），
而内嵌 Next 又**读不到 session_token**（`src/lib/auth-shared/paths.ts` 刻意不镜像 token）。
所以：**数据在 Next 侧算，带鉴权的上报只能在主进程发起** —— 两者经 127.0.0.1 loopback 会合。

---

## 2. 客户端

### 2.1 聚合层（口径核心）

| 文件 | 职责 |
|------|------|
| `src/lib/test/usage-rollup.ts` | 纯函数 `buildDailyRollup(events, {tzOffsetMinutes=480})` → `DayUsage[]`。不 import fs/db，可 node:test |
| `src/app/api/test/stats/daily-rollup/route.ts` | `GET ?from&to`（北京日）→ `{days}`。把北京区间换算成 UTC `created_at` 区间查 `queryTestStatsEvents`，再按天折叠、裁剪到 [from,to]。loopback 专用，无鉴权（同既有 `/api/test/stats`） |
| `src/__tests__/unit/usage-rollup.test.ts` | 20 例（分桶边界 / 两日聚合 / 分组 / last-wins 去重 / 防御） |

**时区**：事件 `created_at` 是 UTC；+480min 后取日期 = 北京自然日。
（UTC 2026-07-14 16:30 → 北京 2026-07-15。）服务端**不按收到时间判定日期**，`stat_date` 随 payload 上传。

#### ⚠️ 口径一：状态型事件必须 last-wins，不能求和

事件分两类，混淆会直接算错：

- **增量型**（`task_created` / `cases_generated` / `execution_completed`）：每条 = 一次新发生的活动 → 直接累加。
- **状态型**（`cases_approved` / `report_reviewed` / `report_review_bulk`）：每条携带的是**当前全量状态**。
  `cases_approved.finalCount` 是该任务定稿后的**总**用例数，同一任务反复批准会反复发事件。

**真实事故**：本机库里同一任务一天内批准 3 次、每次 `finalCount=55` → 求和得 165，
而当天首轮只生成 56 条 → **采纳率 294%**。

折叠规则（与 `stats.ts` 同口径）：

| 事件 | last-wins key | 备注 |
|------|---------------|------|
| `cases_approved` | `taskId`（日内） | 取最后一条的 finalCount / diff |
| `report_reviewed` | `` `${runHash}|${caseId}` `` | `verdict='cleared'` → **删除**该条；无 `caseId` 忽略（stats.ts 亦然） |
| `report_review_bulk` | 同上 key | 每个 caseId 写同一张 map，视为 accurate → 与单条复核天然去重 |

折叠在**日级与每项目级**各做一份（`ScopeAcc.approvals` / `.reviews`），最后由 `foldStateful` 折算进计数。
模型行不涉及（批准/复核事件不带 `model`）。

> last-wins 只在**日内**折叠（stats.ts 是跨全历史）。同一任务跨天反复批准会在各自那天各计一次 ——
> 这是每日分桶不可避免的，且符合「那天用户确实又定稿了一次」的活动语义。

#### ⚠️ 口径二：熔断轮（circuitBroken）

- `executions`（执行轮次）**计入** —— 用户确实发起了这次执行，属活动量。
- `cases_executed/passed/failed`、`exec.partial/blocked`、时长均值 **不计入** —— 熔断轮用例级结果残缺
  （与 stats.ts 的结果口径一致）。
- 熔断轮数量由 `payload.exec.circuit_broken` 单独标注。

**为什么必须在客户端排除**：服务端只拿到**求和后的计数**，无法再按轮次剔除。若把熔断轮折进
`cases_executed`，管理端 `pass_rate = passed/executed` 就会与用户本地 Stats 面板对不上。

### 2.2 上报链路（主进程）

| 文件 | 职责 |
|------|------|
| `electron/auth/test-usage-uploader.ts` | **编排核心**：触发去抖、选天数区间、水位、错误分类 |
| `electron/auth/client.ts` | `uploadTestUsage(payload)` → `apiRequest('/api/v1/me/test-usage', POST)`（Bearer 自动注入） |
| `electron/auth/broker.ts` | `fetchDailyRollupFromServer(from,to)` → loopback GET 内嵌 Next |
| `electron/auth/storage.ts` / `paths.ts` | `test_usage_watermark`（明文，**跨登出保留** —— 按机器记录上报进度，非用户维度） |
| `electron/main.ts` | boot/postLogin 启定时器 + 触发一次；登出停；`auth:upload-test-usage` IPC |
| `electron/preload.ts` / `src/types/electron.d.ts` | `electronAPI.auth.uploadTestUsage()` |
| `src/components/test/InlineTestingPanel.tsx` | 挂载 effect 触发（切走卸载、切回重挂 → 等价「每次点开测试模块」） |

**4 类触发**（全部汇入 `scheduleTestUsageUpload(reason)`）：
1. 登录成功 / App 启动
2. 每日 **10:00 / 16:00 / 20:00**（北京时间；中国无 DST，固定 +8 计算下一次触发）
3. 打开测试模块（renderer → IPC，只发信号、不带数据）

**去抖**：60s 内多次触发合并为一次；距上次成功不足 5min 则跳过（GREATEST 让漏掉也无害）。

**天数区间**：`from = min(watermark, 昨天)`，`to = 今天`，回补上限 90 天。
- 「至少回补到昨天」是为了补齐上一日 20:00 之后的活动（否则次日再传时那段永远丢）。
- 离线期间水位不前进 → 下次在线自动补齐积压。
- **成功才推进水位**；失败保留，下次任一触发重试。

**门控**：无 `session_token` → 静默 return（本地 dev / BYOK 不上报）。

---

## 3. 服务端（codeagent-server，分支 `feat/test-usage`）

镜像 `device` 模块的分层：`model / schemas / repository / service / router`。

### 3.1 表 `test_usage_daily`（迁移 `0017_test_usage`，链在 `0016_service_secrets` 后）

| 列 | 说明 |
|----|------|
| `id` UUID PK / `user_id` UUID FK→users ON DELETE CASCADE | 归属用户 = `claims.sub` |
| `device_id` varchar(128) / `device_name` / `app_version` / `tz` | 设备维度（复用登录体系的 device_id） |
| `stat_date` date | **北京自然日**，客户端定桶 |
| 11 个计数列 | `tasks_created, cases_generated, cases_generated_first_round, cases_adopted, cases_approved, executions, cases_executed, cases_passed, cases_failed, reviews, reviews_accurate` |
| `payload` JSONB | 明细：`exec`(partial/blocked/circuit_broken/avg_case_duration_ms)、`adoption`、`reviews_detail`、`models[]`、`projects[]` |
| `first_reported_at` / `last_reported_at` | 审计 |
| **UNIQUE** `(user_id, device_id, stat_date)` | upsert 冲突目标 |

索引：`user_id`、`(user_id, stat_date)`、`stat_date`。

### 3.2 幂等与持久：GREATEST upsert（关键设计）

```sql
ON CONFLICT (user_id, device_id, stat_date) DO UPDATE
  SET <每个计数列> = GREATEST(已存值, EXCLUDED.值),
      payload/device_name/app_version/tz = EXCLUDED.*,   -- 元信息取最新
      last_reported_at = now()                            -- first_reported_at 不变
```

- **客户端每次全量重算当天**（而非发增量）→ 服务端**整体合并**而非累加，重复上报不会重复计数。
- 取 `GREATEST` 而非直接覆盖：同一 `(device, 天)` 的累计值只增不减，因此**客户端删本地数据后
  重新上报 0 值，也压不低服务端已有的历史高水位** —— 服务端是持久台账，不是客户端的脆弱镜像。
- 代价（诚实交代）：某次客户端上报了虚高值会被锁在高水位。用量分析（非计费）可接受；
  `schema_version` + 管理端重置兜底。

### 3.3 接口

**客户端写**（`CurrentClaims`，桌面会话令牌）
`POST /api/v1/me/test-usage` — body `{device_id, device_name?, app_version, tz, days:[1..90]}` → `200 {accepted_days}`

**管理端读**（`AdminClaims`，Authentik JWT + `admins` 组）
| 路由 | 说明 |
|------|------|
| `GET /admin/test-usage?from&to&page&page_size&search&device_id` | 按用户**跨 device、跨天 SUM** + 分页/搜索 |
| `GET /admin/test-usage/summary?from&to` | 区间 KPI |
| `GET /admin/test-usage/trend?from&to` | 按天时序 |
| `GET /admin/users/{id}/test-usage?from&to` | 单用户按设备/日/项目下钻 |

日期参数用 `Query(alias="from"/"to")`；缺省回退最近 30 天。

**比率永不落库**，一律 `SUM(分子)/SUM(分母)` 现算（分母 0 → `null`）：
`adoption_rate = cases_adopted / cases_generated_first_round`、
`pass_rate = cases_passed / cases_executed`、`review_accuracy = reviews_accurate / reviews`。
> 绝不能对「每日比率」求平均 —— 那是加权错误。

`projects_count` 用**相关标量子查询**（`jsonb_array_elements(payload->'projects')` 去重计数），
避免 lateral join 污染同一查询里其它列的 SUM。

### 3.4 多设备汇总

同账号两台电脑 → `device_id` 不同 → **各写各的行，互不覆盖**。
用户维度 = 管理端按 `user_id` 跨 device **SUM**（活动量）；
「测过的不同项目数」用 **COUNT(DISTINCT project)**（并集），**不能求和**。

---

## 4. 管理端 Web（codeagent-server/web）

照搬「设备管理」：`AppLayout.tsx` 菜单 +「测试用量统计」→ `App.tsx` 路由 `/test-usage`
→ `pages/TestUsage.tsx`（RangePicker + KPI 卡 + 分页用户表 + 每日趋势表）+ `api/testUsage.ts`。
antd v5，无新增图表依赖。

---

## 5. 验证方式

- 单测：`npx tsx --test src/__tests__/unit/usage-rollup.test.ts`（20 例，含 last-wins 回归）。
- 端到端口径核对（**最有价值的一步**）：起 dev（worktree 用 `PORT=3001 next dev --webpack`），
  拉 `daily-rollup` 与 Stats 面板逐项对：
  采纳率 98.2%(55/56)、通过率 53%(49/92)、报告准确度 88.9%(8/9)、已执行 92 条 —— **完全一致**。
  修复前采纳率会是 294%。
- 服务端：`make lint` / `make typecheck` / `alembic upgrade head --sql`（离线校验迁移，无需 DB）。

---

## 6. 已知局限

1. **上报前就被删的数据找不回**（任何客户端上报型遥测皆然）。4 类触发已把采集窗口压到很小。
2. **本地事件是机器级、无用户归属**：同一台机器换账号登录，之后上报的历史天会归到新账号。
   （本地 `test_stats_events` 本就不记录用户。）
3. **跨天重复批准**会在各自那天各计一次（见口径一）。
4. 本地 dev 无登录体系 → 上报链路的**真实 POST** 只能在打包后登录态验证；dev 只能验到 loopback 聚合这一段。
5. 未跑 live Postgres 迁移（本机无 DB），仅做了 alembic 离线 SQL 校验。
6. 回归测试统计（文件态、单项目）**未纳入**，是二期。
