'use client';

// ============================================================================
// RunCockpit popover body (lazy-loaded — mounted only when the user opens the
// trigger). Composes: header (% + used/total) → dot matrix → divider →
// "This run" (model / default / permission).
//
// The per-category detail list (conversation / cache / …) was intentionally
// removed — the bar is a single-color used/total indicator now.
//
// Three render branches (spec §10):
//   A. hasFullCtx (hasData && window>0)  → % + matrix
//   B. capacity unknown (hasData, no win) → "Capacity unknown" + used + matrix
//   C. no data                            → just "This run"
// ============================================================================

import { useTranslation } from '@/hooks/useTranslation';
import { useOverviewData } from '@/hooks/useOverviewData';
import {
  formatTokensCompact,
  formatContextPercent,
} from '@/lib/context-breakdown';
import type { ContextUsageData } from '@/hooks/useContextUsage';
import { ContextDotMatrix } from './context-breakdown/ContextDotMatrix';

interface RunCockpitPopoverContentProps {
  providerId?: string;
  modelName?: string;
  permissionProfile: 'default' | 'full_access';
  hasFullCtx: boolean;
  usage: ContextUsageData;
}

export function RunCockpitPopoverContent({
  providerId,
  modelName,
  permissionProfile,
  hasFullCtx,
  usage,
}: RunCockpitPopoverContentProps) {
  const { t } = useTranslation();
  const overview = useOverviewData();

  const pid = providerId || 'env';
  const group = overview.groups.find((g) => g.provider_id === pid);
  // Show the provider display name only (e.g. "高阶模型-C48"); the model's own
  // sub-label is intentionally omitted.
  const modelText =
    group?.provider_name || modelName || t('runStatus.notConfigured');

  const isFullAccess = permissionProfile === 'full_access';

  const headerPercentText = hasFullCtx
    ? formatContextPercent(usage.ratio)
    : t('runStatus.contextCapacityUnknown');
  const headerTokensText = `${formatTokensCompact(usage.used)} / ${
    usage.contextWindow && usage.contextWindow > 0
      ? formatTokensCompact(usage.contextWindow)
      : '—'
  }`;

  return (
    <div className="flex flex-col gap-3 text-xs">
      {usage.hasData && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <p className={hasFullCtx ? 'text-foreground' : 'text-muted-foreground'}>
              {headerPercentText}
            </p>
            <p className="font-mono text-muted-foreground">{headerTokensText}</p>
          </div>
          <ContextDotMatrix breakdown={usage.breakdown} />
        </div>
      )}

      {usage.hasData && <div className="-mx-3 border-t border-border" />}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium text-foreground">
          {t('runStatus.title')}
        </div>
        {overview.loading ? (
          <div className="text-muted-foreground">{t('runStatus.loading')}</div>
        ) : (
          <>
            {/* Model */}
            <div className="flex items-baseline gap-3">
              <span className="shrink-0 text-muted-foreground">
                {t('runStatus.model')}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-foreground">
                {modelText}
              </span>
            </div>
            {/* Permission */}
            <div className="flex items-baseline gap-3">
              <span className="shrink-0 text-muted-foreground">
                {t('runStatus.permission')}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-right ${
                  isFullAccess ? 'text-status-error-foreground' : 'text-foreground'
                }`}
              >
                {isFullAccess
                  ? t('runStatus.permissionFullAccess')
                  : t('runStatus.permissionDefault')}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
