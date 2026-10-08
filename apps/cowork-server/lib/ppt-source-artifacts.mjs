/** Source-owned editable structures. The model selects inventory IDs/row ranges,
 * never invents cells or supplies geometry. Capacity failure asks for split. */
import { stableId } from './ppt/ir.mjs';
import { fitComponents, sourceComponent, validateSourceArtifactRefs } from './ppt-density-capacity.mjs';
import {sourceDisplayText} from './ppt-source-text.mjs';
export {sourceDisplayText} from './ppt-source-text.mjs';
const clean = sourceDisplayText;
// Absolute source-owned explanations have no inventory artifact ID, but must
// survive the same preview and export paths as the referenced structures.
export const isSourceOwnedNode = node => Boolean(node.sourceArtifact || node.semanticRole === 'source-explanation');
function headerColor(fill) {
  const hex = String(fill).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#242a3b';
  const linear = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return luminance < .179 ? '#ffffff' : '#111111';
}
export function bindSourceArtifacts(project, slide, refs, index, commentary = []) {
  if (!Array.isArray(refs) || !refs.length) return slide;
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
    if(component.content.text)component.content.text=clean(component.content.text);
    return {...component,item,ref};
  });
  if (!Array.isArray(commentary) || commentary.length > 4 || commentary.some(value=>typeof value!=='string'||value.length>2000)) throw new Error('invalid source commentary');
  for(const text of commentary.filter(value=>value.trim()))components.push({type:'text',content:{text:clean(text)}});
  const fit=fitComponents(components,project,index);
  if(!fit.capacity_ok)throw new Error(`source_artifact_capacity: needs split; retain font ${fit.fontSizePt}pt and all cells`);
  const nodes=components.map((component,position)=> {
    const {type,content,item,ref}=component;
    const measurement=fit.measurements[position];
    if(type==='table'){content.columnWeights=measurement.columnWeights;content.rowWeights=measurement.rowWeights;}
    return {id:stableId('node',slide.id,item?.id||'source-commentary',ref?.rowStart||position),type,
      semanticRole:item?'source-structure':'source-explanation',slotId:'absolute',geometry:fit.boxes[position],content,
      ...(item?{sourceArtifact:{sourceUnitId:item.id,type:item.type,rowStart:ref.rowStart,rowEnd:ref.rowEnd},sourceRefs:item.source_ref}:{sourceRefs:slide.sourceRefs||[]}),
      style:{fontSizePt:fit.fontSizePt,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,
        lineHeight:1.18,paragraphSpacingEm:['list','timeline'].includes(type)?.4:0,
        ...(type==='table'?{tableHeaderColor:headerColor(project.templateSpec?.palette?.accent||'#e7e5f4')}:{}),
        color:'#242a3b',fill:type==='table'?(project.templateSpec?.palette?.accent||'#e7e5f4'):'#ffffff'},zIndex:500};
  });
  slide.sourceArtifactFit={...fit,boxes:fit.boxes,measurements:fit.measurements};
  slide.sourceArtifactNodes=nodes;
  slide.bullets=[];
  slide.copy={...slide.copy,blocks:nodes.map(node=>({type:'evidence',heading:node.sourceArtifact?.type.replace('Block','')||'',body:node.type==='table'?node.content.rows.map(row=>row.join(' | ')).join('\n'):node.content.text||(node.content.items||[]).map(item=>item.text).join('\n')})),takeaway:'',subtitle:''};
  if (spec) {
    for (const id of contentIds) if (!slide.templateOmissions?.some(item=>item.shapeId===id)) {
      slide.templateOmissions ||= []; slide.templateOmissions.push({shapeId:id,reason:'Source structure replaces the original content region with editable source-owned objects.'});
    }
  }
  // Invisible duplicate body representations must not count as rendered depth.
  slide.nodes=slide.nodes.filter(node=>!isSourceOwnedNode(node)&&!['body','subtitle','takeaway'].includes(node.semanticRole));
  slide.nodes.push(...nodes); slide.nodeOrder=slide.nodes.map(node=>node.id);
  return slide;
}
