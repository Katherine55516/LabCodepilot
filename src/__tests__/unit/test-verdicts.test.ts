/**
 * 回归轮次 AI 失败归因(v2 二期):@@VERDICT 行的 harvest 容错、读写往返、prompt 构造。
 *
 * AI 输出是**不可信输入**——幻觉出来的分类、缺字段、非 JSON、混在正文里的行,都不能污染
 * verdicts.json 或让报告页崩掉。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-verdicts.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  harvestVerdicts,
  readVerdicts,
  writeVerdicts,
  verdictKey,
  verdictsFile,
  buildVerdictPrompt,
  VERDICT_CLASSES,
  type CaseVerdict,
  type FailureContext,
} from "../../lib/test/verdicts";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const V = (id: string, cls = "产品缺陷", act = "转缺陷", why = "断言失败") =>
  `@@VERDICT {"id":"${id}","cls":"${cls}","act":"${act}","why":"${why}"}`;

describe("harvestVerdicts — AI 输出解析容错", () => {
  it("提取合法行,忽略周围正文", () => {
    const text = `我先看一下失败用例。\n${V("TC-001")}\n分析中…\n${V("TC-002", "环境问题", "检查环境", "地址不可达")}\n共 2 条。`;
    const out = harvestVerdicts(text);
    assert.deepEqual(Object.keys(out).sort(), ["TC-001", "TC-002"]);
    assert.equal(out["TC-002"].cls, "环境问题");
  });

  it("分类不在四类枚举内 → 整条丢弃(不让模型自创分类进产物)", () => {
    const out = harvestVerdicts(`${V("TC-001", "玄学问题")}\n${V("TC-002")}`);
    assert.deepEqual(Object.keys(out), ["TC-002"]);
  });

  it("非 JSON / 半截 JSON → 跳过,不抛", () => {
    const out = harvestVerdicts(`@@VERDICT 不是json\n@@VERDICT {"id":"TC-001",\n${V("TC-003")}`);
    assert.deepEqual(Object.keys(out), ["TC-003"]);
  });

  it("缺 id 或 id 非字符串 → 丢弃", () => {
    const out = harvestVerdicts(`@@VERDICT {"cls":"产品缺陷","act":"a","why":"w"}\n@@VERDICT {"id":123,"cls":"产品缺陷","act":"a","why":"w"}\n${V("TC-001")}`);
    assert.deepEqual(Object.keys(out), ["TC-001"]);
  });

  it("缺 act/why → 补空串(分类是硬要求,措辞不是)", () => {
    const out = harvestVerdicts(`@@VERDICT {"id":"TC-001","cls":"疑似 flaky"}`);
    assert.equal(out["TC-001"].cls, "疑似 flaky");
    assert.equal(out["TC-001"].act, "");
    assert.equal(out["TC-001"].why, "");
  });

  it("同一 id 重复 → 后出现的覆盖先出现的", () => {
    const out = harvestVerdicts(`${V("TC-001", "环境问题")}\n${V("TC-001", "产品缺陷")}`);
    assert.equal(out["TC-001"].cls, "产品缺陷");
  });

  it("行首必须是 @@VERDICT(正文里提到的示例不会被误采)", () => {
    const out = harvestVerdicts(`格式示例：@@VERDICT {"id":"TC-999","cls":"产品缺陷","act":"a","why":"w"}`);
    assert.deepEqual(Object.keys(out), []);
  });

  it("空输入 / 无判定行 → 空对象", () => {
    assert.deepEqual(harvestVerdicts(""), {});
    assert.deepEqual(harvestVerdicts("模型什么都没说"), {});
  });

  it("四类分类全部可被接受", () => {
    const text = VERDICT_CLASSES.map((c, i) => V(`TC-00${i}`, c)).join("\n");
    assert.equal(Object.keys(harvestVerdicts(text)).length, VERDICT_CLASSES.length);
  });
});

describe("readVerdicts / writeVerdicts — 落盘往返", () => {
  const mk = (): Record<string, CaseVerdict> => ({
    [verdictKey("登录鉴权", "TC-004")]: { cls: "产品缺陷", act: "转缺陷跟踪", why: "连续 4 轮失败" },
  });

  it("写后可读回,键按 (来源任务, 原ID) 对齐", () => {
    fs.mkdirSync(path.dirname(verdictsFile(proj, "RND-1")), { recursive: true });
    writeVerdicts(proj, "RND-1", mk());
    const back = readVerdicts(proj, "RND-1");
    assert.equal(back?.[verdictKey("登录鉴权", "TC-004")].cls, "产品缺陷");
  });

  it("文件不存在 → null(报告页显示「待归因」)", () => {
    assert.equal(readVerdicts(proj, "RND-nope"), null);
  });

  it("坏 JSON → null,不抛", () => {
    const f = verdictsFile(proj, "RND-2");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "{ 坏");
    assert.equal(readVerdicts(proj, "RND-2"), null);
  });

  it("单条记录损坏 → 跳过该条,其余仍可用", () => {
    const f = verdictsFile(proj, "RND-3");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({
      version: 1, roundId: "RND-3", generatedAt: "t",
      verdicts: {
        good: { cls: "环境问题", act: "a", why: "w" },
        bad: { cls: "不存在的分类", act: "a", why: "w" },
        alsoBad: "not-an-object",
      },
    }));
    const back = readVerdicts(proj, "RND-3");
    assert.deepEqual(Object.keys(back ?? {}), ["good"]);
  });

  it("全部记录损坏 → null(而非空对象,便于 UI 区分「没归因」)", () => {
    const f = verdictsFile(proj, "RND-4");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ version: 1, roundId: "RND-4", generatedAt: "t", verdicts: { bad: { cls: "x" } } }));
    assert.equal(readVerdicts(proj, "RND-4"), null);
  });

  it("verdictKey 用 NUL 分隔(任务名含空格也不撞键)", () => {
    assert.notEqual(verdictKey("A B", "C"), verdictKey("A", "B C"));
  });
});

describe("buildVerdictPrompt — 事实注入", () => {
  const F = (over: Partial<FailureContext> = {}): FailureContext => ({
    runId: "TC-004", task: "登录鉴权", originalId: "TC-004", purpose: "会话超时跳转登录页",
    status: "fail", history: "pppffff", ...over,
  });

  it("带上跨轮历史(判 flaky/连败的唯一依据)与来源任务", () => {
    const p = buildVerdictPrompt("RND-1", [F()]);
    assert.match(p, /pppffff/);
    assert.match(p, /登录鉴权 · TC-004/);
    assert.match(p, /id=TC-004/);
  });

  it("有实际结果/错误/接口才注入用例块;缺省则该行不出现", () => {
    // 注意:「实际结果 / 错误 / 关键接口」这些词也出现在【判定原则】段落里,
    // 故断言必须锚定用例块的行前缀(三空格缩进 + 全角冒号),不能全文匹配。
    const p1 = buildVerdictPrompt("RND-1", [F({ actual: "停留原页", error: "401", api: { status: 401 } })]);
    assert.match(p1, /^ {3}实际结果：停留原页$/m);
    assert.match(p1, /^ {3}错误：401$/m);
    assert.match(p1, /^ {3}关键接口：\{"status":401\}$/m);

    const p2 = buildVerdictPrompt("RND-1", [F()]);
    assert.equal(/^ {3}实际结果：/m.test(p2), false);
    assert.equal(/^ {3}错误：/m.test(p2), false);
    assert.equal(/^ {3}关键接口：/m.test(p2), false);
  });

  it("要求逐条输出并自检条数;明令只读不写", () => {
    const p = buildVerdictPrompt("RND-1", [F(), F({ runId: "TC-002", originalId: "TC-002" })]);
    assert.match(p, /共 2 行/);
    assert.match(p, /自检行数是否等于 2/);
    assert.match(p, /只读不写/);
  });

  it("规则内联(不依赖 rules\\/\\*.md——打包态读不到)", () => {
    const p = buildVerdictPrompt("RND-1", [F()]);
    for (const c of VERDICT_CLASSES) assert.match(p, new RegExp(c.replace(/\s/g, "\\s")));
    assert.match(p, /不得自创/);
  });
});
