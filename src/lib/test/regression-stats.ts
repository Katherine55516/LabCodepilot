import fs from 'fs';
import path from 'path';
import {
  readRounds,
  normalizeStaleRounds,
  roundArtifactPaths,
  buildLastResultLookup,
  type RegressionRound,
} from './rounds';
import { readSuites, evalSuite, REGRESSION_FULL_SUITE, type RegressionSuite } from './suites';
import { readLibrary, readLibMeta } from './library';
import type {
  RegressionStats,
  RegressionWeeklyPoint,
  RegressionScriptPoint,
  RegressionSuiteRow,
} from '@/types';

/**
 * 测试工作台 · 回归测试使用统计（文件态聚合层）。
 *
 * 功能测试统计走 test_stats_events 事件溯源、跨项目「本机」口径（stats.ts）；回归数据的核心
 * 信号（脚本重放 via、熔断 circuitBroken、隔离 quarantined、套件圈选）全在 AI_LabTest/ 下的
 * 文件态、且是事件层不携带的富字段，回归的发版口径又天然是**单项目**问题——故独立聚合、不
 * 复用事件表（决策见 docs/handover/regression-stats.md）。
 *
 * 结构与 stats.ts / case-history.ts 对齐：
 *   - `aggregateRegressionStats(input)` 为**纯函数**（输入已是读好的数据），可 node:test 直测；
 *   - `buildRegressionStats(projectPath)` 负责全部 fs 读取（轮次索引 + 每轮 run.json 摘要 +
 *     套件求值 + 库存活数）再调纯核。
 *
 * 性能护栏（对齐 case-history 的「限流近 N 轮」）：run.json 相关口径（脚本/AI、重放占比、精确
 * 执行量与熔断排除）只读取最近 `REG_RUN_READ_LIMIT` 轮；更早的轮：趋势/套件执行次数/最近通过率
 * 仍走轮次索引里已存的 counts（廉价，无需展开 run.json），用例执行量退化取 counts.total。
 *
 * 口径：running 轮一律排除（counts 未定）；circuitBroken 轮从脚本/AI、重放占比、精确执行量、
 * 最近通过率中排除（认证中途断=结果不可信，对齐 reduce.ts 熔断语义）。比率一律 0-1 小数，分母
 * 为 0 → null。
 */

/** run.json 相关口径只读取最近这么多轮（性能护栏）。 */
export const REG_RUN_READ_LIMIT = 50;
/** 脚本 vs AI 图表最多展示的近轮数。 */
export const REG_SCRIPT_POINTS = 8;
/** 周趋势最多保留的最近周数。 */
export const REG_WEEKS = 8;

/** 某轮 run.json 的执行摘要（脚本/AI × 通过/失败 + 熔断 + 记录数）。 */
export interface RoundRunSummary {
  testCount: number;
  circuitBroken: boolean;
  scriptPass: number;
  scriptFail: number;
  aiPass: number;
  aiFail: number;
}

/** 纯核聚合输入（fs 读取已在 wrapper 完成，便于直测）。 */
export interface RegressionStatsInput {
  projectName: string;
  /** 已惰性收口（stale running → aborted）的全量轮次索引。 */
  rounds: RegressionRound[];
  /** roundId → run.json 摘要（仅近 REG_RUN_READ_LIMIT 轮读取；其余缺省）。 */
  runSummaries: Record<string, RoundRunSummary>;
  /** 套件（不含内置「全量」）。 */
  suites: RegressionSuite[];
  /** 套件名 → 对当前库求值命中数（内置「全量」用键 REGRESSION_FULL_SUITE）。 */
  suiteHitCounts: Record<string, number>;
  /** 库内非隔离条目数（覆盖率分母）。 */
  libAliveCount: number;
}

/* ============ 纯工具 ============ */

function numOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseMs(iso?: string): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** 解析 "pass/total" → 通过率；非法/分母 0 → null。 */
function parsePassStr(s: string): number | null {
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const total = Number(m[2]);
  if (total <= 0) return null;
  return Number(m[1]) / total;
}

