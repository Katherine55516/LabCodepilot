'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject } from '../types';

/** Outline concision (item 1 and 7): the budget guard that paused automatic
 * generation, and the outline's size compared with the Gamma reference. */
export function PptOutlineConcision({ project }: { project: PptProject }) {
  const { t } = useTranslation();
  const growth = project.pageDecision?.growth, metrics = project.pageDecision?.concision;
  if (!growth && !metrics?.budget) return null;
  return (
    <section data-testid="ppt-outline-concision" className={`rounded-xl border p-4 text-sm ${growth ? 'border-amber-500/50 bg-amber-500/10' : 'border-border bg-card'}`}>
      {growth && <p role="alert" className="font-medium">{t('ppt.concision.growth').replace('{final}', String(growth.final)).replace('{limit}', String(growth.limit))}</p>}
      {metrics && <p className={`text-muted-foreground ${growth ? 'mt-2' : ''}`}>{t('ppt.concision.summary')
        .replace('{pages}', String(metrics.pages)).replace('{sections}', String(metrics.majorSections))
        .replace('{perSection}', String(metrics.pagesPerSection ?? '—')).replace('{fill}', metrics.medianFill === null ? '—' : String(Math.round(metrics.medianFill * 100)))}</p>}
      {metrics?.warnings?.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{metrics.warnings.map(code => <li key={code}>{t(`ppt.concision.${code}`)}</li>)}</ul> : null}
    </section>
  );
}
