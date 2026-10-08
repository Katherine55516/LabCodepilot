/** Source-owned editable structures. The model selects inventory IDs/row ranges,
 * never invents cells or supplies geometry. Capacity failure asks for split. */
import { stableId } from './ppt/ir.mjs';
import { fitComponents, sourceComponent, sourceImageComponents, validateSourceArtifactRefs } from './ppt-density-capacity.mjs';
import {sourceDisplayText} from './ppt-source-text.mjs';
export {sourceDisplayText} from './ppt-source-text.mjs';
const clean = sourceDisplayText;
// Absolute source-owned explanations have no inventory artifact ID, but must
// survive the same preview and export paths as the referenced structures.
export const isSourceOwnedNode = node => Boolean(node.sourceArtifact || node.semanticRole === 'source-explanation');
export function sourceExplanationComponents(texts) {
  return texts.flatMap(text=>String(text).split(/\n\s*\n/u).filter(part=>part.trim()).map(text=>({type:'text',content:{text}})));
}
/** Replace obsolete foreground diagrams in a rebuilt source region. Keep the
 * title/footer, full canvas artwork and photos outside that region. */
export function replaceTemplateSourceRegion(project,slide,index,canvas) {
  const spec=project.templateFidelity?.slides?.[index];if(!spec||!canvas)return;
  const headerBottom=Math.max(0,...(spec.nodes||[]).filter(n=>spec.slots?.some(s=>s.shapeId===n.nativeRef?.shapeId&&['title','section'].includes(s.role))).map(n=>n.geometry.y+n.geometry.height));
  const titleLeft=Math.min(canvas.x,...(spec.nodes||[]).filter(n=>spec.slots?.some(s=>s.shapeId===n.nativeRef?.shapeId&&s.role==='title')).map(n=>n.geometry.x));
  // Include number badges/connectors attached to the old body column. Leaving
  // only their labels removed creates a misleading, orphaned diagram.
  const region={...canvas,x:titleLeft,width:canvas.x+canvas.width-titleLeft,y:Math.min(canvas.y,headerBottom+91440)};region.height=canvas.y+canvas.height-region.y;
  for(const node of spec.nodes||[]) {
    const g=node.geometry,id=node.nativeRef?.shapeId,slot=spec.slots?.find(s=>s.shapeId===id);
    if(!g||id===undefined||['title','section'].includes(slot?.role)||slot?.purpose==='footnote'||node.semanticRole==='page-number'||node.content?.mediaReplacement)continue;
    const size=project.templateFidelity;
    if(g.width>=size.width*.85&&g.height>=size.height*.85)continue;
    const overlap=Math.max(0,Math.min(g.x+g.width,region.x+region.width)-Math.max(g.x,region.x))*Math.max(0,Math.min(g.y+g.height,region.y+region.height)-Math.max(g.y,region.y));
    if(overlap/Math.max(1,g.width*g.height)<.35)continue;
    if(!slide.templateOmissions?.some(o=>o.shapeId===id)){
      slide.templateOmissions||=[];slide.templateOmissions.push({shapeId:id,automatic:true,approvalBasis:'source_region_replacement',role:'old_template_content',disposition:'replaced_equivalent',
        reason:'The original foreground diagram or label is replaced by complete, editable source-owned content in the same content region.'});
    }
  }
}
function headerColor(fill) {
  const hex = String(fill).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#242a3b';
  const linear = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return luminance < .179 ? '#ffffff' : '#111111';
}
export function bindSourceArtifacts(project, slide, refs, index, commentary = []) {
  if (!Array.isArray(refs)) throw new Error('invalid source artifact refs');
  if (!refs.length && !commentary?.length) return slide;
  if (refs.length > 10) throw new Error('source artifact safety limit exceeded');
  const spec=project.templateFidelity?.slides?.[index];
  const items=project.source?.semantic?.inventory?.items||[];
  validateSourceArtifactRefs(items,refs);
  const permitted=new Set(project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id)?.sourceArtifacts?.map(item=>item.sourceUnitId)||[]);
  const contentIds=new Set(spec?.slots.filter(slot=>slot.role==='content').map(slot=>slot.shapeId)||[]);
  const components=refs.map(ref=> {
    const item=items.find(value=>value.id===ref.sourceUnitId);
    if (!item||!permitted.has(item.id)) throw new Error('source artifact not assigned to this page');
    const assigned=project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id)?.sourceArtifacts?.filter(a=>a.sourceUnitId===item.id)||[];
    if(assigned.some(a=>a.rowStart!==undefined) && !assigned.some(a=>a.rowStart===(ref.rowStart??1) && a.rowEnd===(ref.rowEnd??item.rows?.length))) throw new Error('source artifact row range differs from page contract');
    const component=sourceComponent(item,ref);
    if(component.content.rows)component.content.rows=component.content.rows.map(row=>row.map(clean));
    if(component.content.items)component.content.items=component.content.items.map((entry,n)=>({...entry,id:stableId('item',slide.id,item.id,n),text:clean(entry.text)}));
    if(component.content.text && !component.content.mathMl)component.content.text=clean(component.content.text);
    return {...component,item,ref};
  });
  if (!Array.isArray(commentary) || commentary.length > 4 || commentary.some(value=>typeof value!=='string'||value.length>2000)) throw new Error('invalid source commentary');
  const visibleTexts=new Set(components.map(component=>clean(component.content.text || component.content.rows?.map(row=>row.join(' | ')).join('\n') || component.content.items?.map(item=>item.text).join('\n') || '').replace(/\s+/gu,' ').trim()));
  for(const text of commentary.filter(value=>value.trim())) {
    const normalized=clean(text),key=normalized.replace(/\s+/gu,' ').trim();
    if(visibleTexts.has(key))continue;
    visibleTexts.add(key);components.push(...sourceExplanationComponents([normalized]));
  }
  const fit=fitComponents(components,project,index);
  if(!fit.capacity_ok)throw new Error(`source_artifact_capacity: needs split; retain font ${fit.fontSizePt}pt and all cells`);
  const background=project.templateSpec?.palette?.background||'#ffffff';
  const foreground=headerColor(background);
  const nodes=components.map((component,position)=> {
    const {type,content,item,ref}=component;
    if(!item){
      const original=slide.copy?.blocks?.find(block=>clean(block.body)===clean(content.text));
      content.claimId=original?.claimId||stableId('claim',clean(content.text));
      if(original?.repeatPurpose)content.repeatPurpose=original.repeatPurpose;
    }
    const measurement=fit.measurements[position];
    if(type==='table'){content.columnWeights=measurement.columnWeights;content.rowWeights=measurement.rowWeights;}
    return {id:stableId('node',slide.id,item?.id||'source-commentary',ref?.rowStart||position),type,
      semanticRole:item?'source-structure':'source-explanation',slotId:'absolute',geometry:fit.boxes[position],content,
      ...(item?{sourceArtifact:{sourceUnitId:item.id,type:item.type,rowStart:ref.rowStart,rowEnd:ref.rowEnd},sourceRefs:item.source_ref}:{sourceRefs:slide.sourceRefs||[]}),
      style:{fontSizePt:fit.fontSizePt,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,
        lineHeight:1.18,paragraphSpacingEm:['list','timeline'].includes(type)?.4:0,
        ...(type==='table'?{tableHeaderColor:headerColor(project.templateSpec?.palette?.accent||'#e7e5f4')}:{}),
        color:type==='table'?'#111111':foreground,fill:type==='table'?(project.templateSpec?.palette?.accent||'#e7e5f4'):background},zIndex:500};
  });
  slide.sourceArtifactFit={...fit,boxes:fit.boxes,measurements:fit.measurements};
  slide.sourceArtifactNodes=nodes;
  replaceTemplateSourceRegion(project,slide,index,fit.canvas);
  slide.bullets=[];
  slide.copy={...slide.copy,blocks:nodes.map(node=>({type:'evidence',heading:node.sourceArtifact?.type.replace('Block','')||'',body:node.type==='table'?node.content.rows.map(row=>row.join(' | ')).join('\n'):node.content.text||(node.content.items||[]).map(item=>item.text).join('\n')})),takeaway:'',subtitle:''};
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
      color:project.templateSpec?.palette?.foreground},zIndex:500});
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
