// ============================================================================
// Walk the message list backwards to derive the context-usage baseline.
//
// Pure function (no React). See docs/run-cockpit-context-card-spec.md §5.2.
//
// Three non-obvious rules:
//   0. Numerator priority: token_usage.context_used_tokens (per-turn
//      getContextUsage() snapshot — Claude Code's authoritative measure)
//      wins over input+cacheRead+cacheCreation; the sum remains the
//      fallback for old records / snapshot failures.
//   1. Skip output-only / all-zero tail records. The trailing accounting
//      record is sometimes `{input:0, cache:0, output:N}`; treating used=0
//      would zero the progress bar even though last turn's input+cache is
//      still in context. Walking backwards, the first record with used>0 is
//      the "strong baseline"; a `used==0 && output>0` record is kept as a
//      "weak baseline" fallback.
//   2. The context_window field is always authoritative — captured even from
//      records we skip — so models missing from the static catalog still get
//      a window. context_accounting + cost_usd are captured the same way
//      (latest wins), independent of which record becomes the baseline.
// ============================================================================

import type { Message } from '@/types';

export interface WalkBaseline {
  used: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  /** SDK-reported window on this specific record, if present. */
  sdkContextWindow: number | null;
}

export interface WalkResult {
  baseline: WalkBaseline | null;
  /** Latest (newest) positive SDK context_window seen during the walk. */
  latestSdkContextWindow: number | null;
  /**
   * Latest runtime-requested model name seen (token_usage.model) — the same
   * value the "Connected (…)" status line shows, possibly a CLI alias like
   * claude-opus-4-7[1m]. Drives the top-priority [1m] → 1M window override.
   */
  latestModel: string | null;
  /** Latest SDK total_cost_usd seen — drives the card's Total cost line. */
  latestCostUsd?: number;
  /**
   * Reserved for future runtime accounting (workspace rules / tools / MCP …).
   * Captured latest-wins from any record's `context_accounting` field. The
   * backend does not emit this yet, so it is typically null today.
   */
  contextAccounting: unknown | null;
}

export function walkContextUsage(messages: Message[]): WalkResult {
  let latestSdkContextWindow: number | null = null;
  let latestModel: string | null = null;
  let latestContextAccounting: unknown | null = null;
  let latestCostUsd: number | undefined;
  let weakBaseline: WalkBaseline | null = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.token_usage) continue;

    let usage: Record<string, unknown> | null;
    try {
      usage =
        typeof msg.token_usage === 'string'
          ? JSON.parse(msg.token_usage)
          : (msg.token_usage as unknown as Record<string, unknown>);
    } catch {
      continue;
    }
    if (!usage || typeof usage !== 'object') continue;

    const inputTokens = (usage.input_tokens as number) || 0;
    const cacheRead = (usage.cache_read_input_tokens as number) || 0;
    const cacheCreation = (usage.cache_creation_input_tokens as number) || 0;
    const outputTokens = (usage.output_tokens as number) || 0;
    // FIX(权威分子): context_used_tokens = 回合末 getContextUsage() 的
    // totalTokens（Claude Code /context 同源口径，auto-compact 按它触发）。
    // 优先用它；缺失（快照超时/旧记录）时回退 API usage 推导的旧口径。
    // 注意分母不在此处：cli_context_window 仅诊断留档，窗口仍走应用侧解析。
    const contextUsed = (usage.context_used_tokens as number) || 0;
    const used = contextUsed > 0
      ? contextUsed
      : inputTokens + cacheRead + cacheCreation;

    const ctxWindowField = usage.context_window;
    if (
      latestSdkContextWindow === null &&
      typeof ctxWindowField === 'number' &&
      ctxWindowField > 0
    ) {
      latestSdkContextWindow = ctxWindowField;
    }

    // Like context_window, the model name is captured latest-wins even from
    // records that get skipped as baseline candidates.
    const modelField = usage.model;
    if (latestModel === null && typeof modelField === 'string' && modelField) {
      latestModel = modelField;
    }

    const accountingField = usage.context_accounting;
    if (
      latestContextAccounting === null &&
      accountingField &&
      typeof accountingField === 'object'
    ) {
      latestContextAccounting = accountingField;
    }

    const costField = usage.cost_usd;
    if (latestCostUsd === undefined && typeof costField === 'number') {
      latestCostUsd = costField;
    }

    const baselineSdkContextWindow =
      typeof ctxWindowField === 'number' && ctxWindowField > 0
        ? ctxWindowField
        : null;

    if (used === 0 && outputTokens === 0) continue; // all empty, skip

    if (used > 0) {
      return {
        baseline: {
          used,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          outputTokens,
          sdkContextWindow: baselineSdkContextWindow,
        },
        latestSdkContextWindow,
        latestModel,
        latestCostUsd,
        contextAccounting: latestContextAccounting,
      };
    }

    if (!weakBaseline) {
      weakBaseline = {
        used: 0,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        outputTokens,
        sdkContextWindow: baselineSdkContextWindow,
      };
    }
  }

  return {
    baseline: weakBaseline,
    latestSdkContextWindow,
    latestModel,
    latestCostUsd,
    contextAccounting: latestContextAccounting,
  };
}
