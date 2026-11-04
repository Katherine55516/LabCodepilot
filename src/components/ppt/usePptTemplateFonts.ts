'use client';
import {useEffect,useState} from 'react';
/** Only the account-owned project endpoint supplies font bytes and names. */
export function usePptTemplateFonts(projectId:string,template:string){
 const [state,setState]=useState('pending');
 useEffect(()=>{
  if(!/^[a-f0-9]{32}$/i.test(template)){setState('not_embedded');return;}
  let stopped=false;const faces:FontFace[]=[];
  void (async()=>{try{
   const response=await fetch(`/api/ppt/projects/${projectId}/native-fonts`,{cache:'no-store'});if(!response.ok)throw Error('font_manifest_unavailable');
   const result=await response.json();if(!Array.isArray(result.fonts)||result.fonts.length>128)throw Error('invalid_font_manifest');
   for(const font of result.fonts){
    if(!/^[\p{L}\p{N} _.,()+-]{1,128}$/u.test(font.family)||!Number.isInteger(font.weight)||font.weight<100||font.weight>900||!new RegExp(`^/api/ppt/projects/${projectId}/native-fonts/[a-f0-9]{64}\\.ttf$`).test(font.url))throw Error('invalid_font_identity');
    const face=new FontFace(font.family,`url("${font.url}")`,{weight:String(font.weight)});faces.push(face);await face.load();if(stopped)return;document.fonts.add(face);
   }
   if(!stopped){setState(faces.length?'loaded':'not_embedded');document.documentElement.dataset.pptNativeFonts=faces.length?'loaded':'not_embedded';}
  }catch{if(!stopped){setState('fallback');document.documentElement.dataset.pptNativeFonts='fallback';}}})();
  return()=>{stopped=true;for(const face of faces)document.fonts.delete(face);};
 },[projectId,template]);return state;
}
