/**
 * 定时任务调度循环(P3)。
 *
 * 60 秒 tick,与现有空闲回收器(index.mjs 的 reaper)同频。每 tick:
 *   扫全部用户的 routine → 到点且 enabled 的 → 过配额闸 → 交给 runner。
 *
 * 三条与「无人值守」直接相关的设计:
 *
 * ① **补跑只补最近一次。** 服务重启/宕机跨过了 N 次触发点时,只跑最近的那次,更早的
 *    记 skipped 并注明原因。照抄 Claude Desktop 的语义 —— 相反的做法(全补)会让
 *    「服务停了三天」变成「一开机连跑 72 次」,既烧钱又让用户看到一堆过期结果。
 *
 * ② **skipped 也要落历史并给原因**(配额满 / 并发满 / 上次还没跑完 / 补跑丢弃)。
 *    没有这条记录,用户只能看到「今天怎么没跑」,无从判断是坏了还是被限了。
 *
 * ③ **同一 routine 绝不并行。** 上一次还在跑就跳过 —— 它们共享同一个持久工作区(D2),
 *    并行会互相踩文件。
 */
import { runRoutine, activeCount, CONCURRENCY } from './routine-runner.mjs';
import * as store from './routine-store.mjs';
import { getNextCronTime, getJitterMs } from './routine-cron.mjs';

const TICK_MS = parseInt(process.env.COWORK_ROUTINE_TICK_MS || '60000', 10);
/** 补跑窗口:超过这个时长的错过不再补,只记 skipped(与 Claude Desktop 的 7 天一致)。 */
const CATCHUP_WINDOW_MS = parseInt(process.env.COWORK_ROUTINE_CATCHUP_WINDOW_MS || String(7 * 24 * 3600_000), 10);
/** 连续失败到这个数就自动停用(D11)。 */
const MAX_CONSECUTIVE_ERRORS = parseInt(process.env.COWORK_ROUTINE_MAX_ERRORS || '10', 10);

/** 正在跑的 routine id —— 防同一 routine 并行(设计 ③)。 */
const inFlight = new Set();
let timer = null;

// 配额「今天」的定义已挪进 store(REST 显示剩余额度也要用同一个)——
// 两处各写一份会让界面说的和实际拦的对不上,且只在跨日边界露馅。
const todayStartIso = store.todayStartIso;

/**
 * 算下一次触发时刻(含抖动)。返回 ISO 串或 null(= 不再触发)。
 *
 * 抖动加在触发时刻上、但**下一次仍从真实 cron 基准重算**(cron 是绝对时刻),
 * 所以不会逐次累积漂移。
 */
export function computeNextRun(routine, from = new Date()) {
  const s = routine.schedule || {};
  if (s.kind === 'manual') return null;
  if (s.kind === 'once') {
    const t = Date.parse(s.fireAt || '');
    if (!Number.isFinite(t)) return null;
    return t > from.getTime() ? new Date(t).toISOString() : null;
  }
  if (s.kind === 'cron') {
    const base = getNextCronTime(s.expr, s.tz || 'UTC', from);
    if (!base) return null;
    return new Date(base.getTime() + getJitterMs(routine.id)).toISOString();
  }
  return null;
}

/** 记一条 skipped 历史。**不消耗配额**(见 store.countRunsSince 的注释)。 */
function recordSkip(r, reason, detail = '') {
  store.appendRun(r.uid, r.id, {
    runId: store.newRunId(),
    startedAt: new Date().toISOString(),
    status: 'skipped',
    skipReason: reason,
    error: detail,
    durationMs: 0,
  });
}

/**
 * 启动时的补跑判定。返回 'run'(补跑一次)/ 'discard'(太久,丢弃)/ 'none'(没错过)。
 * 只在进程启动后的第一个 tick 用。
 */
export function catchupDecision(routine, now = new Date()) {
  const next = Date.parse(routine.nextRunAt || '');
  if (!Number.isFinite(next) || next > now.getTime()) return 'none';
  return now.getTime() - next <= CATCHUP_WINDOW_MS ? 'run' : 'discard';
}

