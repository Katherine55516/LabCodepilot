import assert from 'node:assert/strict';
import {textContract,textParagraphs} from './lib/ppt/render-contract.mjs';
import {inspectLongDeckOutline} from './lib/ppt-planning.mjs';
import {outlineDeltaPrompt,applyOutlineDelta,outlineError} from './lib/ppt-outline-protocol.mjs';
import {globalOutlinePlan} from './lib/ppt-global-outline-plan.mjs';
import {writerLocalRepairScope,applyWriterLocalDelta} from './lib/ppt-writer-local-repair.mjs';
const native={kind:'text',nativeStyleBaseline:{fontSizePt:14.5,fontFamily:'Source Sans 3',fontWeight:400},style:{fontFamily:'Source Sans 3',fontSizePt:14.5,fontWeight:400},bounds:{width:8000000,height:2000000},
 nativeTextFrame:{paragraphs:[{text:'First',runs:[{text:'First',fontFamily:'Source Sans 3',fontSizePt:14.5,bold:false}]},
 {text:'Second',runs:[{text:'Second',fontFamily:'DM Sans',fontSizePt:16.5,bold:true}]}]},content:{text:'First\nSecond'}};
assert.deepEqual(textContract(native).uniformStyle,{});
assert.deepEqual(textParagraphs(native).flatMap(p=>p.runs).map(r=>[r.fontFamily,r.fontSizePt,r.bold]),[['Source Sans 3',14.5,false],['DM Sans',16.5,true]]);
const changed={...native,style:{...native.style,fontFamily:'Georgia',fontSizePt:21.5,fontWeight:700,fontStyle:'italic'}};
assert.deepEqual(textContract(changed).uniformStyle,{fontFamily:'Georgia',fontSizePt:21.5,fontWeight:700,fontStyle:'italic'});
assert.ok(textParagraphs(changed).flatMap(p=>p.runs).every(r=>r.fontSizePt===21.5&&r.fontFamily==='Georgia'&&r.bold&&r.italic));
assert.deepEqual(textContract(native).uniformStyle,{},'restoring original style restores original per-run typography');
const pages=[{title:'Cover',focus:'Opening'},{title:'A',focus:'Use a stationary representation',refs:['1']},{title:'B',focus:'Use a stationary representation',refs:['2']},{title:'Conclusion',focus:'Close'}];
const repeated=inspectLongDeckOutline({},pages).filter(i=>i.code==='outline_repeated_claim');
assert.equal(repeated.length,1,'short decks have the same repeated-message gate');
assert.equal(repeated[0].details.pageIndex,2);
const rows=pages.map((p,i)=>({...p,...(i===1?{sourceArtifactRanges:[{sourceUnitId:'t',rowStart:1,rowEnd:3}]}:i===2?{sourceArtifactRanges:[{sourceUnitId:'t',rowStart:3,rowEnd:5}]}:{})}));
assert.equal(inspectLongDeckOutline({},rows).filter(i=>i.code==='outline_repeated_claim').length,0,'actual disjoint table continuations are permitted');
rows[2].sourceArtifactRanges[0].rowStart=2;
assert.equal(inspectLongDeckOutline({},rows).filter(i=>i.code==='outline_repeated_claim').length,1,'overlapping continuations cannot hide duplicate messages');
const raw={version:2,slides:[{title:'Cover',focus:'Opening',sourceUnitIds:[],retainedIdentity:'frozen'},
 {title:'A',focus:'Detail',sourceUnitIds:[]},{title:'End',focus:'Close',sourceUnitIds:[]}]};
