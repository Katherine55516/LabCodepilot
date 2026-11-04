import {operationHistory} from './ppt/command-history.mjs';
/** Imported artwork starts locked by default. A user's explicit lock is a
 * different constraint, recoverable from the committed command journal.
 * Follow undo/redo as well; an unlocked node is never in this set. */
export function explicitLayoutLocks(project,history){
 const rows=history??(project.uid&&/^[a-f0-9]{32}$/iu.test(project.id||'')?operationHistory(project.uid,project.id):[]);
 const active=[];
 for(const row of rows){
  if(row.kind==='undo'){const at=active.findIndex(item=>item.id===row.targetOperationId);if(at>=0)active.splice(at,1);}
  else if(row.kind==='redo'){const at=active.findIndex(item=>item.id===row.targetOperationId);if(at>=0)active.splice(at,1);active.push(row);}
  else active.push(row);
 }
 const touched=new Set(active.filter(row=>row.command?.type==='node.setLocked').map(row=>row.command.payload?.nodeId));
 return new Set((project.deck?.slides||[]).flatMap(slide=>(slide.nodes||[]).filter(node=>node.locked&&(node.userLocked||touched.has(node.id))).map(node=>node.id)));
}
