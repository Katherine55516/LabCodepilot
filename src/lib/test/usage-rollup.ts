import type { TestStatsEvent } from '@/types';

/**
 * 测试模块使用统计 · 每日上报滚动汇总（纯函数层）。
 *
 * 把本地 test_stats_events 事件流按「北京时区自然日」折叠成 DayUsage[]，用于上传 codeagent-server。
 * 与 src/lib/test/stats.ts 的聚合口径同源（面板怎么算，这里就怎么算），因为服务端只做 SUM、
 * 不再二次归因：管理端 KPI 必须与用户本地 Stats 面板对得上。
 *
 * 两类事件必须分开处理（这是本模块最容易错的地方）：
 * - 「增量型」task_created / cases_generated / execution_completed —— 每条都是一次新发生的活动，直接累加。
 * - 「状态型」cases_approved / report_reviewed / report_review_bulk —— 每条携带的是「当前全量状态」
 *   （如 cases_approved.finalCount 是该任务定稿后的**总**用例数）。同一任务/用例反复批准或复核会
 *   重复发事件，**直接求和会成倍膨胀**（真实数据里同一任务一天内批准 3 次 → 采纳数 ×3，采纳率 294%）。
 *   故按 last-wins 折叠后再计数，与 stats.ts 同口径：
 *     · cases_approved  → key = taskId（日内取最后一条）
 *     · report_reviewed → key = `${runHash}|${caseId}`（日内取最后一条；verdict='cleared' 撤销 → 删除）
 *       无 caseId 的复核事件忽略（stats.ts 亦 `if (!caseId) break`）。
 *     · report_review_bulk → 每个 caseId 写入同一张 map，视为一条 accurate 复核（与 stats.ts 一致），
 *       与单条复核天然去重。
 *
 * 熔断轮（circuitBroken）口径：
 * - executions（执行轮次）计入 —— 用户确实发起了这次执行，属活动量。
 * - cases_executed/passed/failed、exec.partial/blocked、时长均值「不」计入 —— 熔断轮的用例级结果
 *   是残缺的（与 stats.ts 的结果口径一致），据此保证 pass_rate 与本地 Stats 面板一致。
 *   服务端只拿到求和值、无法再按轮次剔除，故排除必须在这里做。
 * - 熔断轮数量单独由 payload.exec.circuit_broken 标注，供管理端识别。
 *
 * 仍有意偏离 stats.ts 之处：last-wins 只在「日内」折叠（stats.ts 是跨全历史）。同一任务跨天反复
 * 批准，会在各自那天各计一次 —— 这是每日分桶不可避免的，且符合「那天用户确实又定稿了一次」的活动语义。
 *
 * 纯函数：不 import fs/db/electron，只依赖类型 —— 可在 node:test 下直接单测。
 * 事件时间 created_at 为 UTC 'YYYY-MM-DD HH:MM:SS'，转北京日 = 加 tzOffsetMinutes(默认 480=UTC+8) 后取日期。
 */

// ---------- 冻结契约类型（字段名与服务端约定一致，勿改） ----------

/** 每日 11 个计数字段；DayUsage / 每模型行 / 每项目行共用。 */
export interface UsageCounts {
  tasks_created: number;
  cases_generated: number;
  cases_generated_first_round: number;
  cases_adopted: number;
  cases_approved: number;
  executions: number;
  cases_executed: number;
  cases_passed: number;
  cases_failed: number;
  reviews: number;
  reviews_accurate: number;
}

export interface DayUsageModelRow extends UsageCounts {
  model: string;
}

export interface DayUsageProjectRow extends UsageCounts {
  project: string;
  name?: string;
}

export interface DayUsagePayload {
  exec: {
    partial: number;
    blocked: number;
    circuit_broken: number;
    avg_case_duration_ms: number;
  };
  adoption: { kept: number; modified: number; added: number; removed: number };
  reviews_detail: { false_fail: number; missed_fail: number; severity_mismatch: number };
  models: DayUsageModelRow[];
  projects: DayUsageProjectRow[];
}

/** 单个北京自然日的使用量汇总（服务端上报契约，字段名冻结）。 */
export interface DayUsage extends UsageCounts {
  /** 'YYYY-MM-DD'（北京日） */
  date: string;
  payload: DayUsagePayload;
}

export interface BuildDailyRollupOptions {
  /** 北京时区相对 UTC 的分钟偏移，默认 480（UTC+8）。 */
  tzOffsetMinutes?: number;
}

// ---------- 窄化小工具（镜像 stats.ts；防御性，绝不抛错） ----------

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

/** 末段路径名（不引入 path，保持零依赖可单测）；兼容 / 与 \\ 及尾部分隔符。 */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

// ---------- 时间：UTC created_at → 北京自然日 ----------

/** UTC 'YYYY-MM-DD HH:MM:SS'（或带 T/Z）→ epoch ms；解析失败返回 0。镜像 stats.ts parseDbTime。 */
function toEpochMsUtc(s: string): number {
  if (!s) return 0;
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (!Number.isNaN(t)) return t;
  const t2 = Date.parse(s);
  return Number.isNaN(t2) ? 0 : t2;
}

