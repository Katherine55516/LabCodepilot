import {test} from 'node:test';
import assert from 'node:assert/strict';
import {choosePptRoleModel,pptRoleRef} from '../../lib/ppt-model-catalog';
import type {PptModel,PptRenderElement} from '../../components/ppt/types';
const model=(id:string,qualityScore:number,latencyMs:number,roles=['writer_standard']):PptModel=>({id,name:id,configId:'provider',modelId:id,capabilities:{thinkingControl:true,contextTokens:32000,ppt:{roles,evaluatedAt:'2026-10-14',benchmarkVersion:'fixture-v1',verifiedProtocol:'openai-compatible',health:'healthy',qualityScore,latencyMs}}});
test('PPT routes use declared evaluations and capabilities, not model names',()=>{
 const fast=model('unknown-a',75,50),strong=model('unknown-b',95,200),unverified={id:'expensive-latest',name:'expensive',configId:'provider',modelId:'latest'};
 assert.equal(choosePptRoleModel([strong,fast,unverified],'writer_standard','fast',unverified.id)?.id,fast.id);
 assert.equal(choosePptRoleModel([fast,strong],'writer_standard','rigorous',fast.id)?.id,strong.id);
 assert.equal(choosePptRoleModel([unverified],'planner','balanced',unverified.id),unverified);
 assert.equal(pptRoleRef(strong).thinkingControl,true);
 strong.capabilities!.ppt!.health='unavailable';assert.equal(choosePptRoleModel([strong,fast],'writer_standard','rigorous',strong.id)?.id,fast.id);
});
test('Component conversion preserves content in a separate deck and rejects opaque objects',async()=>{
 const {componentCopyDeck}=await import('../../../apps/cowork-server/lib/ppt-component-copy.mjs');
 const original={deck:{slides:[{id:'page1',title:'Topic',notes:'Original notes',nodes:[{id:'title',type:'text',semanticRole:'title',content:{text:'Topic'}},{id:'body',type:'text',content:{text:'10 kg only if P > 0'}},{id:'pic',type:'image',content:{dataUrl:'data:image/png;base64,YQ==',caption:'Source'}}]}]}};
 const snapshot=JSON.stringify(original),converted=componentCopyDeck(original);
 assert.equal(JSON.stringify(original),snapshot);assert.equal(converted.slides[0].title,'Topic');assert.ok(JSON.stringify(converted).includes('10 kg only if P > 0'));assert.ok(JSON.stringify(converted).includes('data:image/png;base64,YQ=='));assert.equal(converted.slides[0].notes,'Original notes');
 assert.throws(()=>componentCopyDeck({deck:{slides:[{id:'s',nodes:[{id:'foreign',type:'foreign'}]}]}}),/manual handling/);
});
test('image routing uses explicit tiers while legacy keeps its configured image model',async()=>{
 const {selectPptImageModel}=await import('../../lib/ppt-image-routing');
 const config={model:'original',models:[{id:'quick',qualityTier:1 as const},{id:'standard',qualityTier:2 as const},{id:'fine',qualityTier:3 as const},{id:'expensive-unverified'}]};
 assert.equal(selectPptImageModel(config,'fast'),'quick');assert.equal(selectPptImageModel(config,'rigorous'),'fine');assert.equal(selectPptImageModel(config,'legacy_single_model'),'original');assert.equal(selectPptImageModel({model:'original',models:[{id:'unknown'}]},'rigorous'),'original');
});
test('design-only templates cannot leak raster report text and fixed objects remain explicit',async()=>{
 const {templateDesignView}=await import('../../../apps/cowork-server/lib/ppt-template-design.mjs');
 const original={externalPptx:{width:1000,height:600},deck:{slides:[{nodes:[{id:'old-background',type:'image',geometry:{x:0,y:0,width:1000,height:600},content:{dataUrl:'data:image/png;base64,YQ==',mustPreserve:true,mediaRole:'template_decoration'}},{id:'logo',type:'image',geometry:{x:10,y:10,width:50,height:20},content:{mediaRole:'brand'}},{id:'opaque-background',type:'foreign',geometry:{x:0,y:0,width:1000,height:600},content:{mustPreserve:true}},{id:'vector',type:'shape',geometry:{x:0,y:0,width:100,height:10},content:{shape:'rect'}}]}]}};
 const clean=templateDesignView(original);assert.equal(clean.deck.slides[0].nodes[0].content.templateSample,true);assert.equal(clean.deck.slides[0].nodes[1].content.mediaRole,'old_template_content');assert.equal(clean.deck.slides[0].nodes[2].content.templateSample,true);assert.equal(clean.deck.slides[0].nodes[3].content.templateSample,undefined);
 const fixed=templateDesignView(original,new Set(),new Set(['logo']));assert.equal(fixed.deck.slides[0].nodes[1].content.mustPreserve,true);assert.equal(fixed.deck.slides[0].nodes[0].content.mediaRole,'old_template_content');assert.equal(Object.hasOwn(original.deck.slides[0].nodes[0].content,'templateSample'),false);
 assert.throws(()=>templateDesignView(original,new Set(),new Set(['missing'])),/no longer available/);
});
test('closing greetings never overwrite the last required topic or remove canonical content',async()=>{
 const {ensureOutlineClosing,appendClosingGreeting}=await import('../../../apps/cowork-server/lib/ppt-closing-page.mjs');
 const {buildRenderTree}=await import('../../../apps/cowork-server/lib/ppt/render-tree.mjs');
 const raw={slides:[{title:'Cover'},{title:'Evidence',sourceUnitIds:['a']},{title:'Next review',sourceUnitIds:['b']}]};
 const automatic={pageDecision:{source:'estimate',mode:'auto'},source:{text:'English source'}};
 const next=ensureOutlineClosing(automatic,raw);assert.equal(next.slides.length,4);assert.equal(next.slides[2].title,'Next review');assert.deepEqual(next.slides[2].sourceUnitIds,['b']);assert.match(next.slides[3].title,/Thanks/);
 assert.equal(ensureOutlineClosing({pageDecision:{mode:'explicit'}},raw).slides.length,3);
 const placeholder=ensureOutlineClosing(automatic,{slides:[raw.slides[0],raw.slides[1],{title:'Closing Summary',role:'closing',focus:'Repeat all previous business facts',sourceUnitIds:[]}]});assert.match(placeholder.slides[2].title,/Thanks/);assert.doesNotMatch(placeholder.slides[2].focus,/Repeat/);
 const sourcedSummary=ensureOutlineClosing(automatic,{slides:[raw.slides[0],raw.slides[1],{title:'Summary',role:'closing',refs:['required-source']}]});assert.equal(sourcedSummary.slides[2].title,'Summary');assert.equal(sourcedSummary.slides.length,4);
 const slide={id:'last',title:'Next review',bullets:['Review on Friday if acceptance is recorded.'],blocks:[],layoutId:'summary'};
 appendClosingGreeting({},slide);const rendered=buildRenderTree({deck:{slides:[slide]}}).slides[0];
 assert.ok(rendered.elements.some((e:PptRenderElement)=>e.content?.text==='Next review'));assert.ok(JSON.stringify(rendered).includes('Friday'));assert.ok(rendered.elements.some((e:PptRenderElement)=>/Thanks/.test(e.content?.text||'')&&(e.style?.fontSizePt||0)>=14));
});
test('system title geometry grows for two lines without changing font, content, body or manual geometry',async()=>{
 const {fitSystemTitleFrames}=await import('../../../apps/cowork-server/lib/ppt-system-title-fit.mjs');
 const {applyRenderContract,measureText}=await import('../../../apps/cowork-server/lib/ppt/render-contract.mjs');
 const title=applyRenderContract({id:'t',kind:'text',semanticRole:'title',bounds:{x:786384,y:621792,width:10561320,height:1060704},content:{text:'Migration completion and pending blockers'},style:{fontSizePt:36,lineHeight:1.05}});
 const body={id:'body',kind:'text',bounds:{x:786384,y:2103120,width:10561320,height:3000000},content:{text:'All required facts remain here.'}};
 assert.equal(measureText(title).overflow,true);const original=JSON.stringify(body),font=title.style.fontSizePt;
 const scene={size:{height:6858000},elements:[title,body]};fitSystemTitleFrames(scene);
 assert.equal(measureText(title).overflow,false);assert.equal(title.style.fontSizePt,font);assert.equal(JSON.stringify(body),original);
 const manual=structuredClone(scene);manual.elements[0].bounds.height=1060704;manual.elements[0].userGeometry=true;fitSystemTitleFrames(manual);assert.equal(manual.elements[0].bounds.height,1060704);
});

