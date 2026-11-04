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
  }（${headerPercentText}）`;

  return (
    <div className="flex flex-col gap-3 text-xs">
      {usage.hasData && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <p className="text-muted-foreground">
              {t('runStatus.contextUsageLabel')}
            </p>
            <p className="font-mono text-foreground">{headerTokensText}</p>
          </div>
          <ContextDotMatrix breakdown={usage.breakdown} />
          {/* 来源标注(Phase 4B):exact = 回合末权威快照(Claude Code /context
              同源口径);approx = 末次请求 usage 推导的近似值(探针未命中/
              Windows/办公沙箱/流刚结束)。不标注就等于把近似值伪装成实时精确
              值 —— 审计明确点名的展示准确性问题。 */}
          <p className="text-[11px] leading-snug text-muted-foreground">
            {usage.source === 'exact'
              ? t('runStatus.contextSourceExact')
              : t('runStatus.contextSourceApprox')}
          </p>
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
