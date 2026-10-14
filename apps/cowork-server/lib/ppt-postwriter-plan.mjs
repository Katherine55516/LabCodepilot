import {fitComponents,prepareReadingComponents} from './ppt-density-capacity.mjs';
import {isSourceOwnedNode} from './ppt-source-artifacts.mjs';
import {sourceRichText} from './ppt-rich-text.mjs';
import {digest} from './ppt/edit-context.mjs';
import {operationHistory} from './ppt/command-history.mjs';
import {userHistoryAffectsSlide} from './ppt-optional-copy-repair.mjs';
const sourceChapter=(p,o)=>{const items=p.source?.semantic?.inventory?.items||[];const keys=[...new Set(items.filter(i=>o?.sourceUnitIds?.includes(i.id)).map(i=>i.sectionPath?.[1]).filter(Boolean))];return keys.length===1?keys[0]:o?.section;};
const actualComponents=(p,nodes)=>prepareReadingComponents(p.source?.semantic?.inventory?.items||[],nodes.filter(n=>!n.content?.derivedFrom).map(n=>{const item=p.source?.semantic?.inventory?.items?.find(i=>i.id===n.sourceArtifact?.sourceUnitId),fragment=n.sourceArtifact?.itemStart;return {type:n.type,content:n.content,fontSizePt:n.style?.fontSizePt,sourceUnitId:n.sourceArtifact?.sourceUnitId,...(fragment!==undefined?{itemFragment:{itemStart:fragment,itemEnd:fragment+1}}:{}),...(item?.languagePairId?{pairId:item.languagePairId+(fragment===undefined?'':':point:'+fragment)}:{})};}));
/** Plan against actual written objects, keeping complete content, existing font
 * sizes, source ownership and frozen page count. Proposals never silently
 * change a confirmed syllabus. The standard command/quality workflow applies
 * approved page changes. */
export function postWriterPlan(project){
 const slides=project.deck?.slides||[],pages=[],merges=[];
 const history=project.uid&&project.id?operationHistory(project.uid,project.id):[];
 const protectedPage=slide=>slide.locked||project.runtime?.slides?.[slide.id]?.accepted||slide.nodes?.some(n=>n.locked&&['text','list','table','chart'].includes(n.type))||project.constraints?.entries?.some(c=>c.active&&(c.slideId===slide.id||c.slideIds?.includes(slide.id)))||userHistoryAffectsSlide(history,slide.id);
 for(const [index,slide] of slides.entries()){
  const nodes=(slide.nodes||[]).filter(n=>isSourceOwnedNode(n)||['body','subtitle','takeaway'].includes(n.semanticRole));
  const components=actualComponents(project,nodes);
  const fit=components.length?fitComponents(components,project,index):null;
  const contentHash=digest(nodes.map(n=>({id:n.id,type:n.type,content:n.content,sourceArtifact:n.sourceArtifact})));
  const empty=(slide.nodes||[]).filter(n=>n.type==='text'&&n.semanticRole!=='page-number'&&!n.content?.text?.trim());
  pages.push({slideId:slide.id,contentHash,actualObjects:nodes.length,emptyNodeIds:empty.map(n=>n.id),measuredFit:fit?{capacity_ok:fit.capacity_ok,fontSizePt:fit.fontSizePt,usedHeight:fit.usedHeight,availableHeight:fit.availableHeight,layoutId:fit.layoutId,boxes:fit.boxes}:null,
   formulaDiagnostics:nodes.flatMap(n=>n.content.richText?.diagnostics||(!n.content.mathMl&&typeof n.content.text==='string'?sourceRichText(n.content.text).diagnostics:[]))});
  const next=slides[index+1],a=project.outline?.find(o=>o.id===slide.id),b=project.outline?.find(o=>o.id===next?.id);
  if(!next||index===0||index+1===slides.length-1||protectedPage(slide)||protectedPage(next)||a?.titleLocked||b?.titleLocked||!sourceChapter(project,a)||sourceChapter(project,a)!==sourceChapter(project,b)||!nodes.length)continue;
  const other=(next.nodes||[]).filter(n=>isSourceOwnedNode(n)||['body','subtitle','takeaway'].includes(n.semanticRole));if(!other.length)continue;
  const combined=[...components,...actualComponents(project,other)];
  const measured=fitComponents(prepareReadingComponents(project.source?.semantic?.inventory?.items||[],combined),project,index);if(measured.capacity_ok)merges.push({slideIds:[slide.id,next.id],sourceUnitIds:[...new Set([...(a.sourceUnitIds||[]),...(b.sourceUnitIds||[])])],beforeHashes:[contentHash,digest(other.map(n=>({id:n.id,type:n.type,content:n.content,sourceArtifact:n.sourceArtifact})))],layoutId:measured.layoutId,fontSizePt:measured.fontSizePt,boxes:measured.boxes,reason:'Complete actual objects fit together at the existing or larger font; requires a coherent combined title and fresh semantic/visual review.'});
 }
 return {version:1,basis:'actual_writer_objects',sourceHash:project.source?.sha256,revision:project.revision,frozenPageCount:slides.length,contract:project.generationPolicy?.content||'legacy',language:project.generationPolicy?.language||{mode:'source'},pages,mergeProposals:merges,application:project.pageDecision?.mode==='auto'?'Production executor may commit a measured coherent source-preserving consolidation; failed candidates roll back.':'Exact-N: diagnostic proposals only; the total stays frozen'};
}
