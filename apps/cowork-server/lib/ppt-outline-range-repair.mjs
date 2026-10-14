import {outlineError} from './ppt-outline-protocol.mjs';
import {compileContentSelection,selectionSource} from './ppt-content-selection.mjs';
import {validateSourceArtifactRefs} from './ppt-density-capacity.mjs';
function scopes(project,raw,error){
 if(raw?.version!==2||!error?.details?.artifactRangeConflicts?.length)return [];
 const ledger=compileContentSelection(project,raw),items=selectionSource(project,ledger)?.semantic?.inventory?.items||[],out=[];
 for(const conflict of error.details.artifactRangeConflicts){const page=raw.slides[conflict.pageIndex];for(const [rangeIndex,ref]of(page?.sourceArtifactRanges||[]).entries()){
  const item=items.find(i=>i.id===ref.sourceUnitId);if(!item?.rows)return [];
  try{validateSourceArtifactRefs(items,[ref]);}catch{out.push({pageIndex:conflict.pageIndex,rangeIndex,sourceUnitId:ref.sourceUnitId,oldRange:ref,rowCount:item.rows.length,rows:item.rows,sourceCellMap:item.derivedSummary?.sourceCellMap||ledger?.entries.find(e=>e.sourceUnitId===ref.sourceUnitId)?.sourceCellMap});}
 }}return out;
}
export function outlineRangeRepairPrompt(project,raw,error){const bad=scopes(project,raw,error);if(!bad.length)return null;
 const branch=s=>({type:'object',additionalProperties:false,required:['pageIndex','rangeIndex','rowStart','rowEnd'],properties:{pageIndex:{type:'integer',const:s.pageIndex},rangeIndex:{type:'integer',const:s.rangeIndex},rowStart:{type:'integer',minimum:1,maximum:s.rowCount-1},rowEnd:{type:'integer',minimum:2,maximum:s.rowCount}}});
 const schema={type:'object',additionalProperties:false,required:['version','updates'],properties:{version:{type:'integer',const:2},updates:{type:'array',minItems:bad.length,maxItems:bad.length,items:{anyOf:bad.map(branch)}}}};
 return `Repair ONLY the listed invalid table intervals. Use CURRENT rendered table row positions: header 0; rowStart inclusive, rowEnd EXCLUSIVE, 1 <= rowStart < rowEnd <= rowCount. For a summary, row positions index selected rows, not the original source rowIndices. The sourceCellMap connects them. Preserve every selected data row in the union of this table's existing fragments, with no duplicate data or missing selected tail. Do not change selection, cells, source IDs, page ownership, title, focus or page count. The code rechecks interval bounds, ownership, complete selected-row coverage and physical capacity. Return one update for every listed interval, no others.\n<invalid_intervals>${JSON.stringify(bad)}</invalid_intervals>\n<all_current_fragments>${JSON.stringify(raw.slides.flatMap((p,pageIndex)=>(p.sourceArtifactRanges||[]).filter(r=>bad.some(s=>s.sourceUnitId===r.sourceUnitId)).map(r=>({pageIndex,title:p.title,...r}))))}</all_current_fragments>\nJSON Artifact Range Delta Schema v2=${JSON.stringify(schema)}`;
}
export function applyOutlineRangeRepair(project,raw,error,delta){const bad=scopes(project,raw,error),seen=new Set();if(!bad.length||delta?.version!==2||!Array.isArray(delta.updates)||delta.updates.length!==bad.length)throw outlineError('schema_invalid');const next=structuredClone(raw);
 for(const u of delta.updates){const key=u?.pageIndex+':'+u?.rangeIndex,s=bad.find(s=>s.pageIndex===u?.pageIndex&&s.rangeIndex===u?.rangeIndex);if(!s||seen.has(key)||Object.keys(u).some(k=>!['pageIndex','rangeIndex','rowStart','rowEnd'].includes(k))||!Number.isInteger(u.rowStart)||!Number.isInteger(u.rowEnd)||u.rowStart<1||u.rowStart>=u.rowEnd||u.rowEnd>s.rowCount)throw outlineError('schema_invalid');seen.add(key);const old=next.slides[u.pageIndex].sourceArtifactRanges[u.rangeIndex];next.slides[u.pageIndex].sourceArtifactRanges[u.rangeIndex]={...old,rowStart:u.rowStart,rowEnd:u.rowEnd};}
 return next;
}
