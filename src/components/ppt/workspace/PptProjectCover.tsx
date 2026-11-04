'use client';
import {useEffect,useRef,useState} from 'react';
import {PptCanvas} from '../canvas/PptCanvas';
import {usePptTemplateFonts} from '../usePptTemplateFonts';
import {useTranslation} from '@/hooks/useTranslation';
import type {PptProject,PptRenderSlide} from '../types';
const noop=()=>{};
function PublishedCover({project}:{project:PptProject}){
 const {locale}=useTranslation(),[scene,setScene]=useState<PptRenderSlide|null>(null),[failed,setFailed]=useState(false);
 usePptTemplateFonts(project.id,project.template);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(`/api/ppt/projects/${project.id}/cover?v=${project.publishedRevision||project.revision}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('cover unavailable');const result=await response.json();if(!controller.signal.aborted)setScene(result.slide);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>controller.abort();
 },[project.id,project.publishedRevision,project.revision]);
 return scene?<div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true"><div data-testid="ppt-cover-canvas" className="flex h-full max-w-full items-center" style={{aspectRatio:`${scene.size.width} / ${scene.size.height}`}}><PptCanvas slide={scene} readOnly allowStructure={false} selectedIds={[]} onSelect={noop} onSelectMany={noop} onGeometry={noop} onRotation={noop} onContent={noop} onAction={noop}/></div></div>:<div className="absolute inset-0 grid place-content-center p-4"><strong className="line-clamp-2 text-lg">{project.title}</strong>{failed&&<span className="mt-2 text-xs opacity-70">{locale==='en'?'Preview unavailable':'封面预览暂不可用'}</span>}</div>;
}
/** Published scene + the editor renderer, never a fabricated gradient sample. */
export function PptProjectCover({project}:{project:PptProject}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!ref.current)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});observer.observe(ref.current);return()=>observer.disconnect();
 },[]);
 return <div ref={ref} className="absolute inset-0" data-testid="ppt-published-cover">{visible&&project.coverAvailable&&!project.deletedAt?<PublishedCover key={`${project.id}:${project.publishedRevision}:${project.revision}`} project={project}/>:<strong className="line-clamp-2 p-4 text-lg">{project.title}</strong>}</div>;
}
