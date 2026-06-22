/**
 * Deterministic reduction of an execution run into the authoritative run.json.
 *
 * Ported from ai-lab-test-framework's runner.js (harvestResults + reduceResults).
 * The LLM judges each case (emits a single-line `@@RESULT {json}` per case); the
 * AGGREGATION + safety reclassifications are done HERE, by code — never by the LLM
 * — so the four-state counts / pass rate are trustworthy and reproducible:
 *   - status normalization (pass/passed, fail/failed, skipped/flaky → partial, …)
 *   - ENV_HINT reclass: a "fail" whose error reads like an environment/connection
 *     problem (conn refused / DNS / net::ERR…) becomes "blocked" — NOT an app bug.
 *   - 401 circuit-breaker: if >50% of fails carry a 401, the auth session likely
 *     broke mid-run → flag circuitBroken (the whole run is suspect, not N real bugs).
 *
 * Pure functions — unit-tested in src/__tests__/unit/test-reduce.test.ts.
 */

export type FourStateStatus = "pass" | "fail" | "partial" | "blocked";

export interface RawResult {
  id?: string;
  status?: string;
  actual?: string;
  error?: string;
  evidence?: string[];
}

export interface ReducedTest {
  id: string;
  status: FourStateStatus;
  actual: string;
  error: string;
  evidence: string[];
}

export interface RunCounts {
  total: number;
  pass: number;
  fail: number;
  partial: number;
  blocked: number;
}

export interface RunJson {
  module: string;
  env: string;
  time: string;
  status: "done" | "failed" | "blocked";
  counts: RunCounts;
  passStr: string;
  circuitBroken: boolean;
  tests: ReducedTest[];
}

// Status aliases → the canonical four states.
const STATE_ALIASES: Record<string, FourStateStatus> = {
  pass: "pass", passed: "pass", ok: "pass",
  fail: "fail", failed: "fail",
  partial: "partial", skipped: "partial", flaky: "partial",
  blocked: "blocked",
};

// Error text that signals an environment/connection problem (→ blocked, not a bug).
const ENV_HINT =
  /(econnrefused|enotfound|eai_again|net::err|err_connection|err_name_not_resolved|connection refused|拒绝连接|无法连接|无法访问|打不开|超时|timed?\s?out|dns)/i;

/** Extract every `@@RESULT {json}` object from streamed agent text. */
export function harvestResults(text: string): RawResult[] {
  const out: RawResult[] = [];
  for (const line of text.split("\n")) {
    const idx = line.indexOf("@@RESULT");
    if (idx < 0) continue;
    const jsonStr = line.slice(idx + "@@RESULT".length).trim();
    try {
      const obj = JSON.parse(jsonStr);
      if (obj && typeof obj === "object") out.push(obj as RawResult);
    } catch {
      // ignore malformed result lines
    }
  }
  return out;
}

/**
 * Deterministically reduce raw per-case results into a canonical run.json.
 * @param raw  parsed @@RESULT objects (from harvestResults)
 * @param opts module/env labels + an ISO timestamp (passed in — keeps this pure)
 */
export function reduceResults(
  raw: RawResult[],
  opts: { module: string; env: string; time: string },
): RunJson {
  const tests: ReducedTest[] = raw.map((r) => {
    let status: FourStateStatus = STATE_ALIASES[String(r.status ?? "").toLowerCase()] ?? "fail";
    const error = typeof r.error === "string" ? r.error : "";
    const actual = typeof r.actual === "string" ? r.actual : "";
    // ENV_HINT reclass: an environment/connection failure is "blocked", not a bug.
    if (status === "fail" && ENV_HINT.test(`${error} ${actual}`)) status = "blocked";
    return {
      id: String(r.id ?? "用例"),
      status,
      actual,
      error,
      evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
    };
  });

  const counts: RunCounts = { total: tests.length, pass: 0, fail: 0, partial: 0, blocked: 0 };
  for (const t of tests) counts[t.status]++;

  // 401 circuit-breaker: most failures being 401 ⇒ auth broke mid-run ⇒ run suspect.
  const fails = tests.filter((t) => t.status === "fail");
  const fails401 = fails.filter((t) => /\b401\b/.test(`${t.error} ${t.actual}`));
  const circuitBroken = fails.length > 0 && fails401.length / fails.length > 0.5;

  // Overall status: any real fail ⇒ failed; else all-blocked (nothing ran) ⇒ blocked; else done.
  const status: RunJson["status"] =
    counts.fail > 0
      ? "failed"
      : counts.total > 0 && counts.pass + counts.partial === 0 && counts.blocked > 0
        ? "blocked"
        : "done";

  return {
    module: opts.module,
    env: opts.env,
    time: opts.time,
    status,
    counts,
    passStr: `${counts.pass}/${counts.total}`,
    circuitBroken,
    tests,
  };
}

/** Convenience: harvest @@RESULT from raw stream text, then reduce. */
export function reduceFromText(
  text: string,
  opts: { module: string; env: string; time: string },
): RunJson {
  return reduceResults(harvestResults(text), opts);
}
