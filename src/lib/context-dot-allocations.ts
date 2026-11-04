// ============================================================================
// Dot-matrix cell allocation — pure algorithm, no React (so it's unit-testable
// without a JSX runtime). Rendered by ContextDotMatrix. See spec §5.5.
// ============================================================================

import {
  type ContextUsageBreakdown,
  type ContextBreakdownKind,
  CONTEXT_BREAKDOWN_KIND_ORDER,
  PENDING_BREAKDOWN_KINDS,
} from './context-breakdown';

/** Mini-bar fallback denominator when the window is unknown (spec §5.6). */
export const FALLBACK_CONTEXT_WINDOW = 200_000;

export interface AllocatedCells {
  kind: ContextBreakdownKind;
  cells: number;
  isPending: boolean;
}

export interface AllocationResult {
  cells: AllocatedCells[];
  emptyCells: number;
}

function isPendingKind(kind: ContextBreakdownKind): boolean {
  return PENDING_BREAKDOWN_KINDS.includes(kind);
}

function tokensOf(
  breakdown: ContextUsageBreakdown,
  kind: ContextBreakdownKind,
): number {
  const part = breakdown.parts.find((p) => p.kind === kind);
  return part ? Math.max(0, part.tokens) : 0;
}

/**
 * Allocate `cellCount` cells across the breakdown categories.
 * - Denominator: window if known; else used+pending (popover) or
 *   max(used+pending, 200K) (mini bar, avoids a tiny run filling the bar).
 * - Two passes: non-pending kinds (stable color order) then pending kinds.
 * - Over-allocation is trimmed from the tail; mini bar gets a 1-cell floor for
 *   the largest kind when everything rounds to 0 but used>0.
 */
export function computeAllocations(
  breakdown: ContextUsageBreakdown,
  cellCount: number,
  minCellsPerKind: 0 | 1,
): AllocationResult {
  const pendingTotal = PENDING_BREAKDOWN_KINDS.reduce(
    (sum, kind) => sum + tokensOf(breakdown, kind),
    0,
  );
  const used = Math.max(0, breakdown.usedTokens);

  let denominator: number;
  if (breakdown.contextWindow && breakdown.contextWindow > 0) {
    denominator = breakdown.contextWindow;
  } else if (minCellsPerKind === 1) {
    denominator = used + pendingTotal;
  } else {
    denominator = Math.max(used + pendingTotal, FALLBACK_CONTEXT_WINDOW);
  }

  if (denominator <= 0) {
    return { cells: [], emptyCells: cellCount };
  }

  const allocate = (tokens: number): number => {
    const raw = (tokens / denominator) * cellCount;
    return minCellsPerKind === 1 ? Math.max(1, Math.ceil(raw)) : Math.round(raw);
  };

  const result: AllocatedCells[] = [];

  // Pass 1: non-pending kinds in stable order.
  for (const kind of CONTEXT_BREAKDOWN_KIND_ORDER) {
    if (isPendingKind(kind)) continue;
    const tokens = tokensOf(breakdown, kind);
    if (tokens <= 0) continue;
    const cells = allocate(tokens);
    if (cells > 0) result.push({ kind, cells, isPending: false });
  }

  // Pass 2: pending kinds (dashed cells).
  for (const kind of CONTEXT_BREAKDOWN_KIND_ORDER) {
    if (!isPendingKind(kind)) continue;
    const tokens = tokensOf(breakdown, kind);
    if (tokens <= 0) continue;
    const cells = allocate(tokens);
    if (cells > 0) result.push({ kind, cells, isPending: true });
  }

  let total = result.reduce((sum, r) => sum + r.cells, 0);

  // Trim overflow from the tail; drop entries trimmed to 0.
  if (total > cellCount) {
    let overflow = total - cellCount;
    for (let i = result.length - 1; i >= 0 && overflow > 0; i--) {
      const reduce = Math.min(result[i].cells, overflow);
      result[i].cells -= reduce;
      overflow -= reduce;
    }
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].cells <= 0) result.splice(i, 1);
    }
    total = result.reduce((sum, r) => sum + r.cells, 0);
  }

  // Mini-bar floor: nothing allocated but there IS usage → light the largest
  // non-pending kind so a just-sent message never shows an empty bar.
  if (minCellsPerKind === 0 && result.length === 0 && used > 0) {
    let maxKind: ContextBreakdownKind | null = null;
    let maxTokens = 0;
    for (const kind of CONTEXT_BREAKDOWN_KIND_ORDER) {
      if (isPendingKind(kind)) continue;
      const tokens = tokensOf(breakdown, kind);
      if (tokens > maxTokens) {
        maxTokens = tokens;
        maxKind = kind;
      }
    }
    if (maxKind) {
      result.push({ kind: maxKind, cells: 1, isPending: false });
      total = 1;
    }
  }

  return { cells: result, emptyCells: Math.max(0, cellCount - total) };
}
