import { createHash } from 'crypto';
import type {
  TestReviewVerdict,
  TestStatsAdoption,
  TestStatsCaseKey,
  TestStatsCounts,
  TestStatsEvent,
  TestStatsEventInput,
  TestStatsEventType,
  TestStatsGlobal,
  TestStatsModelRow,
  TestStatsNodeRound,
  TestStatsReview,
  TestStatsStep,
  TestStatsTaskDetail,
  TestStatsTaskRow,
  TestStatsWeeklyPoint,
} from '@/types';

/**
 * 测试模块使用统计 · 纯函数层。
 *
 * 事件校验、用例内容 hash、采纳 diff、误判归类、三种 scope（global/task/model）的聚合，
 * 全部实现为无副作用纯函数：不 import db、不碰文件系统，只依赖 node:crypto —— 这是刻意的，
 * 聚合口径能在 node:test 下直接单测，完全避开 better-sqlite3 的 Electron ABI 问题。
 * db 层（src/lib/db.ts）只负责事件的插入与按条件查询；路由（api/test/stats）做粘合。
 *
 * 冻结口径（详见 docs/exec-plans/active/test-usage-stats.md）：
 * - 采纳率 = (原样采纳+修改后采纳) / 首轮 AI 生成数；基线 = 第一条 cases_generated 快照；
 *   分母只含「AI 生成流（source=imported_requirement）且已批准」的任务；返工轮数单独计。
 * - 准确度 = 复核为准确条次 / 已复核条次；必须同示复核覆盖率；熔断（circuitBroken）轮整轮排除；
 *   同一 (task, runHash, caseId) 复核多次以最后一次为准。
 * - 时长：逐用例 durationMs 来自服务端对进度行打的时间戳（Phase 2 写入 payload），不采信 AI 自报。
 * - 模型归因：采纳率归因首轮用例设计模型；准确度/通过率/时长归因执行模型。
 * - 比率一律 0-1 小数，分母为 0 时为 null。
 *
 * 聚合函数假定输入事件已按 (created_at, rowid) 升序（queryTestStatsEvents 的返回顺序），
 * 内部不再排序；"后写覆盖先写"（复核 last-wins）依赖这一顺序。
 */

export const TEST_STATS_SCHEMA_VERSION = 1;

export const TEST_STATS_EVENT_TYPES: readonly TestStatsEventType[] = [
  'task_created',
  'task_deleted',
  'step_completed',
  'cases_generated',
  'cases_edited',
  'cases_approved',
  'execution_completed',
  'report_generated',
  'report_reviewed',
  'report_review_bulk',
];

const EVENT_TYPE_SET = new Set<string>(TEST_STATS_EVENT_TYPES);

/** payload JSON 序列化后的上限（防御性；正常快照远小于此） */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

const STEPS: readonly TestStatsStep[] = ['requirement', 'cases', 'execution', 'report'];

// ---------- 窄化小工具 ----------

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asArr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}
function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export function isTestStatsEventType(s: unknown): s is TestStatsEventType {
  return typeof s === 'string' && EVENT_TYPE_SET.has(s);
}

/**
 * 校验并归一一条外部事件输入（POST body 里的一项）。不合法返回 null（调用方跳过，不抛错）。
 * 统计采集永远不能影响测试主流程，所以这里只做"收不收"，不做"报错"。
 */
export function sanitizeEventInput(raw: unknown): TestStatsEventInput | null {
  const o = asObj(raw);
  if (!o) return null;
  const eventType = o.eventType;
  if (!isTestStatsEventType(eventType)) return null;
  const projectPath = asStr(o.projectPath)?.trim() ?? '';
  const taskId = asStr(o.taskId)?.trim() ?? '';
  if (!projectPath || projectPath.length > 1024) return null;
  if (!taskId || taskId.length > 128) return null;
  const taskName = (asStr(o.taskName) ?? '').slice(0, 256);
  const envRaw = asStr(o.env)?.trim() ?? '';
  const env = envRaw ? envRaw.slice(0, 32) : undefined;
  let payload: Record<string, unknown> | undefined;
  if (o.payload !== undefined) {
    const p = asObj(o.payload);
    if (!p) return null;
    try {
      if (JSON.stringify(p).length > MAX_PAYLOAD_BYTES) return null;
    } catch {
      return null; // 循环引用等异常形状
    }
    payload = p;
  }
  return { eventType, projectPath, taskId, taskName: taskName || undefined, env, payload };
}

// ---------- 用例身份与采纳 diff ----------

/** 递归按 key 排序的稳定序列化：同内容不同 key 顺序 → 同一 hash。 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** 单条用例 → { id, hash }。hash 取 sha1 前 16 位 hex，只存身份不存内容。 */
export function caseIdentity(c: unknown): TestStatsCaseKey {
  const o = asObj(c);
  const id = (o ? asStr(o.id) : null)?.trim() ?? '';
  const hash = createHash('sha1').update(stableStringify(c)).digest('hex').slice(0, 16);
  return { id, hash };
}