/** created_at(UTC) + 偏移 → 北京日 'YYYY-MM-DD'。例：UTC 2026-07-14 16:30 → 2026-07-15。 */
function beijingDay(createdAt: string, offsetMin: number): string {
  const shifted = new Date(toEpochMsUtc(createdAt) + offsetMin * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------- 累加器 ----------

type Verdict = 'accurate' | 'false_fail' | 'missed_fail' | 'severity_mismatch';

/** cases_approved 的「当前状态」（同一任务日内取最后一条）。 */
interface ApprovalState {
  finalCount: number;
  kept: number;
  modified: number;
  added: number;
  removed: number;
}

/**
 * 一个统计范围（日级 / 单项目）的累加器：
 * 增量型事件直接进 counts；状态型事件进 map（last-wins），最后由 foldStateful 折算进 counts。
 */
interface ScopeAcc {
  counts: UsageCounts;
  /** key = taskId */
  approvals: Map<string, ApprovalState>;
  /** key = `${runHash}|${caseId}` */
  reviews: Map<string, Verdict>;
}

interface DayAcc {
  date: string;
  scope: ScopeAcc;
  exec: { partial: number; blocked: number; circuit_broken: number; durSum: number; durCount: number };
  /** 模型行：只有 cases_generated / execution_completed 带 model，故不含批准/复核 */
  models: Map<string, UsageCounts>;
  projects: Map<string, { scope: ScopeAcc; name: string }>;
}

function newCounts(): UsageCounts {
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

function newScope(): ScopeAcc {
  return { counts: newCounts(), approvals: new Map(), reviews: new Map() };
}

function newDayAcc(date: string): DayAcc {
  return {
    date,
    scope: newScope(),
    exec: { partial: 0, blocked: 0, circuit_broken: 0, durSum: 0, durCount: 0 },
    models: new Map(),
    projects: new Map(),
  };
}

/** 增量型事件 → 计数累加（day / model / project 共用）。状态型事件在这里一律不处理。 */
function accumulateIncremental(c: UsageCounts, ev: TestStatsEvent): void {
  const p = asObj(ev.payload) ?? {};
  switch (ev.eventType) {
    case 'task_created':
      c.tasks_created += 1;
      break;
    case 'cases_generated': {
      const n = asNum(p.caseCount) ?? 0;
      c.cases_generated += n;
      if (asNum(p.round) === 1) c.cases_generated_first_round += n;
      break;
    }
    case 'execution_completed': {
      // 执行轮次是活动量：熔断轮同样计一次（用户确实发起了这次执行）。
      c.executions += 1;
      // 但熔断轮的用例级结果残缺 → 不计入（与 stats.ts 结果口径一致）。
      if (p.circuitBroken !== true) {
        const counts = asObj(p.counts);
        if (counts) {
          c.cases_executed += asNum(counts.total) ?? 0;
          c.cases_passed += asNum(counts.pass) ?? 0;
          c.cases_failed += asNum(counts.fail) ?? 0;
        }
      }
      break;
    }
    default:
      break;
  }
}

/** 状态型事件 → last-wins 写入 scope 的 map（事件按时间升序遍历，后来者覆盖前者）。 */
function accumulateStateful(s: ScopeAcc, ev: TestStatsEvent): void {
  const p = asObj(ev.payload) ?? {};
  if (ev.eventType === 'cases_approved') {
    const diff = asObj(p.diff) ?? {};
    s.approvals.set(ev.taskId ?? '', {
      finalCount: asNum(p.finalCount) ?? 0,
      kept: asNum(diff.kept) ?? 0,
      modified: asNum(diff.modified) ?? 0,
      added: asNum(diff.added) ?? 0,
      removed: asNum(diff.removed) ?? 0,
    });
  } else if (ev.eventType === 'report_reviewed') {
    const caseId = asStr(p.caseId);
    if (!caseId) return; // 无 caseId 无法去重 → 忽略（stats.ts 同）
    const key = `${asStr(p.runHash) ?? ''}|${caseId}`;
    const v = p.verdict;
    if (v === 'cleared') {
      s.reviews.delete(key); // 撤销：last-wins 删除
    } else if (
      v === 'accurate' ||
      v === 'false_fail' ||
      v === 'missed_fail' ||
      v === 'severity_mismatch'
    ) {
      s.reviews.set(key, v);
    }
    // 无 verdict / 词表外：忽略
  } else if (ev.eventType === 'report_review_bulk') {
    // 一键全准：每个 caseId 视为一条 accurate 复核，写同一张 map → 与单条复核天然去重
    const runHash = asStr(p.runHash) ?? '';
    for (const cid of asArr(p.caseIds) ?? []) {
      const c = asStr(cid);
      if (c) s.reviews.set(`${runHash}|${c}`, 'accurate');
    }
  }
}

/** last-wins map → 折算进 counts（批准/采纳、复核数/准确数）。 */
function foldStateful(s: ScopeAcc): void {
  for (const a of s.approvals.values()) {
    s.counts.cases_approved += a.finalCount;
    s.counts.cases_adopted += a.kept + a.modified; // 采纳 = 原样保留 + 修改后保留
  }
  s.counts.reviews += s.reviews.size;
  for (const v of s.reviews.values()) {
    if (v === 'accurate') s.counts.reviews_accurate += 1;
  }
}

function byKeyAsc(a: [string, unknown], b: [string, unknown]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

function finalizeDay(day: DayAcc): DayUsage {
  // 折算日级与各项目的状态型事件
  foldStateful(day.scope);
  for (const p of day.projects.values()) foldStateful(p.scope);

  // 日级 adoption / reviews_detail 同样从 last-wins map 出（不能逐事件累加，否则重复批准会翻倍）
  const adoption = { kept: 0, modified: 0, added: 0, removed: 0 };
  for (const a of day.scope.approvals.values()) {
    adoption.kept += a.kept;
    adoption.modified += a.modified;
    adoption.added += a.added;
    adoption.removed += a.removed;
  }
  const reviews_detail = { false_fail: 0, missed_fail: 0, severity_mismatch: 0 };
  for (const v of day.scope.reviews.values()) {
    if (v === 'false_fail') reviews_detail.false_fail += 1;
    else if (v === 'missed_fail') reviews_detail.missed_fail += 1;
    else if (v === 'severity_mismatch') reviews_detail.severity_mismatch += 1;
  }

  const models: DayUsageModelRow[] = [...day.models.entries()]
    .sort(byKeyAsc)
    .map(([model, c]) => ({ model, ...c }));
  const projects: DayUsageProjectRow[] = [...day.projects.entries()]
    .sort(byKeyAsc)
    .map(([project, { scope, name }]) => ({ project, name, ...scope.counts }));

  return {
    date: day.date,
    ...day.scope.counts,
    payload: {
      exec: {
        partial: day.exec.partial,
        blocked: day.exec.blocked,
        circuit_broken: day.exec.circuit_broken,
        avg_case_duration_ms:
          day.exec.durCount > 0 ? Math.round(day.exec.durSum / day.exec.durCount) : 0,
      },
      adoption,
      reviews_detail,
      models,
      projects,
    },
  };
}

/**
 * 事件流 → 按北京自然日的滚动汇总。日期升序返回。
 *
 * 内部先按 createdAt 升序稳定排序：状态型事件靠 last-wins 去重，顺序是语义的一部分，
 * 不能依赖调用方传入顺序（DB 查询虽已升序，这里再兜一层，保证纯函数自洽）。
 * 只比时间、不比 id —— Array.sort 是稳定排序，同秒事件因此保留传入顺序，即 DB 的
 * (created_at, rowid) 次序，与 stats.ts 的 last-wins 判定一致。
 *
 * @param events DB 行视图（payload 已解析）；空数组返回 []。
 * @param opts.tzOffsetMinutes 默认 480（UTC+8）。
 */
export function buildDailyRollup(
  events: TestStatsEvent[],
  opts: BuildDailyRollupOptions = {},
): DayUsage[] {
  const offsetMin = opts.tzOffsetMinutes ?? 480;

  const ordered = events
    .filter((e): e is TestStatsEvent => !!e)
    .slice()
    .sort((a, b) => toEpochMsUtc(a.createdAt) - toEpochMsUtc(b.createdAt));

  const days = new Map<string, DayAcc>();
  for (const ev of ordered) {
    const date = beijingDay(ev.createdAt, offsetMin);
    let day = days.get(date);
    if (!day) {
      day = newDayAcc(date);
      days.set(date, day);
    }

    // 日级
    accumulateIncremental(day.scope.counts, ev);
    accumulateStateful(day.scope, ev);

    // 日级 exec 扩展（四态 / 熔断 / 时长）
    if (ev.eventType === 'execution_completed') {
      const p = asObj(ev.payload) ?? {};
      const broken = p.circuitBroken === true;
      if (broken) day.exec.circuit_broken += 1;
      if (!broken) {
        const counts = asObj(p.counts);
        if (counts) {
          day.exec.partial += asNum(counts.partial) ?? 0;
          day.exec.blocked += asNum(counts.blocked) ?? 0;
        }
        for (const t of asArr(p.tests) ?? []) {
          const d = asNum(asObj(t)?.durationMs);
          if (d !== null && d > 0) {
            day.exec.durSum += d;
            day.exec.durCount += 1;
          }
        }
      }
    }

    // 每项目分组：全路径为 key（唯一），name 取末段
    const projKey = ev.projectPath || '';
    let proj = day.projects.get(projKey);
    if (!proj) {
      proj = { scope: newScope(), name: basename(projKey) };
      day.projects.set(projKey, proj);
    }
    accumulateIncremental(proj.scope.counts, ev);
    accumulateStateful(proj.scope, ev);

    // 每模型分组：仅携带 model 的事件（生成/执行）计入；批准/复核无 model
    const model = asStr(asObj(ev.payload)?.model)?.trim();
    if (model) {
      let m = day.models.get(model);
      if (!m) {
        m = newCounts();
        day.models.set(model, m);
      }
      accumulateIncremental(m, ev);
    }
  }

  return [...days.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(finalizeDay);
}
