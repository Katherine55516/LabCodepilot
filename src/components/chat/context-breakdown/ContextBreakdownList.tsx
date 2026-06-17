'use client';

// ============================================================================
// Detail list for the context-usage breakdown — one row per category
// (color dot + i18n label + right-aligned token count). Zero-token rows are
// hidden by default, so the common case shows just Conversation + Cache.
//
// Labels MUST go through runStatus.breakdown* i18n keys — never render
// `part.label` (that's the Chinese fallback). See spec §6.4 / §14.11.
// ============================================================================

import type { TranslationKey } from '@/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import {
  type ContextUsageBreakdown,
  type ContextBreakdownKind,
  PENDING_BREAKDOWN_KINDS,
  formatTokensCompact,
} from '@/lib/context-breakdown';

const LABEL_KEY: Record<ContextBreakdownKind, TranslationKey> = {
  system_prompt: 'runStatus.breakdownSystemPrompt',
  tools: 'runStatus.breakdownTools',
  rules: 'runStatus.breakdownRules',
  skills: 'runStatus.breakdownSkills',
  mcp: 'runStatus.breakdownMcp',
  memory: 'runStatus.breakdownMemory',
  files_attachments: 'runStatus.breakdownFilesAttachments',
  conversation: 'runStatus.breakdownConversation',
  pending_next_turn: 'runStatus.breakdownPendingNextTurn',
  cache_or_previous: 'runStatus.breakdownCacheOrPrevious',
};

function dotVar(kind: ContextBreakdownKind): string {
  return `var(--context-dot-${kind.replace(/_/g, '-')})`;
}

interface ContextBreakdownListProps {
  breakdown: ContextUsageBreakdown;
  /** Hide rows with 0 tokens. Default true. */
  hideZero?: boolean;
  className?: string;
}

export function ContextBreakdownList({
  breakdown,
  hideZero = true,
  className,
}: ContextBreakdownListProps) {
  const { t } = useTranslation();

  const rows = breakdown.parts.filter((p) => (hideZero ? p.tokens > 0 : true));
  if (rows.length === 0) return null;

  return (
    <ul className={`flex flex-col gap-1.5 text-xs ${className ?? ''}`}>
      {rows.map((part) => {
        const isPending = PENDING_BREAKDOWN_KINDS.includes(part.kind);
        return (
          <li
            key={part.kind}
            className={`flex items-center justify-between gap-3 ${
              isPending ? 'text-muted-foreground' : ''
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {isPending ? (
                <span className="inline-block size-2.5 shrink-0 rounded-[2px] border border-dashed border-muted-foreground" />
              ) : (
                <span
                  className="inline-block size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: dotVar(part.kind) }}
                />
              )}
              <span className="truncate">{t(LABEL_KEY[part.kind])}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {formatTokensCompact(part.tokens)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