test('quality changes refresh automatic routes but retain manual choices and never add a vision route',async()=>{
 const {bindPptExecutionPolicy}=await import('../../lib/ppt-model-catalog');
 const fast=model('quick',70,50,['planner','critic','writer_standard','vision_reader']),strong=model('strong',95,200,['planner','critic','writer_standard','vision_reader']);
 fast.capabilities!.vision=true;strong.capabilities!.vision=true;
 const initial={version:1 as const,qualityLevel:'balanced' as const,roleRoutes:{},budget:{maxAttemptsPerTask:5}};
 const balanced=bindPptExecutionPolicy(initial,[fast,strong],fast.id);assert.equal(balanced.roleRoutes.planner.primary.model,'strong');
 const quick=bindPptExecutionPolicy({...balanced,qualityLevel:'fast'},[fast,strong],fast.id);assert.equal(quick.roleRoutes.planner.primary.model,'quick');assert.equal(quick.roleRoutes.planner.complexPrimary?.model,'strong');
 quick.roleRoutes.planner={primary:pptRoleRef(fast),selection:'manual',fallbacks:[]};
 const rigorous=bindPptExecutionPolicy({...quick,qualityLevel:'rigorous'},[fast,strong],fast.id);assert.equal(rigorous.roleRoutes.planner.primary.model,'quick');assert.equal(rigorous.roleRoutes.vision_reader,undefined);
 const {normalizeExecutionPolicy}=await import('../../../apps/cowork-server/lib/ppt-execution-policy.mjs');
 assert.equal(Object.hasOwn(normalizeExecutionPolicy({...rigorous,roleRoutes:{...rigorous.roleRoutes,vision_reader:balanced.roleRoutes.vision_reader}}).roleRoutes,'vision_reader'),false);
});

