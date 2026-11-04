'use client';
/* eslint-disable @next/next/no-img-element -- generated, escaped SVG from the shared PPT renderer */
import { useTranslation } from '@/hooks/useTranslation';
import type { PptAiProposal } from '../types';

export function AiBeforeAfterPreview({ proposal }: { proposal: PptAiProposal }) {
  const { t } = useTranslation();
  return <div className="space-y-3" data-testid="ppt-ai-comparison">
    {[['before', proposal.beforeSvg], ['after', proposal.afterSvg]].map(([label, svg]) => <figure key={label}>
      <figcaption className="mb-1 text-xs font-medium">{t(label === 'before' ? 'ppt.edit.before' : 'ppt.edit.after')}</figcaption>
      {svg ? <img className="w-full rounded border border-border" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={t(label === 'before' ? 'ppt.edit.before' : 'ppt.edit.after')}/> : <div className="rounded border border-border p-6 text-sm text-muted-foreground">{t('ppt.mutation.pageRemoved')}</div>}
    </figure>)}
    {proposal.structureChange?.operation==='remove-divider'&&<p className="text-xs text-primary">{t('ppt.mutation.removeDivider')}</p>}
    {Boolean(proposal.pageDelta) && <p className="text-xs text-primary">{t('ppt.mutation.pageDelta')} {proposal.pageDelta! > 0 ? '+' : ''}{proposal.pageDelta}</p>}
    {proposal.afterSlides?.slice(1).map((slide, index) => <figure key={slide.slideId}><figcaption className="mb-1 text-xs">{t('ppt.edit.after')} {index + 2}</figcaption><img className="w-full rounded border border-border" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(slide.svg)}`} alt={`${t('ppt.edit.after')} ${index + 2}`}/></figure>)}
    {proposal.metrics && <p className="text-xs text-muted-foreground" data-testid="ppt-ai-length">{t('ppt.ai.length')}: {proposal.metrics.beforeLength} → {proposal.metrics.afterLength} ({proposal.metrics.ratio ?? '—'}×){proposal.metrics.requestedRatio && ` · ≈${proposal.metrics.requestedRatio}×`}{proposal.metrics.unchanged && ` · ${t('ppt.ai.noChange')}`}{proposal.metrics.approximateTargetMet === false && ` · ${t('ppt.ai.targetUnmet')}`}</p>}
    {Boolean(proposal.quality?.preservedObjectIds?.length || proposal.quality?.objectChanges?.length) && <p className="text-xs text-muted-foreground" data-testid="ppt-ai-object-integrity">{t('ppt.ai.preservedObjects')}: {proposal.quality?.preservedObjectIds?.length || 0} · {t('ppt.ai.changedObjects')}: {proposal.quality?.objectChanges?.length || 0}</p>}
    <ul className="space-y-1 text-xs text-muted-foreground">{proposal.quality?.issues?.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
  </div>;
}
