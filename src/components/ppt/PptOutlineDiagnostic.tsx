'use client';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject } from './types';
/** Diagnostics are reviewable/downloadable; a failed candidate never becomes an
 * accepted syllabus and this panel does not provide a Generate shortcut. */
export function PptOutlineDiagnostic({project}:{project:Pick<PptProject,'candidateOutline'|'failure'|'modelUsage'|'pageBudgetConflict'>}){
 const {t}=useTranslation(),candidate=project.candidateOutline;
 const usage=project.failure?project.modelUsage?.findLast(item=>item.stage===project.failure?.stage):undefined;
 if(!candidate&&!project.failure&&!project.pageBudgetConflict)return null;
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({failure:project.failure,candidateOutline:candidate,pageBudgetConflict:project.pageBudgetConflict},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='ppt-outline-diagnostic.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section data-testid="ppt-outline-diagnostic" className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
  <h4 className="font-semibold">{t(candidate?.accepted?'ppt.candidate.acceptedTitle':'ppt.candidate.title')}</h4>
  {project.pageBudgetConflict&&<p className="break-words text-sm">{project.pageBudgetConflict.message}</p>}
  {project.failure&&<p className="break-words text-sm">{t('ppt.candidate.stage')}: {project.failure.stage} · {project.failure.code} · {project.failure.model}</p>}
  {usage&&<p className="break-words text-xs">{JSON.stringify(usage.telemetry||{characters:usage.characters,utf8Bytes:usage.utf8Bytes})}</p>}
  {candidate&&<><p className="text-sm">{t(candidate.accepted?'ppt.candidate.acceptedPages':'ppt.candidate.pages')}: {candidate.candidatePages} · #{candidate.attempt}</p><ol className="max-h-72 space-y-2 overflow-y-auto text-sm">{candidate.syllabus.map((slide,index)=><li key={slide.id||index}><b>{index+1}. {slide.title}</b><p className="text-muted-foreground">{slide.message}</p></li>)}</ol><ul className="max-h-48 space-y-2 overflow-y-auto break-words text-xs">{candidate.issues.map((issue,index)=><li key={index}>{issue.code}: {issue.message}</li>)}</ul></>}
  <button className="rounded-lg border border-border px-3 py-2 text-sm" onClick={download}>{t('ppt.candidate.download')}</button>
 </section>;
}
