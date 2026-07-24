# 回归测试使用统计 · 技术交接

> 产品思考见 [docs/insights/regression-stats.md](../insights/regression-stats.md)
>
> 姊妹模块（功能测试统计）：[handover/test-usage-stats.md](./test-usage-stats.md) —— 两者同处「使用统计」面板，但数据管线与口径完全独立。

## 一句话

在原有「使用统计」面板（只覆盖功能测试）里加一个 `功能测试 / 回归测试` 二级切换；回归视图**直接从项目文件态聚合**（不复用 `test_stats_events` 事件表），呈现套件执行趋势、用例执行趋势、脚本重放 vs AI 执行三张图 + 套件明细表。**零 schema 变更**。

## 为什么不走事件表（核心设计决策）

功能测试统计是事件溯源（`test_stats_events`，跨项目「本机」口径）。回归统计**刻意不复用**它，三条硬理由：

1. **富字段事件层不携带。** 回归的核心信号全在文件态：`run.json` 的 `via`（`'script'` 重放 / 缺省 AI 执行）、`circuitBroken`；`RegressionRound` 的 `mode`/`status`/`counts`；`ScriptManifest.consecutiveRunFailures`；`LibraryEntry.quarantined`；`verdicts.cls`。让事件承载这些等于把整个回归数据模型二次序列化进 SQLite payload。
2. **`execution_completed` 对回归是残缺的。** 该事件虽为回归执行也会打，但 payload 无 `roundId`/`suiteName`/`mode`/`via` 拆分，且只有前端传 `taskId` 时才落库。
3. **scope 语义相反。** 事件层是跨项目「全部·本机」；回归的发版口径天然是**单项目**问题，混进跨项目 global 会产生无意义加总。

结论：新建纯函数聚合层直接读文件，锁定当前项目。功能测试事件管线**完全不动**。

## 涉及文件

| 文件 | 角色 | 状态 |
|------|------|------|
| `src/lib/test/regression-stats.ts` | 聚合层：纯核 `aggregateRegressionStats(input)` + fs wrapper `buildRegressionStats(projectPath)` | 新增 |
| `src/app/api/test/regression-stats/route.ts` | 只读路由 `GET ?projectPath → { data: RegressionStats }` | 新增 |
| `src/types/index.ts` | UI 契约类型：`RegressionStats` / `RegressionWeeklyPoint` / `RegressionScriptPoint` / `RegressionSuiteRow`（客户端安全，故放 index.ts 而非聚合层，避免把 fs 拖进浏览器 bundle） | 追加 |
| `src/components/test/TestStatsView.tsx` | 外壳 `TestStatsView`（toolbar + 二级 toggle）+ `FunctionalStatsBody`（原功能主体，去 toolbar）+ `RegressionStatsView`（回归主体）+ 新增通用堆叠柱图元 `StackBars` | 重构 |
| `src/components/test/InlineTestingPanel.tsx` | 挂载点透传 `projectPath={current?.path ?? ""}` | 1 行 |
| `src/i18n/{zh,en,zh-HK}.ts` | `test.stats.reg.*` 文案（三语同步；`TranslationKey = keyof en`，tsc 强制三语键一致） | 追加 |
| `src/__tests__/unit/regression-stats.test.ts` | 纯核单测（node:test，不读 fs / 不 import db） | 新增 |

## 数据流

```
UI: RegressionStatsView (mode==='regression')
     └─ fetch /api/test/regression-stats?projectPath=<current.path>
          └─ buildRegressionStats(projectPath)                    [src/lib/test/regression-stats.ts]
               ├─ readRounds + normalizeStaleRounds               (回归轮次.json)
               ├─ readRunSummary × 近 REG_RUN_READ_LIMIT(50) 轮   (每轮 run.json：via/status/circuitBroken)
               ├─ readSuites + evalSuite × 每套件                 (回归套件.json 对当前库求值命中数)
               ├─ readLibrary + readLibMeta                       (回归用例库.json 存活数=覆盖率分母)
               └─ aggregateRegressionStats(input)  ── 纯函数 ──▶ RegressionStats
```

无 DB、无写入、无 MCP 工具。

## 输出契约 `RegressionStats`（`src/types/index.ts`）

