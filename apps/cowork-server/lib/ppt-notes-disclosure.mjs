import {regionsFor}from './ppt-layout.mjs';
import {selectionNotesBySlide}from './ppt-content-selection.mjs';
import {stableId}from './ppt/ir.mjs';
import {richTextContent}from './ppt-source-text.mjs';
import {applyRenderContract,measureText}from './ppt/render-contract.mjs';
const E=914400;
/** Actual notes, not merely an authoring assumption, have a visible owner. */
export function bindNotesDisclosures(project){
 project.notesDisclosureIssues=[];
 for(const slide of project.deck?.slides||[])slide.nodes=slide.nodes.filter(n=>n.content?.derivedFrom!=='notes-disclosure');
 const notes=selectionNotesBySlide(project);
 // A single compact deck-level disclosure is enough. Every slide still owns
 // its complete notes and source IDs, without a repeated authoring banner.
 for(const note of notes.slice(0,1)){
  const slide=project.deck.slides[note.index],width=project.templateFidelity?.width||13.333*E,height=project.templateFidelity?.height||7.5*E;
  const locale=project.generationPolicy?.language?.locale||(/\p{Script=Han}/u.test(project.source?.text||'')?'zh':'en');
  const code=(project.originalSourceInventory?.items||[]).some(i=>i.type==='CodeBlock'&&notes.some(n=>n.sourceUnitIds.includes(i.id)));
  const text=locale==='en'?(code?'Source details and code in speaker notes':'Source details in speaker notes'):locale==='zh-HK'?(code?'來源細節及代碼見備註':'來源細節見備註'):(code?'来源细节及代码见备注':'来源细节见备注');
  const y=height-E*.56,h=E*.5;let intervals=[[E*.4,width-E*.4]];
  const footer=project.templateFidelity?.mode==='preserve'?undefined:regionsFor(slide).find(region=>region.id==='footer');
  const occupied=[...slide.nodes,...(footer?[{geometry:{x:footer.x*E,y:footer.y*E,width:footer.w*E,height:footer.h*E}}]:[])];
  for(const node of occupied){const g=node.geometry;if(!g||g.y+g.height<=y||g.y>=y+h||g.width>=width*.85&&g.height>=height*.85)continue;intervals=intervals.flatMap(([l,r])=>g.x>=r||g.x+g.width<=l?[[l,r]]:[[l,Math.min(r,g.x-E*.08)],[Math.max(l,g.x+g.width+E*.08),r]]).filter(([l,r])=>r>l);}
  const style={fontSizePt:14,lineHeight:1.18,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,color:project.templateSpec?.palette?.foreground||'#242a3b'},content={...richTextContent(text),derivedFrom:'notes-disclosure',notesHash:project.contentSelection?.hash||note.completeOriginalSource?.sha256};
  const area=intervals.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0])).map(([l,r])=>({x:Math.round(l),y:Math.round(y),width:Math.round(r-l),height:Math.round(h)})).find(bounds=>!measureText(applyRenderContract({kind:'text',bounds,style,content})).overflow);
  if(!area){project.notesDisclosureIssues.push({code:'notes_disclosure_capacity',severity:'error',slideId:slide.id,message:'Actual source notes need a visible disclosure; no unchanged-font free footer fits.'});continue;}
  slide.nodes.push({id:stableId('node',slide.id,'notes-disclosure'),type:'text',semanticRole:'footnote',slotId:'absolute',geometry:area,style,content,zIndex:550});slide.nodeOrder=slide.nodes.map(n=>n.id);
 }
 return project;
}
