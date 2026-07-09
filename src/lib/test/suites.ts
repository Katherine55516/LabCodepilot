import fs from 'fs';
import path from 'path';
import { REGRESSION_FULL_SUITE } from './library-constants';
import type { LibraryEntry, RegressionLibrary } from './library';

/**
 * 测试工作台 · 回归套件(v2 批 A)。
 *
 * 套件 = 「本轮跑什么」的圈选器,对标 Azure Query-based Suite / TestRail Dynamic Filter
 * (方案见 docs/research/regression-library-v2-benchmark-proposal.md §5 支柱一)。
 *
 *   - 静态套件(static):手工固化的 {task, originalId} 清单,新入库用例不自动进入;
 *   - 查询套件(query):保存**条件**(优先级/模块/来源任务/上次结果,字段间 AND、字段内
 *     OR、空字段不限制),发起执行时对库内存求值,新命中自动进入,零维护;
 *   - 内置「全量」(REGRESSION_FULL_SUITE):不落盘、不可改删,= 库内全部(隔离除外),
 *     等价 v1 一键重跑,保证向后兼容;
 *   - pinned 核心必跑白名单:**项目级、跨套件生效**——任何套件/模式执行时始终并入。
 *
 * 「上次结果」条件依赖轮次数据,通过注入的 lookup 函数解耦(批 B/D 提供真实实现:
 * 最近一轮 run.json 反查;批 A 数据层不读 run.json)。
 * 套件是引用不是复制:求值结果永远来自库的当前 entries。
 */

export { REGRESSION_FULL_SUITE };

/** 库条目身份(套件静态清单与 pinned 的引用单位,与 _source 对齐)。 */
export interface SuiteKey {
  task: string;
  originalId: string;
}

/** 「上次结果」三值(一期口径):pass=上轮通过;fail=上轮任何非通过终态;none=从未执行。 */
export type LastResult = 'pass' | 'fail' | 'none';

/** 查询套件条件。缺字段/空数组 = 该维度不限制;字段间 AND,字段内 OR。 */
export interface SuiteFilter {
  /** 优先级(用例 priority 字段,如 P0/P1/P2)。 */
  pri?: string[];
  /** 模块(用例 module 字段;决策:模块只作条件字段,不做独立功能)。 */
  module?: string[];
  /** 来源任务(_source.task)。 */
  task?: string[];
  /** 上次结果(依赖注入的 lookup;未注入时该条件不命中 pass/fail,只命中 none)。 */
  last?: LastResult[];
}

export type RegressionSuite =
  | { name: string; type: 'static'; keys: SuiteKey[] }
  | { name: string; type: 'query'; filter: SuiteFilter };

export interface SuitesFile {
  version: number;
  updatedAt: string;
  /** 写入序号(每次落盘 +1)。丢更新保护的版本令牌——updatedAt 毫秒粒度同刻写入无法区分。 */
  seq?: number;
  /** 核心必跑白名单(项目级,任何套件执行都并入)。 */
  pinned: SuiteKey[];
  suites: RegressionSuite[];
}

const SUITES_VERSION = 1;

/** 套件文件绝对路径(与 回归用例库.json 同目录,团队资产,适合随 git 走)。 */
export function suitesFile(projectPath: string): string {
  return path.join(projectPath, 'AI_LabTest', 'testCase', '回归套件.json');
}

function emptySuites(): SuitesFile {
  return { version: SUITES_VERSION, updatedAt: '', pinned: [], suites: [] };
}

function isSuiteKey(k: unknown): k is SuiteKey {
  return !!k && typeof k === 'object'
    && typeof (k as SuiteKey).task === 'string' && !!(k as SuiteKey).task
    && typeof (k as SuiteKey).originalId === 'string';
}

function sanitizeStrArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x): x is string => typeof x === 'string');
  return arr.length ? arr : undefined;
}

