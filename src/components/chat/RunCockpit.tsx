'use client';

// ============================================================================
// RunCockpit — the always-rendered trigger in the composer's bottom-right.
// Mini dot-matrix + percentage; clicking opens a popover (lazy-loaded) with
// the full context-usage breakdown + "This run" details.
//
// Architecture: the trigger is lightweight; the heavy popover body
// (useOverviewData → provider catalog fetches) is code-split via next/dynamic
// and Radix only mounts the content subtree while open — so the chat first
// paint pays nothing for it. See spec §2 / §6.5.
// ============================================================================

import dynamic from 'next/dynamic';
import type { Message } from '@/types';
import { useContextUsage } from '@/hooks/useContextUsage';
import { useTranslation } from '@/hooks/useTranslation';
import {
  formatTokensCompact,
  formatContextPercent,
} from '@/lib/context-breakdown';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ContextDotMatrix } from './context-breakdown/ContextDotMatrix';

const RunCockpitPopoverContent = dynamic(
  () =>
    import('./RunCockpitPopoverContent').then((m) => ({
      default: m.RunCockpitPopoverContent,
    })),
  { ssr: false },
);

interface RunCockpitProps {
  providerId?: string;
  messages?: Message[];
  modelName?: string;
  context1m?: boolean;
  hasSummary?: boolean;
  /** Resolved upstream model id — disambiguates alias windows. */
  upstreamModelId?: string;
  /** Window from /api/providers/models (account-provisioned, most authoritative). */
  modelContextWindow?: number;
  permissionProfile?: 'default' | 'full_access';
}

export function RunCockpit({
  providerId,
  messages,
  modelName,
  context1m,
  hasSummary,
  upstreamModelId,
  modelContextWindow,
  permissionProfile = 'default',
}: RunCockpitProps) {
  const { t } = useTranslation();
  const usage = useContextUsage(messages ?? [], modelName ?? '', {
    context1m,
    hasSummary,
    upstreamModelId,
    modelContextWindow,
  });

  const hasFullCtx = usage.hasData && (usage.contextWindow ?? 0) > 0;

  let ratioText: string;
  if (hasFullCtx) {
    ratioText = formatContextPercent(usage.ratio);
  } else if (usage.hasData) {
    ratioText = formatTokensCompact(usage.used);
  } else {
    ratioText = '—';
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors"
          aria-label={t('runStatus.triggerLabel')}
        >
          <ContextDotMatrix
            breakdown={usage.breakdown}
            cellCount={10}
            rows={1}
            minCellsPerKind={0}
            className="w-[44px] shrink-0"
          />
          <span className="truncate">{ratioText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 overflow-hidden p-3"
      >
        <RunCockpitPopoverContent
          providerId={providerId}
          modelName={modelName}
          permissionProfile={permissionProfile}
          hasFullCtx={hasFullCtx}
          usage={usage}
        />
      </PopoverContent>
    </Popover>
  );
}
