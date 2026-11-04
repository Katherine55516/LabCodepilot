"use client";
/* eslint-disable @next/next/no-img-element -- shared server renderer SVG */
import {useState} from 'react';
import {useTranslation} from '@/hooks/useTranslation';
import type {PptAiProposal} from '../types';
type Copy={text?:string;heading?:string;body?:string;items?:Copy[];rows?:string[][];[key:string]:unknown};
function CopyFields({value,change}:{value:Copy;change:(value:Copy)=>void}) {
  return <div className="space-y-2">{(['heading','body','text'] as const).filter(key=>typeof value[key]==='string'&&!(key==='text'&&(value.heading||value.body))).map(key=><textarea key={key} aria-label={key} className="min-h-20 w-full rounded border bg-background p-2 text-xs" value={value[key]} onChange={e=>change({...value,[key]:e.target.value,...(['heading','body'].includes(key)?{text:[key==='heading'?e.target.value:value.heading,key==='body'?e.target.value:value.body].filter(Boolean).join('\n')}:{})})}/>)}
    {value.items?.map((item,index)=><CopyFields key={String(item.id||index)} value={item} change={next=>change({...value,items:value.items!.map((old,i)=>i===index?next:old)})}/>)}
    {value.rows?.map((row,r)=><div key={r} className="flex gap-1">{row.map((cell,c)=><textarea key={c} aria-label={`${r+1}, ${c+1}`} className="min-w-0 flex-1 rounded border bg-background p-1 text-xs" value={cell} onChange={e=>change({...value,rows:value.rows!.map((old,i)=>i===r?old.map((text,j)=>j===c?e.target.value:text):old)})}/>)}</div>)}
  </div>;
}
export function AiCandidateControls({proposal,busy,onRevise,onSelect}:{proposal:PptAiProposal;busy:boolean;onRevise:(data:Record<string,unknown>)=>Promise<void>;onSelect:(id:string)=>Promise<void>}) {
  const {t}=useTranslation();const [draft,setDraft]=useState<Record<string,unknown>>({}),[editing,setEditing]=useState(false),[error,setError]=useState('');
  const begin=()=>{setDraft(structuredClone(proposal.target?{replacement:proposal.replacement||''}:proposal.content?{content:proposal.content}:{patches:proposal.patches}));setEditing(true);};
  return <div className="space-y-2">
    {proposal.alternatives?.map(option=><button key={option.id} className="w-full rounded border p-2 text-left text-xs" disabled={busy} onClick={()=>void onSelect(option.id).catch(e=>setError(e.message))}><span>{option.layoutId}</span><img alt={option.layoutId} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(option.afterSvg)}`}/></button>)}
    {(proposal.content||proposal.patches)&&<button className="rounded border px-3 py-2 text-xs" disabled={busy} onClick={begin}>{t('ppt.target.editCandidate')}</button>}
    {editing&&<fieldset disabled={busy} className="space-y-2">
      {proposal.target?<textarea aria-label={t('ppt.target.editCandidate')} className="min-h-28 w-full rounded border bg-background p-2 text-xs" value={String(draft.replacement||'')} onChange={e=>setDraft({replacement:e.target.value})}/>:draft.content?<CopyFields value={draft.content as Copy} change={content=>setDraft({content})}/>:(draft.patches as {nodeId:string;content:Copy}[]||[]).map((patch,index)=><CopyFields key={patch.nodeId} value={patch.content} change={content=>setDraft({patches:(draft.patches as typeof patch[]).map((old,i)=>i===index?{...old,content}:old)})}/>)}
      <button className="rounded border px-3 py-2 text-xs" onClick={async()=>{try{setError('');await onRevise(draft);setEditing(false);}catch(reason){setError(String((reason as Error).message));}}}>{t('ppt.target.revalidate')}</button>
    </fieldset>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    {proposal.quality.issues.length>0&&<p className="text-xs text-muted-foreground">{proposal.quality.issues.map(i=>i.message).join(' · ')}</p>}
  </div>;
}
