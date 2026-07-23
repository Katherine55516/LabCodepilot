import { readLibrary, readLibMeta, type LibraryEntry } from './library';
import { readSuites, findSuite, evalSuite, REGRESSION_FULL_SUITE, type RegressionSuite } from './suites';
import { buildLastResultLookup, pickBaseRound, failedKeysOfRound, type RoundMode } from './rounds';

/**
 * 测试工作台 · 回归执行范围解析(v2 二期)。
 *
 * 「发起回归」弹窗的预检卡与真正的发起接口**必须圈选出同一批用例**——否则用户看到「将执行
 * 12 条」、实跑 15 条。历史上这类漂移都源于「预览在前端重算一遍」,故本模块把范围解析下沉
 * 为唯一实现,`/api/test/library/run` 与 `/api/test/suites/eval` 都调它。
 *
 * 三种模式统一走 evalSuite 一条通道(隔离排除 → 套件命中 → pinned 必跑并入 → approvedOnly 过滤):
 *   - 全量/具名套件:按 suiteName 取套件定义(内置「全量」→ null);
 *   - 复测轮(failed-only):把基准轮的失败集合成一个**静态套件**再求值,不另开过滤逻辑。
 */

export interface RunScopeInput {
  suiteName?: string;
  mode?: RoundMode;
  approvedOnly?: boolean;
  parentRoundId?: string;
}

export interface RunScope {
  hits: LibraryEntry[];
  /** 落轮次索引用的套件名(复测轮为 '—',范围来自源轮引用而非具名套件)。 */
  suiteName: string;
  mode: RoundMode;
  parentRoundId?: string;
  /** 全库隔离条数(护栏:预检卡与报告横幅须曝光「隔离排除 N 条」)。 */
  quarantined: number;
  /** 命中集中仍待确认的条数(approvedOnly 关闭时用于提示「建议先评审」)。 */
  pendingInScope: number;
  /**
   * 复测轮:基准轮的失败条数(**不含** pinned 并入的必跑用例)。UI 的「仅复测上轮失败(N 条
   * + 📌必跑)」必须显示这个数,而不是 hits——hits 已经把 pinned 算进去了。
   */
  baseFailedCount?: number;
}

/** 范围解析失败(未知套件 / 没有可作基准的轮),路由层转 400。 */
export class RunScopeError extends Error {}

/** 复测轮的套件名占位:范围来自源轮引用,不是某个具名套件。 */
export const RETEST_SUITE_NAME = '—';

export function resolveRunScope(projectPath: string, input: RunScopeInput): RunScope {
  const mode: RoundMode = input.mode === 'failed-only' ? 'failed-only' : 'full';
  const approvedOnly = input.approvedOnly === true;
  const lib = readLibrary(projectPath);
  const suitesData = readSuites(projectPath);

  let suiteName: string;
  let suite: RegressionSuite | null | undefined;
  let parentRoundId: string | undefined;
  let baseFailedCount: number | undefined;

  if (mode === 'failed-only') {
    const base = pickBaseRound(projectPath, input.parentRoundId);
    if (!base) throw new RunScopeError('没有可作为基准的已收口全量轮');
    parentRoundId = base.roundId;
    suiteName = RETEST_SUITE_NAME;
    const failed = failedKeysOfRound(projectPath, base);
    baseFailedCount = failed.length;
    suite = { name: suiteName, type: 'static', keys: failed };
  } else {
    suiteName = input.suiteName?.trim() || REGRESSION_FULL_SUITE;
    suite = findSuite(suitesData, suiteName); // 内置「全量」→ null;未知 → undefined
    if (suite === undefined) throw new RunScopeError(`未知套件「${suiteName}」`);
  }

  const hits = evalSuite(lib, suite, {
    pinned: suitesData.pinned,
    lastResultOf: buildLastResultLookup(projectPath),
    approvedOnly,
  });

  return {
    hits,
    suiteName,
    mode,
    parentRoundId,
    quarantined: lib.entries.filter((e) => readLibMeta(e).quarantined).length,
    pendingInScope: hits.filter((e) => readLibMeta(e).reviewState === 'pending').length,
    baseFailedCount,
  };
}
