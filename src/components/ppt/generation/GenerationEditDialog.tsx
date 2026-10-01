'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { AiBeforeAfterPreview } from '../editor/AiBeforeAfterPreview';
import type { PptProject, PptEditScope, PptEditIntent, PptGenerationScope, PptMutationType, PptAiProposal } from '../types';

async function request(projectId: string, path: string, body?: unknown) {
  const response = await fetch(`/api/ppt/projects/${projectId}${path ? `/${path}` : ""}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value;
}

export function GenerationEditDialog({ project, slideId, onProject, onClose }: { project: PptProject; slideId: string; onProject: (project: PptProject) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const storageKey = `ppt-generation-draft:${project.id}:${slideId}`;
  const [snapshot, setSnapshot] = useState<PptEditScope | null>(null);
  const [scope, setScope] = useState<PptGenerationScope>('current');
  const [drafts, setDrafts] = useState<Record<PptGenerationScope, string>>({ current: '', remaining: '', following: '', section: '', deck: '' });
  const [mutationType, setMutationType] = useState<PptMutationType>('auto');
  const [proposal, setProposal] = useState<PptAiProposal | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [intent, setIntent] = useState<PptEditIntent | null>(null);
  const attempt = useRef(0); const mounted = useRef(true);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true; const token = ++attempt.current;
    let restored = false;
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (saved?.snapshot) { if (['auto','title','content','layout','style','structure'].includes(saved.mutationType)) setMutationType(saved.mutationType); setSnapshot(saved.snapshot); setDrafts(current => ({ ...current, ...saved.drafts })); if (['current','remaining','following','section','deck'].includes(saved.scope)) setScope(saved.scope); restored = true; } } catch {}
    if (!restored && !['generating', 'paused'].includes(project.status)) {
      const latest = Object.values(project.editing?.intents || {}).slice(-1)[0];
      if (latest) { setIntent(latest); setSnapshot(latest.scopeSnapshot); setScope(latest.scope); setDrafts(current => ({ ...current, [latest.scope]: latest.instruction })); restored = true; }
    }
    if (!restored) void request(project.id, 'generation-edit-scopes', { slideId }).then(value => { if (mounted.current && attempt.current === token) setSnapshot(value.scope); }).catch(reason => { if (mounted.current && attempt.current === token) setError(String(reason.message)); });
    return () => { mounted.current = false; attempt.current++; };
  }, [project.id, slideId, storageKey]);
  useEffect(() => { if (snapshot && !intent) try { sessionStorage.setItem(storageKey, JSON.stringify({ snapshot, scope, drafts, mutationType })); } catch {} }, [snapshot, scope, drafts, mutationType, intent, storageKey]);
  useEffect(() => {
    if (!intent || !['queued', 'applying'].includes(intent.status)) return;
    let stopped = false; let fetching = false;
    const refresh = async () => { if (fetching) return; fetching = true; try {
      const [result, latest] = await Promise.all([request(project.id, `generation-edits/${intent.id}`), request(project.id, '')]);
      if (!stopped) { setIntent(result.intent); onProject(latest.project); }
    } catch (reason) { if (!stopped) setError(String((reason as Error).message)); } finally { fetching = false; } };
    const timer = setInterval(() => void refresh(), 1500); void refresh(); return () => { stopped = true; clearInterval(timer); };
  }, [project.id, intent?.id, intent?.status, onProject]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [busy, onClose]);
  async function refreshScope() {
    setBusy(true); setError('');
    try { const value = await request(project.id, 'generation-edit-scopes', { slideId }); if (mounted.current) { setSnapshot(value.scope); setIntent(null); retry.current = null; } }
    catch (reason) { if (mounted.current) setError(String((reason as Error).message)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function submit() {
    if (!snapshot || !drafts[scope].trim() || busy) return;
    const payload = JSON.stringify({ scopeId: snapshot.id, scope, type: mutationType, instruction: drafts[scope].trim() });
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const value = await request(project.id, 'generation-edits', { ...JSON.parse(payload), idempotencyKey: retry.current.id });
      if (!mounted.current) return;
      setIntent(value.intent); onProject(value.project); sessionStorage.removeItem(storageKey);
    } catch (reason) { if (mounted.current) setError(String((reason as Error).message)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function retryFailed() {
    if (!intent || busy) return; setBusy(true); setError('');
    try { const value = await request(project.id, `generation-edits/${intent.id}/retry`, {}); if (mounted.current) { setIntent(value.intent); onProject(value.project); } }
    catch (reason) { if (mounted.current) setError(String((reason as Error).message)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const history = Object.values(project.editing?.intents || {}).slice().reverse();
  function inspectIntent(value: PptEditIntent) { setIntent(value); setSnapshot(value.scopeSnapshot); setScope(value.scope); setDrafts(current => ({ ...current, [value.scope]: value.instruction })); setError(''); }
  const targetsFor = (value: PptGenerationScope) => snapshot ? ({ current: [snapshot.currentSlideId], remaining: snapshot.remainingSlideIds, following: snapshot.followingSlideIds || [], section: snapshot.sectionSlideIds || [], deck: snapshot.deckSlideIds || [] }[value]).filter(id => !project.runtime?.slides[id]?.accepted) : [];
  const targets = targetsFor(scope);
  async function showProposal(id: string) { setBusy(true); setError(''); try { setProposal((await request(project.id, `proposals/${id}`)).proposal); } catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); } }
  async function decideProposal(action: 'apply' | 'discard') { if (!proposal) return; setBusy(true); setError(''); try { const value = await request(project.id, `proposals/${proposal.id}/${action}`, {}); onProject(value.project); const updated = await request(project.id, `generation-edits/${intent?.id}`); setIntent(updated.intent); setProposal(null); } catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); } }
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-3" role="presentation">
    <section role="dialog" aria-modal="true" aria-label={t('ppt.edit.editDuring')} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl" data-testid="ppt-generation-edit">
      <header className="flex items-center justify-between gap-3"><h2 className="font-semibold">{t('ppt.edit.editDuring')}</h2><button disabled={busy} onClick={onClose} aria-label={t('ppt.edit.close')}>×</button></header>
      {history.length > 0 && <details className="mt-3 rounded border border-border p-3"><summary className="cursor-pointer text-sm">{t('ppt.edit.history')}</summary><ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">{history.map(value => <li key={value.id}><button className="w-full text-left text-xs hover:text-primary" disabled={busy} onClick={() => inspectIntent(value)}>{t(`ppt.edit.${value.status}` as TranslationKey)} · {value.instruction}</button></li>)}</ul></details>}
      {error && <div className="mt-3 space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{['generating', 'paused'].includes(project.status) && <button className="text-sm text-primary" disabled={busy} onClick={() => void refreshScope()}>{t('ppt.edit.refreshScope')}</button>}</div>}
      <p className="mt-3 text-xs text-muted-foreground">{t('ppt.edit.fixedScope')}</p>
      {['completed', 'quality_blocked'].includes(project.status) && <p className="mt-2 text-sm text-primary">{t('ppt.edit.deferred')}</p>}
      <div className="mt-4 flex flex-wrap gap-2">{(['current', 'remaining', 'following', 'section', 'deck'] as const).map(value => <button key={value} className={`rounded border px-3 py-2 text-sm disabled:opacity-50 ${scope === value ? 'border-primary bg-primary/10' : 'border-border'}`} disabled={busy || Boolean(intent) || !snapshot || !targetsFor(value).length} onClick={() => setScope(value)}>{t(`ppt.edit.${value}` as TranslationKey)}</button>)}</div>
      <ul className="mt-3 max-h-24 overflow-y-auto text-xs text-muted-foreground">{targets.map(id => <li key={id}>{project.outline.findIndex(slide => slide.id === id) + 1}. {project.outline.find(slide => slide.id === id)?.title || id}</li>)}</ul>
      <label className="mt-3 block text-sm">{t('ppt.mutation.type')}<select className="ml-2 rounded border border-border bg-background p-2" disabled={busy || Boolean(intent)} value={mutationType} onChange={event => setMutationType(event.target.value as PptMutationType)}>{(['auto', 'title', 'content', 'layout', 'style', 'structure'] as const).map(type => <option key={type} value={type} disabled={type === 'structure' && scope !== 'current' || Boolean(project.templateFidelity) && ['layout','structure'].includes(type)}>{t(`ppt.mutation.${type}`)}</option>)}</select></label>
      {mutationType === 'structure' && <p className="mt-2 text-xs text-muted-foreground">{t('ppt.mutation.structureDeferred')}</p>}
      <textarea aria-label={t('ppt.editor.instruction')} className="mt-4 min-h-32 w-full rounded border border-border bg-background p-3 text-sm" maxLength={1000} disabled={busy || Boolean(intent)} value={drafts[scope]} onChange={event => setDrafts(current => ({ ...current, [scope]: event.target.value }))}/>
      {intent && <div className="mt-4 rounded border border-border p-3 text-sm" role="status"><b>{t(`ppt.edit.${intent.status}` as TranslationKey)}</b><ul className="mt-2 space-y-1 text-xs">{Object.entries(intent.perSlideResults).map(([id, result]) => <li key={id}>{project.outline.findIndex(slide => slide.id === id) + 1}. {t(`ppt.edit.${result.status}` as TranslationKey)} {result.error || ''} {result.status === 'proposed' && result.proposalId && <button className="text-primary" disabled={busy} onClick={() => void showProposal(result.proposalId!)}>{t('ppt.mutation.reviewProposal')}</button>}</li>)}</ul></div>}
      {proposal && <div className="mt-4 rounded border border-border p-3"><AiBeforeAfterPreview proposal={proposal}/><div className="mt-3 flex gap-3"><button disabled={busy} onClick={() => void decideProposal('discard')}>{t('ppt.cancel')}</button><button className="text-primary" disabled={busy} onClick={() => void decideProposal('apply')}>{t('ppt.editor.applyAi')}</button></div></div>}
      <footer className="mt-5 flex flex-wrap justify-end gap-2"><button className="rounded border border-border px-3 py-2 text-sm" disabled={busy} onClick={onClose}>{t('ppt.edit.close')}</button>
        {intent && ['partially_applied', 'failed', 'conflicted'].includes(intent.status) ? <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy || project.status === 'generating'} onClick={() => void retryFailed()}>{t('ppt.edit.retryFailed')}</button> : !intent && <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !snapshot || !targets.length || !drafts[scope].trim() || !['generating', 'paused', 'completed', 'quality_blocked'].includes(project.status)} onClick={() => void submit()}>{t('ppt.edit.submitIntent')}</button>}
      </footer>
    </section>
  </div>;
}
