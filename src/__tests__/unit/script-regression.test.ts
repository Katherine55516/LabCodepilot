/**
 * 回归轮次 · 脚本重放优先(script-regression.ts)。
 *
 * 契约:
 *   1. resolveReplayPlan 资格五道闸(状态/mock/失败记录/caseBodyHash 指纹/文件存在)+
 *      双 manifest(来源任务 vs 回归用例库聚合)按新鲜度取值;
 *   2. buildScriptPhaseStream 发出与 AI 执行【同构】的合成帧 —— 经 harvestResults →
 *      reduceFromText 归约后 status/via 正确、同 id 先到先得(脚本结果不被 AI 覆盖);
 *   3. 失败策略 A:脚本失败判 fail 并计连败,≥2 次 error 附治理建议;环境失败判 blocked
 *      不计连败;pass 清零计数并提升 verified;
 *   4. buildStep(execution + scriptDone) 的排除声明。
 *
 * Run with: npx tsx --test src/__tests__/unit/script-regression.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  candidatesFromSnapshot,
  resolveReplayPlan,
  buildScriptPhaseStream,
  concatSseStreams,
  countScriptableEntries,
  type ReplayCandidate,
} from "../../lib/test/script-regression";
import {
  writeManifest,
  scriptsDir,
  scriptFileName,
  readManifest,
  SCRIPT_MANIFEST_VERSION,
  type ScriptManifest,
  type ScriptManifestCase,
} from "../../lib/test/script-artifacts";
import { caseFingerprint, REGRESSION_LIBRARY_TASK } from "../../lib/test/library";
import { reduceFromText, harvestResults } from "../../lib/test/reduce";
import { buildStep } from "../../lib/test/prompts";
import type { RoundSnapshot } from "../../lib/test/rounds";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "screg-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const ENV = "local";
const TASK = "员工信息";

/** 一条用例体(caseBodyHash 的计算对象)。 */
const caseBody = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, purpose: `用例${id}`, steps: [{ content: "点击", expected: "跳转" }], tags: ["回归测试"], ...extra });

/** 写一份 manifest(cases 按需覆盖字段)+ 对应脚本文件。 */
function seedManifest(
  task: string,
  entries: Array<Partial<ScriptManifestCase> & { caseId: string }>,
  opts: { writeFiles?: boolean } = {},
): void {
  const cases: ScriptManifestCase[] = entries.map((e) => ({
    file: scriptFileName(e.caseId),
    fingerprint: "fp",
    status: "verified",
    usesMock: false,
    generatedAt: "2026-07-10T00:00:00.000Z",
    ...e,
  } as ScriptManifestCase));
  const manifest: ScriptManifest = {
    version: SCRIPT_MANIFEST_VERSION,
    taskName: task,
    env: ENV,
    latestRunHash: "rh",
    jobKey: "jk",
    jobStatus: "done",
    generatorVersion: "1",
    templateVersion: "1",
    runtimeVersion: "1",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    counts: { eligible: cases.length, generated: cases.length, verified: 0, needsReview: 0, failed: 0 },
    cases,
  };
  writeManifest(proj, task, ENV, manifest);
  if (opts.writeFiles !== false) {
    for (const c of cases) {
      const owner = c.sourceTask ?? task;
      const file = path.join(scriptsDir(proj, owner, ENV), c.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "// spec", "utf-8");
    }
  }
}

const cand = (originalId: string, body?: Record<string, unknown>): ReplayCandidate => ({
  runId: originalId,
  task: TASK,
  originalId,
  caseBody: body ?? caseBody(originalId),
  title: `用例${originalId}`,
});

