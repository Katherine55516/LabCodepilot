import {it} from 'node:test';
import assert from 'node:assert/strict';
const policyModule='../../../apps/cowork-server/lib/ppt-execution-policy.mjs';
const complexityModule='../../../apps/cowork-server/lib/ppt-task-complexity.mjs';
it('strong models use deeper reasoning for complex work while simple rigorous tasks keep bounded effort',async()=>{
 const {thinkingModeForRoute}=await import(policyModule);
 for(const role of ['planner','critic','writer_reasoning']){
  const route={role,qualityLevel:'rigorous',thinkingControl:true};
  assert.equal(thinkingModeForRoute(route,{level:'simple'}),'disabled');
  assert.equal(thinkingModeForRoute(route,{level:'medium'}),'disabled');
  assert.equal(thinkingModeForRoute(route,{level:'complex'}),'enabled');
  assert.equal(thinkingModeForRoute(route,{level:'complex'},{contractRepair:true}),'disabled');
 }
 assert.equal(thinkingModeForRoute({role:'critic',qualityLevel:'rigorous'},{level:'complex'}),undefined,'unverified provider controls are never sent');
 assert.equal(thinkingModeForRoute({role:'writer_reasoning',qualityLevel:'balanced',thinkingControl:true},{level:'complex'}),'enabled');
});
it('global difficulty uses the actual source instead of bilingual protocol and formula examples',async()=>{
 const {taskComplexity}=await import(complexityModule);
 const source={text:'Engineering owns the permission checks. Support keeps the issue log.'};
 const protocol=('中文评审规则和 JSON schema. Example only: $x=\\frac{a}{b}$. ').repeat(500);
 assert.deepEqual(taskComplexity({source},'review:deck',protocol),{level:'simple',reasons:[],slideIds:[]});
 assert.equal(taskComplexity({source},'outline',protocol).level,'simple');
 assert.equal(taskComplexity({source:{text:source.text+' 来源条件必须保留。'}},'review:deck',protocol).level,'medium');
 assert.ok(taskComplexity({source:{text:'The source defines $x=\\frac{a}{b}$ only when b is nonzero.'}},'review:deck',protocol).reasons.includes('code_or_formula'));
 assert.ok(taskComplexity({source:{text:source.text.repeat(250)}},'outline',protocol).reasons.includes('large_scope'));
 assert.ok(taskComplexity({source,outline:[{id:'s',dependsOn:['previous']}]},'review:deck',protocol).reasons.includes('cross_page_dependency'));
});
it('routes a short formula to the reasoning model, preserves legacy and separates critic roles',async()=>{
 const {normalizeExecutionPolicy,resolveTaskRoute}=await import(policyModule);
 const {taskComplexity,taskRole}=await import(complexityModule);
 const policy=normalizeExecutionPolicy({version:1,qualityLevel:'balanced',roleRoutes:{writer_fast:{primary:{configId:'byok:fast',model:'fast'},fallbacks:[]},writer_reasoning:{primary:{configId:'byok:strong',model:'strong'},fallbacks:[]},critic:{primary:{configId:'byok:reviewer',model:'critic'},fallbacks:[]}}});
 const project={executionPolicy:policy,configId:'byok:default',model:'default',outline:[{id:'s1',requiredDetails:[],description:'$x=\\frac{a}{b}$'}]};
 const difficulty=taskComplexity(project,'content:s1','');
 assert.equal(difficulty.level,'complex');
 assert.equal(resolveTaskRoute(project,taskRole('content:s1',difficulty),difficulty).model,'strong');
 assert.equal(resolveTaskRoute(project,taskRole('review:deck',difficulty),difficulty).model,'critic');
 assert.equal(resolveTaskRoute({...project,executionPolicy:normalizeExecutionPolicy()},'planner',difficulty).model,'default');
 assert.throws(()=>normalizeExecutionPolicy({version:1,qualityLevel:'maximum'}));
 assert.throws(()=>normalizeExecutionPolicy({version:1,qualityLevel:'fast',budget:{maxInputTokens:-1}}));
});
it('counts schema fallbacks against the total attempts and reserves budgets before work',async()=>{
 const {normalizeExecutionPolicy,reserveModelAttempt}=await import(policyModule);
 const p={executionPolicy:normalizeExecutionPolicy({version:1,qualityLevel:'fast',budget:{maxAttemptsPerTask:3,maxOutputTokens:1200}}),executionHistory:[]};
 const route={configId:'byok:one',model:'model',role:'writer_fast'};
 const first=reserveModelAttempt(p,'task',route,'input',400);first.wireAttempts=2;
 const second=reserveModelAttempt(p,'task',route,'input',400);second.wireAttempts=1;
 assert.throws(()=>reserveModelAttempt(p,'task',route,'input',100),/attempt limit/);
 assert.throws(()=>reserveModelAttempt(p,'different-task',route,'input',400),/budget/);
 first.status='completed';first.outputTokens=100;second.status='completed';second.outputTokens=100;
 assert.equal(reserveModelAttempt(p,'different-task',route,'input',400).status,'running');
 assert.equal(p.executionHistory.length,3);
});
it('an explicit planning run gets a fresh task allowance while retaining project-wide costs',async()=>{
 const {normalizeExecutionPolicy,reserveModelAttempt,taskFingerprint}=await import(policyModule);
 const p={currentRunId:'read-and-plan',executionPolicy:normalizeExecutionPolicy({version:1,qualityLevel:'balanced',budget:{maxAttemptsPerTask:1,maxOutputTokens:1000}}),executionHistory:[]};
 const route={configId:'byok:one',model:'model',role:'planner'};
 const oldKey=taskFingerprint(p,'outline:editorial-capacity:0','');
 const prior=reserveModelAttempt(p,oldKey,route,'preserved source',600);prior.status='completed';prior.outputTokens=500;
 assert.throws(()=>reserveModelAttempt(p,oldKey,route,'local retry',100),/attempt limit/);
 p.currentRunId='explicit-continue-repair';
 const newKey=taskFingerprint(p,'outline:editorial-capacity:0','');assert.notEqual(newKey,oldKey);
 assert.throws(()=>reserveModelAttempt(p,newKey,route,'local retry',600),/token budget/);
 assert.equal(reserveModelAttempt(p,newKey,route,'local retry',400).runId,'explicit-continue-repair');
 assert.equal(p.executionHistory.length,2);assert.equal(p.executionHistory[0],prior);
});
it('rejects vision routes (source images keep their captions) and circuit-breaks failed credentials until an explicit policy update',async()=>{
 const {normalizeExecutionPolicy,reserveModelAttempt}=await import(policyModule);
 assert.throws(()=>normalizeExecutionPolicy({version:1,qualityLevel:'balanced',roleRoutes:{vision_reader:{primary:{configId:'byok:one',model:'text-only'},fallbacks:[]}}}),/Image understanding is not available/);
 assert.throws(()=>normalizeExecutionPolicy({version:1,qualityLevel:'balanced',roleRoutes:{vision_reader:{primary:{configId:'byok:one',model:'vision',vision:true},complexPrimary:{configId:'byok:one',model:'text'},fallbacks:[]}}}),/Image understanding is not available/);
 const project={executionPolicy:normalizeExecutionPolicy({version:1,qualityLevel:'balanced'}),executionHistory:[{configId:'byok:one',model:'one',errorCode:'auth',policyRevision:0}]};
 assert.throws(()=>reserveModelAttempt(project,'task',{configId:'byok:one',model:'one'},'source',400),/authentication/);
 assert.equal(reserveModelAttempt({...project,executionPolicyRevision:1},'task',{configId:'byok:one',model:'one'},'source',400).status,'running');
});
it('interrupted model attempts preserve budget reservations and require an explicit resume',async()=>{
 const {recoverExecutionHistory}=await import(policyModule);
 const project={status:'outlining',executionHistory:[{status:'running',startedAt:new Date().toISOString(),outputReservation:8192}]};
 assert.equal(recoverExecutionHistory(project),true);assert.equal(project.status,'paused');assert.equal(project.executionHistory[0].status,'interrupted');assert.equal(project.executionHistory[0].outputReservation,8192);assert.equal(recoverExecutionHistory(project),false);
});
it('fast grade still upgrades complex planning using an evaluated planner route',async()=>{
 const {normalizeExecutionPolicy,resolveTaskRoute}=await import(policyModule);
 const policy=normalizeExecutionPolicy({version:1,qualityLevel:'fast',roleRoutes:{planner:{primary:{configId:'byok:one',model:'fast-planner'},complexPrimary:{configId:'byok:one',model:'strong-planner'},fallbacks:[]}}});
 assert.equal(resolveTaskRoute({executionPolicy:policy},'planner',{level:'complex'}).model,'strong-planner');
 assert.equal(resolveTaskRoute({executionPolicy:policy},'planner',{level:'simple'}).model,'fast-planner');
});
it('Chinese-only simple pages are not misclassified as bilingual by JSON field names',async()=>{
 const {taskComplexity}=await import(complexityModule);
 assert.equal(taskComplexity({outline:[{id:'s1',title:'团队介绍',focus:'分工明确，流程清晰。'}]},'content:s1').level,'simple');
 assert.equal(taskComplexity({outline:[{id:'s1',title:'团队介绍',focus:'Team roles 与责任范围'}]},'content:s1').level,'medium');
 const project={outline:[{id:'s1',title:'算法',sourceUnitIds:['b1']}],source:{semantic:{inventory:{items:[{id:'b1',type:'CodeBlock',text:'return x'}]}}}};
 assert.equal(taskComplexity(project,'content:s1').level,'complex');
});

