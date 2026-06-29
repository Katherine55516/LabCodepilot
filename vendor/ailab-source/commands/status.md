---
description: 查看 AI_LabTest 流水线状态 — 每个任务走到哪一步
---

# AI_LabTest 流水线状态

## 任务

扫描以下目录，按任务汇总每个任务当前所处的步骤：

| 目录 | 对应步骤 |
|---|---|
| `/AI_LabTest/testCase/{任务}-testcase.md` | Step 1（测试用例设计）完成 |
| `/AI_LabTest/report/{任务}-{ENV}.run.json` | Step 2（测试执行）完成 |
| `/AI_LabTest/report/{任务}-report-*.md` | Step 3（测试报告）完成 |

## 输出格式

呈现表格：

```
任务            | S1 | S2 | S3 | 最后报告日期
--------------+----+----+----+-------------
login         | ✅ | ✅ | ✅ | 20260525
navigation-auth | ✅ |    |    | —
daily-practice | ✅ |    |    | —
```

底部附建议下一步：
> 建议下一步：运行 `/ai-lab-test:execute navigation-auth` 进入 Step 2（测试执行）。

## 禁止

- 不修改任何文件，仅读取与展示
- 不发起 AskUserQuestion，仅呈现现状
