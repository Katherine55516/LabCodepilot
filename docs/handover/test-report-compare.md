# 报告多版本对比（回归分析）

> 产品思考见 [docs/insights/test-report-compare.md](../insights/test-report-compare.md)
> 上游方案见 [docs/research/framework-flow-test-integration.md](../research/framework-flow-test-integration.md) §四第三批 / §六 Phase 3

framework 集成方案第三批落地的第一项（用户选定，其余三项暂缓）。在测试报告里加「两次执行对比」：选两个历史版本 → **双口径通过率变化** + 逐用例状态 diff（退步/改善/新增/移除）。这是 oracle 双轴里「回归基线」的主场——回归基线本就为「防回归」存在，对比才让它发挥价值。

## 一、解决的问题

执行结果 `run.json` 此前是**覆盖式**（`report/{task}/{task}-{env}.run.json`，重跑同环境即覆盖，无历史）。所以无法回答「这次相对上次，哪些用例退步了 / 通过率涨了还是跌了」——而这正是回归测试的核心问题。

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/test/history.ts`（新） | run.json 历史快照：`stampNow`（本地时间戳 YYYYMMDD-HHmmss-SSS）+ `snapshotRunJson`（SHA-1 去重写 `.history/`）+ `listRunHistory`（列快照含摘要，newest-first）。移植自 framework `app/src/main/engine/history.js`，适配 report/{task} 布局、按 {task}-{env} 分系列 |
| `src/lib/test/compare.ts`（新） | 纯函数 `diffRuns(prev, curr)`：按 id join 两次执行 → 逐用例 change（added/removed/improved/regressed/unchanged，按状态 rank 判好坏）+ 双口径通过率 delta（执行通过率 + 功能验证通过率，后者用 funcCounts 排除回归基线）。regressed 排最前 |
| `src/app/api/test/run/route.ts` | 执行归约写 latest run.json 后，调 `snapshotRunJson` 存一份带时间戳的历史副本（best-effort，SHA-1 去重） |
| `src/app/api/test/reports/history/route.ts`（新） | `GET ?projectPath&taskName&env` → `listRunHistory` → 历史快照列表（含 counts/funcCounts/passStr/funcPassStr + 逐用例 {id,status}，供前端 diff） |
| `src/components/test/InlineTestingPanel.tsx` | 新增 `CompareView`（版本选择器 + 双口径通过率变化卡 + 逐用例 diff 表）；ReportBrowser 报告行展开区加「本次结果 / 对比历史」两 tab（`compareKey` state 切换） |
| `src/i18n/{zh,en,zh-HK}.ts` | `test.compare.*`（tabResult/tabCompare/needTwo/baseline/target/change/regressed/improved/added/removed/unchanged/noChange）11 键 |
| `src/__tests__/unit/test-compare.test.ts`（新） | diffRuns 单测 6 例（分类 + regressed-first 排序 + rank + 双口径 delta + 向后兼容 + N/A） |

## 三、数据流

```
执行步归约（reduce）→ wrapExecutionStream done 分支：
  写 latest report/{task}/{task}-{env}.run.json（覆盖）
  + snapshotRunJson → report/{task}/.history/{task}-{env}-{stamp}.run.json（SHA-1 去重）
   ↓
报告视图 → 展开报告行 → 「对比历史」tab → CompareView：
  GET /api/test/reports/history → listRunHistory（newest-first）
   ↓
  选基线(默认 history[1] 上一版) + 目标(默认 history[0] 最新)
   ↓
  diffRuns(基线, 目标) → 双口径通过率 delta + 逐用例 change → 渲染
```

## 四、关键设计决策

1. **复用 oracle 双轴的 funcCounts 算功能验证通过率变化**。回归对比最该看的是「功能验证通过率」的变化（回归基线用例永远 pass，算进去会稀释信号）。`diffRuns` 的 `funcRate` 用 `funcCounts`（第二阶段 reduce 写入），`execRate` 用 `counts`。funcCounts 缺失（旧 run）时回退 counts，向后兼容。

2. **快照 SHA-1 去重 + 文件名时间戳排序**。与 framework history.js 一致：内容与最新快照相同则跳过（重跑无变化不堆快照）；文件名 `{task}-{env}-{stamp}` 字典序 = 时间序，`listRunHistory` 倒序取 newest-first。

3. **diff 在纯函数层、前端复用**。`diffRuns` 是纯函数（compare.ts 无 fs），history route 只返回数据（含逐用例 {id,status}），前端选定两版本后本地跑 diffRuns——版本切换无需往返后端。

4. **状态 rank 判好坏**：`pass(3) > partial(2) > blocked(1) > fail(0)`。curr rank > prev → improved，< → regressed。所以 pass→partial 也算 regressed（合理：通过变部分通过是退步）。

5. **覆盖式 latest 不动 + 增量历史**。latest run.json 仍覆盖（报告浏览/handoff 等既有逻辑不变），历史只进 `.history/`（隐藏目录，不污染报告浏览）。

## 五、验证

- **diffRuns 单测**：`npx tsx --test src/__tests__/unit/test-compare.test.ts` → 6/6。typecheck exit 0。
- **history API + UI（dev 3001 实测）**：mock 一个任务的 latest + 两份历史快照（旧 2/4·func1/3 → 新 3/4·func2/3，TC-001 pass→fail、TC-002 fail→pass）。GET history 返回 2 版本（newest-first，摘要正确）；CompareView 渲染：功能验证 33%→67% ▲+34、执行 50%→75% ▲+25、退步 1/改善 1、TC-001 退步(红)/TC-002 改善(绿)。

## 六、已知局限

- **真实历史靠多次执行积累**。快照在每次执行归约时写，dev 本地无 API credentials 跑不通真实执行，历史是 mock 验证的；真实环境需跑 ≥2 次同任务同环境才有可对比的历史。
- **第三批其余三项未做**（用户选定只做对比）：产物历史版本 + 行级 diff（需求/用例/报告 md 的 diff）、每步 ETA + 实际耗时、多任务并发。其中行级 diff 可复用本批的快照思路（history.js 已支持任意 category）；ETA 的 framework 参照在 DESIGN.md `STEP_ETA`；并发对内嵌单任务形态价值低。
- **快照无清理策略**。`.history/` 只增不删（与 framework 一致）。长期可能堆积，未来可加保留 N 份 / 按时间归档（framework report 规范 §6 提到类似思路）。
- **id join 依赖用例 id 稳定**。两次执行间用例 id 改了会误判为 added/removed。正常迭代用例 id 稳定，重构 id 时对比会失真——属预期（id 本就是用例的稳定锚点）。
