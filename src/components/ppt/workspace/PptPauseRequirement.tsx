'use client';
import {useState} from 'react';
import {useTranslation} from '@/hooks/useTranslation';
import type {PptProject} from '../types';

const button='rounded border border-border px-3 py-2 text-sm disabled:opacity-50';
/** While generation is paused: add a requirement for the pages still to be
 * written, optionally for the pages already written too, then resume. */
export function PptPauseRequirement({project,onResume,onProject}:{project:PptProject;onResume:()=>Promise<unknown>|unknown;onProject?:(project:PptProject)=>void}){
 const {t}=useTranslation();
 const [text,setText]=useState(''),[all,setAll]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function resume(){
  setBusy(true);setError('');
  try{
   if(text.trim()){
    const response=await fetch(`/api/ppt/projects/${project.id}/requirements?view=live`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.trim(),scope:all?'all':'remaining'})});
    const data=await response.json();if(!response.ok)throw Error(data.message||data.error||`HTTP ${response.status}`);
    onProject?.(data.project);setText('');setAll(false);
   }
   await onResume();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section data-testid="ppt-pause-requirement" className="space-y-2 rounded-xl border border-border bg-card p-4">
  <p className="text-sm font-medium">{t('ppt.pause.title')}</p>
  {Boolean(project.requirements?.length)&&<ul data-testid="ppt-requirements" className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{project.requirements!.map(item=><li key={item.id}>{item.text}</li>)}</ul>}
  <textarea aria-label={t('ppt.pause.placeholder')} className="w-full rounded border border-border bg-background p-2 text-sm" rows={3} maxLength={2000} placeholder={t('ppt.pause.placeholder')} value={text} onChange={event=>setText(event.target.value)}/>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} disabled={!text.trim()} onChange={event=>setAll(event.target.checked)}/>{t('ppt.pause.allPages')}</label>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  <button data-testid="ppt-pause-resume" className={button} disabled={busy} onClick={()=>void resume()}>{t('ppt.pause.resume')}</button>
 </section>;
}