/**
 * 清洗一个「疑似套件」输入 → 合法 RegressionSuite 或 null。文件解析与 API 入参共用同一
 * 口径(缺名/占用内置名/未知类型 → null;keys/filter 逐项清洗)。
 */
export function sanitizeSuite(s: unknown): RegressionSuite | null {
  if (!s || typeof s !== 'object') return null;
  const { name, type } = s as { name?: unknown; type?: unknown };
  if (typeof name !== 'string' || !name.trim() || name.trim() === REGRESSION_FULL_SUITE) return null;
  const cleanName = name.trim();
  if (type === 'static') {
    const keysRaw = (s as { keys?: unknown }).keys;
    return { name: cleanName, type, keys: Array.isArray(keysRaw) ? keysRaw.filter(isSuiteKey) : [] };
  }
  if (type === 'query') {
    const f = ((s as { filter?: unknown }).filter ?? {}) as Record<string, unknown>;
    const filter: SuiteFilter = {
      pri: sanitizeStrArr(f.pri),
      module: sanitizeStrArr(f.module),
      task: sanitizeStrArr(f.task),
      last: sanitizeStrArr(f.last)?.filter((x): x is LastResult => x === 'pass' || x === 'fail' || x === 'none'),
    };
    return { name: cleanName, type, filter };
  }
  return null;
}

/** 读套件文件。缺文件/坏 JSON → 空;坏套件条目(缺名/未知类型/结构不符)跳过;内置名条目忽略。 */
export function readSuites(projectPath: string): SuitesFile {
  let raw: string;
  try {
    raw = fs.readFileSync(suitesFile(projectPath), 'utf-8');
  } catch {
    return emptySuites();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const out = emptySuites();
    out.updatedAt = typeof (parsed as { updatedAt?: unknown }).updatedAt === 'string'
      ? (parsed as { updatedAt: string }).updatedAt
      : '';
    out.seq = typeof (parsed as { seq?: unknown }).seq === 'number' ? (parsed as { seq: number }).seq : 0;
    const pinnedRaw = (parsed as { pinned?: unknown }).pinned;
    if (Array.isArray(pinnedRaw)) out.pinned = pinnedRaw.filter(isSuiteKey);
    const suitesRaw = (parsed as { suites?: unknown }).suites;
    if (Array.isArray(suitesRaw)) {
      for (const s of suitesRaw) {
        const clean = sanitizeSuite(s);
        if (clean) out.suites.push(clean);
      }
    }
    return out;
  } catch {
    console.warn('[regression-suites] 套件文件解析失败,按空处理');
    return emptySuites();
  }
}

