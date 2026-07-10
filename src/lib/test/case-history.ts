import fs from 'fs';
import path from 'path';
import { readLibrary, readLibMeta, type LibMeta, type LibraryEntry } from './library';
import {
  readRounds,
  normalizeStaleRounds,
  readRoundSnapshot,
  roundArtifactPaths,
  type RegressionRound,
  type RoundMode,
  type RoundStatus,
} from './rounds';

/**
 * 测试工作台 · 逐用例跨轮结果矩阵(v2 二/三期)。
 *
 * 「对比矩阵」(行=用例 × 列=轮次)、健康度徽标(flaky / 连败 / 久未执行)、抽屉里的执行历史
 * 圆点行,全部消费本模块。
 *
 * 数据源决策(用户 2026-07-10 拍板):**读侧现算,不物化** `回归用例库.stats.json`——
 * 每轮的 `cases.snapshot.json.idMap` + `{roundId}-{env}.run.json` 已经是唯一真相源,再存一份
 * 逐用例结果只会引入漂移与存量回填。成本用「限流近 N 轮 + 进程内缓存」压住:
 * 缓存按 (projectPath, limit) 建键,轮次索引或库的写入序号 `seq` 一变即失效
 * (用 seq 而非 `updatedAt`:后者毫秒粒度,同刻两次写入无法区分)。
 *
 * 行身份 = `(来源任务, originalId)`,与 `_source` 对齐(v2 一期口径)。行集合以**库当前条目**
 * 为准:已从库移除的用例不再出现在矩阵里;从未执行的用例整行为 '-'。
 *
 * 派生函数(flips / tailFails / lastRunIdx / health / mergedStats)与交互原型的同名函数逐行
 * 等价——实现与原型漂移会直接表现为徽标判定不一致,故阈值集中在此并有单测钉死。
 */

/** 单元格三态:通过 / 失败(含 partial、blocked 等任何非通过终态) / 该轮未执行。 */
export type CaseRes = 'p' | 'f' | '-';

/** 健康度分类(判定优先级即声明顺序,见 health())。 */
export type HealthKind = 'quar' | 'streak' | 'flaky' | 'never' | 'stale' | 'ok';

/** 默认纳入矩阵的最近轮次数。 */
export const DEFAULT_HISTORY_LIMIT = 20;

/** flaky 判据:执行序列(去掉未执行)里的结果翻转次数 ≥ 此值。 */
export const FLAKY_FLIPS = 2;
/** 连败判据:执行序列尾部连续失败 ≥ 此值。 */
export const STREAK_FAILS = 3;
/** 久未执行判据:距最新一轮 ≥ 此值轮没跑到。 */
export const STALE_ROUNDS = 3;
/** 隔离占比超过此值 → 健康度页顶部告警(护栏:防止用隔离掩盖真实回归)。 */
export const QUARANTINE_ALERT_RATIO = 0.1;

/** 矩阵列(轮次摘要,旧→新)。 */
export interface HistoryRound {
  roundId: string;
  startedAt: string;
  env: string;
  suiteName: string;
  mode: RoundMode;
  status: RoundStatus;
}

/** 矩阵行(一条库用例的跨轮结果;`res` 与 rounds 同下标)。 */
export interface CaseHistoryRow {
  task: string;
  originalId: string;
  purpose: string;
  priority: string;
  module: string;
  meta: LibMeta;
  res: CaseRes[];
}

export interface CaseHistory {
  rounds: HistoryRound[];
  cases: CaseHistoryRow[];
}

/** 行身份 → 内部键(NUL 分隔:任务名可含空格,普通分隔符会撞键)。 */
const keyOf = (task: string, originalId: string) => `${task}\u0000${originalId}`;

