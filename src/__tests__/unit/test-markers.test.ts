/**
 * AI 机器标记行解析(markers.ts)。
 *
 * 回归背景(2026-07-10 线上):模型把 `@@RESULT` 行整行加粗成 `**@@RESULT {...}**`,
 * 旧解析器「slice 到行尾 + JSON.parse」全部抛异常并静默丢弃 → 3 条用例的真实判定
 * (2 pass / 1 fail)被 caseIds 兜底覆写成 0/3 全 blocked。本文件用**当时的真实输出**
 * 作夹具,钉死不再复现。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-markers.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { harvestMarkers, harvestMarkerObjects, isProgressLine, stripLineDecoration } from "../../lib/test/markers";
import { harvestResults } from "../../lib/test/reduce";
import { harvestVerdicts } from "../../lib/test/verdicts";
import { harvestRecommend } from "../../lib/test/recommend";
import { createCaseTimer } from "../../lib/test/exec-timing";

/** 2026-07-10 线上执行步的真实 assistant 文本(节选,原样保留加粗与诱饵行)。 */
const REAL_OUTPUT = [
  '**@@CASE_START {"id":"TC-employee-001","index":1}**',
  "▶ 用例 1/3：进入员工信息页默认加载全量列表（不填条件直接查询）",
  '**@@RESULT {"id":"TC-employee-001","status":"pass","actual":"页面渲染完成","evidence":["TC-employee-001.png"],"error":""}**',
  '**@@CASE_START {"id":"TC-employee-002","index":2}**',
  "▶ 用例 2/3：新增一名在职员工，新数据出现在列表顶部 [CRUD链路-1，serial]",
  '**@@RESULT {"id":"TC-employee-002","status":"fail","actual":"Modal「新增员工」正常弹出","evidence":["TC-employee-002.png","TC-employee-002.webm"],"error":"列表未刷新","api":{"method":"POST","url":"/api/v1/employee","status":200}}**',
  '**@@CASE_START {"id":"TC-employee-034","index":3}**',
  "▶ 用例 3/3：无查询条件时点「导出」下载全量数据 xlsx",
  '**@@RESULT {"id":"TC-employee-034","status":"pass","actual":"响应 200","evidence":["TC-employee-034.png"],"error":""}**',
  "",
  "| 已输出 @@RESULT 行数 | 3 |",
  "**覆盖自检**：3 条用例全部执行完毕，3 行 @@RESULT 均已输出，无遗漏。",
].join("\n");

describe("markers — 线上真实输出回归夹具", () => {
  it("加粗包裹的 @@RESULT 全部被正确收割(旧实现在此丢 3 条)", () => {
    const res = harvestResults(REAL_OUTPUT);
    assert.equal(res.length, 3);
    assert.deepEqual(res.map((r) => [r.id, r.status]), [
      ["TC-employee-001", "pass"],
      ["TC-employee-002", "fail"],
      ["TC-employee-034", "pass"],
    ]);
  });

  it("嵌套对象(api)与中文引号不打乱大括号配对", () => {
    const r = harvestResults(REAL_OUTPUT)[1];
    assert.equal(r.api?.status, 200);
    assert.equal(r.api?.url, "/api/v1/employee");
    assert.match(String(r.actual), /「新增员工」/);
  });

  it("正文里提到标记名但不带 JSON 的行不被误采", () => {
    const { items, malformed } = harvestMarkers(REAL_OUTPUT, "RESULT");
    assert.equal(items.length, 3);
    assert.equal(malformed, 0, "「| 已输出 @@RESULT 行数 | 3 |」等诱饵行应被跳过而非计为坏行");
  });

  it("加粗的 @@CASE_START 也能取到 id(与 script-trace 口径一致)", () => {
    const ids = harvestMarkerObjects<{ id: string }>(REAL_OUTPUT, "CASE_START").map((o) => o.id);
    assert.deepEqual(ids, ["TC-employee-001", "TC-employee-002", "TC-employee-034"]);
  });

  it("逐用例耗时仍能挂上(exec-timing 与 reduce 同键)", () => {
    const timer = createCaseTimer();
    let t = 1000;
    for (const line of REAL_OUTPUT.split("\n")) {
      timer.feedText(line + "\n", (t += 500));
    }
    const d = timer.finish(t);
    assert.ok(d["TC-employee-001"] > 0, "加粗的 @@RESULT 也要能被计时器识别");
    assert.ok(d["TC-employee-002"] > 0);
  });
});

