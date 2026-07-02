---
description: Step 3 — 生成结构化测试报告（终态产物，文件名含环境标签）
argument-hint: "[可选：任务名或 all]"
---

# Step 3：测试报告生成

## 前置检查

1. **必须**存在最近一次 Step 2 执行结果 `/AI_LabTest/report/{任务}-{ENV}.run.json`（由测试执行归约写入）
   - 若不存在 → 中断，提示用户先运行 `/ai-lab-test:execute`
2. 报告以 `run.json`（四态计数 + 逐条状态 + 证据路径）为唯一权威事实来源

## 规则
严格遵循 `${CLAUDE_PLUGIN_ROOT}/rules/test-report.md`（**先用 Read 工具读取该文件再执行**），**特别是第 8 节：终态原则**。

## 执行步骤

### 1. 读取环境上下文

从 `.last-run-env.json` 提取：
- `tag`（local / SIT）→ 用作文件名后缀
- `env`（小写 local/sit）→ 用作 `latest-{env}.md` 后缀
- `frontendBaseUrl` / `apiBaseUrl` / `testAccount` → 写入报告概要节

> ⚠️ 如执行环境为 `uat` 或其他白名单外值 → 中断报告生成（防御性检查；正常流程下此情况不会出现，因为 Step 2 不会对 uat 执行）

### 2. 收集执行数据

- 通过 / 失败 / 跳过数与耗时
- 每条失败的错误信息、分类、可追溯链路

### 3. 生成报告（默认 2 份：主报告 + 缺陷报告）

**(A) 主报告**（`{任务}-report-…md`，按 `test-report.md` §2）：默认**只含 2 节**——
1. 概要（§2.1，**首行必须明示 ENV + URL**；含四态计数 + 通过率铁律）
2. **执行矩阵**（§2.8：用例 12 列 + 执行 5 列 `实际结果/执行状态/证据/录像/失败·阻塞原因`，与用例一一对应）
> 任务结果 / 失败明细 / 需求覆盖矩阵 / 覆盖缺口 / 应用 Bug 清单 / 测试侧后续动作 **暂不输出**（模板保留在 `test-report.md §2.2–§2.7`，按需再开）。

**(B) 独立缺陷报告**（`{任务}-缺陷报告-…md`，按 `test-report.md` §2.9）：**仅未通过用例**——`fail` 进缺陷正文逐条详情，`partial`/`blocked` 进「非应用缺陷」附录。全部 pass 也生成（正文写「本轮无应用缺陷」）。

> 历史归档 / `latest-{env}.md` / 多任务合并 / XLSX / DOCX **暂不默认生成**。

### 4. 文件命名（必须含 ENV + 时分秒）

| 范围 | 文件名 |
|---|---|
| 单任务（主报告） | `/AI_LabTest/report/{任务}-report-{ENV}-{YYYYMMDD}-{HHMMSS}.md` |
| 单任务（缺陷报告） | `/AI_LabTest/report/{任务}-缺陷报告-{ENV}-{YYYYMMDD}-{HHMMSS}.md` |
| 多任务 | `/AI_LabTest/report/multi-report-{ENV}-{YYYYMMDD}-{HHMMSS}.md` |
| 本环境最新（覆盖） | `/AI_LabTest/report/latest-{env}.md` |

**示例**（含改进 3 时分秒后缀）：
- `login-report-local-20260525-171042.md`
- `login-report-SIT-20260525-171825.md`
- `latest-local.md` / `latest-sit.md`

**关键**：时分秒来自 `.last-run-env.json.executedAt`，不要用 `new Date()` 重新取（防止报告时间 ≠ 执行时间）：

```js
const iso = lastRunEnv.executedAt;
const date = iso.slice(0,10).replace(/-/g,'');
const time = iso.slice(11,19).replace(/:/g,'');
// filename: {任务}-report-{tag}-{date}-{time}.md
```

## 用户门控（铁律 — 终态原则）

**禁止任何用户问询**。Step 3（测试报告）是终态：

| 禁止 | 含义 |
|---|---|
| ❌ AskUserQuestion 索取裁定 | 用例已在 Step 1 确认 |
| ❌「请你选择 A/B/C」 | 报告是产物不是问卷 |
| ❌ 暂停等待回复 | 一次性产出 |
| ❌「待用户确认」占位 | 失败分类必须明确 |
| ❌ 环境字段「未知」/ 留空 | 必须从 .last-run-env.json 读取，读不到则中断 |

**正确做法（陈述式）**：直接在报告中列出处理路径建议。

## 口头汇报（强制，4 件事；有 fail 再加第 5 条）

报告写完后，**必须口头**向用户陈述：
1. **环境**：本次报告基于 {ENV} 环境（{frontendBaseUrl}）
2. **结果总览**：通过 / 失败 / 跳过数与百分比
3. **风险点**：应用 bug 数 + 高严重度 bug ID
4. **下一步建议**（陈述句）：修 bug / 补测试 / 跨环境对比 / 推进发布
5. **（仅当有 fail）缺陷报告确认 + 修复去向**：提示「缺陷报告已生成，含 N 个应用缺陷，请查阅确认；如需修复，建议新开一个对话窗口进行（本 QA 会话零源码修改、不在此修）」——**陈述式提示，不用 `AskUserQuestion`、不追问、不等回复**。

**禁止以问句结尾**（第 5 条是陈述式提示，非问句）。

## 输出

- `/AI_LabTest/report/{任务}-report-{ENV}-{YYYYMMDD}-{HHMMSS}.md`（主报告，**仅 §2.1 概要 + §2.8 执行矩阵**）
- `/AI_LabTest/report/{任务}-缺陷报告-{ENV}-{YYYYMMDD}-{HHMMSS}.md`（独立缺陷报告，仅未通过用例）

## 参数

$ARGUMENTS
