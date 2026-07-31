/**
 * Unit tests for 冒烟 Bug 清单的派生 / md 解析 / 覆盖层合并 / 结论口径
 * (src/lib/test/smoke-bugs.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-smoke-bugs.test.ts
 *
 * 关键不变量：
 *  1. Bug ↔ fail 场景 1:1（blocked/partial 不产 Bug）；
 *  2. 覆盖层严格按 runHash 绑定——重跑后旧复核态整体失效，绝不错挂轮次；
 *  3. md 解析 best-effort：格式漂移最多丢 AI 初判回退默认「严重」，绝不抛错；
 *  4. 结论双记录：全部 fail 复核为误报 → passed-after-review；有 blocked 无 fail
 *     → incomplete（不得报「通过」）。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseMdBugInfo,
  extractSmokeConclusion,
  ensureSmokeReportBugTable,
  smokeReportStatus,
  deriveBugs,
  mergeBugOverrides,
  upsertBugOverride,
  smokeVerdict,
  SMOKE_SEVERITY_DEFAULT,
} from "../../lib/test/smoke-bugs";
import type { SmokeBugsFile } from "../../types";

const RUN = {
  tests: [
    { id: "SM-001", status: "pass" as const, actual: "添加成功" },
    { id: "SM-002", status: "fail" as const, actual: "查询返回空列表", error: "按名称查询无结果", api: { method: "GET", url: "/api/orgs?name=x", status: 200 }, evidence: ["SM-002.png"] },
    { id: "SM-003", status: "blocked" as const, error: "依赖场景 SM-002 未通过" },
    { id: "SM-004", status: "fail" as const, actual: "保存后详情未更新" },
  ],
};

const GFM_MD = `# 冒烟测试报告

## 三、Bug 清单

| 编号 | 标题 | 严重级别 | 关联场景 | 实际 | 预期 | 接口 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-01 | 机构名称查询无结果 | 致命 | \`SM-002\` | 返回空列表 | 应命中机构 | GET /api/orgs?name=x (200) | SM-002.png |
| BUG-02 | 修改保存不生效 | 一般 | \`SM-004\` | 保存后详情未更新 | 详情同步更新 | — | SM-004.png |

## 四、奇怪交互 / 体验问题
严重级别：这行在章节外，不该被解析

## 五、整体结论
冒烟未通过：风险查询主流程存在断点，暂不具备进一步测试条件。

## 附录
这里不属于整体结论。
`;

const LEGACY_MD = `# 冒烟测试报告

## 三、Bug 清单

- **编号**：BUG-01
- **标题**：机构名称查询无结果
- **严重级别**：致命
- **关联场景**：SM-002
- **实际**：返回空列表

- **编号**：BUG-02
- **标题**：修改保存不生效
- **严重级别**：一般
- **关联场景**：SM-004

## 四、体验问题
严重级别：这行在章节外，不该被解析
`;

describe("parseMdBugInfo", () => {
  it("从固定 GFM 表格按列名解析标题、严重级别与关联场景", () => {
    const info = parseMdBugInfo(GFM_MD);
    assert.deepEqual(info["SM-002"], { title: "机构名称查询无结果", severity: "致命" });
    assert.deepEqual(info["SM-004"], { title: "修改保存不生效", severity: "一般" });
  });

  it("兼容历史逐字段列表格式", () => {
    const info = parseMdBugInfo(LEGACY_MD);
    assert.deepEqual(info["SM-002"], { title: "机构名称查询无结果", severity: "致命" });
    assert.deepEqual(info["SM-004"], { title: "修改保存不生效", severity: "一般" });
  });

  it("只扫「Bug 清单」章节，章节外的字样不污染", () => {
    const info = parseMdBugInfo(GFM_MD);
    assert.equal(Object.keys(info).length, 2);
  });

  it("GFM 表格中同一场景出现多行时先到先得（1:1 前提）", () => {
    const md = `## Bug 清单
| 编号 | 标题 | 严重级别 | 关联场景 | 实际 | 预期 | 接口 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-01 | 首条 | 致命 | SM-002 | A | B | — | — |
| BUG-02 | 重复条目 | 建议 | SM-002 | C | D | — | — |
`;
    assert.deepEqual(parseMdBugInfo(md)["SM-002"], { title: "首条", severity: "致命" });
  });

  it("空 / 无章节 / 格式漂移 → 空映射，不抛", () => {
    assert.deepEqual(parseMdBugInfo(""), {});
    assert.doesNotThrow(() => parseMdBugInfo("随便什么文本"));
    // 非法严重级别值不采纳
    const md = `## Bug 清单
| 编号 | 标题 | 严重级别 | 关联场景 | 实际 | 预期 | 接口 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-01 | 格式漂移 | 超级严重 | SM-001 | A | B | — | — |
`;
    assert.deepEqual(parseMdBugInfo(md)["SM-001"], { title: "格式漂移", severity: undefined });
  });
});

describe("extractSmokeConclusion", () => {
  it("只提取「整体结论」章节，并在下一个标题前停止", () => {
    assert.equal(
      extractSmokeConclusion(GFM_MD),
      "冒烟未通过：风险查询主流程存在断点，暂不具备进一步测试条件。",
    );
  });

  it("报告为空、缺少结论章节或章节为空时返回 null，不从其它章节猜结论", () => {
    assert.equal(extractSmokeConclusion(""), null);
    assert.equal(extractSmokeConclusion("## 场景结果表\n主流程未通过"), null);
    assert.equal(extractSmokeConclusion("## 五、整体结论\n\n## 附录\n其它内容"), null);
  });
});

describe("ensureSmokeReportBugTable", () => {
  it("旧版逐字段 Bug 清单会被确定性转换成固定 8 列 GFM 表格", () => {
    const normalized = ensureSmokeReportBugTable(LEGACY_MD, RUN.tests);
    assert.match(normalized, /\| 编号 \| 标题 \| 严重级别 \| 关联场景 \| 实际 \| 预期 \| 接口 \| 证据 \|/);
    assert.match(normalized, /\| BUG-01 \| 机构名称查询无结果 \| 致命 \| SM-002 \|/);
    assert.match(normalized, /\| BUG-02 \| 修改保存不生效 \| 一般 \| SM-004 \|/);
    assert.equal((normalized.match(/\| BUG-/g) ?? []).length, 2);
    assert.doesNotMatch(normalized, /-\s*\*\*编号\*\*/);
  });

  it("已符合合同且覆盖全部 fail 场景的表格保持原文不变", () => {
    assert.equal(ensureSmokeReportBugTable(GFM_MD, RUN.tests), GFM_MD);
  });

  it("缺少 Bug 章节时会在整体结论前补表；无 fail 时保留空表行", () => {
    const md = "# 冒烟测试报告\n\n## 五、整体结论\n\n通过。\n";
    const normalized = ensureSmokeReportBugTable(md, [{ id: "SM-001", status: "pass" }]);
    assert.ok(normalized.indexOf("## 三、Bug 清单") < normalized.indexOf("## 五、整体结论"));
    assert.match(normalized, /\| — \| 本轮冒烟未发现缺陷 \| — \| — \| — \| — \| — \| — \|/);
  });

  it("单元格中的换行和竖线会被转义，不破坏表格结构", () => {
    const md = "# 报告\n\n## 三、Bug 清单\n\n- **标题**：保存异常\n- **严重级别**：严重\n- **关联场景**：SM-001\n";
    const normalized = ensureSmokeReportBugTable(md, [{
      id: "SM-001",
      status: "fail",
      actual: "第一行\n包含 A|B",
      api: { method: "POST", url: "/api/a|b", status: 500 },
      evidence: ["a.png", "b.png"],
    }]);
    assert.match(normalized, /第一行<br>包含 A\\\|B/);
    assert.match(normalized, /POST \/api\/a\\\|b \(500\)/);
  });
});

