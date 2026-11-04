/** A section label written into a template's small header pill (Fable D4,
 * 2026-11-01; Professional-Portfolio: "架构流程与执行恢复" in a 6-character
 * pill wrapped to two lines, its widened text ran over the next pill, which
 * stood empty because its own slot was left out). The label is never
 * shortened: its pill and text grow to one measured line; a pill that would
 * meet another object leaves the label and its pill out. A shape that only
 * framed template text the page leaves out goes with that text. */
import {visibleNodes,nodeContentText} from './ppt-visible-content.mjs';
import {measureText} from './ppt/render-contract.mjs';

const STEP=Math.round(.02*914400);
const center=box=>({x:box.x+box.width/2,y:box.y+box.height/2});
const inside=(point,box)=>box&&point.x>=box.x&&point.x<=box.x+box.width&&point.y>=box.y&&point.y<=box.y+box.height;
const meets=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
/** Measured at the line spacing it renders with (the renderer lifts template spacing below 1.15). */
export function sectionLine(node,geometry=node.geometry){
 const frame=node.nativeTextFrame?.paragraphs?{...node.nativeTextFrame,paragraphs:node.nativeTextFrame.paragraphs.map(p=>Number(p.lineSpacing)>0&&Number(p.lineSpacing)<1.15?{...p,lineSpacing:1.15}:p)}:node.nativeTextFrame;
 return measureText({...node,nativeTextFrame:frame,kind:'text',semanticRole:'template-text',bounds:geometry});
}
export const sectionFitsFrame=node=>{const fit=sectionLine(node);return !fit.overflow&&!fit.widthOverflow&&fit.lines<=1;};
const omit=(slide,node,reason)=>{
 // Left out of the page itself too: the export refuses a shape both omitted and present.
 slide.nodes=(slide.nodes||[]).filter(item=>item!==node);if(slide.nodeOrder)slide.nodeOrder=slide.nodeOrder.filter(id=>id!==node.id);
 slide.templateOmissions||=[];
 if(!slide.templateOmissions.some(item=>String(item.shapeId)===String(node.nativeRef.shapeId)))slide.templateOmissions.push({shapeId:Number(node.nativeRef.shapeId),reason,automatic:true,approvalBasis:'header_pill_fit'});
};
export function fitHeaderPills(project,slide,index){
 const fidelity=project.templateFidelity,spec=fidelity?.slides?.[index];
 if(fidelity?.mode!=='preserve'||!spec||index===0)return slide;
 const width=Number(fidelity.width)||0;
 // A section label the page writes nothing into goes, with its pill below
 // (Codex 2026-11-03, Deal-Review t8: an empty "WRAP-UP" pill above the title).
 const sectionSlots=new Set((spec.slots||[]).filter(slot=>slot.role==='section').map(slot=>String(slot.shapeId)));
 for(const node of visibleNodes(slide).filter(node=>node.type==='text'&&sectionSlots.has(String(node.nativeRef?.shapeId))&&!String(nodeContentText(node)||'').trim()))
  omit(slide,node,'A section label with no text on this page.');
 const shown=visibleNodes(slide);
 const background=node=>node.geometry.width>=.9*width;
 const shapes=shown.filter(node=>node.type==='shape'&&node.nativeRef&&node.geometry&&!background(node)&&!String(nodeContentText(node)||'').trim());
 const texts=shown.filter(node=>node.type==='text'&&node.geometry&&String(nodeContentText(node)||'').trim());
 // A shape framing only template text the page leaves out goes with it.
 const specText=(spec.nodes||[]).filter(node=>node.type==='text'&&node.geometry&&node.nativeRef);
 for(const shape of shapes){
  const framed=specText.filter(node=>inside(center(node.geometry),shape.geometry));
  if(framed.length&&!framed.some(node=>shown.some(item=>String(item.nativeRef?.shapeId)===String(node.nativeRef.shapeId)&&String(nodeContentText(item)||'').trim()))&&!texts.some(node=>inside(center(node.geometry),shape.geometry)))
   omit(slide,shape,'A frame of template text this page leaves out.');
 }
 const sectionIds=new Set((spec.slots||[]).filter(slot=>slot.role==='section').map(slot=>String(slot.shapeId)));
 const label=visibleNodes(slide).find(node=>node.type==='text'&&sectionIds.has(String(node.nativeRef?.shapeId))&&String(nodeContentText(node)||'').trim());
 if(!label||sectionFitsFrame(label))return slide;
 const pill=visibleNodes(slide).find(node=>node.type==='shape'&&node.nativeRef&&node.geometry&&!background(node)&&inside(center(label.geometry),node.geometry));
 const others=visibleNodes(slide).filter(node=>node!==label&&node!==pill&&node.geometry&&!background(node));
 const limit=width-Math.round(.25*914400);
 for(let grow=STEP;label.geometry.x+label.geometry.width+grow<=limit;grow+=STEP){
  const one=sectionLine(label,{...label.geometry,width:label.geometry.width+grow});
  if(one.widthOverflow||one.lines>1)continue;
  // One line at its rendered height, from the frame's own top.
  const height=Math.max(label.geometry.height,Math.ceil((one.estimatedHeightPt+1)*12700));
  const text={...label.geometry,width:label.geometry.width+grow,height};
  const frame=pill&&{...pill.geometry,width:pill.geometry.width+grow};
  if([text,frame].filter(Boolean).some(box=>others.some(node=>meets(box,node.geometry))))break;
  // The grown frame is the one later frame fits start from.
  label.geometry=text;delete label.templateTitleFrameAdaptation;if(pill)pill.geometry=frame;
  slide.sectionLabel={...slide.sectionLabel,width:text.width,height:text.height,basis:slide.sectionLabel?.basis||'header-pill',pillGrown:true};
  return slide;
 }
 // No room: the label and its pill are left out; the contents page carries the sections.
 omit(slide,label,'The section label does not fit its header pill on one line, and the pill cannot grow.');
 if(pill)omit(slide,pill,'The header pill of a section label left out.');
 return slide;
}
