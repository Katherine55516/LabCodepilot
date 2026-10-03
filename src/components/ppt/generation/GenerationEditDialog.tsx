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

export function GenerationEditDialog({ project, slideId, open = true, onProject, onClose }: { project: PptProject; slideId: string; open?: boolean; onProject: (project: PptProject) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const storageKey = `ppt-generation-draft:${project.id}:conversation`;
  const [snapshot, setSnapshot] = useState<PptEditScope | null>(null);
  const [scope, setScope] = useState<PptGenerationScope>('current');
  const [drafts, setDrafts] = useState<Record<PptGenerationScope, string>>({ current: '', remaining: '', following: '', section: '', deck: '' });
  const [mutationType, setMutationType] = useState<PptMutationType>('auto');
  const [proposal, setProposal] = useState<PptAiProposal | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [intent, setIntent] = useState<PptEditIntent | null>(null);
  const attempt = useRef(0); const mounted = useRef(true);
  const retry = useRef<{ fingerprint: string; payload: string; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true; const token = ++attempt.current;
    let restored = false;
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || sessionStorage.getItem(`ppt-generation-draft:${project.id}:${slideId}`) || 'null'); if (saved?.snapshot) { if (['auto','title','content','layout','style','structure'].includes(saved.mutationType)) setMutationType(saved.mutationType); setSnapshot(saved.snapshot); setDrafts(current => ({ ...current, ...saved.drafts })); if (['current','remaining','following','section','deck'].includes(saved.scope)) setScope(saved.scope); restored = true; } } catch {}
    if (!restored) void request(project.id, 'generation-edit-scopes', { slideId }).then(value => { if (mounted.current && attempt.current === token) setSnapshot(value.scope); }).catch(reason => { if (mounted.current && attempt.current === token) setError(String(reason.message)); });
    return () => { mounted.current = false; attempt.current++; };
  }, [project.id, storageKey]);
  useEffect(() => { if (snapshot) try { sessionStorage.setItem(storageKey, JSON.stringify({ snapshot, scope, drafts, mutationType })); } catch {} }, [snapshot, scope, drafts, mutationType, intent, storageKey]);
  const onProjectRef = useRef(onProject); onProjectRef.current = onProject;
  const activeIntentIds = Object.values(project.editing?.intents || {}).filter(value => ['queued','applying'].includes(value.status)).map(value => value.id).join(',');
  useEffect(() => {
    if (!activeIntentIds) return;
    let stopped = false, fetching = false;
    const refresh = async () => { if (fetching) return; fetching = true; try {
      const latest = await request(project.id, '');
      if (!stopped) { onProjectRef.current(latest.project); setIntent(current => current ? latest.project.editing?.intents?.[current.id] || current : null); }
    } catch (reason) { if (!stopped) setError(String((reason as Error).message)); } finally { fetching = false; } };
    const timer = setInterval(() => void refresh(), 1500); void refresh(); return () => { stopped = true; clearInterval(timer); };
  }, [project.id, activeIntentIds]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (open && event.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [open, onClose]);
  async function refreshScope() {
    setBusy(true); setError('');
    try { const value = await request(project.id, 'generation-edit-scopes', { slideId }); if (mounted.current) { setSnapshot(value.scope); setIntent(null); retry.current = null; } }
    catch (reason) { if (mounted.current) setError(String((reason as Error).message)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function submit() {
    if (!snapshot || !drafts[scope].trim() || busy) return;
    const text = drafts[scope].trim();
    const fingerprint = JSON.stringify({ scope, type: mutationType, instruction: text, scopeId: snapshot.id });
    setBusy(true); setError('');
    try {
      if (retry.current?.fingerprint !== fingerprint) {
        const renewed = await request(project.id, 'generation-edit-scopes', { slideId: snapshot.currentSlideId, previousScopeId: snapshot.id, scope });
        retry.current = { fingerprint, payload: JSON.stringify({ scopeId: renewed.scope.id, scope, type: mutationType, instruction: text, conversationId: project.id }), id: crypto.randomUUID() };
      }
      const value = await request(project.id, 'generation-edits', { ...JSON.parse(retry.current.payload), idempotencyKey: retry.current.id });
      if (!mounted.current) return;
      setIntent(value.intent); setSnapshot(value.intent.scopeSnapshot); onProject(value.project); setDrafts(current => current[scope].trim() === text ? { ...current, [scope]: '' } : current); retry.current = null;
    } catch (reason) { if (mounted.current) setError(String((reason as Error).message)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function retryFailed() {
    if (!intent || busy) return; setBusy(true); setError('');
    try { const value = await request(project.id, `generation-edits/${intent.id}/retry`, {}); if (mounted.current) { setIntent(value.intent); onProject(value.project); } }
    catch (reason) { if (mounted.current) setError(String((reason as Error).message)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const history = Object.values(project.editing?.intents || {}).slice();
  function inspectIntent(value: PptEditIntent) { setIntent(value); setError(''); }
  const targetsFor = (value: PptGenerationScope) => snapshot ? ({ current: [snapshot.currentSlideId], remaining: snapshot.remainingSlideIds, following: snapshot.followingSlideIds || [], section: snapshot.sectionSlideIds || [], deck: snapshot.deckSlideIds || [] }[value]).filter(id => !project.runtime?.slides[id]?.accepted) : [];
  const targets = targetsFor(scope);
  async function showProposal(id: string) { setBusy(true); setError(''); try { setProposal((await request(project.id, `proposals/${id}`)).proposal); } catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); } }
  async function decideProposal(action: 'apply' | 'discard') { if (!proposal) return; setBusy(true); setError(''); try { const value = await request(project.id, `proposals/${proposal.id}/${action}`, {}); onProject(value.project); const updated = await request(project.id, `generation-edits/${intent?.id}`); setIntent(updated.intent); setProposal(null); } catch (reason) { setError(String((reason as Error).message)); } finally { setBusy(false); } }
  return <div hidden={!open} className={open ? "fixed inset-x-0 bottom-0 z-[90] h-[60dvh] lg:inset-x-auto lg:right-0 lg:top-0 lg:h-dvh lg:w-[400px]" : "hidden"}>
    <section role="dialog" aria-modal="false" aria-label={t('ppt.edit.editDuring')} className="flex h-full min-h-0 w-full flex-col overflow-y-auto border border-border bg-background p-4 shadow-xl" data-testid="ppt-generation-edit">
      <header className="flex shrink-0 items-center justify-between gap-3"><h2 className="font-semibold">{t('ppt.edit.editDuring')}</h2><button onClick={onClose} aria-label={t('ppt.edit.close')}>×</button></header>
      <div className="mt-3 min-h-24 flex-1 space-y-3 overflow-y-auto" aria-label={t('ppt.edit.history')} data-testid="ppt-generation-messages">{history.map(value => <article key={value.id} className="rounded border border-border p-3 text-sm"><p className="whitespace-pre-wrap">{value.instruction}</p><p className="mt-2 text-xs text-primary" role="status">{t(`ppt.edit.${value.status}` as TranslationKey)} · {Object.keys(value.perSlideResults).length} {t('ppt.slide')}</p><button className="mt-2 text-xs text-primary" onClick={() => inspectIntent(value)}>{t('ppt.edit.target')}</button></article>)}</div>
      {error && <div className="mt-3 space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p></div>}
      <button className="mt-3 shrink-0 text-left text-xs text-primary" disabled={busy} onClick={() => void refreshScope()}>{t('ppt.edit.refreshScope')}</button>
      <p className="mt-3 text-xs text-muted-foreground">{t('ppt.edit.fixedScope')}</p>
      {['completed', 'quality_blocked'].includes(project.status) && <p className="mt-2 text-sm text-primary">{t('ppt.edit.deferred')}</p>}
      <div className="mt-4 flex flex-wrap gap-2">{(['current', 'remaining', 'following', 'section', 'deck'] as const).map(value => <button key={value} className={`rounded border px-3 py-2 text-sm disabled:opacity-50 ${scope === value ? 'border-primary bg-primary/10' : 'border-border'}`} disabled={busy || !snapshot || !targetsFor(value).length} onClick={() => setScope(value)}>{t(`ppt.edit.${value}` as TranslationKey)}</button>)}</div>
      <ul className="mt-3 max-h-24 overflow-y-auto text-xs text-muted-foreground">{targets.map(id => <li key={id}>{project.outline.findIndex(slide => slide.id === id) + 1}. {project.outline.find(slide => slide.id === id)?.title || id}</li>)}</ul>
      <label className="mt-3 block text-sm">{t('ppt.mutation.type')}<select className="ml-2 rounded border border-border bg-background p-2" disabled={busy} value={mutationType} onChange={event => setMutationType(event.target.value as PptMutationType)}>{(['auto', 'title', 'content', 'layout', 'style', 'structure'] as const).map(type => <option key={type} value={type} disabled={type === 'structure' && scope !== 'current' || Boolean(project.templateFidelity) && ['layout','structure'].includes(type)}>{t(`ppt.mutation.${type}`)}</option>)}</select></label>
      {mutationType === 'structure' && <p className="mt-2 text-xs text-muted-foreground">{t('ppt.mutation.structureDeferred')}</p>}
      <textarea aria-label={t('ppt.editor.instruction')} className="mt-4 min-h-24 shrink-0 w-full rounded border border-border bg-background p-3 text-sm" maxLength={1000} value={drafts[scope]} onChange={event => setDrafts(current => ({ ...current, [scope]: event.target.value }))}/>
      {intent && <div className="mt-4 rounded border border-border p-3 text-sm" role="status"><b>{t(`ppt.edit.${intent.status}` as TranslationKey)}</b><ul className="mt-2 space-y-1 text-xs">{Object.entries(intent.perSlideResults).map(([id, result]) => <li key={id}>{project.outline.findIndex(slide => slide.id === id) + 1}. {t(`ppt.edit.${result.status}` as TranslationKey)} {result.error || ''} {result.status === 'proposed' && result.proposalId && <button className="text-primary" disabled={busy} onClick={() => void showProposal(result.proposalId!)}>{t('ppt.mutation.reviewProposal')}</button>}</li>)}</ul></div>}
      {proposal && <div className="mt-4 rounded border border-border p-3"><AiBeforeAfterPreview proposal={proposal}/><div className="mt-3 flex gap-3"><button disabled={busy} onClick={() => void decideProposal('discard')}>{t('ppt.cancel')}</button><button className="text-primary" disabled={busy} onClick={() => void decideProposal('apply')}>{t('ppt.editor.applyAi')}</button></div></div>}
      <footer className="mt-5 flex shrink-0 flex-wrap justify-end gap-2"><button className="rounded border border-border px-3 py-2 text-sm" onClick={onClose}>{t('ppt.edit.close')}</button>
        {intent && ['partially_applied', 'failed', 'conflicted'].includes(intent.status) ? <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy || project.status === 'generating'} onClick={() => void retryFailed()}>{t('ppt.edit.retryFailed')}</button> : null}<button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !snapshot || !targets.length || !drafts[scope].trim() || !['generating', 'paused', 'completed', 'quality_blocked'].includes(project.status)} onClick={() => void submit()}>{t('ppt.edit.submitIntent')}</button>
      </footer>
    </section>
  </div>;
}