test('two-line source page titles translate only automatic body groups into real free space',async()=>{
 const {fitSystemTitleFrames}=await import('../../../apps/cowork-server/lib/ppt-system-title-fit.mjs');
 const {applyRenderContract,measureText}=await import('../../../apps/cowork-server/lib/ppt/render-contract.mjs');
 const title=applyRenderContract({id:'t',kind:'text',semanticRole:'title',bounds:{x:786384,y:621792,width:10561320,height:1060704},content:{text:'Migration completion and pending work'},style:{fontSizePt:36,lineHeight:1.05}});
 const body=applyRenderContract({id:'source',kind:'text',semanticRole:'source-structure',bounds:{x:792480,y:1714500,width:10607040,height:4663440},content:{text:'The original acceptance conditions stay complete.'},style:{fontSizePt:18}});
 const original=JSON.stringify(body.content),height=body.bounds.height,scene={size:{height:6858000},elements:[title,body]};const manual=structuredClone(scene);manual.elements[1].userGeometry=true;
 fitSystemTitleFrames(scene);assert.equal(measureText(title).overflow,false);assert.ok(body.bounds.y>1714500);assert.equal(body.bounds.height,height);assert.equal(JSON.stringify(body.content),original);assert.ok(body.bounds.y+height<=6858000-914400*.18);
 fitSystemTitleFrames(manual);assert.equal(manual.elements[1].bounds.y,1714500);assert.equal(manual.elements[0].bounds.height,1060704);
});

test('a dedicated system closing uses a compact greeting layout without a large empty card',async()=>{
 const {deterministicClosingDraft,prepareClosingLayout}=await import('../../../apps/cowork-server/lib/ppt-closing-page.mjs');
 const {_internals}=await import('../../../apps/cowork-server/lib/ppt-api.mjs');const {buildRenderTree}=await import('../../../apps/cowork-server/lib/ppt/render-tree.mjs');
 const outline=[{id:'first',title:'Delivery'},{id:'last',title:'Thanks for watching!',sourceUnitIds:[],role:'closing'}],project={outline,source:{text:'English source'},generationPolicy:{language:{mode:'source'}}};
 const draft=deterministicClosingDraft(project,outline[1],1);assert.equal(draft.layoutId,'cover');assert.deepEqual(draft.contentBlocks,[]);
 const slide=_internals.normalizeSlide(draft,outline[1],project);prepareClosingLayout(project,slide);const scene=buildRenderTree({...project,deck:{slides:[slide]}}).slides[0];
 assert.equal(scene.layoutId,'cover');assert.ok(scene.elements.some((e:PptRenderElement)=>e.semanticRole==='subtitle'&&e.content?.text==='Questions & discussion.'&&e.style?.textAlign==='center'));assert.ok(!scene.elements.some((e:PptRenderElement)=>e.kind==='list'&&e.content?.items?.length));
 const {deckReviewPrompt}=await import('../../../apps/cowork-server/lib/ppt-quality.mjs');
 slide.programGenerated={role:'closing'};
 slide.nodes.push({id:'untrusted-added-claim',type:'text',semanticRole:'body',content:{text:'Revenue doubled this quarter.'},geometry:{x:914400,y:5000000,width:6000000,height:500000},style:{fontSizePt:18}});
 const prompt=deckReviewPrompt({...project,deck:{slides:[slide]}}),framing=JSON.parse(prompt.match(/<application_framing>([\s\S]*?)<\/application_framing>/)![1]);
 assert.ok(framing.some((node:{text:string})=>node.text==='Questions & discussion.'));
 assert.ok(!framing.some((node:{nodeId:string})=>node.nodeId==='untrusted-added-claim'),'a closing page cannot exempt additional factual claims');
 assert.ok(prompt.includes('Revenue doubled this quarter.'),'the actual extra claim remains in the full review input');
});

