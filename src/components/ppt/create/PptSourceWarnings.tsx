'use client';
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { pptFailureMessage } from '@/lib/ppt-error';
import type { PptArithmeticParams, PptPdfWarningParams, PptProject } from '../types';

/** Input readiness (P0-3): required source warnings (lost content) are
 * resolved before any slide is written — re-upload a corrected input, or
 * acknowledge the loss for this exact source. The server re-checks the same
 * rule on /generate. A source inconsistency (a count that does not multiply
 * out) is advisory: the author may keep the original, nothing waits on it. */
export function unresolvedSourceWarnings(project: Pick<PptProject, 'sourceMediaWarnings'> | null | undefined) {
  return (project?.sourceMediaWarnings || []).filter(warning => warning.required && !warning.resolved);
}

export function PptSourceWarnings({ project, onProject }: { project: PptProject; onProject: (project: PptProject) => void }) {
  const { t, locale } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const warnings = project.sourceMediaWarnings || [];
  if (!warnings.length) return null;
  const pending = unresolvedSourceWarnings(project).length;
  // An inconsistent original statement is kept as written, not "ignored".
  const keepsOriginal = (cause?: string | null) => cause === 'source_inconsistency';
  // Warnings are worded here, in the reader's language, from their code and figures.
  const pdfText: Record<string, 'ppt.sourceWarnings.pdfMath' | 'ppt.sourceWarnings.pdfReadingOrder' | 'ppt.sourceWarnings.pdfColumns' | 'ppt.sourceWarnings.pdfMargin'> = { source_pdf_math_requires_confirmation: 'ppt.sourceWarnings.pdfMath', source_pdf_reading_order: 'ppt.sourceWarnings.pdfReadingOrder', source_pdf_columns: 'ppt.sourceWarnings.pdfColumns', source_pdf_margin_text: 'ppt.sourceWarnings.pdfMargin' };
  const text = (warning: (typeof warnings)[number]) => warning.code === 'source_arithmetic_conflict' && warning.params ? `${t('ppt.sourceWarnings.arithmetic', warning.params as PptArithmeticParams)} ${t('ppt.sourceWarnings.arithmeticHint')}`
    : pdfText[warning.code] && warning.params ? t(pdfText[warning.code], warning.params as PptPdfWarningParams) : warning.message;
  // The location is part of a grouped PDF sentence; others show it as a prefix.
  const located = (warning: (typeof warnings)[number]) => pdfText[warning.code] && warning.params ? text(warning) : `${warning.location ? `${warning.location}: ` : ''}${text(warning)}`;
  // A confirmation (formulas read as text, a line-by-line reading order) has a
  // suggested handling; a lost object needs the author's choice (Fable 2026-10-26).
  const confirmation = (code: string) => code === 'source_pdf_math_requires_confirmation' || code === 'source_pdf_reading_order';
  const open = unresolvedSourceWarnings(project);
  const confirmAll = open.length > 1 && open.every(warning => confirmation(warning.code) && warning.key);
  async function acknowledge(keys: string[], cause?: string | null, code?: string) {
    setBusy(keys.join(',')); setError('');
    try {
      const reason = keepsOriginal(cause) ? 'ppt.create.sourceWarnings.keepReason' : code && confirmation(code) ? 'ppt.create.sourceWarnings.confirmReason' : 'ppt.create.sourceWarnings.reason';
      const response = await fetch(`/api/ppt/projects/${project.id}/source-warnings?view=live`, { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ keys, reason: t(reason) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || response.statusText);
      onProject(value.project);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  }
  return <div data-testid="ppt-source-warnings" className="space-y-2">
    {pending > 0 && <p role="alert" className="text-xs font-medium text-destructive">{t('ppt.create.sourceWarnings.unresolved').replace('{count}', String(pending))}</p>}
    {confirmAll && <div className="space-y-1">
      <button type="button" data-testid="ppt-source-warnings-confirm-all" className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50" disabled={busy !== null} onClick={() => void acknowledge(open.map(warning => warning.key!), null, open[0].code)}>{t('ppt.create.sourceWarnings.confirmAll')}</button>
      <p className="text-xs text-muted-foreground">{t('ppt.create.sourceWarnings.confirmAllList', { items: open.map(warning => warning.location || warning.code).join('；') })}</p>
    </div>}
    <ul className="space-y-2">{warnings.map((warning, index) => <li key={warning.key || index} data-required={warning.required ? 'true' : undefined} data-resolved={warning.resolved ? 'true' : undefined} className={`rounded border p-2 text-xs ${warning.required && !warning.resolved ? 'border-destructive/50 text-destructive' : 'border-border text-muted-foreground'}`}>
      <p className="break-words">{located(warning)}</p>
      {warning.cause === 'runtime_dependency_missing' && <p className="mt-1 text-muted-foreground">{t('ppt.create.sourceWarnings.runtime')}</p>}
      {warning.key && keepsOriginal(warning.cause) && !warning.required && (warning.kept
        ? <p className="mt-1 text-muted-foreground">{t('ppt.create.sourceWarnings.keptOriginal')}</p>
        : <button type="button" className="mt-2 rounded border border-border px-2 py-1 text-foreground hover:bg-accent disabled:opacity-50" disabled={busy !== null} onClick={() => void acknowledge([warning.key!], warning.cause)}>{t('ppt.create.sourceWarnings.keepOriginal')}</button>)}
      {warning.required && warning.key && (warning.resolved
        ? <p className="mt-1 text-muted-foreground">{t(keepsOriginal(warning.cause) ? 'ppt.create.sourceWarnings.keptOriginal' : confirmation(warning.code) ? 'ppt.create.sourceWarnings.confirmed' : 'ppt.create.sourceWarnings.acknowledged')}</p>
        : <button type="button" className="mt-2 rounded border border-border px-2 py-1 text-foreground hover:bg-accent disabled:opacity-50" disabled={busy !== null} onClick={() => void acknowledge([warning.key!], warning.cause, warning.code)}>{t(keepsOriginal(warning.cause) ? 'ppt.create.sourceWarnings.keepOriginal' : confirmation(warning.code) ? 'ppt.create.sourceWarnings.confirm' : 'ppt.create.sourceWarnings.acknowledge')}</button>)}
    </li>)}</ul>
    {error && <p role="alert" className="text-xs text-destructive">{pptFailureMessage(error, locale)}</p>}
  </div>;
}
