'use client';

import {useState} from 'react';
import {pptPageLabel,pptProgressTotal} from '@/lib/ppt-page-label';
import {pptFailureMessage} from '@/lib/ppt-error';
import {useTranslation} from '@/hooks/useTranslation';
import type {PptProject} from '../types';
import {isPptTask} from '@/lib/ppt-library';
import {PptRetryHint} from './PptRetryHint';

const button='rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const activeStatuses=new Set(['ingesting','outlining','generating']);
type Filter='all'|'active'|'success'|'failed';

export function PptTaskCenter({projects,onOpen,onRetry,onDelete,onDeleteMany,onOpenTrash,busy=false}: {
 projects:PptProject[];
 onOpen:(project:PptProject)=>void;
 onRetry:(project:PptProject)=>void;
 onDelete?:(project:PptProject)=>void;
 onDeleteMany?:(projects:PptProject[])=>void;
 onOpenTrash?:()=>void;
 busy?:boolean;
}){
 const {t,locale}=useTranslation(),[filter,setFilter]=useState<Filter>('all'),[sort,setSort]=useState('time');
 const [checked,setChecked]=useState<string[]>([]),[previousProjects,setPreviousProjects]=useState(projects);
 if(previousProjects!==projects){
  setPreviousProjects(projects);
  const eligible=new Set(projects.filter(project=>isPptTask(project)&&!activeStatuses.has(project.status)).map(project=>project.id));
  setChecked(previous=>previous.filter(id=>eligible.has(id)));
 }
 const en=locale==='en';
 const tasks=projects.filter(isPptTask).filter(project=>filter==='all'||filter==='active'&&[...activeStatuses,'input_ready','outline_ready'].includes(project.status)||filter==='success'&&project.status==='completed'||filter==='failed'&&['failed','quality_blocked'].includes(project.status)).sort((a,b)=>(sort==='kind'?String(a.inputKind||'').localeCompare(String(b.inputKind||'')):0)||b.createdAt.localeCompare(a.createdAt));
 const labels:Record<Filter,string>=en?{all:'All',active:'In progress',success:'Succeeded',failed:'Failed'}:{all:'全部',active:'进行中',success:'成功',failed:'失败'};
 const kindLabel:Record<string,string>=en?{prompt:'Prompt',paste:'Text',file:'File',template:'Template',update:'Update'}:{prompt:'从 Prompt 开始',paste:'粘贴文本',file:'导入文件',template:'模板生成',update:'基于上一版更新'};
 const selected=tasks.filter(project=>checked.includes(project.id)&&!activeStatuses.has(project.status));
 return <section className="ppt-workspace-content space-y-5" data-testid="ppt-task-center" aria-busy={busy}>
  <header><div className="text-xs font-semibold uppercase tracking-wider text-primary">PPT Workspace</div><h1 className="mt-2 text-2xl font-semibold">{en?'Tasks':'任务中心'}</h1><p className="mt-1 text-sm text-muted-foreground">{t('ppt.task.backgroundHelp')}</p></header>
  <label className="block text-sm">{en?'Sort tasks':'任务排序'}<select disabled={busy} className="ml-2 rounded border border-border bg-background px-3 py-2" aria-label={en?'Sort tasks':'任务排序'} value={sort} onChange={event=>setSort(event.target.value)}><option value="time">{en?'Submission time':'提交时间'}</option><option value="kind">{en?'Input type':'输入方式'}</option></select></label>
  <nav className="flex flex-wrap gap-2" aria-label={en?'Task status filter':'任务状态筛选'}>{(Object.keys(labels) as Filter[]).map(value=><button key={value} disabled={busy} className={button} aria-pressed={filter===value} onClick={()=>{setFilter(value);setChecked([]);}}>{labels[value]}</button>)}</nav>
  {onDeleteMany&&selected.length>0&&<div role="toolbar" aria-label={t('ppt.task.bulkActions')} data-testid="ppt-task-bulk-toolbar" className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-popover px-4 py-3 shadow-sm"><span className="text-sm font-semibold" aria-live="polite">{t('ppt.task.selectionCount',{count:selected.length})}</span><button className={button} disabled={busy} onClick={()=>onDeleteMany(selected)}>{t('ppt.task.deleteSelected')}</button><button className={button} disabled={busy} onClick={()=>setChecked([])}>{t('ppt.cancelSelection')}</button></div>}
  {tasks.length===0?<div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground"><h2>{en?'No matching tasks':'暂无匹配任务'}</h2><p>{en?'Create a presentation from the PPT home page.':'可从 PPT 首页新建演示文稿。'}</p></div>:<div className="space-y-3">{tasks.map(project=>{
   const running=activeStatuses.has(project.status),success=project.status==='completed',unavailable=Boolean(project.deletedAt||project.presentationDeletedPermanentlyAt);
   const pct=success?100:Math.round((project.progress?.contentReady||0)/Math.max(1,project.progress?.total||project.pages)*100);
   const finishedAt=project.timeline?.find(event=>event.stage==='publish')?.at;
   return <article key={project.id} data-testid="ppt-task-row" data-selected={checked.includes(project.id)} className="ppt-task-row grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
    <div className="flex items-center gap-3">{onDeleteMany&&<input type="checkbox" className="ppt-task-select" aria-label={`${t('ppt.select')} ${project.title}`} title={running?t('ppt.task.runningDeleteHelp'):undefined} disabled={busy||running} checked={checked.includes(project.id)} onChange={event=>{const chosen=event.target.checked;setChecked(previous=>chosen?[...previous.filter(id=>id!==project.id),project.id]:previous.filter(id=>id!==project.id));}}/>}<span className="grid h-10 w-10 place-items-center rounded-full bg-muted" aria-hidden>{running?'↻':success?'✓':project.status==='paused'?'Ⅱ':'!'}</span></div>
    <div className="min-w-0"><h2 className="truncate font-medium">{project.title}</h2><p className="mt-1 text-xs text-muted-foreground">{kindLabel[project.inputKind||'prompt']} · {project.model||'—'} · {project.template||'—'} · {project.generationPolicy?.detail||'—'} · {pptPageLabel(project,locale,'task')} · <time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleString()}</time>{finishedAt&&<> · <time dateTime={finishedAt}>{new Date(finishedAt).toLocaleString()}</time></>}</p>
     <span>{(project.planningPhase||project.planningContract?.phase)==='semantic_ready'?t('ppt.plan.semanticReady'):project.status==='outline_ready'&&project.outlineAcceptance?.confirmable===false?t('ppt.task.outlineNeedsRevision'):t(`ppt.task.${project.displayStatus||project.status}`)}</span>{unavailable&&<p className="text-sm text-muted-foreground">{project.presentationDeletedPermanentlyAt?(en?'PPT permanently deleted; generation record retained':'PPT 已永久删除，生成记录仍保留'):(en?'PPT is in the trash; generation record retained':'PPT 已移至回收站，生成记录仍保留')}</p>}
     {running&&<div className="mt-3 flex items-center gap-3"><progress className="h-2 flex-1" value={pct} max={100} aria-label={t('ppt.runtime.contentReady')}/><span className="text-xs">{project.progress?.contentReady||0}/{pptProgressTotal(project)}</span></div>}
     {project.error&&<p className="mt-3 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{pptFailureMessage(project.error,locale)}</p>}<div className="mt-2"><PptRetryHint project={project}/></div>
    </div>
    <div className="flex flex-wrap gap-2">{project.deletedAt&&!project.presentationDeletedPermanentlyAt&&onOpenTrash&&<button className={button} disabled={busy} onClick={onOpenTrash}>{en?'View in trash':'在回收站中查看'}</button>}{!unavailable&&<><button className={button} disabled={busy} onClick={()=>onOpen(project)}>{success?(en?'Open PPT':'打开 PPT'):t('ppt.task.open')}</button>{['failed','quality_blocked'].includes(project.status)&&<button className={button} disabled={busy} onClick={()=>onRetry(project)}>{en?'Continue repair':'继续修复'}</button>}</>}{onDelete&&!running&&<button className={button} disabled={busy} onClick={()=>onDelete(project)}>{t('ppt.task.deleteRecord')}</button>}</div>
   </article>;
  })}</div>}
 </section>;
}
