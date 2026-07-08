# 测试工作台 · 回归集标签 + 用例门控 + 操作审计(技术交接)

> 产品思考见 [docs/insights/test-regression-suite.md](../insights/test-regression-suite.md)
> 执行计划(含决策日志/验证记录)见 [docs/exec-plans/active/test-regression-gate-audit.md](../exec-plans/active/test-regression-gate-audit.md)

commits:`09f10d8..eef5a96`(9 个,V3.0.1_dev,2026-07-06~07)

## ⚠️ 两个「回归」概念(读代码前必知)

| 概念 | 判定 | 代码命名 | 决定什么 |
|---|---|---|---|
| **回归基线**(旧) | `verification === "回归基线"`(预期来自现状锁定) | reduce.ts `isRegression()`/`regressionTotal`/`funcCounts` | 功能验证通过率口径 |
| **回归集**(本次) | `tags` 含 `"回归测试"`(失败即阻塞系统) | **`suite*`**:`suiteIds`/`suiteCounts`/`suitePassStr` | 发版红线 |

两者正交,一条用例可同属两者。判定标准与区分表:`src/lib/test/rules/test-case-completeness.md §1.7`。**新代码禁止用 regression* 命名回归集概念。**

## 数据流

```
生成:casesPrompt(prompts.ts)→ AI 产 tags → {task}.cases.json
     ├ 导入:import/route.ts rowsToCases(/标签|tags?/ 列)→ tags[]
     ├ 编辑:用例表格「用例标签」列多选(既有)/ cases/export 有「用例标签」列
     └ 存量推荐:/api/test/cases/recommend(下述)
执行:run/route.ts 读 cases.json 收集 tags 含「回归测试」的 id → suiteIds
     → reduce.ts 算 suiteCounts/suitePassStr(可选字段,无标签缺省)→ run.json
展示:reports API 透传 → SuiteBanner(InlineTestingPanel,红=未全过不可发版/绿=全过)
     挂 ReportView(报告 tab)+ InlineReportSection(阶段详情卡)两处;
     report-xlsx 加「用例标签」列;reportPrompt+rules/test-report.md §2.1a 红线铁律
```

## 用例门控(「运行任务」模式)

- `HUMAN_GATED` 未变(requirement/cases);变化在 **autoRun 路径**:`runStep` finally 中
  `step==="cases" && autoAll` → 置 `review` 并从 `autoRunIdsRef` 释放,任务记入
  **`gatedRunAllRef`**(InlineTestingPanel);
- `approveStep("cases")` 时若在 `gatedRunAllRef` → 重新加回 `autoRunIdsRef`,执行→报告
  自动接力(切走任务也后台跑完);手动流程行为不变;
- `stopTask` / 新一轮 `startRunAllFrom` 清恢复标记;
- 多任务批量:`pumpQueue` 出队时对【入队前已存在】的旧 review 自动批准(隐含确认)保留
  ——门控只拦「本次新生成」的用例;排队调度机制未动。

## 操作审计

- `src/lib/test/audit.ts`:`AuditEvent {time,taskId,step,action,mode,detail}`,JSONL 追加
  `<project>/AI_LabTest/audit/<task>.jsonl`。**独立于 report/ 目录 → reports/delete 删任务
  不触碰审计,天然留痕**。全链路 best-effort 静默失败。
- `/api/test/audit`:POST 追加(time 服务端生成,path-safety 校验)/ GET 倒序读取。
- 前端 `logAudit()` fire-and-forget,13 处埋点:approve(含门控恢复标注)/run(manual·
  auto 批准接力·auto-chain)/run-task/chat-action/revise/stop/auto-approve(batch)/
  import/edit-cases/delete-task(删前写);recommend-suite 由后端记。
- 查看:任务详情 header「操作记录」→ `AuditModal`(动作/方式 i18n 映射,zh/en/zh-HK)。

## 存量 AI 推荐(/api/test/cases/recommend)

复制 run/route 流包装:透传 streamClaude SSE + 累积 text 帧;AI **只读** cases+需求,逐条输出
`@@RECOMMEND {"id","suite","reason"}`;流尾 `harvestRecommend` → `applyRecommend`
**代码 merge**(只增删 tags 里「回归测试」,其余字段与文件结构原样,.tmp+rename)→ 服务端记审计
→ 补发 `cases_updated` 帧。前端按钮在用例设计详情卡(`recommendSuite`,@@RECOMMEND 行不上屏)。
**为什么不像 revise 让 AI 直接写文件:防 AI 重写整份 JSON 丢 tags 外字段。**

## 测试与验证

- 单测:test-reduce(+4 suite 口径)/ test-audit(5)/ test-cases-recommend(4)/
  import·export 标签 roundtrip;全套 1828 pass / 1 fail(project-mcp-injection 预存)。
- dev 验证需 `npm rebuild better-sqlite3`(Node ABI;打包 after-pack 自动改回 Electron ABI)。
- CDP mock 手法(真实数据零接触):注入 fetch mock(workbench GET/PUT 全假、run 假 SSE、
  audit POST 重定向 scratchpad),门控→批准→接力→审计链全程实测。见执行计划「验证记录」。
- **待打包验收(mac+Windows)**:门控/横幅/推荐/操作记录均 UI 行为;用工作台 header 的
  BUILD_ID 核对包版本。
