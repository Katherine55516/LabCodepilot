/** Test fixture: the state the retired source-graph audit used to record
 * (lib/ppt-source-graph-audit.mjs, removed with the old outline flow). A test
 * that renders a certified relational diagram, or its literal fallback, sets
 * that state directly; the code that reads it (object integrity, review
 * structure, page planning) is still production code. */
import {graphProjectionIdentity} from '../lib/ppt-ascii-graph.mjs';
import {buildRelations} from '../lib/ppt-semantic-relations.mjs';
export function auditSourceGraphs(project,{equivalent=true}={}){
 const inventory=project.source?.semantic?.inventory;if(!inventory)return project;
 for(const item of [...inventory.items].filter(i=>i.diagramSource?.presentation==='semantic_graph_rows')){
  const identity=graphProjectionIdentity(item);
  project.sourceGraphAudits={...project.sourceGraphAudits,[item.id]:{version:1,identity,status:equivalent?'accepted':'literal_fallback',result:{version:1,equivalent,missingLabels:[],missingConnections:[],unsupportedConnections:[],reason:'test fixture'},auditedAt:new Date(0).toISOString()}};
  if(equivalent)continue;
  const {graph,...drawing}=item.diagramSource,{rows,...original}=item;
  const fallback={...original,type:'ComparisonBlock',semanticRole:'comparison',text:drawing.text,diagramSource:{...drawing,relation:drawing.originalRelation||'branching',presentation:'literal_source_lines'}};
  const replace=inv=>{const items=inv.items.map(i=>i.id===item.id?structuredClone(fallback):i);return {...inv,items,relationships:buildRelations(items)};};
  project.source={...project.source,semantic:{...project.source.semantic,inventory:replace(project.source.semantic.inventory)}};
  if(project.originalSourceInventory)project.originalSourceInventory=replace(project.originalSourceInventory);
 }
 return project;
}
