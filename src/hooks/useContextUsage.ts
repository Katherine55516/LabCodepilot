import { useMemo } from 'react';
import type { Message } from '@/types';
import { getContextWindow, is1mContextModelName } from '@/lib/model-context';
import { walkContextUsage } from '@/lib/context-usage-walk';
import {
  buildContextUsageBreakdown,
  type ContextUsageBreakdown,
} from '@/lib/context-breakdown';

export interface ContextUsageData {
  modelName: string;
  contextWindow: number | null;
  /** Actual token usage (= breakdown.usedTokens). */
  used: number;
  /** Ratio of actual usage to context window (0 when window unknown). */
  ratio: number;
  /** Estimated next-turn token usage (input + output + ~200 overhead). */
  estimatedNextTurn: number;
  /** Ratio of estimated next-turn usage to context window. */
  estimatedNextRatio: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  hasData: boolean;
  /** Warning state based on the higher of actual/estimated ratio. */
  state: 'normal' | 'warning' | 'critical';
  /** Whether a session summary (compression) is active. */
  hasSummary: boolean;
  /**
   * Data source for the rendered numbers（context-usage-accuracy-overhaul 1C）:
   *   - 'exact': token_usage.context_used_tokens — 回合末探针的权威快照，
   *     Claude Code /context 同源口径。语义是「截至上一回合结束」，一直有效
   *     直到下一回合产生新记录，不做时间衰减（陈旧标注优于伪装实时）。
   *   - 'approx': 末次主链请求的 input+cacheR+cacheC 近似回退
   *     （探针未命中/win32/cowork 盲区/流刚结束尚未拉到）。
   *   - 'none': no token data yet.
   */
  source: 'exact' | 'approx' | 'none';
  /** Categorized breakdown for the RunCockpit card (dot-matrix + detail list). */
  breakdown: ContextUsageBreakdown;
  /** SDK total cost (USD) for this run — drives the card's Total cost line. */
  costUsd?: number;
}

export function useContextUsage(
  messages: Message[],
  modelName: string,
  options?: {
    context1m?: boolean;
    hasSummary?: boolean;
    /** Resolved upstream model ID — disambiguates alias windows. */
    upstreamModelId?: string;
    /**
     * Context window from /api/providers/models (account-provisioned, most
     * authoritative). Takes priority over the static catalog.
     */
    modelContextWindow?: number;
  },
): ContextUsageData {
  return useMemo(() => {
    const catalogWindow = getContextWindow(modelName, {
      context1m: options?.context1m,
      upstream: options?.upstreamModelId,
    });

    const walk = walkContextUsage(messages);
    const baseline = walk.baseline;

    // Window priority: [1m] runtime model name (highest — the name shown in
    // the "Connected (…)" status line marks the 1M CLI variant; overrides
    // every other source) → this record's SDK window → latest SDK window
    // seen → provider-models window → static catalog → unknown.
    // (Phase 2 将整链收敛到 resolveContextWindow 单一 resolver。)
    const contextWindow: number | null = is1mContextModelName(walk.latestModel)
      ? 1_000_000
      : baseline?.sdkContextWindow ||
        walk.latestSdkContextWindow ||
        options?.modelContextWindow ||
        catalogWindow ||
        null;

    const hasData = baseline !== null;

    const breakdown = buildContextUsageBreakdown({
      baseline: baseline
        ? {
            used: baseline.used,
            cacheReadTokens: baseline.cacheReadTokens,
            cacheCreationTokens: baseline.cacheCreationTokens,
            outputTokens: baseline.outputTokens,
          }
        : undefined,
      contextWindow: contextWindow ?? undefined,
      // Runtime context accounting (tools/rules/mcp/…) is not wired up on this
      // backend yet — leaving compiler undefined means those rows render 0 and
      // hide. This is the forward-looking hook for when it is.
      compiler: undefined,
    });

    const used = breakdown.usedTokens;
    const cacheReadTokens = baseline?.cacheReadTokens ?? 0;
    const cacheCreationTokens = baseline?.cacheCreationTokens ?? 0;
    const outputTokens = baseline?.outputTokens ?? 0;

    const ratio = contextWindow ? Math.min(1, used / contextWindow) : 0;
    const estimatedNextTurn = hasData ? used + outputTokens + 200 : 0;
    const estimatedNextRatio = contextWindow ? estimatedNextTurn / contextWindow : 0;

    const effectiveRatio = Math.max(ratio, estimatedNextRatio);
    const state: 'normal' | 'warning' | 'critical' =
      effectiveRatio >= 0.95 ? 'critical' : effectiveRatio >= 0.8 ? 'warning' : 'normal';

    return {
      modelName,
      contextWindow,
      used,
      ratio,
      estimatedNextTurn,
      estimatedNextRatio,
      cacheReadTokens,
      cacheCreationTokens,
      outputTokens,
      hasData,
      state,
      hasSummary: options?.hasSummary || false,
      source: baseline ? (baseline.authoritative ? 'exact' : 'approx') : 'none',
      breakdown,
      costUsd: walk.latestCostUsd,
    };
  }, [
    messages,
    modelName,
    options?.context1m,
    options?.hasSummary,
    options?.upstreamModelId,
    options?.modelContextWindow,
  ]);
}
