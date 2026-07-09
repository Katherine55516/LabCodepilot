# 测试工作台：回归用例库 v2 一期（轮次 + 套件 + 报告分组）实施计划

> 创建时间：2026-07-09 | 最后更新：2026-07-09
> 状态：**设计完成，待开工** | 目标分支：V3.1.0_dev
> 方案与竞品对标见 [docs/research/regression-library-v2-benchmark-proposal.md](../../research/regression-library-v2-benchmark-proposal.md)（含二/三期范围）；交互原型 `docs/research/prototypes/regression-library-v2-prototype.html`
> 依赖：回归用例库 v1（[regression-library.md](./regression-library.md)，批 A-E 已完成）
> 一句话：把「发版前跑一遍回归」做到**可信**（轮次留痕+快照）、**可圈选**（套件）、**可读**（报告按来源任务分组+delta）、**可选环境**，并解决打包版执行不可用的交付断点。

## 0. 决策日志

- 2026-07-09（用户拍板）：**模块不做独立功能**——不建模块树/管理 UI/模块维度报告；`module` 仅作库检索与查询套件条件字段。圈选执行统一由套件承担。
- 2026-07-09（用户拍板）：**回归套件是核心功能，提至一期**（P1→P0）。与发起弹窗重做同批落地避免返工；套件只依赖库本身，无轮次数据依赖。
- 2026-07-09（讨论确认）：**轮次原子性**——一轮 = 一套件 × 一环境 × 一模式；多套件诉求用并集套件解决，未来高频再评估「批次」容器。
- 2026-07-09（讨论确认）：报告 delta 对比取「上一全量轮」，只对两轮均执行的用例（交集）有意义；复测轮红线用合并口径（二期实现，一期数据结构预留）。

## 1. 设计默认（未单独问，按下列默认执行；用户可推翻）

