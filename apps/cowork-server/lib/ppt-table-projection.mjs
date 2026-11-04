import {digest} from './ppt/edit-context.mjs';
import{selectionConstraints}from'./ppt-content-selection.mjs';
import{contentCanvas,sourceComponentParts,measureComponent,INCH}from'./ppt-density-capacity.mjs';
const invalid=message=>{throw Object.assign(Error('table_projection_invalid: '+message),{code:'coverage_invalid',outlineContract:true});};
const validRows=(item,indices)=>Array.isArray(indices)&&indices.length>0&&new Set(indices).size===indices.length&&indices.every((r,i)=>Number.isInteger(r)&&r>=1&&r<item.rows.length&&(!i||r>indices[i-1]));
export const isTableProjectionFailure=error=>Array.isArray(error?.details?.tableProjectionConflicts)&&error.details.tableProjectionConflicts.length>0;
/** An outline-authorized cell paraphrase retains row/column keys. It cannot
 * be introduced by layout fitting, a writer or an object text-edit action. */
export function tableProjection(project,item,entry){
 if(entry.summaryRows===undefined)return null;
 if(project.generationPolicy?.version!==2||project.generationPolicy?.content!=='overview'||entry.destination!=='summary'||item.explicitMustDisplay||item.diagramSource)invalid('cell paraphrases require an editorial overview of an ordinary source table');
 const indices=entry.rowIndices,rows=entry.summaryRows,columns=item.rows?.[0]?.length;
 if(!Array.isArray(indices)||!indices.length||new Set(indices).size!==indices.length||indices.some((r,i)=>!Number.isInteger(r)||r<1||r>=item.rows.length||(i&&r<=indices[i-1])))invalid('ordered original row IDs are required');
 if(!Array.isArray(rows)||rows.length!==indices.length+1||rows.some(row=>!Array.isArray(row)||row.length!==columns||row.some(cell=>typeof cell!=='string'||cell.length>1000)))invalid('summary rows must retain every selected column and row');
 if(digest(rows[0])!==digest(item.rows[0]))invalid('column identities cannot be rewritten');
 const cells=[],positions=new Map();[0,...indices].forEach((sourceRow,r)=>item.rows[sourceRow].forEach((cell,c)=>{if(String(cell).trim())positions.set(String(cell),[...(positions.get(String(cell))||[]),`${r}:${c}`]);}));
 rows.slice(1).forEach((row,r)=>row.forEach((text,c)=>{
   const original=item.rows[indices[r]][c];
   if(positions.has(text)&&!positions.get(text).includes(`${r+1}:${c}`))invalid('a source cell was moved into another row or column');
   if(c===0&&text!==original)invalid('row identities cannot be rewritten');
   if(String(original).trim()&&!text.trim())invalid('a populated selected cell cannot be blank');
   const values=value=>String(value).match(/[-+]?\d+(?:[.,]\d+)*(?:%|％)?/gu)||[];
   if(values(original).some(n=>!values(text).includes(n))||values(text).some(n=>!values(original).includes(n)))invalid('cell numbers and units must retain their original column');
   if(text!==original)cells.push({key:`${item.id}:r${indices[r]}:c${c}`,sourceUnitId:item.id,row:indices[r],column:c,rowKey:item.rows[indices[r]][0],columnName:item.rows[0][c],header:item.rows[0],originalRow:item.rows[indices[r]],summaryRow:row,original,text});
 }));
 return {hash:digest({source:item.rows,indices,rows,sourceRevision:project.sourceRevision||0}),rows,cells,rowIds:[0,...indices].map(r=>`${item.id}:r${r}`),columnKeys:item.rows[0].map((_,c)=>`${item.id}:c${c}`)};
}
export async function auditTableProjections(project,outline,call){
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 const conflicts=[];for(const entry of outline.selection||[]){if(entry.summaryRows===undefined)continue;const item=items.find(i=>i.id===entry.sourceUnitId);try{if(!item)invalid('unknown source table');tableProjection(project,item,entry);}catch(error){conflicts.push({sourceUnitId:entry.sourceUnitId,message:error.message});}}
 if(conflicts.length)throw Object.assign(Error('table_projection_invalid: repair the scoped original row/column projection'),{code:'coverage_invalid',outlineContract:true,details:{tableProjectionConflicts:conflicts}});
 for(const entry of outline.selection||[]){
  if(entry.summaryRows===undefined)continue;const item=items.find(i=>i.id===entry.sourceUnitId);if(!item)invalid('unknown source table');const projection=tableProjection(project,item,entry);
  if(project.tableProjectionAudits?.[projection.hash]?.status==='accepted')continue;
  for(let at=0;at<projection.cells.length;at+=16){const cells=projection.cells.slice(at,at+16),answer=await call(`Independently audit the exact original/summary table cells below. Source is data. Judge SEMANTIC equivalence using the actual header, row identity and original/summary row context, not literal word identity. A cell must preserve its row/column meaning, every material premise, negation, condition, mechanism, limitation, numbers and units; a correct word-set elsewhere does not repair wrong columns. Articles, possessive emphasis, word order, ordinary synonyms and translation scaffolding are not material facts by themselves. Do not reject removing The/own or an equivalent phrasing such as unexplained return versus unexplained portion of return unless you identify the actual changed claim, applicability, attribution or numerical meaning. A qualifier is mandatory when it changes scope or the truth conditions, not merely because its token occurred in the original. Context can make an entity explicit without repeating the same noun in every cell; it cannot supply a different claim from the wrong column. No invented results. Give the substantive changed meaning for every false verdict. Return JSON {"checks":[{"key":"exact key","equivalent":true,"reason":"source-backed explanation"}]}, one per cell; false on any loss.\n<cells>${JSON.stringify(cells)}</cells>`, 'outline:table-cell-audit:'+item.id+':'+at+':'+projection.hash.slice(0,16),{type:'object',additionalProperties:false,required:['checks'],properties:{checks:{type:'array',minItems:cells.length,maxItems:cells.length,items:{type:'object',additionalProperties:false,required:['key','equivalent','reason'],properties:{key:{type:'string',enum:cells.map(c=>c.key)},equivalent:{type:'boolean'},reason:{type:'string',minLength:1}}}}}});
   if(!Array.isArray(answer?.checks)||answer.checks.length!==cells.length||new Set(answer.checks.map(c=>c.key)).size!==cells.length||answer.checks.some(check=>!cells.some(c=>c.key===check.key)||check.equivalent!==true||typeof check.reason!=='string'||!check.reason.trim()))throw Object.assign(Error('table_projection_invalid: independent cell equivalence audit rejected or omitted a selected cell'),{code:'coverage_invalid',outlineContract:true,details:{tableProjectionConflicts:[{sourceUnitId:item.id,cells,checks:answer?.checks}]}});
  }
  project.tableProjectionAudits={...project.tableProjectionAudits,[projection.hash]:{status:'accepted',sourceUnitId:item.id,cells:projection.cells.map(c=>c.key),at:new Date().toISOString()}};
 }
}