function writeSuites(projectPath: string, data: SuitesFile): void {
  const file = suitesFile(projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: SuitesFile = {
    version: SUITES_VERSION,
    updatedAt: new Date().toISOString(),
    seq: (data.seq ?? 0) + 1,
    pinned: data.pinned,
    suites: data.suites,
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/** 读-改-写套件文件,丢更新保护同 rounds.mutateRounds(写前重读比对 seq,冲突重放一次)。 */
export function mutateSuites(
  projectPath: string,
  mutator: (data: SuitesFile) => void,
  _beforeWrite?: () => void,
): SuitesFile {
  let data = readSuites(projectPath);
  const seenSeq = data.seq ?? 0;
  mutator(data);
  _beforeWrite?.();
  const latest = readSuites(projectPath);
  if ((latest.seq ?? 0) !== seenSeq) {
    data = latest;
    mutator(data);
  }
  writeSuites(projectPath, data);
  return data;
}

/** 新建/更新套件(name 为主键)。占用内置「全量」名 → 抛错(路由层转 400)。 */
export function upsertSuite(projectPath: string, suite: RegressionSuite): SuitesFile {
  if (suite.name === REGRESSION_FULL_SUITE) {
    throw new Error(`套件名不可使用内置保留名「${REGRESSION_FULL_SUITE}」`);
  }
  return mutateSuites(projectPath, (data) => {
    data.suites = [...data.suites.filter((s) => s.name !== suite.name), suite];
  });
}

/** 删除套件。内置「全量」不可删 → 抛错;不存在 → no-op。 */
export function removeSuite(projectPath: string, name: string): SuitesFile {
  if (name === REGRESSION_FULL_SUITE) {
    throw new Error(`内置套件「${REGRESSION_FULL_SUITE}」不可删除`);
  }
  return mutateSuites(projectPath, (data) => {
    data.suites = data.suites.filter((s) => s.name !== name);
  });
}

/** 覆盖 pinned 白名单。 */
export function setPinned(projectPath: string, keys: SuiteKey[]): SuitesFile {
  return mutateSuites(projectPath, (data) => {
    data.pinned = keys.filter(isSuiteKey);
  });
}

/** 条目身份 → 内部去重键(用 NUL 分隔,任务名/ID 里不可能出现)。 */
function keyOf(task: string, originalId: string): string {
  return `${task}\u0000${originalId}`;
}

function entryKey(e: LibraryEntry): string {
  return keyOf(e._source.task, e._source.originalId);
}

/** 条目是否被隔离(三期字段,此处前置兼容:任何求值都排除 quarantined===true 的条目)。 */
function isQuarantined(e: LibraryEntry): boolean {
  return (e as { quarantined?: unknown }).quarantined === true;
}

export interface EvalSuiteOptions {
  /** 「上次结果」查询函数(批 B/D 注入,最近一轮 run.json 反查);缺省 = 一律 'none'。 */
  lastResultOf?: (key: SuiteKey) => LastResult;
  /** 核心必跑白名单;缺省从不并入。 */
  pinned?: SuiteKey[];
}

/**
 * 对库求值一个套件 → 命中条目(顺序保持库序;隔离条目一律排除;pinned 始终并入)。
 * `suiteName === REGRESSION_FULL_SUITE` 或传 null → 全量。
 */
export function evalSuite(
  lib: RegressionLibrary,
  suite: RegressionSuite | null,
  opts: EvalSuiteOptions = {},
): LibraryEntry[] {
  const alive = lib.entries.filter((e) => !isQuarantined(e));
  let hit: LibraryEntry[];
  if (!suite) {
    hit = alive;
  } else if (suite.type === 'static') {
    const want = new Set(suite.keys.map((k) => keyOf(k.task, k.originalId)));
    hit = alive.filter((e) => want.has(entryKey(e)));
  } else {
    const f = suite.filter ?? {};
    const lastOf = opts.lastResultOf ?? (() => 'none' as const);
    hit = alive.filter((e) => {
      if (f.pri?.length && !f.pri.includes(String((e as { priority?: unknown }).priority ?? ''))) return false;
      if (f.module?.length && !f.module.includes(String((e as { module?: unknown }).module ?? ''))) return false;
      if (f.task?.length && !f.task.includes(e._source.task)) return false;
      if (f.last?.length && !f.last.includes(lastOf({ task: e._source.task, originalId: e._source.originalId }))) return false;
      return true;
    });
  }
  // pinned 始终并入(去重,补充项按库序追加)。
  const pinned = opts.pinned ?? [];
  if (pinned.length) {
    const have = new Set(hit.map(entryKey));
    const wantPinned = new Set(pinned.map((k) => keyOf(k.task, k.originalId)));
    for (const e of alive) {
      if (wantPinned.has(entryKey(e)) && !have.has(entryKey(e))) {
        hit.push(e);
        have.add(entryKey(e));
      }
    }
  }
  return hit;
}

/** 按名字取套件(内置「全量」返回 null 语义由调用方处理;未知名 → undefined)。 */
export function findSuite(data: SuitesFile, name: string): RegressionSuite | null | undefined {
  if (name === REGRESSION_FULL_SUITE) return null;
  return data.suites.find((s) => s.name === name);
}
