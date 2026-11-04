import {pictureCertificate} from './ppt-template-picture-read.mjs';
/** Page role and layout capability are separate dimensions. Evidence is kept
 * with the profile; an unrecognised page is never assumed to be a closing. */
export const TEMPLATE_ROLE_VERSION=2;
export function classifyTemplatePage(slide,size={}){
 const nodes=slide.nodes||[],width=size.width||12192000,height=size.height||6858000;
 const text=nodes.filter(n=>n.type==='text'&&String(n.content?.text||'').length<=100&&(!n.geometry||n.geometry.y<height*.35||Number(n.style?.fontSizePt)>=28)).map(n=>n.content?.text||'').join('\n');
 const matches=[['navigation',/\b(?:agenda|contents|table of contents)\b|目录|目錄/iu],['closing',/\b(?:thank you|thanks for watching|questions\??|contact us)\b|感谢|感謝|谢谢|謝謝|联系方式/iu],['special',/\b(?:colour|color|brand)\s*(?:palette|guide)|typography|font sample|色板|配色|字体示例|字體示例/iu]];
 for(const [role,pattern]of matches)if(pattern.test(text))return {version:TEMPLATE_ROLE_VERSION,role,confidence:.94,evidence:[{kind:'source-text-pattern',match:text.match(pattern)[0]}],allowedUseRoles:[role]};
 const body=nodes.filter(n=>n.type==='text'&&n.geometry&&n.geometry.y>height*.3&&String(n.content?.text||'').length>35);
 const bigTitles=nodes.filter(n=>n.type==='text'&&Number(n.style?.fontSizePt)>=30&&n.geometry);
 // A cover can have a short descriptive subtitle. Require a single dominant
 // title and a compact text cluster; a large metric on a content page does
 // not make that page a cover.
 const texts=nodes.filter(n=>n.type==='text'&&String(n.content?.text||'').trim());
 const title=bigTitles[0],subtitle=body[0];
 if(bigTitles.length===1&&(String(title.content?.text||'').match(/\p{L}/gu)||[]).length>=4&&texts.length<=3&&body.length===1&&subtitle!==title
  &&title.geometry.y>height*.22&&title.geometry.y<height*.65
  &&subtitle.geometry.y>=title.geometry.y+title.geometry.height*.8
  &&subtitle.geometry.height<=height*.13&&String(subtitle.content?.text||'').length<=240
  &&Number(title.style?.fontSizePt)>=Number(subtitle.style?.fontSizePt)*2
  &&!nodes.some(n=>['table','chart'].includes(n.type))){
  return {version:TEMPLATE_ROLE_VERSION,role:'cover',confidence:.8,evidence:[{kind:'title-subtitle-geometry',textCount:texts.length,titleFontSizePt:title.style.fontSizePt,subtitleFontSizePt:subtitle.style?.fontSizePt}],allowedUseRoles:['cover','section']};
 }
 if(bigTitles.length&&body.length===0&&nodes.filter(n=>['table','chart'].includes(n.type)).length===0){
  const title=bigTitles[0],centered=title.geometry.y>height*.22&&title.geometry.y<height*.72;
  return {version:TEMPLATE_ROLE_VERSION,role:centered?'cover':'section',confidence:.72,evidence:[{kind:'geometry',largeTitleCount:bigTitles.length,bodyCount:body.length,centered}],allowedUseRoles:centered?['cover','section']:['section','cover']};
 }
 const hasContent=body.length||nodes.some(n=>['table','chart'].includes(n.type))||(slide.slots||[]).some(s=>s.role==='content');
 return {version:TEMPLATE_ROLE_VERSION,role:hasContent?'content':'unknown',confidence:hasContent?.8:.35,evidence:[{kind:'structure',bodyCount:body.length}],allowedUseRoles:hasContent?['content','comparison','process','summary','evidence']:['content']};
}
/** Why a template page is no frame for a theme content page (Fable
 * 2026-10-26, live alpha/pdf on GPH tpl39/41: the points sat on a section
 * header's mid-page title): its role is a cover or section, else its title
 * slot starts below 30% of the page height. Null when it is a frame. */
export const HEADER_TITLE_TOP=.3;
export function headerFrameReason(slide,size={}){
 const height=size.height||6858000,width=size.width||12192000;
 if(['cover','section','divider'].includes(classifyTemplatePage(slide,size).role))return 'role';
 const slot=(slide.slots||[]).find(item=>item.role==='title'),node=slot&&(slide.nodes||[]).find(item=>String(item.nativeRef?.shapeId)===String(slot.shapeId));
 if(!(node?.geometry&&node.geometry.y>height*HEADER_TITLE_TOP))return null;
 // A title directly below a certified chrome band (a top painting band) is a
 // header frame too, when the body below it keeps at least 40% of the slide's
 // height and 60% of its width (Fable, 2026-11-02: Mood-Board's band pages).
 const g=node.geometry,body=height-(g.y+g.height);
 const band=(slide.nodes||[]).some(item=>item.type==='image'&&item.geometry&&item.geometry.y<=height*.01&&item.geometry.width>=width*.6&&item.geometry.y+item.geometry.height<=g.y+height*.02&&pictureCertificate(item.content));
 return band&&body>=height*.4&&g.width>=width*.6?null:'geometry';
}
export function roleBasedTemplateMap(count,requested,profiles,outline=[]){
 const wanted=(s,index)=>index===0?'cover':s?.role==='navigation'?'navigation':s?.role==='section'?'section':s?.role==='closing'?'closing':'content';
 const usage=Array(count).fill(0),map=[];
 for(let index=0;index<requested;index++){
  const role=wanted(outline[index],index),candidates=profiles.flatMap((p,i)=>{
   const r=p.semantic?.pageRole;
   if(r?.role==='special')return [];
   const compatible=role==='content'?r?.role==='content'||r?.role==='unknown':r?.allowedUseRoles?.includes(role);
   if(!compatible)return [];
   const cap=Number(p.semantic?.totalVisualCapacity)||0;
   return [{i,cost:(usage[i]||0)*1.5+(map.at(-1)===i?3:0)+(p.directional&&!/process|pipeline|architecture/iu.test(String(outline[index]?.visualIntent?.type||''))?15:0)-Math.min(8,cap/100)}];
  });
  // A template without a dedicated closing uses a content layout for the
  // real conclusion. No assumption about original first/last positions.
  if(!candidates.length&&role!=='cover')for(let i=0;i<count;i++)if(['content','unknown'].includes(profiles[i]?.semantic?.pageRole?.role))candidates.push({i,cost:usage[i]*2});
  if(!candidates.length)throw Object.assign(Error('template_role_unavailable: '+role),{code:'capacity_invalid',outlineContract:true});
  candidates.sort((a,b)=>a.cost-b.cost||a.i-b.i);map.push(candidates[0].i);usage[candidates[0].i]++;
 }
 return map;
}