/** 取用例上的一个字符串字段(用例是宽松形状,缺失/非字符串 → '')。 */
function strField(e: LibraryEntry, field: string): string {
  const v = (e as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : '';
}

/** 某轮的 (task·originalId) → 'p'|'f'。快照或 run.json 缺损 → null(整列按未执行)。 */
function roundResults(projectPath: string, round: RegressionRound): Map<string, CaseRes> | null {
  const snap = readRoundSnapshot(projectPath, round.roundId);
  if (!snap?.idMap) return null;
  let tests: Array<{ id?: unknown; status?: unknown }>;
  try {
    const abs = path.join(projectPath, roundArtifactPaths(round.roundId, round.env).runJson);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { tests?: unknown };
    if (!Array.isArray(raw.tests)) return null;
    tests = raw.tests as Array<{ id?: unknown; status?: unknown }>;
  } catch {
    return null; // 执行中/被中断的轮还没有 run.json
  }
  const map = new Map<string, CaseRes>();
  for (const t of tests) {
    if (!t || typeof t.id !== 'string') continue;
    const src = snap.idMap[t.id];
    if (!src) continue;
    map.set(keyOf(src.task, src.originalId), t.status === 'pass' ? 'p' : 'f');
  }
  return map;
}

interface CacheSlot {
  roundsSeq: number;
  librarySeq: number;
  data: CaseHistory;
}
const cache = new Map<string, CacheSlot>();

/** 仅供单测:清空进程内缓存。 */
export function _clearCaseHistoryCache(): void {
  cache.clear();
}

/**
 * 拼装跨轮矩阵。取最近 `limit` 轮(按 startedAt 升序,旧→新),行取库当前条目(库序)。
 * 任何一轮的产物缺损 → 该列全 '-'(诚实降级,不硬拼)。
 */
export function buildCaseHistory(
  projectPath: string,
  opts: { limit?: number } = {},
): CaseHistory {
  const limit = Math.max(1, opts.limit ?? DEFAULT_HISTORY_LIMIT);
  const roundsFileData = readRounds(projectPath);
  const lib = readLibrary(projectPath);

  const cacheKey = keyOf(projectPath, String(limit));
  const hit = cache.get(cacheKey);
  if (hit && hit.roundsSeq === (roundsFileData.seq ?? 0) && hit.librarySeq === (lib.seq ?? 0)) {
    return hit.data;
  }

  const rounds = normalizeStaleRounds(roundsFileData.rounds)
    .slice()
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
    .slice(-limit);

  const perRound = rounds.map((r) => roundResults(projectPath, r));

  const cases: CaseHistoryRow[] = lib.entries.map((e) => {
    const k = keyOf(e._source.task, e._source.originalId);
    return {
      task: e._source.task,
      originalId: e._source.originalId,
      purpose: strField(e, 'purpose'),
      priority: strField(e, 'priority'),
      module: strField(e, 'module'),
      meta: readLibMeta(e),
      res: perRound.map((m) => m?.get(k) ?? '-'),
    };
  });

  const data: CaseHistory = {
    rounds: rounds.map((r) => ({
      roundId: r.roundId,
      startedAt: r.startedAt,
      env: r.env,
      suiteName: r.suiteName,
      mode: r.mode,
      status: r.status,
    })),
    cases,
  };
  cache.set(cacheKey, { roundsSeq: roundsFileData.seq ?? 0, librarySeq: lib.seq ?? 0, data });
  return data;
}

/* ============ 派生函数(与交互原型同名同义) ============ */

/** 执行序列:去掉「该轮未执行」的空洞——翻转/连败只在真正跑过的轮之间判定。 */
export function execSeq(res: readonly CaseRes[]): Array<'p' | 'f'> {
  return res.filter((r): r is 'p' | 'f' => r !== '-');
}

/** 结果翻转次数(执行序列里相邻两轮结果不同的次数)。 */
export function flips(res: readonly CaseRes[]): number {
  const s = execSeq(res);
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) n++;
  return n;
}

/** 尾部连续失败轮数(执行序列末尾连续的 'f')。 */
export function tailFails(res: readonly CaseRes[]): number {
  const s = execSeq(res);
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === 'f'; i--) n++;
  return n;
}

/** 最近一次被执行的轮下标;从未执行 → -1。 */
export function lastRunIdx(res: readonly CaseRes[]): number {
  for (let i = res.length - 1; i >= 0; i--) if (res[i] !== '-') return i;
  return -1;
}

/**
 * 健康度判定(优先级自上而下,首个命中即返回):
 *   隔离中 > 连败 ≥3 轮 > flaky(翻转 ≥2) > 从未执行 > 久未执行(≥3 轮没跑到) > 健康。
 *
 * ⚠️ 跨轮翻转 ≠ 真 flaky(版本一直在变)。这里只做**候选**筛选,最终判定依赖「AI 就地复核:
 * 同版本连跑 3 次」(尚未实现,健康度页入口置灰)。
 */
export function health(res: readonly CaseRes[], quarantined: boolean): HealthKind {
  if (quarantined) return 'quar';
  if (tailFails(res) >= STREAK_FAILS) return 'streak';
  if (flips(res) >= FLAKY_FLIPS) return 'flaky';
  const last = lastRunIdx(res);
  if (last < 0) return 'never';
  if (res.length - 1 - last >= STALE_ROUNDS) return 'stale';
  return 'ok';
}

/**
 * 单轮口径统计(只看该轮跑到的用例;未执行不计入)。通过率趋势线与报告横幅用它。
 * 与 mergedStats 的区别:这里回答「这一轮跑了什么、过了多少」,不回答「现在能不能发版」。
 */
export function roundStats(
  cases: readonly CaseHistoryRow[],
  idx: number,
): { pass: number; fail: number; total: number } {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const r = c.res[idx];
    if (r === 'p') pass++;
    else if (r === 'f') fail++;
  }
  return { pass, fail, total: pass + fail };
}

/**
 * 合并口径统计(Xray Test Plan 语义):每条用例取**截至该轮的最新结果**,而非只看该轮。
 * 复测轮(failed-only)的发版红线必须用它评估——只跑 2 条失败用例并全过,不等于「2/2 可发版」。
 * 隔离条目一律不计入(不影响红线,但调用方须在横幅曝光隔离条数)。
 */
export function mergedStats(
  cases: readonly CaseHistoryRow[],
  uptoIdx: number,
): { pass: number; fail: number; total: number } {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    if (c.meta.quarantined) continue;
    for (let i = Math.min(uptoIdx, c.res.length - 1); i >= 0; i--) {
      const r = c.res[i];
      if (r === '-') continue;
      if (r === 'p') pass++;
      else fail++;
      break;
    }
  }
  return { pass, fail, total: pass + fail };
}
