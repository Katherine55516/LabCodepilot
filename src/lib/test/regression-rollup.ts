import fs from 'fs';
import os from 'os';
import path from 'path';

import { readRounds, normalizeStaleRounds, type RegressionRound } from './rounds';
import { readSuites } from './suites';
import { readRunSummary, type RoundRunSummary } from './regression-stats';
import {
  newRegressionCounts,
  type DayUsage,
  type DayUsageProjectRow,
  type RegressionActivity,
  type RegressionProjectFields,
} from './usage-rollup';

/**
 * 测试模块使用统计 · 回归的每日上报聚合（P2）。
 *
 * 功能测试是「事件表 + 机器级」（usage-rollup.ts）；回归是「文件态 + 单项目」——数据全在各项目
 * 的 AI_LabTest/ 下。上报要的是**机器级**口径，故这里要先枚举本机所有测试项目，再逐项目读回归
 * 文件、按北京自然日折叠、跨项目求和。
 *
 * 项目清单来自测试工作台的持久化文件 {dataDir}/test-workbench.json（见 api/test/workbench），
 * 与面板看到的项目列表同源 —— 不另维护一份清单。
 *
 * 口径严格对齐 regression-stats.ts（面板）：
 * - running 轮一律排除（counts 未定）。
 * - 按 startedAt 分桶（面板的周趋势亦按 startedAt）。
 * - 熔断轮（circuitBroken）不计入 case_executions 与 script/AI —— 中途断=结果不可信。
 *   注意它仍会被计进 rounds_full / rounds_failed_only（那是活动量：用户确实发起了这一轮），
 *   与功能测试里「熔断轮计 executions、不计用例级结果」的处置完全一致。
 * - run.json 缺失（老轮次/未落盘）时，case_executions 退化取轮次索引里的 counts.total，
 *   script/AI 则无从得知 → 记 0（与面板同样的退化路径）。
 * - run.json 的解析（status==='pass' / via==='script' / circuitBroken）直接复用 regression-stats
 *   导出的 readRunSummary，绝不另写一遍。
 *
 * suites_count 是**状态**不是活动量：无法回溯「历史某天有几个套件」，故只打在窗口最新一天上
 * （见 usage-rollup.RegressionCounts 注释）。
 */

/** 每日/每项目的回归活动量（7 项，可累加）。 */
function newActivity(): RegressionActivity {
  return {
    rounds_full: 0,
    rounds_failed_only: 0,
    case_executions: 0,
    script_pass: 0,
    script_fail: 0,
    ai_pass: 0,
    ai_fail: 0,
  };
}

function addActivity(dst: RegressionActivity, src: RegressionActivity): void {
  dst.rounds_full += src.rounds_full;
  dst.rounds_failed_only += src.rounds_failed_only;
  dst.case_executions += src.case_executions;
  dst.script_pass += src.script_pass;
  dst.script_fail += src.script_fail;
  dst.ai_pass += src.ai_pass;
  dst.ai_fail += src.ai_fail;
}

function numOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** ISO 时间串 → 北京自然日 'YYYY-MM-DD'；不可解析 → null。 */
function beijingDayOf(iso: string | undefined, offsetMin: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);
}

/* ============ 纯核（可 node:test 直测） ============ */

/** 单项目的回归输入（fs 读取已在 wrapper 完成）。 */
export interface RegressionRollupProject {
  /** 项目全路径（作为 project 唯一键） */
  project: string;
  /** 末段名（展示用） */
  name: string;
  /** 已惰性收口的轮次索引 */
  rounds: RegressionRound[];
  /** roundId → run.json 摘要（缺失表示未读到） */
  runSummaries: Record<string, RoundRunSummary>;
}

/** 聚合过程中的按项目回归行（合并进 DayUsage.payload.projects 时才改写成 reg_* 列名）。 */
export interface RegressionProjectRow extends RegressionActivity {
  project: string;
  name: string;
}

export interface RegressionDailyResult {
  /** 北京日 → { 跨项目合计, 按项目明细 } */
  byDay: Map<string, { totals: RegressionActivity; projects: RegressionProjectRow[] }>;
}

