import {prepareLocalPptFonts} from '../../apps/cowork-server/test/ppt-local-fonts.mjs';
/** Regression of a recorded user's page in an isolated state. Only modelCall
 * is simulated; proposal, commands, gates, preview and native export are real. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const [input,outArg]=process.argv.slice(2),out=path.resolve(outArg||'outputs/ppt-empty-component-repair-20261028');
if(!input)throw Error('usage: replay-empty-component-local-edit.mjs <GET-project snapshot.json> <output>');
fs.mkdirSync(out,{recursive:true});prepareLocalPptFonts(out);process.env.COWORK_STATE_DIR=path.join(out,'state');
const lib=name=>import('../../apps/cowork-server/lib/'+name+'.mjs');
const [repo,proposals,quality,coverage,regions,fidelity,ir,{localPptRuntime}]=await Promise.all(['ppt/repository','ppt/proposal-service','ppt/quality-service','ppt-card-coverage','ppt-component-regions','ppt-template-fidelity','ppt/ir'].map(lib).concat(import('../../apps/cowork-server/test/ppt-local-runtime.mjs')));
const original=JSON.parse(fs.readFileSync(input,'utf8')),p=original.project||original,slideId=p.deck.slides[5].id,baseline=structuredClone(p);
const template=path.join(out,'original-template.pptx');fs.copyFileSync(p.templateFidelity.originalPath,template);p.templateFidelity.originalPath=template;
repo.saveProject(p);repo.saveRevision(p,'isolated recorded baseline');
const recordings=[],log=()=>{},activity=()=>{};
const report={basis:'recorded real project; simulated modelCall; production proposals/commands/gates/export',projectId:p.id,slideId,baselineRevision:p.revision,checks:{},modelCalls:recordings};
function auditReply(project,prompt){
 const slide=project.deck.slides.find(s=>s.id===slideId),page=project.outline.find(p=>p.id===slideId),objects=JSON.parse(prompt.split('\nVisible: ')[1].split('\n</card_point_coverage_audit>')[0]).filter(n=>n.text),body=objects.map(n=>n.text).join('\n');
 const contains=need=>need.every(term=>body.includes(term));
 return {unsupported:[],points:page.keyPoints.map((point,i)=>({id:coverage.pointIdentity(page,i),preserved:i===0?contains(['LLM','候选','编译','开发']):contains(['冻结','独立','外部测试','决策']),nodeIds:objects.map(n=>n.id),quotes:objects.map(n=>n.text),reason:'Recorded fixture checks the two process chains, original step order, development data and independent frozen outer-test boundary.'}))};
}
const record=(key,prompt,result)=>{recordings.push({key,promptSha256:crypto.createHash('sha256').update(prompt).digest('hex'),result});return result;};
const english=['Researcher/LLM -> candidate card -> compiler -> evaluator on development','Frozen candidate -> separate outer-test evaluator -> decision record'];
const chinese=['Researcher/LLM->候选卡片->编译器->开发评估器','冻结候选->独立外部测试评估器\n->决策记录'];
const ids=p.deck.slides[5].nodes.filter(n=>n.semanticRole==='source-explanation').map(n=>n.id);
// Replay both recorded responses: the old capacity retry now reaches semantic
// coverage instead of discarding the translated point on lexical grounds.
const deps={modelCall:async(project,prompt,_a,_l,o={})=>{if(o.nodeKey.startsWith('review:card-points:'))return record(o.nodeKey,prompt,auditReply(project,prompt));const second=o.nodeKey.endsWith(':fit');return record(o.nodeKey,prompt,{patches:ids.map((id,i)=>({nodeId:id,content:{text:second?chinese[i]:english[i]+'\n'+['研究员/LLM -> 候选卡片 -> 编译器 -> 开发集上的评估器','冻结的候选者 -> 独立的外部测试评估器 -> 决策记录'][i]}}))});}};
const replay=await proposals.createProposal(p,{slideId,scope:'slide',type:'content',instruction:'补充中文说明',baseRevision:p.revision},deps,activity,log);
assert.equal(replay.cardPointCoverage.points.length,2);assert.ok(recordings.some(c=>c.key.endsWith(':fit')));report.checks.recordedCapacityThenTranslation=true;
await proposals.discardProposal(p.uid,p.id,replay.id);
const all=regions.templateContentContainers(p,p.deck.slides[5],5),texts=['研究员 / LLM\n→ 候选卡片','候选卡片 → 编译器\n→ 开发集上的评估器','冻结候选\n→ 独立外部测试评估器\n→ 决策记录'];
assert.equal(all.length,3);
const fillDeps={modelCall:async(project,prompt,_a,_l,o={})=>o.nodeKey.startsWith('review:card-points:')?record(o.nodeKey,prompt,auditReply(project,prompt)):record(o.nodeKey,prompt,{components:all.map((c,i)=>({id:c.id,text:texts[i],pointIds:[coverage.pointIdentity(p.outline[5],i===2?1:0)]}))})};
const proposal=await proposals.createProposal(p,{slideId,scope:'slide',type:'content',instruction:'请根据本页来源补充方框内的内容，保持标题和其他页面',baseRevision:p.revision},fillDeps,activity,log);
const {materializeTypedCandidate}=await lib('ppt/typed-proposal');const concurrent=structuredClone(p);concurrent.deck.slides[8].nodes.find(n=>n.type==='text').content.text+=' later manual change';const rebased=materializeTypedCandidate(concurrent,proposal);assert.deepEqual(rebased.deck.slides[8].nodes,ir.ensureDeckV3(concurrent.deck).slides[8].nodes,'a fill proposal must not roll back a later edit on another page');report.checks.concurrentOtherPagePreserved=true;
assert.equal(proposal.mode,'fill-component');assert.equal(repo.getProject(p.uid,p.id).revision,p.revision);fs.writeFileSync(out+'/before.svg',proposal.beforeSvg);fs.writeFileSync(out+'/after.svg',proposal.afterSvg);
const applied=await proposals.applyProposal(p.uid,p.id,proposal.id),again=await proposals.applyProposal(p.uid,p.id,proposal.id);assert.equal(again.idempotent,true);let next=applied.project;
for(const prior of ir.ensureDeckV3(p.deck).slides.filter(s=>s.id!==slideId)){const current=next.deck.slides.find(s=>s.id===prior.id);assert.deepEqual(current.nodes,prior.nodes,'unselected canonical objects unchanged: '+prior.id);assert.deepEqual(current.templateSlotTexts,prior.templateSlotTexts);assert.deepEqual(current.templateOmissions,prior.templateOmissions);}
assert.equal(regions.inspectEmptyTemplateComponents(next).length,0);assert.equal(next.deck.slides[5].nodes.filter(n=>n.templateComponentBinding?.containerNodeId).length,3);
report.checks.fillPreviewApplyIdempotent=true;report.checks.otherNineSlidesUnchanged=true;
const restored=await proposals.restoreProposalVersion(next,proposal.id,{side:'before',baseRevision:next.revision});assert.deepEqual(restored.project.deck.slides[5].nodes,ir.ensureDeckV3(p.deck).slides[5].nodes);
const redone=await proposals.restoreProposalVersion(restored.project,proposal.id,{side:'after',baseRevision:restored.project.revision});next=redone.project;report.checks.undoAndRestore=true;
await assert.rejects(()=>proposals.createProposal(next,{slideId,scope:'slide',instruction:'补充空框内容',baseRevision:p.revision},fillDeps,activity,log),/refresh/);report.checks.staleRevisionRejected=true;
const reviewed=quality.reviewProject(next);report.quality={hardErrors:reviewed.deterministic.hardErrors,issues:reviewed.deterministic.issues.map(({code,severity,slideId,message})=>({code,severity,slideId,message}))};
assert.equal(report.quality.hardErrors,0,JSON.stringify(report.quality.issues.filter(i=>i.severity==='error')));
const runtime=localPptRuntime(out+'/export',process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const exportProject={...reviewed.project,renderOutput:'/workspace/Research-Loop-Component-Repair.pptx'};
const exported=await fidelity.renderTemplatePptx(exportProject,runtime.io);report.export=exported.exportVerification;assert.equal(report.export.status,'passed');
report.pptx=runtime.host(exportProject,exportProject.renderOutput);fs.copyFileSync(report.pptx,out+'/Research-Loop-Component-Repair-10p.pptx');
fs.writeFileSync(out+'/repaired-project.json',JSON.stringify(next));report.checks.nativeExportVerified=true;
const {publishProject}=await lib('ppt/publish-service');const published=await publishProject(next.uid,next.id,{renderPptx:project=>fidelity.renderTemplatePptx(project,runtime.io)},activity,log);assert.equal(published.published,true,'formal publication must retain the scoped semantic proof after frame measurement');report.checks.formalPublication=true;report.publishedRevision=published.project.publishedRevision;report.publishedArtifactPath=published.project.publishedArtifactPath;fs.copyFileSync(runtime.host(published.project,published.project.publishedArtifactPath),out+'/Research-Loop-Component-Repair-10p.pptx');
fs.writeFileSync(out+'/acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({output:out,checks:report.checks,hardErrors:report.quality.hardErrors,export:report.export.status,pptx:out+'/Research-Loop-Component-Repair-10p.pptx'}));
