'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject } from '../types';

/** Why a written deck is blocked (full review W-6): its own checks and
 * findings, or an export verification that failed. A failed export can be
 * retried as it is; checks need the listed issues fixed first. */
export function PptQualityBlockNotice({ project, onRetry, busy = false }: { project: Pick<PptProject, 'status' | 'qualityBlockReason'>; onRetry?: () => void; busy?: boolean }) {
  const { t } = useTranslation();
  if (project.status !== 'quality_blocked' || !project.qualityBlockReason) return null;
  const exportFailed = project.qualityBlockReason === 'export';
  return <section role="status" data-testid="ppt-quality-block-notice" data-reason={project.qualityBlockReason} className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
    <h4 className="font-semibold">{t(exportFailed ? 'ppt.blocked.export' : 'ppt.blocked.checks')}</h4>
    <p className="mt-1 text-muted-foreground">{t(exportFailed ? 'ppt.blocked.exportDetail' : 'ppt.blocked.checksDetail')}</p>
    {exportFailed && onRetry && <button className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={busy} onClick={onRetry}>{t('ppt.blocked.retryExport')}</button>}
  </section>;
}
