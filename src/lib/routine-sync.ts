/**
 * routine-sync.ts —— 把服务端的定时运行拉回本地并物化成会话(P5)。
 *
 * 定时任务跑在沙箱服务器上,客户端关着也照跑。所以客户端要做的是**事后对账**:
 * 拉运行记录 → 取原文 → 重放成本地会话 → 汇总告诉用户「你不在时发生了什么」。
 *
 * 纯粹的「原文 → 消息」在 `routine-transcript.ts`(纯函数,好单测);本模块只管 I/O、
 * 幂等和水位线。
 *
 * ⚠️ 只在 **Next server 侧**跑(要 DB + 沙箱 token)。触发时机由上层决定:
 * app 启动 / 打开定时任务页 / 定时轮询,经 `POST /api/routines/sync`。
 *
 * ## 两条不变量
 *
 * 1. **幂等**。物化前必查 `getSessionByRoutineRun(runId)`。断网重试、重复触发、
 *    水位线回退都不能造出重复会话 —— 用户看到同一次运行出现两遍会直接不信任这个功能。
 * 2. **从旧到新物化**。`getSessionsByRoutine` 按 `created_at DESC` 排,而 created_at 是
 *    物化时刻。服务端返回的是新→旧,照单全收会让本地列表的顺序跟真实运行顺序**反过来**。
 */
import type { CoworkRoutine, RoutineRun } from '@/types';
import {
  listRoutines, listRuns, fetchTranscript, toCacheRow,
  RoutinesHttpError, RoutinesUnavailableError,
} from './routines-client';
import {
  replaceCoworkRoutines,
  createSession, addMessage, markSessionAsRoutineRun, getSessionByRoutineRun,
  getRoutineWatermark, setRoutineWatermark,
} from './db';
import { buildRoutineRunMessages, buildRunSessionTitle, runStatusLabel } from './routine-transcript';

/** 每个 routine 单次最多拉多少条运行记录。日配额 20/天(D8),200 条 ≈ 离线十天也不丢。 */
const MAX_RUNS_PER_ROUTINE = 200;

export interface RoutineSyncFailure {
  routineName: string;
  /** 中文的失败说法(状态 + 服务端给的原因) */
  reason: string;
  runId: string;
}

export interface RoutineSyncResult {
  /** 整次同步是否顺利跑完 */
  ok: boolean;
  /** 沙箱不可达 —— UI 挂横幅,但本地已物化的历史照常能看 */
  offline: boolean;
  /** 账号没下发沙箱配置 —— UI 隐藏整个入口(不是置灰) */
  notProvisioned: boolean;
  error?: string;
  /** 对齐到的 routine 数 */
  routines: number;
  /** 本次**新物化**的运行数(已存在的不计) */
  materialized: number;
  succeeded: number;
  failed: number;
  /** 跳过未物化的运行数(并发满/配额用尽等,它们没有产出) */
  skipped: number;
  failures: RoutineSyncFailure[];
  /** 汇总通知文案(D14:离线期间不推送,打开 app 时汇总)。无新运行时为 null */
  summary: string | null;
}

const EMPTY: RoutineSyncResult = {
  ok: true, offline: false, notProvisioned: false,
  routines: 0, materialized: 0, succeeded: 0, failed: 0, skipped: 0,
  failures: [], summary: null,
};

/**
 * 网络那一层的三个调用。做成可注入是为了让单测能驱动**整条物化链路**(幂等、排序、
 * 失败兜底都在这条链上),而不是只测些边角纯函数 —— 那样最该锁住的不变量恰好没锁住。
 */
export interface RoutineSyncDeps {
  listRoutines: typeof listRoutines;
  listRuns: typeof listRuns;
  fetchTranscript: typeof fetchTranscript;
}

const DEFAULT_DEPS: RoutineSyncDeps = { listRoutines, listRuns, fetchTranscript };

/**
 * 拉取 + 物化 + 汇总。**不抛异常**:同步是后台动作,失败只该降级成一条提示,
 * 不该把调用方(app 启动、页面加载)带崩。
 */
export async function syncRoutines(deps: RoutineSyncDeps = DEFAULT_DEPS): Promise<RoutineSyncResult> {
  const result: RoutineSyncResult = { ...EMPTY, failures: [] };

  // ── 1. 对齐 routine 列表 ──
  let routines: CoworkRoutine[];
  try {
    const remote = await deps.listRoutines();
    routines = remote.map(toCacheRow);
    // 覆盖式写入:别处(另一台机器)删掉的 routine 要跟着消失。
    // 注意它只动 cowork_routines 缓存,**不碰已物化的会话** —— 任务删了,历史该留着。
    replaceCoworkRoutines(routines);
  } catch (e) {
    if (e instanceof RoutinesUnavailableError) {
      return { ...result, ok: false, notProvisioned: true, error: e.message };
    }
    // 拉不到就用本地缓存继续?不 —— 运行记录也一样拉不到,继续下去只是白跑一圈。
    return { ...result, ok: false, offline: true, error: msg(e) };
  }
  result.routines = routines.length;

  // ── 2. 逐个 routine 对账 ──
  for (const routine of routines) {
    try {
      await syncOneRoutine(routine, result, deps);
    } catch (e) {
      // 单个 routine 出问题不该拖垮其它的 —— 水位线没推进,下次自然重试。
      result.ok = false;
      result.error = result.error || msg(e);
      if (isOffline(e)) { result.offline = true; break; }
    }
  }

  result.summary = buildSummary(result);
  return result;
}

