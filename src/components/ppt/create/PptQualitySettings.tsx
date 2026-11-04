'use client';
import Link from 'next/link';
import { useTranslation } from '@/hooks/useTranslation';
import {bindPptExecutionPolicy,isPptModelEvaluated,pptTextRoles,pptRoleRef} from '@/lib/ppt-model-catalog';
import {PptSelectField} from '../PptSelect';
import type {PptModel,PptExecutionPolicy} from '../types';

export function initialExecutionPolicy():PptExecutionPolicy {
  return {version:1,qualityLevel:'balanced',roleRoutes:{},budget:{maxAttemptsPerTask:5},catalogVersion:'configured-roles-v1'};
}
export const bindExecutionPolicy=bindPptExecutionPolicy;
export function PptQualitySettings({policy,models,defaultKey,onChange,disabled=false,catalogPending=false}:{policy:PptExecutionPolicy;models:PptModel[];defaultKey:string;onChange:(policy:PptExecutionPolicy)=>void;disabled?:boolean;catalogPending?:boolean}) {
  const {t}=useTranslation();
  const bound=bindExecutionPolicy(policy,models,defaultKey);
  const routes=Object.values(bound.roleRoutes);
  const invalid=routes.some(route=>[route.primary,route.complexPrimary,...route.fallbacks].some(ref=>ref&&!models.some(model=>model.configId===ref.configId&&model.modelId===ref.model&&model.capabilities?.ppt?.health!=='unavailable')));
  const missing=pptTextRoles.filter(role=>!bound.roleRoutes[role]?.primary);
  const unique=new Set(routes.map(route=>route.primary.configId+'::'+route.primary.model)).size;
  return <section className="space-y-3" data-testid="ppt-quality-settings">
    {!catalogPending&&(!models.length?<p role="alert" className="text-sm text-destructive">{t('ppt.quality.noModels')}</p>:<p className="text-xs">{unique===1?t('ppt.quality.singleModel'):t('ppt.quality.multipleModels',{count:unique})}</p>)}
    {!catalogPending&&models.length>0&&missing.length>0&&<p role="alert" className="text-sm text-destructive">{t('ppt.quality.missingRoles',{roles:missing.map(role=>t(`ppt.quality.role.${role}`)).join('、')})}</p>}
    {!catalogPending&&invalid&&<p role="alert" className="text-sm text-destructive">{t('ppt.quality.unavailable')}</p>}
    {!catalogPending&&(!models.length||invalid||missing.length>0)&&<Link className="inline-block text-xs text-primary underline" href="/settings#providers" target="_blank" rel="noopener noreferrer">{t('ppt.quality.configureModels')}</Link>}
    <details><summary className="cursor-pointer text-sm font-semibold">{t('ppt.execution.qualityTitle')}</summary><div className="mt-3 space-y-3">
    <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={t('ppt.execution.qualityTitle')}>{(['fast','balanced','rigorous'] as const).map(level=><button type="button" key={level} disabled={disabled} aria-pressed={policy.qualityLevel===level} className={`rounded-lg border p-3 text-left ${policy.qualityLevel===level?'border-primary bg-primary/5':'border-border'}`} onClick={()=>onChange({...policy,qualityLevel:level})}><strong className="block text-sm">{t(`ppt.quality.${level}`)}</strong><span className="block text-xs text-muted-foreground">{t(`ppt.quality.${level}Hint`)}</span></button>)}</div>
    <p className="text-xs text-muted-foreground">{t('ppt.quality.sameContract')}</p>{routes.some(route=>route.primary.configId.startsWith('byok:'))&&<p className="text-xs text-muted-foreground">{t('ppt.quality.localExecution')}</p>}{models.some(model=>!isPptModelEvaluated(model))&&<p className="text-xs text-muted-foreground">{t('ppt.quality.unverifiedModels')}</p>}
    <details><summary className="cursor-pointer text-xs text-primary">{t('ppt.quality.routes')}</summary><div className="mt-3 space-y-2">{pptTextRoles.map(role=>{
      const selected=bound.roleRoutes[role]?.primary;
      const value=models.find(model=>model.configId===selected?.configId&&model.modelId===selected?.model)?.id||'';
      return <label className="block text-xs" key={role}>{t(`ppt.quality.role.${role}`)}<PptSelectField className="mt-1 w-full rounded border border-border bg-background p-2" aria-label={t(`ppt.quality.role.${role}`)} disabled={disabled} value={value} onValueChange={id=>{const model=models.find(item=>item.id===id);if(model)onChange({...bound,roleRoutes:{...bound.roleRoutes,[role]:{primary:pptRoleRef(model),selection:'manual',fallbacks:[]}}});}}>{models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}</PptSelectField></label>;
    })}<label className="block text-xs">{t('ppt.quality.inputBudget')}<input className="mt-1 w-full rounded border border-border bg-background p-2" type="number" min={1} placeholder={t('ppt.quality.unlimited')} disabled={disabled} value={policy.budget.maxInputTokens||''} onChange={event=>{const n=Number(event.target.value);onChange({...policy,budget:{...policy.budget,maxInputTokens:n>0?n:undefined}});}}/></label><label className="block text-xs">{t('ppt.quality.tokenBudget')}<input className="mt-1 w-full rounded border border-border bg-background p-2" type="number" min={32768} step={32768} placeholder={t('ppt.quality.unlimited')} disabled={disabled} value={policy.budget.maxOutputTokens||''} onChange={event=>{const n=Number(event.target.value);onChange({...policy,budget:{...policy.budget,maxOutputTokens:n>0?n:undefined}});}}/></label></div></details>
  </div></details></section>;
}
