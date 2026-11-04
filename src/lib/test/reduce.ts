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

import { createCaseIdResolver } from "./case-id";
import { harvestMarkers } from "./markers";

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
  /** 判定来源:'script' = 回归轮次脚本重放(平台合成帧);缺省 = AI 执行。 */
  via?: string;
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
  /** 判定来源:'script' = 脚本重放;缺省 = AI 执行。报告 UI 据此显示「脚本」徽标。 */
  via?: string;
  /**
   * true = 本轮执行【没跑到】这条用例(执行中断/AI 漏跑),由 caseIds 全集兜底补出来的
   * blocked 条目,不是"跑了但被阻塞"。
   *
   * 存在的理由:脚本生成的收口对账要区分「本轮失去资格」与「本轮没轮到」。前者该标 stale,
   * 后者必须原样保留旧条目——否则一次断流轮就会把几十条 verified 脚本打成 stale、
   * 掉出运行/修复/重放的全部通道(见 script-job-manager 的未执行守卫)。
   * 靠中文文案字符串判别太脆,故给机器可读标记。
   */
  notExecuted?: boolean;
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
  /**
   * 回归集（cases.json `tags` 含「回归测试」——发版必跑、失败即阻塞系统）四态计数与
   * 通过率。与 regressionTotal（回归基线，oracle 口径）【正交】：回归集看「失败后果」，
   * 回归基线看「预期来源」，一条用例可同属两者，两套口径分别统计（详见
   * rules/test-case-completeness.md §1.7）。无回归集（未传 suiteIds / 用例无标签）时
   * 两字段缺省——旧 run.json 与既有消费方不受影响。
   */
  suiteCounts?: RunCounts;
  suitePassStr?: string; // 回归集 "pass/total"；pass < total 即回归集未全过（发版红线）
  /**
   * 按【来源任务】的四态小计（v2 回归轮次报告分组）：仅当调用方传入 taskOf(runId→来源
   * 任务名,来自当轮快照 idMap)时输出——「哪个功能的回归挂了」一眼可见。普通任务执行
   * 不传,字段缺省,旧 run.json 消费方不受影响。
   */
  taskCounts?: Record<string, RunCounts>;
  circuitBroken: boolean;
  tests: ReducedTest[];
  /**
   * 冒烟测试 · 体验观察（`@@OBSERVATION` 标记归约而来）：执行中顺带记录的**非功能**问题
   * （响应慢 / 提示不清 / 按钮无反馈 / 状态不同步），供冒烟报告的「奇怪交互 / 体验问题」
   * 章节。承接原冒烟提示词该章节的要求。
   *
   * 与四态判定【正交】：观察不影响 pass/fail、不计入任何通过率、不产生 Bug —— 它是
   * "顺手记下的体验瑕疵"，不是缺陷判定。功能/回归任务的执行 prompt 不输出该标记，
   * 故字段缺省，旧 run.json 与既有消费方完全不受影响。
   */
  observations?: RunObservation[];
}

/** 一条体验观察（冒烟执行中 `@@OBSERVATION` 输出）。 */
export interface RunObservation {
  /** 观察到的现象（面向用户的描述）。 */
  text: string;
  /** 关联场景 id（如 `SM-004`）；观察发生在场景之外时缺省。 */
  scene?: string;
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
  const { items, malformed } = harvestMarkers<RawResult>(text, "RESULT");
  if (malformed > 0) {
    // 静默丢弃曾让「模型判 2 通过 1 失败」被报成「0/3 全阻塞」(见 markers.ts 模块头)。
    // 解析器现在容忍 markdown 装饰;仍解析不了说明模型输出严重跑偏,必须留声。
    console.warn(`[test-reduce] ${malformed} 行 @@RESULT 无法解析为 JSON,已丢弃`);
  }
  return items;
}

/** 单条观察文本上限（防健谈模型把 run.json 撑爆；与 sanitizeApi 同款防御姿态）。 */
const OBSERVATION_TEXT_MAX = 500;
/** 单轮观察条数上限。超出即截断——体验观察是附带产物，不值得让 run.json 无限膨胀。 */
const OBSERVATION_MAX = 50;

/**
 * 收割冒烟执行流里的 `@@OBSERVATION {json}`（体验观察，见 prompts.ts 冒烟执行 prompt）。
 *
 * 与 @@RESULT 的处置差异：**解析失败不告警**。观察是"顺手记下的瑕疵"，丢一条不影响任何
 * 判定与计数；而 @@RESULT 丢一条会让用例状态错乱，必须留声（见 harvestResults）。
 * 功能/回归任务的 prompt 不产出该标记 → 返回空数组，调用方据此省略字段。
 */
