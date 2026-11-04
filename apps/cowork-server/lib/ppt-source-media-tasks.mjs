/** Native source media uses deterministic composition, not image-model jobs.
 * Task identities include immutable ranges/relations; component commits supply
 * the run/epoch/revision lease. No second content or geometry model. */
import {digest}from'./ppt/edit-context.mjs';
import{chooseTableDiagram,diagramCoverage}from'./ppt-diagram-cards.mjs';
export function sourceMediaTasks(source,plan){
 const inventory=source?.semantic?.inventory,items=inventory?.items||[];
 return (plan.sourceArtifacts||[]).flatMap(ref=>{
  const item=items.find(i=>i.id===ref.sourceUnitId);if(!item||!item.rows&&!item.diagramSource&&!['ProcessBlock','CodeBlock','ChecklistBlock','TaxonomyBlock','EquationBlock'].includes(item.type))return [];
  const componentType=item.diagramSource?.graph?'source-relations':item.rows?chooseTableDiagram(item)||'table':item.type==='ProcessBlock'?'ordered-process':item.type==='CodeBlock'?'literal-code':'structured-list';
  const relationIds=(inventory.relationships||[]).filter(r=>r.unitIds?.includes(item.id)).map(r=>r.id);
  const selection={sourceUnitId:item.id,...Object.fromEntries(['rowStart','rowEnd','lineStart','lineEnd'].filter(k=>ref[k]!==undefined).map(k=>[k,ref[k]]))};
  return [{id:'source_media_'+digest({source:source.sha256,slideId:plan.slideId,selection,relationIds}).slice(0,24),version:1,purpose:'source_derived',required:true,sourceIds:[item.id],relationIds,selection,componentType,regionPolicy:'measured_template_body',status:'planned'}];
 });
}
export function sourceMediaReceipts(project,slide){
 const tasks=project.planning?.slidePlan?.find(p=>p.slideId===slide.id)?.mediaTasks||[];
 return tasks.map(task=>{
  const nodes=(slide.sourceArtifactNodes||[]).filter(n=>n.sourceArtifact?.sourceUnitId===task.selection.sourceUnitId&&['rowStart','rowEnd','lineStart','lineEnd'].every(k=>task.selection[k]===undefined||n.sourceArtifact[k]===task.selection[k]));
  const item=(project.source?.semantic?.inventory?.items||[]).find(i=>i.id===task.selection.sourceUnitId);
  const verified=nodes.every(n=>!n.content?.diagram||item&&diagramCoverage(item,n).complete);
  const relationBindings=nodes.flatMap(n=>(n.content?.diagram?.relational?.edges||[]).map(e=>({sourceEdgeId:e.sourceEdgeId,nodeId:n.id,from:n.content.items[e.from]?.sourceNodeId,to:n.content.items[e.to]?.sourceNodeId})));
  const componentType=nodes[0]?.content?.diagram?.kind||nodes[0]?.type||task.componentType;
  const requested=task.componentType,representationFulfilled=nodes.length>0&&verified&&(requested==='source-relations'?nodes.some(n=>n.content?.diagram?.relational):requested==='symbolic-interval'?nodes.some(n=>n.content?.diagram?.kind==='symbolic-interval'&&n.content.diagram.relational?.intervalCount>=3):requested==='ordered-process'?nodes.some(n=>n.type==='timeline'||n.content?.processCards):true);
  return {...task,requestedComponentType:requested,representationFulfilled,componentType,...(!representationFulfilled?{representationFallback:{requested,actual:componentType,reason:'measured capacity or a confirmed partial source range'}}:{}),relationBindings,status:nodes.length&&verified&&slide.sourceArtifactFit?.capacity_ok?(representationFulfilled?'ready':'needs_review'):'blocked',nodeIds:nodes.map(n=>n.id),resultHash:digest(nodes),sourceHash:project.source?.sha256,runId:project.currentRunId,epoch:Number(project.editing?.epochs?.[slide.id]||0),revision:project.revision,styleHash:digest({fonts:project.templateSpec?.fonts,palette:project.templateSpec?.palette}),basis:'actual source binding; object/relationship and render gates remain authoritative'};
 });
}