- `weekly: RegressionWeeklyPoint[]` — ISO 周一 UTC 分桶（与功能统计 stats.ts 同口径），`roundsFull`/`roundsFailedOnly`（按 `mode`）+ `caseExecutions`（用例执行量）。跨周空档补零，保留最近 `REG_WEEKS`(8) 周。
- `scriptVsAi: RegressionScriptPoint[]` — 近 `REG_SCRIPT_POINTS`(8) 个「已执行 + 有 run 摘要 + 非熔断」轮，每轮 `scriptPass/scriptFail/aiPass/aiFail`（`via==='script'` × 是否 `status==='pass'`），`label='#序号'`（升序位次）。
- `suites: RegressionSuiteRow[]` — 内置「全量」+ 各用户套件：`caseCount`（对当前库求值命中）/`libraryTotal`（存活数）/`runCount`/`latestPassRate`+`latestPassStr`/`avgDurationMs`/`replayRatio`。
- `totalRounds` / `projectName` / `runReadLimit` / `hasData`（空态判定）。

## 口径（与 reduce.ts/case-history.ts 对齐）

- **running 轮**：一律排除（counts 未定）。`normalizeStaleRounds` 把 >2h 未收口的 running 惰性归一为 `aborted`（计入「已执行」）。
- **circuitBroken 轮**：从脚本/AI 图、重放占比、精确执行量、套件「最近通过率」中排除（认证中途断=结果不可信）。
- **用例执行量**：优先取 run 摘要 `testCount`（且排除熔断轮），无摘要退化取 `RegressionRound.counts.total`。
- **套件覆盖率**：`caseCount / libraryTotal`；查询套件的 `last` 条件用 `buildLastResultLookup` 注入；隔离条目不计入分母。
- 比率一律 0-1 小数，分母为 0 → null，UI 显示「—」。

## 性能护栏

- `run.json` 相关口径只读最近 `REG_RUN_READ_LIMIT`(50) 轮（`run.json` 只在执行后落盘）；趋势/套件执行次数/最近通过率走轮次索引里已存的 `counts`，无需展开 `run.json`。
- 未加进程内缓存（面板打开不频繁、读取已被 50 轮上限压住）。若后续成为热点，可仿 `case-history.ts` 按 `(roundsSeq, librarySeq, suitesSeq)` 建缓存键。

## 信息架构

- 现有 Stats 面板内加 `mode: 'functional' | 'regression'` 二级 toggle，**默认 functional**（保持既有行为）。两套 KPI/图各自渲染，不合并（分母语义不同）。
- 范围标签：functional=`范围：全部 · 本机`；regression=`范围：当前项目 · {项目名}`。
- 导出 XLSX 按钮仅 functional 态显示（回归导出未做）。

## 本期范围（用户拍板 2026-07-14）

- **做**：套件执行趋势、用例执行趋势、脚本重放 vs AI、套件明细。
- **先不做（聚合层已算出对应口径的扩展位，后续只加渲染）**：4 张 KPI 卡、通过率趋势、失败归因分布、本轮变化（新增失败/修复/持续失败）、轮次明细下钻。
- **放弃**：套件新增趋势（需给 `RegressionSuite` 新写 `createdAt`，存量套件无法回溯，用户决定不做）。

## 验证

- 纯核单测 7 例全过（`npx tsx --test src/__tests__/unit/regression-stats.test.ts`）：周分桶/mode 拆分/补零周、running 排除、circuitBroken 排除、脚本 via 拆分、套件覆盖率/执行次数/最近通过率跳熔断轮/平均耗时/重放占比、空态。
- 端到端：造 fixture 项目（回归轮次 + 2 份 run.json 含 `via` + 套件 + 库含隔离条目），`GET /api/test/regression-stats` 返回值逐字段核对（含 stale-running→aborted 路径）。
- UI：dev（webpack, PORT=3001）+ CDP 拦截 `/api/test/regression-stats` 返回 mock，验证三图 + 套件表渲染、`功能/回归` 切换、空态（`hasData:false`）与无项目 loadError 三分支，console 无报错。本地 dev 无登录、真实项目无回归数据，故按 CLAUDE.md 纪律用 mock 验证渲染逻辑。
