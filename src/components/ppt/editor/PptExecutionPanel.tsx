'use client';
import {useState} from 'react';
import {useTranslation} from '@/hooks/useTranslation';
import type {PptExecutionPolicy,PptProject} from '../types';

export function PptExecutionPanel({project,onProject}:{project:PptProject;onProject:(project:PptProject)=>void}) {
  const {t}=useTranslation();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [inputBudget,setInputBudget]=useState(String(project.executionPolicy?.budget.maxInputTokens||''));
  const [budget,setBudget]=useState(String(project.executionPolicy?.budget.maxOutputTokens||''));
  const legacy=!project.executionPolicy||project.executionPolicy.legacy||project.executionPolicy.qualityLevel==='legacy_single_model';
  const [adopting,setAdopting]=useState(false);
  const [level,setLevel]=useState<PptExecutionPolicy['qualityLevel']>(project.executionPolicy?.qualityLevel==='fast'?'fast':project.executionPolicy?.qualityLevel==='rigorous'?'rigorous':'balanced');
  const editable=['paused','outline_ready','failed','quality_blocked','completed'].includes(project.status);
  async function apply(){
    if(busy)return;if(legacy&&(!project.configId||!project.model)){setError(t('ppt.quality.noModels'));return;}setBusy(true);setError('');
    try{
      const base=project.executionPolicy||{version:1 as const,qualityLevel:'balanced' as const,roleRoutes:{},budget:{maxAttemptsPerTask:5}};
      const roles=legacy?Object.fromEntries(['source_organizer','planner','writer_fast','writer_standard','writer_reasoning','critic'].map(role=>[role,{primary:{configId:project.configId||'',model:project.model||''},fallbacks:[]}])):base.roleRoutes;
      const executionPolicy:PptExecutionPolicy={...base,legacy:false,roleRoutes:roles,qualityLevel:level,budget:{...base.budget,maxInputTokens:Number(inputBudget)>0?Number(inputBudget):undefined,maxOutputTokens:Number(budget)>0?Number(budget):undefined}};
      const response=await fetch(`/api/ppt/projects/${project.id}/execution-policy?view=live`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:project.revision,executionPolicy})});
      const value=await response.json();if(!response.ok)throw new Error(value.error||`HTTP ${response.status}`);onProject(value.project);
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}
  }
  if(legacy&&!adopting)return <details className="mx-auto max-w-6xl rounded border border-border p-3 text-xs"><summary>{t('ppt.quality.legacy')}</summary><p className="my-2">{t('ppt.quality.singleModel')} · {project.model}</p><button disabled={!editable||!project.model||!project.configId} className="rounded border px-3 py-2" onClick={()=>setAdopting(true)}>{t('ppt.quality.adopt')}</button></details>;
  return <details className="mx-auto max-w-6xl rounded border border-border bg-card p-3 text-xs" data-testid="ppt-execution-panel"><summary className="cursor-pointer">{t('ppt.quality.routes')} · {t(`ppt.quality.${project.executionPolicy?.qualityLevel==='fast'?'fast':project.executionPolicy?.qualityLevel==='rigorous'?'rigorous':'balanced'}`)}</summary>
    <p className="mt-2 text-muted-foreground">{t('ppt.quality.futureTasks')}</p><p className="mt-1 text-muted-foreground">{t('ppt.quality.unknownCost')}</p>
    <div className="mt-3 flex flex-wrap gap-2"><select aria-label={t('ppt.execution.qualityTitle')} disabled={!editable||busy} value={level} onChange={event=>setLevel(event.target.value as typeof level)} className="rounded border bg-background p-2">{(['fast','balanced','rigorous'] as const).map(value=><option key={value} value={value}>{t(`ppt.quality.${value}`)}</option>)}</select><input aria-label={t('ppt.quality.inputBudget')} className="rounded border bg-background p-2" type="number" min={1} value={inputBudget} placeholder={t('ppt.quality.unlimited')} disabled={!editable||busy} onChange={event=>setInputBudget(event.target.value)}/><input aria-label={t('ppt.quality.tokenBudget')} className="rounded border bg-background p-2" type="number" min={32768} step={32768} value={budget} placeholder={t('ppt.quality.unlimited')} disabled={!editable||busy} onChange={event=>setBudget(event.target.value)}/><button disabled={!editable||busy} className="rounded border px-3 py-2" onClick={()=>void apply()}>{t('ppt.confirm')}</button></div>
    {error&&<p role="alert" className="mt-2 text-destructive">{error}</p>}
    <div className="mt-3 max-h-60 overflow-auto"><table className="w-full text-left"><thead><tr><th>{t('ppt.quality.task')}</th><th>{t('ppt.quality.model')}</th><th>{t('ppt.quality.result')}</th></tr></thead><tbody>{project.executionHistory?.map(record=><tr key={record.id}><td className="py-1">{record.stage}<small className="block">{record.complexity?.level} · #{record.attempt}</small></td><td>{record.model}</td><td>{record.status}{record.errorCode&&<details><summary>{t('ppt.failure.details')}</summary>{record.errorCode}</details>} · {Math.round((record.elapsedMs||0)/1000)}s{record.inputTokens!==undefined&&<small className="block">{record.inputTokens} / {record.outputTokens??'?'}</small>}</td></tr>)}</tbody></table></div>
  </details>;
}