test('bound bilingual source pages keep their no-second-body contract through long-prompt compaction and SDK schemas',async()=>{
 const {normalizePaste}=await import('../../../apps/cowork-server/lib/ppt-source.mjs');
 const {writerPrompt,writerCorrectionContext,boundWriterResponseSchema}=await import('../../../apps/cowork-server/lib/ppt-prompt-contracts.mjs');
 const {_internals}=await import('../../../apps/cowork-server/lib/ppt-api.mjs');
 const source=normalizePaste('# 验收责任\n工程团队负责转换，负责人确认内容，安全负责人核对权限。\n\nEnglish supplement: Technical conversion, content acceptance and security approval are separate decisions.');
 const ids=source.semantic.inventory.items.filter((i:{type:string})=>i.type!=='HeadingBlock').map((i:{id:string})=>i.id);
 for(const item of source.semantic.inventory.items)if(ids.includes(item.id))item.must_preserve_structure=true;
 const slide={id:'owned',title:'分别记录三类验收',sourceUnitIds:ids,planningProtocolVersion:2};
 const contract={sourceUnitIds:ids,sourceArtifacts:ids.map((sourceUnitId:string)=>({sourceUnitId}))};
 const project={pages:3,outline:[{id:'cover',title:'验收'},slide,{id:'closing',title:'感谢观看'}],source,confirmedOutline:{titlesFrozen:true},generationPolicy:{version:1,content:'full_source',knowledge:'source_only',language:{mode:'source',body:'both'}},planning:{slidePlan:[{slideId:slide.id,...contract}]}};
 const prompt=writerPrompt(project,slide,1,{contract,retrieval:{},slotContract:undefined,edits:[]});
 assert.ok(prompt.includes('<bound_source_body>'));assert.ok(!prompt.includes('浅薄：'),'the generic copy-writing rubric must not contradict frozen-source ownership');
 const compact=writerCorrectionContext('INPUT_FRAMEWORK='+JSON.stringify({frameworkHash:'frozen',material:{sourceText:'Original source. '.repeat(3000)}})+'\n'+prompt);
 assert.ok(compact.includes('<bound_source_body>'),'source ownership survives retrieval-only repair compaction');
 const schema=boundWriterResponseSchema(compact);assert.ok(schema);assert.equal(schema.properties.blocks.maxItems,0);assert.equal(schema.properties.contentBlocks.maxItems,0);
 assert.deepEqual(schema.properties.sourceArtifacts.const,contract.sourceArtifacts);assert.equal(schema.properties.title.const,slide.title);
 const valid={title:slide.title,contentBlocks:[],blocks:[],sourceCommentary:[],sourceArtifacts:contract.sourceArtifacts,sourceEvidenceIds:[]};
 const compiled=_internals.normalizeSlide(valid,slide,project);assert.ok(compiled.nodes.some((node:{semanticRole:string})=>node.semanticRole==='source-structure'));
 assert.throws(()=>_internals.normalizeSlide({...valid,blocks:[{id:'bad',type:'points',items:[{body:'Duplicate facts'}]}]},slide,project),/unsupported visual block/,'JSON fallback still rejects unsupported media instead of silently deleting it');
 assert.equal(boundWriterResponseSchema('Return an ordinary page.'),undefined);assert.equal(boundWriterResponseSchema(compact+'\n<previous_draft>{}</previous_draft>'),undefined,'semantic review repairs retain their own response contract');
});

