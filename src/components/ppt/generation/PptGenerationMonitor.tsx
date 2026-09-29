'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject, PptRun, PptSlide } from '../types';

function pageState(project: PptProject, slide: PptSlide) {
  const node = project.nodes?.[slide.id];
  if (node?.status === 'done' || node?.status === 'completed') return 'completed';
  if (node?.status === 'running') return 'running';
  return 'pending';
}

export function PptGenerationMonitor({ project, onProject, onBackground }: { project: PptProject; onProject: (project: PptProject) => void; onBackground?: () => void }) {
  const { t } = useTranslation();
  const [run, setRun] = useState<PptRun | null>(null);
  const [connected, setConnected] = useState(false);
  const [activeId, setActiveId] = useState(project.outline[0]?.id || '');
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!['ingesting', 'outlining', 'generating'].includes(project.status)) return;
    let stopped = false; let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => { const response = await fetch(`/api/ppt/projects/${project.id}`, { cache: 'no-store' }); if (response.ok && !stopped) onProject((await response.json()).project); }, 100); };
    const stream = new EventSource(`/api/ppt/projects/${project.id}/events?after=${lastSeq.current}`);
    stream.onopen = () => setConnected(true); stream.onerror = () => setConnected(false);
    stream.addEventListener('snapshot', event => { const value = JSON.parse((event as MessageEvent).data) as { project: PptProject; run: PptRun }; setRun(value.run); lastSeq.current = Math.max(lastSeq.current, value.run.lastSeq || 0); onProject(value.project); });
    stream.addEventListener('run-event', event => { const value = JSON.parse((event as MessageEvent).data) as { seq: number; payload?: { nodeId?: string; slideId?: string } }; lastSeq.current = Math.max(lastSeq.current, value.seq); const id = value.payload?.slideId || value.payload?.nodeId?.replace(/^content:/, ''); if (id) setActiveId(id); refresh(); });
    return () => { stopped = true; clearTimeout(refreshTimer); stream.close(); };
  }, [project.id, project.status, onProject]);
  const completed = project.outline.filter(slide => pageState(project, slide) === 'completed').length;
  const firstPending = project.outline.findIndex(slide => pageState(project, slide) !== 'completed');
  const visibleCount = Math.min(project.outline.length, firstPending < 0 ? project.outline.length : firstPending + 1);
  const current = useMemo(() => project.outline.slice(0, visibleCount).find(slide => slide.id === activeId) || project.outline[Math.max(0, visibleCount - 1)], [project, activeId, visibleCount]);
  const currentContent = current && project.nodes?.[current.id]?.slide;
  const palette = project.templateSpec?.palette || { background: '#171b31', foreground: '#f5f6fc', accent: '#967fff', muted: '#c4c9d8' };
  const percent = project.outline.length ? Math.round(completed / project.outline.length * 100) : 0;
  async function addBlank() { const response = await fetch(`/api/ppt/projects/${project.id}/blank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ afterSlideId: current?.id }) }); if (response.ok) onProject((await response.json()).project); }
  return <section data-testid="ppt-generation-monitor" className="ppt-prototype ppt-generation-stage fixed inset-0 z-50 overflow-hidden bg-background text-foreground">
    <header className="flex h-16 flex-wrap items-center gap-3 border-b border-border px-4"><button className="grid h-9 w-9 place-items-center rounded-lg border border-border" aria-label="返回工作区" onClick={onBackground}>←</button><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground">A</span><strong className="min-w-0 truncate">{project.title}</strong><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">AI 生成中</span><div className="ml-auto flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-primary' : 'bg-muted-foreground'}`} title={connected ? t('ppt.generation.live') : t('ppt.generation.reconnect')}/><span className="rounded-full border border-border px-3 py-1 text-xs">{project.model || 'LLM'}</span><button className="rounded-lg border border-border px-3 py-2 text-sm" onClick={onBackground}>转入后台</button></div></header>
    <div className="ppt-generation-grid grid h-[calc(100vh-4rem)] lg:grid-cols-[14rem_minmax(0,1fr)_4rem]">
      <aside className="border-r border-border p-3"><div className="flex items-center justify-between text-xs uppercase text-muted-foreground"><span>{t('ppt.generation.pages')}</span><span>{visibleCount} / {project.outline.length}</span></div><button className="mt-3 w-full rounded-lg border border-dashed border-border px-2 py-2 text-sm hover:bg-accent" onClick={() => void addBlank()}>＋ {t('ppt.generation.newPage')}</button><div className="mt-3 max-h-[29rem] space-y-2 overflow-y-auto">{project.outline.slice(0, visibleCount).map((slide, index) => { const status = pageState(project, slide); return <button key={slide.id} className={`w-full rounded-lg border p-2 text-left ${current?.id === slide.id ? 'border-primary bg-primary/5' : 'border-border'} ${status === 'pending' ? 'opacity-50' : ''}`} onClick={() => setActiveId(slide.id)}><div className="aspect-video rounded border-t-2 p-2 text-[10px]" style={{ background: palette.background, borderColor: palette.accent, color: palette.foreground }}>{project.nodes?.[slide.id]?.slide?.title || slide.title || t('ppt.generation.preparing')}</div><div className="mt-1 flex justify-between text-xs"><span>{index + 1}</span><span>{status === 'completed' ? '✓' : status === 'running' ? t('ppt.generation.generating') : slide.focus === 'manual blank' ? t('ppt.generation.blank') : t('ppt.generation.waiting')}</span></div></button>; })}</div></aside>
      <main className="flex min-w-0 flex-col justify-center bg-background p-5"><div className="mx-auto aspect-video w-full max-w-4xl rounded-xl border-t-8 p-[7%] shadow-xl" style={{ background: palette.background, borderColor: palette.accent, color: palette.foreground }}><p className="text-xs uppercase tracking-widest opacity-60">AIMate · AI Presentation</p><h2 className="mt-5 text-3xl font-bold" style={{ fontFamily: project.templateSpec?.fonts?.titleEastAsia || project.templateSpec?.fonts?.title }}>{currentContent?.title || current?.title || t('ppt.generation.preparing')}</h2><div className="mt-5 h-1 w-28 rounded" style={{ background: palette.accent }}/>{currentContent?.bullets?.length ? <ul className="mt-6 grid gap-3 text-base" style={{ fontFamily: project.templateSpec?.fonts?.bodyEastAsia || project.templateSpec?.fonts?.body }}>{currentContent.bullets.map((bullet, index) => <li key={index} className="rounded border border-current/15 p-3">{bullet}</li>)}</ul> : <div className="mt-8 space-y-3"><div className="h-3 w-5/6 animate-pulse rounded bg-current opacity-15"/><div className="h-3 w-2/3 animate-pulse rounded bg-current opacity-15"/><p className="pt-4 text-sm opacity-60">{t('ppt.generation.truth')}</p></div>}<span className="mt-6 inline-block rounded-full bg-black/20 px-3 py-1 text-xs">✦ {currentContent ? '当前页面已完成' : 'AI 正在生成页面内容'}</span></div><div className="mx-auto mt-5 flex w-full max-w-4xl items-center gap-3"><b className="text-sm">正在生成第 {Math.min(completed + 1, project.outline.length)} / {project.outline.length} 页 · 当前 {project.outline.length} 页</b><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }}/></div><span className="text-sm">{percent}%</span></div></main>
      <aside className="hidden border-l border-border p-2 lg:flex lg:flex-col lg:items-center lg:gap-2">{['⌕', 'Aa', '▧', '▦', '▥', '☷', '✎'].map(tool => <span key={tool} className="grid h-9 w-9 place-items-center rounded border border-border text-xs text-muted-foreground">{tool}</span>)}</aside>
    </div>
  </section>;
}
