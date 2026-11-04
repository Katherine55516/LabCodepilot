'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {usePptDesktopModelWorker} from '@/hooks/usePptDesktopModelWorker';
import {useTranslation} from '@/hooks/useTranslation';
import {pptTaskStore} from '@/lib/ppt-task-store';
import {pptProgressTotal} from '@/lib/ppt-page-label';
import type {TranslationKey} from '@/i18n';
const DECK_STAGES=new Set(['outlining','writing','reviewing','repairing','publishing']);

/** Mounted once in AppShell, independently of the active route. Every endpoint
 * authenticates the account. Closing the application requires reopening it to
 * claim BYOK jobs; this component makes no cloud-execution promise. */
export function PptBackgroundTasks(){
 const pathname=usePathname();const {t}=useTranslation();const tasks=useSyncExternalStore(pptTaskStore.subscribe,pptTaskStore.getSnapshot,pptTaskStore.getServerSnapshot),[error,setError]=useState(''),[connection,setConnection]=useState<'connected'|'reconnecting'>('connected'),[lastUpdated,setLastUpdated]=useState('');
 const setTasks=pptTaskStore.set;const [retrying,setRetrying]=useState<string|null>(null);
 async function retry(id:string){
  setRetrying(id);setError('');
  try{const response=await fetch(`/api/ppt/projects/${id}/retry`,{method:'POST'});if(!response.ok)throw new Error(t('ppt.retry'));window.dispatchEvent(new Event('focus'));}
  catch(e){setError(e instanceof Error?e.message:t('ppt.retry'));}
  finally{setRetrying(null);}
 }
 usePptDesktopModelWorker(true,setError);
 useEffect(()=>{
  let stopped=false,epoch=0,inflight=false,timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   if(inflight)return;inflight=true;
   const requestEpoch=epoch,request=pptTaskStore.beginRequest();
   try{const r=await fetch('/api/ppt/projects?view=workspace',{cache:'no-store'});
    if(r.ok){const data=await r.json();if(!stopped&&epoch===requestEpoch&&Array.isArray(data.projects)){setTasks(data.projects,request);setConnection('connected');setLastUpdated(new Date().toISOString());}}
    else if(!stopped&&epoch===requestEpoch){if([401,403].includes(r.status))pptTaskStore.clear();setConnection('reconnecting');}
   }catch{if(!stopped&&epoch===requestEpoch)setConnection('reconnecting');} // Preserve the last server checkpoint during transient disconnects.
   inflight=false;clearTimeout(timer);if(!stopped)timer=setTimeout(refresh,document.hidden?15000:3000);
  }
  const reset=()=>{epoch++;pptTaskStore.clear();setError('');setLastUpdated('');clearTimeout(timer);void refresh();};
  const focus=()=>{clearTimeout(timer);void refresh();};
  window.addEventListener('provider-changed',reset);window.addEventListener('focus',focus);
  const off=window.electronAPI?.auth?.onChange(reset);void refresh();
  return()=>{stopped=true;clearTimeout(timer);off?.();window.removeEventListener('provider-changed',reset);window.removeEventListener('focus',focus);};
 },[]);
 const active=tasks.filter(p=>p.taskEligible!==false&&!p.taskDeletedAt&&!p.deletedAt&&!p.taskRecordOnly&&!['completed','cancelled'].includes(p.status));
 // Keep the route-independent worker mounted; the PPT workspace already owns
 // its task center/monitor and should not duplicate a global task strip.
 if(pathname?.startsWith('/ppt')||!active.length)return null;
 return <div data-testid="ppt-background-tasks" className="max-h-40 shrink-0 overflow-auto border-b border-border px-3 py-2 text-xs">
  {active.map(p=><div key={p.id} className="flex items-center gap-2"><Link className="flex flex-1 flex-wrap items-center gap-2 rounded p-1 hover:bg-accent" href={`/ppt?projectId=${p.id}`}>
   <strong className="max-w-64 truncate">{p.title}</strong><span>{t(`ppt.task.${p.displayStatus||p.status}`)}</span><span>{p.progress?.contentReady||0}/{pptProgressTotal(p)} · {t('ppt.task.preview')} {p.progress?.previewReady||0}</span><span data-testid="ppt-task-stage">{p.deckStage&&DECK_STAGES.has(p.deckStage)?t(`ppt.deckStage.${p.deckStage}` as TranslationKey):''}{p.currentPage?` · ${t('ppt.task.currentPage').replace('{n}',String(p.currentPage.index))} ${p.currentPage.title} · ${t(`ppt.stage.${p.currentPage.stage||'waiting'}` as TranslationKey)}`:''}</span><span>{p.model}</span><time dateTime={p.updatedAt}>{p.updatedAt&&new Date(p.updatedAt).toLocaleTimeString()}</time><span className="ml-auto">{t('ppt.task.open')}</span>
  </Link>{['failed','quality_blocked'].includes(p.status)&&<button className="shrink-0 rounded border border-border px-2 py-1 disabled:opacity-50" aria-label={`${t('ppt.retry')} · ${p.title}`} disabled={retrying!==null} onClick={()=>void retry(p.id)}>{t('ppt.retry')}</button>}</div>)}{connection==='reconnecting'&&<p role="status">{t('ppt.task.reconnecting')} · {lastUpdated&&new Date(lastUpdated).toLocaleTimeString()}</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
 </div>;
}
