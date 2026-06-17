'use client';

// ============================================================================
// Dot-matrix renderer for the context-usage breakdown. Used both by the
// RunCockpit trigger (mini bar: 10 cells, 1 row, minCellsPerKind=0) and the
// popover main bar (100 cells, 2 rows, minCellsPerKind=1).
//
// The allocation math lives in context-dot-allocations.ts (pure, unit-tested);
// this file only renders. See spec §5.5 / §6.3.
// ============================================================================

import {
  type ContextUsageBreakdown,
  type ContextBreakdownKind,
} from '@/lib/context-breakdown';
import { computeAllocations } from '@/lib/context-dot-allocations';

function dotVar(kind: ContextBreakdownKind): string {
  return `var(--context-dot-${kind.replace(/_/g, '-')})`;
}

interface ContextDotMatrixProps {
  breakdown: ContextUsageBreakdown;
  /** Total cells. Default 100. */
  cellCount?: number;
  /** Grid rows. Default 2 → 50 columns, column-major fill. */
  rows?: number;
  /** 1 (popover, each kind ≥1 cell) or 0 (trigger mini bar). Default 1. */
  minCellsPerKind?: 0 | 1;
  className?: string;
}

export function ContextDotMatrix({
  breakdown,
  cellCount = 100,
  rows = 2,
  minCellsPerKind = 1,
  className,
}: ContextDotMatrixProps) {
  const { cells, emptyCells } = computeAllocations(
    breakdown,
    cellCount,
    minCellsPerKind,
  );

  if (cells.length === 0 && emptyCells === 0) return null;

  // Flatten allocations + empty remainder into a single ordered cell list.
  const flat: Array<{
    key: string;
    kind: ContextBreakdownKind | null;
    isPending: boolean;
  }> = [];
  cells.forEach((c, ci) => {
    for (let n = 0; n < c.cells; n++) {
      flat.push({
        key: `${c.kind}-${ci}-${n}`,
        kind: c.kind,
        isPending: c.isPending,
      });
    }
  });
  for (let n = 0; n < emptyCells; n++) {
    flat.push({ key: `empty-${n}`, kind: null, isPending: false });
  }

  return (
    <div
      aria-hidden
      className={`grid gap-px ${className ?? ''}`}
      style={{
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gridAutoFlow: 'column',
        gridAutoColumns: 'minmax(0, 1fr)',
      }}
    >
      {flat.map((cell) => {
        if (cell.kind === null) {
          return (
            <span
              key={cell.key}
              className="aspect-square rounded-[2px] bg-muted/60"
            />
          );
        }
        if (cell.isPending) {
          return (
            <span
              key={cell.key}
              className="aspect-square rounded-[2px] border border-dashed border-muted-foreground bg-transparent"
            />
          );
        }
        return (
          <span
            key={cell.key}
            className="aspect-square rounded-[2px]"
            style={{ backgroundColor: dotVar(cell.kind) }}
          />
        );
      })}
    </div>
  );
}
