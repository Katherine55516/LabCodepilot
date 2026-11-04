/** Passing verdicts for the model-judged review stages, shared by the model
 * doubles. A double registers the planning and writing stages it tests; every
 * review added later (summary faithfulness, complete-source coverage, graph
 * and obligation audits) passes here instead of failing an unrelated test
 * with "Unregistered stage". A test of a refusal overrides the stage itself.
 * Replies follow the stage's own jsonSchema (IDs come from its enums), so a
 * contract change in the reviewer still shows up as a failure. */
const REASON='Controlled double: passes; not a live-model judgement.';
const enumOf=(schema,...path)=>{let node=schema;for(const key of path){node=node?.[key];if(!node)return [];}return Array.isArray(node)?node:[];};

export function auditDouble(key,prompt,schema){
  const stage=String(key||'');
  if(stage.startsWith('outline:semantic-summary-audit:'))
    return {checks:enumOf(schema,'properties','checks','items','properties','sourceUnitId','enum').map(sourceUnitId=>({sourceUnitId,equivalent:true,reason:REASON}))};
  if(/^outline:editorial-coverage-(?:audit|precision):/u.test(stage))return {sufficient:true,missingSourceUnitIds:[],reason:REASON};
  if(stage.startsWith('source:graph-audit:'))return {version:1,equivalent:true,missingLabels:[],missingConnections:[],unsupportedConnections:[],reason:REASON};
  if(stage.startsWith('outline:obligation-placement'))
    return {checks:enumOf(schema,'properties','checks','items','properties','obligationId','enum').map(obligationId=>({obligationId,requiresSamePage:false,reason:REASON}))};
  if(stage.startsWith('input:obligation-indispensability'))
    return {checks:enumOf(schema,'properties','checks','items','properties','index','enum').map(index=>({index,indispensable:true,reason:REASON,triggerEvidence:[]}))};
  if(stage.startsWith('outline:subject-')){
    const rows=JSON.parse(prompt.match(/<final_outline_subjects>(.*?)<\/final_outline_subjects>/su)?.[1]||'[]');
    return {version:1,checks:rows.map(r=>({slideId:r.slideId,status:'aligned',reason:REASON,evidenceSourceUnitIds:[]}))};
  }
  return null;
}
