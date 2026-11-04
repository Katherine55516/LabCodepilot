/** Page numbers on a card deck (user decision 2026-10-24): every page but the
 * cover carries its number at the bottom right, 10 pt (the body is 14), in the
 * template's body font and colour, digits only — where a deck builder's badge
 * used to sit. A template's own page-number slot takes the number instead. One
 * pass, run when the deck is prepared for export (after any continuation
 * page), so the numbers always match the final page order; the same node is
 * drawn by the preview and written by the native exporter. */
import {stableId} from './ppt/ir.mjs';
import {richTextContent} from './ppt-source-text.mjs';
import {templateTextColor} from './ppt-template-colors.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {visibleNodes} from './ppt-visible-content.mjs';

const EMU=914400,PAGE_NUMBER_PT=10;
const NUMBER_SLOT=/^\s*(?:\d{1,3}|#|<#>)(?:\s*\/\s*\d{1,3})?\s*$/u;
/** The shared footer region: 0.9 × 0.28 in, right edge 0.5 in and bottom 0.3 in from the page edge. */
export function pageNumberRegion(size={}){
 const width=Number(size.width)||12192000,height=Number(size.height)||6858000,w=Math.round(.9*EMU),h=Math.round(.28*EMU);
 return{x:width-Math.round(.5*EMU)-w,y:height-Math.round(.3*EMU)-h,width:w,height:h};
}
const overlaps=(a,b)=>a&&b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
/** A native text box that is the template's own slide-number slot. */
function numberSlot(slide,height){
 return visibleNodes(slide).find(node=>node.type==='text'&&node.nativeRef&&node.geometry&&node.geometry.y>=height*.88&&(node.content?.slideNumberField||NUMBER_SLOT.test(String(node.content?.text||''))));
}
export function syncPageNumbers(project){
 if(!cardsFlow(project))return project;
 const size={width:project.templateFidelity?.width||project.externalPptx?.width,height:project.templateFidelity?.height||project.externalPptx?.height};
 const slides=project.deck?.slides||[];
 slides.forEach((slide,index)=>{
  const own=stableId('node',slide.id,'page-number');
  slide.nodes=(slide.nodes||[]).filter(node=>node.id!==own);
  if(index===0)return;
  const text=String(index+1),slot=numberSlot(slide,size.height||6858000);
  if(slot){slot.content={...slot.content,...richTextContent(text)};slot.semanticRole='page-number';return;}
  let geometry=pageNumberRegion(size);
  // A template shape in that corner: the number moves up to the nearest free band (at most 0.6 in).
  const others=visibleNodes(slide).filter(node=>node.geometry&&node.id!==own&&!node.content?.decorative&&node.type!=='image');
  for(let lift=0;lift<=Math.round(.6*EMU)&&others.some(node=>overlaps(node.geometry,geometry));lift+=Math.round(.08*EMU))geometry={...pageNumberRegion(size),y:pageNumberRegion(size).y-lift};
  const font=project.templateSpec?.fonts||{};
  slide.nodes.push({id:own,type:'text',semanticRole:'page-number',locked:true,zIndex:100,geometry,
   style:{fontSizePt:PAGE_NUMBER_PT,fontFamily:font.body,eastAsiaFontFamily:font.bodyEastAsia,...(({color,basis})=>({color,colorBasis:basis}))(templateTextColor(project,index,'body')),textAlign:'right',lineHeight:1,paragraphSpacingEm:0},
   content:{...richTextContent(text),derivedFrom:'page-number'}});
  slide.nodeOrder=[...(slide.nodeOrder||[]).filter(id=>id!==own),own];
 });
 return project;
}
/** Blocking check: every page but the cover shows its own number. */
export function inspectPageNumbers(project,slides=project.deck?.slides||[]){
 if(!cardsFlow(project)||project.templateFidelity?.mode!=='preserve')return[];
 return slides.flatMap((slide,index)=>index===0||visibleNodes(slide).some(node=>node.semanticRole==='page-number'&&String(node.content?.text||'').trim()===String(index+1))?[]:
  [{code:'page_number_missing',severity:'error',repairable:true,slideId:slide.id,message:`Page ${index+1} does not show its page number.`}]);
}