/** 活动量 → 服务端列名（reg_*）。projects[] 里必须用列名，服务端才能直接按列名求和。 */
function toRegProjectFields(a: RegressionActivity): RegressionProjectFields {
  return {
    reg_rounds_full: a.rounds_full,
    reg_rounds_failed_only: a.rounds_failed_only,
    reg_case_executions: a.case_executions,
    reg_script_pass: a.script_pass,
    reg_script_fail: a.script_fail,
    reg_ai_pass: a.ai_pass,
    reg_ai_fail: a.ai_fail,
  };
}

export interface AggregateRegressionDailyOptions {
  tzOffsetMinutes?: number;
}

/**
 * 逐项目 × 逐轮次 → 按北京自然日折叠。轮次是「增量型」事件（一轮 = 一次发生的执行），
 * 直接累加即可 —— 不存在功能测试里 cases_approved 那种「状态型」重复上报的问题。
 */
export function aggregateRegressionDaily(
  projects: RegressionRollupProject[],
  opts: AggregateRegressionDailyOptions = {},
): RegressionDailyResult {
  const offsetMin = opts.tzOffsetMinutes ?? 480;
  const byDay = new Map<string, { totals: RegressionActivity; projects: RegressionProjectRow[] }>();

  for (const proj of projects) {
    for (const r of proj.rounds) {
      if (r.status === 'running') continue; // 执行中：counts 未定，排除（同面板）
      const date = beijingDayOf(r.startedAt, offsetMin);
      if (!date) continue;

      const act = newActivity();
      // 轮次数：熔断轮同样计入（活动量 —— 用户确实发起了这一轮）
      if (r.mode === 'failed-only') act.rounds_failed_only += 1;
      else act.rounds_full += 1;

      const sum = proj.runSummaries[r.roundId];
      if (sum) {
        // 熔断轮：结果不可信 → 不计执行量与脚本/AI（同面板）
        if (!sum.circuitBroken) {
          act.case_executions += sum.testCount;
          act.script_pass += sum.scriptPass;
          act.script_fail += sum.scriptFail;
          act.ai_pass += sum.aiPass;
          act.ai_fail += sum.aiFail;
        }
      } else {
        // 无 run.json（老轮/未落盘）：执行量退化取索引里的 counts.total；脚本/AI 无从得知 → 0
        act.case_executions += numOf(r.counts?.total);
      }

      let bucket = byDay.get(date);
      if (!bucket) {
        bucket = { totals: newActivity(), projects: [] };
        byDay.set(date, bucket);
      }
      addActivity(bucket.totals, act);

      let row = bucket.projects.find((p) => p.project === proj.project);
      if (!row) {
        row = { project: proj.project, name: proj.name, ...newActivity() };
        bucket.projects.push(row);
      }
      addActivity(row, act);
    }
  }

  // 项目明细按全路径排序，输出稳定
  for (const b of byDay.values()) {
    b.projects.sort((a, c) => (a.project < c.project ? -1 : a.project > c.project ? 1 : 0));
  }
  return { byDay };
}

/**
 * 把回归结果并进功能测试的 days[]（两侧日期取并集：只有回归活动、没有功能事件的那天也要出现）。
 *
 * @param latestDate 窗口最新一天（'YYYY-MM-DD'）；快照（suites_count / tasks_total）只打在这一天。
 * @param tasksTotal 累计曾创建的任务数（机器级全历史快照）；同 suites_count 只打最新一天。
 */