it('input budgets include schema overhead and never reserve unknown image input as zero',async()=>{
 const {normalizeExecutionPolicy,reserveModelAttempt}=await import(policyModule);const route={configId:'byok:one',model:'vision',vision:true};
 const policy=normalizeExecutionPolicy({version:1,qualityLevel:'balanced',budget:{maxInputTokens:5000}}),project={executionPolicy:policy,executionHistory:[]};
 const first=reserveModelAttempt(project,'text',route,'text',300,{schemaBytes:200});assert.equal(first.inputReservation,1228);
 assert.throws(()=>reserveModelAttempt(project,'image',route,'source',300,{images:[{dataUrl:'data:image/png;base64,YQ=='}]}),/no verified preflight bound/);assert.equal(project.executionHistory.length,1);
 const unlimited={executionPolicy:normalizeExecutionPolicy({version:1,qualityLevel:'balanced'}),executionHistory:[]};const image=reserveModelAttempt(unlimited,'image',route,'source',300,{images:[{}]});assert.equal(image.inputReservationUnknown,true);
 assert.throws(()=>reserveModelAttempt({...unlimited,executionPolicy:policy},'later',route,'source',300),/no verified preflight bound/);
 image.inputTokens=1500;assert.equal(reserveModelAttempt({...unlimited,executionPolicy:policy},'later',route,'source',300).status,'running');
});