const project={source:{semantic:{inventory:{items:[]}}}};
const prompt=outlineDeltaPrompt(project,raw,[{code:'outline_repeated_claim',details:{pageIndex:1},message:'same message'}]);
assert.ok(prompt.includes('<permitted_indexes>[1]</permitted_indexes>'));
assert.ok(prompt.includes('"focus":"Opening"'));
const fixed=applyOutlineDelta(project,raw,{version:2,replacements:[{index:1,slides:[{title:'A',focus:'Distinct mechanism',sourceUnitIds:[]}]}]},prompt);
assert.deepEqual(fixed.slides[0],raw.slides[0]);assert.deepEqual(fixed.slides[2],raw.slides[2]);
assert.throws(()=>applyOutlineDelta(project,raw,{version:2,replacements:[{index:0,slides:[raw.slides[0]]}]},prompt));
assert.equal(outlineDeltaPrompt(project,raw,[{code:'unknown',message:'No page scope'}]),null,'an unresolved scope must not rewrite the first sixteen pages');
for(const code of ['timeout','network','rate_limit'])assert.equal(outlineError(code).code,code);
const globalPlan=globalOutlinePlan({pages:12,source:{semantic:{inventory:{items:Array.from({length:30},(_,i)=>({id:'unit'+i,type:'MechanismBlock',text:'One complete fact. '.repeat(i+1),sectionPath:['Document','Section '+i%6]}))}}}});
assert.equal(globalPlan.sections.reduce((sum,s)=>sum+s.provisionalPages,0),globalPlan.bodyPageEstimate);
assert.equal(new Set(globalPlan.sections.flatMap(s=>s.sourceUnitIds)).size,30,'the whole-deck ledger owns every original source unit once');
const rawComment={sourceArtifacts:[{sourceUnitId:'real'}],sourceCommentary:[{type:'support',text:'This repeats the original table value of 12.'}],title:'Frozen'};
const capacityError=Error('source_artifact_capacity: {"sourceFits":true,"sourceHeightInches":3,"singleParagraphCjkCharacters":0}');
const scope=writerLocalRepairScope(rawComment,capacityError),target=scope.targets[0];
const omitted=applyWriterLocalDelta(rawComment,scope,{edits:[{path:target.path,start:target.start,end:target.end,before:target.before,after:''}]});
assert.deepEqual(omitted.value.sourceArtifacts,rawComment.sourceArtifacts);assert.equal(omitted.value.title,rawComment.title);
assert.throws(()=>applyWriterLocalDelta(rawComment,scope,{edits:[{path:target.path,start:target.start,end:target.end,before:target.before,after:'The value is 13.'}]}),'no numeric rewriting is allowed');
const noSources=writerLocalRepairScope({...rawComment,sourceArtifacts:[]},capacityError);
assert.throws(()=>applyWriterLocalDelta({...rawComment,sourceArtifacts:[]},noSources,{edits:[{path:target.path,start:target.start,end:target.end,before:target.before,after:''}]}),'a commentary-only page must retain its numerical facts');
console.log('PASS: per-run fidelity, uniform font/decimal size/style edits, short-deck repeat gate, genuine continuations, scoped delta preservation and safe errors');

const {validateLanguageProjection}=await import('./lib/ppt-language-projection.mjs');
const group={locale:'en',hash:'dimension',segments:[{key:'dim',text:'一维 CNN uses $F$ inputs with 12 values.'}]};
for(const equivalent of ['1D CNN uses $F$ inputs with 12 values.','One-dimensional CNN uses $F$ inputs with 12 values.'])assert.equal(validateLanguageProjection(group,{version:1,translations:[{key:'dim',text:equivalent}]}).translations.length,1);
assert.throws(()=>validateLanguageProjection(group,{version:1,translations:[{key:'dim',text:'2D CNN uses $F$ inputs with 12 values.'}]}));
assert.throws(()=>validateLanguageProjection(group,{version:1,translations:[{key:'dim',text:'1D CNN uses $G$ inputs with 12 values.'}]}));

const bilingualCell="Look-ahead risk if window includes $t$ improperly; discontinuities at window edges 若窗口不当地包含 $t$ 会有前视风险；窗口边缘会出现不连续";
const literalEnglish=bilingualCell.split(/[\u3400-\u9fff]/u)[0].trim();
assert.equal(validateLanguageProjection({locale:"en",hash:"bilingual-cell",segments:[{key:"cell",text:bilingualCell}]},{version:1,translations:[{key:"cell",text:literalEnglish}]}).translations.length,1);
assert.throws(()=>validateLanguageProjection({locale:"en",hash:"bilingual-cell",segments:[{key:"cell",text:bilingualCell}]},{version:1,translations:[{key:"cell",text:literalEnglish.replace("$t$","$s$")}]}));
const fullBoundScope=writerLocalRepairScope(rawComment,Error('source_artifact_capacity: {"sourceFits":true,"singleParagraphCjkCharacters":15}'),{allOwnedSourceBound:true});
assert.equal(fullBoundScope.optionalCommentaryCanOmit,true);