test('merged titles use both verified source topics and distinguish section ordinals from unsupported claims',async()=>{
 const {mergedTopicTitle}=await import('../../../apps/cowork-server/lib/ppt-outline-condense.mjs');
 const {inspectSourceNumbers}=await import('../../../apps/cowork-server/lib/ppt-source-numbers.mjs');
 const project={source:{text:'# 迁移\n## 2. 版本与来源\n保留原始版本。\n## 3. 权限核对\n检查授权边界。'},generationPolicy:{knowledge:'source_only'}};
 assert.equal(mergedTopicTitle(project,'2. 版本与来源：内容冲突时如何选择？','3. 权限核对：搜索可见是否等于可读？'),'版本与来源、权限核对');
 assert.equal(mergedTopicTitle(project,'版本与来源：内容冲突时如何选择？','权限核对：搜索可见是否等于可读？'),'版本与来源、权限核对','planner-stripped ordinals still match the original source headings');
 assert.equal(mergedTopicTitle(project,'Independent risk','Operational controls'),'Independent risk & Operational controls','unrelated titles are not cut at arbitrary punctuation');
 const slide={id:'s',nodes:[{id:'t',type:'text',semanticRole:'title',content:{text:'2. 版本与来源：保留版本与3. 权限核对：检查边界'}}]};
 assert.equal(inspectSourceNumbers(project,[slide]).length,0,'exact source section ordinals in merged titles are navigation');
 const corrupt=structuredClone(slide);corrupt.nodes[0].content.text+='；错误率 77%';
 assert.ok(inspectSourceNumbers(project,[corrupt]).some((issue:{values:string[]})=>issue.values.includes('77')),'a verified section label does not exempt other numbers in the same title');
 const fake=structuredClone(slide);fake.nodes[0].content.text='收入增长 3%';assert.ok(inspectSourceNumbers(project,[fake]).length,'a source ordinal cannot authorize a business measurement');
});

test('a long collection of ordinary source paragraphs increases scope without inventing reasoning difficulty',async()=>{
 const {taskComplexity}=await import('../../../apps/cowork-server/lib/ppt-task-complexity.mjs');
 const {thinkingModeForRoute}=await import('../../../apps/cowork-server/lib/ppt-execution-policy.mjs');
 const project={source:{text:'资料负责人保留原始记录。The owner retains the original record.\n'.repeat(250),semantic:{inventory:{items:Array.from({length:26},(_,i)=>({id:'p'+i,type:'MechanismBlock',text:'Check the approved record.'}))}}}};
 const result=taskComplexity(project,'outline');assert.equal(result.level,'medium');assert.ok(result.reasons.includes('large_scope'));
 assert.equal(thinkingModeForRoute({thinkingControl:true,role:'planner',qualityLevel:'rigorous'},result), 'disabled');
 const technical=structuredClone(project);technical.source.semantic.inventory.items[0].type='EquationBlock';assert.equal(taskComplexity(technical,'outline').level,'complex','a short structured equation remains a hard reasoning trigger');
});

test('automatic source pictures move from a topic-only cover to their complete related body before capacity checks',async()=>{
 const {compileSourceMediaOwnership}=await import('../../../apps/cowork-server/lib/ppt-outline-compile.mjs');
 const project={source:{images:[{id:'figure',role:'source_content',required:true,caption:'Completed checks',sourceRefs:['group-data'],dataUrl:'unchanged-original-image'}],semantic:{inventory:{items:[{id:'intro',text:'Introduction',sourceRefs:['intro']},{id:'counts',text:'Completed checks are counts, not rates.',sourceRefs:['group-data']}]}}}};
 const raw={version:2,slides:[{role:'cover',sourceUnitIds:[],sourceImageIds:['figure']},{role:'definition',sourceUnitIds:['intro']},{role:'evidence',sourceUnitIds:['counts']},{role:'closing',sourceUnitIds:[]}]};
 const corrections:unknown[]=[];const revised=compileSourceMediaOwnership(project,structuredClone(raw),corrections);
 assert.deepEqual(revised.slides[0].sourceImageIds,[]);assert.deepEqual(revised.slides[2].sourceImageIds,['figure']);assert.equal(revised.slides.flatMap((s:{sourceImageIds?:string[]})=>s.sourceImageIds||[]).length,1);
 assert.equal(project.source.images[0].dataUrl,'unchanged-original-image');assert.equal(corrections.length,1);
 const missing=structuredClone(raw);missing.slides[0].sourceImageIds=[];assert.deepEqual(compileSourceMediaOwnership(project,missing).slides[2].sourceImageIds,['figure'],'required unassigned assets receive a measured body owner');
 assert.deepEqual(compileSourceMediaOwnership({...project,confirmedOutline:{hash:'frozen'}},structuredClone(raw)),raw,'user-confirmed media assignments are not silently changed');
 assert.deepEqual(compileSourceMediaOwnership({...project,requestedOutline:raw.slides},structuredClone(raw)),raw,'explicit user assignments remain authoritative');
});

