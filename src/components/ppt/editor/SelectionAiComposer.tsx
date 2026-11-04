"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from '@/hooks/useTranslation';
import {AiCandidateControls} from './AiCandidateControls';
import {AiBeforeAfterPreview} from './AiBeforeAfterPreview';
import type {PptAiProposal} from '../types';

/** Editor overlay only: never serialized into the slide or captured by export. */
export function SelectionAiComposer({targetLabel,quote,anchor,instruction,onInstruction,onSend,onClose,onApply,onDiscard,onAdvanced,busy,disabled,error,proposal,onUndo,onPreset,onNativeLayout,onRevise,onSelectCandidate,advisories,onApplyAdvisory,onDismissAdvisory}:{
 targetLabel:string;quote?:string;anchor:()=>DOMRect|null;instruction:string;onInstruction:(text:string)=>void;onSend:()=>void;onClose:()=>void;onApply:()=>void;onDiscard:()=>void;onAdvanced:()=>void;busy:boolean;disabled:boolean;error:string;proposal:PptAiProposal|null;onUndo?:()=>void;onPreset:(value:'shorten'|'improve'|'translate')=>void;onNativeLayout?:()=>void;onRevise:(data:Record<string,unknown>)=>Promise<void>;onSelectCandidate:(id:string)=>Promise<void>;
 /** Open deck-review findings on the selected object, shown next to it. */
 advisories?:{id:string;label:string;detail:string;suggestedFix?:string}[];onApplyAdvisory?:(id:string)=>void;onDismissAdvisory?:(id:string)=>void;
}){
 const {t}=useTranslation(),panel=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:16,top:96}),returnFocus=useRef<HTMLElement|null>(null);
 // Return focus only when closing dropped it (it was inside the panel). A click
 // elsewhere already moved focus; pulling it back to the old object would
 // re-select that object's page and undo the user's page change.
 useEffect(()=>{returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;return()=>{const active=document.activeElement;if(!active||active===document.body)returnFocus.current?.focus({preventScroll:true});};},[]);
 useEffect(()=>{
  let frame=0;const place=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const r=anchor(),w=Math.min(360,window.innerWidth-24),h=Math.min(panel.current?.offsetHeight||200,window.innerHeight-96);
   const right=r&&r.right+w+16<window.innerWidth;
   const left=right?r!.right+10:r&&r.left-w-10>=12?r.left-w-10:Math.max(12,(r?.left||12));
   const top=r&&r.bottom+10+h<window.innerHeight&&!right?r.bottom+10:r?.top||96;
   setPosition({left:Math.max(12,Math.min(left,window.innerWidth-w-12)),top:Math.max(72,Math.min(top,window.innerHeight-h-12))});
  });};
  place();window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
  const observer=new ResizeObserver(place);if(panel.current)observer.observe(panel.current);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);observer.disconnect();};
 },[anchor,proposal]);
 if(typeof document==='undefined')return null;
 return createPortal(<div ref={panel} role="dialog" aria-label={t('ppt.inline.title')} data-testid="ppt-inline-ai" className="fixed z-[350] max-h-[75vh] w-[360px] max-w-[calc(100vw-24px)] space-y-3 overflow-auto rounded-xl border border-primary/40 bg-background p-3 text-foreground shadow-xl" style={position}
  onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();onClose();}}}>
  <div className="flex items-start justify-between gap-2"><b className="text-xs" data-testid="ppt-inline-target">{targetLabel}</b><button type="button" aria-label={t('ppt.cancel')} onClick={onClose}>×</button></div>
  {!proposal&&advisories?.length?<div data-testid="ppt-inline-advisories" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">{advisories.map(advisory=><div key={advisory.id} data-advisory-id={advisory.id}>
   <b className="block text-amber-700 dark:text-amber-300">{advisory.label}</b><p className="whitespace-pre-wrap break-words">{advisory.detail}</p>
   {advisory.suggestedFix&&<p className="mt-1 text-muted-foreground"><span className="block font-medium">{t('ppt.advisory.suggestion')}</span><span className="whitespace-pre-wrap break-words">{advisory.suggestedFix}</span></p>}
   <div className="mt-1 flex gap-2">{advisory.suggestedFix&&onApplyAdvisory&&<button className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50" disabled={busy||disabled} onClick={()=>onApplyAdvisory(advisory.id)}>{t('ppt.advisory.apply')}</button>}{onDismissAdvisory&&<button className="rounded border border-border bg-background px-2 py-1 disabled:opacity-50" disabled={busy} onClick={()=>onDismissAdvisory(advisory.id)}>{t('ppt.advisory.dismiss')}</button>}</div>
  </div>)}</div>:null}
  {quote&&<details className="text-xs"><summary className="cursor-pointer truncate">{quote.slice(0,80)}</summary><p className="max-h-32 overflow-auto whitespace-pre-wrap">{quote}</p></details>}
  {!proposal&&<><textarea aria-label={t('ppt.editor.instruction')} className="min-h-20 w-full resize-y rounded-lg border border-border bg-background p-2 text-sm" value={instruction} maxLength={1000} disabled={busy} placeholder={t('ppt.inline.placeholder')} onChange={event=>onInstruction(event.target.value)}
   onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();if(!busy&&!disabled&&instruction.trim())onSend();}}}/>
   <div className="flex flex-wrap gap-2">{(['shorten','improve','translate'] as const).map(preset=><button key={preset} className="rounded border border-border px-2 py-1 text-xs" disabled={busy||disabled} onClick={()=>onPreset(preset)}>{t(`ppt.ai.${preset}`)}</button>)}</div>
   <div className="flex items-center justify-between"><button className="text-xs text-muted-foreground" disabled={busy} onClick={onAdvanced}>{t('ppt.inline.advanced')}</button><button className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" disabled={busy||disabled||!instruction.trim()} onClick={onSend}>{t(busy?'ppt.inline.working':'ppt.inline.send')}</button></div>
  </>}
  {onNativeLayout&&!proposal&&<button className="text-xs underline" disabled={busy||disabled} onClick={onNativeLayout}>{t('ppt.inline.nativeLayout')}</button>}
  {busy&&<p role="status" className="text-xs text-muted-foreground">{t('ppt.inline.pending')}</p>}
  {disabled&&!busy&&<p role="status" className="text-xs text-muted-foreground">{t('ppt.inline.unavailable')}</p>}
  {error&&<p role="alert" className="whitespace-pre-wrap text-xs text-destructive">{error}</p>}
  {proposal&&<><AiBeforeAfterPreview proposal={proposal}/><AiCandidateControls proposal={proposal} busy={busy} onRevise={onRevise} onSelect={onSelectCandidate}/><div className="flex gap-2"><button className="rounded border border-border px-3 py-2 text-xs" disabled={busy} onClick={onDiscard}>{t('ppt.cancel')}</button><button className="rounded border border-border px-3 py-2 text-xs" disabled={busy} onClick={onDiscard}>{t('ppt.edit.adjust')}</button><button className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground" disabled={busy} onClick={onApply}>{t('ppt.inline.apply')}</button></div></>}
  {onUndo&&!proposal&&<button className="text-xs underline" disabled={busy} onClick={onUndo}>{t('ppt.edit.undoEdit')}</button>}
 </div>,document.body);
}
