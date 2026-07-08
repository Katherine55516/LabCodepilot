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

/**
 * 失败/部分通过用例的关键请求接口信息——执行阶段经 browser_network_requests/
 * browser_network_request 采集（见 prompts.ts 执行 prompt），随 @@RESULT 带回，穿透
 * run.json 供缺陷报告引用。pass/blocked 用例通常无此字段。
 */
export interface ApiInfo {
  method?: string;
  url?: string;
  status?: number | string;
  requestBody?: string;
  responseBody?: string;
}

export interface RawResult {
  id?: string;
  status?: string;
  actual?: string;
  error?: string;
  evidence?: string[];
  api?: ApiInfo;
}

export interface ReducedTest {
  id: string;
  status: FourStateStatus;
  actual: string;
  error: string;
  evidence: string[];
  api?: ApiInfo;
  /** 单用例执行耗时（服务端按进度行/@@RESULT 时间戳计，见 exec-timing.ts）；缺省=未测得 */
  durationMs?: number;
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
  // Dual-rate (oracle 双轴): 功能验证用例的四态计数 + 通过率字符串。回归基线用例（oracle =
  // 现状锁定）只锁现状、不计入功能验证通过率。无 cases 映射时 funcCounts 退化为全部用例
  // (== counts)、funcPassStr == passStr，向后兼容旧 run.json 消费方。
  funcCounts: RunCounts;
  funcPassStr: string; // 功能验证 pass/total；全为回归基线 → "N/A"（不得报「100% 通过」）
  regressionTotal: number; // 回归基线用例数
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

// 兜底补全的「未执行」用例说明（问题②）：执行阶段未对该用例产出 @@RESULT → 报告以 cases
// 全集为准把它补成 blocked，并附此说明，提示用户重跑执行步补齐（避免用例被静默丢失）。
const NOT_EXECUTED_MSG = "用例未执行：执行阶段未产出该用例的结果，请重跑「执行」步补齐。";

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
 * Normalize a raw `api` field (from @@RESULT) into ApiInfo. Drops non-objects and
 * defensively truncates bodies (the prompt asks the agent to cap at ~4000, but we
 * re-clamp server-side so a chatty agent can't bloat run.json). Returns undefined
 * when nothing meaningful was captured, so the field stays absent on pass cases.
 */
export function sanitizeApi(raw: unknown): ApiInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" ? (v.length > max ? v.slice(0, max) + "…" : v) : undefined;
  const out: ApiInfo = {
    method: str(a.method, 16),
    url: str(a.url, 2048),
    status: typeof a.status === "number" ? a.status : str(a.status, 16),
    requestBody: str(a.requestBody, 4000),
    responseBody: str(a.responseBody, 4000),
  };
  if (!out.method && !out.url && out.status === undefined && !out.requestBody && !out.responseBody) return undefined;
  return out;
}

/**
 * Deterministically reduce raw per-case results into a canonical run.json.
 * @param raw  parsed @@RESULT objects (from harvestResults)
 * @param opts module/env labels + an ISO timestamp (passed in — keeps this pure)
 */
export function reduceResults(
  raw: RawResult[],
  opts: { module: string; env: string; time: string; verificationById?: Record<string, string>; caseIds?: string[] },
): RunJson {
  const tests: ReducedTest[] = raw.map((r) => {
    let status: FourStateStatus = STATE_ALIASES[String(r.status ?? "").toLowerCase()] ?? "fail";
    const error = typeof r.error === "string" ? r.error : "";
    const actual = typeof r.actual === "string" ? r.actual : "";
    // ENV_HINT reclass: an environment/connection failure is "blocked", not a bug.
    if (status === "fail" && ENV_HINT.test(`${error} ${actual}`)) status = "blocked";
    const api = sanitizeApi(r.api);
    return {
      id: String(r.id ?? "用例"),
      status,
      actual,
      error,
      evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
      ...(api ? { api } : {}),
    };
  });

  // 报告以 cases.json 用例全集为准：严格按 caseIds 一一对应（既不多也不少）。
  //  - caseIds 中【有】对应 @@RESULT 的用例 → 用其结果（同 id 多条取第一条）；
  //  - caseIds 中【无】对应结果的用例 → 补 blocked「未执行」（问题②：25→16 漏跑可见，
  //    不虚报通过率——未执行计入 total/blocked、不算 pass）；
  //  - AI 产出的、【不在】caseIds 中的多余结果 → 丢弃（本问题：设计 1 条用例、报告却出现
  //    2 条——AI 编造 / 把一条拆成多条 / 写错 id 产生的额外条目，报告不应超出用户设计的用例集）。
  // 不传 caseIds 时行为不变（向后兼容旧调用与单测——不做任何对齐，tests 即 @@RESULT 原样）。
  if (opts.caseIds && opts.caseIds.length) {
    const byId = new Map<string, ReducedTest>();
    for (const t of tests) if (!byId.has(t.id)) byId.set(t.id, t);
    const aligned: ReducedTest[] = opts.caseIds.map(
      (id) => byId.get(id) ?? { id, status: "blocked", actual: "", error: NOT_EXECUTED_MSG, evidence: [] },
    );
    tests.splice(0, tests.length, ...aligned);
  }

  const counts: RunCounts = { total: tests.length, pass: 0, fail: 0, partial: 0, blocked: 0 };
  for (const t of tests) counts[t.status]++;

  // 401 circuit-breaker: most failures being 401 ⇒ auth broke mid-run ⇒ run suspect.
  const fails = tests.filter((t) => t.status === "fail");
  const fails401 = fails.filter((t) => /\b401\b/.test(`${t.error} ${t.actual}`));
  const circuitBroken = fails.length > 0 && fails401.length / fails.length > 0.5;

  // Dual-rate (oracle 双轴): split tests into 功能验证 vs 回归基线 by the cases.json
  // `verification` field (joined by id via opts.verificationById). 回归基线 cases only
  // lock the status quo (oracle = 现状锁定) — their pass must NOT inflate the functional
  // pass rate, so they're excluded from funcCounts. A test whose id is absent from the
  // map (no cases join, or legacy cases without the field) defaults to 功能验证 — so with
  // no map at all this degrades gracefully to single-rate (funcCounts === counts).
  const vById = opts.verificationById ?? {};
  const isRegression = (id: string) => /回归基线|regression/i.test(vById[id] ?? "");
  const funcCounts: RunCounts = { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 };
  let regressionTotal = 0;
  for (const t of tests) {
    if (isRegression(t.id)) {
      regressionTotal++;
    } else {
      funcCounts.total++;
      funcCounts[t.status]++;
    }
  }
  // 全为回归基线 → 功能验证通过率记 N/A（仅锁现状，不得报「100% 通过」）。
  const funcPassStr = funcCounts.total > 0 ? `${funcCounts.pass}/${funcCounts.total}` : "N/A";

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
    funcCounts,
    funcPassStr,
    regressionTotal,
    circuitBroken,
    tests,
  };
}

/** Convenience: harvest @@RESULT from raw stream text, then reduce. */
export function reduceFromText(
  text: string,
  opts: { module: string; env: string; time: string; verificationById?: Record<string, string>; caseIds?: string[] },
): RunJson {
  return reduceResults(harvestResults(text), opts);
}