test('native titles use the same measured frame as export when coarse character budgets reject fitting text',async()=>{
 const {nativeTitleFitsFrame,inspectNativeOutlineTitles}=await import('../../../apps/cowork-server/lib/ppt-template-fidelity.mjs');
 const node={id:'native-title',type:'text',nativeRef:{shapeId:5},geometry:{x:661475,y:2682280,width:6296860,height:570607},style:{fontSizePt:44.5,fontFamily:'Roboto Medium'},content:{text:'THE FACTOR ZOO'},nativeTextFrame:{originalHeight:570607,margins:[0,0,0,0],wordWrap:false,paragraphs:[{text:'THE FACTOR ZOO',lineSpacing:.83,runs:[{text:'THE FACTOR ZOO',fontFamily:'Roboto Medium',fontSizePt:44.5}]}]}};
 const slot={shapeId:5,nodeId:node.id,role:'title',capacity:9,maxLines:1,fontSizePt:44.5},spec={nodes:[node],slots:[slot]};
 assert.ok(nativeTitleFitsFrame(spec,slot,'New customer brief'),'actual fixed 44.5pt title fits its native frame, despite a 9-unit rounded estimate');
 assert.equal(nativeTitleFitsFrame(spec,slot,'WWWWWWWWWWWWWWWWWWWW'),false,'genuinely wide text remains blocked');
 assert.equal(nativeTitleFitsFrame(spec,slot,'New customer\nbrief'),false,'a single-line source slot cannot silently wrap');
 const project={source:{text:'English source'},deckTitle:{source:'user',locked:true},templateFidelity:{mode:'preserve',slides:[spec]}};
 const outline=[{id:'s',title:'New customer brief',titleLocked:true}];assert.equal(inspectNativeOutlineTitles(project,outline).length,0);
 // Page 0 is a cover: it may step down to 28 pt (Fable 2026-11-01), so the gate is tested with a title too wide even there.
 assert.ok(inspectNativeOutlineTitles(project,[{...outline[0],title:'W'.repeat(40)}]).some((i:{code:string})=>i.code==='planned_native_title_overflow'),'locked titles keep the physical capacity gate');
 assert.deepEqual(node.style,{fontSizePt:44.5,fontFamily:'Roboto Medium'});assert.equal(node.content.text,'THE FACTOR ZOO','measurement never mutates the original template');
});

test('a native thank-you page omits old report body groups without requesting repeated source facts',async()=>{
 const {slidePlan}=await import('../../../apps/cowork-server/lib/ppt-planning.mjs');
 const {deterministicClosingDraft,prepareClosingLayout}=await import('../../../apps/cowork-server/lib/ppt-closing-page.mjs');
 const {inspectTemplateSlotDraft}=await import('../../../apps/cowork-server/lib/ppt-template-fidelity.mjs');
 const {_internals}=await import('../../../apps/cowork-server/lib/ppt-api.mjs');
 const slots=[{shapeId:1,nodeId:'title',role:'title',capacity:50,fontSizePt:32,maxLines:2},{shapeId:2,nodeId:'section',role:'section',capacity:30,fontSizePt:10},...[3,4,5].map(shapeId=>({shapeId,nodeId:'old'+shapeId,role:'content',purpose:'body',groupId:shapeId,capacity:100,fontSizePt:18}))];
 const nodes=slots.map(slot=>({id:slot.nodeId,type:'text',nativeRef:{shapeId:slot.shapeId},geometry:{x:914400,y:slot.role==='title'?457200:3000000,width:9000000,height:1000000},content:{text:'Old report example'},style:{fontSizePt:slot.fontSizePt,fontFamily:'Arial'}}));
 const spec={slots,nodes},fidelity={mode:'preserve',width:12192000,height:6858000,slides:[spec,spec,spec]};
 const outline=[{id:'cover',title:'Cedar'},{id:'body',title:'Cedar pilot',sourceUnitIds:['original']},{id:'end',title:'Thanks for watching!',role:'closing',sourceUnitIds:[]}];
 const source={text:'Cedar approves the pilot before expansion.',semantic:{inventory:{items:[{id:'original',type:'MechanismBlock',text:'Cedar approves the pilot before expansion.',must_preserve_structure:true,chunkRefs:[]}]},evidenceAtoms:[],chunks:[]}};
 const contracts=slidePlan(outline,{},source,fidelity);assert.equal(contracts[2].templatePointTarget,0);assert.deepEqual(contracts[2].requiredEvidenceIds,[]);assert.deepEqual(contracts[2].requiredSupport,[]);
 const project={outline,pages:3,source,templateFidelity:fidelity,planning:{slidePlan:contracts},templateSpec:{fonts:{title:'Arial',body:'Arial'},palette:{foreground:'#222222'}}};
 const draft=deterministicClosingDraft(project,outline[2],2);assert.deepEqual(draft.contentBlocks,[],'the visible invitation is one canonical node, not a second copy block hidden from native slots');
 const slide=_internals.normalizeSlide(draft,outline[2],project);prepareClosingLayout(project,slide);
 assert.deepEqual(inspectTemplateSlotDraft(project,2,slide),[]);assert.ok(slide.nodes.some((n:{semanticRole:string;content:{text:string}})=>n.semanticRole==='closing-greeting'&&n.content.text==='Questions & discussion.'));
 const substantive=outline.map((s,i)=>i===2?{...s,title:'Acceptance before expansion',sourceUnitIds:['original']}:s);
 assert.ok(slidePlan(substantive,{},source,fidelity)[2].templatePointTarget>0,'a substantive conclusion cannot use the courtesy-page exception');
});

