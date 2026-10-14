import { adaptationDisposition } from './ppt-template-dispositions.mjs';
/** Source-owned editable structures. The model selects inventory IDs/row ranges,
 * never invents cells or supplies geometry. Capacity failure asks for split. */
import {readingUnits} from './ppt-semantic-relations.mjs';
import { stableId } from './ppt/ir.mjs';
import { fitComponents, explanationBudget, protectedTemplateAsset, sourceComponent, sourceComponentParts, prepareReadingComponents, sourceImageComponents, validateSourceArtifactRefs } from './ppt-density-capacity.mjs';
import {sourceDisplayText,richTextContent,ensureRichContent} from './ppt-source-text.mjs';
import {templateMediaRole} from './ppt-template-fidelity.mjs';
import {lockedEvidenceComponents} from './ppt-evidence.mjs';
import {templateTextColor} from './ppt-template-colors.mjs';
import {mediaPreservingFit,supplementaryNativeMedia,anchorCardIcons,sourceRegion} from './ppt-media-preserving-layout.mjs';
export {sourceDisplayText} from './ppt-source-text.mjs';
const clean = sourceDisplayText;
// Absolute source-owned explanations have no inventory artifact ID, but must
// survive the same preview and export paths as the referenced structures.
export const isSourceOwnedNode = node => Boolean(node.sourceArtifact || node.semanticRole === 'source-explanation'||['source-navigation','notes-disclosure'].includes(node.content?.derivedFrom));
export function sourceExplanationComponents(texts) {
  return texts.flatMap(text=>String(text).split(/\n\s*\n/u).filter(part=>part.trim()).map(text=>({type:'text',content:richTextContent(text)})));
}
/** Replace obsolete foreground diagrams in a rebuilt source region. Keep the
 * title/footer, full canvas artwork and photos outside that region. */
/** An icon is part of a card set when another same-size image on the template
 * slide shares its row or column (the repeated card pattern). */
function cardSetIcon(node,spec){
  const g=node.geometry;if(!g)return false;
  const near=(a,b,t)=>Math.abs(a-b)<=t;
  return (spec.nodes||[]).some(other=>other!==node&&other.type==='image'&&other.geometry&&near(other.geometry.width,g.width,g.width*.08)&&near(other.geometry.height,g.height,g.height*.08)
    &&(near(other.geometry.y,g.y,g.height*.25)||near(other.geometry.x,g.x,g.width*.25)));
}
export function replaceTemplateSourceRegion(project,slide,index,canvas,{keep=new Set()}={}) {
  const spec=project.templateFidelity?.slides?.[index];if(!spec||!canvas)return;
  // Include number badges/connectors attached to the old body column. Leaving
  // only their labels removed creates a misleading, orphaned diagram.
  const region=sourceRegion(project,index,canvas);
  for(const node of spec.nodes||[]) {
    const g=node.geometry,id=node.nativeRef?.shapeId,slot=spec.slots?.find(s=>s.shapeId===id);
    if(keep.has(id)){
      slide.templateOmissions=(slide.templateOmissions||[]).filter(item=>item.shapeId!==id||!item.automatic||!String(item.approvalBasis||'').startsWith('source_region_'));
      continue;
    }
    const classified=node.type==='image'?templateMediaRole(node,spec,project.templateFidelity):null;
    // Card icons belong to the card set this region replaces; left behind they
    // float over source text. A lone icon stays protected.
    const cardIcon=classified==='template_icon'&&cardSetIcon(node,spec),mediaRole=classified;
    if(protectedTemplateAsset(node)||node.type==='foreign'||node.nativeRef?.nestedMediaHashes?.length||['chart','table'].includes(node.type)||node.type==='image'&&!['template_decoration','template_artwork'].includes(mediaRole)&&!cardIcon||!g||id===undefined||['title','section'].includes(slot?.role)||slot?.purpose==='footnote'||node.semanticRole==='page-number'||node.content?.mediaReplacement)continue;
    const size=project.templateFidelity;
    if(g.width>=size.width*.85&&g.height>=size.height*.85)continue;
    const overlap=Math.max(0,Math.min(g.x+g.width,region.x+region.width)-Math.max(g.x,region.x))*Math.max(0,Math.min(g.y+g.height,region.y+region.height)-Math.max(g.y,region.y));
    if(overlap/Math.max(1,g.width*g.height)<.35)continue;
    {
      slide.templateOmissions||=[];const priorIndex=slide.templateOmissions.findIndex(o=>o.shapeId===id);const record={...adaptationDisposition(project,node,node.type==='image'?mediaRole:'old_template_content',node.type==='image'?mediaRole==='template_artwork'?'source_region_artwork_avoidance':cardIcon?'source_region_card_icon_avoidance':'source_region_decoration_avoidance':'source_region_replacement','Obsolete template foreground labels/artwork are retired for source-owned structures; this is not a media-equivalence claim.'),...(mediaRole==='template_artwork'||cardIcon?{replacementRegion:region,overlapRatio:overlap/(g.width*g.height)}:{})};
      if(priorIndex<0)slide.templateOmissions.push(record);else slide.templateOmissions[priorIndex]=record;
    }
  }
}
/** Native table body rows are exported on white (the header row uses the
 * accent fill with its own contrast colour), so resolve body text on white. */
