import {explicitLayoutLocks} from './ppt-layout-locks.mjs';
/** Content containers are certified from original heading/body slots, not from
 * a picture's rectangular bounds alone. Photographs and fixed assets stay out. */
import {balanceBoundContainers} from './ppt-container-layout.mjs';
import {visibleNodes,nodeContentText} from './ppt-visible-content.mjs';
import {measureText} from './ppt/render-contract.mjs';
import {adaptationDisposition} from './ppt-template-dispositions.mjs';
import {stableId} from './ppt/ir.mjs';
const inside=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width+2&&b.y+b.height<=a.y+a.height+2;
const bits=value=>[...String(value||'')].reduce((sum,c)=>sum+parseInt(c,16).toString(2).replace(/0/g,'').length,0);
export function templateContentContainers(project,slide,index){
 const spec=project.templateFidelity?.slides?.[index];if(!spec)return[];
 const live=visibleNodes(slide),fixed=new Set(project.templateFixedObjectIds||[]),total=(project.templateFidelity.width||12192000)*(project.templateFidelity.height||6858000);
 const candidates=live.filter(n=>n.geometry&&n.nativeRef&&n.content?.templateDesignOnly&&!n.content.mustPreserve&&!fixed.has(n.id)&&!n.templateComponentBinding?.badge&&
  (n.type==='shape'&&n.style?.fill||n.type==='image'&&/^[0-9a-f]{16}$/iu.test(n.content.imageDhash||'')&&bits(n.content.imageDhash)<=18)&&
  n.geometry.width*n.geometry.height<total*.2&&n.geometry.width>914400);
 return candidates.map(frame=>{
  const slots=(spec.slots||[]).filter(slot=>slot.role==='content').map(slot=>({slot,node:spec.nodes.find(n=>n.nativeRef?.shapeId===slot.shapeId)})).filter(({node})=>node?.geometry&&inside(frame.geometry,node.geometry));
  if(!slots.some(s=>s.slot.purpose==='point-heading')||!slots.some(s=>['body','list','point-description'].includes(s.slot.purpose)))return null;
  const rects=slots.map(s=>s.node.geometry),x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y)),right=Math.max(...rects.map(r=>r.x+r.width)),bottom=frame.geometry.y+frame.geometry.height-Math.max(90000,frame.geometry.width*.04);
  const geometry={x,y,width:right-x,height:Math.round(bottom-y)};if(geometry.height<12700*28)return null;
  const textNodes=live.filter(n=>n!==frame&&['text','list','table','chart'].includes(n.type)&&n.geometry&&inside(frame.geometry,n.geometry)&&nodeContentText(n).trim());
  return {id:stableId('component',slide.id,frame.nativeRef.shapeId),frameNodeId:frame.id,shapeId:frame.nativeRef.shapeId,geometry,slotShapeIds:slots.map(s=>s.slot.shapeId),fontSizePt:Math.max(14,Number(slots.find(s=>['body','list','point-description'].includes(s.slot.purpose)).slot.fontSizePt)||14),occupied:textNodes.length>0,memberNodeIds:textNodes.map(n=>n.id),basis:'original_enclosed_heading_and_body_slots_simple_frame'};
 }).filter(Boolean).sort((a,b)=>Math.abs(a.geometry.y+a.geometry.height-b.geometry.y-b.geometry.height)<300000?a.geometry.x-b.geometry.x:a.geometry.y-b.geometry.y);
}
export const fillComponentIntent=instruction=>/(?:补充|填充|填写|填入|补全|添加|加上|放入|写入|填满|fill|populate|add|put|write)[\s\S]{0,45}(?:空(?:白|框|卡片|组件)|框(?:内|中|里)|方框|卡片(?:内|中|里)|empty|blank|box|container)|(?:空框|方框|框内|空白卡片|empty\s+(?:box|card)|blank\s+(?:box|card))[\s\S]{0,45}(?:补充|填充|填写|内容|文字|fill|populate|content|text)/iu.test(String(instruction||''));

export function containerTextNode(project,slide,container,text,pointIds=[]){
 const prior=slide.nodes.find(n=>n.type==='text'&&n.semanticRole==='source-explanation');
 return {id:stableId('node',slide.id,container.id,'body'),type:'text',slotId:'absolute',semanticRole:'source-explanation',locked:false,geometry:{...container.geometry},zIndex:500,
  content:{text,derivedFrom:'card-page'},sourceRefs:slide.sourceRefs||[],style:{fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,fontSizePt:container.fontSizePt,lineHeight:1.18,color:prior?.style?.color||project.templateSpec?.palette?.foreground||'#111111'},
  templateComponentBinding:{version:1,componentSpecId:container.id,containerNodeId:container.frameNodeId,slotShapeIds:container.slotShapeIds,pointIds,geometryBasis:container.basis}};
}
export const containerTextFits=node=>!measureText({...node,kind:'text',bounds:node.geometry}).overflow;
/** Reuse the actual template's empty containers before reserving them as
 * artwork. Every unused certified container retires as one whole component. */