/** 某时刻所属 ISO 周的周一（UTC）→ 'YYYY-MM-DD'（与 stats.ts 周分桶同口径）。 */
function isoWeekStartUTC(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  const m = new Date(monday);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${m.getUTCFullYear()}-${p2(m.getUTCMonth() + 1)}-${p2(m.getUTCDate())}`;
}

/** 在最早周与最晚周之间补零周（升序），保留最近 REG_WEEKS 周。 */
function fillWeeks(points: RegressionWeeklyPoint[]): RegressionWeeklyPoint[] {
  if (points.length === 0) return [];
  const sorted = points.slice().sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const byWk = new Map(sorted.map((p) => [p.weekStart, p]));
  const first = Date.parse(`${sorted[0].weekStart}T00:00:00Z`);
  const last = Date.parse(`${sorted[sorted.length - 1].weekStart}T00:00:00Z`);
  const WEEK = 7 * 24 * 3600 * 1000;
  const out: RegressionWeeklyPoint[] = [];
  for (let t = first; t <= last; t += WEEK) {
    const wk = isoWeekStartUTC(t);
    out.push(byWk.get(wk) ?? { weekStart: wk, roundsFull: 0, roundsFailedOnly: 0, caseExecutions: 0 });
  }
  return out.slice(-REG_WEEKS);
}

/** 组装一行套件明细（runsOf 为该套件名的已执行轮，升序）。 */
function buildSuiteRow(
  name: string,
  type: RegressionSuiteRow['type'],
  caseCount: number,
  libraryTotal: number,
  runsOf: RegressionRound[],
  runSummaries: Record<string, RoundRunSummary>,
): RegressionSuiteRow {
  // 最近通过率：newest-first，跳过熔断轮与无结果轮；优先 counts，退化 suitePassStr。
  let latestPassRate: number | null = null;
  let latestPassStr: string | null = null;
  for (let i = runsOf.length - 1; i >= 0; i--) {
    const r = runsOf[i];
    if (r.status !== 'done' && r.status !== 'partial') continue;
    if (runSummaries[r.roundId]?.circuitBroken) continue;
    const c = r.counts;
    if (c && numOf(c.total) > 0) {
      latestPassRate = numOf(c.pass) / numOf(c.total);
      latestPassStr = `${numOf(c.pass)}/${numOf(c.total)}`;
      break;
    }
    if (typeof r.suitePassStr === 'string') {
      const rate = parsePassStr(r.suitePassStr);
      if (rate != null) { latestPassRate = rate; latestPassStr = r.suitePassStr; break; }
    }
  }

  // 平均耗时：有 finishedAt 的轮 finishedAt−startedAt 均值。
  const durs: number[] = [];
  for (const r of runsOf) {
    const a = parseMs(r.startedAt);
    const b = parseMs(r.finishedAt);
    if (a != null && b != null && b > a) durs.push(b - a);
  }
  const avgDurationMs = durs.length ? Math.round(durs.reduce((x, y) => x + y, 0) / durs.length) : null;

  // 重放占比：有 run 摘要且非熔断轮，(script 条数/总条数) 均值。
  const ratios: number[] = [];
  for (const r of runsOf) {
    const s = runSummaries[r.roundId];
    if (!s || s.circuitBroken || s.testCount <= 0) continue;
    ratios.push((s.scriptPass + s.scriptFail) / s.testCount);
  }
  const replayRatio = ratios.length ? ratios.reduce((x, y) => x + y, 0) / ratios.length : null;

  return { name, type, caseCount, libraryTotal, runCount: runsOf.length, latestPassRate, latestPassStr, avgDurationMs, replayRatio };
}

/* ============ 纯核 ============ */

export function aggregateRegressionStats(input: RegressionStatsInput): RegressionStats {
  const { rounds, runSummaries, suites, suiteHitCounts, libAliveCount } = input;

  // 已执行轮（排除 running），升序（旧→新）——供周分桶与位次编号。
  const executed = rounds
    .filter((r) => r.status !== 'running')
    .slice()
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));

  // ---- 周趋势：套件执行（按 mode）+ 用例执行量 ----
  const weekMap = new Map<string, RegressionWeeklyPoint>();
  const ensureWeek = (wk: string): RegressionWeeklyPoint => {
    let p = weekMap.get(wk);
    if (!p) {
      p = { weekStart: wk, roundsFull: 0, roundsFailedOnly: 0, caseExecutions: 0 };
      weekMap.set(wk, p);
    }
    return p;
  };
  for (const r of executed) {
    const ms = parseMs(r.startedAt);
    if (ms == null) continue;
    const p = ensureWeek(isoWeekStartUTC(ms));
    if (r.mode === 'failed-only') p.roundsFailedOnly++;
    else p.roundsFull++;
    const sum = runSummaries[r.roundId];
    if (sum) { if (!sum.circuitBroken) p.caseExecutions += sum.testCount; } // 熔断轮不计入执行量
    else p.caseExecutions += numOf(r.counts?.total);
  }
  const weekly = fillWeeks([...weekMap.values()]);

  // ---- 脚本 vs AI（近 REG_SCRIPT_POINTS 个已执行、非熔断、有 run 摘要的轮） ----
  const scriptVsAi: RegressionScriptPoint[] = executed
    .filter((r) => { const s = runSummaries[r.roundId]; return !!s && !s.circuitBroken; })
    .slice(-REG_SCRIPT_POINTS)
    .map((r) => {
      const s = runSummaries[r.roundId];
      return {
        roundId: r.roundId,
        label: `#${executed.indexOf(r) + 1}`,
        scriptPass: s.scriptPass,
        scriptFail: s.scriptFail,
        aiPass: s.aiPass,
        aiFail: s.aiFail,
      };
    });

  // ---- 套件明细：内置「全量」+ 各用户套件 ----
  const suiteRows: RegressionSuiteRow[] = [];
  const fullRuns = executed.filter((r) => r.suiteName === REGRESSION_FULL_SUITE);
  if (libAliveCount > 0 || fullRuns.length > 0) {
    suiteRows.push(buildSuiteRow(
      REGRESSION_FULL_SUITE,
      'builtin',
      suiteHitCounts[REGRESSION_FULL_SUITE] ?? libAliveCount,
      libAliveCount,
      fullRuns,
      runSummaries,
    ));
  }
  for (const s of suites) {
    const runsOf = executed.filter((r) => r.suiteName === s.name);
    suiteRows.push(buildSuiteRow(s.name, s.type, suiteHitCounts[s.name] ?? 0, libAliveCount, runsOf, runSummaries));
  }

  return {
    projectName: input.projectName,
    totalRounds: executed.length,
    runReadLimit: REG_RUN_READ_LIMIT,
    weekly,
    scriptVsAi,
    suites: suiteRows,
    hasData: executed.length > 0 || suites.length > 0 || libAliveCount > 0,
  };
}

