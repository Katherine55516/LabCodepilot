'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject } from '../types';

/** Outline concision (item 1 and 7): the budget guard that paused automatic
 * generation, and the outline's size compared with the Gamma reference. */
export function PptOutlineConcision({ project }: { project: PptProject }) {
  const { t } = useTranslation();
  const growth = project.generationPolicy?.version===2?undefined:project.pageDecision?.growth, metrics = project.pageDecision?.concision;
  if (!growth && !metrics?.budget) return null;
  return (
    <section data-testid="ppt-outline-concision" className={`rounded-xl border p-4 text-sm ${growth ? 'border-amber-500/50 bg-amber-500/10' : 'border-border bg-card'}`}>
      {growth && <p role="alert" className="font-medium">{t('ppt.concision.growth').replace('{final}', String(growth.final)).replace('{limit}', String(growth.limit))}</p>}
      {growth?.causes && <div data-testid="ppt-outline-growth-causes" className="mt-2 space-y-1 text-xs">
        {growth.causes.modelEstimate !== null && growth.causes.measuredStructuralPages !== null && <p>{t('ppt.concision.growthEstimate').replace('{model}', String(growth.causes.modelEstimate)).replace('{measured}', String(growth.causes.measuredStructuralPages))}</p>}
        {growth.causes.dedicatedStructuralPages > 0 && <p>{t('ppt.concision.growthStructures').replace('{count}', String(growth.causes.dedicatedStructuralPages))}</p>}
        {growth.causes.splitArtifacts.map(item => <p key={item.sourceUnitId}>{t('ppt.concision.growthSplit').replace('{title}', item.title || item.sourceUnitId).replace('{pages}', String(item.pages))}</p>)}
      </div>}
      {metrics && <p className={`text-muted-foreground ${growth ? 'mt-2' : ''}`}>{t('ppt.concision.summary')
        .replace('{pages}', String(metrics.pages)).replace('{sections}', String(metrics.majorSections))
        .replace('{perSection}', String(metrics.pagesPerSection ?? '—')).replace('{fill}', metrics.medianFill === null ? '—' : String(Math.round(metrics.medianFill * 100)))}</p>}
      {metrics?.warnings?.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{metrics.warnings.map(code => <li key={code}>{t(`ppt.concision.${code}`)}</li>)}</ul> : null}
    </section>
  );
}