test('a native cover with no source ownership omits old body slots and cannot repeat another page primary paragraph',async()=>{
 const {slidePlan}=await import('../../../apps/cowork-server/lib/ppt-planning.mjs');const {writerPrompt}=await import('../../../apps/cowork-server/lib/ppt-prompt-contracts.mjs');
 const {inspectTemplateSlotDraft}=await import('../../../apps/cowork-server/lib/ppt-template-fidelity.mjs');const {_internals}=await import('../../../apps/cowork-server/lib/ppt-api.mjs');
 const slots=[{shapeId:1,role:'title',capacity:40,fontSizePt:32},{shapeId:2,role:'section',capacity:40,fontSizePt:10},{shapeId:3,role:'content',purpose:'body',groupId:3,capacity:100,fontSizePt:18}];
 const spec={slots,nodes:slots.map(slot=>({id:'n'+slot.shapeId,type:'text',nativeRef:{shapeId:slot.shapeId},geometry:{x:914400,y:914400,width:8000000,height:1000000},content:{text:'Old report copy'},style:{fontSizePt:slot.fontSizePt,fontFamily:'Arial'}}))};
 const source={text:'Cedar approves the pilot before expansion.',semantic:{inventory:{items:[{id:'fact',type:'MechanismBlock',text:'Cedar approves the pilot before expansion.',must_preserve_structure:true,chunkRefs:[]}]},evidenceAtoms:[],chunks:[]}};
 const outline=[{id:'cover',title:'Cedar brief',planningProtocolVersion:2,sourceUnitIds:[]},{id:'body',title:'Pilot condition',sourceUnitIds:['fact']},{id:'end',title:'Thanks for watching!',sourceUnitIds:[]}],fidelity={mode:'preserve',slides:[spec,spec,spec]};
 const contracts=slidePlan(outline,{},source,fidelity),project={pages:3,outline,source,templateFidelity:fidelity,planning:{slidePlan:contracts},generationPolicy:{knowledge:'source_only',language:{mode:'source'}}};
 assert.equal(contracts[0].templatePointTarget,0);assert.deepEqual(contracts[0].requiredEvidenceIds,[]);
 const prompt=writerPrompt(project,outline[0],0,{contract:contracts[0],retrieval:{},slotContract:'Native cover',edits:[]});
 const schema=JSON.parse([...prompt.matchAll(/返回唯一 JSON：([^\n]+)。只输出 JSON/g)].at(-1)![1]);assert.deepEqual(Object.keys(schema.slotTexts),['1','2']);assert.ok(schema.omitTemplateShapes.some((r:{shapeId:number})=>r.shapeId===3));
 const valid={title:'Cedar brief',slotTexts:{1:'Cedar brief',2:'Overview'},sourceArtifacts:[],sourceCommentary:[]};
 const slide=_internals.normalizeSlide(valid,outline[0],project);assert.ok(slide.templateOmissions.some((r:{shapeId:number})=>r.shapeId===3));assert.deepEqual(inspectTemplateSlotDraft(project,0,slide),[]);
 assert.throws(()=>_internals.normalizeSlide({...valid,slotTexts:{...valid.slotTexts,3:source.text}},outline[0],project),/writer cover contract/,'unowned cover prose is rejected rather than silently dropping another page facts');
 assert.deepEqual(outline[1].sourceUnitIds,['fact']);
});


