'use client';
import {PptSelectField} from '../PptSelect';
/* eslint-disable @next/next/no-img-element -- shared server-rendered PPT previews */

import { useEffect, useRef, useState } from 'react';
import {StructuredPptEditor} from '../editor/StructuredPptEditor';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject, PptSlide } from '../types';
import type { PptDraft } from './GenerationSkeleton';

function pageState(project: PptProject, slide: PptSlide) {
  const node = project.nodes?.[slide.id];
  return ['done', 'completed'].includes(node?.status || '') ? 'completed' : node?.status === 'running' ? 'running' : 'pending';
}

/** Follow target (V-P0-4): a page being repaired, else the earliest page in
 * outline order that is not render-ready yet. Concurrent writers finish out of
 * order; following the latest finished page made the canvas jump 7→4→10. */
function latestRenderedPage(project:PptProject){
  const ready=(id:string)=>project.runtime?.slides[id]?.phase==='render_ready'&&Boolean(project.runtime?.slides[id]?.preview);
  const repairing=project.outline.find(slide=>project.generationStages?.pages?.[slide.id]==='repairing');
  if(repairing)return repairing.id;
  const unfinished=project.outline.find(slide=>!slide.manualBlank&&!ready(slide.id));
  if(unfinished&&['generating','paused'].includes(project.status))return unfinished.id;
  return project.outline.filter(slide=>ready(slide.id))
    .sort((a,b)=>String(project.runtime?.slides[a.id]?.updatedAt||'').localeCompare(String(project.runtime?.slides[b.id]?.updatedAt||''))).at(-1)?.id||project.outline[0]?.id||'';
}