export function bindContainerPoints(project,slide,index,page){
 const containers=templateContentContainers(project,slide,index).filter(c=>!c.occupied),points=page.keyPoints||[];
 if(!containers.length||!points.length||points.length>containers.length||page.cardObjects?.length)return null;
 const nodes=points.map((point,i)=>containerTextNode(project,slide,containers[i],String(point.text||point)));
 if(nodes.some(n=>!containerTextFits(n)))return null;
 const old=slide.nodes.filter(n=>!n.locked&&!n.nativeRef&&!n.userGeometry&&!n.userStyle&&n.semanticRole==='source-explanation'&&n.content?.derivedFrom==='card-page');
 slide.nodes=slide.nodes.filter(n=>!old.some(o=>o.id===n.id));slide.nodes.push(...nodes);slide.sourceArtifactNodes=nodes;slide.nodeOrder=slide.nodes.map(n=>n.id);
 slide.templateOmissions||=[];
 for(const c of containers){
  for(const shapeId of c.slotShapeIds)if(!slide.templateOmissions.some(o=>o.shapeId===shapeId))slide.templateOmissions.push({shapeId,automatic:true,approvalBasis:'source_region_replacement',reason:'The component body replaces the original example heading and body together.'});
  if(nodes.some(n=>n.templateComponentBinding.containerNodeId===c.frameNodeId))continue;
  const frame=slide.nodes.find(n=>n.id===c.frameNodeId);
  slide.templateOmissions.push({...adaptationDisposition(project,frame,'template_artwork','source_region_artwork_avoidance','Unused certified content container retires with its original text; source points are bound in the other containers.'),replacementRegion:frame.geometry,overlapRatio:1});
 }
 slide.templateSlotTexts=Object.fromEntries(Object.entries(slide.templateSlotTexts||{}).filter(([key])=>!containers.some(c=>c.slotShapeIds.includes(Number(key)))));
 slide.bullets=[];slide.copy={...slide.copy,blocks:points.map(p=>({type:'mechanism',body:String(p.text||p)})),subtitle:'',takeaway:''};
 slide.cardPage={...slide.cardPage,mode:'theme',shape:'bound-containers',templatePage:(project.templateFidelity?.slideMap?.[index]??-1)+1};
 slide.componentLayoutVersion=1;balanceBoundContainers(project,slide,index);return slide;
}
export function inspectEmptyTemplateComponents(project){
 return (project.deck?.slides||[]).flatMap((slide,index)=>!slide.componentLayoutVersion&&!slide.cardPage?[]:templateContentContainers(project,slide,index).filter(c=>!c.occupied).map(c=>({code:'empty_template_component',severity:'error',slideId:slide.id,nodeIds:[c.frameNodeId],message:'模板内容容器未绑定可见文字；请填充或连同旧内容整体移除。'})));
}

/** Retire unused template containers only after source content has been bound.
 * A raster's empty/transparent center is not sufficient evidence: original
 * heading/body slots certify its purpose. Fixed and manual objects stay put. */
export function retireUnboundContainers(project,slide,index){
 const explicitLocks=explicitLayoutLocks(project);
 const empty=templateContentContainers(project,slide,index).filter(c=>!c.occupied),retired=[];
 for(const c of empty){
  const live=slide.nodes.find(n=>n.id===c.frameNodeId),base=project.templateFidelity.slides[index].nodes.find(n=>String(n.nativeRef?.shapeId)===String(c.shapeId));
  if(!base||explicitLocks.has(live.id)||live.userGeometry||live.userStyle||live.content?.mustPreserve)continue;
  const role=base.content?.mediaRole||'template_artwork',basis=role==='old_template_content'?'design_only_template':'source_region_artwork_avoidance';
  slide.templateOmissions||=[];slide.templateOmissions.push({...adaptationDisposition(project,base,role,basis,'Unused certified content frame retires as a whole; complete sourced text remains visible in the reading area.'),replacementRegion:{...base.geometry},overlapRatio:1});
  slide.nodes=slide.nodes.filter(n=>n.id!==live.id);retired.push(c.frameNodeId);
 }
 if(retired.length){slide.nodeOrder=slide.nodes.map(n=>n.id);slide.containerDisposition={version:1,retiredNodeIds:retired,basis:'original heading/body slots certify unbound old template containers; sourced payload retained'};}
 return retired;
}