test('temporal prerequisites are not comparisons and internal type hints cannot masquerade as visible facts',async()=>{
 const {normalizePaste}=await import('../../../apps/cowork-server/lib/ppt-source.mjs');
 const {deckReviewPrompt,normalizeModelReview}=await import('../../../apps/cowork-server/lib/ppt-quality.mjs');
 const source=normalizePaste('# Pilot\nRecord exclusions before presenting results.\n\nExpand only after customer acceptance.');
 assert.ok(source.semantic.inventory.items.every((item:{type:string})=>item.type!=='ComparisonBlock'));
 const comparison=normalizePaste('# Change\nBefore: manual matching. After: validated automated matching.');
 assert.ok(comparison.semantic.inventory.items.some((item:{type:string})=>item.type==='ComparisonBlock'));
 const project={source,deck:{slides:[{id:'body',title:'Pilot conditions',nodes:[{id:'fact',type:'text',semanticRole:'source-structure',sourceArtifact:{sourceUnitId:'b_0002',type:'ComparisonBlock'},content:{text:'Expand before customer acceptance.'}}]}]}};
 const prompt=deckReviewPrompt(project);assert.ok(prompt.includes('内部分类/溯源元数据'));assert.ok(prompt.includes('Expand before customer acceptance.'),'a real altered condition remains in the reviewer input');
 const finding={slideIds:['body'],detail:'Visible text changed only after acceptance to before acceptance.'};
 const review=normalizeModelReview({missing:[],repeated:[],conflicts:[finding],unsupported:[]},['body']);
 assert.equal(review.conflicts.length,1,'no automatic filtering of critic findings');
});

test('native section pills grow with automatic labels while user geometry and neighboring objects stay exact',async()=>{
 const {fitNativeSectionDecorations}=await import('../../../apps/cowork-server/lib/ppt-native-text-fit.mjs');const E=914400;
 const geometry={x:.6*E,y:.55*E,width:E,height:.16*E};const label={id:'label',type:'text',nativeRef:{shapeId:3},geometry:{...geometry,width:10*E},content:{text:'New customer brief'},style:{fontSizePt:9.5},nativeTextFrame:{margins:[0,0,0,0]},userGeometry:false,sectionDecorationFrameAdaptation:undefined as {status:string}|undefined};
 const pill={id:'pill',type:'shape',nativeRef:{shapeId:2},geometry:{x:.5*E,y:.5*E,width:1.2*E,height:.3*E},content:{},userGeometry:false,sectionDecorationFrameAdaptation:undefined as {status:string}|undefined};
 const project={templateFidelity:{mode:'preserve',width:13.333*E,height:7.5*E,slides:[{nodes:[{...label,geometry}]}]}},slide={sectionLabel:{basis:'source-heading',shapeId:3},nodes:[pill,label]};
 const locked=structuredClone(slide);locked.nodes[0].userGeometry=true;const exact=JSON.stringify(locked);fitNativeSectionDecorations(project,locked,0);assert.equal(JSON.stringify(locked),exact);
 const blocked=structuredClone(slide);blocked.nodes.push({id:'neighbor',type:'shape',nativeRef:{shapeId:4},geometry:{x:1.8*E,y:.5*E,width:E,height:.3*E},content:{},userGeometry:false,sectionDecorationFrameAdaptation:undefined});fitNativeSectionDecorations(project,blocked,0);assert.equal(blocked.nodes[0].sectionDecorationFrameAdaptation?.status,'blocked');
 fitNativeSectionDecorations(project,slide,0);assert.ok(pill.geometry.width>1.2*E);assert.ok(label.geometry.x+label.geometry.width<pill.geometry.x+pill.geometry.width);assert.equal(label.style.fontSizePt,9.5);assert.equal(label.content.text,'New customer brief');
});

test('design reuse retires orphan grid rules with old tables and preserves explicitly fixed table decoration',async()=>{
 const {templateDesignView}=await import('../../../apps/cowork-server/lib/ppt-template-design.mjs');const source={externalPptx:{width:10000,height:6000},deck:{slides:[{nodes:[{id:'old-table',type:'table',geometry:{x:4000,y:1600,width:5000,height:800},content:{}},{id:'rule',type:'shape',geometry:{x:4000,y:3500,width:5000,height:5},content:{}},{id:'brand-rule',type:'shape',geometry:{x:100,y:500,width:1000,height:5},content:{}}]}]}};
 const original=JSON.stringify(source),view=templateDesignView(source);assert.equal(view.deck.slides[0].nodes[1].content.mediaRole,'old_template_content');assert.notEqual(view.deck.slides[0].nodes[2].content.mediaRole,'old_template_content');assert.equal(JSON.stringify(source),original);
 const fixed=templateDesignView(source,new Set(),new Set(['old-table']));assert.notEqual(fixed.deck.slides[0].nodes[1].content.mediaRole,'old_template_content');assert.equal(fixed.deck.slides[0].nodes[0].content.mustPreserve,true);
});