const MAX_SNAPSHOT_CASES = 2000;

export function snapshotCases(cases: unknown[]): TestStatsCaseKey[] {
  return cases.slice(0, MAX_SNAPSHOT_CASES).map(caseIdentity);
}

export interface CasesDiff {
  kept: number;
  modified: number;
  removed: number;
  added: number;
}

/**
 * 基线快照 vs 终态快照的四分类 diff。
 * 有 id 的按 id 配对（同 id 同 hash=原样；同 id 异 hash=修改后）；
 * 无 id 的退化为按 hash 多重集合配对（同 hash=原样）；配不上的分别计 removed/added。
 */
export function diffCases(baseline: TestStatsCaseKey[], final: TestStatsCaseKey[]): CasesDiff {
  const baseById = new Map<string, string>();
  const baseNoId: string[] = [];
  for (const b of baseline) {
    if (b.id && !baseById.has(b.id)) baseById.set(b.id, b.hash);
    else baseNoId.push(b.hash);
  }
  let kept = 0;
  let modified = 0;
  let added = 0;
  const matchedIds = new Set<string>();
  const finalNoId: string[] = [];
  for (const f of final) {
    if (f.id && baseById.has(f.id) && !matchedIds.has(f.id)) {
      matchedIds.add(f.id);
      if (baseById.get(f.id) === f.hash) kept++;
      else modified++;
    } else {
      finalNoId.push(f.hash);
    }
  }
  // 无 id（或 id 配不上的）按 hash 多重集合配对
  const pool = new Map<string, number>();
  for (const h of baseNoId) pool.set(h, (pool.get(h) ?? 0) + 1);
  for (const h of finalNoId) {
    const left = pool.get(h) ?? 0;
    if (left > 0) {
      pool.set(h, left - 1);
      kept++;
    } else {
      added++;
    }
  }
  let unmatchedBase = 0;
  for (const n of pool.values()) unmatchedBase += n;
  const removed = baseById.size - matchedIds.size + unmatchedBase;
  return { kept, modified, removed, added };
}

// ---------- 误判归类 ----------

/**
 * 复核归类：用户只回答"实际结果是什么"，按 AI 结论自动归类，不要求用户理解术语。
 * actual: 'ok' 实际功能正常 | 'broken' 实际功能有问题 | 'severity' 结论程度不符。
 */
export function classifyVerdict(
  aiStatus: string,
  actual: 'ok' | 'broken' | 'severity',
): TestReviewVerdict {
  if (actual === 'severity') return 'severity_mismatch';
  if (actual === 'ok') return aiStatus === 'pass' ? 'accurate' : 'false_fail';
  return aiStatus === 'fail' || aiStatus === 'blocked' ? 'accurate' : 'missed_fail';
}

// ---------- 时间 ----------

/** DB created_at（UTC 'YYYY-MM-DD HH:MM:SS'）→ epoch ms；解析失败返回 0。 */
export function parseDbTime(s: string): number {
  if (!s) return 0;
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (!Number.isNaN(t)) return t;
  const t2 = Date.parse(s);
  return Number.isNaN(t2) ? 0 : t2;
}

const DAY_MS = 86400000;

/**
 * 时间窗口（from/to 解析为 epoch ms，缺省为无界）。窗口语义（评审后冻结）：
 * 聚合必须在"涉及任务的全量事件上下文"上做（路由负责补齐），窗口只决定"计入哪些主事件"——
 * 任务数按创建时间、采纳按批准时间、执行/时长按执行时间、复核按其所属执行轮是否在窗内。
 * 这样窗外执行轮的熔断排除、首轮基线等归因上下文不丢失，覆盖率也不会超过 1。
 */
interface WindowOpts {
  fromMs: number;
  toMs: number;
}

function windowOf(range: { from?: string | null; to?: string | null }): WindowOpts {
  return {
    fromMs: range.from ? parseDbTime(range.from) : -Infinity,
    toMs: range.to ? parseDbTime(range.to) : Infinity,
  };
}

function inWin(at: string, w: WindowOpts): boolean {
  const t = parseDbTime(at);
  return t >= w.fromMs && t <= w.toMs;
}

/** step_completed 与专属事件（cases_generated 等）视为同一轮的时间容差。 */
const PAIR_WINDOW_MS = 120000;

