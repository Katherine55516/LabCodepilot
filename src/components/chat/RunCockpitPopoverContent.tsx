'use client';

// ============================================================================
// RunCockpit popover body (lazy-loaded — mounted only when the user opens the
// trigger). Composes: header (% + used/total) → dot matrix → detail list →
// divider → "This run" (model / default / permission) → Total cost.
//
// Three render branches (spec §10):
//   A. hasFullCtx (hasData && window>0)  → % + matrix + list + cost
//   B. capacity unknown (hasData, no win) → "Capacity unknown" + used + matrix
//   C. no data                            → just "This run"
//
// Total cost uses the SDK-reported cost_usd (this project's token_usage
// carries it) instead of tokenlens — no extra dependency, real numbers.
// ============================================================================

import { useRouter } from 'next/navigation';
import { ArrowUpRight } from '@phosphor-icons/react';
import { useTranslation } from '@/hooks/useTranslation';
import { useOverviewData } from '@/hooks/useOverviewData';
import { findModelOption } from '@/lib/model-option-match';
import {
  formatTokensCompact,
  formatContextPercent,
} from '@/lib/context-breakdown';
import type { ContextUsageData } from '@/hooks/useContextUsage';
import { ContextDotMatrix } from './context-breakdown/ContextDotMatrix';
import { ContextBreakdownList } from './context-breakdown/ContextBreakdownList';

interface RunCockpitPopoverContentProps {
  providerId?: string;
  modelName?: string;
  permissionProfile: 'default' | 'full_access';
  hasFullCtx: boolean;
  usage: ContextUsageData;
}

function formatCost(costUsd?: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(costUsd ?? 0);
}

export function RunCockpitPopoverContent({
  providerId,
  modelName,
  permissionProfile,
  hasFullCtx,
  usage,
}: RunCockpitPopoverContentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const overview = useOverviewData();

  const pid = providerId || 'env';
  const group = overview.groups.find((g) => g.provider_id === pid);
  const modelOption = findModelOption(group?.models, modelName);
  const modelLabel = modelOption?.label || modelName || t('runStatus.notConfigured');
  const providerLabel = group?.provider_name || pid;
  const modelText = `${providerLabel} · ${modelLabel}`;

  const isPinned = !!overview.globalDefaultModel;
  const defaultModeValue = isPinned
    ? t('runStatus.modePinned')
    : t('runStatus.modeAuto');

  const isFullAccess = permissionProfile === 'full_access';

  const headerPercentText = hasFullCtx
    ? formatContextPercent(usage.ratio)
    : t('runStatus.contextCapacityUnknown');
  const headerTokensText = `${formatTokensCompact(usage.used)} / ${
    usage.contextWindow && usage.contextWindow > 0
      ? formatTokensCompact(usage.contextWindow)
      : '—'
  }`;

  const goSettings = () => router.push('/settings#providers');

  const linkBtnCls =
    'shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/40 transition-colors group-hover/row:text-muted-foreground hover:!text-foreground';

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
          <ContextBreakdownList breakdown={usage.breakdown} />
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
            <div className="group/row flex items-baseline gap-3">
              <span className="shrink-0 text-muted-foreground">
                {t('runStatus.model')}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-foreground">
                {modelText}
              </span>
              <button type="button" onClick={goSettings} className={linkBtnCls}>
                {t('runStatus.switch')}
                <ArrowUpRight size={11} />
              </button>
            </div>
            {/* Default mode */}
            <div className="group/row flex items-baseline gap-3">
              <span className="shrink-0 text-muted-foreground">
                {t('runStatus.defaultMode')}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-foreground">
                {defaultModeValue}
              </span>
              <button type="button" onClick={goSettings} className={linkBtnCls}>
                {t('runStatus.modify')}
                <ArrowUpRight size={11} />
              </button>
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

      {usage.hasData && (
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-muted-foreground">{t('runStatus.totalCost')}</span>
          <span className="font-mono tabular-nums text-foreground">
            {formatCost(usage.costUsd)}
          </span>
        </div>
      )}
    </div>
  );
}
