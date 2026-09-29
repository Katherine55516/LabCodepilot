'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject } from '../types';

const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';

function progress(project: PptProject) {
  if (project.status === 'completed' || project.status === 'quality_blocked') return 100;
  if (project.status === 'failed' || project.status === 'cancelled') return 0;
  const nodes = Object.values(project.dagNodes || {});
  if (!nodes.length) return project.status === 'outline_ready' ? 25 : project.status === 'outlining' ? 12 : 5;
  return Math.round(nodes.filter(node => node.status === 'completed' || node.status === 'done').length / nodes.length * 100);
}

export function PptTaskCenter({ projects, onOpen, onRetry, onCreate }: {
  projects: PptProject[];
  onOpen: (project: PptProject) => void;
  onRetry: (project: PptProject) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const tasks = [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kindLabel: Record<string, string> = { prompt: '从 Prompt 开始', paste: '粘贴文本', file: '导入文件', template: '模板生成', update: '基于上一版更新' };
  return <section className="ppt-workspace-content space-y-5" data-testid="ppt-task-center">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">Workspace / PPT Workspace</div><h1 className="mt-2 text-2xl font-semibold">任务</h1><p className="mt-1 text-sm text-muted-foreground">生成任务在后台运行，切换模块不会中断；失败任务会显示原因，可一键重试。</p></div><button className={primary} onClick={onCreate}>＋ 新建</button></div>
    {tasks.length === 0 ? <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground"><div className="text-3xl">◷</div><h3 className="mt-3 font-medium text-foreground">暂无任务</h3><p className="mt-1">提交过的 PPT 生成任务会在这里列出。</p><button className={`${primary} mt-4`} onClick={onCreate}>＋ 新建</button></div> : <div className="space-y-3">
      {tasks.map(project => { const pct = progress(project); const running = ['ingesting', 'outlining', 'generating'].includes(project.status); const success = ['completed', 'quality_blocked'].includes(project.status); return <article key={project.id} className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <span className={`grid h-10 w-10 place-items-center rounded-full ${running ? 'bg-primary/10 text-primary' : success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-destructive/10 text-destructive'}`}>{running ? '↻' : success ? '✓' : '✕'}</span>
        <div className="min-w-0"><h3 className="truncate font-medium">{project.title}</h3><p className="mt-1 text-xs text-muted-foreground">{kindLabel[project.inputKind || 'prompt'] || project.inputKind} · 模型 {project.model || '—'} · {project.pages} 页 · 提交于 {new Date(project.createdAt).toLocaleString()}{success ? ` · 完成于 ${new Date(project.updatedAt).toLocaleString()}` : ''}</p>{running && <div className="mt-3 flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }}/></div><span className="text-xs">{pct}%</span></div>}{project.error && <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">失败原因：{project.error}</p>}</div>
        <div>{success ? <button className={button} onClick={() => onOpen(project)}>查看 PPT</button> : project.status === 'failed' ? <button className={button} onClick={() => onRetry(project)}>↻ 重新生成</button> : <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">生成中</span>}</div>
      </article>; })}
    </div>}
  </section>;
}
