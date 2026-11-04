/**
 * Unit tests for 冒烟体验观察的归约 (`@@OBSERVATION` → run.json.observations).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-smoke-observations.test.ts
 *
 * 关键不变量：
 *  1. **与四态完全正交** —— 观察不影响任何计数、不改任何用例状态、不产生 Bug。
 *     一条观察让 pass 变 fail 就是灾难性回归（用户会看到功能正常的场景被判失败）。
 *  2. **向后兼容** —— 功能/回归执行流没有该标记 → 字段缺省（不是空数组），旧 run.json
 *     消费方与既有断言零感知。
 *  3. **防膨胀** —— 健谈模型不能把 run.json 撑爆（单条截断 + 总条数封顶）。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { harvestObservations, reduceFromText, reduceResults } from "../../lib/test/reduce";

const OPTS = { module: "评估机构-冒烟", env: "sit", time: "2026-07-30T06:32:00.000Z" };

describe("harvestObservations", () => {
  it("收割合法的 @@OBSERVATION 行（含/不含 scene）", () => {
    const text = [
      '@@OBSERVATION {"text":"状态切换约 4s 才更新，期间无 loading","scene":"SM-004"}',
      "一些普通输出",
      '@@OBSERVATION {"text":"保存后无成功提示"}',
    ].join("\n");
    const obs = harvestObservations(text);
    assert.equal(obs.length, 2);
    assert.deepEqual(obs[0], { text: "状态切换约 4s 才更新，期间无 loading", scene: "SM-004" });
    assert.deepEqual(obs[1], { text: "保存后无成功提示" });
  });

  it("无标记 → 空数组（功能/回归执行流的常态）", () => {
    assert.deepEqual(harvestObservations(""), []);
    assert.deepEqual(harvestObservations('@@RESULT {"id":"TC-001","status":"pass"}'), []);
  });

  it("丢弃无文本 / 空文本 / 非对象的条目", () => {
    const text = [
      '@@OBSERVATION {"scene":"SM-001"}',
      '@@OBSERVATION {"text":"   "}',
      '@@OBSERVATION {"text":"有效观察"}',
    ].join("\n");
    const obs = harvestObservations(text);
    assert.equal(obs.length, 1);
    assert.equal(obs[0].text, "有效观察");
  });

  it("JSON 非法时静默跳过（观察丢一条不影响任何判定，故不告警不抛）", () => {
    const text = ['@@OBSERVATION {不是合法json}', '@@OBSERVATION {"text":"有效"}'].join("\n");
    assert.doesNotThrow(() => harvestObservations(text));
    assert.equal(harvestObservations(text).length, 1);
  });

  it("空白 scene 归一为缺省字段，不写空串", () => {
    const obs = harvestObservations('@@OBSERVATION {"text":"x","scene":"  "}');
    assert.equal(obs[0].scene, undefined);
    assert.equal("scene" in obs[0], false);
  });

  it("单条文本超长截断（防 run.json 膨胀）", () => {
    const long = "很长".repeat(400); // 800 字符
    const obs = harvestObservations(`@@OBSERVATION {"text":"${long}"}`);
    assert.ok(obs[0].text.length <= 501);
    assert.ok(obs[0].text.endsWith("…"));
  });

  it("总条数封顶 50", () => {
    const many = Array.from({ length: 80 }, (_, i) => `@@OBSERVATION {"text":"观察${i}"}`).join("\n");
    assert.equal(harvestObservations(many).length, 50);
  });
});

describe("run.json.observations · 与四态正交", () => {
  const text = [
    '@@RESULT {"id":"SM-001","status":"pass","actual":"添加成功"}',
    '@@OBSERVATION {"text":"保存后无成功提示","scene":"SM-001"}',
    '@@RESULT {"id":"SM-002","status":"fail","error":"查询返回空列表"}',
    '@@OBSERVATION {"text":"状态切换响应慢","scene":"SM-002"}',
  ].join("\n");

  it("观察不改变任何四态计数", () => {
    const withObs = reduceFromText(text, OPTS);
    const withoutObs = reduceFromText(
      text.split("\n").filter((l) => !l.startsWith("@@OBSERVATION")).join("\n"),
      OPTS,
    );
    assert.deepEqual(withObs.counts, withoutObs.counts);
    assert.equal(withObs.passStr, withoutObs.passStr);
    assert.equal(withObs.status, withoutObs.status);
    assert.deepEqual(withObs.funcCounts, withoutObs.funcCounts);
  });

  it("观察不改变任何用例的状态", () => {
    const r = reduceFromText(text, OPTS);
    const byId = Object.fromEntries(r.tests.map((t) => [t.id, t.status]));
    assert.equal(byId["SM-001"], "pass", "带观察的 pass 场景必须仍是 pass");
    assert.equal(byId["SM-002"], "fail");
  });

  it("观察被收进 run.json.observations", () => {
    const r = reduceFromText(text, OPTS);
    assert.equal(r.observations?.length, 2);
    assert.equal(r.observations?.[0].scene, "SM-001");
  });
});

describe("向后兼容", () => {
  it("无观察时 observations 字段【缺省】而非空数组（旧消费方零感知）", () => {
    const r = reduceFromText('@@RESULT {"id":"TC-001","status":"pass"}', OPTS);
    assert.equal("observations" in r, false);
    assert.equal(r.observations, undefined);
  });

  it("reduceResults 不传 observations 时同样缺省", () => {
    const r = reduceResults([{ id: "TC-001", status: "pass" }], OPTS);
    assert.equal("observations" in r, false);
  });

  it("reduceResults 显式传空数组也缺省（不写噪音字段）", () => {
    const r = reduceResults([{ id: "TC-001", status: "pass" }], { ...OPTS, observations: [] });
    assert.equal("observations" in r, false);
  });

  it("功能测试的执行文本（无该标记）产出的 run.json 与加此特性前一致", () => {
    const funcText = [
      '@@RESULT {"id":"TC-001","status":"pass","actual":"ok"}',
      '@@RESULT {"id":"TC-002","status":"fail","error":"boom"}',
    ].join("\n");
    const r = reduceFromText(funcText, OPTS);
    assert.equal(r.counts.total, 2);
    assert.equal(r.counts.pass, 1);
    assert.equal(r.counts.fail, 1);
    assert.equal(r.observations, undefined);
  });
});
