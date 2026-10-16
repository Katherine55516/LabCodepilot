'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PptProject } from '../types';

/** Round 7 (B3): the outline is compiled, not rejected. This lists the
 * automatic corrections by kind and the remaining points to review. */
const CATEGORY: Record<string, 'ownership' | 'disposition' | 'closure' | 'summary' | 'metadata'> = {
  unknown_source_ids_removed: 'ownership', notes_unit_removed_from_page: 'ownership', ownership_assigned: 'ownership', duplicate_owner_removed: 'ownership',
  cover_units_moved: 'ownership', extra_navigation_page_converted: 'ownership', recap_tags_removed: 'ownership', table_range_replaced_by_full_table: 'ownership',
  disposition_added: 'disposition', duplicate_disposition_removed: 'disposition', unknown_disposition_removed: 'disposition', disposition_defaulted: 'disposition',
  disposition_not_allowed: 'disposition', disposition_to_notes_by_contract: 'disposition', selection_removed_for_contract: 'disposition',
  visible_equivalent_removed: 'disposition', visible_equivalent_corrected: 'disposition', notes_needs_visible_owner: 'disposition',
  language_pair_kept_together: 'closure', relation_kept_together: 'closure',
  summary_sentences_completed: 'summary', summary_rows_completed: 'summary', summary_kept_complete: 'summary',
  metadata_shortened: 'metadata', metadata_filled: 'metadata', metadata_removed: 'metadata', navigation_label_compacted: 'metadata', navigation_groups_merged: 'metadata',
  continuation_marker_removed: 'metadata', duplicate_title_distinguished: 'metadata',
};

export function PptOutlineCorrections({ project }: { project: Pick<PptProject, 'outlineCorrections'> }) {
  const { t } = useTranslation();
  const report = project.outlineCorrections;
  if (!report) return null;
  const counts = new Map<string, number>();
  for (const row of report.summary || []) {
    const category = CATEGORY[row.code] || 'disposition';
    counts.set(category, (counts.get(category) || 0) + row.count);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const warnings = report.warnings || [];
  if (!total && !warnings.length) return null;
  return (
    <section data-testid="ppt-outline-corrections" className={`rounded-xl border p-4 text-sm ${warnings.some(w => w.blocking) ? 'border-amber-500/50 bg-amber-500/10' : 'border-border bg-card'}`}>
      <p className="font-medium">{total ? t('ppt.outlineFix.title').replace('{count}', String(total)) : t('ppt.outlineFix.none')}</p>
      {total > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {[...counts].map(([category, count]) => <li key={category}>{t(`ppt.outlineFix.${category}` as TranslationKey).replace('{count}', String(count))}</li>)}
      </ul>}
      {warnings.length > 0 && <div className="mt-3">
        <p className="text-xs font-medium">{t('ppt.outlineFix.warnings')}</p>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground" data-testid="ppt-outline-warnings">
          {warnings.slice(0, 12).map((warning, index) => <li key={`${warning.code}:${warning.pageIndex ?? index}`} role={warning.blocking ? 'alert' : undefined}>
            {warning.pageIndex !== undefined && <b className="mr-1">{t('ppt.outlineFix.page').replace('{page}', String(warning.pageIndex + 1))}</b>}
            {t(`ppt.outlineFix.${warning.resolution}` as TranslationKey)}
          </li>)}
        </ul>
      </div>}
    </section>
  );
}
