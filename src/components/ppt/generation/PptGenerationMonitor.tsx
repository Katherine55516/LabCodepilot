'use client';
/* eslint-disable @next/next/no-img-element -- shared server-rendered PPT previews */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject, PptSlide } from '../types';

function pageState(project: PptProject, slide: PptSlide) {
  const node = project.nodes?.[slide.id];
  return ['done', 'completed'].includes(node?.status || '') ? 'completed' : node?.status === 'running' ? 'running' : 'pending';
}

export function PptGenerationMonitor({ project, onProject, onBackground, onEdit }: { project: PptProject; onProject: (project: PptProject) => void; onBackground?: () => void; onEdit: (slideId: string) => void }) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [viewedId, setViewedId] = useState(project.outline[0]?.id || '');
  const [liveId, setLiveId] = useState(project.outline[0]?.id || '');
  const [followLive, setFollowLive] = useState(true);
  const [filter, setFilter] = useState<'all' | 'started'>('all');
  const [error, setError] = useState(''); const [blankBusy, setBlankBusy] = useState(false);
  const liveRef = useRef(followLive); liveRef.current = followLive;
  const projectRef = useRef(project); projectRef.current = project;
  const acceptRef = useRef(onProject); acceptRef.current = onProject;
  const lastSeq = useRef(0);
  const runId = useRef(project.currentRunId);
  useEffect(() => {
    if (runId.current !== project.currentRunId) { runId.current = project.currentRunId; lastSeq.current = 0; }
    if (!['ingesting', 'outlining', 'generating', 'paused'].includes(project.status)) return;
    let stopped = false; let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => { try { const response = await fetch(`/api/ppt/projects/${project.id}`, { cache: 'no-store' }); if (response.ok && !stopped) acceptRef.current((await response.json()).project); } catch {} }, 100); };
    const stream = new EventSource(`/api/ppt/projects/${project.id}/events?after=${lastSeq.current}`);
    stream.onopen = () => setConnected(true); stream.onerror = () => setConnected(false);
    stream.addEventListener('snapshot', event => { if (stopped) return; const value = JSON.parse((event as MessageEvent).data); lastSeq.current = Math.max(lastSeq.current, value.run.lastSeq || 0); acceptRef.current(value.project); });
    stream.addEventListener('run-event', event => {
      if (stopped) return; const value = JSON.parse((event as MessageEvent).data);
      if (value.seq <= lastSeq.current) return; lastSeq.current = value.seq;
      const id = value.payload?.slideId || (value.payload?.nodeId?.startsWith('content:') ? value.payload.nodeId.slice(8) : null);
      if (id && projectRef.current.outline.some(slide => slide.id === id)) { setLiveId(id); if (liveRef.current) setViewedId(id); }
      refresh();
    });
    return () => { stopped = true; clearTimeout(refreshTimer); stream.close(); };
  }, [project.id, project.status, project.currentRunId]);
  const aiPages = project.outline.filter(slide => !slide.manualBlank);
  const completed = aiPages.filter(slide => pageState(project, slide) === 'completed').length;
  const visible = project.outline.filter(slide => filter === 'all' || slide.manualBlank || pageState(project, slide) !== 'pending');
  const current = project.outline.find(slide => slide.id === viewedId) || project.outline.find(slide => slide.id === liveId) || project.outline[0];
  const previewState = current && project.runtime?.slides[current.id];
  const previewUrl = (id: string) => `/api/ppt/projects/${project.id}/slides/${id}/preview?format=svg&v=${project.runtime?.slides[id]?.renderHash || ''}`;
  const rendered = aiPages.filter(slide => pageState(project, slide) === 'completed' && project.runtime?.slides[slide.id]?.preview).length;
  const percent = aiPages.length ? Math.round(completed / aiPages.length * 100) : 0;
  const palette = project.templateSpec?.palette || { background: '#171b31', foreground: '#f5f6fc', accent: '#967fff', muted: '#c4c9d8' };
  async function addBlank() {
    if (blankBusy) return; setBlankBusy(true); setError('');
    try { const response = await fetch(`/api/ppt/projects/${project.id}/blank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ afterSlideId: current?.id }) }); const value = await response.json(); if (!response.ok) throw new Error(value.error); onProject(value.project); }
    catch (reason) { setError(String((reason as Error).message)); } finally { setBlankBusy(false); }
  }
  async function sessionAction(action: 'pause' | 'resume' | 'cancel' | 'accept') {
    setBlankBusy(true); setError('');
    try { const response = await fetch(`/api/ppt/projects/${project.id}/${action === 'cancel' ? 'run' : action === 'accept' ? `slides/${current?.id}/accept` : action}`, { method: action === 'cancel' ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json' }, body: action === 'accept' ? JSON.stringify({ accepted: !previewState?.accepted, renderHash: previewState?.renderHash, baseRevision: project.revision }) : undefined }); const value = await response.json(); if (!response.ok) throw new Error(value.error); onProject(value.project); } catch (reason) { setError(String((reason as Error).message)); } finally { setBlankBusy(false); }
  }
  const canAdd = project.status === 'generating' && project.editing?.contentOpen && !project.externalPptx && !project.templateFidelity && project.outline.length < 100;
  return <section data-testid="ppt-generation-monitor" className="ppt-prototype ppt-generation-stage fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground">
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border p-3"><button className="rounded border border-border px-3 py-2" onClick={onBackground}>← {t('ppt.edit.close')}</button><strong className="min-w-0 flex-1 truncate">{project.title}</strong><span className="rounded-full border border-border px-3 py-1 text-xs">{project.model || 'LLM'}</span><span className="text-xs text-muted-foreground">{project.status === 'paused' ? t('ppt.runtime.paused') : connected ? t('ppt.generation.live') : t('ppt.generation.reconnect')}</span><button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!current || !['generating', 'paused'].includes(project.status)} onClick={() => current && onEdit(current.id)}>{t('ppt.edit.editDuring')}</button>{['generating', 'paused'].includes(project.status) && <><button className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" disabled={blankBusy || (project.status !== 'paused' && project.runtime?.pauseRequested)} onClick={() => void sessionAction(project.status === 'paused' ? 'resume' : 'pause')}>{t(project.status === 'paused' ? 'ppt.runtime.resume' : project.runtime?.pauseRequested ? 'ppt.runtime.pausing' : 'ppt.runtime.pause')}</button><button className="rounded border border-border px-3 py-2 text-sm" disabled={blankBusy} onClick={() => void sessionAction('cancel')}>{t('ppt.runtime.cancel')}</button></>}</header>
    <div className="grid min-h-0 flex-1 grid-cols-[7rem_minmax(0,1fr)] md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-r border-border p-2"><label className="text-xs text-muted-foreground">{t('ppt.generation.pages')}<select className="mt-2 w-full rounded border border-border bg-background p-1 text-xs" value={filter} onChange={event => setFilter(event.target.value as 'all' | 'started')}><option value="all">{t('ppt.edit.allPages')}</option><option value="started">{t('ppt.edit.startedPages')}</option></select></label><button disabled={!canAdd || blankBusy} className="mt-3 w-full rounded border border-dashed border-border p-2 text-xs disabled:opacity-50" onClick={() => void addBlank()}>＋ {t('ppt.generation.newPage')}</button><div className="mt-3 space-y-2">{visible.map(slide => <button key={slide.id} className={`w-full rounded border p-2 text-left ${current?.id === slide.id ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => { liveRef.current = false; setFollowLive(false); setViewedId(slide.id); }}><div className="aspect-video overflow-hidden rounded p-1 text-[10px]" style={{ background: palette.background, color: palette.foreground }}>{project.runtime?.slides[slide.id]?.preview ? <img className="h-full w-full object-contain" src={previewUrl(slide.id)} alt={slide.title}/> : slide.title}</div><div className="mt-1 flex flex-wrap justify-between gap-1 text-[10px]"><span>{project.outline.findIndex(item => item.id === slide.id) + 1}</span><span>{slide.manualBlank ? t('ppt.generation.blank') : pageState(project, slide) === 'completed' ? t('ppt.runtime.renderReady') : pageState(project, slide) === 'running' ? t('ppt.generation.generating') : t('ppt.generation.waiting')}</span></div></button>)}</div></aside>
      <main className="min-w-0 overflow-y-auto p-3 md:p-6">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<label className="mb-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={followLive} onChange={event => { setFollowLive(event.target.checked); liveRef.current = event.target.checked; if (event.target.checked) setViewedId(liveId); }}/>{t('ppt.edit.followLive')}</label><div className="mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-xl shadow-xl" style={{ background: palette.background, color: palette.foreground }}>{current && previewState?.preview ? <img className="h-full w-full object-contain" src={previewUrl(current.id)} alt={current.title}/> : <div className="p-[7%]"><h2 className="text-lg font-semibold md:text-3xl">{current?.title || t('ppt.generation.preparing')}</h2><p className="mt-6 text-sm opacity-70">{t('ppt.generation.truth')}</p></div>}</div><div className="mx-auto mt-3 flex max-w-4xl flex-wrap items-center gap-3 text-xs"><span>{t('ppt.runtime.contentReady')} {completed}/{aiPages.length} · {t('ppt.runtime.renderReady')} {rendered}/{aiPages.length} · {t('ppt.runtime.deckReviewPending')}</span>{previewState?.preview && <button className="rounded border border-border px-3 py-2" disabled={blankBusy} onClick={() => void sessionAction('accept')}>{t(previewState.accepted ? 'ppt.runtime.unlock' : 'ppt.runtime.accept')}</button>}</div><div className="mx-auto mt-5 flex max-w-4xl items-center gap-3 text-xs"><span>{completed} / {aiPages.length}</span><div className="h-2 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${percent}%` }}/></div><span>{percent}%</span></div></main>
    </div>
  </section>;
}
