'use client';
import type {PptProject} from '../types';
import {createPortal} from 'react-dom';
import {useTranslation} from '@/hooks/useTranslation';
import {pptFailureMessage} from '@/lib/ppt-error';
import type {TranslationKey} from '@/i18n';

type Failure=NonNullable<PptProject['failure']>;
type Diagnostic=NonNullable<Failure['diagnostic']>;
const TIMING=['elapsedMs','firstTokenMs','receivedChars'] as const;
const CLASSES=['planning','remediation_no_progress','true_overflow','unverified_capacity','false_rejection','transport'];
const STOPS=['budget','oscillation','no_progress'];
const SHOWN_SOURCES=8;

/** Only a model-transport failure has call timing. Records saved before the
 * server dropped empty diagnostics carry `diagnostic: {}`, which is not timing. */
export function isTransportFailure(failure:Failure){
 const diagnostic:Diagnostic=failure.diagnostic||{};
 return failure.origin==='model_transport'||failure.trace?.class==='transport'||TIMING.some(key=>diagnostic[key]!==undefined)||Boolean(diagnostic.httpStatus);
}

/** What failed and why: timing for a model call, the F1 trace for a planning failure. */
export function PptFailureDetails({failure}:{failure:Failure}){
 const {t}=useTranslation();
 const trace=failure.trace,diagnostic:Diagnostic=failure.diagnostic||{};
 const step=trace?.step||failure.contractStage||failure.modelStage||failure.stage;
 if(isTransportFailure(failure))return <dl data-testid="ppt-failure-diagnostic" data-kind="transport" className="space-y-1 text-xs text-muted-foreground">
  <div>{t('ppt.failure.step')}: {step}</div>
  <div>{failure.origin||diagnostic.origin} {diagnostic.httpStatus?`HTTP ${diagnostic.httpStatus}`:''} {diagnostic.networkCode||diagnostic.kind||failure.code}</div>
  <div data-testid="ppt-failure-timing">{t('ppt.failure.timing')}: {diagnostic.elapsedMs??'—'} ms / {diagnostic.firstTokenMs??'—'} ms / {diagnostic.receivedChars??'—'}</div>
 </dl>;
 const ids=trace?.sourceUnitIds||[],governor=trace?.governor,advised=Object.values(governor?.advised||{}).reduce((sum,n)=>sum+n,0);
 return <dl data-testid="ppt-failure-diagnostic" data-kind="planning" className="space-y-1 text-xs text-muted-foreground">
  <div>{t('ppt.failure.step')}: {step}</div>
  {!trace?.step&&!failure.contractStage&&!failure.modelStage&&trace?.afterStep&&<div data-testid="ppt-failure-after-step">{t('ppt.failure.afterStep')}: {trace.afterStep}</div>}
  <div>{trace?.class&&CLASSES.includes(trace.class)?<>{t('ppt.failure.kind')}: {t(`ppt.failure.class.${trace.class}` as TranslationKey)} · </>:null}{t('ppt.failure.code')}: {trace?.code||failure.code}</div>
  {Number.isInteger(trace?.pageIndex)&&<div data-testid="ppt-failure-page">{t('ppt.failure.page',{page:(trace!.pageIndex as number)+1})}</div>}
  {ids.length>0&&<div data-testid="ppt-failure-sources">{t('ppt.failure.sources')}: {ids.slice(0,SHOWN_SOURCES).join(', ')}{ids.length>SHOWN_SOURCES?` ${t('ppt.failure.more',{n:ids.length-SHOWN_SOURCES})}`:''}</div>}
  {governor&&Number.isInteger(governor.used)&&<div data-testid="ppt-failure-governor">{t('ppt.failure.governor',{used:governor.used as number,budget:governor.budget??'—'})}{governor.stopped&&STOPS.includes(governor.stopped)?` · ${t(`ppt.failure.stopped.${governor.stopped}` as TranslationKey)}`:''}{advised?` · ${t('ppt.failure.advised',{n:advised})}`:''}</div>}
  {trace?.repairs?.length?<div data-testid="ppt-failure-repairs">{t('ppt.failure.repairs')}: {trace.repairs.slice(-4).map(r=>`#${r.pass??'?'} ${r.kind||''} → ${r.outcome||''}${r.code?` (${r.code})`:''}`).join('; ')}</div>:null}
 </dl>;
}

export function PptFailureDialog({message,failure,onClose,onReviewOutline}:{message:string;failure?:PptProject['failure'];onClose:()=>void;onReviewOutline?:()=>void}){
 const {t,locale}=useTranslation();
 return createPortal(<div onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4">
  <section role="alertdialog" aria-modal="true" aria-labelledby="ppt-failure-title" aria-describedby="ppt-failure-reason"
   className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-background p-6 shadow-xl">
   <h2 id="ppt-failure-title" className="text-lg font-semibold">{t('ppt.failure.title')}</h2>
   <p id="ppt-failure-reason" className="whitespace-pre-wrap break-words text-sm">{pptFailureMessage(message,locale)}</p>
   {/^ppt_(?:semantic_|content_selection_invalid|outline_|source_)/.test(message)&&<p data-testid="ppt-failure-contract-reason" className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{message}</p>}
   {failure&&<PptFailureDetails failure={failure}/>}
   <div className="flex justify-end gap-2">{onReviewOutline&&<button className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent" onClick={onReviewOutline}>{t('ppt.failure.reviewOutline')}</button>}<button autoFocus className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
    onClick={onClose}>{t('ppt.failure.dismiss')}</button></div>
  </section>
 </div>,document.body);
}
