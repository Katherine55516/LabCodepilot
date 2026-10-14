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
  await check('rich source uses free space below real native headers without overlapping them',()=>{
    const p=structuredClone(native),inch=914400;
    p.source.text='Source authority. '.repeat(600);
    const spec=p.templateFidelity.slides[1];
    spec.slots.push({role:'title',shapeId:1,fontSizePt:36});
    spec.nodes[0].geometry={x:inch*.7,y:inch*2.5,width:inch*10,height:inch*4};spec.nodes[0].style.fontSizePt=14.5;
    spec.nodes.push({id:'native-title',type:'text',nativeRef:{shapeId:1},content:{text:'Model assumptions'},geometry:{x:inch*.7,y:inch*.5,width:inch*10,height:inch*.7},style:{fontSizePt:36}});
    const canvas=capacity.contentCanvas(p,1).geometry;
    assert.ok(canvas.y>=inch*1.2+inch*.08);assert.ok(canvas.y<inch*1.875);
    const complete='Expected returns reflect covariance with the market portfolio when all investors share assumptions. '.repeat(10);
    const fit=capacity.fitComponents([{type:'text',content:{text:complete}}],p,1);
    assert.equal(fit.capacity_ok,true);assert.ok(complete.length>900);
    assert.ok(fit.boxes[0].y>=canvas.y);assert.ok(fit.boxes[0].y+fit.boxes[0].height<=canvas.y+canvas.height);
  });
  await check('prompt compaction losslessly deduplicates an identical document while retaining input authority and tail conditions',async()=>{
    const {inputFramework,compactFramework}=await import('./lib/ppt-input-scope.mjs');
    const project={...auto,prompt:source.text};const original=inputFramework(project),before=JSON.stringify(original),view=compactFramework(original);
    assert.equal(view.frameworkHash,original.frameworkHash);assert.equal(view.material.sourceText,source.text);assert.equal(view.material.promptRef,'sourceText');
    assert.equal(view.material.sourceText.endsWith('responsible owner.'),true);assert.equal(JSON.stringify(original),before);
    const distinct=compactFramework(inputFramework({...project,prompt:'Explain the supplied material without new topics.'}));
    assert.equal(distinct.material.prompt,'Explain the supplied material without new topics.');
  });
  await check('writer JSON uses actual frozen table fragments and never invents row ranges for formulas',()=>{
    const equation={id:'formula',type:'EquationBlock',text:'$$r_i = a_i + b_i f + e_i$$',must_preserve_structure:true};
    const project=structuredClone(native);project.templateFidelity.mode='preserve';project.source.semantic.inventory.items=[table,equation];
    const slide={...body('source'),sourceUnitIds:[table.id,equation.id]};
    const contract={sourceArtifacts:[{sourceUnitId:table.id,rowStart:2,rowEnd:3,type:'TableBlock'},{sourceUnitId:equation.id,type:'EquationBlock'}]};
    const prompt=prompts.writerPrompt(project,slide,1,{retrieval:{},contract});
    const schema=JSON.parse(prompt.match(/返回唯一 JSON：(.*)。只输出 JSON。/s)[1]);
    assert.deepEqual(schema.sourceArtifacts,[{sourceUnitId:table.id,rowStart:2,rowEnd:3},{sourceUnitId:equation.id}]);
    const owned=JSON.parse(prompt.match(/<page_owned_source_content>(.*?)<\/page_owned_source_content>/s)[1]);
    assert.deepEqual(owned[0].content.rows,[table.rows[0],table.rows[2]],'writer ownership view must exclude adjacent table rows without altering immutable source');
    assert.match(prompt,/frozen_source_selection/);assert.match(prompt,/sourceCommentaryHeightInches/);
    assert.equal(Object.keys(schema.slotTexts).includes('2'),false,'a source-owned body region must not also be filled with duplicate native body prose');
  });
  await check('different questions override a shared group ID',()=>assert.equal(packing.packOutline(auto,raw(body('a','One question'),body('b','Another question'))).slides.length,4));
  await check('ranges only belong to real tables',()=>assert.throws(()=>packing.packOutline(auto,raw({...body('a'),sourceUnitIds:[checklist.id],sourceArtifactRanges:[{sourceUnitId:checklist.id,rowStart:1,rowEnd:2}]})),/table|range/i));
  await check('outline inventory and instructions expose the table end-exclusive contract',()=>{
    const shape=prompts.compactInventory(source.semantic.inventory).items.find(item=>item.id===table.id).tableShape;
    assert.deepEqual(shape.dataRowRange,{start:1,endExclusive:table.rows.length});
    assert.match(prompts.outlineContentContract(auto),/rowEnd 是不包含的结束索引/);
  });
  await check('a planner that uses data row count as rowEnd is told exactly which tail row is missing',()=>{
    const project={...auto,source:{semantic:{inventory:{items:[table]}}}};
    const incomplete={slides:[{title:'Cover'},{title:'Table',sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:table.rows.length-1}]}]};
    const issue=packing.inspectDensityOutline(incomplete,project).find(item=>item.code==='planned_source_object_missing');
    assert.ok(issue);assert.match(issue.message,new RegExp(`"missingDataRowIndexes":\\[${table.rows.length-1}\\]`));
    incomplete.slides[1].sourceArtifactRanges[0].rowEnd=table.rows.length;
    assert.equal(packing.inspectDensityOutline(incomplete,project).length,0);
    assert.deepEqual(capacity.sourceComponent(table,incomplete.slides[1].sourceArtifactRanges[0]).content.rows,table.rows);
  });
  await check('overflow feedback preserves actual native geometry and measured typography',()=>{
    const draft={...body('a'),keyPoints:[{text:'Necessary mechanism and conditions. '.repeat(200)}]};
    draft.densityFit=packing.candidateFit(draft,native,1);assert.ok(draft.densityFit.predictedOverflow>0);
    const issue=packing.inspectDensityOutline({slides:[{title:'Cover'},draft]},native).find(item=>item.code==='planned_density_overflow');
    assert.match(issue.message,/"fontSizePt":24/);assert.ok(issue.message.includes(JSON.stringify(draft.densityFit.availableContentRect)));
    assert.ok(issue.message.includes(`"overflowEMU":${draft.densityFit.predictedOverflow}`));
  });
  await check('measured table advice preserves contiguous complete rows without changing the outline',()=>{
    const large={...table,id:'large-table',rows:[['Object','Requirement'],...Array.from({length:12},(_,i)=>[`Option ${i+1}`,'Verify scope and owner'])]};
    const project=structuredClone(native);project.source.semantic.inventory.items=[large];
    project.templateFidelity.slides[1].nodes[0].geometry.width=7315200;project.templateFidelity.slides[1].nodes[0].geometry.height=3657600;
    const draft={...body('table'),sourceUnitIds:[large.id]},before=JSON.stringify(draft);
    const advice=packing.outlineCapacityAdvice(draft,project,1);assert.ok(advice.tableFragments.length>1);
    let row=1;const restored=[large.rows[0]];
    for(const fragment of advice.tableFragments){assert.equal(fragment.rowStart,row);assert.equal(fragment.capacity_ok,true);row=fragment.rowEnd;
      assert.equal(capacity.fitComponents([capacity.sourceComponent(large,fragment)],project,1).capacity_ok,true);
      restored.push(...capacity.sourceComponent(large,fragment).content.rows.slice(1));}
    assert.equal(row,large.rows.length);assert.deepEqual(restored,large.rows);assert.equal(JSON.stringify(draft),before);
  });
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
  await check('capacity feedback distinguishes intact source fit from excessive commentary',()=>{const project={...auto,planning:{slidePlan:[{slideId:'over-commented',sourceArtifacts:[{sourceUnitId:table.id}]}]}};assert.throws(()=>artifacts.bindSourceArtifacts(project,{id:'over-commented',nodes:[]},[{sourceUnitId:table.id}],1,Array.from({length:4},(_,i)=>({type:'mechanism',text:String(i)+' Necessary relationship with its original conditions. '.repeat(30)}))),error=>{assert.match(error.message,/source_artifact_capacity/);assert.match(error.message,/"sourceFits":true/);assert.match(error.message,/availableHeightInches/);return true;});});
  await check('explanation guidance measures actual complete-source capacity without truncating it',()=>{
    const components=[capacity.sourceComponent(table)],before=JSON.stringify(components);
    const budget=capacity.explanationBudget(components,auto,1);assert.ok(budget.sourceFits);assert.ok(budget.singleParagraphCjkCharacters>0&&budget.singleParagraphCjkCharacters<2000);
    assert.ok(capacity.fitComponents([...components,{type:'text',content:{text:'字'.repeat(budget.singleParagraphCjkCharacters)}}],auto,1).capacity_ok);
    assert.equal(capacity.fitComponents([...components,{type:'text',content:{text:'字'.repeat(budget.singleParagraphCjkCharacters+1)}}],auto,1).capacity_ok,false);
    assert.equal(JSON.stringify(components),before);
  });
  await check('title-only native cover cannot hide its title behind optional source prose',()=>{
    const project={templateFidelity:{slides:[{nodes:[],slots:[{shapeId:1,role:'title',capacity:20}]}]}};
    const slide={title:'Research',templateSlotTexts:{1:'Research'},sourceArtifactNodes:[{type:'text',semanticRole:'source-explanation',content:{text:'Repeated background context.'}}]};
    assert.ok(fidelity.inspectTemplateSlotDraft(project,0,slide).some(issue=>issue.code==='template_cover_body'&&issue.severity==='error'));
    slide.sourceArtifactNodes=[];assert.equal(fidelity.inspectTemplateSlotDraft(project,0,slide).length,0);
  });
  await check('locked source excerpts are bound visibly and still fail physical capacity',()=>{
    const atom={id:'locked-example',kind:'example',exactText:'Construction uses independent $2\\times3\\times3$ sorts on size, I/A, and ROE (27 portfolios).'};
    const project={...auto,source:{...source,semantic:{...source.semantic,evidenceAtoms:[atom]}},planning:{slidePlan:[{slideId:'bound',sourceArtifacts:[]}]}};
    const slide={id:'bound',nodes:[],sourceRefs:['1']};artifacts.bindSourceArtifacts(project,slide,[],1,[],[atom.id]);
    assert.equal(evidence.missingRequiredEvidence(project,slide,{requiredEvidenceIds:[atom.id]}).length,0);
    assert.deepEqual(slide.sourceArtifactNodes[0].content.sourceEvidenceIds,[atom.id]);assert.match(slide.sourceArtifactNodes[0].content.text,/27 portfolios/);
    assert.throws(()=>artifacts.bindSourceArtifacts(project,{id:'bound',nodes:[]},[],1,[],['unknown-evidence']),/evidence ID/);
    project.source.semantic.evidenceAtoms[0]={...atom,exactText:atom.exactText.repeat(100)};
    assert.throws(()=>artifacts.bindSourceArtifacts(project,{id:'bound',nodes:[]},[],1,[],[atom.id]),/source_artifact_capacity/);
  });
  await check('visible source explanation semantics survive binding and invalid types fail',()=>{const project={...auto,planning:{slidePlan:[{slideId:'typed',sourceArtifacts:[{sourceUnitId:table.id}]},{slideId:'bad',sourceArtifacts:[{sourceUnitId:table.id}]}]}};const slide={id:'typed',nodes:[]};artifacts.bindSourceArtifacts(project,slide,[{sourceUnitId:table.id}],1,[{type:'contrast',text:'The two controls differ in their timing requirements.'}]);assert.equal(slide.copy.blocks.at(-1).type,'contrast');assert.equal(slide.nodes.at(-1).content.pointType,'contrast');assert.throws(()=>artifacts.bindSourceArtifacts(project,{id:'bad',nodes:[]},[{sourceUnitId:table.id}],1,[{type:'point-description',text:'Invalid semantics'}]),/commentary/);});
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
  await check('writer contract correction catches malformed model JSON and gives exact semantic type feedback without retrying network failures',async()=>{
    let calls=0;const seen=[],spec={slots:[{shapeId:3,role:'content',purpose:'body'}]};
    const result=await api._internals.writeWithContractRepair({prompt:'FROZEN_SOURCE_SENTINEL',nodeKey:'content:test',call:async prompt=>{seen.push(prompt);calls++;if(calls===1)throw Error('模型未返回有效的结构化内容，请重试');return {slotTexts:{3:'The prediction follows from the mechanism.'},slotContentTypes:{3:calls===2?'prediction':'mechanism'}};},normalize:value=>prompts.canonicalWriterOutput(value,spec)});
    assert.equal(calls,3);assert.equal(result.content.contentBlocks[0].type,'mechanism');assert.ok(seen.every(prompt=>prompt.startsWith('FROZEN_SOURCE_SENTINEL')));assert.match(seen[2],/"received":"prediction"/);assert.match(seen[2],/"allowed"/);
    calls=0;await assert.rejects(api._internals.writeWithContractRepair({prompt:'source',nodeKey:'network',call:async()=>{calls++;throw Error('HTTP 429 upstream rate limit');},normalize:value=>value}),/429/);assert.equal(calls,1);
  });
  await check('unresolved writer capacity is bounded and never accepted as valid content',async()=>{let calls=0;await assert.rejects(api._internals.writeWithContractRepair({prompt:'source',nodeKey:'capacity',call:async()=>{calls++;return {commentary:'Too tall'};},normalize:()=>{throw Error('source_artifact_capacity: sourceFits=true, preserve every cell');}}),/source_artifact_capacity/);assert.equal(calls,4);});
  await check('foreign evidence IDs require bounded model correction and are never silently discarded',async()=>{
    let calls=0;
    const repaired=await api._internals.writeWithContractRepair({prompt:'FROZEN_EVIDENCE_ALLOWED: valid-id',nodeKey:'evidence',call:async prompt=>{calls++;if(calls>1)assert.match(prompt,/invalid source evidence selection/);return {evidenceIds:[calls===1?'foreign-id':'valid-id']};},normalize:value=>{if(value.evidenceIds[0]!=='valid-id')throw Error('invalid source evidence selection: only frozen required evidence IDs may be bound');return value;}});
    assert.equal(calls,2);assert.deepEqual(repaired.content.evidenceIds,['valid-id']);
    calls=0;await assert.rejects(api._internals.writeWithContractRepair({prompt:'FROZEN_EVIDENCE_ALLOWED: valid-id',nodeKey:'evidence-invalid',call:async()=>{calls++;return {evidenceIds:['foreign-id']};},normalize:()=>{throw Error('invalid source evidence selection: only frozen required evidence IDs may be bound');}}),/invalid source evidence selection/);assert.equal(calls,4);
  });
  await check('retry preserves valid and accepted cached content while reopening actual native overflow with its original draft',()=>{
    const outline=['bad','valid','accepted'].map(id=>({id,title:id}));
    const drafts=outline.map(({id})=>({id,title:id==='valid'?'短标题':'超过原生单行容量的标题',templateSlotTexts:{3:'导航'},nodes:[]}));
    const project={outline,nodes:Object.fromEntries(drafts.map(slide=>[slide.id,{status:'done',slide}])),dagNodes:{},runtime:{slides:{accepted:{accepted:true}}},templateFidelity:{mode:'preserve',slides:outline.map(()=>({slots:[{shapeId:3,role:'title',capacity:6}],nodes:[]}))}};
    const reopened=api._internals.revalidateCompletedCopy(project);
    assert.deepEqual(reopened.map(item=>item.slideId),['bad']);assert.equal(project.nodes.bad.status,'pending');assert.strictEqual(project.nodes.bad.slide,drafts[0]);
    assert.equal(project.nodes.valid.status,'done');assert.strictEqual(project.nodes.valid.slide,drafts[1]);assert.equal(project.nodes.accepted.status,'done');
    assert.equal(project.dagNodes['content:bad'].status,'pending');assert.equal(project.nodes.bad.retryCopyIssues[0].capacity,6);
  });
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
    const good={brief:{presentationUse:'course_walkthrough'},...raw({...body('a','Compare the conditions'),focus:'Queue before execution; result after review.',sourceUnitIds:[table.id],chunkRefs:table.chunkRefs,refs:table.source_ref},{...body('b','Check responsibility'),focus:'Verify the owner and confirm the evidence.',sourceUnitIds:[checklist.id],chunkRefs:checklist.chunkRefs,refs:checklist.source_ref})};
    good.slides.at(-1).sourceUnitIds=[source.semantic.inventory.items.find(i=>i.type==='SummaryBlock').id];
    const deps={...api._internals.defaultDeps,modelCall:async(p,prompt)=>{calls++;if(calls===1)return {...good,slides:good.slides.map((s,i)=>i===1?{...s,sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:'bad',rowEnd:3}]}:s)};assert.match(prompt,/^这是修复任务/);assert.match(prompt,/初稿结构检查/);assert.match(prompt,/不能仅修改 topicGroups/);assert.match(prompt,/缩短 keyPoints 无法解决/);assert.match(prompt,/连续两页/);return good;}};
    const req=Readable.from([Buffer.from(JSON.stringify({inputKind:'paste',text:source.text,prompt:'Explain validation',template:'light',configId:'simulated',model:'simulated'}))]);req.method='POST';let response;
    await api.handlePpt(req,new URL('http://test/ppt/projects'),{uid:'audit',deps,activity:()=>{},log:()=>{},res:{},send:(status,body)=>{response={status,body};return true;}});
    assert.equal(response.status,201,JSON.stringify(response));
    let project;for(let n=0;n<200;n++){project=store.get('audit',response.body.project.id);if(['outline_ready','failed'].includes(project.status))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(project.status,'outline_ready',project.error);assert.equal(calls,2);assert.equal(project.pageDecision.confirmedAt,null);
  });
  const localRepair=await import('./lib/ppt-outline-capacity-repair.mjs');
  const partitioned={...body('table'),sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:3}],requiredDetails:['Retain both conditions'],requiredEvidenceIds:['fact'],sourceImageIds:[]};
  const repairBase={project:auto,outline:[{title:'Cover'},partitioned],rawOutline:{slides:[{title:'Cover'},partitioned]}};
  const partitions={slides:[{title:'Queue',question:'Queue condition',sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:2}],keyPointIndexes:[0],requiredDetailIndexes:[0],requiredEvidenceIds:['fact']},{title:'Result',question:'Result condition',sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:2,rowEnd:3}],keyPointIndexes:[],requiredDetailIndexes:[],requiredEvidenceIds:[]}]};
  await check('local partitions preserve original copy and table selections',()=>{
    const result=localRepair.applyOutlineCapacityRepair(repairBase,1,{slides:partitions.slides.map(s=>({...s,keyPoints:[{text:'Invented replacement'}]}))});
    assert.deepEqual(result[0].keyPoints,partitioned.keyPoints);assert.deepEqual(result[0].requiredDetails,partitioned.requiredDetails);assert.equal(result[1].keyPoints.length,0);
    assert.match(localRepair.outlineCapacityRepairPrompt(repairBase,1),/fitsEveryNativeBody/);
  });
  await check('local partitions reject dropped or duplicated table rows and copy commitments',()=>{
    for(const changed of [
      {slides:partitions.slides.map((s,i)=>i===1?{...s,sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:3}]}:s)},
      {slides:partitions.slides.slice(0,1)},
      {slides:partitions.slides.map((s,i)=>i===0?{...s,keyPointIndexes:[]}:s)},
      {slides:partitions.slides.map((s,i)=>i===0?{...s,sourceUnitIds:['foreign-source']}:s)},
    ])assert.throws(()=>localRepair.applyOutlineCapacityRepair(repairBase,1,changed),/table|index|ownership/);
  });
  await check('the API measures a bounded localized repair before freezing automatic pages',async()=>{
    const store=await import('./lib/ppt-store.mjs');let calls=0;
    const text='# Validation\n\n## Complete table\n\n| Object | Requirement |\n|---|---|\n'+Array.from({length:50},(_,i)=>`| Option ${i+1} | Verify scope and owner |`).join('\n')+'\n\n## Summary\n\nRetain all options and their requirements.';
    const complete=normalizePaste(text),large=complete.semantic.inventory.items.find(i=>i.type==='TableBlock'),summary=complete.semantic.inventory.items.find(i=>i.type==='SummaryBlock');
    const initial={brief:{presentationUse:'course_walkthrough'},slides:[{title:'Validation',refs:[]},{...body('comparison','What does each option require?'),sourceUnitIds:[large.id],requiredDetails:[],requiredEvidenceIds:[]},{title:'Summary',question:'What is retained?',sourceUnitIds:[summary.id],keyPoints:[{text:'Retain every option and its requirement.'}]}]};
    const deps={...api._internals.defaultDeps,modelCall:async(p,prompt)=>{
      calls++;if(!prompt.startsWith('局部大纲'))return initial;
      const selected=JSON.parse(prompt.match(/<failed_page>(.*?)<\/failed_page>/s)[1]);
      assert.deepEqual(selected.sourceUnitIds,[large.id]);
      const partition={slides:Array.from({length:10},(_,i)=>({title:`Options ${i*5+1}–${i*5+5}`,question:`Requirements for options ${i*5+1}–${i*5+5}`,groupId:`options-${i}`,sourceUnitIds:[large.id],sourceArtifactRanges:[{sourceUnitId:large.id,rowStart:i*5+1,rowEnd:i*5+6}],keyPointIndexes:i===0?[0]:[],requiredDetailIndexes:[],requiredEvidenceIds:[]}))};
      if(calls===3){partition.slides[0].keyPointIndexes=[];return partition;}
      assert.match(prompt,/<contract_error>keyPointIndexes/);assert.match(prompt,/"missing":\[0\]/);
      return partition;
    }};
    const req=Readable.from([Buffer.from(JSON.stringify({inputKind:'paste',text,prompt:'Explain validation',template:'light',configId:'simulated',model:'simulated'}))]);req.method='POST';let response;
    await api.handlePpt(req,new URL('http://test/ppt/projects'),{uid:'audit',deps,activity:()=>{},log:()=>{},res:{},send:(status,body)=>{response={status,body};return true;}});
    assert.equal(response.status,201,JSON.stringify(response));let project;
    for(let n=0;n<300;n++){project=store.get('audit',response.body.project.id);if(['outline_ready','failed'].includes(project.status))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(project.status,'outline_ready',project.error);assert.ok(calls>=1&&calls<=4,'measured repair can avoid model calls, and model repair stays bounded');assert.ok(project.pages>3&&project.pages<=12,'complete measured components fit within the former model partition budget');assert.equal(project.pageDecision.fitValidated,true);
    assert.deepEqual(project.outline.flatMap(slide=>slide.sourceArtifactRanges||[]).filter(ref=>ref.sourceUnitId===large.id).flatMap(ref=>capacity.sourceComponent(large,ref).content.rows.slice(1)),large.rows.slice(1),'measured-first repair retains every table row');
    assert.equal(project.outline.flatMap(slide=>slide.keyPoints||[]).filter(point=>point.text===initial.slides[1].keyPoints[0].text).length,1,'the complete explanation is retained exactly once, independent of its measured page');assert.equal(project.pageDecision.confirmedAt,null);
  });
  await check('duplicate source owners enter one local scope even without physical overflow',async()=>{
    const store=await import('./lib/ppt-store.mjs');let calls=0;
    const summary=source.semantic.inventory.items.find(i=>i.type==='SummaryBlock');
    const initial={brief:{presentationUse:'course_walkthrough'},slides:[{title:'Validation',refs:[]},
      {...body('table','Compare conditions'),focus:'Queue before execution; result after review.',sourceUnitIds:[table.id]},
      {...body('checklist','Check responsibility'),focus:'Verify the owner and confirm the evidence.',sourceUnitIds:[checklist.id]},
      {...body('summary','Connect the evidence'),sourceUnitIds:[summary.id],keyPoints:[{text:'Connect the result to the evidence.'}]},
      {title:'Conclusion',question:'Who is responsible?',sourceUnitIds:[summary.id],keyPoints:[{text:'Retain the responsible owner.'}]}]};
    const base=api._internals.assessOutlineCandidate(auto,initial),scopes=localRepair.outlineCapacityRepairScopes(base);
    assert.deepEqual(scopes,[[3,4]]);
    const deps={...api._internals.defaultDeps,modelCall:async(p,prompt)=>{
      calls++;if(!prompt.startsWith('局部大纲'))return initial;
      const selected=JSON.parse(prompt.match(/<failed_page>(.*?)<\/failed_page>/s)[1]);assert.equal(selected.originalTitles.length,2);
      return {slides:[{title:'Conclusion',question:'What connects evidence and responsibility?',sourceUnitIds:[summary.id],keyPointIndexes:[0,1],requiredDetailIndexes:[],requiredEvidenceIds:[]}]};
    }};
    const req=Readable.from([Buffer.from(JSON.stringify({inputKind:'paste',text:source.text,prompt:'Explain validation',template:'light',configId:'simulated',model:'simulated'}))]);req.method='POST';let response;
    await api.handlePpt(req,new URL('http://test/ppt/projects'),{uid:'audit',deps,activity:()=>{},log:()=>{},res:{},send:(status,body)=>{response={status,body};return true;}});
    assert.equal(response.status,201,JSON.stringify(response));let project;
    for(let n=0;n<300;n++){project=store.get('audit',response.body.project.id);if(['outline_ready','failed'].includes(project.status))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(project.status,'outline_ready',project.error);assert.equal(calls,3);assert.equal(project.pages,4);
    assert.equal(project.outline.filter(s=>s.sourceUnitIds?.includes(summary.id)).length,1);
    assert.deepEqual(project.outline.at(-1).keyPoints.map(p=>p.text),['Connect the result to the evidence.','Retain the responsible owner.']);
  });
  await check('overlapping copies of a failed table share a scope while disjoint fragments remain independent',()=>{
    const huge={...body('overflow'),question:'Long mechanism',keyPoints:[{text:'Necessary explanation. '.repeat(500)}],sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:2}]};
    const other={...body('other'),question:'Second mechanism',sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:3}]};
    const base={project:auto,rawOutline:{slides:[{title:'Cover'},huge,other]}};
    assert.deepEqual(localRepair.outlineCapacityRepairScopes(base),[[1,2]]);
    other.sourceArtifactRanges=[{sourceUnitId:table.id,rowStart:2,rowEnd:3}];
    assert.deepEqual(localRepair.outlineCapacityRepairScopes(base),[[1]]);
  });
  await check('local physical validation rejects an invented same-page bilingual constraint and accepts separate complete units',()=>{
    const first={id:'summary-a',type:'SummaryBlock',text:'Mechanism with conditions. '.repeat(2),source_ref:[],chunkRefs:[]};
    const second={id:'summary-b',type:'SummaryBlock',text:'Outcome with conditions. '.repeat(2),source_ref:[],chunkRefs:[]};
    const project=structuredClone(native);project.source.semantic.inventory.items=[first,second];
    for(const item of [first,second])assert.equal(capacity.fitComponents([capacity.sourceComponent(item)],project,1).capacity_ok,true);
    const draft={title:'Parallel explanations',sourceUnitIds:[first.id,second.id],keyPoints:[],requiredDetails:[]};
    const base={project,rawOutline:{slides:[{title:'Cover'},draft]},outline:[{title:'Cover'},draft]};
    assert.throws(()=>localRepair.applyOutlineCapacityRepair(base,1,{slides:[{...draft,keyPointIndexes:[],requiredDetailIndexes:[]}]}),/measured native capacity/);
    assert.equal(localRepair.applyOutlineCapacityRepair(base,1,{slides:[first,second].map(item=>({title:item.id,sourceUnitIds:[item.id],keyPointIndexes:[],requiredDetailIndexes:[]}))}).length,2);
  });
  await check('the measured fallback preserves complete table rows and every original content commitment across final native reassignment',()=>{
    const large={...table,id:'fallback-table',rows:[['Object','Requirement'],...Array.from({length:12},(_,i)=>[`Option ${i+1}`,'Verify scope and owner'])]};
    const project=structuredClone(native);project.source.semantic.inventory.items=[large];
    project.templateFidelity.slides[1].nodes[0].geometry.width=7315200;project.templateFidelity.slides[1].nodes[0].geometry.height=3657600;
    const draft={...body('comparison'),sourceUnitIds:[large.id],requiredDetails:['Retain every selected row and column']};
    const base={project,rawOutline:{slides:[{title:'Cover'},draft]},outline:[{title:'Cover'},draft]};
    const before=JSON.stringify(base),parts=localRepair.partitionOutlineWithMeasuredComponents(base,1);
    assert.ok(parts.length>1);assert.equal(JSON.stringify(base),before);assert.ok(parts.every(s=>s.capacityPartition));
    assert.deepEqual(parts.flatMap(s=>s.keyPoints),draft.keyPoints);assert.deepEqual(parts.flatMap(s=>s.requiredDetails),draft.requiredDetails);
    const rows=parts.flatMap(s=>s.sourceArtifactRanges.flatMap(ref=>capacity.sourceComponent(large,ref).content.rows.slice(1)));
    assert.deepEqual(rows,large.rows.slice(1));
    for(const part of parts)for(let index=1;index<project.pages;index++)assert.equal(packing.candidateFit(part,project,index).capacity_ok,true);
    const reassessed=api._internals.assessOutlineCandidate(project,{slides:[{title:'Cover'},...parts,{title:'End',question:'Conclusion',keyPoints:[{text:'Retain evidence and scope.'}]}]});
    assert.equal(packing.inspectDensityOutline(reassessed.rawOutline,reassessed.project).length,0);
    assert.equal(reassessed.outline.length,parts.length+2,'portable fragments must not be merged on a wider provisional page');
  });
  await check('coverage restoration preserves existing copy and adds only missing original objects and table rows',()=>{
    const summary=source.semantic.inventory.items.find(i=>i.type==='SummaryBlock');
    const project=structuredClone(auto);project.source.semantic.inventory.items=[table,summary];
    const draft={slides:[{title:'Cover'}, {...body('comparison'),sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:2}]},{title:'End',keyPoints:[{text:'Retain evidence.'}]}]};
    const before=JSON.stringify(draft),restored=localRepair.restoreMissingSourceArtifacts({project,rawOutline:draft});
    assert.equal(JSON.stringify(draft),before);assert.deepEqual(restored.slides[1],draft.slides[1]);assert.deepEqual(restored.slides.at(-1),draft.slides.at(-1));
    assert.equal(packing.inspectDensityOutline(restored,project).length,0);
    const tail=restored.slides.find(s=>s!==draft.slides[1]&&s.sourceArtifactRanges?.some(r=>r.rowStart===2));
    assert.deepEqual(tail.sourceArtifactRanges,[{sourceUnitId:table.id,rowStart:2,rowEnd:table.rows.length}]);
    assert.equal(restored.slides.filter(s=>s.sourceUnitIds?.includes(summary.id)).length,1);
    assert.strictEqual(localRepair.restoreMissingSourceArtifacts({project,rawOutline:restored}),restored);
  });
  await check('the API restores omitted source objects and uses complete measured components after bounded model partitions violate preservation',async()=>{
    const store=await import('./lib/ppt-store.mjs');let calls=0;
    const text='# Validation\n\n## Complete table\n\n| Object | Requirement |\n|---|---|\n'+Array.from({length:50},(_,i)=>`| Option ${i+1} | Verify scope and owner |`).join('\n')+'\n\n## Summary\n\nRetain all options and their requirements.';
    const complete=normalizePaste(text),large=complete.semantic.inventory.items.find(i=>i.type==='TableBlock'),summary=complete.semantic.inventory.items.find(i=>i.type==='SummaryBlock');
    const initial={brief:{presentationUse:'course_walkthrough'},slides:[{title:'Validation',refs:[]},{...body('comparison','What does each option require?'),sourceUnitIds:[large.id],sourceArtifactRanges:[{sourceUnitId:large.id,rowStart:1,rowEnd:50}],requiredDetails:[],requiredEvidenceIds:[]},{title:'Summary',question:'What is retained?',sourceUnitIds:[],keyPoints:[{text:'Retain every option and its requirement.'}]}]};
    const deps={...api._internals.defaultDeps,modelCall:async(p,prompt)=>{
      calls++;if(!prompt.startsWith('局部大纲'))return initial;
      return {slides:[{title:'Partial',sourceUnitIds:[large.id],keyPointIndexes:[],requiredDetailIndexes:[],requiredEvidenceIds:[],sourceArtifactRanges:[{sourceUnitId:large.id,rowStart:1,rowEnd:2}]}]};
    }};
    const req=Readable.from([Buffer.from(JSON.stringify({inputKind:'paste',text,prompt:'Explain validation',template:'light',configId:'simulated',model:'simulated'}))]);req.method='POST';let response;
    await api.handlePpt(req,new URL('http://test/ppt/projects'),{uid:'audit',deps,activity:()=>{},log:()=>{},res:{},send:(status,body)=>{response={status,body};return true;}});
    assert.equal(response.status,201,JSON.stringify(response));let project;
    for(let n=0;n<300;n++){project=store.get('audit',response.body.project.id);if(['outline_ready','failed'].includes(project.status))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(project.status,'outline_ready',project.error);assert.equal(calls,4);assert.ok(project.pages>3&&project.pages<=100);assert.equal(project.pageDecision.fitValidated,true);
    const selections=project.outline.flatMap(s=>s.sourceArtifactRanges||[]).filter(ref=>ref.sourceUnitId===large.id);
    assert.deepEqual(selections.flatMap(ref=>capacity.sourceComponent(large,ref).content.rows.slice(1)),large.rows.slice(1));
    assert.equal(project.outline.flatMap(s=>s.keyPoints).filter(point=>point.text===initial.slides[1].keyPoints[0].text).length,1);
    assert.equal(project.outline.filter(s=>s.sourceUnitIds?.includes(summary.id)).length,1);
  });
  console.log(JSON.stringify({passed,failures},null,2));
  if(failures.length)process.exitCode=1;
} finally {fs.rmSync(root,{recursive:true,force:true});}