describe("smokeReportStatus", () => {
  it("按 fail → blocked/empty → partial → pass 的固定优先级归约", () => {
    assert.equal(smokeReportStatus({ total: 4, fail: 1, blocked: 1, partial: 1 }), "failed");
    assert.equal(smokeReportStatus({ total: 4, fail: 0, blocked: 1, partial: 1 }), "incomplete");
    assert.equal(smokeReportStatus({ total: 4, fail: 0, blocked: 0, partial: 1 }), "partial");
    assert.equal(smokeReportStatus({ total: 4, fail: 0, blocked: 0, partial: 0 }), "passed");
    assert.equal(smokeReportStatus({ total: 0, fail: 0, blocked: 0, partial: 0 }), "incomplete");
  });
});

describe("deriveBugs · fail 1:1 派生", () => {
  const goals = { "SM-002": "条件查询", "SM-004": "修改机构信息" };
  const bugs = deriveBugs(RUN, parseMdBugInfo(GFM_MD), goals);

  it("只有 fail 场景产 Bug（pass/blocked 不产）", () => {
    assert.equal(bugs.length, 2);
    assert.deepEqual(bugs.map((b) => b.sceneId), ["SM-002", "SM-004"]);
  });

  it("编号 BUG-01 起顺序编号", () => {
    assert.deepEqual(bugs.map((b) => b.id), ["BUG-01", "BUG-02"]);
  });

  it("AI 初判（标题/严重级别）来自报告 md", () => {
    assert.equal(bugs[0].title, "机构名称查询无结果");
    assert.equal(bugs[0].severity, "致命");
    assert.equal(bugs[1].severity, "一般");
  });

  it("事实字段（actual/api/evidence/expected=验证目标）从 run.json/cases 派生", () => {
    assert.equal(bugs[0].actual, "查询返回空列表");
    assert.equal(bugs[0].api?.url, "/api/orgs?name=x");
    assert.deepEqual(bugs[0].evidence, ["SM-002.png"]);
    assert.equal(bugs[0].expected, "条件查询");
  });

  it("md 无该场景初判 → 标题回退「验证目标｜现象」+ 默认严重级别", () => {
    const noMd = deriveBugs(RUN, {}, goals);
    assert.equal(noMd[0].severity, SMOKE_SEVERITY_DEFAULT);
    assert.ok(noMd[0].title.includes("条件查询"));
    assert.ok(noMd[0].title.includes("按名称查询无结果"));
  });

  it("goals 也缺失 → 标题回退现象截断，仍不抛", () => {
    const bare = deriveBugs({ tests: [{ id: "SM-009", status: "fail", error: "boom" }] }, {}, {});
    assert.equal(bare[0].title, "boom");
  });
});

