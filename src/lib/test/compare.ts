/**
 * Pure diff between two execution runs (报告多版本对比 / regression analysis).
 *
 * Joins two run.json results by case id → per-case change (added/removed/
 * improved/regressed/unchanged) + dual-rate pass-rate deltas (执行通过率 +
 * 功能验证通过率, the latter excluding 回归基线 via funcCounts — see reduce.ts).
 * Pure — unit-tested in src/__tests__/unit/test-compare.test.ts.
 */
import type { FourStateStatus, RunCounts } from './reduce';

export type CaseChange = 'added' | 'removed' | 'improved' | 'regressed' | 'unchanged';

export interface CaseDiff {
  id: string;
  prev: FourStateStatus | null; // null = 上一版不存在该用例（added）
  curr: FourStateStatus | null; // null = 本版已移除该用例（removed）
  change: CaseChange;
}

export interface RateDelta {
  prev: number | null; // 百分比 0-100；null = N/A（分母 0）
  curr: number | null;
  delta: number | null; // curr - prev；任一为 null → null
}

export interface RunDiff {
  cases: CaseDiff[];
  improved: number;
  regressed: number;
  added: number;
  removed: number;
  execRate: RateDelta; // 执行通过率 = pass / total
  funcRate: RateDelta; // 功能验证通过率 = funcCounts.pass / funcCounts.total（回归基线不计入）
}

/** Minimal shape both a full RunJson and a history entry satisfy. */
export interface ComparableRun {
  tests: Array<{ id: string; status: string }>;
  counts: RunCounts;
  funcCounts?: RunCounts;
}

// 状态好坏序（pass 最好 → fail 最坏），判 improved/regressed。
const RANK: Record<string, number> = { pass: 3, partial: 2, blocked: 1, fail: 0 };
const rank = (s: string) => RANK[s] ?? 0;

function pct(pass: number, denom: number): number | null {
  return denom > 0 ? Math.round((pass / denom) * 100) : null;
}
function delta(prev: number | null, curr: number | null): RateDelta {
  return { prev, curr, delta: prev !== null && curr !== null ? curr - prev : null };
}

/** Diff two runs by case id. `prev` = older version, `curr` = newer. */
export function diffRuns(prev: ComparableRun, curr: ComparableRun): RunDiff {
  const pById = new Map(prev.tests.map((t) => [t.id, t.status]));
  const cById = new Map(curr.tests.map((t) => [t.id, t.status]));
  const ids = [...new Set([...pById.keys(), ...cById.keys()])];
  const cases: CaseDiff[] = ids.map((id) => {
    const p = pById.get(id) ?? null;
    const c = cById.get(id) ?? null;
    let change: CaseChange;
    if (p === null) change = 'added';
    else if (c === null) change = 'removed';
    else if (p === c) change = 'unchanged';
    else change = rank(c) > rank(p) ? 'improved' : 'regressed';
    return { id, prev: p as FourStateStatus | null, curr: c as FourStateStatus | null, change };
  });
  // 排序：regressed 最前（最该关注）→ improved → added → removed → unchanged。
  const order: Record<CaseChange, number> = { regressed: 0, improved: 1, added: 2, removed: 3, unchanged: 4 };
  cases.sort((a, b) => order[a.change] - order[b.change] || a.id.localeCompare(b.id));
  const count = (ch: CaseChange) => cases.filter((c) => c.change === ch).length;
  const fcPrev = prev.funcCounts ?? prev.counts;
  const fcCurr = curr.funcCounts ?? curr.counts;
  return {
    cases,
    improved: count('improved'),
    regressed: count('regressed'),
    added: count('added'),
    removed: count('removed'),
    execRate: delta(pct(prev.counts.pass, prev.counts.total), pct(curr.counts.pass, curr.counts.total)),
    funcRate: delta(pct(fcPrev.pass, fcPrev.total), pct(fcCurr.pass, fcCurr.total)),
  };
}
