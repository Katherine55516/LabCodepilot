/** Source-owned editable structures. The model selects inventory IDs/row ranges,
 * never invents cells or supplies geometry. Capacity failure asks for split. */
import { stableId } from './ppt/ir.mjs';
import { templateVisualUnits } from './ppt-presentation-writing.mjs';
const INCH=914400;
import {sourceDisplayText} from './ppt-source-text.mjs';
export {sourceDisplayText} from './ppt-source-text.mjs';
const clean = sourceDisplayText;
export function bindSourceArtifacts(project, slide, refs, index) {
  if (!Array.isArray(refs) || !refs.length) return slide;
  if (refs.length>2) throw new Error('at most two source artifacts per page');
  const spec=project.templateFidelity?.slides?.[index];
  const items=project.source?.semantic?.inventory?.items||[];
  const permitted=new Set(project.planning?.slidePlan?.find(plan=>plan.slideId===slide.id)?.sourceArtifacts?.map(item=>item.sourceUnitId)||[]);
  const contentIds=new Set(spec?.slots.filter(slot=>slot.role==='content').map(slot=>slot.shapeId)||[]);
  const frames=spec?.nodes.filter(node=>contentIds.has(node.nativeRef?.shapeId))||[];
  // Preserve title/navigation/style and create a bounded content canvas using
  // the native body's vertical region; decorative artwork remains untouched.
  const size=project.templateFidelity || {width:12192000,height:6858000};
  const y=Math.max(size.height*.25,Math.min(...frames.map(node=>node.geometry.y),size.height*.25));
  const canvas={x:Math.round(size.width*.065),y:Math.round(y),width:Math.round(size.width*.87),height:Math.round(size.height*.68)};
  const fontSizePt=Math.max(14,Math.min(...frames.filter(node=>(node.style?.fontWeight||400)<600).map(node=>node.style?.fontSizePt||18),18));
  const parallelColumns = refs.length>1 && refs.every(ref=>['ChecklistBlock','ProcessBlock'].includes(items.find(item=>item.id===ref.sourceUnitId)?.type));
  const baseUnits=canvas.width/INCH*72/fontSizePt*1.5;
  const estimateRef=ref=>{
    const item=items.find(item=>item.id===ref.sourceUnitId); if(!item)return 1;
    if(item.type==='TableBlock') {
      const rows=[item.rows[0],...item.rows.slice(ref.rowStart||1,ref.rowEnd||item.rows.length)];
      const weights=rows[0].map((_,col)=>Math.max(12,...rows.map(row=>Math.sqrt(templateVisualUnits(clean(row[col])))*4)));
      const total=weights.reduce((a,b)=>a+b,0);
      return rows.reduce((sum,row)=>sum+Math.max(...row.map((cell,col)=>Math.ceil(templateVisualUnits(clean(cell))/(baseUnits*weights[col]/total))||1))+.35,0);
    }
    return Math.max(1,Math.ceil(templateVisualUnits(clean(item.text))/baseUnits));
  };
  const heightWeights=refs.map(estimateRef), heightSum=heightWeights.reduce((a,b)=>a+b,0);
  const nodes=refs.map((ref,position)=> {
    const item=items.find(value=>value.id===ref.sourceUnitId);
    if (!item||!permitted.has(item.id)) throw new Error('source artifact not assigned to this page');
    let type='text', content={text:clean(item.text)};
    if (item.type==='TableBlock') {
      const start=ref.rowStart===undefined?1:Number(ref.rowStart), end=ref.rowEnd===undefined?item.rows.length:Number(ref.rowEnd);
      if (!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<=start||end>item.rows.length) throw new Error('invalid source table row range');
      type='table'; content={rows:[item.rows[0],...item.rows.slice(start,end)].map(row=>row.map(clean))};
    } else if (item.type==='ChecklistBlock') {
      type='list'; content={items:item.text.split('\n').filter(line=>/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)).map((line,n)=>({id:stableId('item',slide.id,item.id,n),text:clean(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/,''))}))};
    } else if (item.type==='ProcessBlock') {
      type='timeline'; content={items:clean(item.text).split(/(?:->|→)/u).map((text,n)=>({id:stableId('item',slide.id,item.id,n),text:text.trim()}))};
    }
    const geometry=parallelColumns ? {...canvas,x:Math.round(canvas.x+position*canvas.width/refs.length),width:Math.round(canvas.width/refs.length*.96)} : {...canvas,y:Math.round(canvas.y+heightWeights.slice(0,position).reduce((a,b)=>a+b,0)*canvas.height/heightSum),height:Math.round(canvas.height*heightWeights[position]/heightSum)};
    const lineUnits=geometry.width/INCH*72/fontSizePt*1.5;
    const weights=type==='table'?content.rows[0].map((_,col)=>Math.max(12,...content.rows.map(row=>Math.sqrt(templateVisualUnits(row[col]))*4))):[];
    if(type==='table')content.columnWeights=weights;
    const weightSum=weights.reduce((sum,w)=>sum+w,0);
    if(type==='table')content.rowWeights=content.rows.map(row=>Math.max(...row.map((cell,col)=>Math.ceil(templateVisualUnits(cell)/(lineUnits*weights[col]/weightSum)) || 1))+.35);
    const lines=type==='table'?content.rowWeights.reduce((sum,w)=>sum+w,0)
      :type==='list'||type==='timeline'?content.items.reduce((sum,item)=>sum+Math.ceil(templateVisualUnits(item.text)/lineUnits)+.4,0)
      :Math.ceil(templateVisualUnits(content.text)/lineUnits);
    if (lines*fontSizePt*1.18>geometry.height/INCH*72) throw new Error(`source_artifact_capacity: ${item.id} needs split; retain font ${fontSizePt}pt and all cells`);
    return {id:stableId('node',slide.id,item.id,ref.rowStart||0),type,semanticRole:'source-structure',slotId:'absolute',geometry,content,
      sourceArtifact:{sourceUnitId:item.id,type:item.type,rowStart:ref.rowStart,rowEnd:ref.rowEnd},sourceRefs:item.source_ref,style:{fontSizePt,fontFamily:project.templateSpec?.fonts?.body,eastAsiaFontFamily:project.templateSpec?.fonts?.bodyEastAsia,color:'#242a3b',fill:type==='table'?(project.templateSpec?.palette?.accent||'#e7e5f4'):'#ffffff'},zIndex:500};
  });
  slide.sourceArtifactNodes=nodes;
  slide.bullets=[];
  slide.copy={...slide.copy,blocks:nodes.map(node=>({type:'evidence',heading:node.sourceArtifact.type.replace('Block',''),body:node.type==='table'?node.content.rows.map(row=>row.join(' | ')).join('\n'):node.content.text||(node.content.items||[]).map(item=>item.text).join('\n')})),takeaway:'',subtitle:''};
  if (spec) {
    for (const id of contentIds) if (!slide.templateOmissions?.some(item=>item.shapeId===id)) {
      slide.templateOmissions ||= []; slide.templateOmissions.push({shapeId:id,reason:'Source structure replaces the original content region with editable source-owned objects.'});
    }
  }
  // Invisible duplicate body representations must not count as rendered depth.
  slide.nodes=slide.nodes.filter(node=>!['body','subtitle','takeaway'].includes(node.semanticRole));
  slide.nodes.push(...nodes); slide.nodeOrder=slide.nodes.map(node=>node.id);
  return slide;
}