/** 事件时间所在周的周一（UTC）YYYY-MM-DD。 */
export function weekStartOf(createdAt: string): string {
  const t = parseDbTime(createdAt);
  const d = new Date(t);
  const offset = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(t - offset * DAY_MS);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ---------- payload 读取 ----------

function payloadCounts(v: unknown): TestStatsCounts | null {
  const o = asObj(v);
  if (!o) return null;
  const total = asNum(o.total);
  if (total === null) return null;
  return {
    total,
    pass: asNum(o.pass) ?? 0,
    fail: asNum(o.fail) ?? 0,
    partial: asNum(o.partial) ?? 0,
    blocked: asNum(o.blocked) ?? 0,
  };
}

/** payload 里的 [{id,hash}] 快照 → TestStatsCaseKey[]；形状不对返回 null。路由与聚合共用。 */
export function readCaseKeys(v: unknown): TestStatsCaseKey[] | null {
  const arr = asArr(v);
  if (!arr) return null;
  const out: TestStatsCaseKey[] = [];
  for (const item of arr) {
    const o = asObj(item);
    if (!o) continue;
    out.push({ id: asStr(o.id)?.trim() ?? '', hash: asStr(o.hash) ?? '' });
  }
  return out;
}

function payloadDiff(v: unknown): CasesDiff | null {
  const o = asObj(v);
  if (!o) return null;
  const kept = asNum(o.kept);
  const modified = asNum(o.modified);
  const removed = asNum(o.removed);
  const added = asNum(o.added);
  if (kept === null || modified === null || removed === null || added === null) return null;
  return { kept, modified, removed, added };
}

// ---------- 任务累加器（global 与 task detail 共用） ----------

interface StepRunLite {
  at: string;
  status: string | null;
  durationMs: number | null;
  model: string | null;
  providerId: string | null;
  step: TestStatsStep;
}

interface CasesRoundLite {
  at: string;
  round: number;
  caseCount: number | null;
  model: string | null;
  cases: TestStatsCaseKey[] | null;
}

interface ExecRunLite {
  at: string;
  env: string | null;
  model: string | null;
  counts: TestStatsCounts | null;
  circuitBroken: boolean;
  durationMs: number | null;
  runHash: string | null;
  caseDurations: number[];
}

interface ReportRunLite {
  at: string;
  env: string | null;
  model: string | null;
  runHash: string | null;
}

interface ReviewEntry {
  verdict: TestReviewVerdict;
  runHash: string | null;
  at: string;
}

interface TaskAcc {
  taskId: string;
  taskName: string;
  projectPath: string;
  createdAt: string | null;
  source: string | null;
  deleted: boolean;
  steps: Record<TestStatsStep, StepRunLite[]>;
  casesRounds: CasesRoundLite[];
  approved: {
    at: string;
    finalCount: number | null;
    diff: CasesDiff | null;
    aiRounds: number | null;
    final: TestStatsCaseKey[] | null;
  } | null;
  execRuns: ExecRunLite[];
  reportRuns: ReportRunLite[];
  /** key = runHash|caseId，last-wins */
  reviews: Map<string, ReviewEntry>;
}

function newTaskAcc(taskId: string): TaskAcc {
  return {
    taskId,
    taskName: '',
    projectPath: '',
    createdAt: null,
    source: null,
    deleted: false,
    steps: { requirement: [], cases: [], execution: [], report: [] },
    casesRounds: [],
    approved: null,
    execRuns: [],
    reportRuns: [],
    reviews: new Map(),
  };
}

function isStep(v: unknown): v is TestStatsStep {
  return v === 'requirement' || v === 'cases' || v === 'execution' || v === 'report';
}

/** 单遍扫描把事件流折叠成按任务的累加器。假定 events 已按时间升序。 */
function buildTaskAccs(events: TestStatsEvent[]): Map<string, TaskAcc> {
  const accs = new Map<string, TaskAcc>();
  for (const ev of events) {
    let acc = accs.get(ev.taskId);
    if (!acc) {
      acc = newTaskAcc(ev.taskId);
      accs.set(ev.taskId, acc);
    }
    if (ev.taskName && !acc.taskName) acc.taskName = ev.taskName;
    if (ev.projectPath && !acc.projectPath) acc.projectPath = ev.projectPath;
    const p = ev.payload;
    switch (ev.eventType) {
      case 'task_created':
        acc.createdAt = acc.createdAt ?? ev.createdAt;
        acc.source = asStr(p.source) ?? acc.source;
        break;
      case 'task_deleted':
        acc.deleted = true;
        break;
      case 'step_completed': {
        const step = p.step;
        if (isStep(step)) {
          acc.steps[step].push({
            at: ev.createdAt,
            status: asStr(p.status),
            durationMs: asNum(p.durationMs),
            model: asStr(p.model),
            providerId: asStr(p.providerId),
            step,
          });
        }
        break;
      }
      case 'cases_generated':
        acc.casesRounds.push({
          at: ev.createdAt,
          round: asNum(p.round) ?? acc.casesRounds.length + 1,
          caseCount: asNum(p.caseCount),
          model: asStr(p.model),
          cases: readCaseKeys(p.cases),
        });
        break;
      case 'cases_approved':
        // cases_approved 在每次进入执行时都发（重跑/多环境）。内容（diff/final）取最新一次
        // ——捕获用户在轮次间对用例的编辑；但时间 at 取**最早一次**（首次批准），用于窗口/
        // 周趋势归属——否则第 5 周重跑会把第 1 周的采纳量错误地挪到第 5 周（评审 M1）。
        // 事件按时间升序，acc.approved?.at 即已记录的最早值。
        acc.approved = {
          at: acc.approved?.at ?? ev.createdAt,
          finalCount: asNum(p.finalCount),
          diff: payloadDiff(p.diff),
          aiRounds: asNum(p.aiRounds),
          final: readCaseKeys(p.final),
        };
        break;
      case 'cases_edited':
        break; // 辅助信号，v1 聚合不消费
      case 'execution_completed': {
        const tests = asArr(p.tests) ?? [];
        const caseDurations: number[] = [];
        for (const t of tests) {
          const d = asNum(asObj(t)?.durationMs);
          if (d !== null && d > 0) caseDurations.push(d);
        }
        acc.execRuns.push({
          at: ev.createdAt,
          env: ev.env ?? asStr(p.env),
          model: asStr(p.model),
          counts: payloadCounts(p.counts),
          circuitBroken: p.circuitBroken === true,
          durationMs: asNum(p.durationMs),
          runHash: asStr(p.runHash),
          caseDurations,
        });
        break;
      }
      case 'report_generated':
        acc.reportRuns.push({
          at: ev.createdAt,
          env: ev.env ?? asStr(p.env),
          model: asStr(p.model),
          runHash: asStr(p.runHash),
        });
        break;
      case 'report_reviewed': {
        const caseId = asStr(p.caseId) ?? '';
        const verdict = p.verdict;
        if (!caseId) break;
        const runHash = asStr(p.runHash);
        const key = `${runHash ?? ''}|${caseId}`;
        if (verdict === 'cleared') {
          // 撤销：last-wins 删除该条复核，不计入准确度/覆盖率（评审 M2）
          acc.reviews.delete(key);
        } else if (
          verdict === 'accurate' ||
          verdict === 'false_fail' ||
          verdict === 'missed_fail' ||
          verdict === 'severity_mismatch'
        ) {
          acc.reviews.set(key, { verdict, runHash, at: ev.createdAt });
        }
        break;
      }
      case 'report_review_bulk': {
        const runHash = asStr(p.runHash);
        for (const cid of asArr(p.caseIds) ?? []) {
          const caseId = asStr(cid);
          if (caseId) {
            acc.reviews.set(`${runHash ?? ''}|${caseId}`, {
              verdict: 'accurate',
              runHash,
              at: ev.createdAt,
            });
          }
        }
        break;
      }
    }
  }
  // runHash 回填：execution_completed 未携带 runHash 时（事件字典早期版本 / 事件缺失），
  // 用其后最近的 report_generated 的 runHash 回溯关联——熔断排除与模型归因不因此失效。
  for (const acc of accs.values()) {
    for (const rep of acc.reportRuns) {
      if (!rep.runHash) continue;
      let candidate: ExecRunLite | null = null;
      const repAt = parseDbTime(rep.at);
      for (const run of acc.execRuns) {
        const runAt = parseDbTime(run.at);
        if (runAt <= repAt && (candidate === null || runAt >= parseDbTime(candidate.at))) {
          candidate = run;
        }
      }
      if (candidate && !candidate.runHash) candidate.runHash = rep.runHash;
    }
  }
  return accs;
}

/** AI 生成流（采纳率候选）：需求导入、用例由 AI 生成。 */
function isAdoptionEligible(acc: TaskAcc): boolean {
  return acc.source === 'imported_requirement';
}

/** 熔断轮的 runHash 集合（复核排除用；runHash 缺失的熔断轮无法关联，只能排除其条次总数）。 */
function brokenRunHashes(acc: TaskAcc): Set<string> {
  const s = new Set<string>();
  for (const r of acc.execRuns) if (r.circuitBroken && r.runHash) s.add(r.runHash);
  return s;
}

/** 任务的有效复核条目（熔断轮的复核剔除）。 */
function validReviews(acc: TaskAcc): ReviewEntry[] {
  const broken = brokenRunHashes(acc);
  const out: ReviewEntry[] = [];
  for (const r of acc.reviews.values()) {
    if (r.runHash && broken.has(r.runHash)) continue;
    out.push(r);
  }
  return out;
}

function emptyReview(): TestStatsReview {
  return {
    totalResults: 0,
    reviewed: 0,
    coverage: null,
    accurate: 0,
    falseFail: 0,
    missedFail: 0,
    severityMismatch: 0,
    accuracy: null,
  };
}

function tallyVerdict(target: TestStatsReview, r: ReviewEntry): void {
  target.reviewed++;
  if (r.verdict === 'accurate') target.accurate++;
  else if (r.verdict === 'false_fail') target.falseFail++;
  else if (r.verdict === 'missed_fail') target.missedFail++;
  else target.severityMismatch++;
}

/**
 * 复核按"所属执行轮"计入：窗内非熔断执行轮贡献可复核总数与其（按 runHash 关联的）复核；
 * runHash 缺失/悬空的复核按复核时间兜底计入（无法关联执行轮，覆盖率在此极端下可能略偏）。
 * 熔断轮：既不进 totalResults，其复核也整轮剔除。
 */
function runScopedReview(target: TestStatsReview, acc: TaskAcc, w: WindowOpts): void {
  const knownHashes = new Set<string>();
  for (const run of acc.execRuns) if (run.runHash) knownHashes.add(run.runHash);
  const byHash = new Map<string, ReviewEntry[]>();
  const loose: ReviewEntry[] = [];
  for (const r of acc.reviews.values()) {
    if (r.runHash && knownHashes.has(r.runHash)) {
      const list = byHash.get(r.runHash) ?? [];
      list.push(r);
      byHash.set(r.runHash, list);
    } else {
      loose.push(r);
    }
  }
  for (const run of acc.execRuns) {
    if (run.circuitBroken || !inWin(run.at, w)) continue;
    if (run.counts) target.totalResults += run.counts.total;
    if (run.runHash) {
      for (const r of byHash.get(run.runHash) ?? []) tallyVerdict(target, r);
    }
  }
  for (const r of loose) if (inWin(r.at, w)) tallyVerdict(target, r);
}

function finishReview(target: TestStatsReview): void {
  target.coverage = rate(target.reviewed, target.totalResults);
  target.accuracy = rate(target.accurate, target.reviewed);
}

// ---------- 聚合：global ----------

const DURATION_BUCKETS: { label: string; maxMs: number }[] = [
  { label: '<15s', maxMs: 15000 },
  { label: '15–30s', maxMs: 30000 },
  { label: '30–60s', maxMs: 60000 },
  { label: '1–2m', maxMs: 120000 },
  { label: '>2m', maxMs: Infinity },
];

const MAX_WEEKLY_POINTS = 60;

export function aggregateGlobal(
  events: TestStatsEvent[],
  range: { from?: string | null; to?: string | null } = {},
): TestStatsGlobal {
  const accs = buildTaskAccs(events);
  const w = windowOf(range);

  const tasks = { total: 0, aiFlow: 0, importedCases: 0, deleted: 0 };
  const adoption: TestStatsAdoption = {
    eligibleTasks: 0,
    generated: 0,
    kept: 0,
    modified: 0,
    removed: 0,
    userAdded: 0,
    adoptionRate: null,
    keptRate: null,
    reworkRounds: 0,
  };
  const review = emptyReview();
  const results: TestStatsCounts = { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 };
  let runs = 0;
  const allCaseDurations: number[] = [];
  const stepDurSum: Partial<Record<TestStatsStep, { sum: number; n: number }>> = {};

  const taskRows: TestStatsTaskRow[] = [];

  for (const acc of accs.values()) {
    const eligible = isAdoptionEligible(acc);
    const createdInWin = acc.createdAt !== null && inWin(acc.createdAt, w);
    if (createdInWin) {
      tasks.total++;
      if (eligible) tasks.aiFlow++;
      else tasks.importedCases++;
      if (acc.deleted) tasks.deleted++;
    }

    const approvedInWin = acc.approved !== null && inWin(acc.approved.at, w);
    if (eligible) {
      for (const g of acc.casesRounds.slice(1)) {
        if (inWin(g.at, w)) adoption.reworkRounds++;
      }
      if (acc.approved?.diff && approvedInWin && acc.casesRounds.length > 0) {
        const baseline = acc.casesRounds[0];
        adoption.eligibleTasks++;
        adoption.generated += baseline.caseCount ?? baseline.cases?.length ?? 0;
        adoption.kept += acc.approved.diff.kept;
        adoption.modified += acc.approved.diff.modified;
        adoption.removed += acc.approved.diff.removed;
        adoption.userAdded += acc.approved.diff.added;
      }
    }

    const winRuns = acc.execRuns.filter((run) => inWin(run.at, w));
    for (const run of winRuns) {
      runs++;
      if (!run.circuitBroken && run.counts) {
        results.total += run.counts.total;
        results.pass += run.counts.pass;
        results.fail += run.counts.fail;
        results.partial += run.counts.partial;
        results.blocked += run.counts.blocked;
        allCaseDurations.push(...run.caseDurations);
      }
    }
    for (const step of STEPS) {
      for (const s of acc.steps[step]) {
        if (s.durationMs !== null && s.durationMs > 0 && inWin(s.at, w)) {
          const slot = (stepDurSum[step] ??= { sum: 0, n: 0 });
          slot.sum += s.durationMs;
          slot.n++;
        }
      }
    }

    runScopedReview(review, acc, w);

    // ---- 任务明细行（同样按窗口计入；无窗内活动且非窗内创建的任务不出现在行里） ----
    const rowReview = emptyReview();
    runScopedReview(rowReview, acc, w);
    finishReview(rowReview);
    const hasWinActivity =
      winRuns.length > 0 || approvedInWin || rowReview.reviewed > 0 || createdInWin;
    if (!hasWinActivity) continue;
    const baseline = acc.casesRounds[0] ?? null;
    const lastRun = winRuns[winRuns.length - 1] ?? null;
    taskRows.push({
      taskId: acc.taskId,
      taskName: acc.taskName,
      projectPath: acc.projectPath,
      createdAt: acc.createdAt,
      source: acc.source,
      adoptionEligible: eligible,
      generated: eligible ? (baseline?.caseCount ?? baseline?.cases?.length ?? null) : null,
      adopted:
        eligible && acc.approved?.diff && approvedInWin
          ? acc.approved.diff.kept + acc.approved.diff.modified
          : null,
      modified: eligible && acc.approved?.diff && approvedInWin ? acc.approved.diff.modified : null,
      removed: eligible && acc.approved?.diff && approvedInWin ? acc.approved.diff.removed : null,
      executionRuns: winRuns.length,
      latestResults: lastRun?.counts ?? null,
      latestCircuitBroken: lastRun?.circuitBroken ?? false,
      latestDurationMs: lastRun?.durationMs ?? null,
      reviewed: rowReview.reviewed,
      reviewTotal: rowReview.totalResults,
      accuracy: rowReview.accuracy,
      deleted: acc.deleted,
    });
  }

  finishReview(review);
  adoption.adoptionRate = rate(adoption.kept + adoption.modified, adoption.generated);
  adoption.keptRate = rate(adoption.kept, adoption.generated);

  const stepAvgDurationsMs: Partial<Record<TestStatsStep, number>> = {};
  for (const step of STEPS) {
    const slot = stepDurSum[step];
    if (slot && slot.n > 0) stepAvgDurationsMs[step] = Math.round(slot.sum / slot.n);
  }
  const durationBuckets = DURATION_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const d of allCaseDurations) {
    const idx = DURATION_BUCKETS.findIndex((b) => d < b.maxMs);
    durationBuckets[idx === -1 ? DURATION_BUCKETS.length - 1 : idx].count++;
  }
  const durSum = allCaseDurations.reduce((a, b) => a + b, 0);

  taskRows.sort((a, b) => {
    const ta = a.createdAt ? parseDbTime(a.createdAt) : 0;
    const tb = b.createdAt ? parseDbTime(b.createdAt) : 0;
    return tb - ta;
  });

  return {
    range: { from: range.from ?? null, to: range.to ?? null },
    tasks,
    adoption,
    execution: {
      runs,
      results,
      passRate: rate(results.pass, results.total),
      avgCaseDurationMs: allCaseDurations.length
        ? Math.round(durSum / allCaseDurations.length)
        : null,
      durationBuckets,
      stepAvgDurationsMs,
    },
    review,
    weekly: buildWeekly(events, accs, w),
    taskRows,
  };
}

