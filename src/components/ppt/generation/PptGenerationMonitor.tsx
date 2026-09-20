'use client';

import { useEffect, useRef, useState } from 'react';
import type { PptRun, StructuredProjectView } from '../types';
import { useTranslation } from '@/hooks/useTranslation';

export function PptGenerationMonitor({ project, onProject }: { project: StructuredProjectView; onProject: (project: StructuredProjectView) => void }) {
  const { t } = useTranslation();
  const [run, setRun] = useState<PptRun | null>(null);
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!['ingesting', 'outlining', 'generating'].includes(project.status)) return;
    let stopped = false; let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => {
        const response = await fetch(`/api/ppt/projects/${project.id}`, { cache: 'no-store' });
        if (response.ok && !stopped) onProject((await response.json()).project);
      }, 120);
    };
    const stream = new EventSource(`/api/ppt/projects/${project.id}/events?after=${lastSeq.current}`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener('snapshot', event => {
      const value = JSON.parse((event as MessageEvent).data) as { project: StructuredProjectView; run: PptRun };
      setRun(value.run); lastSeq.current = Math.max(lastSeq.current, value.run.lastSeq || 0); onProject(value.project);
    });
    stream.addEventListener('run-event', event => {
      const value = JSON.parse((event as MessageEvent).data) as { seq: number };
      lastSeq.current = Math.max(lastSeq.current, value.seq); refresh();
    });
    return () => { stopped = true; clearTimeout(refreshTimer); stream.close(); };
  }, [project.id, project.status, onProject]);
  const nodes = Object.values(run?.nodes || {});
  const completed = nodes.filter(node => node.status === 'completed').length;
  return <section data-testid="ppt-generation-monitor" className="rounded-xl border border-border bg-card p-4">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-medium">{t('ppt.generation.process')}</h3><p className="text-sm text-muted-foreground">{run?.stage || project.stage} · {completed}/{nodes.length || '—'}</p></div><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-primary' : 'bg-muted-foreground'}`} aria-label={connected ? t('ppt.generation.live') : t('ppt.generation.reconnecting')} /><button className="rounded border border-border px-2 py-1 text-xs" onClick={async () => { const response = await fetch(`/api/ppt/projects/${project.id}/run`, { method: 'DELETE' }); if (response.ok) onProject((await response.json()).project); }}>{t('ppt.cancel')}</button></div></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-5">{nodes.map(node => <div key={node.id} className="rounded-lg border border-border p-2 text-xs"><b>{node.id}</b><p className="text-muted-foreground">{node.status}{node.attempts ? ` · ${node.attempts}` : ''}</p></div>)}</div>
  </section>;
}
