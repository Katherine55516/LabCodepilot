import {digest} from './ppt/edit-context.mjs';
/** Input readiness (P0-3). A required source warning (an SVG/image that could
 * not be decoded, formulas without cached values, ambiguous PDF reading order…)
 * used to surface only at the final quality gate, after a whole generation.
 * Now it must be resolved before slides are written: either the user fixes and
 * re-uploads the input, or explicitly acknowledges the loss for this exact
 * source hash. Acknowledgements reuse `sourceObjectExclusions` (user, reason,
 * source hash), the same audit trail as confirmed media exclusions. */
export function sourceWarningKey(warning){
 // An arithmetic conflict's message is worded by the client: its key is the conflict itself.
 const fields=warning?.code==='source_arithmetic_conflict'?{code:warning.code,location:warning?.location||'',reference:warning?.reference||''}:{code:warning?.code||'',location:warning?.location||'',message:warning?.message||'',reference:warning?.reference||''};
 return 'source_warning:'+digest(fields).slice(0,24);
}
/** A user acknowledgement of this warning for this source hash; for a source
 * inconsistency also one recorded under an older key (same code and place). */
export function sourceWarningAcknowledged(project,key,warning){
 const valid=item=>item.kind==='source_warning'&&item.approvedBy==='user'&&item.sourceHash===project.source.sha256&&typeof item.reason==='string'&&item.reason.trim();
 return Boolean(project?.source?.sha256)&&Boolean(project.sourceObjectExclusions?.some(item=>valid(item)&&(item.objectId===key||warning?.cause==='source_inconsistency'&&item.code===warning.code&&(item.location||null)===(warning.location||null))));
}
/** Lost content (an undecodable image, uncached formulas, an ambiguous reading
 * order) must be resolved before writing; a source inconsistency never is
 * (Fable, 2026-10-23), including warnings stored as required before. */
const requiredWarning=warning=>Boolean(warning?.required)&&warning.cause!=='source_inconsistency';
export function unresolvedSourceWarnings(project){
 return (project?.source?.mediaWarnings||[]).filter(warning=>requiredWarning(warning)&&!sourceWarningAcknowledged(project,sourceWarningKey(warning),warning));
}
/** Client view: stable key plus resolution state for each warning. */
export function sourceWarningView(project){
 const warnings=project?.source?.mediaWarnings;
 if(!Array.isArray(warnings))return warnings;
 return warnings.map(warning=>{const key=sourceWarningKey(warning),kept=sourceWarningAcknowledged(project,key,warning),required=requiredWarning(warning);return {...warning,key,required,resolved:!required||kept,kept};});
}
/** Outline confirmation entries: they stop automatic generation (the writer
 * must not start) without forcing the user to edit an otherwise valid outline. */
export function sourceReadinessWarnings(project){
 return unresolvedSourceWarnings(project).map(warning=>({code:'required_source_warning',message:`${warning.location||'Source'}: ${warning.message}`,details:{key:sourceWarningKey(warning),cause:warning.cause||null},resolution:'resolve_source_warning',requiresReview:true}));
}
export function acknowledgeSourceWarnings(project,keys,reason,at=new Date().toISOString()){
 const required=new Map((project.source?.mediaWarnings||[]).filter(w=>w?.required||w?.cause==='source_inconsistency').map(w=>[sourceWarningKey(w),w]));
 const unknown=keys.filter(key=>!required.has(key));
 if(unknown.length)throw Object.assign(new Error('unknown or non-required source warning: '+unknown.join(', ')),{statusCode:409});
 const kept=(project.sourceObjectExclusions||[]).filter(item=>!keys.includes(item.objectId));
 project.sourceObjectExclusions=[...kept,...keys.map(objectId=>({objectId,kind:'source_warning',approvedBy:'user',sourceHash:project.source.sha256,reason,approvedAt:at,code:required.get(objectId).code,location:required.get(objectId).location||null}))];
 return project;
}