function buildWeekly(
  events: TestStatsEvent[],
  accs: Map<string, TaskAcc>,
  w: WindowOpts,
): TestStatsWeeklyPoint[] {
  interface Bucket {
    tasksCreated: number;
    casesKept: number;
    casesModified: number;
    casesRemoved: number;
    reviewAccurate: number;
    reviewTotal: number;
  }
  const buckets = new Map<string, Bucket>();
  const bucket = (week: string): Bucket => {
    let b = buckets.get(week);
    if (!b) {
      b = {
        tasksCreated: 0,
        casesKept: 0,
        casesModified: 0,
        casesRemoved: 0,
        reviewAccurate: 0,
        reviewTotal: 0,
      };
      buckets.set(week, b);
    }
    return b;
  };
  for (const ev of events) {
    if (ev.eventType === 'task_created' && inWin(ev.createdAt, w)) {
      bucket(weekStartOf(ev.createdAt)).tasksCreated++;
    }
  }
  for (const acc of accs.values()) {
    if (isAdoptionEligible(acc) && acc.approved?.diff && inWin(acc.approved.at, w)) {
      const b = bucket(weekStartOf(acc.approved.at));
      b.casesKept += acc.approved.diff.kept;
      b.casesModified += acc.approved.diff.modified;
      b.casesRemoved += acc.approved.diff.removed;
    }
    // 周趋势里的准确度按复核时间归桶（趋势视图语义），仍剔除熔断轮复核
    for (const r of validReviews(acc)) {
      if (!inWin(r.at, w)) continue;
      const b = bucket(weekStartOf(r.at));
      b.reviewTotal++;
      if (r.verdict === 'accurate') b.reviewAccurate++;
    }
  }
  const weeks = [...buckets.keys()].sort();
  if (weeks.length === 0) return [];
  // 首尾之间补零周保证图表连续；跨度超过 MAX_WEEKLY_POINTS 时只保留最近 N 周
  // （起点直接从 end 倒推，避免从头迭代导致截断到中段而非最近段）。
  const end = parseDbTime(`${weeks[weeks.length - 1]} 00:00:00`);
  const first = parseDbTime(`${weeks[0]} 00:00:00`);
  const start = Math.max(first, end - (MAX_WEEKLY_POINTS - 1) * 7 * DAY_MS);
  const points: TestStatsWeeklyPoint[] = [];
  for (let cursor = start; cursor <= end; cursor += 7 * DAY_MS) {
    const d = new Date(cursor);
    const week = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const b = buckets.get(week);
    points.push({
      weekStart: week,
      tasksCreated: b?.tasksCreated ?? 0,
      casesKept: b?.casesKept ?? 0,
      casesModified: b?.casesModified ?? 0,
      casesRemoved: b?.casesRemoved ?? 0,
      reviewAccuracy: b ? rate(b.reviewAccurate, b.reviewTotal) : null,
    });
  }
  return points;
}

