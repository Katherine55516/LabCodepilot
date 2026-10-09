/** Versioned structural profiles from imported IR; no model and no sample copy
 * becomes authority. Media roles derived from geometry are marked heuristic. */
import crypto from 'node:crypto';
import {measureText,applyRenderContract} from './ppt/render-contract.mjs';
export const TEMPLATE_COMPONENT_VERSION=1;
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const distance=(a,b)=>Math.hypot((a.x+a.width/2)-(b.x+b.width/2),(a.y+a.height/2)-(b.y+b.height/2));
export function templateComponentProfile(slides,size={},hash='',roleFor=null) {
  const width=size.width||12192000,height=size.height||6858000,assets=new Map();
  const pages=slides.map((slide,index)=>{
    const nodes=slide.nodes||[], slots=slide.slots||[], texts=nodes.filter(x=>x.type==='text'&&x.content?.text);
    const media=nodes.filter(x=>x.type==='image').map(node=>{
      const area=node.geometry.width*node.geometry.height/(width*height);
      const role=roleFor?.(node,slide,{width,height}) || node.content?.mediaRole || (area<.02?'template_icon':area>.08?'template_decoration':'unknown');
      const assetId=node.content?.imageSha256||digest(node.content?.dataUrl||node.id);
      const backing=nodes.filter(x=>x.type==='shape'&&x.style?.fill&&x.geometry&&x.geometry.x<=node.geometry.x&&x.geometry.y<=node.geometry.y&&x.geometry.x+x.geometry.width>=node.geometry.x+node.geometry.width&&x.geometry.y+x.geometry.height>=node.geometry.y+node.geometry.height&&(x.zIndex||0)<(node.zIndex||0)).sort((a,b)=>(b.zIndex||0)-(a.zIndex||0))[0];
      if(node.content?.dataUrl)assets.set(assetId,{assetId,dataUrl:node.content.dataUrl,role,origin:'template',geometry:node.geometry,carrierColor:backing?.style?.fill,roleBasis:node.content?.mediaRole?'declared':'geometry_heuristic',required:!!node.content?.mustPreserve});
      const closest=texts.filter(x=>x.geometry).sort((a,b)=>distance(a.geometry,node.geometry)-distance(b.geometry,node.geometry))[0];
      return {nodeId:node.id,assetId,role,required:!!node.content?.mustPreserve,boundSlotId:closest?.id||null,geometry:node.geometry};
    });
    const textSlots=texts.map(node=>{
      const slot=slots.find(x=>String(x.shapeId)===String(node.nativeRef?.shapeId));
      const fontSizePt=node.style?.fontSizePt||18;
      const element=applyRenderContract({kind:'text',bounds:node.geometry,content:node.content,style:{...node.style,fontSizePt},nativeTextFrame:node.nativeTextFrame});
      const fit=measureText(element),role=slot?.purpose||node.semanticRole||(node.geometry.y<height*.24?'title':'body');
      const lineCapacity=Math.max(0,Math.floor(fit.availableHeightPt/(fontSizePt*1.18*1.2)));
      return {nodeId:node.id,shapeId:node.nativeRef?.shapeId,role,geometry:node.geometry,fontSizePt,margins:element.textLayout.margins,lineCapacity,
        visualUnitCapacity:Math.floor(fit.widthPt/Math.max(1,fontSizePt)*.88*lineCapacity),groupId:slot?.groupId||node.groupId||null,pairedWith:slot?.pairedWith||null};
    });
    const groups=new Map();
    for(const slot of textSlots.filter(x=>x.groupId)){const group=groups.get(slot.groupId)||[];group.push(slot.nodeId);groups.set(slot.groupId,group);}
    const itemMedia=media.filter(x=>x.role==='template_icon');
    const repeatedGroups=[...groups].map(([id,nodeIds])=>({id,nodeIds,mediaIds:media.filter(m=>nodeIds.includes(m.boundSlotId)).map(m=>m.nodeId),reflow:false}));
    const directional=nodes.some(x=>/ARROW|CONNECTOR|CHEVRON|FLOWCHART/i.test(`${x.nativeRef?.autoShapeType||''} ${x.nativeRef?.name||''}`));
    const layoutType=index===0?'cover':directional?'relationship':repeatedGroups.length>1||itemMedia.length>1?'item-icons':media.some(x=>x.role==='template_decoration')?'image-split':'text';
    return {index,layoutType,textSlots,repeatedGroups,itemCapacity:Math.max(repeatedGroups.length,itemMedia.length),media,
      protectionRegions:nodes.filter(x=>x.locked||x.type==='foreign'||x.content?.mustPreserve).map(x=>({nodeId:x.id,type:x.type,geometry:x.geometry})),
      capacityBasis:'shared_render_contract_conservative_prediction'};
  });
  return {version:TEMPLATE_COMPONENT_VERSION,templateHash:hash,width,height,pages,assets:[...assets.values()],profileHash:digest(JSON.stringify(pages)),visualVerified:false};
}
/** Unbound mapped media are aids/decoration, never evidence; stable IDs allow
 * dispositions and user deletion to be audited. Unknown/protected media are not moved. */
export function bindMappedTemplateMedia(project) {
  const profile=project.templateFidelity?.componentProfile;
  if(project.templateFidelity?.mode!=='mapped'||!profile||!project.deck)return project;
  project.deck.slides.forEach((slide,index)=>{
    if(slide.locked||project.runtime?.slides?.[slide.id]?.accepted)return;
    const contract=project.planning?.slidePlan?.find(x=>x.slideId===slide.id)?.pageContract;
    const body=slide.nodes?.find(x=>x.semanticRole==='body'&&x.type==='list');
    const icons=profile.assets.filter(x=>x.role==='template_icon'&&!x.required);
    if(index>0&&['summary','editorial'].includes(slide.layoutId)&&body?.content?.items?.length&&icons.length&&!slide.nodes.some(x=>x.sourceArtifact)) {
      // Comparison alternatives remain unordered; item-icons has no sequence arrows.
      slide.layoutId=slide.layoutRef='item-icons';
      slide.nodes=slide.nodes.filter(x=>!x.templateMediaBinding);
      body.content.items.forEach((item,i)=>{
        const asset=icons[i%icons.length];
        slide.nodes.push({id:`mapped_${slide.id}_${i}`,type:'image',semanticRole:'item-icon',content:{dataUrl:asset.dataUrl,fit:'contain',carrierColor:asset.carrierColor||project.templateSpec?.palette?.accent},
          templateMediaBinding:{assetId:asset.assetId,itemId:item.id,itemIndex:i,role:'template_icon',origin:'template',reason:'visual_aid_not_source_evidence'},zIndex:30});
      });
      slide.nodeOrder=slide.nodes.map(x=>x.id);
    } else if(index>0&&contract?.compositionCandidates?.includes('formula-variables')&&slide.nodes.filter(x=>x.content?.mathMl||x.content?.latex).length===1) {
      slide.layoutId=slide.layoutRef='formula-variables';
    }
  });
  return project;
}