/* ============ fs wrapper ============ */

/**
 * 读某轮 run.json → 执行摘要（缺失/损坏/执行中未产出 → null）。
 *
 * 导出供 regression-rollup.ts（每日上报聚合）复用 —— 脚本/AI 的判定口径（status==='pass'、
 * via==='script'、circuitBroken）只此一处，绝不另写一遍，否则上报数与面板数会悄悄分叉。
 */
export function readRunSummary(projectPath: string, round: RegressionRound): RoundRunSummary | null {
  try {
    const abs = path.join(projectPath, roundArtifactPaths(round.roundId, round.env).runJson);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { tests?: unknown; circuitBroken?: unknown };
    if (!Array.isArray(raw.tests)) return null;
    let scriptPass = 0, scriptFail = 0, aiPass = 0, aiFail = 0, testCount = 0;
    for (const t of raw.tests) {
      if (!t || typeof t !== 'object') continue;
      testCount++;
      const passed = (t as { status?: unknown }).status === 'pass';
      const isScript = (t as { via?: unknown }).via === 'script';
      if (isScript) { if (passed) scriptPass++; else scriptFail++; }
      else { if (passed) aiPass++; else aiFail++; }
    }
    return { testCount, circuitBroken: raw.circuitBroken === true, scriptPass, scriptFail, aiPass, aiFail };
  } catch {
    return null;
  }
}

/** 读取当前项目回归数据并聚合。缺文件/坏数据一律走各读取函数的容错（空/跳过），不抛。 */
export function buildRegressionStats(projectPath: string, now: number = Date.now()): RegressionStats {
  const projectName = path.basename(projectPath.replace(/[\\/]+$/, '')) || projectPath;

  const rounds = normalizeStaleRounds(readRounds(projectPath).rounds, new Date(now));

  // run.json 摘要：仅近 REG_RUN_READ_LIMIT 个已执行轮（run.json 只在执行后落盘）。
  const recentExecuted = rounds
    .filter((r) => r.status !== 'running')
    .slice()
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .slice(0, REG_RUN_READ_LIMIT);
  const runSummaries: Record<string, RoundRunSummary> = {};
  for (const r of recentExecuted) {
    const s = readRunSummary(projectPath, r);
    if (s) runSummaries[r.roundId] = s;
  }

  // 套件命中数（对当前库求值）+ 库存活数。
  const suitesFile = readSuites(projectPath);
  const lib = readLibrary(projectPath);
  const libAliveCount = lib.entries.filter((e) => !readLibMeta(e).quarantined).length;
  const lastResultOf = buildLastResultLookup(projectPath);
  const suiteHitCounts: Record<string, number> = { [REGRESSION_FULL_SUITE]: evalSuite(lib, null).length };
  for (const s of suitesFile.suites) {
    suiteHitCounts[s.name] = evalSuite(lib, s, { lastResultOf }).length;
  }

  return aggregateRegressionStats({
    projectName,
    rounds,
    runSummaries,
    suites: suitesFile.suites,
    suiteHitCounts,
    libAliveCount,
  });
}
