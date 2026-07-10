/**
 * 回归用例库 · 逐用例跨轮结果矩阵(v2 二/三期,读侧现算):矩阵拼装、产物缺损降级、
 * 缓存失效,以及与交互原型逐行等价的派生函数(flips / tailFails / lastRunIdx / health /
 * mergedStats)。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-case-history.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REGRESSION_TAG, depositTask, setQuarantine, type TestCase } from "../../lib/test/library";
import { appendRound, roundDirRel, roundArtifactPaths } from "../../lib/test/rounds";
import {
  buildCaseHistory,
  _clearCaseHistoryCache,
  execSeq,
  flips,
  tailFails,
  lastRunIdx,
  health,
  roundStats,
  mergedStats,
  type CaseRes,
  type CaseHistoryRow,
} from "../../lib/test/case-history";

let proj: string;
beforeEach(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), "casehist-"));
  _clearCaseHistoryCache();
});
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const C = (id: string): TestCase => ({ id, purpose: `用例${id}`, tags: [REGRESSION_TAG] });

/**
 * 造一轮:写 cases.snapshot.json(idMap)+ run.json(tests)。
 * `results` = { "任务|原ID": "pass"|"fail" };未列出的用例该轮视为未执行。
 */
function makeRound(roundId: string, startedAt: string, results: Record<string, string>, opts: { env?: string; skipSnapshot?: boolean; skipRun?: boolean } = {}) {
  const env = opts.env ?? "local";
  const dir = path.join(proj, roundDirRel(roundId));
  fs.mkdirSync(dir, { recursive: true });

  const idMap: Record<string, { task: string; originalId: string }> = {};
  const tests: Array<{ id: string; status: string }> = [];
  for (const [k, status] of Object.entries(results)) {
    const [task, originalId] = k.split("|");
    const runId = `${task}::${originalId}`;
    idMap[runId] = { task, originalId };
    tests.push({ id: runId, status });
  }
  if (!opts.skipSnapshot) {
    fs.writeFileSync(path.join(dir, "cases.snapshot.json"),
      JSON.stringify({ version: 1, roundId, suiteName: "全量", env, mode: "full", generatedAt: startedAt, total: tests.length, idMap, cases: [] }));
  }
  if (!opts.skipRun) {
    fs.writeFileSync(path.join(proj, roundArtifactPaths(roundId, env).runJson), JSON.stringify({ tests }));
  }
  appendRound(proj, { roundId, startedAt, env, suiteName: "全量", mode: "full", status: "done", total: tests.length });
}

