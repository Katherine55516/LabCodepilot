'use client';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { pptFailureMessage } from '@/lib/ppt-error';
import { failureOrigin } from '@/lib/ppt-failure-origin';
import type { PptProject } from './types';
import { PptCapacityDetails } from './PptCapacityDetails';
/** Diagnostics are reviewable/downloadable; a failed candidate never becomes an
 * accepted syllabus and this panel does not provide a Generate shortcut. The
 * explanation follows the persisted failure origin (server classification),
 * falling back to the shared client classifier for older records. */
export function PptOutlineDiagnostic({project}:{project:Pick<PptProject,'candidateOutline'|'failure'|'modelUsage'|'pageBudgetConflict'|'error'>}){
 const {t,locale}=useTranslation(),candidate=project.candidateOutline,failure=project.failure;
 const origin=failure?failure.origin||failureOrigin({stage:failure.stage,code:failure.code,message:project.error}):null;
 const modelOrigin=origin==='model_transport'||origin==='model_contract';
 const step=failure?.contractStage||failure?.modelStage;
 // modelUsage is recorded per project stage: unless the model itself failed it
 // is the last successful call, not the cause, so it stays collapsed.
 const usage=failure?project.modelUsage?.findLast(item=>item.stage===failure.stage):undefined;
 const usageText=usage&&JSON.stringify(usage.telemetry||{characters:usage.characters,utf8Bytes:usage.utf8Bytes});
 // Code-level copy is accurate only for transport and local findings; model
 // step validators reuse coverage/schema codes for a malformed response.
 const codeKey=failure&&`ppt_${failure.code}`,explained=codeKey&&origin&&!['model_contract','budget','quality','unknown'].includes(origin)?pptFailureMessage(codeKey,locale):null;
 if(!candidate&&!failure&&!project.pageBudgetConflict)return null;
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({failure:project.failure,error:project.error,candidateOutline:candidate,pageBudgetConflict:project.pageBudgetConflict},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='ppt-outline-diagnostic.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section data-testid="ppt-outline-diagnostic" data-failure-origin={origin||undefined} className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
  <h4 className="font-semibold">{t(candidate?.accepted?'ppt.candidate.acceptedTitle':'ppt.candidate.title')}</h4>
  {project.pageBudgetConflict&&<p className="break-words text-sm">{project.pageBudgetConflict.message}</p>}
  {failure&&<p className="break-words text-sm">{t('ppt.candidate.stage')}: {t(`ppt.failureStage.${failure.stage==='generation'?'generation':failure.stage==='ingest'?'ingest':'outline'}` as TranslationKey)} · {failure.code}{step?` · ${step}`:''} · {failure.model}</p>}
  {origin&&<p data-testid="ppt-failure-origin" className="break-words text-sm">{t(`ppt.failureOrigin.${origin}` as TranslationKey).replace('{step}',step||t('ppt.failureOrigin.unknownStep'))}</p>}
  {explained&&explained!==codeKey&&<p className="break-words text-sm">{explained}</p>}
  {project.error&&<details className="text-xs"><summary className="cursor-pointer">{t('ppt.candidate.detail')}</summary><p className="mt-1 break-words">{project.error}</p></details>}
  {usageText&&(modelOrigin?<p className="break-words text-xs">{usageText}</p>:<details className="text-xs"><summary className="cursor-pointer">{t('ppt.candidate.lastModelCall')}</summary><p className="mt-1 break-words">{usageText}</p></details>)}
  {candidate&&<><p className="text-sm">{t(candidate.accepted?'ppt.candidate.acceptedPages':'ppt.candidate.pages')}: {candidate.candidatePages} · #{candidate.attempt}</p><ol className="max-h-72 space-y-2 overflow-y-auto text-sm">{candidate.syllabus.map((slide,index)=><li key={slide.id||index}><b>{index+1}. {slide.title}</b><p className="text-muted-foreground">{slide.message}</p></li>)}</ol><ul className="max-h-48 space-y-2 overflow-y-auto break-words text-xs">{candidate.issues.map((issue,index)=><li key={index}>{issue.code}: {issue.message}<PptCapacityDetails details={issue.details}/></li>)}</ul></>}
  <button className="rounded-lg border border-border px-3 py-2 text-sm" onClick={download}>{t('ppt.candidate.download')}</button>
 </section>;
}
