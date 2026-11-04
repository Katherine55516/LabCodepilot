/** One automatic repair before an export verification failure blocks the deck
 * (Fable, 2026-11-02, G3): the page the failure names is laid out again as a
 * code-placed theme page, the deck is rendered and verified once more, and the
 * page is flagged for review. A failure that names no content page, or that
 * fails again, blocks as before. Used by generation and by publishing. */
import {bindThemeCardPage} from './ppt-card-pages.mjs';
import {acceptExportVerification} from './ppt-export-integrity.mjs';

/** The 0-based page an export failure names ("… on slide 3 shape 11"), or -1. */
export function exportFailurePage(error){
 const match=String(error?.message||error).match(/\bslide\s+(\d+)\b/iu);
 return match?Number(match[1])-1:-1;
}
/** Re-binds page `index` as a theme page; true when it could. */
export function themePageFallback(project,index,reason){
 const slide=project.deck?.slides?.[index],page=project.outline?.[index];
 if(index<1||!slide||!page||page.cardFrame||page.figurePage||slide.exportFallback)return false;
 bindThemeCardPage(project,slide,index,page,{native:false});
 slide.cardPage={mode:'theme',templatePage:(project.templateFidelity?.slideMap?.[index]??-1)+1};
 slide.exportFallback={reason:String(reason).slice(0,300),at:new Date().toISOString()};
 const issues=project.quality?.deterministic?.issues;
 const flag={code:'export_page_fallback',severity:'warning',pageIndex:index,slideId:slide.id,message:`Page ${index+1} is laid out by code: its template version failed export verification (${String(reason).slice(0,160)}). Review it.`};
 project.quality={...(project.quality||{}),deterministic:{...(project.quality?.deterministic||{}),issues:[...(issues||[]).filter(issue=>!(issue.code==='export_page_fallback'&&issue.pageIndex===index)),flag]}};
 return true;
}
/** Renders `project` (render builds its own output copy) and verifies the
 * export against it; on a failure naming a content page, that page falls back
 * once. Returns {info, fallbackIndex}; throws the (second) failure otherwise. */
export async function renderWithPageFallback(project,render){
 try{const info=await render(project);acceptExportVerification(project,info);return{info,fallbackIndex:-1};}
 catch(error){
  const index=exportFailurePage(error);
  if(!themePageFallback(project,index,error?.message||error))throw error;
  const info=await render(project);acceptExportVerification(project,info);return{info,fallbackIndex:index};
 }
}
