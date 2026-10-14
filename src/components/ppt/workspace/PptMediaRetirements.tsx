'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject } from '../types';

const ROLE_KEYS = { template_artwork: 'ppt.media.role.artwork', template_decoration: 'ppt.media.role.decoration', template_icon: 'ppt.media.role.icon' } as const;

/** MD-P0-3: template images removed during layout are listed one by one with
 * their page and reason. A removal only counts as accepted after the user
 * confirms it with a reason; the publish gate re-runs on the next quality check. */
export function PptMediaRetirements({ project, onProject, onRecheck, busy }: { project: PptProject; onProject: (project: PptProject) => void; onRecheck: () => void; busy?: boolean }) {
  const { t } = useTranslation();
  const ledger = project.quality?.mediaLedger;
  const retired = ledger?.retired || [];
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const confirmed = ledger?.approvedExclusions || 0;
  if (!retired.length && !confirmed) return null;
  const effective = Math.round((ledger?.effectiveConservation ?? ledger?.conservation ?? 0) * 100);
  async function confirm() {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/ppt/projects/${project.id}/media-exclusions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objectIds: chosen, reason: reason.trim() }), cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setChosen([]); setReason('');
      onProject(data.project);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  return (
    <section data-testid="ppt-media-retirements" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <h3 className="font-medium">{t('ppt.media.retiredTitle')}</h3>
      <p className="mt-1 text-muted-foreground">{t('ppt.media.retiredHelp').replace('{n}', String(effective))}</p>
      {retired.length > 0 && <ul className="mt-3 space-y-2">
        {retired.map(item => (
          <li key={item.objectId}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={chosen.includes(item.objectId)} disabled={saving}
                onChange={event => setChosen(list => event.target.checked ? [...list, item.objectId] : list.filter(id => id !== item.objectId))} />
              <span>
                {t('ppt.media.page').replace('{n}', String(item.page))} · {t(ROLE_KEYS[item.role as keyof typeof ROLE_KEYS] || 'ppt.media.role.image')}
                <small className="block text-muted-foreground">{t(String(item.approvalBasis || '').startsWith('source_region') ? 'ppt.media.basis.sourceRegion' : 'ppt.media.basis.adaptation')}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>}
      {retired.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label={t('ppt.media.reasonLabel')} placeholder={t('ppt.media.reasonLabel')} value={reason} onChange={event => setReason(event.target.value)}
          className="min-w-48 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button className="rounded-lg border border-border px-3 py-2 disabled:opacity-50" disabled={saving || !chosen.length || !reason.trim()} onClick={() => void confirm()}>{t('ppt.media.confirm')}</button>
      </div>}
      {confirmed > 0 && <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background p-2">
        <span>{t('ppt.media.confirmed').replace('{n}', String(confirmed))}</span>
        {project.status === 'quality_blocked' && <button className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={busy} onClick={onRecheck}>{t('ppt.media.recheck')}</button>}
      </div>}
      {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
    </section>
  );
}
