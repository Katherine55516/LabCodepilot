// ============================================================================
// Context usage breakdown — pure data layer.
//
// Splits the "used" context tokens of the current run into 10 stable
// categories that the RunCockpit card renders as a dot-matrix bar + a detail
// list. Framework-agnostic: no React, no DOM, no I/O. The card is just one
// renderer of this data.
//
// Key design notes (see docs/run-cockpit-context-card-spec.md §5.1 / §14):
//   - `usedTokens = max(reportedUsed, knownNonConversation + output)`. Some
//     provider proxies report input_tokens=0 while real per-turn tokens live
//     in the accounting entries; the max takes the lower bound of what we
//     *know* is in context. On the ClaudeCode path reportedUsed already
//     includes everything, so max is a no-op (no double counting).
//   - `conversation` absorbs the residual: `max(0, used - knownNonConversation)`.
//     When known parts already exceed `used`, conversation clamps to 0 and we
//     deliberately do NOT rescale — that's the "orchestrator over-estimated"
//     signal.
//   - pending parts (files_attachments + pending_next_turn) describe "what the
//     NEXT turn will add" and are NEVER counted toward usedTokens / ratio.
// ============================================================================

export type ContextBreakdownKind =
  | 'system_prompt'
  | 'tools'
  | 'rules'
  | 'skills'
  | 'mcp'
  | 'memory'
  | 'files_attachments'
  | 'conversation'
  | 'pending_next_turn'
  | 'cache_or_previous';

/**
 * Stable order used everywhere a deterministic sequence matters: dot-matrix
 * coloring order and detail-list row order both follow this.
 */
export const CONTEXT_BREAKDOWN_KIND_ORDER: readonly ContextBreakdownKind[] = [
  'system_prompt',
  'tools',
  'rules',
  'skills',
  'mcp',
  'memory',
  'files_attachments',
  'conversation',
  'pending_next_turn',
  'cache_or_previous',
] as const;

/**
 * Categories describing "what gets added next turn". Rendered with a dashed
 * style in the matrix/list and excluded from usedTokens.
 */
export const PENDING_BREAKDOWN_KINDS: readonly ContextBreakdownKind[] = [
  'files_attachments',
  'pending_next_turn',
] as const;

/**
 * Fallback / test / non-React / debug labels ONLY. The UI must render i18n
 * (runStatus.breakdown*) instead — never render `part.label` directly or
 * Chinese fallbacks leak into other locales.
 */
export const DEFAULT_LABELS: Record<ContextBreakdownKind, string> = {
  system_prompt: '系统提示',
  tools: '工具',
  rules: '规则',
  skills: 'Skills',
  mcp: 'MCP',
  memory: 'Memory',
  files_attachments: '文件与附件',
  conversation: '对话历史',
  pending_next_turn: '本次待加入',
  cache_or_previous: '缓存 / 上轮',
};

export interface ContextBreakdownPart {
  kind: ContextBreakdownKind;
  /** = DEFAULT_LABELS[kind]. UI overrides with i18n; do not render directly. */
  label: string;
  /** 0 means the source is not wired up or empty for this run. */
  tokens: number;
  /** Internal debug breadcrumb — never rendered to the user. */
  source: string;
  /** Optional sub-detail (e.g. attachment file names). */
  detail?: string;
}

export interface ContextUsageBreakdown {
  /** Sum of all "used" (non-pending) parts. */
  usedTokens: number;
  /** Resolved window; undefined when unknown / invalid. */
  contextWindow?: number;
  /** max(0, window - used); undefined when window unknown. */
  remainingTokens?: number;
  /** used/window clamped to [0,1]; undefined when window unknown. */
  ratio?: number;
  /** Always 10 items, ordered by CONTEXT_BREAKDOWN_KIND_ORDER. */
  parts: ContextBreakdownPart[];
}