export function PptGenerationMonitor({ project, chatOpen = false, onProject, onBackground, onEdit }: { project: PptProject; chatOpen?: boolean; onProject: (project: PptProject) => void; onBackground?: () => void; onEdit: (slideId: string) => void }) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [viewedId, setViewedId] = useState(()=>typeof window==='undefined'?project.outline[0]?.id||'':sessionStorage.getItem(`ppt-viewed-page:${project.id}`)||project.outline[0]?.id||'');
  const [liveId, setLiveId] = useState(()=>latestRenderedPage(project));
  const [followLive, setFollowLive] = useState(()=>typeof window==='undefined'||sessionStorage.getItem(`ppt-follow-live:${project.id}`)!=='false');
  const [filter, setFilter] = useState<'all' | 'started'>('all');
  const [drafts, setDrafts] = useState<Record<string, PptDraft>>(() => project.drafts || {});
  const [outlineProgress, setOutlineProgress] = useState<{done:number;total:number}|null>(project.outlineProgress||null);
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
    const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => { try { const response = await fetch(`/api/ppt/projects/${project.id}?view=live`, { cache: 'no-store' }); if (response.ok && !stopped) acceptRef.current((await response.json()).project); } catch {} }, 100); };
    const stream = new EventSource(`/api/ppt/projects/${project.id}/events?after=${lastSeq.current}`);
    stream.onopen = () => setConnected(true); stream.onerror = () => setConnected(false);
    stream.addEventListener('snapshot', event => { if (stopped) return; const value = JSON.parse((event as MessageEvent).data); lastSeq.current = Math.max(lastSeq.current, value.run.lastSeq || 0); acceptRef.current(value.project); });
    // Streaming drafts are transient previews, applied without refetching the project.
    stream.addEventListener('draft', event => { if (stopped) return; const value = JSON.parse((event as MessageEvent).data); const draft=value.draft,current=projectRef.current;if(value?.slideId&&draft&&(!draft.runId||draft.runId===current.currentRunId)&&(!Number.isFinite(current.nodes?.[value.slideId]?.epoch)||draft.epoch===current.nodes?.[value.slideId]?.epoch))setDrafts(previous=>{const old=previous[value.slideId];if(old?.jobId===draft.jobId&&old?.runId===draft.runId&&(old?.seq||0)>=(draft.seq||1))return previous;return {...previous,[value.slideId]:draft};}); });
    stream.addEventListener('run-event', event => {
      if (stopped) return; const value = JSON.parse((event as MessageEvent).data);
      if (value.seq <= lastSeq.current) return; lastSeq.current = value.seq;
      const id = value.payload?.slideId || (value.payload?.nodeId?.startsWith('content:') ? value.payload.nodeId.slice(8) : null);
      if (value.type==='outline.group_ready' && value.payload) setOutlineProgress({done:Number(value.payload.done)||0,total:Number(value.payload.total)||0});
      if (value.type==='slide.render_ready' && id) setDrafts(previous => { if (!previous[id]) return previous; const next = { ...previous }; delete next[id]; return next; });
      refresh();
    });
    return () => { stopped = true; clearTimeout(refreshTimer); stream.close(); };
  }, [project.id, project.status, project.currentRunId]);
  useEffect(()=>{setDrafts(projectRef.current.drafts||{});setOutlineProgress(projectRef.current.outlineProgress||null);},[project.id,project.currentRunId]);
  useEffect(()=>{if(viewedId)sessionStorage.setItem(`ppt-viewed-page:${project.id}`,viewedId);},[project.id,viewedId]);
  const snapshotLiveId=latestRenderedPage(project);
  // SSE snapshots can advance the sequence beyond a render-ready event. The
  // durable snapshot recovers that page; manually browsing never reenables follow.
  useEffect(()=>{setLiveId(snapshotLiveId);if(followLive)setViewedId(snapshotLiveId);},[snapshotLiveId,followLive]);
  useEffect(()=>{sessionStorage.setItem(`ppt-follow-live:${project.id}`,String(followLive));},[project.id,followLive]);
  const aiPages = project.outline.filter(slide => !slide.manualBlank);
  const completed = aiPages.filter(slide => pageState(project, slide) === 'completed').length;
  const visible = project.outline.filter(slide => filter === 'all' || slide.manualBlank || pageState(project, slide) !== 'pending');
  const current = project.outline.find(slide => slide.id === viewedId) || project.outline.find(slide => slide.id === liveId) || project.outline[0];
  const previewState = current && project.runtime?.slides[current.id];
  const previewUrl = (id: string) => `/api/ppt/projects/${project.id}/slides/${id}/preview?format=svg&v=${project.runtime?.slides[id]?.renderHash || ''}`;
  const rendered = aiPages.filter(slide => pageState(project, slide) === 'completed' && project.runtime?.slides[slide.id]?.preview).length;
  const percent = aiPages.length ? Math.round(completed / aiPages.length * 100) : 0;
  const palette = project.templateSpec?.palette || { background: '#171b31', foreground: '#f5f6fc', accent: '#967fff', muted: '#c4c9d8' };
  const outlineGroups=outlineProgress||project.outlineProgress;
  const outlineStatus=project.status==='ingesting'?t('ppt.generation.preparing'):outlineGroups?.total
    ?t('ppt.outline.forming').replace('{done}',String(outlineGroups.done)).replace('{total}',String(outlineGroups.total))
    :t('ppt.outline.streaming').replace('{count}',String(project.candidateOutline?.syllabus?.length||0));
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
  if(['ingesting','outlining'].includes(project.status))return <section data-testid="ppt-generation-monitor" className="ppt-prototype fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground">
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border p-3"><button className="rounded border border-border px-3 py-2" onClick={onBackground}>← {t('ppt.edit.close')}</button><strong className="min-w-0 flex-1 truncate">{project.title}</strong><span className="rounded-full border border-border px-3 py-1 text-xs">{project.model||'LLM'}</span><span className="text-xs text-muted-foreground">{connected?t('ppt.generation.live'):t('ppt.generation.reconnect')}</span></header>
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8"><section data-testid="ppt-outline-forming" className="mx-auto max-w-4xl space-y-4"><h2 className="text-xl font-semibold">{outlineStatus}</h2><p className="text-sm text-muted-foreground">{t('ppt.outline.reviewBeforeSlides')}</p><p className="text-xs text-muted-foreground">{t('ppt.outline.provisionalPages').replace('{count}',String(project.pages))}</p><ol className="space-y-3">{(project.candidateOutline?.syllabus||[]).map((item,i)=><li key={item.id||i} className="rounded-lg border border-border p-3"><span className="text-xs text-muted-foreground">{i+1}. {item.section||''}</span><p className="font-medium">{item.title}</p>{item.message&&<p className="mt-1 text-sm text-muted-foreground">{item.message}</p>}</li>)}</ol></section></main>
  </section>;
  return <section data-testid="ppt-generation-monitor" className={`ppt-prototype ppt-generation-stage fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground ${chatOpen ? "lg:right-[400px]" : ""}`}>
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border p-3"><button className="rounded border border-border px-3 py-2" onClick={onBackground}>← {t('ppt.edit.close')}</button><strong className="min-w-0 flex-1 truncate">{project.title}</strong><span className="rounded-full border border-border px-3 py-1 text-xs">{project.model || 'LLM'}</span><span className="text-xs text-muted-foreground">{project.status === 'paused' ? t('ppt.runtime.paused') : connected ? t('ppt.generation.live') : t('ppt.generation.reconnect')}</span><button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!current || !['generating', 'paused'].includes(project.status)} onClick={() => current && onEdit(current.id)}>{t('ppt.edit.editDuring')}</button>{['generating', 'paused'].includes(project.status) && <><button className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" disabled={blankBusy || (project.status !== 'paused' && project.runtime?.pauseRequested)} onClick={() => void sessionAction(project.status === 'paused' ? 'resume' : 'pause')}>{t(project.status === 'paused' ? 'ppt.runtime.resume' : project.runtime?.pauseRequested ? 'ppt.runtime.pausing' : 'ppt.runtime.pause')}</button><button className="rounded border border-border px-3 py-2 text-sm" disabled={blankBusy} onClick={() => void sessionAction('cancel')}>{t('ppt.runtime.cancel')}</button></>}</header>
    {project.renderTree?.slides.length ? <><div className="flex gap-3 border-b border-border p-2 text-xs"><label><input type="checkbox" checked={followLive} onChange={e=>{setFollowLive(e.target.checked);if(e.target.checked)setViewedId(liveId);}}/>{t("ppt.edit.followLive")}</label><span>{t("ppt.runtime.contentReady")} {completed}/{aiPages.length||project.pages} · {t("ppt.runtime.renderReady")} {rendered}/{aiPages.length||project.pages} · {t("ppt.runtime.deckReviewPending")}</span></div><StructuredPptEditor embedded project={project} chatOpen={chatOpen} drafts={{...(project.drafts||{}),...drafts}} activeSlideId={followLive?liveId:viewedId} onPageChange={id=>{liveRef.current=false;setFollowLive(false);setViewedId(id);}} onProject={onProject} onClose={onBackground}/></> : <div className="grid min-h-0 flex-1 grid-cols-[7rem_minmax(0,1fr)] md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-r border-border p-2"><label className="text-xs text-muted-foreground">{t('ppt.generation.pages')}<PptSelectField className="mt-2 w-full rounded border border-border bg-background p-1 text-xs" value={filter} onValueChange={value=>setFilter(value as 'all' | 'started')}><option value="all">{t('ppt.edit.allPages')}</option><option value="started">{t('ppt.edit.startedPages')}</option></PptSelectField></label><button disabled={!canAdd || blankBusy} className="mt-3 w-full rounded border border-dashed border-border p-2 text-xs disabled:opacity-50" onClick={() => void addBlank()}>＋ {t('ppt.generation.newPage')}</button><div className="mt-3 space-y-2">{visible.map(slide => <button key={slide.id} className={`w-full rounded border p-2 text-left ${current?.id === slide.id ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => { liveRef.current = false; setFollowLive(false); setViewedId(slide.id); }}><div className="aspect-video overflow-hidden rounded p-1 text-[10px]" style={{ background: palette.background, color: palette.foreground }}>{project.runtime?.slides[slide.id]?.preview ? <img className="h-full w-full object-contain" src={previewUrl(slide.id)} alt={slide.title}/> : slide.title}</div><div className="mt-1 flex flex-wrap justify-between gap-1 text-[10px]"><span>{project.outline.findIndex(item => item.id === slide.id) + 1}</span><span>{slide.manualBlank ? t('ppt.generation.blank') : pageState(project, slide) === 'completed' ? t('ppt.runtime.renderReady') : pageState(project, slide) === 'running' ? t('ppt.generation.generating') : t('ppt.generation.waiting')}</span></div></button>)}</div></aside>
      <main className="min-w-0 overflow-y-auto p-3 md:p-6">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{['ingesting','outlining'].includes(project.status) && <section data-testid="ppt-outline-forming" className="mx-auto mb-5 max-w-4xl rounded-xl border border-border p-4"><p className="text-sm font-medium">{outlineStatus}</p><ol className="mt-3 space-y-2">{(project.candidateOutline?.syllabus||[]).map((item,i)=><li key={item.id||i} className="text-sm"><span className="text-muted-foreground">{i+1}. {item.section?`${item.section} · `:''}</span><b>{item.title}</b>{item.message&&<p className="text-xs text-muted-foreground">{item.message}</p>}</li>)}</ol></section>}<label className="mb-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={followLive} onChange={event => { setFollowLive(event.target.checked); liveRef.current = event.target.checked; if (event.target.checked) setViewedId(liveId); }}/>{t('ppt.edit.followLive')}</label><div className="mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-xl shadow-xl" style={{ background: palette.background, color: palette.foreground }}>{current && previewState?.preview ? <img className="h-full w-full object-contain" src={previewUrl(current.id)} alt={current.title}/> : <div className="p-[7%]"><h2 className="text-lg font-semibold md:text-3xl">{current?.title || t('ppt.generation.preparing')}</h2><p className="mt-6 text-sm opacity-70">{t('ppt.generation.truth')}</p></div>}</div><div className="mx-auto mt-3 flex max-w-4xl flex-wrap items-center gap-3 text-xs"><span>{t('ppt.runtime.contentReady')} {completed}/{aiPages.length||project.pages} · {t('ppt.runtime.renderReady')} {rendered}/{aiPages.length||project.pages} · {t('ppt.runtime.deckReviewPending')}</span>{previewState?.preview && <button className="rounded border border-border px-3 py-2" disabled={blankBusy} onClick={() => void sessionAction('accept')}>{t(previewState.accepted ? 'ppt.runtime.unlock' : 'ppt.runtime.accept')}</button>}</div><div className="mx-auto mt-5 flex max-w-4xl items-center gap-3 text-xs"><span>{completed} / {aiPages.length||project.pages}</span><div className="h-2 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${percent}%` }}/></div><span>{percent}%</span></div></main>
    </div>}
  </section>;
}
