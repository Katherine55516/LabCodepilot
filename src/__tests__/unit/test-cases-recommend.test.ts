/**
 * 存量用例 AI 推荐回归集:harvestRecommend(@@RECOMMEND 行协议)+ applyRecommend
 * (只动 tags 里「回归测试」的精确 merge,其余字段与文件结构原样)。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-cases-recommend.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harvestRecommend, applyRecommend } from "../../app/api/test/cases/recommend/route";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "recommend-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("harvestRecommend", () => {
  it("extracts @@RECOMMEND lines, ignoring prose and malformed lines", () => {
    const text = [
      "正在分析用例……",
      '@@RECOMMEND {"id":"TC-001","suite":true,"reason":"登录主流程"}',
      "@@RECOMMEND {坏行}",
      '@@RECOMMEND {"id":"TC-002","suite":false,"reason":"纯文案提示"}',
      '@@RECOMMEND {"id":"TC-003","suite":"yes"}', // suite 非 boolean → 丢弃
    ].join("\n");
    const rec = harvestRecommend(text);
    assert.equal(rec.size, 2);
    assert.equal(rec.get("TC-001"), true);
    assert.equal(rec.get("TC-002"), false);
  });
});

describe("applyRecommend", () => {
  const write = (obj: unknown) => {
    const f = path.join(dir, "t.cases.json");
    fs.writeFileSync(f, JSON.stringify(obj, null, 2));
    return f;
  };

  it("只增删「回归测试」标签,其余字段与已有标签原样保留", () => {
    const f = write({
      cases: [
        { id: "TC-001", purpose: "登录", oracle: "PRD", verification: "功能验证", tags: ["冒烟测试"] },
        { id: "TC-002", purpose: "文案", tags: ["冒烟测试", "回归测试"] },
        { id: "TC-003", purpose: "改昵称" },
      ],
    });
    const s = applyRecommend(f, new Map([["TC-001", true], ["TC-002", false], ["TC-003", false]]));
    assert.deepEqual(s, { changed: 2, total: 3, suiteTotal: 1 });
    const saved = JSON.parse(fs.readFileSync(f, "utf-8"));
    assert.deepEqual(saved.cases[0].tags, ["冒烟测试", "回归测试"]); // 追加不覆盖
    assert.equal(saved.cases[0].oracle, "PRD"); // 其余字段无损
    assert.equal(saved.cases[0].verification, "功能验证");
    assert.deepEqual(saved.cases[1].tags, ["冒烟测试"]); // 移除「回归测试」保留其它标签
    assert.equal(saved.cases[2].tags, undefined); // false 且本无标签 → 不写字段
  });

  it("AI 漏判/编造的 id 不影响未提及用例;已有回归标签计入 suiteTotal", () => {
    const f = write({ cases: [{ id: "A", tags: ["回归测试"] }, { id: "B" }] });
    const s = applyRecommend(f, new Map([["GHOST", true]])); // 编造 id → 无匹配
    assert.deepEqual(s, { changed: 0, total: 2, suiteTotal: 1 }); // A 未提及但已有标签计入
    const saved = JSON.parse(fs.readFileSync(f, "utf-8"));
    assert.deepEqual(saved.cases[0].tags, ["回归测试"]);
    assert.ok(!saved.cases.some((c: { id?: string }) => c.id === "GHOST")); // 不新增用例
  });

  it("顶层数组格式的 cases.json 保持数组结构写回", () => {
    const f = write([{ id: "A" }]);
    applyRecommend(f, new Map([["A", true]]));
    const saved = JSON.parse(fs.readFileSync(f, "utf-8"));
    assert.ok(Array.isArray(saved)); // 不被改写成 {cases:[...]}
    assert.deepEqual(saved[0].tags, ["回归测试"]);
  });
});
