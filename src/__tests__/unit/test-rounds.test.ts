/**
 * 回归轮次数据层(v2 批 A):roundId 生成/冲突后缀、append/finish 读写往返、健壮解析、
 * 并发写丢更新保护(mutateRounds 重放)、惰性收口视图(normalizeStaleRounds)。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-rounds.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  roundsFile,
  roundDirRel,
  roundArtifactPaths,
  readRounds,
  mutateRounds,
  generateRoundId,
  appendRound,
  finishRound,
  normalizeStaleRounds,
  STALE_RUNNING_MS,
  type RegressionRound,
} from "../../lib/test/rounds";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "regrounds-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const R = (roundId: string, extra: Partial<RegressionRound> = {}): RegressionRound => ({
  roundId,
  startedAt: "2026-07-09T10:00:00.000Z",
  env: "local",
  suiteName: "全量",
  mode: "full",
  status: "running",
  total: 3,
  ...extra,
});

describe("generateRoundId", () => {
  it("格式 RND-YYYYMMDD-HHmm", () => {
    const id = generateRoundId(new Set(), new Date(2026, 6, 9, 10, 30));
    assert.equal(id, "RND-20260709-1030");
  });

  it("同分钟冲突 → 追加 -2/-3", () => {
    const now = new Date(2026, 6, 9, 10, 30);
    const existing = new Set(["RND-20260709-1030", "RND-20260709-1030-2"]);
    assert.equal(generateRoundId(existing, now), "RND-20260709-1030-3");
  });
});

describe("roundDirRel / roundArtifactPaths", () => {
  it("产物落 report/回归用例库/{roundId}/ 子目录", () => {
    assert.equal(roundDirRel("RND-1"), "AI_LabTest/report/回归用例库/RND-1");
    const p = roundArtifactPaths("RND-1", "staging");
    assert.equal(p.runJson, "AI_LabTest/report/回归用例库/RND-1/回归用例库-staging.run.json");
    assert.equal(p.report, "AI_LabTest/report/回归用例库/RND-1/回归用例库-staging.md");
    assert.equal(p.snapshot, "AI_LabTest/report/回归用例库/RND-1/cases.snapshot.json");
  });
});

describe("readRounds — 健壮读", () => {
  it("缺文件 → 空", () => {
    assert.deepEqual(readRounds(proj).rounds, []);
  });

  it("坏 JSON → 空(不抛)", () => {
    const f = roundsFile(proj);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "{ 坏");
    assert.deepEqual(readRounds(proj).rounds, []);
  });

  it("坏条目(缺 roundId / 非法 status)跳过,好条目保留", () => {
    const f = roundsFile(proj);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({
      version: 1,
      rounds: [
        R("RND-OK"),
        { startedAt: "t", status: "running" },            // 缺 roundId
        { roundId: "RND-BAD", status: "exploded" },        // 非法 status
        "not-an-object",
      ],
    }));
    const got = readRounds(proj).rounds;
    assert.equal(got.length, 1);
    assert.equal(got[0].roundId, "RND-OK");
  });
});

describe("appendRound / finishRound", () => {
  it("append → read 往返;重复 roundId 覆盖不重复", () => {
    appendRound(proj, R("RND-1"));
    appendRound(proj, R("RND-2", { env: "staging" }));
    appendRound(proj, R("RND-1", { total: 9 })); // 同 id 再 append = 覆盖
    const got = readRounds(proj).rounds;
    assert.equal(got.length, 2);
    assert.equal(got.find((r) => r.roundId === "RND-1")!.total, 9);
  });

  it("finishRound 置终态 + finishedAt + 摘要;不存在的轮 no-op 不抛", () => {
    appendRound(proj, R("RND-1"));
    finishRound(proj, "RND-1", { status: "done", counts: { pass: 2, fail: 1 }, suitePassStr: "2/3" });
    const r = readRounds(proj).rounds[0];
    assert.equal(r.status, "done");
    assert.ok(r.finishedAt);
    assert.equal(r.suitePassStr, "2/3");
    assert.deepEqual(r.counts, { pass: 2, fail: 1 });
    // 不存在 → no-op
    finishRound(proj, "RND-不存在", { status: "aborted" });
    assert.equal(readRounds(proj).rounds.length, 1);
  });
});

describe("mutateRounds — 并发写丢更新保护", () => {
  it("写前发现文件被并发修改 → 在最新内容上重放,两笔都保留", () => {
    appendRound(proj, R("RND-base"));
    // 会话 A 追加 RND-A;写盘前(_beforeWrite)会话 B 抢先落了 RND-B。
    mutateRounds(
      proj,
      (data) => { data.rounds = [...data.rounds.filter((r) => r.roundId !== "RND-A"), R("RND-A")]; },
      () => { appendRound(proj, R("RND-B")); },
    );
    const ids = readRounds(proj).rounds.map((r) => r.roundId).sort();
    assert.deepEqual(ids, ["RND-A", "RND-B", "RND-base"]);
  });
});

describe("normalizeStaleRounds — 惰性收口视图", () => {
  it("running 超时 → 视图 aborted;新鲜 running 保留;不改原数组", () => {
    const now = new Date("2026-07-09T12:00:00.000Z");
    const fresh = R("RND-fresh", { startedAt: new Date(now.getTime() - 60_000).toISOString() });
    const stale = R("RND-stale", { startedAt: new Date(now.getTime() - STALE_RUNNING_MS - 1).toISOString() });
    const badTs = R("RND-bad", { startedAt: "不是时间" });
    const done = R("RND-done", { status: "done" });
    const view = normalizeStaleRounds([fresh, stale, badTs, done], now);
    assert.equal(view.find((r) => r.roundId === "RND-fresh")!.status, "running");
    assert.equal(view.find((r) => r.roundId === "RND-stale")!.status, "aborted");
    assert.equal(view.find((r) => r.roundId === "RND-bad")!.status, "aborted");
    assert.equal(view.find((r) => r.roundId === "RND-done")!.status, "done");
    assert.equal(stale.status, "running"); // 原对象未被修改(视图不回写)
  });
});