// ---------- 聚合：task detail ----------

export function aggregateTask(events: TestStatsEvent[]): TestStatsTaskDetail | null {
  const accs = buildTaskAccs(events);
  const acc = [...accs.values()][0];
  if (!acc) return null;

  const rounds: TestStatsNodeRound[] = [];
  const finalSnapshot = acc.approved?.final ?? null;
  const brokenHashes = brokenRunHashes(acc);

  for (const step of STEPS) {
    const stepRuns = acc.steps[step];
    const specific: (CasesRoundLite | ExecRunLite | ReportRunLite)[] =
      step === 'cases' ? acc.casesRounds : step === 'execution' ? acc.execRuns : step === 'report' ? acc.reportRuns : [];
    // 时间就近配对（±PAIR_WINDOW_MS），而不是数组下标硬配对：revise 轮只有 cases_generated
    // 没有 step_completed，下标配对会把后续整步重跑的用时/状态错绑到 revise 轮上。
    // 配不上的专属事件独立成轮（用时/状态留空）；配不上的 step_completed 也独立成轮。
    // 最后统一按时间排序编号，保证节点轮次矩阵的列时序单调。
    const used = new Array<boolean>(stepRuns.length).fill(false);
    const items: { at: string | null; base: StepRunLite | null; spec: CasesRoundLite | ExecRunLite | ReportRunLite | null }[] = [];
    for (const spec of specific) {
      let pick = -1;
      for (let j = 0; j < stepRuns.length; j++) {
        if (used[j]) continue;
        if (Math.abs(parseDbTime(stepRuns[j].at) - parseDbTime(spec.at)) <= PAIR_WINDOW_MS) {
          pick = j;
          break;
        }
      }
      if (pick >= 0) used[pick] = true;
      items.push({ at: spec.at, base: pick >= 0 ? stepRuns[pick] : null, spec });
    }
    stepRuns.forEach((sc, j) => {
      if (!used[j]) items.push({ at: sc.at, base: sc, spec: null });
    });
    items.sort((a, b) => parseDbTime(a.at ?? '') - parseDbTime(b.at ?? ''));
    for (let i = 0; i < items.length; i++) {
      const base = items[i].base;
      const spec = items[i].spec;
      const round: TestStatsNodeRound = {
        step,
        round: i + 1,
        at: items[i].at,
        env: null,
        model: base?.model ?? null,
        providerId: base?.providerId ?? null,
        durationMs: base?.durationMs ?? null,
        status: base?.status ?? null,
        caseCount: null,
        adoption: null,
        results: null,
        passRate: null,
        circuitBroken: false,
        runHash: null,
        reviewed: null,
        accuracy: null,
      };
      if (step === 'cases' && spec) {
        const c = spec as CasesRoundLite;
        round.caseCount = c.caseCount ?? c.cases?.length ?? null;
        round.model = c.model ?? round.model;
        if (c.cases && finalSnapshot) {
          const d = diffCases(c.cases, finalSnapshot);
          round.adoption = {
            rate: rate(d.kept + d.modified, c.cases.length),
            kept: d.kept,
            modified: d.modified,
            removed: d.removed,
            added: d.added,
          };
        }
      } else if (step === 'execution' && spec) {
        const e = spec as ExecRunLite;
        round.env = e.env;
        round.model = e.model ?? round.model;
        round.results = e.counts;
        round.passRate = e.counts ? rate(e.counts.pass, e.counts.total) : null;
        round.circuitBroken = e.circuitBroken;
        round.durationMs = e.durationMs ?? round.durationMs;
        round.runHash = e.runHash;
      } else if (step === 'report' && spec) {
        const r = spec as ReportRunLite;
        round.env = r.env;
        round.model = r.model ?? round.model;
        round.runHash = r.runHash;
        if (r.runHash && !brokenHashes.has(r.runHash)) {
          let reviewed = 0;
          let accurate = 0;
          for (const rv of acc.reviews.values()) {
            if (rv.runHash === r.runHash) {
              reviewed++;
              if (rv.verdict === 'accurate') accurate++;
            }
          }
          round.reviewed = reviewed;
          round.accuracy = rate(accurate, reviewed);
        }
      }
      rounds.push(round);
    }
  }

  const review = emptyReview();
  runScopedReview(review, acc, windowOf({}));
  finishReview(review);

  let adoption: TestStatsTaskDetail['adoption'] = null;
  if (isAdoptionEligible(acc) && acc.approved?.diff && acc.casesRounds.length > 0) {
    const baseline = acc.casesRounds[0];
    const generated = baseline.caseCount ?? baseline.cases?.length ?? 0;
    adoption = {
      generated,
      kept: acc.approved.diff.kept,
      modified: acc.approved.diff.modified,
      removed: acc.approved.diff.removed,
      userAdded: acc.approved.diff.added,
      adoptionRate: rate(acc.approved.diff.kept + acc.approved.diff.modified, generated),
      reworkRounds: Math.max(0, acc.casesRounds.length - 1),
    };
  }

  return {
    taskId: acc.taskId,
    taskName: acc.taskName,
    projectPath: acc.projectPath,
    createdAt: acc.createdAt,
    source: acc.source,
    rounds,
    adoption,
    review,
  };
}