async function fire(r, { log, activity }) {
  inFlight.add(r.id);
  const runId = store.newRunId();
  const startedAt = new Date().toISOString();
  try {
    const res = await runRoutine({
      sid: r.id, uid: r.uid, prompt: r.prompt, model: r.model, configId: r.configId,
      transcriptPath: store.transcriptFile(runId),
      activity, log,
    });

    // 并发闸拦下的不算一次运行:不推进 nextRunAt(下个 tick 再试)、不动失败计数。
    if (res.status === 'skipped') {
      recordSkip(r, res.skipReason || 'concurrency_limit');
      return;
    }

    store.appendRun(r.uid, r.id, {
      runId, startedAt,
      finishedAt: new Date().toISOString(),
      status: res.status,
      ok: !!res.ok,
      durationMs: res.durationMs ?? 0,
      costUsd: res.costUsd ?? null,
      numTurns: res.numTurns ?? null,
      exitCode: res.exitCode ?? null,
      apiErrorStatus: res.apiErrorStatus ?? null,
      resultText: (res.resultText || '').slice(0, 2000),
      error: res.error || '',
      model: r.model || '',
      configId: res.configId || r.configId || '',
    });

    const fresh = store.getRoutine(r.uid, r.id) || r;   // 期间可能被用户改过,以盘上为准
    fresh.lastRunAt = startedAt;
    fresh.lastStatus = res.status;
    fresh.consecutiveErrors = res.ok ? 0 : (fresh.consecutiveErrors || 0) + 1;

    if (fresh.schedule?.kind === 'once') {
      // 一次性任务触发后自动停用并标记「已运行」(D10,照抄 Claude 的 "Ran")
      fresh.enabled = false;
      fresh.ranAt = startedAt;
      fresh.nextRunAt = null;
    } else if (fresh.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      fresh.enabled = false;
      fresh.disabledReason = `连续失败 ${fresh.consecutiveErrors} 次,已自动停用`;
      fresh.nextRunAt = null;
      log(`routine ${r.id} auto-disabled after ${fresh.consecutiveErrors} failures`);
    } else {
      fresh.nextRunAt = computeNextRun(fresh);
    }
    store.saveRoutine(fresh);
  } catch (e) {
    log(`routine ${r.id} scheduler error: ${e.message}`);
  } finally {
    inFlight.delete(r.id);
  }
}

/**
 * 立即运行(REST 的 /routines/:id/run)。与定时触发**走同一条 fire**,
 * 所以配额记账、失败计数、once 自动停用的语义完全一致 —— 不另开一条会漂移的路径。
 * 返回 { started: boolean, reason?: string }。
 */
export async function runNow(r, { log = () => {}, activity } = {}) {
  if (inFlight.has(r.id)) return { started: false, reason: 'previous_run_in_progress' };
  if (activeCount() >= CONCURRENCY) return { started: false, reason: 'concurrency_limit' };
  const used = store.countRunsSince(r.uid, todayStartIso());
  if (used >= store.DAILY_RUN_CAP) return { started: false, reason: 'daily_quota_exceeded' };
  void fire(r, { log, activity });
  return { started: true };
}

/** 跑一次 tick。导出是为了单测和「立即对账」,生产由 start() 定时调。 */
export async function tick({ log = () => {}, activity, now = new Date(), firstTick = false } = {}) {
  let fired = 0;
  const dayStart = todayStartIso();
  const quotaCache = new Map();

  for (const r of store.listAllRoutines()) {
    if (!r.enabled || !r.nextRunAt) continue;
    if (Date.parse(r.nextRunAt) > now.getTime()) continue;

    // ③ 同一 routine 不并行 —— 它们共享同一个持久工作区
    if (inFlight.has(r.id)) { recordSkip(r, 'previous_run_in_progress'); continue; }

    // ① 补跑:只在进程起来后的第一个 tick 判定;错过太久的直接丢弃并推进到下一次
    if (firstTick && catchupDecision(r, now) === 'discard') {
      recordSkip(r, 'missed_too_long', `错过时间 ${r.nextRunAt},超出 ${Math.round(CATCHUP_WINDOW_MS / 3600_000)} 小时补跑窗口`);
      r.nextRunAt = computeNextRun(r, now);
      store.saveRoutine(r);
      continue;
    }

    // 日配额(D8)。逐用户只算一次,避免同一 tick 内重复扫历史。
    if (!quotaCache.has(r.uid)) quotaCache.set(r.uid, store.countRunsSince(r.uid, dayStart));
    const used = quotaCache.get(r.uid);
    if (used >= store.DAILY_RUN_CAP) {
      recordSkip(r, 'daily_quota_exceeded', `今日已用 ${used}/${store.DAILY_RUN_CAP}`);
      // 推进 nextRunAt:不推的话下个 tick 会再判一次、再记一条 skipped,刷屏
      r.nextRunAt = computeNextRun(r, now);
      store.saveRoutine(r);
      continue;
    }

    if (activeCount() >= CONCURRENCY) {
      // 不推进 nextRunAt —— 下个 tick 再试(与配额不同:这是暂时性的)
      log(`routine ${r.id} deferred: concurrency ${activeCount()}/${CONCURRENCY}`);
      continue;
    }

    quotaCache.set(r.uid, used + 1);
    fired++;
    void fire(r, { log, activity });   // 不 await:一个慢任务不该卡住整个 tick
  }
  return { fired };
}

export function start({ log = () => {}, activity } = {}) {
  if (timer) return;
  store.ensureStateDir();
  let first = true;
  const run = () => {
    tick({ log, activity, firstTick: first })
      .catch((e) => log(`routine tick error: ${e.message}`))
      .finally(() => { first = false; });
  };
  run();                                   // 启动即跑一次(承载补跑判定)
  timer = setInterval(run, TICK_MS);
  timer.unref?.();
  log(`routine scheduler started (tick=${TICK_MS}ms concurrency=${CONCURRENCY} dailyCap=${store.DAILY_RUN_CAP})`);
}

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

export const _internals = { inFlight, TICK_MS, CATCHUP_WINDOW_MS, MAX_CONSECUTIVE_ERRORS, todayStartIso };
