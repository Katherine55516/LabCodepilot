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
   * Data source for the rendered numbers:
   *   - 'snapshot': fresh (<60s) SDK.getContextUsage() capture
   *   - 'result_usage': computed from the last SDKResultMessage.usage
   *   - 'none': no token data yet
   */
  source: 'snapshot' | 'result_usage' | 'none';
  /** When the snapshot was taken (epoch ms). Undefined for result_usage. */
  snapshotCapturedAt?: number;
  /** Categorized breakdown for the RunCockpit card (dot-matrix + detail list). */
  breakdown: ContextUsageBreakdown;
  /** SDK total cost (USD) for this run — drives the card's Total cost line. */
  costUsd?: number;
}

const SNAPSHOT_FRESHNESS_MS = 60_000;

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
    /** Fresh (<60s) SDK-authoritative snapshot. */
    snapshot?: {
      totalTokens: number;
      maxTokens: number;
      capturedAt: number;
    };
  },
): ContextUsageData {
  return useMemo(() => {
    const catalogWindow = getContextWindow(modelName, {
      context1m: options?.context1m,
      upstream: options?.upstreamModelId,
    });

    const walk = walkContextUsage(messages);
    const baseline = walk.baseline;

    const snap = options?.snapshot;
    // Date.now() is impure in useMemo, but this is a one-shot snapshot-vs-now
    // freshness check that naturally re-evaluates whenever messages / model /
    // snapshot identity changes — exactly when staleness matters.
    // eslint-disable-next-line react-hooks/purity
    const snapFresh = !!snap && Date.now() - snap.capturedAt < SNAPSHOT_FRESHNESS_MS;

    // Window priority: [1m] runtime model name (highest — the name shown in
    // the "Connected (…)" status line marks the 1M CLI variant; overrides
    // every other source) → fresh snapshot → this record's SDK window →
    // latest SDK window seen → provider-models window → static catalog →
    // unknown.
    const contextWindow: number | null = is1mContextModelName(walk.latestModel)
      ? 1_000_000
      : (snapFresh && snap!.maxTokens > 0 ? snap!.maxTokens : null) ||
        baseline?.sdkContextWindow ||
        walk.latestSdkContextWindow ||
        options?.modelContextWindow ||
        catalogWindow ||
        null;

    const hasData = snapFresh || baseline !== null;

    // Build the breakdown baseline from the chosen source.
    const breakdownBaseline = snapFresh
      ? {
          used: snap!.totalTokens,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
        }
      : baseline
        ? {
            used: baseline.used,
            cacheReadTokens: baseline.cacheReadTokens,
            cacheCreationTokens: baseline.cacheCreationTokens,
            outputTokens: baseline.outputTokens,
          }
        : undefined;

    const breakdown = buildContextUsageBreakdown({
      baseline: breakdownBaseline,
      contextWindow: contextWindow ?? undefined,
      // Runtime context accounting (tools/rules/mcp/…) is not wired up on this
      // backend yet — leaving compiler undefined means those rows render 0 and
      // hide. This is the forward-looking hook for when it is.
      compiler: undefined,
    });

    const used = breakdown.usedTokens;
    const cacheReadTokens = snapFresh ? 0 : (baseline?.cacheReadTokens ?? 0);
    const cacheCreationTokens = snapFresh ? 0 : (baseline?.cacheCreationTokens ?? 0);
    const outputTokens = snapFresh ? 0 : (baseline?.outputTokens ?? 0);

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
      source: snapFresh ? 'snapshot' : baseline ? 'result_usage' : 'none',
      snapshotCapturedAt: snapFresh ? snap!.capturedAt : undefined,
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
    options?.snapshot,
  ]);
}
