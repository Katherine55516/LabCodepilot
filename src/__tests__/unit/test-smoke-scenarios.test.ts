/**
 * Unit tests for 冒烟测试场景解析与用例互转 (src/lib/test/smoke-scenarios.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-smoke-scenarios.test.ts
 *
 * 锁住两条口径铁律（回归时最容易被改坏、且改坏了不报错只出错数据）：
 *  1. tags 恒空 —— 打上「回归测试」会让冒烟场景被 depositTask 收进回归用例库、
 *     并触发报告的发版红线（suiteCounts），把一次性主流程验证伪装成发版必跑回归集。
 *  2. verification 恒为「功能验证」—— 标成「回归基线」会被 funcCounts 排除，
 *     报告通过率变成 "N/A（仅锁现状）"，与冒烟"主流程通不通"的结论口径直接矛盾。
 * 外加解析容错（各种分隔符 / 序号 / 空行 / 缺预期不臆造）。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseScenarioLines,
  scenariosToCases,
  scenarioTextToCases,
  casesToScenarios,
  scenariosToText,
  smokeCaseId,
  smokeDataPrefix,
} from "../../lib/test/smoke-scenarios";

describe("parseScenarioLines · 分隔符容错", () => {
  it("接受全角箭头、ASCII 箭头、冒号、竖线、破折号", () => {
    const text = [
      "添加机构 → 添加成功",
      "查看机构 -> 详情与录入一致",
      "条件查询 => 可查到新增机构",
      "状态操作：切换生效",
      "修改信息 | 保存成功",
      "删除机构 — 列表不再显示",
    ].join("\n");
    const r = parseScenarioLines(text);
    assert.equal(r.length, 6);
    assert.deepEqual(r[0], { goal: "添加机构", expected: "添加成功" });
    assert.deepEqual(r[1], { goal: "查看机构", expected: "详情与录入一致" });
    assert.deepEqual(r[2], { goal: "条件查询", expected: "可查到新增机构" });
    assert.deepEqual(r[3], { goal: "状态操作", expected: "切换生效" });
    assert.deepEqual(r[4], { goal: "修改信息", expected: "保存成功" });
    assert.deepEqual(r[5], { goal: "删除机构", expected: "列表不再显示" });
  });

  it("`->` 不被 `-` 抢先切开（长分隔符优先）", () => {
    const r = parseScenarioLines("查看机构 -> 详情一致");
    assert.equal(r[0].goal, "查看机构");
    assert.equal(r[0].expected, "详情一致");
  });

  it("只在第一个分隔符处切一刀，预期里的冒号被保留", () => {
    const r = parseScenarioLines("保存表单：出现提示：保存成功");
    assert.equal(r[0].goal, "保存表单");
    assert.equal(r[0].expected, "出现提示：保存成功");
  });

  it("剥掉行首序号与列表符号", () => {
    const text = ["1. 添加机构 → 成功", "2、查看机构 → 一致", "- 删除机构 → 消失", "（3）查询 → 有结果"].join("\n");
    const r = parseScenarioLines(text);
    assert.deepEqual(
      r.map((s) => s.goal),
      ["添加机构", "查看机构", "删除机构", "查询"],
    );
  });

  it("跳过空行与纯空白行，归一全角空格", () => {
    const r = parseScenarioLines("添加机构 → 成功\n\n   \n　查看机构　→　一致\n");
    assert.equal(r.length, 2);
    assert.equal(r[1].goal, "查看机构");
    assert.equal(r[1].expected, "一致");
  });

  it("空输入返回空数组", () => {
    assert.deepEqual(parseScenarioLines(""), []);
    assert.deepEqual(parseScenarioLines("\n\n  \n"), []);
  });
});

describe("parseScenarioLines · 缺预期不臆造", () => {
  it("无分隔符 → 整行作验证目标并标记 missingExpected", () => {
    const r = parseScenarioLines("验证添加评估机构功能可用");
    assert.equal(r.length, 1);
    assert.equal(r[0].goal, "验证添加评估机构功能可用");
    assert.equal(r[0].expected, "");
    assert.equal(r[0].missingExpected, true);
  });

  it("分隔符一侧为空 → 同样按整行兜底，不产出半截场景", () => {
    const r = parseScenarioLines("添加机构 →");
    assert.equal(r.length, 1);
    assert.equal(r[0].missingExpected, true);
    assert.ok(r[0].goal.includes("添加机构"));
    assert.equal(r[0].expected, "");
  });

  it("分隔符在行首 → 整行作目标（不产生空 goal）", () => {
    const r = parseScenarioLines("：只写了预期");
    assert.equal(r.length, 1);
    assert.notEqual(r[0].goal, "");
    assert.equal(r[0].missingExpected, true);
  });
});

describe("scenariosToCases · 口径铁律", () => {
  const cases = scenarioTextToCases("添加机构 → 添加成功\n删除机构 → 列表不再显示");

  it("tags 恒为空数组（绝不入回归用例库 / 不触发发版红线）", () => {
    for (const c of cases) {
      // 先查具体标签再查长度：assert.deepEqual(x, []) 会把 x 窄化成 never[]，
      // 之后的 .includes(string) 过不了 typecheck。
      assert.ok(!c.tags.includes("回归测试"), "带「回归测试」会被 depositTask 收进回归用例库并触发发版红线");
      assert.ok(!c.tags.includes("冒烟测试"), "既有的「冒烟测试」标签是功能用例的人工标注，冒烟任务不打");
      assert.equal(c.tags.length, 0);
    }
  });

  it("verification 恒为「功能验证」（绝不能是回归基线，否则通过率变 N/A）", () => {
    for (const c of cases) {
      assert.equal(c.verification, "功能验证");
      assert.notEqual(c.verification, "回归基线");
    }
  });

  it("oracle 为「产品确认」——预期由用户录入，非代码反推的现状锁定", () => {
    for (const c of cases) {
      assert.equal(c.oracle, "产品确认");
      assert.notEqual(c.oracle, "现状锁定");
    }
  });

  it("id 按 SM- 前缀三位补零顺序编号", () => {
    assert.equal(cases[0].id, "SM-001");
    assert.equal(cases[1].id, "SM-002");
    assert.equal(smokeCaseId(0), "SM-001");
    assert.equal(smokeCaseId(9), "SM-010");
    assert.equal(smokeCaseId(998), "SM-999");
    assert.equal(smokeCaseId(999), "SM-1000");
  });

  it("purpose = 验证目标；steps 恰好一条且 expected = 预期结果", () => {
    assert.equal(cases[0].purpose, "添加机构");
    assert.equal(cases[0].steps.length, 1);
    assert.equal(cases[0].steps[0].expected, "添加成功");
  });

  it("steps[0].content 声明「无预设步骤、自主探索」，不写点击步骤", () => {
    assert.ok(cases[0].steps[0].content.includes("自主探索"));
    assert.ok(cases[0].steps[0].content.includes("添加机构"));
  });

  it("缺预期时给出显式兜底文案，不留空字符串让 AI 猜", () => {
    const [c] = scenarioTextToCases("验证机构管理可用");
    assert.notEqual(c.steps[0].expected, "");
    assert.ok(c.steps[0].expected.includes("验证机构管理可用"));
  });

  it("caseType/priority/assertion 为冒烟固定值", () => {
    assert.equal(cases[0].caseType, "冒烟");
    assert.equal(cases[0].priority, "P0");
    assert.equal(cases[0].assertion, "L2");
  });

  it("空场景 → 空用例数组", () => {
    assert.deepEqual(scenariosToCases([]), []);
    assert.deepEqual(scenarioTextToCases(""), []);
  });
});

describe("casesToScenarios · 反向回显（宽松读取，读坏不抛）", () => {
  it("从 cases 数组还原场景", () => {
    const cases = scenarioTextToCases("添加机构 → 添加成功");
    const back = casesToScenarios(cases);
    assert.equal(back.length, 1);
    assert.equal(back[0].goal, "添加机构");
    assert.equal(back[0].expected, "添加成功");
  });

  it("接受 {cases:[...]} 包裹形态（cases.json 磁盘结构）", () => {
    const cases = scenarioTextToCases("查看机构 → 一致");
    const back = casesToScenarios({ cases });
    assert.equal(back.length, 1);
    assert.equal(back[0].goal, "查看机构");
  });

  it("字段缺失 / 类型错乱一律跳过，不抛异常", () => {
    assert.deepEqual(casesToScenarios(null), []);
    assert.deepEqual(casesToScenarios(undefined), []);
    assert.deepEqual(casesToScenarios("不是数组"), []);
    assert.deepEqual(casesToScenarios([null, 42, "x", {}]), []);
    const partial = casesToScenarios([{ purpose: "只有目标" }]);
    assert.equal(partial.length, 1);
    assert.equal(partial[0].expected, "");
  });

  it("round-trip：文本 → 用例 → 场景 → 文本 保持一致", () => {
    const text = "添加机构 → 添加成功\n删除机构 → 列表不再显示";
    const round = scenariosToText(casesToScenarios(scenarioTextToCases(text)));
    assert.equal(round, text);
  });

  it("scenariosToText 对缺预期的场景只输出目标（不补假箭头）", () => {
    assert.equal(scenariosToText([{ goal: "只有目标", expected: "" }]), "只有目标");
  });
});

describe("smokeDataPrefix · 测试数据可识别前缀", () => {
  it("格式为 冒烟测试_YYYYMMDD_（本地日期，月日补零）", () => {
    assert.equal(smokeDataPrefix(new Date(2026, 6, 30)), "冒烟测试_20260730_");
    assert.equal(smokeDataPrefix(new Date(2026, 0, 5)), "冒烟测试_20260105_");
  });
});
