// Real production pipeline benchmark. Fixtures and live provider results remain distinct.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const root=process.cwd(),out=path.resolve(process.env.PPT_BENCHMARK_OUTPUT||'outputs/ppt-experience-quality-20261014/live');
const service=JSON.parse(fs.readFileSync(out+'/service-ready.json','utf8'));
const loadedCode=JSON.parse(fs.readFileSync(out+'/service-code.json','utf8'));
if(service.codeHash!==loadedCode.codeHash||Date.parse(service.startedAt)<Date.parse(loadedCode.at))throw Error('QA service startup is incomplete: ready record must match the current loaded-code manifest before creating any benchmark project');
process.env.CLAUDE_GUI_DATA_DIR=out+'/profile';
const db=createRequire(import.meta.url)(root+'/src/lib/db.ts'),token=db.getSetting('cowork_remote_token');db.closeDb();
const records=path.join(out,'benchmark.jsonl');
const caseTimeoutMs=Number(process.env.PPT_BENCHMARK_CASE_TIMEOUT_MS||1800000);
if(!Number.isSafeInteger(caseTimeoutMs)||caseTimeoutMs<1000||caseTimeoutMs>5400000)throw Error('PPT_BENCHMARK_CASE_TIMEOUT_MS must be 1000–5400000 ms');
const resultRows=[];
const log=value=>{if(value.event==='result')resultRows.push(value);fs.appendFileSync(records,JSON.stringify({at:new Date().toISOString(),...value})+'\n');console.log(JSON.stringify(value));};
const readTransportFailures=[];
async function pauseUntilTerminal(projectId){
 await api('POST',`projects/${projectId}/pause`,{});
 const deadline=Date.now()+90000;
 while(Date.now()<deadline){
  const current=(await api('GET','projects/'+projectId)).project;
  if(['paused','failed','completed','quality_blocked','cancelled'].includes(current.status))return current;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw new Error('Pause completion was not confirmed; preserve this project and stop the benchmark before archiving or starting another case');
}

async function request(method,route,data,binary=false){
 const limit=method==='GET'?3:1;
 for(let attempt=1;attempt<=limit;attempt++){
  try{
   const response=await fetch(service.base+'/ppt/'+route,{method,headers:{authorization:`Bearer ${token}`,connection:'close',...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(binary?180000:60000)});
   if(!response.ok){const result=await response.json();throw Object.assign(new Error(`${response.status}: ${result.error}`),{httpStatus:response.status});}
   return binary?Buffer.from(await response.arrayBuffer()):await response.json();
  }catch(error){
   const network=!error.httpStatus&&['TypeError','AbortError','TimeoutError'].includes(error.name);
   if(method!=='GET'||!network||attempt===limit)throw error;
   const failure={event:'read_transport_retry',route,attempt,errorClass:error.name,cause:error.cause?.code};readTransportFailures.push(failure);log(failure);
   await new Promise(resolve=>setTimeout(resolve,attempt*500));
  }
 }
}
const api=(method,route,data)=>request(method,route,data);
const business=[
 {id:'business-1',name:'Quarterly delivery',text:'# Quarterly delivery\nThe team committed to 12 customer migrations and completed 10. Two migrations remain pending because the identity-provider integration has not passed customer acceptance. Completion means the customer has approved both authentication and the rollback rehearsal. The next release must not count configuration alone as completion.\n\n## Decision\nAssign one engineer to identity integration and one to migration automation for the next two weeks. Retain the current support rota; adding migration work to that rota would delay incident responses. Track acceptance approvals, rollback rehearsal outcomes, and open migration blockers separately.\n\n## Evidence and constraints\nAutomation reduced the median manual migration effort from 6 hours to 4 hours in the ten completed migrations. This observation applies only to those migrations; it does not estimate the time for customers with untested identity providers. Customer dates remain conditional on acceptance.\n\n## Next review\nReview the two remaining migrations on Friday. If identity acceptance fails, propose a revised customer date with the reason and owner. Do not relax acceptance or count unfinished work as delivered.'},
 {id:'business-2',name:'Release readiness',text:'# Release readiness\nThe launch includes document search, permission filtering, and result citations. The initial audience is the internal support team. Search relevance has passed the agreed evaluation set, while permission filtering still has two open integration scenarios. Citations must open a source the current user can access.\n\n## Launch gates\nThe release owner must confirm all permission scenarios, the rollback procedure, and support documentation before enabling the feature for the full team. A successful relevance test alone is insufficient for release.\n\n## Rollout\nEnable the feature for five volunteers first, review failures daily, and expand only after the permission scenarios pass. Maintain the existing search path as a rollback option. The pilot is intended to reveal operational issues, not to estimate universal productivity gains.\n\n## Responsibilities\nEngineering owns permission failures and rollback. Support owns the pilot issue log. The release owner records the decision with evidence and unresolved limitations. Keep these responsibilities separate from the feature list.'},
 {id:'business-3',name:'Service improvement',text:'# Service improvement\nThe support queue receives requests through email and the application. Requests must share a tracking identifier so a customer reply does not create an unrelated duplicate. Agents currently search both channels manually.\n\n## Proposal\nAdd a shared identifier at intake, link later messages to it, and show the request owner and next action. Preserve the original message and its channel. Link suspected duplicates for review rather than deleting them automatically.\n\n## Measurement\nMeasure time to first useful response, unresolved request age, and incorrect duplicate links. A faster first response is not an improvement when it provides no useful next action. Review the measures weekly by request category.\n\n## Constraints\nOnly link records that the current agent is permitted to access. When two requests conflict, preserve both and flag the conflict. Roll out first to one queue, compare the issue log with the baseline period, and expand after staff have reviewed the links.'}
];
// Three independent long sources; sections have distinct facts and decisions,
// rather than repeated boilerplate that could disguise duplication defects.
const bilingualCases=[
 {name:'知识库迁移与验收',sections:[
 ['范围冻结','迁移对象为客户确认的知识库集合，试点只覆盖其中已通过权限清单核对的资料。历史归档与当前知识条目分别记录，避免将过期答案混入默认搜索结果。迁移前由资料负责人冻结清单；新提交的条目进入增量队列，不能临时加入已验收批次。','Pilot scope is limited to the approved knowledge collection. Archive status and access permissions remain separate attributes.'],
 ['版本与来源','每个知识条目保留原始标识、最后修改时间及原始地址。相同标题不能作为合并依据，因为不同团队可能使用相同标题描述不同流程。发现内容冲突时同时保留两个版本，并交由各自资料负责人说明适用范围；迁移工具不能选择较新的一个就覆盖另一个。','Keep stable identifiers and original links. A newer timestamp alone does not resolve a conflict between two valid procedures.'],
 ['权限核对','目标系统先使用测试账号验证授权和拒绝两类场景。资料可被搜索到不代表用户能够读取其正文；摘要和引用也要遵守同一权限边界。若权限映射存在缺口，该条目留在待处理清单中，相关部门的其他已通过条目仍可单独验收。','Search snippets and citations follow the same permission boundary as the document. An unresolved mapping blocks that item, not unrelated accepted items.'],
 ['链接与附件','迁移后检查正文链接、附件引用及图片说明是否仍指向相同对象。相对链接按原资料所在路径解析，不能统一改成首页。失效链接记录原地址与失败原因，负责人确认替代地址后再发布。附件内容不因为文件名相同而被当作同一个版本。','Resolve relative links against their original location. Preserve a failed reference until its owner approves a replacement.'],
 ['抽样与全量','抽样适合发现迁移规则中的共同问题，但不能代替必需字段和权限映射的全量核对。检查日志分别记录规则缺陷与单条资料缺陷。规则修复后重跑受影响类别，不需要无条件重做无关资料；如果影响范围未知，应先暂停该类发布。','Sampling detects patterns; it does not replace complete checks of required fields and access mappings. Recheck the affected class after a rule changes.'],
 ['验收责任','工程团队负责数据转换与可重复执行的检查，资料负责人确认内容仍适用，安全负责人确认权限边界。三类结果分别保留，不能把转换成功写成业务验收完成。验收记录必须引用实际检查日志，并列出尚未解决的例外及其处理人。','Technical conversion, content acceptance and security approval are separate decisions. Each decision references its own evidence.'],
 ['回退与增量','切换期间保留原系统的只读入口。若新系统出现权限泄漏，应立即关闭受影响集合的访问并保留事件日志；若只是单条格式异常，可隔离该条目后继续处理其他资料。增量同步使用相同稳定标识，避免重复导入已经验收的条目。','Keep the old read-only path during cutover. Permission exposure and isolated formatting errors require different responses.'],
 ['退出试点','试点退出条件是批准集合中的必需检查完成，例外已被负责人接受或移出本轮范围，并且回退入口经过实际演练。试点中观察到的搜索改进只适用于该集合，不自动代表其他部门。后续扩展沿用已验证规则，但需重新确认资料范围和负责人。','Exit requires completed checks, explicit disposition of exceptions and a rehearsed rollback. Pilot observations do not establish organization-wide outcomes.']
 ]},
 {name:'事件响应与复盘',sections:[
 ['触发与分级','本流程处理服务不可用、数据权限异常和结果明显不一致三类报告。接报人员先保存用户描述、发生时间及可重现步骤，不要求用户先判断技术原因。事件等级由实际影响与持续范围决定，单个响亮的投诉不能替代影响核对。','Record the observed effect before assigning a technical cause. Severity follows verified impact and scope.'],
 ['指挥与沟通','事件指挥负责协调决策，调查人员负责收集证据，沟通负责人向受影响用户更新已确认的状态。三个职责可以由同一人在小型事件中承担，但记录仍分别标识。对外说明要区分已经确认的事实、正在验证的假设和下一次更新时间。','Separate confirmed facts, working hypotheses and the next update. One person may hold several roles without merging their responsibilities.'],
 ['证据保留','优先保存请求标识、相关日志、配置版本和部署记录。调查副本应保留原始时间和来源，处理敏感信息时按既有权限提供访问。为了便于阅读而删除看似无关的日志，可能破坏时间线，因此筛选结果与原始记录都要可追溯。','Keep an immutable original and a traceable investigation view. A filtered log is not a replacement for the original evidence.'],
 ['假设验证','每个假设写明支持证据、反例及下一项验证。先比较变更前后可复现的差异，再决定是否回滚。若无法区分多个原因，应记录不确定性，不能因为某次重启后恢复就断言重启解决了根因。恢复动作与根因结论分别记录。','Recovery after an action does not prove the action addressed the root cause. Track recovery and causal conclusions separately.'],
 ['控制影响','权限异常优先阻止进一步暴露，服务性能下降则优先保护关键路径。临时绕过可能引入新风险，必须记录批准人、适用范围和撤销条件。缓解方案不能在事件关闭后默认为长期设计，应进入后续评审。','Containment depends on the type of impact. Every temporary exception has an owner, scope and removal condition.'],
 ['恢复检查','恢复判断同时查看用户路径、后台错误和受影响数据的状态。仪表盘转绿不等于用户已经能够完成关键动作。对于可重复的数据操作，重试前检查原请求是否已执行，避免在结果未知时造成重复写入；无法确认的请求进入人工核查。','Validate the user journey as well as service metrics. An unknown write result requires reconciliation before replay.'],
 ['复盘结论','复盘按观察到的时间线解释决策及其信息条件，不用事后知识评价当时尚未获知的事实。改进项指向暴露出的机制缺口，区分预防、检测和恢复措施。每项明确负责人和完成证据，避免把重新强调注意事项作为唯一修复。','Tie actions to a demonstrated mechanism gap. Prevention, detection and recovery are different kinds of improvement.'],
 ['跟进与关闭','事件可以在服务恢复后关闭应急状态，但未完成的长期改进保留独立跟踪。后续评审检查措施是否真正减少同类风险，而不只是任务是否被标记完成。若根因仍未知，应在结论中明确保留该限制并列出继续调查的条件。','Closing the emergency does not close every follow-up action. Preserve unresolved causal uncertainty in the final record.']
 ]},
 {name:'课程试点与学习评估',sections:[
 ['学习目标','课程帮助新成员区分操作指令、观察记录与尚未验证的假设。目标是能给出分类依据，而不是背诵三个名称。练习材料使用虚构场景并明确标为示例，不把示例中的数字写成组织实际表现；已有岗位经验不能作为免做检查的依据。','The learning goal is justified classification, not label recall. Fictional examples remain explicitly fictional.'],
 ['先修诊断','开课前使用同一组简短材料观察学员如何解释证据。诊断只用于安排辅导，不作为岗位绩效评分。讲师分别记录概念混淆与阅读困难，因为二者需要不同支持；材料读不懂时不能直接推断学员不理解业务。','Diagnostic responses guide support. Reading difficulty and conceptual confusion need different interventions.'],
 ['案例顺序','先展示有明确出处的观察，再加入一个操作请求，最后加入预测性表述。每次只改变一个关键条件，让学员说明分类为什么变化。后续综合案例才混合多种表述，避免开始就用复杂文本掩盖基础概念问题。','Change one condition at a time before introducing mixed cases. Ask learners to explain why the classification changes.'],
 ['双语材料','中文作为讲解主要语言，英文保留术语和补充案例。互译内容放在同一活动内，不因为语言不同而重复计为两项学习成果。仅英文出现的额外限制仍须讲清楚，不能当作翻译重复删除；需要语言支持的学员可查看对照资料。','A translation pair represents one learning claim. An additional condition expressed in only one language remains substantive content.'],
 ['讨论与反馈','小组先给出各自判断，再比较引用的证据。讲师反馈应指出哪一项证据足以支持结论，以及哪些推断超出材料。对于存在多个合理分类的句子，应接受有条件的答案，而不强行把模糊案例改成唯一标准答案。','Feedback identifies support and overreach. An ambiguous case may allow several defensible answers with explicit conditions.'],
 ['迁移练习','课程后半段换用新的业务场景，但保持同样的分类原则。若学员只能回答课堂原句，则尚不能证明能够迁移。新练习避免引入未经教学的新专业知识，否则错误可能来自背景差异，而非本课目标未达成。','Use a new context with the same reasoning principle. Do not confound transfer with unfamiliar specialist knowledge.'],
 ['评估解释','分别观察分类是否正确、依据是否充分及是否保留原有条件。分数只是这些观察的汇总，不单独解释原因。小型试点结果不用于估计全体员工的掌握程度；缺席和未完成练习的学员保留在参与记录中，不能当成已经通过。','Evaluate the answer, evidence and retained conditions separately. Pilot scores do not estimate organization-wide mastery.'],
 ['课程修订','讲师根据错误类型修改案例与解释，保留修订前后的材料版本。若错误集中在同一个模糊例子，先检查材料本身，再决定增加讲解。下一轮使用可比任务验证改动效果，不能因为学员满意度提高就宣布学习目标已经达成。','Revise the demonstrated source of confusion and preserve versions. Satisfaction alone does not demonstrate achievement of the learning objective.']
 ]}
];
const bilingual=bilingualCases.map((sample,index)=>({id:`bilingual-${index+1}`,name:sample.name,text:`# ${sample.name}\n本材料为验收用方案，中文为主要语言。英文补充必须与相关内容保留在同一主题下。\n`+sample.sections.map(([title,zh,en],i)=>`\n## ${i+1}. ${title}\n${zh}\n\nEnglish supplement: ${en}\n`).join('')}));
const technical=[{id:'technical-1',name:'Deterministic scoring',text:'# Deterministic scoring\nAll quantities here are fixture assumptions. For observed values x_1 through x_n, use m=(sum_i x_i)/n only when n>0. A missing value is excluded from both the sum and the count. A zero is an observed value and must remain in both.\n\n## Example\nFor observations 0, 4 and missing, the count is 2, the sum is 4, and the mean is 2. Treating zero as missing would incorrectly return 4. Treating missing as zero would incorrectly return 4/3.\n\n## Implementation\n```python\ndef observed_mean(values):\n    observed = [x for x in values if x is not None]\n    if not observed:\n        return None\n    return sum(observed) / len(observed)\n```\n\n## Boundary conditions\nAn empty observed list returns no result. The caller must distinguish no result from zero. This routine assumes that remaining values are numeric and finite; validation of nonnumeric inputs belongs before this function. Keep the formula, example and missing-value condition together.'},{id:'technical-2',name:'Weighted selection',text:'# Weighted selection\nFixture assumptions: w_i >= 0 and sum_i w_i = 1. The score s=sum_i w_i*x_i is defined only when all required x_i are available. Do not silently renormalize weights when a required input is missing.\n\n## Worked example\nFor x=(2,4) and w=(0.25,0.75), s=3.5. The first contribution is 0.5 and the second is 3.0. The example describes arithmetic, not evidence of predictive performance.\n\n## Validation\nReject negative weights. Reject a weight sum outside the declared numerical tolerance. Return a missing-input result when a required observation is absent.\n```python\ndef weighted_score(values, weights):\n    if len(values) != len(weights):\n        raise ValueError("length mismatch")\n    if any(w < 0 for w in weights):\n        raise ValueError("negative weight")\n    if abs(sum(weights) - 1) > 1e-8:\n        raise ValueError("weight sum")\n    if any(x is None for x in values):\n        return None\n    return sum(w*x for w, x in zip(weights, values))\n```\n\n## Interpretation\nIncreasing a weight changes the contribution of its associated value and requires another weight to change to keep the sum equal to one. Preserve the normalization constraint alongside the score formula.'}];
const table=[{id:'visual-1',name:'Migration table',text:'# Migration progress\nFixture observations; status and acceptance are distinct.\n\n| Cohort | Planned | Accepted | Pending |\n|---|---:|---:|---:|\n| North | 6 | 5 | 1 |\n| South | 4 | 3 | 1 |\n| East | 2 | 2 | 0 |\n\nThe total planned count is 12, accepted is 10, and pending is 2. Accepted means customer approval is recorded. Pending entries must not be counted as accepted. Keep the complete table and the definition of acceptance visible. The next review assigns owners to the two pending entries.'},{id:'visual-2',name:'Source chart',text:'# Comparison of fixture observations\nThe chart shows completed checks across three independent fixture groups. These are counts, not percentages or production performance.\n\n<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><rect width="600" height="300" fill="white"/><text x="40" y="30">Completed checks (count)</text><rect x="80" y="160" width="80" height="80" fill="#3264aa"/><rect x="240" y="120" width="80" height="120" fill="#3264aa"/><rect x="400" y="80" width="80" height="160" fill="#3264aa"/><text x="90" y="270">A: 4</text><text x="250" y="270">B: 6</text><text x="410" y="270">C: 8</text></svg>\n\nGroup A completed 4 checks, B completed 6, and C completed 8. All groups use the same definition of a completed check. The comparison does not establish why the counts differ. Retain the original figure and its units.'}];
const templates=[{id:'template-1',name:'New customer brief',text:'# New customer brief\nThe new customer is Cedar. This material has no connection to the example report in the template. The delivery includes an intake review, a limited pilot and a recorded acceptance decision.\n\n## Scope\nThe pilot uses the customer-approved document set. The team must record exclusions and unresolved access issues before presenting results. A pilot result applies only to that document set.\n\n## Decision and follow-up\nThe customer owner approves scope. Engineering confirms access checks. Support records unresolved issues. Expand only after the customer has accepted the pilot. Preserve these responsibilities and the acceptance condition.'},{id:'template-2',name:'New training brief',text:'# New training brief\nThis session explains how to distinguish an instruction, an observation and an assumption. Template example company names, dates, results and screenshots do not belong in this new presentation.\n\n## Learning activities\nAsk participants to classify three statements: "review the queue" is an instruction; "the queue contains 12 requests" is an observation when backed by a record; "the next week will be quieter" is an assumption until supported.\n\n## Review\nEach answer must identify the evidence or the requested action. Preserve the conditions attached to observations. End with an invitation for questions and a thank-you message.'}];
const cases=[...business,...bilingual,...technical,...table,...templates];
// Optional long, original sources supplement the fixed matrix. Never replace
// a difficult case or rewrite its original file to obtain a passing result.
if(process.env.PPT_BENCHMARK_EXTRA_CASES){
 const extra=JSON.parse(fs.readFileSync(process.env.PPT_BENCHMARK_EXTRA_CASES,'utf8'));
 for(const sample of extra){
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(sample.id)||cases.some(existing=>existing.id===sample.id))throw Error('Invalid or duplicate supplemental case ID');
  const sourcePath=path.resolve(sample.sourcePath),text=fs.readFileSync(sourcePath,'utf8');
  if(!text.trim()||text.length>80000)throw Error('Supplemental source must fit the unchanged 80,000-character input limit');
  cases.push({id:sample.id,name:sample.name||sample.id,text,sourcePath,expectedSourceConflict:sample.expectedSourceConflict===true,...(Number.isInteger(sample.pages)?{pages:sample.pages}:{}),...(['design_only','keep_fixed'].includes(sample.templateContentMode)?{templateContentMode:sample.templateContentMode,templateFixedObjectIds:sample.templateFixedObjectIds||[]}:{} )});
 }
}
if(process.env.PPT_BENCHMARK_PREPARE==='1'){fs.mkdirSync(out+'/sources',{recursive:true});const manifest=cases.map(sample=>{fs.writeFileSync(`${out}/sources/${sample.id}.md`,sample.text);return {id:sample.id,name:sample.name,characters:sample.text.length,sourceHash:crypto.createHash('sha256').update(sample.text).digest('hex')};});fs.writeFileSync(out+'/sources/manifest.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify({prepared:manifest}));process.exit(0);}
let reportTemplate=process.env.PPT_BENCHMARK_TEMPLATE;
if(process.env.PPT_BENCHMARK_TEMPLATE_FILE){
 const file=path.resolve(process.env.PPT_BENCHMARK_TEMPLATE_FILE),bytes=fs.readFileSync(file),templateHash=crypto.createHash('sha256').update(bytes).digest('hex');
 const response=await fetch(service.base+'/ppt/templates?fileName='+encodeURIComponent(path.basename(file)),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/octet-stream'},body:bytes});
 const value=await response.json();if(!response.ok)throw Error(`Actual report template upload failed: ${response.status} ${value.error}`);
 reportTemplate=value.template.id;fs.writeFileSync(out+'/template-manifest.json',JSON.stringify({file,templateId:reportTemplate,templateHash,bytes:bytes.length,template:value.template},null,2));
 log({event:'template_uploaded',templateId:reportTemplate,templateHash,bytes:bytes.length,compatibility:value.template.compatibility});
}
const selected=process.env.PPT_BENCHMARK_CASES?.split(',');
const variants=(process.env.PPT_BENCHMARK_LEVELS||'legacy_single_model,fast,balanced,rigorous').split(',');
const repetitions=Number(process.env.PPT_BENCHMARK_REPETITIONS||1);
const roleModels=process.env.PPT_BENCHMARK_ROLE_MODELS_FILE?JSON.parse(fs.readFileSync(process.env.PPT_BENCHMARK_ROLE_MODELS_FILE,'utf8')):{};
const routingProfile=process.env.PPT_BENCHMARK_ROLE_MODELS_FILE?'explicit-compatibility-pool':'same-model-baseline';
fs.mkdirSync(out+'/sources',{recursive:true});
benchmark: for(const sample of cases.filter(item=>!selected||selected.includes(item.id))){
 const sourceHash=crypto.createHash('sha256').update(sample.text).digest('hex');fs.writeFileSync(`${out}/sources/${sample.id}.md`,sample.text);
 for(const qualityLevel of variants)for(let repeat=1;repeat<=repetitions;repeat++){
  if(process.env.PPT_BENCHMARK_STOP_FILE&&fs.existsSync(process.env.PPT_BENCHMARK_STOP_FILE)){log({event:'stopped_between_cases',case:sample.id,qualityLevel,repeat});break benchmark;}
  let projectId,terminal=false;const started=Date.now(),readFailuresAtStart=readTransportFailures.length;
  try{
   const ref={configId:'byok:'+service.providerId,model:service.model,...(process.env.PPT_BENCHMARK_THINKING_CONTROL==='1'?{thinkingControl:true}:{})};
   const executionPolicy=qualityLevel==='legacy_single_model'?undefined:{version:1,qualityLevel,roleRoutes:Object.fromEntries(['source_organizer','planner','writer_fast','writer_standard','writer_reasoning','critic'].map(role=>[role,{primary:roleModels[role]?{configId:ref.configId,...roleModels[role]}:ref,fallbacks:[]}])),budget:{maxAttemptsPerTask:5}};
   const template=sample.id.startsWith('template-')?reportTemplate:'violet';
   if(!template)throw new Error('Old-report template sample requires PPT_BENCHMARK_TEMPLATE; not silently replaced with a system template');
   let p=(await api('POST','projects',{inputKind:'paste',text:sample.text,prompt:'Create a complete, readable presentation from this material. Preserve required facts, figures and conditions. Titles use the predominant source language. Include a closing thank-you. Do not invent facts.',title:sample.name,template,...(sample.pages?{pages:sample.pages}:{}),...(sample.templateContentMode?{templateContentMode:sample.templateContentMode,templateFixedObjectIds:sample.templateFixedObjectIds||[]}:{}),configId:ref.configId,model:ref.model,executionPolicy,generationPolicy:{version:1,detail:'balanced',content:'full_source',details:'slides',knowledge:'source_only',images:'source',language:{mode:'source',body:'both'},code:{presentation:'keep'}}})).project;
   projectId=p.id;log({event:'created',case:sample.id,qualityLevel,repeat,projectId,sourceHash,codeHash:service.codeHash});let confirmed=false,firstPageMs;
   while(Date.now()-started<caseTimeoutMs){
    p=(await api('GET','projects/'+projectId+'?view=live')).project;
    if(firstPageMs===undefined&&Object.values(p.runtime?.slides||{}).some(row=>row.phase==='render_ready'))firstPageMs=Date.now()-started;
    if(p.status==='outline_ready'&&!confirmed){p=(await api('GET','projects/'+projectId)).project;p=(await api('PATCH',`projects/${projectId}/outline`,{slides:p.outline,finalPageCount:p.outline.length,pageSource:p.pageDecision?.source==='user'?'user':'estimate',template:p.template,generationPolicy:p.generationPolicy})).project;confirmed=true;await api('POST',`projects/${projectId}/generate`,{outlineRevision:p.outlineRevision,outlineHash:p.confirmedOutline?.hash});}
    if(['failed','completed','quality_blocked','paused'].includes(p.status))break;
    await new Promise(resolve=>setTimeout(resolve,1500));
   }
   terminal=['failed','completed','quality_blocked','paused'].includes(p.status);
   const deadlineExceeded=!terminal;
   p=(await api('GET','projects/'+projectId)).project;
   if(deadlineExceeded&&['ingesting','outlining','generating'].includes(p.status)){p=await pauseUntilTerminal(projectId);terminal=true;log({event:'paused_after_client_deadline',projectId,basis:'Bounded observation expired; retain the unfinished checkpoint without overlapping the next case'});}
   const passed=p.status==='completed'&&Boolean(p.publishedRevision)&&!sample.expectedSourceConflict;
   fs.writeFileSync(`${out}/${sample.id}-${qualityLevel}-${repeat}-${projectId}.json`,JSON.stringify(p,null,2));
   const artifacts={};
   if(passed)for(const [route,extension] of [['export','pptx'],['pdf','pdf']]){
    const bytes=await request('GET',`projects/${projectId}/${route}`,undefined,true);if(extension==='pptx'&&bytes.subarray(0,2).toString()!=='PK'||extension==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw new Error(`Invalid ${extension} artifact`);
    const name=`${sample.id}-${qualityLevel}-${repeat}-${projectId}.${extension}`;fs.writeFileSync(path.join(out,name),bytes);artifacts[extension]={name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
   }
   fs.writeFileSync(`${out}/${sample.id}-${qualityLevel}-${repeat}-${projectId}.json`,JSON.stringify(p,null,2));
   const usageRows=p.executionHistory?.length?p.executionHistory:p.modelUsage||[],usage=usageRows.map(row=>row.telemetry||row);
   const usageTotal=key=>usage.some(row=>Number.isFinite(row[key]))?usage.reduce((n,row)=>n+(Number.isFinite(row[key])?row[key]:0),0):null;
   log({event:'result',case:sample.id,qualityLevel,repeat,projectId,sourceHash,codeHash:service.codeHash,template:{id:p.template,sha256:p.templateFidelity?.sha256||p.templateSpec?.sha256||null,contractHash:crypto.createHash('sha256').update(JSON.stringify(p.templateSpec||{})).digest('hex'),contentMode:p.templateContentMode||null},routingProfile,roleModels,artifacts,visualReview:'pending',clientDeadlineMs:caseTimeoutMs,deadlineExceeded,status:p.status,passed,error:p.error||(deadlineExceeded?'Benchmark client deadline exceeded; unfinished project preserved and controlled pause required.':''),firstPageMs,elapsedMs:Date.now()-started,pages:p.deck?.slides?.length,models:[...new Set(usageRows.map(row=>row.model))],inputTokens:usageTotal('inputTokens'),outputTokens:usageTotal('outputTokens'),usageUnknownRecords:usage.filter(row=>!Number.isFinite(row.inputTokens)||!Number.isFinite(row.outputTokens)).length,costStatus:'unknown',readTransportRetries:readTransportFailures.length-readFailuresAtStart,evidence:'real provider / production pipeline; visual and exported-file review still separate'});
  }catch(error){
   if(projectId){try{const current=(await api('GET','projects/'+projectId)).project;fs.writeFileSync(`${out}/${sample.id}-${qualityLevel}-${repeat}-${projectId}-client-failure.json`,JSON.stringify(current,null,2));terminal=['failed','completed','quality_blocked','paused','outline_ready','cancelled'].includes(current.status);if(current.status==='outline_ready')log({event:'retained_unconfirmed_outline',projectId,basis:'Confirmation was rejected; no active generation exists to pause'});if(!terminal){await pauseUntilTerminal(projectId);terminal=true;log({event:'paused_after_client_failure',projectId,basis:'Do not abandon a live benchmark project or overlap subsequent cases'});}}catch(cleanupError){log({event:'client_failure_cleanup_unconfirmed',projectId,error:cleanupError.message});throw new Error('Benchmark stopped because the failed client request left an unconfirmed active project');}}
   const expected=Boolean(sample.expectedSourceConflict&&/^422: 原始输入的分组数量矛盾/u.test(error.message));log({event:'result',case:sample.id,qualityLevel,repeat,projectId,sourceHash,codeHash:service.codeHash,passed:expected,outcome:expected?'expected_source_conflict':'failed',error:error.message,elapsedMs:Date.now()-started});}finally{if(projectId&&terminal&&process.env.PPT_BENCHMARK_ARCHIVE==='1'){await api('POST',`projects/${projectId}/trash`,{});log({event:'archived',projectId,case:sample.id,qualityLevel,repeat,basis:'Isolated benchmark only; reversible trash after evidence snapshot'});}}
 }
}
const expectedRuns=cases.filter(item=>!selected||selected.includes(item.id)).length*variants.length*repetitions;
log({event:'summary',codeHash:service.codeHash,expectedRuns,finished:resultRows.length,passed:resultRows.filter(row=>row.passed).length,failed:resultRows.filter(row=>!row.passed).length,interrupted:resultRows.length!==expectedRuns});
if(resultRows.some(row=>!row.passed)||resultRows.length!==expectedRuns)process.exitCode=1;