// ---------- 聚合：model ----------

interface ModelAcc {
  model: string;
  tasks: Set<string>;
  executionRuns: number;
  adoptionGenerated: number;
  adoptionKeptModified: number;
  results: TestStatsCounts;
  reviewed: number;
  accurate: number;
  reviewableResults: number;
  caseDurations: number[];
}

export function aggregateModels(
  events: TestStatsEvent[],
  range: { from?: string | null; to?: string | null } = {},
): TestStatsModelRow[] {
  const accs = buildTaskAccs(events);
  const w = windowOf(range);
  const models = new Map<string, ModelAcc>();
  const modelAcc = (model: string): ModelAcc => {
    let m = models.get(model);
    if (!m) {
      m = {
        model,
        tasks: new Set(),
        executionRuns: 0,
        adoptionGenerated: 0,
        adoptionKeptModified: 0,
        results: { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 },
        reviewed: 0,
        accurate: 0,
        reviewableResults: 0,
        caseDurations: [],
      };
      models.set(model, m);
    }
    return m;
  };

  for (const acc of accs.values()) {
    // 任务参与度：任一节点在窗内用过该模型
    for (const step of STEPS) {
      for (const s of acc.steps[step]) {
        if (s.model && inWin(s.at, w)) modelAcc(s.model).tasks.add(acc.taskId);
      }
    }
    for (const c of acc.casesRounds) {
      if (c.model && inWin(c.at, w)) modelAcc(c.model).tasks.add(acc.taskId);
    }
    for (const e of acc.execRuns) {
      if (e.model && inWin(e.at, w)) modelAcc(e.model).tasks.add(acc.taskId);
    }

    // 采纳归因：首轮用例设计模型（基线取全上下文，计入与否看批准时间是否在窗内）
    if (
      isAdoptionEligible(acc) &&
      acc.approved?.diff &&
      inWin(acc.approved.at, w) &&
      acc.casesRounds.length > 0
    ) {
      const baseline = acc.casesRounds[0];
      if (baseline.model) {
        const m = modelAcc(baseline.model);
        m.adoptionGenerated += baseline.caseCount ?? baseline.cases?.length ?? 0;
        m.adoptionKeptModified += acc.approved.diff.kept + acc.approved.diff.modified;
      }
    }

    // 执行/复核归因：执行模型（熔断轮只计 runs，不计结果与复核）
    const reviewsByHash = new Map<string, { reviewed: number; accurate: number }>();
    for (const r of acc.reviews.values()) {
      if (!r.runHash) continue;
      const slot = reviewsByHash.get(r.runHash) ?? { reviewed: 0, accurate: 0 };
      slot.reviewed++;
      if (r.verdict === 'accurate') slot.accurate++;
      reviewsByHash.set(r.runHash, slot);
    }
    for (const run of acc.execRuns) {
      if (!run.model || !inWin(run.at, w)) continue;
      const m = modelAcc(run.model);
      m.executionRuns++;
      if (run.circuitBroken) continue;
      if (run.counts) {
        m.results.total += run.counts.total;
        m.results.pass += run.counts.pass;
        m.results.fail += run.counts.fail;
        m.results.partial += run.counts.partial;
        m.results.blocked += run.counts.blocked;
        m.reviewableResults += run.counts.total;
      }
      m.caseDurations.push(...run.caseDurations);
      if (run.runHash) {
        const slot = reviewsByHash.get(run.runHash);
        if (slot) {
          m.reviewed += slot.reviewed;
          m.accurate += slot.accurate;
        }
      }
    }
  }

  const rows: TestStatsModelRow[] = [...models.values()].map((m) => {
    const durSum = m.caseDurations.reduce((a, b) => a + b, 0);
    return {
      model: m.model,
      tasks: m.tasks.size,
      executionRuns: m.executionRuns,
      adoptionGenerated: m.adoptionGenerated,
      adoptionKeptModified: m.adoptionKeptModified,
      adoptionRate: rate(m.adoptionKeptModified, m.adoptionGenerated),
      results: m.results,
      passRate: rate(m.results.pass, m.results.total),
      reviewed: m.reviewed,
      accurate: m.accurate,
      accuracy: rate(m.accurate, m.reviewed),
      coverage: rate(m.reviewed, m.reviewableResults),
      avgCaseDurationMs: m.caseDurations.length
        ? Math.round(durSum / m.caseDurations.length)
        : null,
      smallSample: m.executionRuns < 3 || m.reviewed < 10,
    };
  });
  rows.sort((a, b) => b.executionRuns - a.executionRuns || b.tasks - a.tasks);
  return rows;
}
