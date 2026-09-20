'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { PptCanvas } from '../canvas/PptCanvas';
import { PptHistory } from '../history/PptHistory';
import { PptInspector } from '../inspector/PptInspector';
import type { StructuredProjectView } from '../types';

async function request(projectId: string, path: string, method = 'GET', payload?: unknown) {
  const response = await fetch(`/api/ppt/projects/${projectId}${path}`, { method, headers: payload ? { 'content-type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value;
}

export function StructuredPptEditor({ project, onProject }: { project: StructuredProjectView; onProject: (project: StructuredProjectView) => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0); const [selectedId, setSelectedId] = useState<string | null>(null); const [instruction, setInstruction] = useState(''); const [error, setError] = useState('');
  const slide = project.renderTree?.slides[page];
  const selected = useMemo(() => slide?.elements.find(element => element.nodeId === selectedId), [slide, selectedId]);
  async function command(type: string, payload: unknown) {
    try { setError(''); const result = await request(project.id, '/commands', 'POST', { id: crypto.randomUUID().replaceAll('-', ''), type, baseRevision: project.revision, payload }); onProject(result.project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  if (!slide) return null;
  return <section data-testid="ppt-structured-editor" className="space-y-3 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{t('ppt.structured.title')}</h3><p className="text-xs text-muted-foreground">{t('ppt.structured.draft')} r{project.revision} · {t('ppt.structured.slide')} {page + 1}/{project.renderTree?.slides.length}</p></div><div className="flex gap-2"><button aria-label={t('ppt.m3.previous')} className="rounded border border-border px-3 py-1 text-sm" disabled={page === 0} onClick={() => { setPage(value => value - 1); setSelectedId(null); }}>←</button><button aria-label={t('ppt.m3.next')} className="rounded border border-border px-3 py-1 text-sm" disabled={page >= (project.renderTree?.slides.length || 1) - 1} onClick={() => { setPage(value => value + 1); setSelectedId(null); }}>→</button><button className="rounded border border-border px-3 py-1 text-sm" onClick={async () => onProject((await request(project.id, '/undo', 'POST')).project)}>{t('ppt.m4.undo')}</button><button className="rounded border border-border px-3 py-1 text-sm" onClick={async () => onProject((await request(project.id, '/redo', 'POST')).project)}>{t('ppt.m4.redo')}</button><button className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground" onClick={async () => onProject((await request(project.id, '/publish', 'POST')).project)}>{t('ppt.structured.publish')}</button></div></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]"><PptCanvas slide={slide} selectedId={selectedId} onSelect={setSelectedId} onGeometry={(element, geometry) => void command('node.setGeometry', { slideId: slide.id, nodeId: element.nodeId, geometry })} /><aside className="space-y-3 rounded-lg border border-border p-3"><h4 className="text-sm font-medium">{t('ppt.structured.properties')}</h4>{selected ? <PptInspector key={selected.id} element={selected} slideId={slide.id} onCommand={command} /> : <p className="text-xs text-muted-foreground">{t('ppt.structured.selectObject')}</p>}<div className="space-y-2 border-t border-border pt-3"><textarea aria-label={t('ppt.structured.aiPlaceholder')} className="min-h-20 w-full rounded border border-border bg-background p-2 text-sm" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={t('ppt.structured.aiPlaceholder')}/><button className="w-full rounded border border-border px-3 py-2 text-sm" disabled={!selectedId || !instruction.trim()} onClick={async () => { try { const result = await request(project.id, '/ai-edit', 'POST', { slideId: slide.id, nodeId: selectedId, instruction, baseRevision: project.revision }); onProject(result.project); setInstruction(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>{t('ppt.structured.aiEdit')}</button></div><PptHistory projectId={project.id} revision={project.revision} /></aside></div>{error && <p className="text-sm text-destructive">{error}</p>}
  </section>;
}