const {validateNavigationPlan,navigationPlanEntries,compileNavigationLabels,prepareNavigationPlan}=await import("./lib/ppt-navigation-plan.mjs");
const sections=[{section:"Architecture Assessment",targets:[{slideId:"s1",page:3}]},{section:"Capability Maturity",targets:[{slideId:"s2",page:4}]},{section:"Research Roadmap",targets:[{slideId:"s3",page:6}]}];
const navPlan=validateNavigationPlan(sections,{version:1,groups:[{label:"Assessment",memberIndexes:[0,1]},{label:"Roadmap",memberIndexes:[2]}]},{maxGroups:2,maxVisualUnits:10});
assert.deepEqual(navigationPlanEntries(sections,{...navPlan,audit:{status:"passed"}})[0].pageRanges,[{start:3,end:4}]);
assert.throws(()=>validateNavigationPlan(sections,{version:1,groups:[{label:"Assessment",memberIndexes:[0,1]}]},{maxGroups:2,maxVisualUnits:10}));
assert.throws(()=>validateNavigationPlan(sections,{version:1,groups:[{label:"Assessment",memberIndexes:[0,1]},{label:"Roadmap",memberIndexes:[1,2]}]},{maxGroups:2,maxVisualUnits:10}));
assert.equal(navigationPlanEntries(sections,navPlan),sections,"unaudited navigation labels cannot become visible");
const navCompiled=compileNavigationLabels({prompt:'English content'.repeat(20)},{version:1,groups:[{label:'Architecture Assessment and Capability Maturity',memberIndexes:[0,1]},{label:'Research Roadmap and Future Deliverables',memberIndexes:[2]}]},10);
assert.deepEqual(navCompiled.value.groups.map(group=>group.label),['Architecture Assessment and Capability Maturity','Research Roadmap and Future Deliverables']);
assert.equal(navCompiled.corrections.length,2);
assert.throws(()=>validateNavigationPlan(sections,navCompiled.value,{maxGroups:2,maxVisualUnits:10}),/label capacity/,'a too-long topic must be rewritten; preserving section IDs cannot justify clipping its words');
assert.equal(navigationPlanEntries(sections,{...navCompiled.value,registryHash:navPlan.registryHash}),sections,'unrepaired labels still require the independent audit');
const mergedNav=compileNavigationLabels({prompt:'English source'},{version:1,groups:[{label:'Research Roadmap one',memberIndexes:[0]},{label:'Research Roadmap two',memberIndexes:[1]}]},9);
assert.equal(mergedNav.value.groups.length,2,'different topics never merge merely because their prefixes would match');
const mixedNavProject={prompt:'The English source explains architecture and research methods. '.repeat(30),outline:[{id:'nav',role:'navigation'}]};
const mixedEntries=sections.map(entry=>({...entry,displayLabel:entry.section+' | 来源章节主题名称'}));let auditSeen=false;
await prepareNavigationPlan(mixedNavProject,mixedEntries,async prompt=>{
 if(prompt.includes('Navigation Plan Schema='))return {version:1,groups:[{label:'Architecture',memberIndexes:[0,1]},{label:'Research',memberIndexes:[2]}]};
 auditSeen=true;assert.ok(prompt.includes('ONLY English')&&prompt.includes('do not require both original languages'),'navigation audit must not restore the retired bilingual topic rule');
 return {version:1,checks:[0,1].map(groupIndex=>({groupIndex,faithful:true,reason:'The single-language name retains its original source topic.'}))};
});
assert.ok(auditSeen);assert.equal(mixedNavProject.navigationPlan.audit.status,'passed');
const completeLedger=[{section:'Layout and Design Engine',displayLabel:'Layout and Design Engine with complete component and typography responsibilities',targets:[{slideId:'d',page:2}]},{section:'Image and Media Pipeline',displayLabel:'Image and Media Pipeline including all original assets and figures',targets:[{slideId:'m',page:3}]}];
const conciseProject={...mixedNavProject,navigationPlan:undefined};let planCalls=0,auditCalls=0;
await prepareNavigationPlan(conciseProject,completeLedger,async prompt=>{
 if(prompt.includes('Navigation Plan Schema=')){planCalls++;if(planCalls===1)return {version:1,groups:[{label:'Layout, Theme, Design Engine, Image and Media Pipeline',memberIndexes:[0,1]}]};assert.match(prompt,/label capacity/);return {version:1,groups:[{label:'Design and Media',memberIndexes:[0,1]}]};}
 auditCalls++;assert.match(prompt,/Design and Media/);assert.ok(!prompt.includes('Layout, Theme, Design Engine, Image and Media Pipeline'),'unfaithful word-prefix truncation never reaches the auditor');return {version:1,checks:[{groupIndex:0,faithful:true,reason:'Both design and media subjects are explicitly represented.'}]};
});
assert.equal(planCalls,2);assert.equal(auditCalls,1);assert.equal(conciseProject.navigationPlan.groups[0].label,'Design and Media');assert.deepEqual(conciseProject.navigationPlan.groups[0].memberIndexes,[0,1]);

