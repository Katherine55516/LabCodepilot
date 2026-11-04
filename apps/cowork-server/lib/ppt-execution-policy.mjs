import crypto from 'node:crypto';
export const PPT_ROUTING_VERSION = 'ppt-routing-v2';
export const PPT_MODEL_ROLES = ['source_organizer', 'planner', 'writer_fast', 'writer_standard', 'writer_reasoning', 'critic'];
const limits = { fast: 1, balanced: 2, rigorous: 2 };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)??'null').digest('hex');
function modelRef(value) {
  if (!value || typeof value.configId !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/u.test(value.configId) || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 120) throw new Error('Invalid PPT model reference');
  return {configId:value.configId,model:value.model,...(value.thinkingControl===true?{thinkingControl:true}:{}),...(value.vision===true?{vision:true}:{}),...Object.fromEntries(['contextTokens','maxOutputTokens'].filter(key=>Number.isInteger(value[key])&&value[key]>=256&&value[key]<=4000000).map(key=>[key,value[key]]))};
}
export function normalizeExecutionPolicy(value, legacy = {}) {
  if (value?.legacy===true||value?.qualityLevel==='legacy_single_model') value=null;
  if (!value) return {version:1,qualityLevel:'legacy_single_model',routingPolicyVersion:PPT_ROUTING_VERSION,roleRoutes:{},budget:{maxAttemptsPerTask:5},legacy:true};
  if (value.version !== 1 || !Object.hasOwn(limits,value.qualityLevel)) throw new Error('Invalid PPT quality level');
  const roleRoutes = {};
  for (const role of PPT_MODEL_ROLES) {
    const route = value.roleRoutes?.[role];
    if (route) roleRoutes[role] = {primary:modelRef(route.primary),...(route.complexPrimary?{complexPrimary:modelRef(route.complexPrimary)}:{}),...(['automatic','manual'].includes(route.selection)?{selection:route.selection}:{}),fallbacks:(route.fallbacks || []).slice(0,3).map(modelRef)};
  }
  // Source images are not described by a model (knowledge: source_only): an
  // image keeps its source caption and alt text and is placed by code.
  if(value.roleRoutes?.vision_reader&&value.visionMode!=='preserve')throw new Error('Image understanding is not available: source images keep their own captions; remove the vision_reader route');
  const budget = {maxAttemptsPerTask:Math.min(5,Math.max(1,Math.floor(value.budget?.maxAttemptsPerTask || 5)))};
  for (const key of ['maxInputTokens','maxOutputTokens','maxEstimatedCost']) {
    if (value.budget?.[key] !== undefined) {
      if (!Number.isFinite(value.budget[key]) || value.budget[key] <= 0) throw new Error('Invalid PPT execution budget');
      budget[key] = value.budget[key];
    }
  }
  if (budget.maxEstimatedCost !== undefined) throw new Error('Monetary budgets require verified provider prices; use token budgets');
  // No model-name heuristics or unverified reasoning parameters enter the wire.
  return {version:1,qualityLevel:value.qualityLevel,routingPolicyVersion:PPT_ROUTING_VERSION,roleRoutes,budget,maxQualityRepairs:limits[value.qualityLevel],catalogVersion:String(value.catalogVersion || 'configured-roles-v1').slice(0,80),legacy:false};
}
export function resolveTaskRoute(project, role, complexity, attempt = 0) {
  const policy = project.executionPolicy;
  let selectedRole = role;
  if (!policy?.legacy && policy?.qualityLevel === 'rigorous' && role === 'writer_standard') selectedRole='writer_reasoning';
  const repairUpgrade=attempt>0&&['writer_fast','writer_standard'].includes(selectedRole);
  if (repairUpgrade) selectedRole='writer_reasoning';
  const route = policy?.roleRoutes?.[selectedRole] || policy?.roleRoutes?.[role];
  const useStrong=complexity?.level==='complex'||policy?.qualityLevel==='rigorous'&&['planner','critic'].includes(role);
  const primary=useStrong&&route?.complexPrimary?route.complexPrimary:route?.primary;
  const choices = route ? [primary,...route.fallbacks] : [{configId:project.configId,model:project.model}];
  const routeAttempt=repairUpgrade?attempt-1:attempt;
  const selected = choices[Math.min(routeAttempt,choices.length-1)];
  return {...modelRef(selected),role:selectedRole,qualityLevel:policy?.qualityLevel || 'legacy_single_model',complexity};
}
export function thinkingModeForRoute(route, complexity, {contractRepair=false}={}) {
  if(!route.thinkingControl)return undefined;
  if(contractRepair||complexity?.level!=='complex')return 'disabled';
  if(route.role==='critic'&&complexity.reasons?.includes('disputed_source_verdict'))return 'enabled';
  return route.role==='writer_reasoning'||route.qualityLevel==='rigorous'&&['planner','critic'].includes(route.role)?'enabled':'disabled';
}
export function taskFingerprint(project, stage, prompt) {
  return hash({stage,prompt,source:project.source?.sha256,assets:project.source?.images?.map(image=>[image.id,hash(image.dataUrl)]),outlineRevision:project.outlineRevision,revision:project.revision,template:project.templateFidelity?.sha256||project.templateSpec,policy:project.generationPolicy,execution:project.executionPolicy,run:project.currentRunId});
}
export function reserveModelAttempt(project, taskKey, route, prompt, maxOutputTokens, input = {}) {
  const budget=project.executionPolicy?.budget || {maxAttemptsPerTask:5};
  const records=project.executionHistory ||= [];
  if(records.some(item=>['auth','model_not_found'].includes(item.errorCode)&&item.configId===route.configId&&item.model===route.model&&item.policyRevision===(project.executionPolicyRevision||0)))throw Object.assign(new Error('This model configuration failed authentication or no longer exists. Update the configuration or select another route before retrying.'),{code:'execution_provider_unavailable'});
  const attempts=records.filter(item=>item.taskKey===taskKey);
  if (attempts.reduce((n,item)=>n+(item.wireAttempts||1),0) >= budget.maxAttemptsPerTask) throw Object.assign(new Error('PPT task attempt limit reached; inspect the failed task before retrying'),{code:'execution_attempt_limit'});
  const unknownImages=Boolean(input.images?.length);
  if(budget.maxInputTokens&&(unknownImages||records.some(item=>item.inputReservationUnknown&&item.inputTokens===undefined)))throw Object.assign(new Error('Image input token usage has no verified preflight bound for this provider. Existing pages are preserved. Review this limitation and remove the input-token cap before explicitly resuming.'),{code:'execution_budget'});
  // UTF-8 bytes provide a conservative text-token bound. Include the actual
  // output schema and protocol envelope, rather than treating image input as free.
  const inputReservation=Buffer.byteLength(prompt,'utf8')+Math.max(0,input.schemaBytes||0)+1024;
  const totalInput=records.reduce((sum,item)=>sum+((item.inputTokens??item.inputReservation??0)+Math.max(0,(item.wireAttempts||1)-1)*(item.inputReservation||0)),0);
  const totalOutput=records.reduce((sum,item)=>sum+((item.outputTokens??item.outputReservation??0)+Math.max(0,(item.wireAttempts||1)-1)*(item.outputReservation||0)),0);
  if (budget.maxInputTokens && totalInput+inputReservation>budget.maxInputTokens || budget.maxOutputTokens && totalOutput+maxOutputTokens>budget.maxOutputTokens) throw Object.assign(new Error('PPT token budget reached; existing pages are preserved'),{code:'execution_budget'});
  if(route.contextTokens&&inputReservation+maxOutputTokens>route.contextTokens)throw Object.assign(new Error('This task exceeds the selected model context limit; select a larger-context model'),{code:'execution_context_limit'});
  const record={id:crypto.randomBytes(12).toString('hex'),taskKey,policyRevision:project.executionPolicyRevision||0,attempt:attempts.length+1,wireRemaining:budget.maxAttemptsPerTask-attempts.reduce((n,item)=>n+(item.wireAttempts||1),0),...route,...(unknownImages?{inputReservationUnknown:true}:{}),inputReservationBasis:'UTF-8 byte upper bound plus schema and protocol envelope; image usage unknown until provider telemetry',inputHash:hash(prompt),runId:project.currentRunId,baseRevision:project.revision,sourceHash:project.source?.sha256,outlineRevision:project.outlineRevision,inputReservation,outputReservation:maxOutputTokens,costStatus:'unknown',status:'running',startedAt:new Date().toISOString()};
  records.push(record); return record;
}

/** A restarted bridge cannot know whether an in-flight provider request was billed.
 * Keep reservations and pause before any explicit replay. */
export function recoverExecutionHistory(project){
  const running=(project.executionHistory||[]).filter(row=>row.status==='running');
  if(!running.length)return false;
  const at=new Date().toISOString();
  for(const row of running)Object.assign(row,{status:'interrupted',errorCode:'result_unknown',completedAt:at,elapsedMs:Date.now()-Date.parse(row.startedAt)});
  project.runtime||={};project.runtime.resumePhase=project.status==='outlining'?'outlining':'generating';project.runtime.pauseRequested=true;project.runtime.lifecycle='paused';project.status='paused';project.error='A model request was interrupted. Its result and cost are unknown; inspect the preserved draft before explicitly resuming.';
  return true;
}