async function syncOneRoutine(
  routine: CoworkRoutine,
  acc: RoutineSyncResult,
  deps: RoutineSyncDeps,
): Promise<void> {
  // 水位线是**开区间**(服务端 `since` 用 `>` 比较),所以不会重复拉到最后那一条。
  const since = getRoutineWatermark(routine.id);

  const runs = await deps.listRuns(routine.id, { since, limit: MAX_RUNS_PER_ROUTINE });
  if (runs.length === 0) return;

  // 服务端返回新→旧;物化要旧→新(见文件头不变量 2)。
  const ordered = [...runs].reverse();

  if (runs.length >= MAX_RUNS_PER_ROUTINE) {
    // 静默截断会让「同步完了」变成谎话。水位线只推进到本批最后一条,下次继续往前追。
    console.warn(
      `[routine-sync] ${routine.name} 本批取满 ${MAX_RUNS_PER_ROUTINE} 条,可能还有更早的未对账,下次同步继续`,
    );
  }

  let watermark = since;
  for (const run of ordered) {
    await materializeRun(routine, run, acc, deps);
    // 只有处理完才推进 —— materializeRun 抛出时水位线停在上一条,下次从这里重来。
    if (run.startedAt && run.startedAt > watermark) watermark = run.startedAt;
  }

  if (watermark && watermark !== since) setRoutineWatermark(routine.id, watermark);
}

async function materializeRun(
  routine: CoworkRoutine,
  run: RoutineRun,
  acc: RoutineSyncResult,
  deps: RoutineSyncDeps,
): Promise<void> {
  if (!run.runId) return;

  // 🔴 幂等闸:重复拉取绝不重复建会话。
  if (getSessionByRoutineRun(run.runId)) return;

  // skipped 不是一次真的运行(并发满 / 配额用尽 / 上次还没结束),没有任何产出。
  // 给它建一个空会话只会在列表里堆没内容的条目 —— 它仍会出现在服务端的运行历史里
  //(第二层页面直接读服务端),那才是它该待的地方。
  if (run.status === 'skipped') {
    acc.skipped++;
    return;
  }

  // 原文:拿不到是**正常情况**而不是异常 —— credential_error 在容器起来之前就失败了,
  // 服务端压根没写 transcript,拉取必然 404。这类失败恰恰最需要被看见。
  let transcript: string | null = null;
  try {
    transcript = await deps.fetchTranscript(run.runId);
  } catch (e) {
    if (!(e instanceof RoutinesHttpError && e.status === 404)) throw e;
  }

  const messages = buildRoutineRunMessages({ prompt: routine.prompt, run, transcript });

  // sandboxEnabled=true 让 createSession 把 owner_uid 定死为当前账号 —— 与办公会话同一
  // 归属规则,换账号后自然不可见。
  const session = createSession(
    buildRunSessionTitle(routine.name, run.startedAt),
    run.model || routine.model || '',
    '',                        // systemPrompt:服务端跑的,本地不重建
    '/workspace',              // workingDirectory:容器内路径,用于产物面板的相对定位
    'code',
    '',                        // providerId:凭证在服务端,本地不涉及
    'default',
    '',
    true,                      // sandboxEnabled
  );
  markSessionAsRoutineRun(session.id, routine.id, run.runId);

  for (const m of messages) {
    addMessage(session.id, m.role, m.content, m.tokenUsage);
  }

  acc.materialized++;
  if (run.status === 'success') {
    acc.succeeded++;
  } else {
    acc.failed++;
    acc.failures.push({
      routineName: routine.name,
      reason: (run.error || '').trim() || runStatusLabel(run),
      runId: run.runId,
    });
  }
}

/**
 * 汇总文案(D14)。**合并成一条**,不逐条弹 —— 离线一晚上回来收到 12 条通知,
 * 用户下一步就是关掉通知权限。
 */
function buildSummary(r: RoutineSyncResult): string | null {
  if (r.materialized === 0) return null;

  const parts = [`定时任务:你不在时跑了 ${r.materialized} 次`];
  const tally: string[] = [];
  if (r.succeeded) tally.push(`${r.succeeded} 成功`);
  if (r.failed) tally.push(`${r.failed} 失败`);
  if (tally.length) parts.push(tally.join(' '));

  // 只带第一条失败的细节:通知是"够不够让人决定要不要点进去",不是完整报告。
  const first = r.failures[0];
  if (first) {
    const reason = first.reason.length > 40 ? first.reason.slice(0, 40) + '…' : first.reason;
    parts.push(`${first.routineName}:${reason}`);
  }

  return parts.join(' · ');
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 沙箱不可达(网络层错误)—— 与「服务端明确回了个错误码」区分开。 */
function isOffline(e: unknown): boolean {
  return !(e instanceof RoutinesHttpError);
}