export function harvestObservations(text: string): RunObservation[] {
  const { items } = harvestMarkers<{ text?: unknown; scene?: unknown }>(text, "OBSERVATION");
  const out: RunObservation[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const t = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!t) continue; // 无文本的观察没有信息量，丢弃
    const scene = typeof raw.scene === "string" && raw.scene.trim() ? raw.scene.trim() : undefined;
    out.push({
      text: t.length > OBSERVATION_TEXT_MAX ? t.slice(0, OBSERVATION_TEXT_MAX) + "…" : t,
      ...(scene ? { scene } : {}),
    });
    if (out.length >= OBSERVATION_MAX) break;
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
  opts: {
    module: string;
    env: string;
    time: string;
    verificationById?: Record<string, string>;
    caseIds?: string[];
    /** 回归集用例 id（cases.json `tags` 含「回归测试」，由 run 路由收集传入）。 */
    suiteIds?: string[];
    /** runId → 来源任务名（回归轮次:快照 idMap 反解;传入即输出 taskCounts 分组小计）。 */
    taskOf?: Record<string, string>;
    /**
     * 冒烟：体验观察（`@@OBSERVATION` 收割结果，见 harvestObservations）。非空才写进
     * run.json；功能/回归任务不传 → 字段缺省，旧消费方零感知。
     */
    observations?: RunObservation[];
  },
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
      ...(typeof r.via === "string" && r.via ? { via: r.via } : {}),
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
    // id 先过「回贴」解析器：模型常把 id 里的印刷体标点抄成 ASCII（弯引号 ‘’ → 直引号 '、
    // 破折号 — → -、全角 → 半角），精确比对就此认不出，pass 的用例被丢弃、反被补成
    // blocked「未执行」——报告里成了「回归集未全过、不可发版」。见 case-id.ts 模块头。
    // 精确匹配优先、歧义不猜，所以对本就抄写正确的 id 行为完全不变。
    const resolve = createCaseIdResolver(opts.caseIds);
    const byId = new Map<string, ReducedTest>();
    // 回贴后 id 换成 cases.json 的权威写法 —— 下游（suiteIds/verificationById/taskOf/
    // 耗时表/轨迹）全部按权威 id 关联，不必各自再认一遍模型的变体。
    for (const t of tests) {
      const id = resolve(t.id);
      if (!byId.has(id)) byId.set(id, { ...t, id });
    }
    const aligned: ReducedTest[] = opts.caseIds.map(
      (id) => byId.get(id) ?? { id, status: "blocked", actual: "", error: NOT_EXECUTED_MSG, evidence: [], notExecuted: true },
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

  // 回归集口径（suite = tags 含「回归测试」）：独立于 oracle 双轴的第三组计数。caseIds
  // 对齐时未执行补的 blocked 同样计入——回归集必须全过，漏跑不算过、不虚报发版可行。
  let suiteCounts: RunCounts | undefined;
  let suitePassStr: string | undefined;
  if (opts.suiteIds && opts.suiteIds.length) {
    const suite = new Set(opts.suiteIds);
    suiteCounts = { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 };
    for (const t of tests) {
      if (!suite.has(t.id)) continue;
      suiteCounts.total++;
      suiteCounts[t.status]++;
    }
    suitePassStr = `${suiteCounts.pass}/${suiteCounts.total}`;
  }

  // 按来源任务的四态小计（v2 轮次报告分组）:taskOf 缺失的 runId 归入「未知来源」——
  // 快照与执行集理论上一致,兜底桶只在快照缺损时出现,不静默丢数。
  let taskCounts: Record<string, RunCounts> | undefined;
  if (opts.taskOf) {
    taskCounts = {};
    for (const t of tests) {
      const task = opts.taskOf[t.id] ?? "未知来源";
      const c = (taskCounts[task] ??= { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 });
      c.total++;
      c[t.status]++;
    }
  }

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
    ...(suiteCounts ? { suiteCounts, suitePassStr } : {}),
    ...(taskCounts ? { taskCounts } : {}),
    circuitBroken,
    tests,
    ...(opts.observations?.length ? { observations: opts.observations } : {}),
  };
}

/**
 * Convenience: harvest @@RESULT from raw stream text, then reduce.
 *
 * 同时收割 `@@OBSERVATION`（冒烟体验观察）——功能/回归的执行流里不会出现该标记，收割结果
 * 为空数组、字段自然缺省，故无需调用方按任务形态分流。
 */
export function reduceFromText(
  text: string,
  opts: { module: string; env: string; time: string; verificationById?: Record<string, string>; caseIds?: string[]; suiteIds?: string[]; taskOf?: Record<string, string> },
): RunJson {
  return reduceResults(harvestResults(text), { ...opts, observations: harvestObservations(text) });
}