describe("mergeBugOverrides · runHash 绑定", () => {
  const derived = deriveBugs(RUN, {}, {});
  const stored: SmokeBugsFile = {
    version: 1,
    runHash: "hash-A",
    bugs: [{ id: "BUG-01", sceneId: "SM-002", title: "", severity: "建议", severityOverriddenFrom: "严重", note: "已和产品确认" }],
  };

  it("runHash 匹配 → 人工 severity/note 覆盖派生值，并保留 AI 原值", () => {
    const merged = mergeBugOverrides(derived, stored, "hash-A");
    const b = merged.find((x) => x.sceneId === "SM-002")!;
    assert.equal(b.severity, "建议");
    assert.equal(b.severityOverriddenFrom, "严重");
    assert.equal(b.note, "已和产品确认");
  });

  it("runHash 不匹配（重跑后）→ 覆盖层整体失效", () => {
    const merged = mergeBugOverrides(derived, stored, "hash-B");
    const b = merged.find((x) => x.sceneId === "SM-002")!;
    assert.equal(b.severity, SMOKE_SEVERITY_DEFAULT);
    assert.equal(b.note, undefined);
  });

  it("stored 为 null / 结构损坏 → 原样返回派生值", () => {
    assert.deepEqual(mergeBugOverrides(derived, null, "x"), derived);
    assert.deepEqual(mergeBugOverrides(derived, { version: 1, runHash: "x", bugs: "坏" as unknown as [] }, "x"), derived);
  });

  it("覆盖层里对不上派生清单的条目被丢弃（场景已删）", () => {
    const orphan: SmokeBugsFile = { version: 1, runHash: "h", bugs: [{ id: "BUG-09", sceneId: "SM-999", title: "", severity: "致命" }] };
    const merged = mergeBugOverrides(derived, orphan, "h");
    assert.ok(!merged.some((b) => b.sceneId === "SM-999"));
  });

  it("非法 severity 覆盖值不采纳", () => {
    const bad: SmokeBugsFile = { version: 1, runHash: "h", bugs: [{ id: "BUG-01", sceneId: "SM-002", title: "", severity: "特大" }] };
    const merged = mergeBugOverrides(derived, bad, "h");
    assert.equal(merged.find((x) => x.sceneId === "SM-002")!.severity, SMOKE_SEVERITY_DEFAULT);
  });
});