export interface ContextBreakdownBaseline {
  /** = input + cacheRead + cacheCreation from the most recent API usage. */
  used: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

/** Estimate from the composer (not yet sent). All optional. */
export interface ContextBreakdownPending {
  attachmentTokens?: number;
  mentionTokens?: number;
  directoryTokens?: number;
  composerTextTokens?: number;
}

/**
 * Orchestration / harness side fragments. All optional — `undefined` means the
 * source is not wired up, so that row renders 0 (and is hidden by default).
 * This is the forward-looking hook for runtime context accounting.
 */
export interface ContextBreakdownCompiler {
  systemPromptTokens?: number;
  /** Tool descriptors (excluding MCP). */
  toolDescriptorTokens?: number;
  /** Workspace / project rules. */
  workspaceRuleTokens?: number;
  /** Skill prompts + harness extension prompts. */
  skillsHarnessTokens?: number;
  /** MCP server tool definitions only. */
  mcpDescriptorTokens?: number;
  /** Memory fragments. */
  memoryTokens?: number;
}

export interface ContextBreakdownInputs {
  baseline?: ContextBreakdownBaseline;
  contextWindow?: number;
  pending?: ContextBreakdownPending;
  compiler?: ContextBreakdownCompiler;
}

/**
 * Core split. See file header / spec §5.1 for the invariants this guarantees.
 */
export function buildContextUsageBreakdown(
  inputs: ContextBreakdownInputs,
): ContextUsageBreakdown {
  const { baseline, contextWindow, pending, compiler } = inputs;

  const reportedUsedTokens = Math.max(0, Math.floor(baseline?.used ?? 0));
  const outputTokens = Math.max(0, Math.floor(baseline?.outputTokens ?? 0));

  const systemPromptTokens = Math.max(0, compiler?.systemPromptTokens ?? 0);
  const toolsTokens = Math.max(0, compiler?.toolDescriptorTokens ?? 0);
  const rulesTokens = Math.max(0, compiler?.workspaceRuleTokens ?? 0);
  const skillsTokens = Math.max(0, compiler?.skillsHarnessTokens ?? 0);
  const mcpTokens = Math.max(0, compiler?.mcpDescriptorTokens ?? 0);
  const memoryTokens = Math.max(0, compiler?.memoryTokens ?? 0);
  const cacheTokens = Math.max(
    0,
    (baseline?.cacheReadTokens ?? 0) + (baseline?.cacheCreationTokens ?? 0),
  );

  const knownUsedNonConversation =
    systemPromptTokens +
    toolsTokens +
    rulesTokens +
    skillsTokens +
    mcpTokens +
    memoryTokens +
    cacheTokens;

  // Lower bound of what we know is in context — see file header.
  const usedTokens = Math.max(
    reportedUsedTokens,
    knownUsedNonConversation + outputTokens,
  );

  const validWindow =
    typeof contextWindow === 'number' && contextWindow > 0
      ? contextWindow
      : undefined;
  const ratio =
    validWindow !== undefined
      ? Math.min(1, Math.max(0, usedTokens / validWindow))
      : undefined;
  const remainingTokens =
    validWindow !== undefined
      ? Math.max(0, validWindow - usedTokens)
      : undefined;

  // Conversation absorbs the residual; clamps to 0 (no rescale) on over-estimate.
  const conversationTokens = Math.max(0, usedTokens - knownUsedNonConversation);

  const filesAttachmentsTokens = Math.max(
    0,
    (pending?.attachmentTokens ?? 0) +
      (pending?.mentionTokens ?? 0) +
      (pending?.directoryTokens ?? 0),
  );
  const pendingNextTurnTokens = Math.max(0, pending?.composerTextTokens ?? 0);

  const tokensByKind: Record<ContextBreakdownKind, number> = {
    system_prompt: systemPromptTokens,
    tools: toolsTokens,
    rules: rulesTokens,
    skills: skillsTokens,
    mcp: mcpTokens,
    memory: memoryTokens,
    files_attachments: filesAttachmentsTokens,
    conversation: conversationTokens,
    pending_next_turn: pendingNextTurnTokens,
    cache_or_previous: cacheTokens,
  };

  const parts: ContextBreakdownPart[] = CONTEXT_BREAKDOWN_KIND_ORDER.map(
    (kind) => ({
      kind,
      label: DEFAULT_LABELS[kind],
      tokens: tokensByKind[kind],
      source: compiler === undefined && !PENDING_BREAKDOWN_KINDS.includes(kind)
        ? 'baseline'
        : 'inputs',
    }),
  );

  return {
    usedTokens,
    contextWindow: validWindow,
    remainingTokens,
    ratio,
    parts,
  };
}

// ── Formatting helpers (must stay consistent everywhere; spec §5.6) ─────────

/** Compact token count: 23900 → "23.9K", 1000000 → "1000K", 999 → "999". */
export function formatTokensCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(Math.max(0, Math.round(n)));
}

/** Percent text: ratio<0.1 keeps 1 decimal else 0 → 0.033 → "3.3%", 0.62 → "62%". */
export function formatContextPercent(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  return `${(clamped * 100).toFixed(clamped < 0.1 ? 1 : 0)}%`;
}
