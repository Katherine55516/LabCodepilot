import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-density-audit-'));
process.env.COWORK_STATE_DIR=root;
const [packing,capacity,qa,artifacts,prompts,fidelity,{normalizePaste}]=await Promise.all([
  import('./lib/ppt-density-packing.mjs'),import('./lib/ppt-density-capacity.mjs'),import('./lib/ppt-density-qa.mjs'),
  import('./lib/ppt-source-artifacts.mjs'),import('./lib/ppt-prompt-contracts.mjs'),import('./lib/ppt-template-fidelity.mjs'),import('./lib/ppt-source.mjs')]);
const [evidence,inventory,versioning]=await Promise.all([import('./lib/ppt-evidence.mjs'),import('./lib/ppt-content-inventory.mjs'),import('./lib/ppt/versioning.mjs')]);
const failures=[];let passed=0;
async function check(label,run){try{await run();passed++;}catch(error){failures.push({label,error:String(error.message)});}}
const source=normalizePaste('# Validation\n\n## Comparison\n\n| Object | Condition |\n|---|---|\n| Queue | Before execution |\n| Result | After review |\n\n## Checklist\n\n- Verify owner.\n- Confirm evidence.\n\n## Summary\n\nValidation connects the result to evidence and the responsible owner.');
const table=source.semantic.inventory.items.find(i=>i.type==='TableBlock'),checklist=source.semantic.inventory.items.find(i=>i.type==='ChecklistBlock');
const auto={id:'audit',pages:4,source,pageDecision:{source:'estimate',mode:'auto',confirmedAt:null}};
const body=(id,question='How is validation performed?')=>({id,title:id,question,focus:'Review the evidence before the decision.',groupId:'same-group',keyPoints:[{text:'Review the evidence before the decision.'}],refs:[],chunkRefs:[]});
const raw=(a=body('a'),b=body('b'))=>({slides:[{id:'cover',title:'Validation',refs:[]},a,b,{id:'end',title:'Summary',keyPoints:[{text:'Retain the owner and evidence.'}],refs:[]}]});
const native={...auto,templateFidelity:{width:12192000,height:6858000,slides:[{}, {slots:[{role:'content',purpose:'body',shapeId:2,capacity:200,maxLines:10,lineVisualUnits:20}],nodes:[{id:'native-body',nativeRef:{shapeId:2},type:'text',geometry:{x:1828800,y:2286000,width:3657600,height:1828800},style:{fontSizePt:24,fontWeight:400},content:{text:'Body'}}]}]}};
try {
  await check('different questions override a shared group ID',()=>assert.equal(packing.packOutline(auto,raw(body('a','One question'),body('b','Another question'))).slides.length,4));
  await check('ranges only belong to real tables',()=>assert.throws(()=>packing.packOutline(auto,raw({...body('a'),sourceUnitIds:[checklist.id],sourceArtifactRanges:[{sourceUnitId:checklist.id,rowStart:1,rowEnd:2}]})),/table|range/i));
  await check('overlapping ranges on one candidate are rejected',()=>assert.throws(()=>packing.packOutline(auto,raw({...body('a'),sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:3},{sourceUnitId:table.id,rowStart:2,rowEnd:3}]})),/overlap|range/i));
  await check('explicit non-array ownership gives a contract error',()=>assert.throws(()=>packing.packOutline(auto,raw({...body('a'),sourceUnitIds:42})),/source unit/i));
  await check('native content rectangle is respected',()=>{const result=capacity.contentCanvas(native);assert.equal(result.geometry.x,1828800);assert.equal(result.geometry.width,3657600);assert.equal(result.geometry.y,2286000);assert.ok(result.geometry.height<=1828800);});
  await check('native 24pt body is not silently reduced to 18pt',()=>assert.equal(capacity.contentCanvas(native).fontSizePt,24));
  await check('empty component lists have no capacity proof',()=>assert.equal(capacity.fitComponents([],auto).capacity_ok,false));
  await check('an owned summary participates in preflight',()=>{const summary={id:'summary',type:'SummaryBlock',text:'Necessary explanation '.repeat(1000),must_preserve_structure:false,source_ref:[],chunkRefs:[]};const result=packing.candidateFit({...body('a'),sourceUnitIds:['summary']},{...auto,source:{semantic:{inventory:{items:[summary]}}}});assert.ok(result.predictedOverflow>0);});
  await check('opacity zero cannot count as visible depth',()=>assert.equal(qa.inspectDensity(auto,[{id:'cover',nodes:[]},{id:'a',nodes:[{type:'text',semanticRole:'body',style:{opacity:0},content:{text:'Invisible explanation '.repeat(100)}}]}]).metrics.visibleDensityPerSlide[1].actualTextChars,0));
  await check('empty pages do not receive a fitted merge suggestion',()=>{const project={...auto,outline:raw().slides};const result=qa.inspectDensity(project,project.outline.map(s=>({...s,nodes:[{type:'text',hidden:true,content:{text:'Hidden'}}]})));assert.equal(result.metrics.densityMergeCandidates.length,0);});
  await check('source structure rebinding replaces old source nodes',()=>{const project={...auto,planning:{slidePlan:[{slideId:'a',sourceArtifacts:[{sourceUnitId:table.id}]}]}};const slide={id:'a',nodes:[]};artifacts.bindSourceArtifacts(project,slide,[{sourceUnitId:table.id}],1,['Initial explanation.']);artifacts.bindSourceArtifacts(project,slide,[{sourceUnitId:table.id}],1,['Revised explanation.']);assert.equal(slide.nodes.length,2);assert.equal(new Set(slide.nodeOrder).size,slide.nodeOrder.length);assert.ok(!JSON.stringify(slide.nodes).includes('Initial explanation.'));});
  await check('native slot prompt supports the source replacement branch',()=>{const text=fidelity.templateSlotPrompt(native,1);assert.doesNotMatch(text,/slotTexts 是本页唯一正文输出/);assert.match(text,/sourceCommentary/);});
  await check('repair prompt carries the actual artifact selection and explanation',()=>{const draft={title:'Validation',nodes:[{sourceArtifact:{sourceUnitId:table.id,rowStart:1,rowEnd:2},type:'table',content:{rows:table.rows}},{semanticRole:'source-explanation',type:'text',content:{text:'EXPLANATION_SENTINEL'}}]};const text=prompts.writerRepairPrompt('writer',draft,[{code:'density'}]);assert.match(text,/EXPLANATION_SENTINEL/);assert.match(text,/"rowEnd":2/);assert.match(text,/"sourceArtifacts"/);});
  await check('merging an implicit full table with a fragment retains all rows',()=>{const full={...body('a'),sourceUnitIds:[table.id]},partial={...body('b'),sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:2,rowEnd:3}]};const result=packing.packOutline(auto,raw(full,partial));assert.equal(result.slides.length,3);assert.deepEqual(result.slides[1].sourceArtifactRanges,[{sourceUnitId:table.id,rowStart:1,rowEnd:3}]);});
  await check('native footer zones are reserved',()=>{const copy=structuredClone(native);copy.templateFidelity.slides[1].slots.push({shapeId:3,role:'content',purpose:'footnote'});copy.templateFidelity.slides[1].nodes.push({nativeRef:{shapeId:3},type:'text',geometry:{x:1828800,y:3657600,width:3657600,height:182880},style:{fontSizePt:10},content:{text:'Footer'}});const canvas=capacity.contentCanvas(copy);assert.ok(canvas.geometry.y+canvas.geometry.height<3657600);assert.equal(canvas.fontSizePt,24);});
  await check('merge suggestions cannot shrink existing 36pt text',()=>{const outline=raw().slides,slides=outline.map((s,i)=>({...s,nodes:i===1||i===2?[{type:'text',semanticRole:'body',style:{fontSizePt:36},content:{text:'Necessary mechanism and condition. '.repeat(10)}}]:[]}));const result=qa.inspectDensity({...auto,outline},slides);assert.equal(result.metrics.densityMergeCandidates.length,0);});
  await check('underfill denominator excludes section pages',()=>{const slides=[{id:'cover',nodes:[]},{id:'section',nodes:[]},{id:'body',nodes:[{type:'text',content:{text:'A short explanation.'}}]}];const result=qa.inspectDensity({...auto,source:{text:'rich '.repeat(2000)},planning:{slidePlan:[{slideId:'section',role:'section'},{slideId:'body',role:'body'}]}},slides);assert.equal(result.metrics.densityUnderfillRate,1);});
  await check('source explanations remain visible beside native structures',()=>{const slide={title:'Validation',nodes:[{type:'text',nativeRef:{shapeId:1},content:{text:'Validation'}},{type:'table',sourceArtifact:{sourceUnitId:table.id},content:{rows:table.rows}},{type:'text',semanticRole:'source-explanation',content:{text:'EXPLANATION_VISIBLE'}}]};assert.match(evidence.visibleSlideText(slide),/EXPLANATION_VISIBLE/);});
  await check('evidence text ignores hidden transparent and omitted native nodes',()=>{const slide={title:'Validation',templateSlotTexts:{2:'STALE_DRAFT'},templateOmissions:[{shapeId:4}],nodes:[{type:'text',nativeRef:{shapeId:1},content:{text:'Validation'}},{type:'text',nativeRef:{shapeId:2},hidden:true,content:{text:'HIDDEN_FACT'}},{type:'text',nativeRef:{shapeId:3},style:{opacity:0},content:{text:'TRANSPARENT_FACT'}},{type:'text',nativeRef:{shapeId:4},content:{text:'OMITTED_FACT'}}]};assert.doesNotMatch(evidence.visibleSlideText(slide),/FACT|STALE_DRAFT/);});
  await check('hidden source structures do not satisfy inventory retention',()=>{const slide={title:'Validation',nodes:[{type:'table',sourceArtifact:{sourceUnitId:table.id},hidden:true,content:{rows:table.rows}}]};const result=inventory.inspectInventoryCoverage(source,[slide],evidence.visibleSlideText);const item=result.metrics.items.find(i=>i.id===table.id);assert.equal(item.structureRetained,false);assert.equal(item.cellRecall,0);});
  await check('opaque source explanations satisfy required evidence',()=>{const atom={id:'measurement',kind:'number',measurements:[{raw:'10 GB',value:'10',unit:'gb'}],contextTerms:[]};const slide={nodes:[{type:'table',sourceArtifact:{sourceUnitId:table.id},content:{rows:table.rows}},{type:'text',semanticRole:'source-explanation',content:{text:'The validation requires 10 GB.'}}]};assert.equal(evidence.missingRequiredEvidence({source:{semantic:{evidenceAtoms:[atom]}}},slide,{requiredEvidenceIds:['measurement']}).length,0);});
  await check('critic components exclude transparent and omitted structures',()=>{const slide={templateOmissions:[{shapeId:2}],nodes:[{type:'table',style:{opacity:0},content:{rows:table.rows}},{type:'table',nativeRef:{shapeId:2},content:{rows:table.rows}}]};assert.equal(prompts.slideSemanticContext(slide).components.length,0);});
  await check('visibility edits invalidate the semantic review key',()=>{const project={deck:{slides:[{id:'a',nodes:[{id:'fact',type:'text',content:{text:'Retained fact'},style:{opacity:1}}]}]}};const before=versioning.semanticReviewKey(project);project.deck.slides[0].nodes[0].style.opacity=0;assert.notEqual(versioning.semanticReviewKey(project),before);const transparent=versioning.semanticReviewKey(project);project.deck.slides[0].templateOmissions=[{shapeId:2}];assert.notEqual(versioning.semanticReviewKey(project),transparent);});
  await check('packing preserves required support from both pages',()=>{const result=packing.packOutline(auto,raw({...body('a'),requiredSupport:['mechanism']},{...body('b'),required_support:['condition']}));assert.equal(result.slides.length,3);assert.deepEqual(result.slides[1].requiredSupport,['mechanism','condition']);});
  await check('both locked-title spellings prevent automatic merging',()=>assert.equal(packing.packOutline(auto,raw({...body('a'),title_locked:true},body('b'))).slides.length,4));
  const api=await import('./lib/ppt-api.mjs');
  await check('fits are measured against the final native slide assignment',()=>{
    const width=12192000,height=6858000;
    const imported={externalPptx:{width,height,originalPath:'/tmp/audit-template.pptx'},deck:{slides:Array.from({length:4},(_,index)=>({nodes:[
      {id:`title-${index}`,type:'text',nativeRef:{shapeId:1,slideIndex:index},geometry:{x:640000,y:400000,width:9000000,height:650000},style:{fontSizePt:30,fontWeight:700},content:{text:index===0?'Cover':index===3?'Conclusion':'Topic'}},
      {id:`body-${index}`,type:'text',nativeRef:{shapeId:2,slideIndex:index},geometry:{x:900000,y:2000000,width:index===3?5000000:8500000,height:3000000},style:{fontSizePt:index===3?24:18},content:{text:'A complete mechanism, condition and comparison.'}}]}))}};
    const project={...auto,templateFidelity:fidelity.fidelityFromImported({...auto,pages:4},imported,'audit-template')};
    const assessed=api._internals.assessOutlineCandidate(project,raw());
    assert.equal(assessed.project.pages,3);assert.ok(assessed.rawOutline.densityPacking.templateAssignmentValidated);
    assert.equal(project.pages,4,'assessment must not mutate stored page count');
    const fit=assessed.outline.at(-1).densityFit,canvas=capacity.contentCanvas(assessed.project,2);
    assert.deepEqual(fit.availableContentRect,canvas.geometry);assert.equal(fit.fontSizePt,canvas.fontSizePt);
    assert.deepEqual(assessed.rawOutline.densityPacking.templateSlideMap,assessed.project.templateFidelity.slideMap);
  });
  await check('a malformed model selection gets one bounded outline repair',async()=>{
    const store=await import('./lib/ppt-store.mjs');let calls=0;
    const good={brief:{presentationUse:'course_walkthrough'},...raw({...body('a','Compare the conditions'),sourceUnitIds:[table.id],chunkRefs:table.chunkRefs,refs:table.source_ref},{...body('b','Check responsibility'),sourceUnitIds:[checklist.id],chunkRefs:checklist.chunkRefs,refs:checklist.source_ref})};
    good.slides.at(-1).sourceUnitIds=[source.semantic.inventory.items.find(i=>i.type==='SummaryBlock').id];
    const deps={...api._internals.defaultDeps,modelCall:async(p,prompt)=>{calls++;if(calls===1)return {...good,slides:good.slides.map((s,i)=>i===1?{...s,sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:'bad',rowEnd:3}]}:s)};assert.match(prompt,/初稿结构检查/);return good;}};
    const req=Readable.from([Buffer.from(JSON.stringify({inputKind:'paste',text:source.text,prompt:'Explain validation',template:'light',configId:'simulated',model:'simulated'}))]);req.method='POST';let response;
    await api.handlePpt(req,new URL('http://test/ppt/projects'),{uid:'audit',deps,activity:()=>{},log:()=>{},res:{},send:(status,body)=>{response={status,body};return true;}});
    assert.equal(response.status,201,JSON.stringify(response));
    let project;for(let n=0;n<200;n++){project=store.get('audit',response.body.project.id);if(['outline_ready','failed'].includes(project.status))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(project.status,'outline_ready',project.error);assert.equal(calls,2);assert.equal(project.pageDecision.confirmedAt,null);
  });
  console.log(JSON.stringify({passed,failures},null,2));
  if(failures.length)process.exitCode=1;
} finally {fs.rmSync(root,{recursive:true,force:true});}