const {navigationWriterHeaders}=await import('./lib/ppt-deck-navigation.mjs');
const navProject={generationPolicy:{language:{mode:'output',locale:'en'}},templateFidelity:{slides:[{slots:[{shapeId:2,role:'section',capacity:5},{shapeId:3,role:'title'},{shapeId:4,role:'content'}]}]}};
assert.deepEqual(navigationWriterHeaders(navProject,{title:'Deck Navigation'},0),{'2':'Agenda','3':'Deck Navigation'},'compiled navigation owns short headers and keeps writer prose out of native label slots');

const {applyOutlineSelectionRepair,outlineSelectionRepairPrompt}=await import("./lib/ppt-outline-selection-repair.mjs");
const selected={version:2,selection:[{sourceUnitId:"en",destination:"notes",reason:"detail"},{sourceUnitId:"zh",destination:"notes",reason:"translation",visibleEquivalentSourceUnitId:"en"},{sourceUnitId:"frozen",destination:"slides",reason:"unchanged"}],slides:[{title:"Cover",role:"cover",focus:"Frozen",sourceUnitIds:[]},{title:"Mechanism",focus:"Frozen mechanism",sourceUnitIds:["frozen"]},{title:"Closing",focus:"Frozen closing",sourceUnitIds:[]}]};
const selectionError=Object.assign(Error("ppt_content_selection_invalid: target needs a primary owner"),{code:"coverage_invalid",details:{entry:{sourceUnitId:"zh"},allowedTargetOwners:[{sourceUnitId:"en",destination:"notes"}]}});
const selectedDelta=applyOutlineSelectionRepair(selected,selectionError,{version:2,updates:[{sourceUnitId:"en",destination:"slides",reason:"Visible original owner",primaryPageIndex:1}]});
assert.deepEqual(selectedDelta.slides[0],selected.slides[0]);assert.deepEqual(selectedDelta.slides[2],selected.slides[2]);assert.deepEqual(selectedDelta.selection.find(e=>e.sourceUnitId==="frozen"),selected.selection[2]);assert.equal(selectedDelta.slides[1].focus,selected.slides[1].focus);assert.deepEqual(selectedDelta.slides[1].sourceUnitIds,["frozen","en"]);
assert.throws(()=>applyOutlineSelectionRepair(selected,selectionError,{version:2,updates:[{sourceUnitId:"frozen",destination:"notes",reason:"Invalid unrelated edit",primaryPageIndex:null}]}));

const retainedProjection=applyOutlineSelectionRepair(selected,selectionError,{version:2,updates:[{sourceUnitId:"zh",destination:"notes",reason:"Keep the original projected notes",primaryPageIndex:null}]});
assert.equal(retainedProjection.selection.find(e=>e.sourceUnitId==="zh").visibleEquivalentSourceUnitId,"en","an absent optional delta key must not discard validated projection metadata");
const groupedSelectionError=Object.assign(Error('ppt_content_selection_invalid: invalid visible owner'),{code:'coverage_invalid',details:{conflicts:[{sourceUnitId:'zh',visibleEquivalentSourceUnitIds:['en']}]}});
const ownerRepair=applyOutlineSelectionRepair(selected,groupedSelectionError,{version:2,updates:[{sourceUnitId:'en',destination:'slides',reason:'Promote the actual allowed target owner',primaryPageIndex:1,visibleEquivalentSourceUnitId:'zh'}]});
assert.ok(ownerRepair.slides[1].sourceUnitIds.includes('en'),'a grouped diagnostic includes the allowed target in repair scope');
assert.equal(ownerRepair.selection.find(e=>e.sourceUnitId==='en').visibleEquivalentSourceUnitId,undefined,'visible owners cannot retain notes-only projection metadata');
assert.deepEqual(ownerRepair.selection.find(e=>e.sourceUnitId==='frozen'),selected.selection.find(e=>e.sourceUnitId==='frozen'));
const {selectionDeltaResponseSchema}=await import('./lib/ppt-outline-selection-repair.mjs');
const {navigationResponseSchema}=await import('./lib/ppt-navigation-plan.mjs');
const {writerDeltaResponseSchema}=await import('./lib/ppt-writer-local-repair.mjs');
const embedded={type:'object',properties:{text:{type:'string',description:'literal closing brace } and escaped quote " are data'}}};
for(const [read,marker] of [[selectionDeltaResponseSchema,'Outline Selection Delta Schema='],[navigationResponseSchema,'Navigation Plan Schema='],[writerDeltaResponseSchema,'Writer Delta Schema=']])assert.deepEqual(read(marker+JSON.stringify(embedded)+'\n<rejected_delta>{"target":"wrong"}</rejected_delta>\nRepair this delta only.'),embedded,'appended repair diagnostics must not drop the response schema');

