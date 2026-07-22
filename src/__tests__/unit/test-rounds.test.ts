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
  roundAliveFile,
  touchRoundAlive,
  createRoundKeeper,
  reapOrphanRounds,
  STALE_RUNNING_MS,
  ROUND_HEARTBEAT_STALE_MS,
  ROUND_START_GRACE_MS,
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

// 真机事故:执行中途页面刷新 → 前端 settle('aborted') 永远不会到达 → 轮次卡「执行中」
// 近 2 小时(mealAllowance / RND-20260722-1450:目录里只有 cases.snapshot.json,无任何
// 执行产物)。三层收口的新增两层在此锁定:①服务端 keeper ②心跳判活 + 孤儿回写。
describe("finishRound — ifRunning 终态保护", () => {
  it("ifRunning:running → aborted 生效;已 done 的轮不被晚到的 aborted 降级", () => {
    appendRound(proj, R("RND-1"));
    finishRound(proj, "RND-1", { status: "aborted", ifRunning: true });
    assert.equal(readRounds(proj).rounds[0].status, "aborted");

    appendRound(proj, R("RND-2"));
    finishRound(proj, "RND-2", { status: "done", suitePassStr: "3/3" });
    finishRound(proj, "RND-2", { status: "aborted", ifRunning: true }); // 流末端竞态的晚到 settle
    const r2 = readRounds(proj).rounds.find((r) => r.roundId === "RND-2")!;
    assert.equal(r2.status, "done", "终态不得被 ifRunning 的 aborted 降级");
    assert.equal(r2.suitePassStr, "3/3");
  });

  it("不带 ifRunning 的收口保持旧语义(可覆盖终态,PATCH done 的回填路径依赖它)", () => {
    appendRound(proj, R("RND-1"));
    finishRound(proj, "RND-1", { status: "aborted" });
    finishRound(proj, "RND-1", { status: "done", suitePassStr: "1/1" });
    assert.equal(readRounds(proj).rounds[0].status, "done");
  });

  it("收口清掉 .alive 心跳文件", () => {
    appendRound(proj, R("RND-1"));
    touchRoundAlive(proj, "RND-1");
    assert.ok(fs.existsSync(roundAliveFile(proj, "RND-1")));
    finishRound(proj, "RND-1", { status: "done" });
    assert.ok(!fs.existsSync(roundAliveFile(proj, "RND-1")), "终态轮不该残留活性信号");
  });
});

describe("createRoundKeeper — 服务端收口守护(层①)", () => {
  it("创建即写第一拍心跳;settleDone 落终态+摘要并清心跳", () => {
    appendRound(proj, R("RND-1"));
    const keeper = createRoundKeeper(proj, "RND-1");
    assert.ok(fs.existsSync(roundAliveFile(proj, "RND-1")), "第一拍心跳在创建时同步写入");
    keeper.settleDone({ counts: { total: 2, pass: 2, fail: 0, partial: 0, blocked: 0 }, suitePassStr: "2/2" });
    const r = readRounds(proj).rounds[0];
    assert.equal(r.status, "done");
    assert.equal(r.suitePassStr, "2/2");
    assert.ok(!fs.existsSync(roundAliveFile(proj, "RND-1")));
  });

  it("settle 幂等:先到先得,晚到的 settleAborted 不覆盖 settleDone", () => {
    appendRound(proj, R("RND-1"));
    const keeper = createRoundKeeper(proj, "RND-1");
    keeper.settleDone({ suitePassStr: "1/1" });
    keeper.settleAborted(); // cancel 回调可能在 done 之后仍被触发
    assert.equal(readRounds(proj).rounds[0].status, "done");
  });

  it("settleAborted 只中断仍 running 的轮(带 ifRunning 语义)", () => {
    appendRound(proj, R("RND-1"));
    const keeper = createRoundKeeper(proj, "RND-1");
    keeper.settleAborted();
    assert.equal(readRounds(proj).rounds[0].status, "aborted");
  });
});

describe("reapOrphanRounds — 心跳判活 + 孤儿回写(层②)", () => {
  const past = (ms: number, now: Date) => new Date(now.getTime() - ms).toISOString();

  it("心跳新鲜 → 真在跑,不动;心跳陈旧 → 回写 aborted", () => {
    const now = new Date();
    appendRound(proj, R("RND-alive", { startedAt: past(600_000, now) }));
    appendRound(proj, R("RND-dead", { startedAt: past(600_000, now) }));
    touchRoundAlive(proj, "RND-alive"); // mtime = 现在,新鲜
    touchRoundAlive(proj, "RND-dead");
    const staleAt = now.getTime() - ROUND_HEARTBEAT_STALE_MS - 1_000;
    fs.utimesSync(roundAliveFile(proj, "RND-dead"), staleAt / 1000, staleAt / 1000);

    reapOrphanRounds(proj, now);
    const got = readRounds(proj).rounds;
    assert.equal(got.find((r) => r.roundId === "RND-alive")!.status, "running");
    const dead = got.find((r) => r.roundId === "RND-dead")!;
    assert.equal(dead.status, "aborted", "心跳陈旧 = 执行流已死,回写落盘");
    assert.ok(dead.finishedAt);
  });

  it("无心跳:启动宽限内不动(发起与执行是两次请求);过宽限 → 孤儿", () => {
    const now = new Date();
    appendRound(proj, R("RND-young", { startedAt: past(ROUND_START_GRACE_MS - 60_000, now) }));
    appendRound(proj, R("RND-orphan", { startedAt: past(ROUND_START_GRACE_MS + 60_000, now) }));
    reapOrphanRounds(proj, now);
    const got = readRounds(proj).rounds;
    assert.equal(got.find((r) => r.roundId === "RND-young")!.status, "running", "启动窗口不误杀");
    assert.equal(got.find((r) => r.roundId === "RND-orphan")!.status, "aborted");
  });

  it("真机事故存量自愈:执行中途死亡留下的 running(只有快照、无心跳)→ 首次列表即中断", () => {
    // 复刻 RND-20260722-1450 的磁盘形态:轮次 running、产物目录只有 cases.snapshot.json
    const now = new Date();
    appendRound(proj, R("RND-20260722-1450", { startedAt: past(20 * 60_000, now), total: 14 }));
    const dir = path.join(proj, roundDirRel("RND-20260722-1450"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "cases.snapshot.json"), "{}");
    const view = reapOrphanRounds(proj, now);
    assert.equal(view.find((r) => r.roundId === "RND-20260722-1450")!.status, "aborted");
    assert.equal(readRounds(proj).rounds[0].status, "aborted", "回写落盘,不是只改视图");
  });

  it("终态轮与坏 startedAt 的 running:终态不动;坏时间戳无心跳 → 无法证明活着,回收", () => {
    const now = new Date();
    appendRound(proj, R("RND-done", { status: "done" }));
    appendRound(proj, R("RND-bad", { startedAt: "不是时间" }));
    reapOrphanRounds(proj, now);
    const got = readRounds(proj).rounds;
    assert.equal(got.find((r) => r.roundId === "RND-done")!.status, "done");
    assert.equal(got.find((r) => r.roundId === "RND-bad")!.status, "aborted");
  });

  it("无孤儿时零写放大(seq 不变)", () => {
    const now = new Date();
    appendRound(proj, R("RND-1", { startedAt: now.toISOString() }));
    const seqBefore = readRounds(proj).seq;
    reapOrphanRounds(proj, now);
    assert.equal(readRounds(proj).seq, seqBefore, "没有回写就不该动索引文件");
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