| # | 点 | 默认 | 理由 |
|---|----|------|------|
| 1 | tech-debt #13（打包版执行不可用） | **一期硬门槛**，批 F 并行推进，一期验收含打包链路 | 否则一期只对源码用户成立；方案批判环节结论 |
| 2 | 查询套件条件字段 | 一期只做 优先级/模块/来源任务/上次结果 四类；「评审态」随二期门禁启用 | 避免把评审门禁拖进一期 |
| 3 | 旧平铺重跑产物（v1 的 report/回归用例库/*.run.json） | 报告区兼容显示，**不折算**为轮次 | 折算收益低、口径存疑 |
| 4 | 轮次中断态 | **惰性收口**：读侧发现 running 轮超时（>2h）无产物更新 → 标 aborted；不依赖进程退出钩子 | 桌面应用随手关闭是常态，退出钩子不可靠 |
| 5 | 时长/token 估算 | 取近 3 个全量轮 run.json 均值 × 本轮条数；无历史显示「首轮暂无估算」 | 冷启动诚实降级 |
| 6 | 轮次删除 | 支持单轮删除（复用 reports/delete 的 path-safety 模式）；磁盘保留策略（自动清理）记 tech-debt 留三期 | 一期给逃生通道即可 |
| 7 | 并发写保护 | 回归轮次.json / 回归套件.json 写入加**写前版本比对**（读时记 updatedAt，写时不一致则重读合并或报错） | .tmp+rename 只防半写不防丢更新（双窗口/双 dev server） |
| 8 | reviewState / 缺陷实体 | 一期不加字段不做迁移，二期统一落（存量回填 approved 的建议记在方案 §9） | 避免一期改 schema 二期再改一次 |

## 2. 数据模型

### 2.1 轮次索引 `AI_LabTest/testCase/.data/回归轮次.json`
```jsonc
{
  "version": 1,
  "updatedAt": "ISO",
  "rounds": [
    {
      "roundId": "RND-20260709-1030",      // RND-YYYYMMDD-HHmm，冲突加 -2 后缀
      "startedAt": "ISO", "finishedAt": "ISO?",
      "env": "staging",
      "suiteName": "发版精选",
      "mode": "full",                        // full | failed-only(二期)
      "parentRoundId": null,                 // 复测轮指向源轮(二期)
      "status": "done",                      // running | done | aborted | partial
      "total": 13, "counts": {...}, "suitePassStr": "11/13"
    }
  ]
}
```
- 每轮产物落 `report/回归用例库/{roundId}/`：`{roundId}-{env}.run.json` + 报告 md + `cases.snapshot.json`（当轮聚合用例快照）；证据沿用 `report/_evidence/` 惯例加 roundId 维度。

### 2.2 套件 `AI_LabTest/testCase/回归套件.json`
```jsonc
{
  "version": 1,
  "updatedAt": "ISO",
  "pinned": [{ "task": "登录鉴权", "originalId": "TC-001" }],   // 核心必跑白名单(项目级,跨套件生效)
  "suites": [
    { "name": "发版精选", "type": "static", "keys": [{ "task": "...", "originalId": "..." }] },
    { "name": "P0 冒烟", "type": "query", "filter": { "pri": ["P0"], "module": [], "task": [], "last": [] } }
  ]
}
```
- 内置「全量」不落盘（代码常量，等价 v1 行为）；查询求值纯内存（entries × filter），空条件=不限制。
- 类型定义随模块放 `src/lib/test/rounds.ts` / `suites.ts`（沿 v1 惯例，不进 types/index.ts）。

## 3. 分批实现

### 批 A — 数据层：轮次 + 套件（纯逻辑 + 单测，不碰 UI）
- **新增** `src/lib/test/rounds.ts`：`readRounds`（宽松解析仿 library.ts）/`appendRound`/`finishRound(roundId, status, stats)`/`roundDir(roundId)`；roundId 生成与冲突后缀；惰性 aborted 判定 `normalizeStale(rounds)`；写前版本比对。
- **新增** `src/lib/test/suites.ts`：`readSuites`/`upsertSuite`/`removeSuite`（内置全量拒删）/`evalSuite(library, suite): entries`（query 四字段 AND、字段内 OR、空条件不限制；static 按 keys；pinned 始终并入；`last` 用最近一轮结果——从 rounds+run.json 反查，一期先支持 p/f/n 三值）。
- **改** `src/lib/test/library.ts`：`buildRunnableCases(library, include?)` 加可选圈选集参数（套件求值结果传入；二期复测同参复用）。
- 单测 `test-rounds.test.ts` / `test-suites.test.ts`：状态机/解析容错/ID 冲突/版本比对；求值（空条件=全量、AND/OR、pinned 并入、静态去重、last 反查）；include 过滤。

**验收**：`npm run test` 绿；新增单测 ≥15 条覆盖上述分支。

### 批 B — 轮次落盘：产物目录迁移 + 快照 + 状态收口
- **改** `POST /api/test/library/run`：入参 `{projectPath, suiteName?, env?}` → `readLibrary→evalSuite→buildRunnableCases(include)`→写聚合 cases.json→`appendRound(running)`→留存 `cases.snapshot.json`→返回 `{roundId,total}`；审计 `run-library` 带 roundId/suite/env。
- **改** run/route.ts：保留任务名的执行/报告步产物落 `report/回归用例库/{roundId}/`（artifactPaths 加可选 roundSegment；其他任务零影响）。
- **前端** runLibrary：stream done 后回写 `finishRound(done, 从 run.json 读 counts/suitePassStr)`；catch/abort → `finishRound(aborted)`。
- **改** `GET /api/test/reports`：扫描兼容 `report/回归用例库/{roundId}/` 子目录；旧平铺产物继续显示（默认 3）。
- **新增** `GET /api/test/library/rounds`：轮次列表（normalizeStale 后返回）；`DELETE /api/test/library/rounds` 单轮删除（path-safety）。

**验收**：curl 端到端——发起两轮（同 env）互不覆盖；快照存在且内容=当轮聚合；中断模拟（kill 流）后轮次可被标 aborted；旧产物仍可见。

### 批 C — 套件 API + 构建器 UI
- **新增** `/api/test/suites` GET/POST/DELETE（isUnsafeSegment、内置全量 400）。
- **前端**：库弹窗加「回归套件」区/入口 → 套件列表（类型 badge + 实时命中数 + ✎ 编辑）+ **构建器弹窗**（名称/类型 radio/查询条件行构建器/静态分组勾选树/实时命中预览/同名与空套件拦截）+ pinned 管理；库总览批量勾选「加入套件」。交互按原型实现。
- i18n 三文件（zh/en/zh-HK）`test.suites.*`。

**验收**：CDP——新建查询套件（P0∧预约）命中数正确；静态套件组全选；保存落盘 回归套件.json；编辑/删除生效；内置全量不可删。

### 批 D — 发起回归弹窗重做（替换 v1 一键重跑）
- **前端** `StartRegressionModal`：套件下拉（命中数）→ env 下拉（读项目 environments.json 各环境 + 可达性状态点，替换硬编码 'local'）→ 预检卡（将执行 N 条 · 涉及 M 任务 · 预计时长/token 估算或「首轮暂无估算」）→ 红线口径说明行 → 开始执行（进度状态行带 roundId，复用 libraryRunStatus）。
- **改** runLibrary drive()：env 传所选值；可达性闸门/NO_CREDENTIALS 链路零改动复用。
- i18n。

**验收**：CDP——选不同套件命中数联动；env 不可达禁用项；执行后轮次出现在历史；v1「一键重跑全量」路径等价保留（默认套件=全量）。

### 批 E — 报告分组 + delta + 轮次历史视图 + 库检索
- **改** `src/lib/test/reduce.ts`：按 `_source.task`（idMap 反解）输出 `taskCounts` 小计入 run.json（无 _source 的普通任务不受影响）。
- **改** 报告 prompt（`rules/test-report.md`）：库轮次报告按来源任务分节。
- **前端**：①轮次历史列表（时间/env/套件/模式/通过率条/红线 badge/查看报告/查看快照/删除）+ 近 N 轮通过率迷你趋势；②报告视图按任务折叠分组（组头 x/y 小计红绿）+ delta 三卡（对上一全量轮、交集口径，点击过滤）；③库弹窗搜索（ID/标题）+ 来源任务/模块/优先级过滤 + 排序，弹窗扩宽；④修复 `status-danger-*`→`status-error-*` token bug（InlineTestingPanel.tsx:3748,3761 及全仓 grep）。
- i18n。

**验收**：CDP——两轮数据下 delta 卡数字正确（新增失败/修复/持续失败）；分组小计与 run.json taskCounts 一致；过滤/搜索命中正确；删除按钮 hover 红色反馈恢复。

### 批 F — 打包版执行可用性验证（原硬门槛，范围收缩）
- **开工核查发现（2026-07-09）：tech-debt #13 已被解决**——`scripts/bundle-chromium.mjs`（electron:pack* 链内、builder 之前跑）用 @playwright/mcp 自带 revision 装 chromium-headless-shell 到 `ms-playwright-bundle/`，electron-builder.yml `extraResources` 复制进包内 `resources/ms-playwright`，运行时经 `AILAB_RESOURCES_PATH/ms-playwright` 定位并 `--executable-path` 启动（见 electron-builder.yml:127-133 注释与 prompts.ts buildPlaywrightMcp）。tracker #13 条目已过时，批 G 收尾时修正。
- 本批收缩为**验证项**：打包验收（mac arm64 + Windows）登录后跑通「库发起回归」全链路（含新的 roundId 产物路径）。

**验收**：打包版（非 dev）完成一轮真实回归执行并产出轮次报告；BUILD_ID 核对包版本。

### 批 G — 收尾
- 单测补齐全绿（含批 B-E 的 API 层）；i18n 三文件强类型齐。
- CDP mock 全链路回归（worktree 内 `PORT=3001` 启动，不碰主目录）。
- 双文档：handover/insights 的 regression-library.md 增补 v2 章节（或独立 v2 文档互反链）；三个 README 索引同步。
- tech-debt-tracker 补记：保留任务名冲突校验（二期）、轮次磁盘保留策略（三期）、并发写锁的长期方案。

## 4. 验证与交付纪律
1. 每批 `npm run test` → CDP mock 全链路；UI 批次加 `npm run test:smoke`。
2. Worktree 纪律：改动只在 worktree 内、dev server 用 3001、提交前清理 dev server 与 untracked 残留、禁止 push（用户发起）。
3. **真跑 AI 依赖凭证**：dev 无凭证执行步必 blocked；套件/轮次/报告分组可 mock 验证，真实执行结论以打包登录后（批 F 验收）为准，结论如实标注。
4. 批间独立 commit（conventional commits），批 F 与 A-E 并行不互相阻塞。

## 5. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 产物路径迁移破坏 reports 兼容 | 批 B 双路径扫描 + 旧产物回归用例覆盖；独立 commit 可单独 revert |
| 并发写丢更新（双窗口/双 dev server） | 写前版本比对（设计默认 #7）；冲突时报错并提示重试 |
| roundId 同分钟冲突 | 后缀递增，单测覆盖 |
| 估算冷启动误导 | 无历史显式「暂无估算」，不出瞎数 |
| (task, originalId) 行身份漂移（AI 重生成改 id） | 一期不解决，delta/last 按新行处理；已记方案 §7，二期评估「继承历史」提示 |
| Chromium 分发体积/合规 | 批 F 先 POC 两方案对比再拍板，不直接上主代码 |
| 回滚 | 轮次/套件均为增量文件与新路由，删文件/关入口即回退 v1 行为；「全量」内置套件保证行为向后兼容 |

## 6. 进度跟踪

| 批 | 内容 | 状态 | commit |
|----|------|------|--------|
| 计划文档 | 本文 + 提案决策记录 + 索引 | ✅ 完成 | |
| 批 A | 数据层：rounds.ts + suites.ts + 单测 | ⬜ 待开始 | |
| 批 B | 轮次落盘 + 快照 + 状态收口 + rounds API | ⬜ 待开始 | |
| 批 C | 套件 API + 构建器 UI | ⬜ 待开始 | |
| 批 D | 发起回归弹窗重做（套件/env/预检） | ⬜ 待开始 | |
| 批 E | 报告分组 + delta + 轮次历史 + 库检索 + token bug | ⬜ 待开始 | |
| 批 F | 打包版执行可用（POC→方案→验收，与 A-E 并行） | ⬜ 待开始 | |
| 批 G | 收尾：单测/i18n/CDP/双文档/索引 | ⬜ 待开始 | |