describe("resolveReplayPlan — 资格五道闸", () => {
  it("verified / needs_review(干净)→ 合格;其余状态/mock/失败记录 → 跳过", () => {
    const body = caseBody("TC-1");
    seedManifest(TASK, [
      { caseId: "TC-1", caseBodyHash: caseFingerprint(body) },
      { caseId: "TC-2", status: "needs_review" },
      { caseId: "TC-3", status: "needs_review", lastRunError: "boom" },
      { caseId: "TC-4", usesMock: true },
      { caseId: "TC-5", status: "failed" },
      { caseId: "TC-6", status: "stale" },
    ]);
    const plan = resolveReplayPlan(proj, ENV, [
      cand("TC-1", body), cand("TC-2"), cand("TC-3"), cand("TC-4"), cand("TC-5"), cand("TC-6"), cand("TC-7"),
    ]);
    assert.deepEqual(plan.eligible.map((e) => e.runId).sort(), ["TC-1", "TC-2"]);
    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.runId, s.reason]));
    assert.match(reasons["TC-3"], /失败记录/);
    assert.match(reasons["TC-4"], /mock/);
    assert.match(reasons["TC-5"], /failed/);
    assert.match(reasons["TC-6"], /stale/);
    assert.match(reasons["TC-7"], /无沉淀脚本/);
  });

  it("caseBodyHash 不匹配(用例已修改)→ 跳过;缺失 → 宽限放行", () => {
    seedManifest(TASK, [
      { caseId: "TC-1", caseBodyHash: caseFingerprint(caseBody("TC-1")) },
      { caseId: "TC-2" }, // 无 hash → 宽限
    ]);
    const edited = caseBody("TC-1", { steps: [{ content: "改过了", expected: "新预期" }] });
    const plan = resolveReplayPlan(proj, ENV, [cand("TC-1", edited), cand("TC-2")]);
    assert.deepEqual(plan.eligible.map((e) => e.runId), ["TC-2"]);
    assert.match(plan.skipped[0].reason, /指纹不匹配/);
  });

  it("脚本文件缺失 → 跳过", () => {
    seedManifest(TASK, [{ caseId: "TC-1" }], { writeFiles: false });
    const plan = resolveReplayPlan(proj, ENV, [cand("TC-1")]);
    assert.equal(plan.eligible.length, 0);
    assert.match(plan.skipped[0].reason, /文件缺失/);
  });

  it("聚合 manifest(sourceTask/sourceCaseId)可命中;两个家取新鲜的那条", () => {
    // 来源任务 manifest:旧、verified。聚合 manifest:新、failed(文件被库轮重新生成后校验失败)。
    seedManifest(TASK, [{ caseId: "TC-1", generatedAt: "2026-07-01T00:00:00.000Z" }]);
    seedManifest(REGRESSION_LIBRARY_TASK, [{
      caseId: "run-1", sourceTask: TASK, sourceCaseId: "TC-1",
      status: "failed", generatedAt: "2026-07-12T00:00:00.000Z",
    }]);
    const plan = resolveReplayPlan(proj, ENV, [cand("TC-1")]);
    // 新视图(failed)代表文件现状 → 不重放,即使旧视图是 verified。
    assert.equal(plan.eligible.length, 0);
    assert.match(plan.skipped[0].reason, /failed/);
  });

  it("countScriptableEntries:预览计数与计划口径一致", () => {
    const b1 = caseBody("TC-1");
    seedManifest(TASK, [
      { caseId: "TC-1", caseBodyHash: caseFingerprint(b1) },
      { caseId: "TC-2", usesMock: true },
    ]);
    const n = countScriptableEntries(proj, ENV, [
      { ...b1, _source: { task: TASK, originalId: "TC-1" } },
      { ...caseBody("TC-2"), _source: { task: TASK, originalId: "TC-2" } },
    ]);
    assert.equal(n, 1);
  });
});

describe("candidatesFromSnapshot", () => {
  it("按 idMap 反解来源;缺映射的条目跳过", () => {
    const snap: RoundSnapshot = {
      version: 1, roundId: "RND-1", suiteName: "全量", env: ENV, mode: "full",
      generatedAt: "", total: 2,
      idMap: { "TC-1": { task: TASK, originalId: "TC-1" } },
      cases: [caseBody("TC-1"), caseBody("TC-orphan")],
    };
    const cands = candidatesFromSnapshot(snap);
    assert.equal(cands.length, 1);
    assert.equal(cands[0].task, TASK);
    assert.equal(cands[0].title, "用例TC-1");
  });
});

/** 收集流的全部帧 → 拼出 text 累积(模拟 wrapExecutionStream 的 textAcc)。 */
async function drain(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of value.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const evt = JSON.parse(line.slice(6)) as { type?: string; data?: string };
      if (evt.type === "text" && typeof evt.data === "string") acc += evt.data;
    }
  }
  return acc;
}

function planFor(ids: string[], bodies?: Record<string, Record<string, unknown>>) {
  return resolveReplayPlan(proj, ENV, ids.map((id) => cand(id, bodies?.[id])));
}