export function mergeRegressionIntoDays(
  days: DayUsage[],
  reg: RegressionDailyResult,
  suitesCount: number,
  latestDate: string,
  tasksTotal: number,
): DayUsage[] {
  const byDate = new Map<string, DayUsage>(days.map((d) => [d.date, d]));

  for (const [date, bucket] of reg.byDay) {
    let day = byDate.get(date);
    if (!day) {
      // 该天只有回归活动、无功能事件 → 造一个全 0 的功能壳
      day = emptyDay(date);
      byDate.set(date, day);
    }
    day.regression = { ...bucket.totals, suites_count: 0 };

    // 回归的按项目明细并进**同一个** projects[]（键=项目全路径）：该项目当天可能只有回归活动、
    // 没有功能事件 → 补一个功能计数全 0 的行。服务端下钻时一次 unnest 即可同时拿到两侧。
    for (const rp of bucket.projects) {
      let row = day.payload.projects.find((p) => p.project === rp.project);
      if (!row) {
        row = { project: rp.project, name: rp.name, ...zeroCounts() };
        day.payload.projects.push(row);
      }
      Object.assign(row, toRegProjectFields(rp));
    }
    day.payload.projects.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
  }

  // 快照类（套件总数 / 累计任务总数）都是当前值 → 只打在最新一天（该天可能本来没有任何活动，也要建壳承载）
  if (suitesCount > 0 || tasksTotal > 0) {
    let day = byDate.get(latestDate);
    if (!day) {
      day = emptyDay(latestDate);
      byDate.set(latestDate, day);
    }
    if (suitesCount > 0) day.regression.suites_count = suitesCount;
    if (tasksTotal > 0) day.tasks_total = tasksTotal;
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 功能计数全 0（该天/该项目只有回归活动时的占位）。 */
function zeroCounts() {
  return {
    tasks_created: 0,
    cases_generated: 0,
    cases_generated_first_round: 0,
    cases_adopted: 0,
    cases_approved: 0,
    executions: 0,
    cases_executed: 0,
    cases_passed: 0,
    cases_failed: 0,
    reviews: 0,
    reviews_accurate: 0,
  };
}

/** 全 0 的一天（只有回归活动、或只承载 suites_count / tasks_total 快照时用）。 */
function emptyDay(date: string): DayUsage {
  return {
    date,
    ...zeroCounts(),
    tasks_total: 0,
    case_duration_ms_sum: 0,
    case_duration_samples: 0,
    regression: newRegressionCounts(),
    payload: {
      exec: { partial: 0, blocked: 0, circuit_broken: 0, avg_case_duration_ms: 0 },
      adoption: { kept: 0, modified: 0, added: 0, removed: 0 },
      reviews_detail: { false_fail: 0, missed_fail: 0, severity_mismatch: 0 },
      models: [],
      projects: [],
    },
  };
}

/* ============ fs wrapper ============ */

/** 测试工作台持久化文件（与 api/test/workbench 同源）。 */
function workbenchFile(): string {
  const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
  return path.join(dataDir, 'test-workbench.json');
}

/** 本机所有测试项目的路径（去重）。缺文件/坏 JSON → []（不抛，同 workbench 路由的容错）。 */
export function listWorkbenchProjectPaths(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(workbenchFile(), 'utf-8')) as { projects?: unknown };
    const arr = Array.isArray(raw.projects) ? raw.projects : [];
    const out: string[] = [];
    for (const p of arr) {
      const pp = (p as { path?: unknown })?.path;
      if (typeof pp === 'string' && pp && !out.includes(pp)) out.push(pp);
    }
    return out;
  } catch {
    return [];
  }
}

/** 读一批项目的回归数据并按天折叠。窗口 [from,to] 为北京自然日，含端点。 */
export function buildRegressionDailyRollup(
  projectPaths: string[],
  from: string,
  to: string,
  now: number = Date.now(),
  tzOffsetMinutes = 480,
): { reg: RegressionDailyResult; suitesCount: number } {
  const inputs: RegressionRollupProject[] = [];
  let suitesCount = 0;

  for (const projectPath of projectPaths) {
    // 套件数：当前快照，跨项目累加
    try {
      suitesCount += readSuites(projectPath).suites.length;
    } catch {
      /* 缺文件/坏 JSON → 记 0（readSuites 本身已容错，这里再兜一层） */
    }

    const rounds = normalizeStaleRounds(readRounds(projectPath).rounds, new Date(now));
    // 只处理窗口内的已执行轮 —— 上报窗口通常只有 1~2 天，不必像面板那样读"近 50 轮"
    const inWindow = rounds.filter((r) => {
      if (r.status === 'running') return false;
      const d = beijingDayOf(r.startedAt, tzOffsetMinutes);
      return !!d && d >= from && d <= to;
    });
    if (inWindow.length === 0) continue;

    const runSummaries: Record<string, RoundRunSummary> = {};
    for (const r of inWindow) {
      const s = readRunSummary(projectPath, r);
      if (s) runSummaries[r.roundId] = s;
    }

    inputs.push({
      project: projectPath,
      name: path.basename(projectPath.replace(/[\\/]+$/, '')) || projectPath,
      rounds: inWindow,
      runSummaries,
    });
  }

  return {
    reg: aggregateRegressionDaily(inputs, { tzOffsetMinutes }),
    suitesCount,
  };
}
