'use client';
import {PptSelectField} from '../PptSelect';
import {useEffect} from 'react';
import {useTranslation} from '@/hooks/useTranslation';
import {pptTextRoles} from '@/lib/ppt-model-catalog';
import {PptQualitySettings,bindExecutionPolicy} from '../create/PptQualitySettings';

import type { PptModel, PptTemplate, PptExecutionPolicy } from '../types';

const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';

export type PptLlmGateContext = 'new' | 'template' | 'update';

export function PptLlmGate({models,modelKey,onModelKeyChange,onClose,onConfirm,policy,onPolicyChange,modelsLoading=false,modelsError,onRetryModels}: {
 modelsLoading?:boolean;modelsError?:string;onRetryModels?:()=>void;
 models:PptModel[];modelKey:string;onModelKeyChange:(key:string)=>void;onClose:()=>void;onConfirm:()=>void;
 context:PptLlmGateContext;template?:PptTemplate|null;policy:PptExecutionPolicy;onPolicyChange:(policy:PptExecutionPolicy)=>void;
}) {
 const {t}=useTranslation();
 useEffect(()=>{if(!models.some(model=>model.id===modelKey)&&models.length)onModelKeyChange(models[0].id);},[models,modelKey,onModelKeyChange]);
 const bound=bindExecutionPolicy(policy,models,modelKey);
 const valid=!modelsLoading&&!modelsError&&models.length>0&&pptTextRoles.every(role=>Boolean(bound.roleRoutes[role]?.primary))&&Object.values(bound.roleRoutes).every(route=>[route.primary,route.complexPrimary,...route.fallbacks].every(ref=>!ref||models.some(model=>model.configId===ref.configId&&model.modelId===ref.model&&model.capabilities?.ppt?.health!=='unavailable')));
 return <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4"><section role="dialog" aria-modal="true" aria-labelledby="ppt-quality-title" className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"><header className="flex shrink-0 items-center justify-between border-b border-border p-4"><h2 id="ppt-quality-title" className="font-semibold">{t('ppt.chooseModel')}</h2><button aria-label={t('ppt.close')} onClick={onClose}>×</button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">{modelsLoading&&<p role="status" className="mb-3 text-sm text-muted-foreground">{t('ppt.quality.modelsLoading')}</p>}{modelsError&&<div role="alert" className="mb-3 rounded border border-border p-3 text-sm"><p title={modelsError}>{t('ppt.quality.modelsLoadError')}</p><button type="button" className={button+' mt-2'} disabled={modelsLoading} onClick={onRetryModels}>{t('ppt.quality.reloadModels')}</button></div>}<label className="mb-4 block text-sm">LLM<PptSelectField className="mt-2 w-full rounded border border-border bg-background p-2" aria-label="LLM（必填）" value={modelKey} disabled={modelsLoading} onValueChange={onModelKeyChange}>{models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}</PptSelectField></label><PptQualitySettings catalogPending={modelsLoading||Boolean(modelsError)} disabled={modelsLoading||Boolean(modelsError)} models={models} defaultKey={modelKey} policy={policy} onChange={onPolicyChange}/></div><footer className="flex shrink-0 justify-end gap-2 border-t border-border p-4"><button className={button} onClick={onClose}>{t('ppt.cancel')}</button><button className={primary} disabled={!valid||!modelKey} onClick={onConfirm}>{t('ppt.quality.continue')}</button></footer></section></div>;
}
