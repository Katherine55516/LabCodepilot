'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PptQualityReport } from '../types';

const issueKeys = new Set([
  'report_summary_late', 'report_source_thin', 'report_core_flow_late', 'report_decision_unclear',
  'report_recommendation_missing', 'report_repeated_claim', 'report_claim_without_source',
  'report_topic_uncovered', 'report_small_text',
]);

export function PptReportReadiness({ report }: { report?: PptQualityReport['report'] }) {
  const { t } = useTranslation();
  if (!report || report.status === 'not_applicable') return null;
  return <section className="mt-5 rounded-xl border border-border bg-card p-4" data-testid="ppt-report-readiness">
    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{t('ppt.report.title')}</h4>
      <span className={`rounded-full px-2 py-1 text-xs ${report.status === 'ready' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
        {t(report.status === 'ready' ? 'ppt.report.ready' : 'ppt.report.needsReview')}
      </span></div>
    {report.issues.length > 0 && <ul className="mt-3 space-y-2 text-sm text-muted-foreground">{report.issues.map((item, index) => <li key={`${item.code}-${item.slideId || ''}-${index}`} className="flex gap-2"><span aria-hidden="true">•</span><span>{issueKeys.has(item.code)
      ? t(`ppt.report.issue.${item.code}` as TranslationKey) : item.message}</span></li>)}</ul>}
  </section>;
}