describe("harvestMarkers — 模型输出的各种装饰", () => {
  const R = (line: string) => harvestMarkerObjects<{ id?: string }>(line, "RESULT");

  it("裸写", () => assert.equal(R('@@RESULT {"id":"A"}')[0].id, "A"));
  it("加粗", () => assert.equal(R('**@@RESULT {"id":"A"}**')[0].id, "A"));
  it("行内代码", () => assert.equal(R('`@@RESULT {"id":"A"}`')[0].id, "A"));
  it("列表项前缀", () => assert.equal(R('- @@RESULT {"id":"A"}')[0].id, "A"));
  it("JSON 后补文字", () => assert.equal(R('@@RESULT {"id":"A"} ✅ 完成')[0].id, "A"));
  it("行首缩进", () => assert.equal(R('    @@RESULT {"id":"A"}')[0].id, "A"));

  it("字符串里的大括号与引号不打乱配对", () => {
    const o = harvestMarkerObjects<{ id: string; actual: string }>(
      '@@RESULT {"id":"A","actual":"响应体 {\\"code\\":0} 且含 } 字符"}',
      "RESULT",
    )[0];
    assert.equal(o.id, "A");
    assert.match(o.actual, /\{"code":0\}/);
  });

  it("JSON 后跟另一个对象 → 只取第一个(契约是一行一条)", () => {
    const items = harvestMarkerObjects<{ id: string }>('@@RESULT {"id":"A"} {"id":"B"}', "RESULT");
    assert.deepEqual(items.map((x) => x.id), ["A"]);
  });

  it("括号未闭合(被截断) → 跳过并计入 malformed? 不:无法配对视为非判定行", () => {
    const { items, malformed } = harvestMarkers('@@RESULT {"id":"A"', "RESULT");
    assert.deepEqual(items, []);
    assert.equal(malformed, 0);
  });

  it("配对成功但 JSON 非法 → 计入 malformed(不再静默吞掉)", () => {
    const { items, malformed } = harvestMarkers("@@RESULT {id: A}", "RESULT");
    assert.deepEqual(items, []);
    assert.equal(malformed, 1);
  });

  it("标记不在行首也采(既有契约:宁可多采不可漏采;下游按 id 白名单过滤)", () => {
    assert.equal(harvestMarkerObjects<{ id: string }>('prefix @@RESULT {"id":"TC-9"}', "RESULT")[0].id, "TC-9");
  });

  it("表格/正文里出现标记名但无 JSON → 不被误采且不计 malformed", () => {
    const { items, malformed } = harvestMarkers("| 已输出 @@RESULT 行数 | 3 |", "RESULT");
    assert.deepEqual(items, []);
    assert.equal(malformed, 0);
  });

  it("无标记 / 空文本 → 空结果", () => {
    assert.deepEqual(harvestMarkerObjects("", "RESULT"), []);
    assert.deepEqual(harvestMarkerObjects("模型什么都没说", "RESULT"), []);
  });

  it("不同标记互不串台", () => {
    const text = '@@RESULT {"id":"A"}\n@@VERDICT {"id":"B","cls":"产品缺陷","act":"x","why":"y"}';
    assert.equal(harvestMarkerObjects<{ id: string }>(text, "RESULT")[0].id, "A");
    assert.equal(harvestMarkerObjects<{ id: string }>(text, "VERDICT")[0].id, "B");
  });
});

describe("其余 harvester 同样吃得下装饰", () => {
  it("@@VERDICT 加粗(旧实现 ^@@VERDICT 锚定,一加粗全空)", () => {
    const out = harvestVerdicts('**@@VERDICT {"id":"TC-1","cls":"产品缺陷","act":"转缺陷","why":"连败 4 轮"}**');
    assert.equal(out["TC-1"].cls, "产品缺陷");
  });

  it("@@RECOMMEND 加粗 + 尾随文字", () => {
    const m = harvestRecommend('`@@RECOMMEND {"id":"TC-1","suite":true,"reason":"登录主链路"}` ← 建议');
    assert.equal(m.get("TC-1"), true);
  });
});

describe("进度行识别", () => {
  it("裸写与加粗都算进度行", () => {
    assert.equal(isProgressLine("▶ 用例 1/3：登录"), true);
    assert.equal(isProgressLine("**▶ 用例 1/3：登录**"), true);
    assert.equal(isProgressLine("  ▶ 用例 1/3：登录"), true);
  });
  it("普通文本不算", () => {
    assert.equal(isProgressLine("开始执行 3 条用例"), false);
  });
  it("stripLineDecoration 剥掉强调与列表符号", () => {
    assert.equal(stripLineDecoration("- **abc**"), "abc");
    assert.equal(stripLineDecoration("`abc`"), "abc");
  });
});