const {fitNativeTextFrames}=await import('./lib/ppt-native-text-fit.mjs');
const pt=12700,nativeTitle={id:'native-title',type:'text',semanticRole:'template-title',nativeRef:{shapeId:4},style:{fontSizePt:44.5,fontFamily:'Fraunces SemiBold'},content:{text:'QuantPilot Review'},nativeTextFrame:{wordWrap:false,paragraphs:[{text:'Original title'}]},geometry:{x:50*pt,y:387.5*pt,width:850*pt,height:45*pt}};
const frameSlide={nodes:[structuredClone(nativeTitle),{id:'above',geometry:{x:50*pt,y:351*pt,width:850*pt,height:17*pt}},{id:'subtitle',geometry:{x:50*pt,y:443.5*pt,width:850*pt,height:27*pt}}]};
fitNativeTextFrames({templateFidelity:{height:540*pt}},frameSlide);
assert.ok(frameSlide.nodes[0].geometry.y<nativeTitle.geometry.y,'native title can use measured empty space above');
assert.ok(frameSlide.nodes[0].geometry.y>=369*pt);assert.ok(frameSlide.nodes[0].geometry.y+frameSlide.nodes[0].geometry.height<=442.5*pt);assert.deepEqual(frameSlide.nodes[0].style,nativeTitle.style);
const once=structuredClone(frameSlide);fitNativeTextFrames({templateFidelity:{height:540*pt}},frameSlide);assert.deepEqual(frameSlide,once,'upward expansion is idempotent');
const blockedFrame={nodes:[structuredClone(nativeTitle),{id:'above',geometry:{x:50*pt,y:370*pt,width:850*pt,height:17.5*pt}},frameSlide.nodes[2]]};fitNativeTextFrames({templateFidelity:{height:540*pt}},blockedFrame);assert.equal(blockedFrame.nodes[0].templateTitleFrameAdaptation.status,'blocked');assert.deepEqual(blockedFrame.nodes[0].geometry,nativeTitle.geometry);

const {prepareLanguagePairAudit,languagePairCandidates}=await import('./lib/ppt-language-pair-audit.mjs');
const {visibleEquivalentCandidates}=await import('./lib/ppt-content-selection.mjs');
const pairedLists={generationPolicy:{content:'overview',details:'notes',language:{mode:'output',locale:'en'}},source:{semantic:{inventory:{items:[{id:'list-en',type:'TaxonomyBlock',sectionPath:['Requirements'],text:'- Keep every condition\n- Never bypass review'},{id:'list-zh',type:'TaxonomyBlock',sectionPath:['Requirements'],text:'- 保留每个条件\n- 不得跳过审查'}]}}}};
const otherList=pairedLists.source.semantic.inventory.items[1];assert.deepEqual(visibleEquivalentCandidates(pairedLists,otherList),[],'a detected pair alone is not proof');
await prepareLanguagePairAudit(pairedLists,async()=>({checks:languagePairCandidates(pairedLists).map(p=>({hash:p.hash,equivalent:true,reason:'Both original lists state exactly the same two obligations with the same prohibitions.'}))}),async()=>{});
assert.deepEqual(visibleEquivalentCandidates(pairedLists,otherList),['list-en']);
pairedLists.source.semantic.inventory.items[0].text+='\n- An additional condition';assert.deepEqual(visibleEquivalentCandidates(pairedLists,otherList),[],'source changes invalidate equivalence');
await prepareLanguagePairAudit(pairedLists,async()=>({checks:languagePairCandidates(pairedLists).map(p=>({hash:p.hash,equivalent:false,reason:'An extra member has no counterpart.'}))}),async()=>{});assert.deepEqual(visibleEquivalentCandidates(pairedLists,otherList),[],'a negative semantic verdict keeps both complete objects');

// Invisible math application has no PDF glyph; visible operators remain mandatory.
const {EXPORT_VERIFY_SCRIPT}=await import('./lib/ppt/export-verifier-python.mjs');
const {spawnSync}=await import('node:child_process');
const inkDefinitions=EXPORT_VERIFY_SCRIPT.slice(EXPORT_VERIFY_SCRIPT.indexOf('def verify_key('),EXPORT_VERIFY_SCRIPT.indexOf('def verify_math_tree('));
const inkTest=spawnSync('python3',['-c','import re as verify_re, unicodedata as verify_unicode\n'+inkDefinitions+'\nassert verify_ink_key("ln\\u2061(x) + y − 1") == "ln(x)+y−1"\nassert verify_key("ln\\u2061(x)") != verify_key("ln(x)")\nassert verify_ink_key("x+y") != verify_ink_key("xy")']);
assert.equal(inkTest.status,0,inkTest.stderr?.toString());