describe("buildScriptPhaseStream — 合成帧 × 归约契约", () => {
  it("pass/fail 帧经 harvest→reduce 得到正确 status + via;manifest 就地更新", async () => {
    seedManifest(TASK, [{ caseId: "TC-1" }, { caseId: "TC-2" }]);
    const plan = planFor(["TC-1", "TC-2"]);
    assert.equal(plan.eligible.length, 2);
    const stream = buildScriptPhaseStream({
      projectPath: proj, env: ENV, roundId: "RND-1",
      items: plan.eligible, totalCases: 3,
      runner: async ({ scriptFile }) => scriptFile.includes(scriptFileName("TC-1"))
        ? { ok: true, exitCode: 0, output: "1 passed", timedOut: false }
        : { ok: false, exitCode: 1, output: "Error: expect(received).toBeVisible()", timedOut: false },
    });
    const text = await drain(stream);
    assert.equal((text.match(/@@CASE_START /g) ?? []).length, 2);
    assert.equal((text.match(/@@RESULT /g) ?? []).length, 2);
    assert.match(text, /▶ 用例 1\/3：用例TC-1（脚本重放）/);

    const run = reduceFromText(text, { module: TASK, env: ENV, time: "t", caseIds: ["TC-1", "TC-2", "TC-3"] });
    const byId = new Map(run.tests.map((t) => [t.id, t]));
    assert.equal(byId.get("TC-1")?.status, "pass");
    assert.equal(byId.get("TC-1")?.via, "script");
    assert.equal(byId.get("TC-2")?.status, "fail");
    assert.equal(byId.get("TC-2")?.via, "script");
    // 未被脚本覆盖、AI 也没跑的 → 归约器补 blocked 未执行(无 via)。
    assert.equal(byId.get("TC-3")?.status, "blocked");
    assert.equal(byId.get("TC-3")?.via, undefined);

    const m = readManifest(proj, TASK, ENV)!;
    const e1 = m.cases.find((c) => c.caseId === "TC-1")!;
    const e2 = m.cases.find((c) => c.caseId === "TC-2")!;
    assert.equal(e1.consecutiveRunFailures, 0);
    assert.ok(e1.lastVerifiedAt, "pass 应提升 verified 时间");
    assert.equal(e2.consecutiveRunFailures, 1);
    assert.ok(e2.lastRunError);
  });

  it("连败 ≥2 → error 附治理建议;首败不附", async () => {
    seedManifest(TASK, [{ caseId: "TC-1", consecutiveRunFailures: 1, status: "verified" }]);
    const plan = planFor(["TC-1"]);
    const text = await drain(buildScriptPhaseStream({
      projectPath: proj, env: ENV, roundId: "RND-1", items: plan.eligible, totalCases: 1,
      runner: async () => ({ ok: false, exitCode: 1, output: "Error: locator not found", timedOut: false }),
    }));
    const results = harvestResults(text);
    assert.equal(results.length, 1);
    assert.match(results[0].error ?? "", /连续 2 次重放失败/);
    assert.match(results[0].error ?? "", /AI 修复/);
    assert.equal(readManifest(proj, TASK, ENV)!.cases[0].consecutiveRunFailures, 2);
  });

  it("环境失败 → blocked、不计连败", async () => {
    seedManifest(TASK, [{ caseId: "TC-1" }]);
    const plan = planFor(["TC-1"]);
    const text = await drain(buildScriptPhaseStream({
      projectPath: proj, env: ENV, roundId: "RND-1", items: plan.eligible, totalCases: 1,
      runner: async () => ({ ok: false, exitCode: 1, output: "connect ECONNREFUSED 127.0.0.1:3000", timedOut: false }),
    }));
    const results = harvestResults(text);
    assert.equal(results[0].status, "blocked");
    assert.equal(readManifest(proj, TASK, ENV)!.cases[0].consecutiveRunFailures ?? 0, 0);
  });

  it("同 id 先到先得:AI 误跑已由脚本判定的用例,脚本结果不被覆盖", async () => {
    seedManifest(TASK, [{ caseId: "TC-1" }]);
    const plan = planFor(["TC-1"]);
    const scriptText = await drain(buildScriptPhaseStream({
      projectPath: proj, env: ENV, roundId: "RND-1", items: plan.eligible, totalCases: 1,
      runner: async () => ({ ok: true, exitCode: 0, output: "1 passed", timedOut: false }),
    }));
    const aiText = `@@RESULT {"id":"TC-1","status":"fail","actual":"AI 不听话重跑了","error":"x","evidence":[]}\n`;
    const run = reduceFromText(scriptText + aiText, { module: TASK, env: ENV, time: "t", caseIds: ["TC-1"] });
    assert.equal(run.tests[0].status, "pass");
    assert.equal(run.tests[0].via, "script");
  });
});

describe("concatSseStreams — 顺序 + 惰性", () => {
  it("第二条流在第一条读尽后才创建", async () => {
    let created = false;
    const mk = (chunks: string[]) => new ReadableStream<string>({
      start(c) { for (const x of chunks) c.enqueue(x); c.close(); },
    });
    const out = concatSseStreams(mk(["a", "b"]), () => { created = true; return mk(["c"]); });
    const reader = out.getReader();
    assert.equal((await reader.read()).value, "a");
    assert.equal(created, false);
    assert.equal((await reader.read()).value, "b");
    assert.equal((await reader.read()).value, "c");
    assert.equal(created, true);
    assert.equal((await reader.read()).done, true);
  });
});

describe("buildStep(execution) — scriptDone 排除声明", () => {
  it("注入已完成 id 列表、剩余条数与编号起点;缺省无该块", () => {
    const withBlock = buildStep("execution", {
      taskName: REGRESSION_LIBRARY_TASK, env: ENV, roundId: "RND-1",
      scriptDone: { ids: ["TC-1", "TC-2"], total: 5 },
    });
    assert.match(withBlock.prompt, /脚本重放优先/);
    assert.match(withBlock.prompt, /禁止执行/);
    assert.match(withBlock.prompt, /- TC-1\n/);
    assert.match(withBlock.prompt, /剩余 3 条/);
    assert.match(withBlock.prompt, /N 从 3 开始顺延/);
    const without = buildStep("execution", { taskName: REGRESSION_LIBRARY_TASK, env: ENV, roundId: "RND-1" });
    assert.doesNotMatch(without.prompt, /脚本重放优先/);
  });
});