describe("upsertBugOverride", () => {
  it("同 runHash 追加/更新条目", () => {
    const f1 = upsertBugOverride(null, "h", { sceneId: "SM-002", severity: "一般" });
    assert.equal(f1.bugs.length, 1);
    const f2 = upsertBugOverride(f1, "h", { sceneId: "SM-002", note: "备注" });
    assert.equal(f2.bugs.length, 1);
    assert.equal(f2.bugs[0].severity, "一般", "更新 note 不应丢已存的 severity");
    assert.equal(f2.bugs[0].note, "备注");
    const f3 = upsertBugOverride(f2, "h", { sceneId: "SM-004", severity: "建议" });
    assert.equal(f3.bugs.length, 2);
  });

  it("runHash 变化 → 丢弃旧文件从零开始", () => {
    const f1 = upsertBugOverride(null, "h1", { sceneId: "SM-002", severity: "一般" });
    const f2 = upsertBugOverride(f1, "h2", { sceneId: "SM-004", severity: "致命" });
    assert.equal(f2.runHash, "h2");
    assert.equal(f2.bugs.length, 1);
    assert.equal(f2.bugs[0].sceneId, "SM-004");
  });

  it("清空备注（note:''）后不再携带 note 字段", () => {
    const f1 = upsertBugOverride(null, "h", { sceneId: "SM-002", note: "x" });
    const f2 = upsertBugOverride(f1, "h", { sceneId: "SM-002", note: "" });
    assert.equal(f2.bugs[0].note, undefined);
  });
});

describe("smokeVerdict · 结论口径（双记录）", () => {
  it("全 pass → passed", () => {
    assert.equal(smokeVerdict({ total: 3, pass: 3, fail: 0, blocked: 0 }, [], {}).verdict, "passed");
  });

  it("有 fail 未复核 → failed", () => {
    assert.equal(smokeVerdict({ total: 3, pass: 2, fail: 1, blocked: 0 }, ["SM-002"], {}).verdict, "failed");
  });

  it("全部 fail 复核为误报 → passed-after-review（并报清除数）", () => {
    const r = smokeVerdict({ total: 3, pass: 2, fail: 1, blocked: 0 }, ["SM-002"], { "SM-002": "false_fail" });
    assert.equal(r.verdict, "passed-after-review");
    assert.equal(r.clearedFails, 1);
  });

  it("部分 fail 复核为误报、其余未复核 → 仍 failed", () => {
    const r = smokeVerdict({ total: 4, pass: 2, fail: 2, blocked: 0 }, ["SM-002", "SM-004"], { "SM-002": "false_fail" });
    assert.equal(r.verdict, "failed");
  });

  it("fail 被复核为「确认缺陷」(accurate) → failed（不是误报）", () => {
    const r = smokeVerdict({ total: 3, pass: 2, fail: 1, blocked: 0 }, ["SM-002"], { "SM-002": "accurate" });
    assert.equal(r.verdict, "failed");
  });

  it("无 fail 有 blocked → incomplete（不得报通过）", () => {
    assert.equal(smokeVerdict({ total: 3, pass: 2, fail: 0, blocked: 1 }, [], {}).verdict, "incomplete");
  });

  it("total=0 → empty（不出结论）", () => {
    assert.equal(smokeVerdict({ total: 0, pass: 0, fail: 0, blocked: 0 }, [], {}).verdict, "empty");
  });
});