function tableBodyColor(project,index){
  return templateTextColor(project,index,'body','#ffffff').color;
}
function headerColor(fill) {
  const hex = String(fill).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#242a3b';
  const linear = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return luminance < .179 ? '#ffffff' : '#111111';
}
export function bindSourceArtifacts(project, slide, refs, index, commentary = [], sourceEvidenceIds = []) {
  if (!Array.isArray(refs)) throw new Error('invalid source artifact refs');
  if (!refs.length && !commentary?.length && !sourceEvidenceIds.length) return slide;
  if (refs.length > 10) throw new Error('source artifact safety limit exceeded');
  const spec=project.templateFidelity?.slides?.[index];
  const items=project.source?.semantic?.inventory?.items||[];
  validateSourceArtifactRefs(items,refs);
  const permitted=new Set(project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id)?.sourceArtifacts?.map(item=>item.sourceUnitId)||[]);
  const contentIds=new Set(spec?.slots.filter(slot=>slot.role==='content').map(slot=>slot.shapeId)||[]);
  let components=refs.flatMap(ref=> {
    const item=items.find(value=>value.id===ref.sourceUnitId);
    if (!item||!permitted.has(item.id)) throw new Error('source artifact not assigned to this page');
    const assigned=project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id)?.sourceArtifacts?.filter(a=>a.sourceUnitId===item.id)||[];
    if(assigned.some(a=>a.rowStart!==undefined) && !assigned.some(a=>a.rowStart===(ref.rowStart??1) && a.rowEnd===(ref.rowEnd??item.rows?.length))) throw new Error('source artifact row range differs from page contract');
    return sourceComponentParts(item,ref).map(component=>{
    if(component.content.rows)component.content.rows=component.content.rows.map(row=>row.map(String));
    if(component.content.items)component.content.items=component.content.items.map((entry,n)=>({...entry,id:stableId('item',slide.id,item.id,(component.itemFragment?.itemStart||0)+n),...richTextContent(entry.richText?.source??entry.text)}));
    component.content=ensureRichContent(component.content);
    return {...component,item,ref};
    });
  });
  components.push(...lockedEvidenceComponents(project,sourceEvidenceIds,components));
  const copyTypes=new Set(['definition','mechanism','evidence','example','contrast','constraint','implication','stage','decision','next_step','support']);
  if (!Array.isArray(commentary) || commentary.length > 4 || commentary.some(value=>typeof value==='string'?value.length>2000:!value||typeof value.text!=='string'||value.text.length>2000||!copyTypes.has(value.type))) throw new Error(`invalid source commentary: ${JSON.stringify({count:commentary?.length,maxEntries:4,maxTextCharacters:2000,receivedTypes:Array.isArray(commentary)?commentary.map(value=>typeof value==='string'?'legacy_string':value?.type):null,allowedTypes:[...copyTypes]})}; merge related complete explanations into at most four typed entries without deleting necessary facts`);
  const visibleTexts=new Set(components.map(component=>clean(component.content.text || component.content.rows?.map(row=>row.join(' | ')).join('\n') || component.content.items?.map(item=>item.text).join('\n') || '').replace(/\s+/gu,' ').trim()));
  for(const entry of commentary) {
    const text=typeof entry==='string'?entry:entry.text;if(!text.trim())continue;
    const normalized=clean(text),key=normalized.replace(/\s+/gu,' ').trim();
    if(visibleTexts.has(key))continue;
    visibleTexts.add(key);components.push(...sourceExplanationComponents([text]).map(component=>({...component,content:{...component.content,pointType:typeof entry==='string'?'mechanism':entry.type}})));
  }
  components=prepareReadingComponents(items,components);
  const fit=fitComponents(components,project,index);
  if(!fit.capacity_ok){
    const sourceComponents=components.filter(component=>component.item||component.content.sourceEvidenceIds?.length);
    const sourceFit=sourceComponents.length?fitComponents(sourceComponents,project,index):{capacity_ok:true,usedHeight:0};
    throw new Error(`source_artifact_capacity: ${JSON.stringify({fontSizePt:fit.fontSizePt,availableHeightInches:fit.availableHeight/914400,usedHeightInches:fit.usedHeight/914400,predictedOverflowInches:fit.predictedOverflow/914400,sourceFits:sourceFit.capacity_ok,sourceHeightInches:sourceFit.usedHeight/914400,explanationBudget:explanationBudget(sourceComponents,project,index),boundSourceEvidenceIds:sourceEvidenceIds,commentaryEntries:commentary.length,commentaryCharacters:commentary.reduce((sum,value)=>sum+(typeof value==='string'?value:value.text).length,0)})}. Retain all frozen source cells, bound source excerpts and font. If sourceFits is true, the source is already portable: only rewrite commentary into complete concise relationships owned by this page, never repeat table/formula contents or bound excerpts or explain adjacent rows; do not change its row ranges or request an unnecessary split. Use the measured single-paragraph budget: merge related complete explanations into one or two entries without blank lines, removing only duplicate explanation, not source facts. Extra entries consume paragraph padding and gaps. With no bound source content, sourceCommentary IS the required visible body and cannot be empty. With bound source content already expressing all required facts, optional commentary may be empty.`);
  }
  // Keep the template's card artwork when the same components fit beside it,
  // and re-anchor card icons instead of retiring them (MD-P0-1, MD-P1-4).
  const keep=new Set(),movedIcons=[];
  let chosen=mediaPreservingFit(project,index,components,fit)||fit;
  for(const id of chosen.keptMediaShapeIds||[])keep.add(id);
  const anchored=chosen.componentInstances?null:anchorCardIcons(project,index,components,chosen,cardSetIcon);
  if(anchored){chosen=anchored.fit;for(const icon of anchored.icons){keep.add(icon.shapeId);for(const carrier of icon.carriers||[])keep.add(carrier.shapeId);movedIcons.push(icon);}}
  const primaryComponents=Boolean(chosen.componentInstances?.length);
  chosen=supplementaryNativeMedia(project,index,chosen);
  for(const id of chosen.keptMediaShapeIds||[])keep.add(id);
  const background=project.templateFidelity?.slides?.[index]?.background||project.templateSpec?.palette?.background||'#ffffff';
  // Source text uses the template's own colour for body text on this kind of
  // backdrop (never a forced black); the chosen rule is kept for review.
  const bodyColor=templateTextColor(project,index,'body');
  const nodes=components.map((component,position)=> {
    const {type,content,item,ref}=component;
    if(!item){
      const original=slide.copy?.blocks?.find(block=>clean(block.body)===clean(content.text));
      content.claimId=original?.claimId||stableId('claim',clean(content.text));
      if(original?.repeatPurpose)content.repeatPurpose=original.repeatPurpose;
      if(original?.claimId&&project.outline?.[index]?.repeatSourceUnitIds?.includes(original.claimId))content.repeatPurpose='recap';
    }
    const panelColor=chosen.panelFamily?chosen.panelColors[chosen.readingUnits.findIndex(u=>u.includes(position))]:null;
    const measurement=chosen.measurements[position];
    if(type==='table'){content.columnWeights=measurement.columnWeights;content.rowWeights=measurement.rowWeights;}
    return {id:stableId('node',slide.id,item?.id||'source-commentary',ref?.rowStart||position),type,
      semanticRole:item?'source-structure':'source-explanation',slotId:'absolute',geometry:chosen.boxes[position],content,
      ...(primaryComponents?{semanticComponentBinding:{unitIndex:chosen.readingUnits.findIndex(u=>u.includes(position)),sourceUnitIds:chosen.readingUnits.find(u=>u.includes(position))?.map(i=>components[i].item?.id).filter(Boolean)||[],relationship:'atomic source reading unit',textSlot:'native style, measured source-owned replacement'}}:{}),
      ...(item&&project.outline?.[index]?.repeatSourceUnitIds?.includes(item.id)?{repeatPurpose:'recap'}:{}),
      ...(item?{sourceArtifact:{sourceUnitId:item.id,type:item.type,rowStart:ref.rowStart,rowEnd:ref.rowEnd,...(component.itemFragment||{})},sourceRefs:item.source_ref}:{sourceRefs:slide.sourceRefs||[]}),
      style:{fontSizePt:chosen.fontSizePt,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,
        lineHeight:1.18,paragraphSpacingEm:type==='timeline'?.15:type==='list'?.4:0,
        ...(type==='table'?{tableHeaderColor:headerColor(project.templateSpec?.palette?.accent||'#e7e5f4')}:{}),
        color:panelColor?headerColor(panelColor):type==='table'?tableBodyColor(project,index):bodyColor.color,colorBasis:type==='table'?'template_table_body':bodyColor.basis,fill:panelColor|| (type==='table'?(project.templateSpec?.palette?.accent||'#e7e5f4'):background)},zIndex:500};
  });
  slide.sourceArtifactFit={...chosen,boxes:chosen.boxes,measurements:chosen.measurements};
  slide.sourceArtifactNodes=nodes;
  replaceTemplateSourceRegion(project,slide,index,chosen.canvas,{keep});
  slide.templateComponentClones=(chosen.componentInstances||[]).filter(n=>n.nativeRef.cloneFromShapeId!==undefined);
  for(const instance of chosen.componentInstances||[]){
    if(instance.nativeRef.cloneFromShapeId!==undefined)continue;
    const shapeId=instance.nativeRef.shapeId;
    slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(a=>a.shapeId!==shapeId),{shapeId,action:'whole_component_reflow',geometry:instance.geometry,componentBinding:instance.templateComponentBinding}];
  }
  for(const asset of chosen.mediaAdaptations||[]){
    const live=(slide.nodes||[]).find(node=>node.nativeRef?.shapeId===asset.shapeId);
    if(live)live.geometry={...asset.geometry};
    slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(item=>item.shapeId!==asset.shapeId),{shapeId:asset.shapeId,action:'scaled_artwork_rail',geometry:asset.geometry,originalGeometry:asset.originalGeometry,scale:asset.scale,basis:'same image bytes; contain aspect ratio; measured source fit and unchanged font'}];
  }
  for(const icon of movedIcons){
    for(const carrier of icon.carriers||[]){
      const live=(slide.nodes||[]).find(node=>node.nativeRef?.shapeId===carrier.shapeId);if(live)live.geometry={...carrier.geometry};
      slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(a=>a.shapeId!==carrier.shapeId),{shapeId:carrier.shapeId,action:'reanchored_table_row_icon_carrier',geometry:carrier.geometry,rowBinding:icon.rowBinding,scale:icon.badgeScale,basis:'Original badge/carrier and icon move with one uniform scale; original colour and image identity retained'}];
    }
    const live=(slide.nodes||[]).find(node=>node.nativeRef?.shapeId===icon.shapeId);
    if(live)live.geometry={...icon.geometry};
    slide.templateAdaptations=[...(slide.templateAdaptations||[]).filter(a=>a.shapeId!==icon.shapeId),{shapeId:icon.shapeId,action:icon.rowBinding?'reanchored_table_row_icon':'reanchored_card_icon',geometry:icon.geometry,...(icon.rowBinding?{rowBinding:icon.rowBinding}:{})}];
  }
  slide.bullets=[];
  slide.copy={...slide.copy,blocks:nodes.map(node=>({type:node.content.pointType||'evidence',heading:node.sourceArtifact?.type.replace('Block','')||'',body:node.type==='table'?node.content.rows.map(row=>row.join(' | ')).join('\n'):node.content.text||(node.content.items||[]).map(item=>item.text).join('\n')})),takeaway:'',subtitle:''};
  if (spec) {
    for (const id of contentIds) if (!slide.templateOmissions?.some(item=>item.shapeId===id)) {
      slide.templateOmissions ||= []; slide.templateOmissions.push({shapeId:id,reason:'Source structure replaces the original content region with editable source-owned objects.'});
    }
  }
  // Invisible duplicate body representations must not count as rendered depth.
  slide.nodes=(slide.nodes||[]).filter(node=>!isSourceOwnedNode(node)&&!['body','subtitle','takeaway'].includes(node.semanticRole));
  slide.nodes.push(...nodes); slide.nodeOrder=slide.nodes.map(node=>node.id);
  return slide;
}