describe("buildCaseHistory — 矩阵拼装", () => {
  it("列按 startedAt 升序(旧→新),行取库当前条目,res 与列同下标", () => {
    depositTask(proj, "登录", [C("TC-001"), C("TC-002")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "登录|TC-001": "pass", "登录|TC-002": "fail" });
    makeRound("RND-2", "2026-07-02T10:00:00Z", { "登录|TC-001": "pass", "登录|TC-002": "pass" });

    const h = buildCaseHistory(proj);
    assert.deepEqual(h.rounds.map((r) => r.roundId), ["RND-1", "RND-2"]);
    const byId = Object.fromEntries(h.cases.map((c) => [c.originalId, c.res]));
    assert.deepEqual(byId["TC-001"], ["p", "p"]);
    assert.deepEqual(byId["TC-002"], ["f", "p"]);
  });

  it("非 pass 的任何终态(partial/blocked)一律记 'f'", () => {
    depositTask(proj, "T", [C("TC-001"), C("TC-002")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "partial", "T|TC-002": "blocked" });
    const byId = Object.fromEntries(buildCaseHistory(proj).cases.map((c) => [c.originalId, c.res]));
    assert.deepEqual(byId["TC-001"], ["f"]);
    assert.deepEqual(byId["TC-002"], ["f"]);
  });

  it("该轮未入选的用例 → '-';从未执行的用例整行 '-'", () => {
    depositTask(proj, "T", [C("TC-001"), C("TC-002")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass" });
    const byId = Object.fromEntries(buildCaseHistory(proj).cases.map((c) => [c.originalId, c.res]));
    assert.deepEqual(byId["TC-001"], ["p"]);
    assert.deepEqual(byId["TC-002"], ["-"]);
  });

  it("快照缺失 / run.json 缺失 → 该列整列 '-'(诚实降级,不硬拼)", () => {
    depositTask(proj, "T", [C("TC-001")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass" }, { skipSnapshot: true });
    makeRound("RND-2", "2026-07-02T10:00:00Z", { "T|TC-001": "pass" }, { skipRun: true });
    makeRound("RND-3", "2026-07-03T10:00:00Z", { "T|TC-001": "fail" });
    assert.deepEqual(buildCaseHistory(proj).cases[0].res, ["-", "-", "f"]);
  });

  it("已从库移除的用例不出现在矩阵里(库是行集合的真相源)", () => {
    depositTask(proj, "T", [C("TC-001"), C("TC-002")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass", "T|TC-002": "pass" });
    depositTask(proj, "T", [C("TC-001")]); // TC-002 掉标签 → 移出库
    const h = buildCaseHistory(proj);
    assert.deepEqual(h.cases.map((c) => c.originalId), ["TC-001"]);
  });

  it("limit 只取最近 N 轮", () => {
    depositTask(proj, "T", [C("TC-001")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass" });
    makeRound("RND-2", "2026-07-02T10:00:00Z", { "T|TC-001": "fail" });
    makeRound("RND-3", "2026-07-03T10:00:00Z", { "T|TC-001": "pass" });
    const h = buildCaseHistory(proj, { limit: 2 });
    assert.deepEqual(h.rounds.map((r) => r.roundId), ["RND-2", "RND-3"]);
    assert.deepEqual(h.cases[0].res, ["f", "p"]);
  });

  it("行携带 _lib 元数据(健康度徽标要用)", () => {
    depositTask(proj, "T", [C("TC-001")]);
    setQuarantine(proj, [{ task: "T", originalId: "TC-001" }], true, "不稳定");
    const row = buildCaseHistory(proj).cases[0];
    assert.equal(row.meta.quarantined, true);
    assert.equal(row.meta.reviewState, "pending");
  });

  it("空库 / 无轮次 → 空矩阵,不抛", () => {
    const h = buildCaseHistory(proj);
    assert.deepEqual(h.rounds, []);
    assert.deepEqual(h.cases, []);
  });
});

describe("buildCaseHistory — 进程内缓存", () => {
  it("轮次索引 seq 变化 → 缓存失效,新轮出现", () => {
    depositTask(proj, "T", [C("TC-001")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass" });
    assert.equal(buildCaseHistory(proj).rounds.length, 1);

    makeRound("RND-2", "2026-07-02T10:00:00Z", { "T|TC-001": "fail" });
    assert.equal(buildCaseHistory(proj).rounds.length, 2, "appendRound 会 bump seq,缓存必须失效");
  });

  it("库 seq 变化 → 缓存失效,新用例出现(同毫秒写入也必须区分开)", () => {
    depositTask(proj, "T", [C("TC-001")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass" });
    assert.equal(buildCaseHistory(proj).cases.length, 1);

    depositTask(proj, "T2", [C("TC-009")]);
    assert.equal(buildCaseHistory(proj).cases.length, 2);
  });

  it("无变化时命中缓存,返回同一对象引用", () => {
    depositTask(proj, "T", [C("TC-001")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass" });
    assert.equal(buildCaseHistory(proj), buildCaseHistory(proj));
  });

  it("不同 limit 各自建键,互不污染", () => {
    depositTask(proj, "T", [C("TC-001")]);
    makeRound("RND-1", "2026-07-01T10:00:00Z", { "T|TC-001": "pass" });
    makeRound("RND-2", "2026-07-02T10:00:00Z", { "T|TC-001": "fail" });
    assert.equal(buildCaseHistory(proj, { limit: 1 }).rounds.length, 1);
    assert.equal(buildCaseHistory(proj, { limit: 9 }).rounds.length, 2);
  });
});

describe("派生函数 — 与交互原型逐行等价", () => {
  const R = (s: string): CaseRes[] => [...s] as CaseRes[];

  it("execSeq 去掉未执行的空洞", () => {
    assert.deepEqual(execSeq(R("p-f-p")), ["p", "f", "p"]);
  });

  it("flips 只在真正跑过的轮之间计翻转", () => {
    assert.equal(flips(R("ppp")), 0);
    assert.equal(flips(R("pfp")), 2);
    assert.equal(flips(R("p--f")), 1, "空洞不制造翻转");
    assert.equal(flips(R("----")), 0);
  });

  it("tailFails 数执行序列尾部连续失败", () => {
    assert.equal(tailFails(R("pff")), 2);
    assert.equal(tailFails(R("ffp")), 0);
    assert.equal(tailFails(R("f-f-f")), 3, "空洞不打断连败");
    assert.equal(tailFails(R("---")), 0);
  });

  it("lastRunIdx 返回最后一个被执行的轮下标", () => {
    assert.equal(lastRunIdx(R("p--")), 0);
    assert.equal(lastRunIdx(R("--f")), 2);
    assert.equal(lastRunIdx(R("---")), -1);
  });

  it("health 判定优先级:隔离 > 连败 > flaky > 从未执行 > 久未执行 > 健康", () => {
    assert.equal(health(R("pp"), true), "quar", "隔离压倒一切");
    assert.equal(health(R("fff"), false), "streak");
    assert.equal(health(R("fpfff"), false), "streak", "连败优先于 flaky(翻转也满足时)");
    assert.equal(health(R("pfp"), false), "flaky");
    assert.equal(health(R("---"), false), "never");
    assert.equal(health(R("-p---"), false), "stale", "距最新轮 3 轮没跑到");
    assert.equal(health(R("-p--"), false), "ok", "只隔 2 轮 → 还不算久未执行");
    assert.equal(health(R("pp"), false), "ok");
  });

  it("health 阈值边界:连败 3 轮起,翻转 2 次起", () => {
    assert.equal(health(R("pff"), false), "ok", "连败 2 轮 + 翻转 1 次 → 都不触发");
    assert.equal(health(R("pfff"), false), "streak");
    assert.equal(health(R("pf"), false), "ok", "翻转 1 次");
    assert.equal(health(R("pfp"), false), "flaky", "翻转 2 次");
  });
});

describe("roundStats — 单轮口径", () => {
  const row = (originalId: string, res: string, quarantined = false): CaseHistoryRow => ({
    task: "T", originalId, purpose: "", priority: "", module: "",
    meta: { reviewState: "approved", rev: 1, history: [], quarantined },
    res: [...res] as CaseRes[],
  });

  it("只统计该轮跑到的用例;未执行不计入 total", () => {
    const cases = [row("TC-001", "pf"), row("TC-002", "-p"), row("TC-003", "f-")];
    assert.deepEqual(roundStats(cases, 0), { pass: 1, fail: 1, total: 2 });
    assert.deepEqual(roundStats(cases, 1), { pass: 1, fail: 1, total: 2 });
  });

  it("与 mergedStats 相反:单轮口径【不】排除隔离条目(趋势线要反映真实执行)", () => {
    const cases = [row("TC-001", "p"), row("TC-002", "f", true)];
    assert.deepEqual(roundStats(cases, 0), { pass: 1, fail: 1, total: 2 });
    assert.deepEqual(mergedStats(cases, 0), { pass: 1, fail: 0, total: 1 });
  });

  it("越界下标 → 全零,不抛", () => {
    assert.deepEqual(roundStats([row("TC-001", "p")], 5), { pass: 0, fail: 0, total: 0 });
  });
});

describe("mergedStats — 合并口径(复测轮红线)", () => {
  const row = (originalId: string, res: string, quarantined = false): CaseHistoryRow => ({
    task: "T", originalId, purpose: "", priority: "", module: "",
    meta: { reviewState: "approved", rev: 1, history: [], quarantined },
    res: [...res] as CaseRes[],
  });

  it("每条用例取截至该轮的最新结果,而非只看该轮", () => {
    // 第 2 轮只复测了 TC-002(修复),TC-001 上轮通过、本轮未跑 → 合并后仍算通过。
    const cases = [row("TC-001", "p-"), row("TC-002", "fp")];
    assert.deepEqual(mergedStats(cases, 1), { pass: 2, fail: 0, total: 2 });
  });

  it("防「2/2 通过 = 可发版」误判:合并后仍有未修复的失败", () => {
    const cases = [row("TC-001", "f-"), row("TC-002", "fp")];
    assert.deepEqual(mergedStats(cases, 1), { pass: 1, fail: 1, total: 2 });
  });

  it("uptoIdx 之后的轮不参与(历史轮的合并态可回溯)", () => {
    const cases = [row("TC-001", "fp")];
    assert.deepEqual(mergedStats(cases, 0), { pass: 0, fail: 1, total: 1 });
    assert.deepEqual(mergedStats(cases, 1), { pass: 1, fail: 0, total: 1 });
  });

  it("隔离条目不计入(不影响红线)", () => {
    const cases = [row("TC-001", "p"), row("TC-002", "f", true)];
    assert.deepEqual(mergedStats(cases, 0), { pass: 1, fail: 0, total: 1 });
  });

  it("从未执行的用例不计入 total", () => {
    const cases = [row("TC-001", "p"), row("TC-002", "-")];
    assert.deepEqual(mergedStats(cases, 0), { pass: 1, fail: 0, total: 1 });
  });
});
