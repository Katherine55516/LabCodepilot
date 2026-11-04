/** Whole native components, inferred conservatively from local geometry.
 * A picture's carrier is part of it. Native XML clones keep the original
 * relationships; source copy is separately bound to measured ReadingUnits. */
import {stableId} from './ppt/ir.mjs';
import {contrastRatio} from './ppt-template-colors.mjs';
export const COMPONENT_SPEC_VERSION=1;
const covers=(a,b)=>a.x<=b.x&&a.y<=b.y&&a.x+a.width>=b.x+b.width&&a.y+a.height>=b.y+b.height;
export function componentIconBackground(members,image,background){
 return members.filter(n=>n!==image&&n.geometry&&image.geometry&&covers(n.geometry,image.geometry)&&(n.zIndex||0)<(image.zIndex||0)&&(n.type==='shape'&&n.style?.fill||n.type==='image'&&n.content?.panelColor)).sort((a,b)=>(b.zIndex||0)-(a.zIndex||0)).map(n=>n.style?.fill||n.content.panelColor)[0]||background;
}
export function componentReflowReadable(prototype,background){
 return prototype.members.filter(n=>n.type==='image'&&n.content?.foregroundColor).every(image=>contrastRatio(image.content.foregroundColor,componentIconBackground(prototype.members,image,background))>=3);
}
export function nativeComponentSpecs(spec,size={}){
  const nodes=spec?.nodes||[],total=(size.width||1)*(size.height||1);
  return nodes.filter(n=>n.type==='image'&&n.geometry&&n.nativeRef?.shapeId!==undefined&&n.geometry.width*n.geometry.height<total*.08&&!n.content?.mustPreserve).map(icon=>{
    const g=icon.geometry;
    const members=nodes.filter(n=>n===icon||n.type==='shape'&&n.geometry&&n.nativeRef?.shapeId!==undefined&&covers(n.geometry,g)&&n.geometry.width*n.geometry.height<total*.2&&(n.zIndex||0)<(icon.zIndex||0));
    const slots=(spec.slots||[]).filter(slot=>{const n=nodes.find(n=>n.nativeRef?.shapeId===slot.shapeId);return n?.geometry&&slot.role==='content'&&n.geometry.x>=g.x&&Math.abs(n.geometry.y-g.y)<=Math.max(g.height,n.geometry.height)*.5;}).map(slot=>({shapeId:slot.shapeId,role:slot.purpose||'body',nativeFrame:structuredClone(nodes.find(n=>n.nativeRef?.shapeId===slot.shapeId)?.nativeTextFrame),replacement:'immutable source reading unit, never sample copy'}));
    const frames=members.filter(n=>n.type==='shape'&&/^(?:ROUNDED_)?RECTANGLE\b/.test(n.nativeRef?.autoShapeType||'')&&n.geometry.width>g.width*1.5&&n.geometry.height>g.height*1.5&&/^#[a-f0-9]{6}$/i.test(n.style?.fill||''));
    const frame=frames.length===1?frames[0]:null;
    return {version:COMPONENT_SPEC_VERSION,family:icon.content?.panelColor?'card-panel':frame?'native-card':'icon-carrier',layoutFrameNodeId:frame?.id,panelColor:icon.content?.panelColor||frame?.style?.fill||null,id:stableId('component',icon.id),role:'item-aid',roleBasis:'local_carrier_geometry',anchorNodeId:icon.id,
      nativeMembers:members.map(n=>({nodeId:n.id,shapeId:n.nativeRef.shapeId,type:n.type,geometry:{...n.geometry},imageSha256:n.content?.imageSha256||null,zIndex:n.zIndex||0})),
      slots,anchors:[{nodeId:icon.id,role:'visual-aid'}],mediaRoles:['item-aid','native-carrier'],styleTokens:members.map(n=>({nodeId:n.id,style:n.style})),variantConstraints:{fixedTextFont:true,maxUnits:8,relationshipScope:'same_slide',groupPolicy:'unknown groups preserved; no blind cloning'},clonePolicy:'same_slide_relationships_unique_ids',sourceAnchor:{...g},members};
  }).sort((a,b)=>a.sourceAnchor.y-b.sourceAnchor.y||a.sourceAnchor.x-b.sourceAnchor.x);
}
/** Affine transform the whole carrier, with one stable instance per unit. */
export function componentInstance(spec,slideId,unitIndex,geometry,usedIds=new Set(),{frameGeometry}={}){
  const a=spec.sourceAnchor,sx=geometry.width/a.width,sy=geometry.height/a.height;
  return spec.members.map(member=>{
    const original=member.nativeRef.shapeId,clone=usedIds.has(original);usedIds.add(original);
    const n=structuredClone(member),g=member.geometry;
    n.id=stableId('node',slideId,spec.id,unitIndex,original);
    n.geometry={x:Math.round(geometry.x+(g.x-a.x)*sx),y:Math.round(geometry.y+(g.y-a.y)*sy),width:Math.round(g.width*sx),height:Math.round(g.height*sy)};
    if(frameGeometry&&member.id===spec.layoutFrameNodeId)n.geometry=structuredClone(frameGeometry);
    if(clone){let id=100000+unitIndex*10000+Number(original);while(usedIds.has(id)||spec.members.some(m=>Number(m.nativeRef.shapeId)===id))id++;usedIds.add(id);n.nativeRef={...n.nativeRef,shapeId:id,cloneFromShapeId:original};}
    n.templateComponentBinding={componentSpecId:spec.id,unitIndex,originalShapeId:original,action:clone?'cloned':'retained',geometryBasis:'whole_component_affine',imageSha256:member.content?.imageSha256||null};
    return n;
  });
}