/** Source images are independent obligations, including small equations/icons.
 * Refit the whole source region, rather than stretching every asset as a photo. */
export function bindSourceMedia(project,slide,imageIds,index) {
  if(!imageIds?.length)return slide;
  const images=imageIds.map(id=>{
    const image=project.source?.images?.find(item=>item.id===id);
    if(!image)throw new Error('unknown source image '+id);
    return {...image,type:'SourceImage'};
  });
  const existing=(slide.nodes||[]).filter(isSourceOwnedNode);
  const commentary=existing.length?[]:(slide.copy?.blocks||[]).map(block=>({type:'text',content:{text:block.body}}));
  const components=[...existing.map(node=>({type:node.type,content:node.content})),...commentary,...images.flatMap(sourceImageComponents)];
  const fit=fitComponents(components,project,index);
  if(!fit.capacity_ok)throw new Error('source_media_capacity: split this page without omitting the source images');
  const nodes=components.map((component,position)=>existing[position]?{...existing[position],geometry:fit.boxes[position]}:{
    id:stableId('node',slide.id,component.content.sourceImageId||component.content.sourceImageCaptionId||'media-commentary',position),type:component.type,
    semanticRole:component.type==='image'?'source-media':'source-explanation',slotId:'absolute',geometry:fit.boxes[position],content:component.content,
    ...(component.type==='image'?{sourceArtifact:{sourceUnitId:component.content.sourceImageId,type:'SourceImage'},sourceRefs:component.content.sourceRefs}:component.content.sourceImageCaptionId?{sourceArtifact:{sourceUnitId:component.content.sourceImageCaptionId,type:'SourceImageCaption'}}:{}),
    style:{fontSizePt:fit.fontSizePt,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,
      ...(()=>{const chosen=templateTextColor(project,index,'body');return {color:chosen.color,colorBasis:chosen.basis};})()},zIndex:500});
  const spec=project.templateFidelity?.slides?.[index];
  for(const slot of spec?.slots||[])if(slot.role==='content'&&!slide.templateOmissions?.some(o=>o.shapeId===slot.shapeId)){
    slide.templateOmissions||=[];slide.templateOmissions.push({shapeId:slot.shapeId,reason:'Source media and its explanation replace the original content region.'});
  }
  slide.nodes=(slide.nodes||[]).filter(node=>!isSourceOwnedNode(node)&&!['body','subtitle','takeaway'].includes(node.semanticRole));
  slide.nodes.push(...nodes);slide.sourceArtifactNodes=nodes;slide.nodeOrder=slide.nodes.map(node=>node.id);
  slide.bullets=[];slide.copy={...slide.copy,subtitle:'',takeaway:''};slide.sourceArtifactFit=fit;
  replaceTemplateSourceRegion(project,slide,index,fit.canvas);
  return slide;
}
