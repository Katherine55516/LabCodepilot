/* eslint-disable @typescript-eslint/no-explicit-any -- Contract and malformed-provider fixtures. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
const lib=process.cwd()+'/apps/cowork-server/lib/';
test('new three-depth contracts do not authorize an implicit full-input notes archive',async()=>{
 const {defaultGenerationPolicy,normalizeGenerationPolicy,detailProfile,allowsEditorialSelection}=await import(lib+'ppt-generation-policy.mjs');
 const p=defaultGenerationPolicy();assert.equal(p.version,2);assert.equal(p.details,undefined);assert.equal(p.archive,'none');assert.equal(p.detail,'standard');
 const profiles=['concise','standard','detailed'].map(detail=>{const policy=normalizeGenerationPolicy({...p,detail});assert.equal(policy.details,undefined);assert.ok(allowsEditorialSelection({generationPolicy:policy}));return detailProfile({generationPolicy:policy});});
 assert.ok(profiles[0].retention<profiles[1].retention&&profiles[1].retention<profiles[2].retention);
 assert.throws(()=>normalizeGenerationPolicy({...p,details:'notes'}),/invalid/);
 assert.equal(normalizeGenerationPolicy({version:1,detail:'balanced',details:'notes',content:'overview',language:{mode:'source'},knowledge:'source_only'}).details,'notes');
 assert.equal(allowsEditorialSelection({generationPolicy:{...p,content:'full_source'}}),false);
});
test('v2 optional provenance has an excluded ledger entry and creates no original-source speaker notes',async()=>{
 const {defaultGenerationPolicy}=await import(lib+'ppt-generation-policy.mjs');
 const {selectionConstraints,compileContentSelection,selectionNotesBySlide,selectionSource}=await import(lib+'ppt-content-selection.mjs');
 const items=[{id:'core',type:'DefinitionBlock',text:'Exposure is sensitivity to a source of common return variation.',sectionPath:['Concept'],source_ref:[]},{id:'refs',type:'TaxonomyBlock',text:'- [Reference](https://example.org/paper)\n- [Second reference](https://example.org/paper2)',sectionPath:['References'],source_ref:[]}];
 const p:any={pages:3,pageDecision:{mode:'auto'},generationPolicy:defaultGenerationPolicy(),source:{text:items.map(i=>i.text).join('\n'),semantic:{inventory:{items,relationships:[]}}}};
 const rules=selectionConstraints(p);assert.deepEqual(rules.find((r:any)=>r.sourceUnitId==='refs').allowedDestinations,['excluded']);
 const raw={version:2,slides:[{sourceUnitIds:[]},{sourceUnitIds:['core']},{sourceUnitIds:[]}],selection:[{sourceUnitId:'core',destination:'summary',summaryText:items[0].text,reason:'Complete concept'},{sourceUnitId:'refs',destination:'excluded',reason:'Optional provenance remains in source storage'}]};
 const ledger=compileContentSelection(p,raw);const selected=selectionSource(p,ledger);assert.equal(selected.semantic.inventory.items.find((i:any)=>i.id==='refs').presentation,'excluded_by_policy');
 assert.deepEqual(selectionNotesBySlide({...p,contentSelection:ledger,originalSourceInventory:{items,relationships:[]},deck:{slides:raw.slides}}),[]);
 const bad=structuredClone(raw);bad.selection[1].destination='notes';assert.throws(()=>compileContentSelection(p,bad),/contract/);
 const {isSourceArtifactItem}=await import(lib+'ppt-density-capacity.mjs');
 const {inspectDensityOutline}=await import(lib+'ppt-density-packing.mjs');
 const optional={id:'optional',type:'SummaryBlock',text:'Optional background',presentation:'excluded_by_policy',must_preserve_structure:false};
 assert.equal(isSourceArtifactItem(optional),false,'an authorized v2 exclusion must not reappear as a missing frozen object');
 assert.equal(isSourceArtifactItem({...optional,presentation:undefined}),true,'a visible summary still requires complete ownership');
 const missing=inspectDensityOutline({slides:raw.slides},{source:{semantic:{inventory:{items:[optional,{...optional,id:'required',presentation:undefined}]}}}});
 assert.equal(missing.length,1);assert.match(missing[0].message,/required/);
});
test('agent reads complete input before publishing a budget, retains manual N and rejects unread source IDs',async()=>{
 const {prepareInputUnderstanding,validateUnderstanding}=await import(lib+'ppt-input-understanding.mjs');
 const {defaultGenerationPolicy}=await import(lib+'ppt-generation-policy.mjs');
 const p:any={id:'p',pages:12,inputKind:'file',generationPolicy:defaultGenerationPolicy(),pageDecision:{mode:'auto'},source:{sha256:'file1',text:'Complete input with a condition: only after checking evidence.',semantic:{inventory:{items:[{id:'u',text:'Only after checking evidence.',type:'ConstraintBlock'}]}}}};
 const raw={version:1,subject:'Evidence',primaryLanguage:'en',groups:[{question:'When is it applicable?',sourceUnitIds:['u'],coreMessage:'Check evidence before use.',relations:['condition']}],recommended:5,min:4,max:7,reason:'A core condition with one explanation and the framing pages.'};
 let calls=0;const call=async(prompt:string,stage:string,schema:any)=>{calls++;assert.ok(prompt.includes(p.source.text));assert.match(stage,/input:understand/);assert.equal(schema.properties.recommended.minimum,3);assert.equal(p.inputUnderstanding,undefined);return raw;};
 await prepareInputUnderstanding(p,call);assert.equal(p.pages,5);assert.equal(p.pageDecision.agentRead,true);assert.equal(p.pageBudget.recommended,5);assert.equal(calls,1);
 await prepareInputUnderstanding(p,call);assert.equal(calls,1,'same-source reading checkpoint is reusable');
 const exact={...p,inputUnderstanding:undefined,pages:8,pageDecision:{mode:'explicit'}};await prepareInputUnderstanding(exact,async()=>raw);assert.equal(exact.pages,8);assert.equal(exact.pageBudget.requested,8);
 assert.throws(()=>validateUnderstanding(p,{...raw,groups:[{...raw.groups[0],sourceUnitIds:[]}]}),/unread source/);
});
test('role-based template scheduling does not force the first/last/original palette pages into content',async()=>{
 const {classifyTemplatePage,roleBasedTemplateMap}=await import(lib+'ppt-template-roles.mjs');
 const size={width:1000,height:600};const text=(value:string,y=100,pt=20)=>({type:'text',content:{text:value},geometry:{x:30,y,width:900,height:60},style:{fontSizePt:pt}});
 const pages=[{nodes:[text('Brand color palette')]},{nodes:[text('A presentation',220,40)]},{nodes:[text('The mechanism explains the conditions of use and the supporting evidence.',220)]},{nodes:[text('Agenda')]}];
 const profiles=pages.map(p=>({semantic:{pageRole:classifyTemplatePage(p,size),totalVisualCapacity:500}}));
 assert.equal(profiles[0].semantic.pageRole.role,'special');assert.equal(profiles[1].semantic.pageRole.role,'cover');assert.equal(profiles[2].semantic.pageRole.role,'content');assert.equal(profiles[3].semantic.pageRole.role,'navigation');
 const map=roleBasedTemplateMap(4,8,profiles,[]);assert.equal(map[0],1);assert.ok(map.slice(1).every((i:number)=>i===2));assert.ok(!map.includes(0));
});
test('bilingual topics become a dominant-language main title and a smaller differently-coloured editable heading',async()=>{
 const {planTitleHierarchy,bindTitleHierarchy}=await import(lib+'ppt-title-hierarchy.mjs');
 const {defaultGenerationPolicy}=await import(lib+'ppt-generation-policy.mjs');
 // Bilingual titles are opt-in since 2026-10-24 (language.title 'both'); the default shows the main language only.
 const base=defaultGenerationPolicy() as any;assert.equal(base.language.title,'primary');
 const p:any={generationPolicy:{...base,language:{...base.language,title:'both'}},source:{text:'这是主要使用中文解释的研究内容，需要在使用之前检查条件和证据。',semantic:{inventory:{items:[{id:'u',text:'这是主要使用中文解释的研究内容，需要在使用之前检查条件和证据。'}]}}},templateSpec:{palette:{background:'#ffffff',accent:'#42658a'}}};
 const planned=planTitleHierarchy(p,{slides:[{title:'Evidence / 证据',sourceUnitIds:['u']}]});assert.equal(planned.slides[0].title,'证据');assert.equal(planned.slides[0].titlePair.secondary,'Evidence');p.outline=planned.slides;
 const slide:any={id:'s',nodes:[{id:'main',type:'text',semanticRole:'title',content:{text:'证据'},geometry:{x:400000,y:1000000,width:8000000,height:600000},style:{fontSizePt:36,fontFamily:'Template Font',color:'#151617'}}]};
 bindTitleHierarchy(p,slide,0);const other=slide.nodes.find((n:any)=>n.semanticRole==='title-translation');assert.ok(other);assert.equal(other.content.text,'Evidence');assert.ok(other.style.fontSizePt<36);assert.notEqual(other.style.color,'#151617');assert.ok(other.geometry.y+other.geometry.height<1000000);assert.equal(other.style.fontFamily,'Template Font');
 assert.ok(Object.values(other.geometry).every(Number.isInteger),'generated title geometry uses canonical integer EMU');
 const {measureText}=await import(lib+'ppt/render-contract.mjs');
 assert.equal(measureText({...other,kind:'text',bounds:other.geometry}).overflow,false,'auxiliary text height includes the actual render contract');
 const {nativeTitleFitsFrame}=await import(lib+'ppt-template-fidelity.mjs');
 const nativeAux={...structuredClone(other),nativeRef:{slideIndex:0,shapeId:2},nativeTextFrame:{margins:[0,0,0,0],paragraphs:[]}},smallSlot={role:'section',shapeId:2,capacity:1,maxLines:1};
 assert.equal(nativeTitleFitsFrame({},smallSlot,nativeAux.content.text,nativeAux),true,'a bound translation uses its actual safe native frame rather than the old sample character budget');
 assert.equal(nativeTitleFitsFrame({},smallSlot,nativeAux.content.text,{...nativeAux,content:{text:nativeAux.content.text}}),false,'arbitrary section text does not receive the translation rule');
 assert.equal(nativeTitleFitsFrame({},smallSlot,nativeAux.content.text,{...nativeAux,geometry:{...nativeAux.geometry,width:12700}}),false,'actual width overflow still blocks');
 const labelled=structuredClone(slide),label={id:'navigation',type:'text',semanticRole:'eyebrow',content:{text:'研究背景',derivedFrom:'source-navigation'},geometry:{x:400000,y:700000,width:8000000,height:200000}};
 labelled.nodes.push(label);bindTitleHierarchy(p,labelled,0);
 const moved=labelled.nodes.find((n:any)=>n.semanticRole==='title-translation');assert.ok(moved.geometry.x>=label.geometry.x+label.geometry.width||moved.geometry.y+moved.geometry.height<label.geometry.y,'translation and navigation have disjoint measured regions');assert.equal(labelled.titleHierarchyIssue,undefined);assert.ok(moved.style.fontSizePt>=14);
 const blocked=structuredClone(labelled);blocked.nodes.push({id:'artwork',type:'image',geometry:{x:400000,y:0,width:8000000,height:700000}});bindTitleHierarchy(p,blocked,0);assert.match(blocked.titleHierarchyIssue,/No safe region/,'no safe title band is explicit rather than covering template media');
 const {buildRenderTree,rebuildRenderTree}=await import(lib+'ppt/render-tree.mjs');
 const {slideSvg}=await import(lib+'ppt/exporters/preview.mjs');
 for(const layout of ['summary','two-panel','formula-variables','item-icons','preserved']){
  const copy=structuredClone(slide);copy.layoutId=layout==='preserved'?'summary':layout;
  const project:any={...p,deck:{slides:[copy]}};
  if(layout==='preserved'){
   copy.templateSlideIndex=0;copy.nodes[0].nativeRef={slideIndex:0,shapeId:1};
   copy.nodes.push({id:'unbound',type:'text',semanticRole:'arbitrary',content:{text:'Must not leak'},geometry:{...other.geometry}});
   project.templateFidelity={mode:'preserve',slides:[{nodes:[structuredClone(copy.nodes[0])],background:'#ffffff'}]};
  }
  const tree=buildRenderTree(project),rendered=tree.slides[0].elements.filter((e:any)=>e.nodeId===other.id);
  assert.equal(rendered.length,1,layout+' retains exactly one auxiliary title');assert.deepEqual(rendered[0].bounds,other.geometry);assert.equal(rendered[0].content.text,'Evidence');
  assert.match(slideSvg(tree.slides[0]),/Evidence/,layout+' preview exposes the editable auxiliary');
  assert.ok(!tree.slides[0].elements.some((e:any)=>e.nodeId==='unbound'));
  const stale={...tree,renderContractVersion:10,slides:[{...tree.slides[0],elements:[]}]};
  assert.ok(rebuildRenderTree(project,stale,['unrelated']).slides[0].elements.some((e:any)=>e.nodeId===other.id),'old cached render contracts are rebuilt');
 }
 for(const override of ['userStyle','userGeometry','locked']){
  const edited=structuredClone(slide),aux=edited.nodes.find((n:any)=>n.semanticRole==='title-translation');aux[override]=true;
  aux.style.fontSizePt=14;aux.geometry.y+=100;const before=structuredClone(aux);
  bindTitleHierarchy(p,edited,0);bindTitleHierarchy(p,edited,0);
  assert.equal(edited.nodes.filter((n:any)=>n.semanticRole==='title-translation').length,1,override+' must not create duplicate title IDs');
  assert.deepEqual(edited.nodes.find((n:any)=>n.id===aux.id),before,override+' remains intact on rebinding');
 }
 other.nativeRef={shapeId:2};other.templateSlot={role:'section'};
 p.outline[0].title='研究证据';bindTitleHierarchy(p,slide,0);bindTitleHierarchy(p,slide,0);
 assert.equal(slide.nodes.filter((n:any)=>n.semanticRole==='title-translation').length,1,'repeated binding preserves the native auxiliary frame');
 assert.equal(slide.nodes.find((n:any)=>n.id===other.id).titlePair.primary,'研究证据','shortening the main title invalidates stale primary metadata');
 const english:any={...p,source:{text:'The complete source explains architecture and evidence.',semantic:{inventory:{items:[{id:'e',text:'The complete source explains architecture and evidence.'}]}}}};
 const cleaned=planTitleHierarchy(english,{slides:[{title:'Architecture',titleSecondary:'Evidence Architecture',titlePair:{primary:'Architecture',secondary:'Evidence Architecture',primaryLanguage:'en'},sourceUnitIds:['e']}]});assert.equal(cleaned.slides[0].titleSecondary,undefined);assert.equal(cleaned.slides[0].titlePair,undefined,'a second English phrase is not a second-language title');
 english.outline=[{title:'Architecture',titlePair:{primary:'Architecture',secondary:'Evidence Architecture',primaryLanguage:'en'}}];const stale:any={id:'stale',nodes:[{id:'main',type:'text',semanticRole:'title',content:{text:'Architecture'}},{id:'aux',type:'text',semanticRole:'title-translation',content:{text:'Evidence Architecture',derivedFrom:'title-hierarchy'}}]};bindTitleHierarchy(english,stale,0);assert.equal(stale.nodes.length,1);assert.equal(stale.nodes[0].content.text,'Architecture');
});
test('only registered metadata IDs may disappear during capacity repair; factual numbers and other slots remain protected',async()=>{
 const {writerLocalRepairScope,applyWriterLocalDelta}=await import(lib+'ppt-writer-local-repair.mjs');
 const {criticSlotTexts}=await import(lib+'ppt-critic-slot-scope.mjs');
 const raw={sourceArtifacts:[{sourceUnitId:'b_0028'}],sourceCommentary:['Source b_0028 and c_008: use only when cost < 10%.']};
 const scope=writerLocalRepairScope(raw,Error('source_artifact_capacity: {"sourceFits":true}'),{internalReferenceIds:['b_0028','c_008']});const t=scope.targets[0];
 const change=(after:string)=>({edits:[{path:t.path,start:t.start,end:t.end,before:t.before,after}]});
 assert.doesNotThrow(()=>applyWriterLocalDelta(raw,scope,change('Use only when cost < 10%.')));assert.throws(()=>applyWriterLocalDelta(raw,scope,change('Use only when cost < 20%.')),/numeric/);
 const draft={templateSlotTexts:{'1':'Confirmed title','2':'Wrong label','3':'Unrelated'},nodes:[{id:'label-node',nativeRef:{shapeId:2},content:{text:'Wrong label'},templateSlot:{role:'section'}}]};
 assert.deepEqual(criticSlotTexts(draft,{slotTexts:{'1':'Renamed','2':'Correct topic','3':'Changed'}},[{detail:'label-node does not describe this page.'}]),{'1':'Confirmed title','2':'Correct topic','3':'Unrelated'});
 assert.deepEqual(criticSlotTexts(draft,{slotTexts:{'2':'Correct topic'}},[{detail:'Unrelated finding'}]),draft.templateSlotTexts);
});

test('unwrapped source diagrams carry their full measured width into layout selection',async()=>{
 const {measureComponent,fitComponents,contentCanvas}=await import(lib+'ppt-density-capacity.mjs');
 const {measureText,textContract}=await import(lib+'ppt/render-contract.mjs');
 const component={type:'text',content:{text:'MODEL ROUTER '+(' branch'.repeat(24))+'\n  fast LLM → classify',codeBlock:{language:'diagram',preserveLayout:true}}};
 const geometry={x:0,y:0,width:200*12700,height:400*12700};
 const measured=measureComponent(component,geometry,14.5);assert.ok(measured.width>geometry.width);assert.equal(measured.overflow,true);assert.equal(measured.lines,2,'source lines remain unwrapped');
 const canvas=contentCanvas({},1).geometry;
 const fit=fitComponents([component],{},1);assert.equal(fit.capacity_ok,false,'a short but too-wide diagram must not be accepted by height alone');
 const wide={kind:'text',content:component.content,style:{fontSizePt:14.5,lineHeight:1.18},bounds:{...geometry,width:measured.width,height:measured.height}};
 assert.equal(measureText(wide,textContract(wide)).overflow,false,'reported required width actually holds every original glyph');
 assert.ok(canvas.width<measured.width);assert.equal(component.content.text.split('\n').length,2);
});

test('post-partition subject audit repairs one title, verifies only that page and retains valid page identities',async()=>{
 const {auditOutlineSubjects,prepareOutlineSubjectReplan,restoreOutlineSubjectDrafts}=await import(lib+'ppt-outline-subject-audit.mjs');
 const raw:any={version:2,slides:[{id:'cover',title:'Gamma',role:'cover',sourceUnitIds:[]},{id:'ir',title:'Traditional PPT Geometry',role:'content',sourceUnitIds:['u']},{id:'media',title:'Media Routing',role:'content',sourceUnitIds:['v']}]};
 const p:any={generationPolicy:{version:2,content:'overview',language:{mode:'source'}},source:{text:'Gamma stores semantic roles and design constraints. Media routing chooses an image source.',semantic:{inventory:{items:[{id:'u',type:'DefinitionBlock',text:'Gamma stores semantic roles and design constraints.'},{id:'v',type:'DefinitionBlock',text:'Media routing chooses an image source.'}]}}}};
 const before=structuredClone(raw),calls:string[]=[];
 const call=async(prompt:string,key:string,schema:any)=>{
  calls.push(key);
  if(key.startsWith('outline:subject-repair')){assert.match(prompt,/actualSelectedBody/);assert.match(prompt,/Gamma stores semantic roles/);return {version:2,updates:[{pageIndex:1,field:'title',text:'Semantic IR and Design'}]};}
  assert.equal(schema.properties.checks.minItems,key.includes('verify')?1:2);
  if(key.includes('verify')){assert.ok(!prompt.includes('"slideId":"media"'));return {version:1,checks:[{slideId:'ir',status:'aligned',reason:'The corrected subject matches the selected body.',evidenceSourceUnitIds:['u']}]};}
  return {version:1,checks:[{slideId:'ir',status:'mismatch',reason:'Only semantic IR is present; the geometry object table belongs elsewhere.',evidenceSourceUnitIds:['u']},{slideId:'media',status:'aligned',reason:'Media routing is present.',evidenceSourceUnitIds:['v']}]};
 };
 const after=await auditOutlineSubjects(p,raw,raw.slides,{slidePlan:[]},call);assert.equal(after.slides[1].title,'Semantic IR and Design');assert.deepEqual(after.slides[2],before.slides[2]);assert.deepEqual(raw,before);assert.equal(calls.length,3);
 await auditOutlineSubjects(p,after,after.slides,{slidePlan:[]},async()=>{throw Error('unchanged valid page audit must be reused');});
 // P0-2: subject review is degradable. A locked mismatch, an unusable
 // response or a missing verdict becomes a listed warning (a mismatch stops
 // automatic generation for review); the outline itself is not failed.
 const locked=structuredClone(raw);locked.slides[1].titleLocked=true;const lockedWarnings:any[]=[];const lockedProject:any={...p,outlineSubjectAudit:undefined};
 const lockedAfter=await auditOutlineSubjects(lockedProject,locked,locked.slides,{slidePlan:[]},call,async()=>{},(w:any)=>lockedWarnings.push(w));assert.equal(lockedAfter.slides[1].title,raw.slides[1].title);assert.equal(locked.slides[1].title,raw.slides[1].title);
 assert.deepEqual(lockedWarnings.map(w=>[w.code,w.pageIndex,w.requiresReview]),[['outline_subject_mismatch',1,true]]);assert.equal(lockedProject.outlineSubjectAudit.pages.ir,undefined,'a skipped page is re-audited next time');
 let attempts=0;const emptyWarnings:any[]=[];const emptyAfter=await auditOutlineSubjects({...p,outlineSubjectAudit:undefined},raw,raw.slides,{slidePlan:[]},async()=>{attempts++;return {version:1,checks:[]};},async()=>{},(w:any)=>emptyWarnings.push(w));assert.equal(attempts,2);assert.deepEqual(emptyAfter,raw);assert.deepEqual(emptyWarnings.map(w=>[w.code,w.pageIndex,w.resolution]),[['outline_subject_audit_unavailable',1,'audit_skipped'],['outline_subject_audit_unavailable',2,'audit_skipped']]);
 let partial=0;await auditOutlineSubjects({...p,outlineSubjectAudit:undefined},raw,raw.slides,{slidePlan:[]},async(prompt:string,key:string,schema:any)=>{partial++;if(key.endsWith(':contract')){assert.equal(schema.properties.checks.minItems,1);assert.ok(!prompt.includes('"slideId":"ir"'));return {version:1,checks:[{slideId:'media',status:'aligned',reason:'Media body is present.',evidenceSourceUnitIds:['v']}]};}return {version:1,checks:[{slideId:'ir',status:'aligned',reason:'This valid verdict must stay unchanged.',evidenceSourceUnitIds:['u']},{slideId:'unknown',status:'aligned',reason:'Invalid identity.'}]};});assert.equal(partial,2);
 let borrowed=0;const borrowedWarnings:any[]=[];const borrowedProject:any={...p,outlineSubjectAudit:undefined};await auditOutlineSubjects(borrowedProject,raw,raw.slides,{slidePlan:[]},async()=>{borrowed++;return {version:1,checks:[{slideId:'ir',status:'aligned',reason:'Incorrectly borrowing a peer source.',evidenceSourceUnitIds:['v']},{slideId:'media',status:'aligned',reason:'Media is present.',evidenceSourceUnitIds:['v']}]};},async()=>{},(w:any)=>borrowedWarnings.push(w));assert.equal(borrowed,2,'peer-page evidence cannot authorize an aligned subject');
 assert.ok(borrowedWarnings.length>0&&borrowedWarnings.every(w=>w.code==='outline_subject_audit_unavailable'),'borrowed evidence is never cached as aligned');assert.equal(borrowedProject.outlineSubjectAudit,undefined);
 const unevaluated:any[]=[];await auditOutlineSubjects({...p,outlineSubjectAudit:undefined},raw,raw.slides,{slidePlan:[]},async()=>({version:1,checks:['ir','media'].map(slideId=>({slideId,status:'not_evaluated',reason:'No verdict.',evidenceSourceUnitIds:[]}))}),async()=>{},(w:any)=>unevaluated.push(w));
 assert.deepEqual(unevaluated.map(w=>[w.code,w.pageIndex]),[['outline_subject_audit_unavailable',1],['outline_subject_audit_unavailable',2]]);
 const nodes:any=Object.fromEntries(raw.slides.map((s:any)=>[s.id,{status:'done',slide:{...structuredClone(s),nodes:[{id:s.id+'-title',semanticRole:'title',type:'text',content:{text:s.title}},{id:s.id+'-body',type:'text',semanticRole:'source-structure',content:{text:'Unchanged body '+s.id},style:{fontSizePt:18}}]}}]));
 nodes.ir.slide.nodes.push({id:'stale-translation',type:'text',semanticRole:'title-translation',content:{text:'Old geometry topic',derivedFrom:'title-hierarchy'}});
 const recovery:any={...p,status:'paused',pages:3,revision:1,publishedRevision:0,outline:structuredClone(raw.slides),nodes:structuredClone(nodes),candidateOutline:{accepted:true,executionPlan:raw},confirmedOutline:{titlesFrozen:true},runtime:{slides:{},criticRepair:{attempts:[{nodeKey:'prior-real-attempt',rolledBack:true}]}},editing:{epochs:{}}};
 const priorAudit=structuredClone(recovery.outlineSubjectAudit);prepareOutlineSubjectReplan(recovery);assert.equal(recovery.status,'outlining');assert.equal(recovery.confirmedOutline,undefined);assert.equal(recovery.outlineSubjectAudit,undefined,'explicit re-review cannot silently reuse the disputed aligned verdict');assert.deepEqual(recovery.outlineRepairHistory.at(-1).subjectAudit,priorAudit,'old verdict remains auditable');recovery.outline=after.slides;restoreOutlineSubjectDrafts(recovery);
 assert.deepEqual(recovery.nodes.media,nodes.media,'unaffected complete page is byte-for-byte unchanged');assert.deepEqual(recovery.nodes.ir.slide.nodes[1],nodes.ir.slide.nodes[1]);assert.equal(recovery.nodes.ir.slide.title,'Semantic IR and Design');assert.equal(recovery.outlineSubjectDraftRecovery.retainedCompletedPages,3);
 assert.ok(!recovery.nodes.ir.slide.nodes.some((n:any)=>n.id==='stale-translation'));assert.equal(recovery.runtime.criticRepairHistory[0].attempts[0].nodeKey,'prior-real-attempt','previous repair run evidence remains intact');
 const edited={...recovery,status:'paused',editing:{epochs:{ir:1}}};await assert.rejects(async()=>prepareOutlineSubjectReplan(edited),/manual or accepted/);
 const bad=structuredClone(recovery);bad.outline[1].sourceUnitIds=['v'];assert.throws(()=>restoreOutlineSubjectDrafts(bad),/changed body ownership/);
 const pending=structuredClone(recovery);pending.status='failed';pending.nodes.media={status:'pending'};assert.doesNotThrow(()=>prepareOutlineSubjectReplan(pending));
 const ready=structuredClone(recovery);ready.status='outline_ready';assert.doesNotThrow(()=>prepareOutlineSubjectReplan(ready),'a retained unpublished ready outline may explicitly reopen subject review');
});

test('explicit outline confirmation keeps completed drafts unless their body contract changed',async()=>{
 const {retainConfirmedOutlineDrafts}=await import(lib+'ppt-outline-subject-audit.mjs'),{_internals}=await import(lib+'ppt-api.mjs');
 const source={segments:[],semantic:{inventory:{items:[]},chunks:[]}},raw={slides:[{id:'cover',title:'Deck',focus:'Intro'},{id:'body',title:'Semantic IR',focus:'Explain the source roles'},{id:'closing',title:'Closing',focus:'End'}]};
 const outline=_internals.normalizeOutline(raw,3,source),before:any={template:'same',generationPolicy:{version:2},outline,nodes:Object.fromEntries(outline.map((o:any)=>[o.id,{status:'done',attempts:1,slide:{title:o.title,nodes:[{id:o.id+'-title',semanticRole:'title',type:'text',content:{text:o.title}},{id:o.id+'-body',type:'text',content:{text:'Retained body'}}]}}]))};
 const next:any={template:before.template,generationPolicy:before.generationPolicy,outline:_internals.normalizeOutline({slides:outline},3,source)};
 const same=retainConfirmedOutlineDrafts(before,next);assert.deepEqual(same,before.nodes,'the actual normalize-confirm path retains every completed body');
 next.outline[1].title='IR roles';const renamed=retainConfirmedOutlineDrafts(before,next);assert.equal(renamed.body.slide.title,'IR roles');assert.deepEqual(renamed.body.slide.nodes[1],before.nodes.body.slide.nodes[1]);assert.deepEqual(renamed.cover,before.nodes.cover);
 next.outline[1].focus='A different explanation';const changed=retainConfirmedOutlineDrafts(before,next);assert.equal(changed.body,undefined);assert.deepEqual(changed.cover,before.nodes.cover);
 assert.deepEqual(retainConfirmedOutlineDrafts(before,{...next,template:'other'}),{});assert.deepEqual(retainConfirmedOutlineDrafts(before,{...next,generationPolicy:{version:2,detail:'detailed'}}),{});
 const {applyOutlineMetadataRepair,fragmentTitle}=await import(lib+'ppt-outline-protocol.mjs');
 const partition={slides:[{id:'part',title:'Wrong subject',sourceUnitIds:['u'],sourceArtifactRanges:[{sourceUnitId:'u',lineStart:0,lineEnd:2}]}]};
 const repaired=applyOutlineMetadataRepair(partition,{details:{metadataConflicts:[{pageIndex:0,field:'title',reason:'semantic_subject_alignment',maxLength:160}]}},{version:2,updates:[{pageIndex:0,field:'title',text:'Semantic roles'}]});
 assert.equal(repaired.slides[0].titleBasis,'source_alignment_metadata_repair');assert.ok(repaired.slides[0].titleSourceScope);assert.equal(fragmentTitle(repaired.slides[0],source).title,'Semantic roles');
});

test('source table counters distinguish original, selected and displayed rows without rewriting facts',async()=>{
 const {reviewSourceStructure,audiencePredicateRules}=await import(lib+'ppt-review-source-structure.mjs');
 const original={id:'table',rows:[['Field'],...Array.from({length:16},(_,i)=>['row '+i])]},selected={...original,rows:original.rows.slice(0,9)};
 const p={source:{semantic:{inventory:{items:[selected]}}},originalSourceInventory:{items:[original]}},node={type:'table',sourceArtifact:{sourceUnitId:'table',rowStart:1,rowEnd:5},content:{rows:selected.rows.slice(0,5)}};
 const before=JSON.stringify({p,node}),view=reviewSourceStructure(node,p);
 assert.deepEqual([view.originalDataRowCount,view.currentSourceDataRowCount,view.displayedDataRowCount],[16,8,4]);assert.match(view.countSemantics.currentSourceDataRowCount,/selection/);assert.match(audiencePredicateRules,/wrong targets/);assert.equal(JSON.stringify({p,node}),before);
});

test('selected table presence joins exact original rows across every visible fragment',async()=>{
 const {tablePresenceWitnesses}=await import(lib+'ppt-review-source-structure.mjs');
 const rows=[['Workflow','Output'],['Create','Draft'],['Edit','Changed'],['Restyle','Style'],['Export','PPTX'],['Analytics','Usage']],original={id:'table',type:'TableBlock',rows,text:'Workflow table'},selected={...original,rows:[rows[0],rows[1],rows[4],rows[5]],derivedSummary:{selectedRows:true,sourceCellMap:[[{row:0,column:0}],[{row:1,column:0}],[{row:4,column:0}],[{row:5,column:0}]]}};
 const p:any={originalSourceInventory:{items:[original]},source:{semantic:{inventory:{items:[selected]}}},contentSelection:{entries:[{sourceUnitId:'table',rowIndices:[1,4,5]}]},deck:{slides:[{id:'first',nodes:[{id:'a',type:'table',sourceArtifact:{sourceUnitId:'table',rowStart:1,rowEnd:3},content:{rows:structuredClone(selected.rows.slice(0,3))}}]},{id:'later',nodes:[{id:'b',type:'table',sourceArtifact:{sourceUnitId:'table',rowStart:3,rowEnd:4},content:{rows:structuredClone([rows[0],rows[5]])}}]}]}};
 const {createHash}=await import('node:crypto');const hash=(v:any)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');p.source.text='Workflow table';const material={version:1,contract:'overview',sourceHash:hash(p.source.text),requestedPages:2,entries:[{sourceUnitId:'table',destination:'summary',rowIndices:[1,4,5],unitHash:hash(original)}],relations:[]};p.contentSelection={...material,hash:hash(material)};
 const before=JSON.stringify(p),w=tablePresenceWitnesses(p)[0];assert.deepEqual(w.requiredOriginalRowIndices,[1,4,5]);assert.deepEqual(w.unrepresentedRequiredRows,[]);assert.equal(w.rows.find((r:any)=>r.originalRowIndex===5).visibleAt[0].slideId,'later');assert.equal(JSON.stringify(p),before);
 const altered=structuredClone(p);altered.deck.slides[1].nodes[0].content.rows[1][1]='A different output';assert.deepEqual(tablePresenceWitnesses(altered)[0].unrepresentedRequiredRows,[5],'a matching source ID cannot certify changed cells');
 const hidden=structuredClone(p);hidden.deck.slides[1].nodes[0].hidden=true;assert.deepEqual(tablePresenceWitnesses(hidden)[0].unrepresentedRequiredRows,[5],'hidden cells are not visible witnesses');
 const stale=structuredClone(p);stale.contentSelection.hash='stale';assert.equal(tablePresenceWitnesses(stale)[0].selectionValidated,false);assert.deepEqual(tablePresenceWitnesses(stale)[0].unrepresentedRequiredRows,[2,3],'an invalid ledger cannot authorize skipping original rows');
 const {fragmentTitle,applyOutlineMetadataRepair}=await import(lib+'ppt-outline-protocol.mjs'),{topicRangeConstraint,topicHasSubject}=await import(lib+'ppt-topic-title-validation.mjs');
 const source=p.source,raw={title:'Workflows (rows 1–2)',sourceUnitIds:['table'],sourceArtifactRanges:[{sourceUnitId:'table',rowStart:1,rowEnd:3}],titleBasis:'native_capacity_metadata_repair'};
 const fixed=fragmentTitle(raw,source,{cleanWholeLocators:true});assert.equal(fixed.title,'Workflows (selected rows 1–2)');const constraint=topicRangeConstraint(fixed);assert.equal(constraint.rowNumbering,'selected_source_rows');assert.deepEqual(constraint.requiredTopicRange,['1','2']);assert.equal(topicHasSubject('(selected rows 1–2)'),false);
 const diagnostic={details:{metadataConflicts:[{pageIndex:0,field:'title',maxLength:160,topicLanguage:'en',...constraint}]}};
 assert.throws(()=>applyOutlineMetadataRepair({slides:[fixed]},diagnostic,{version:2,updates:[{pageIndex:0,field:'title',text:'Workflows (rows 1–2)'}]}),/range|selected-row/);
 assert.equal(fragmentTitle({...raw,titleLocked:true},source,{cleanWholeLocators:true}).title,raw.title,'explicitly locked audience copy remains unchanged');
 const {slideSourceHeading}=await import(lib+'ppt-section-eyebrow.mjs');
 const chapter={generationPolicy:{version:2},source:{semantic:{inventory:{items:[{id:'u',sectionPath:['Gamma','5. Card-based Document IR','Traditional PPT Geometry']}]}}}};
 assert.equal(slideSourceHeading(chapter,{planningProtocolVersion:2,sourceUnitIds:['u']}),'5. Card-based Document IR','one comparison example does not become the next physical page navigation label');
 const {normalizeDeckEyebrows}=await import(lib+'ppt-section-eyebrow.mjs');
 const mixed:any={...chapter,generationPolicy:{version:2,content:'overview',selection:'editorial',language:{mode:'source'}},source:{text:'中文的文档主体。'.repeat(100),semantic:{inventory:{items:[{id:'u',text:'Gamma semantic IR stores roles, content, hierarchy, media intent and layout constraints.',sectionPath:['Gamma','5. Card-based Document IR','Traditional PPT Geometry']}]}}},outline:[{id:'cover'},{id:'body',planningProtocolVersion:2,sourceUnitIds:['u'],section:'Traditional PPT Geometry'}],deck:{slides:[{id:'cover',nodes:[]},{id:'body',section:'Traditional PPT Geometry',copy:{eyebrow:'Old'},nodes:[{id:'eye',type:'text',semanticRole:'eyebrow',content:{text:'Old'}}]}]}};
 normalizeDeckEyebrows(mixed);assert.equal(mixed.deck.slides[1].copy.eyebrow,'5 Card-based Document IR','actual output uses this page language and chapter, rather than a stale global-language fallback');
});

test('automatic native section labels follow the page language while real secondary titles remain allowed',async()=>{
 const {inspectTemplateSlotDraft}=await import(lib+'ppt-template-fidelity.mjs'),{defaultGenerationPolicy}=await import(lib+'ppt-generation-policy.mjs');
 const p:any={generationPolicy:defaultGenerationPolicy(),outline:[{id:'cover'},{id:'body',sourceUnitIds:['u']},{id:'end'}],source:{text:'纯中文输入说明本页的设计规则和实际目标。',semantic:{inventory:{items:[{id:'u',type:'SummaryBlock',text:'本页说明设计规则和实际目标。',sectionPath:['中文章节']}]}}},templateFidelity:{mode:'preserve',slides:[{}, {nodes:[{id:'section',type:'text',nativeRef:{shapeId:1},content:{text:'Original'}}],slots:[{shapeId:1,role:'section',capacity:80}]},{}]}};
 const slide:any={id:'body',title:'设计规则',section:'Core Goal',templateSlotTexts:{'1':'Core Goal'},sourceArtifactNodes:[{id:'s',type:'text',sourceArtifact:{sourceUnitId:'u'},content:{text:'设计规则和实际目标。'}}]};
 assert.ok(inspectTemplateSlotDraft(p,1,slide).some((i:{code:string})=>i.code==='template_slot_language_mismatch'));
 slide.section='本页目标';slide.templateSlotTexts['1']='本页目标';assert.ok(!inspectTemplateSlotDraft(p,1,slide).some((i:{code:string})=>i.code==='template_slot_language_mismatch'));
 p.outline[1].titlePair={primary:'设计规则',secondary:'Design Rules'};slide.section='Design Rules';slide.templateSlotTexts['1']='Design Rules';assert.ok(!inspectTemplateSlotDraft(p,1,slide).some((i:{code:string})=>i.code==='template_slot_language_mismatch'));
});

test('actual outline normalization retains canonical page IDs through a title-only reassessment',async()=>{
 const {bindOutlineSubjectIds}=await import(lib+'ppt-outline-subject-audit.mjs'),{_internals}=await import(lib+'ppt-api.mjs');
 const source={segments:[],semantic:{inventory:{items:[]},chunks:[]}},raw={version:2,slides:[{title:'Deck',sourceUnitIds:[]},{title:'Semantic IR',sourceUnitIds:[]},{title:'Closing',sourceUnitIds:[]}]};
 const first=_internals.normalizeOutline(raw,3,source),bound=bindOutlineSubjectIds(raw,first);assert.ok(!('id' in raw.slides[1]));
 bound.slides[1].title='Semantic Design';const second=_internals.normalizeOutline(bound,3,source);
 assert.deepEqual(second.map((s:any)=>s.id),first.map((s:any)=>s.id));assert.equal(second[1].title,'Semantic Design');
 assert.throws(()=>bindOutlineSubjectIds(raw,[first[0],first[0],first[2]]),/non-unique/);
});

test('page topics are checked against their owned input language, not the deck majority',async()=>{
 const {inspectOutlineTopicLanguages}=await import(lib+'ppt-topic-title-validation.mjs');
 const {defaultGenerationPolicy}=await import(lib+'ppt-generation-policy.mjs');
 const p:any={generationPolicy:defaultGenerationPolicy(),source:{text:'This is an English deck with an English majority and a Chinese source page.',semantic:{inventory:{items:[{id:'zh',text:'这里解释条件、边界与实际证据，使用前需要进行验证。'},{id:'en',text:'Conditions and evidence are checked before this mechanism is used.'}]}}}};
 assert.deepEqual(inspectOutlineTopicLanguages(p,[{title:'条件和证据',sourceUnitIds:['zh']},{title:'Conditions and evidence',sourceUnitIds:['en']}]),[]);
 assert.equal(inspectOutlineTopicLanguages(p,[{title:'Conditions and evidence',sourceUnitIds:['zh']}])[0].code,'planned_topic_language_mismatch');
});

test('v2 template design classifies media before retiring old report content',async()=>{
 const {templateDesignView}=await import(lib+'ppt-template-design.mjs');
 const imported:any={externalPptx:{width:1000,height:600},deck:{slides:[{nodes:[{id:'photo',type:'image',content:{dataUrl:'data:image/jpeg;base64,fixture'},geometry:{x:0,y:0,width:350,height:600}},{id:'chart',type:'image',content:{dataUrl:'data:image/png;base64,old-plot'},geometry:{x:450,y:200,width:350,height:250}}]}]}};
 const view=templateDesignView(imported,new Set(['chart']),new Set(),{preserveClassifiedDesign:true,roleFor:(n:any)=>n.id==='photo'?'template_decoration':'unknown'});
 assert.equal(view.deck.slides[0].nodes[0].content.mediaRole,'template_decoration');assert.equal(view.deck.slides[0].nodes[0].content.templateSample,undefined);
 assert.equal(view.deck.slides[0].nodes[1].content.mediaRole,'old_template_content');assert.equal(imported.deck.slides[0].nodes[0].content.mediaRole,undefined);
});

test('an overlong group core message is repaired as a single field without rewriting valid groups or ownership',async()=>{
 const {semanticGroupMetadataSchema,applySemanticGroupMetadataRepair}=await import(lib+'ppt-semantic-groups.mjs');
 const raw={version:2,groups:[{title:'Frozen topic',coreMessage:'Frozen message',sourceUnitIds:['a']},{title:'Architecture',coreMessage:'x'.repeat(323),sourceUnitIds:['b'],pages:2}]};
 const diagnostic={index:1,field:'coreMessage',maxLength:320,actualLength:323};const before=JSON.stringify(raw);
 assert.equal(semanticGroupMetadataSchema(diagnostic).properties.updates.items.properties.index.const,1);
 const delta={version:1,updates:[{index:1,field:'coreMessage',value:'Semantic decisions and geometric decisions have separate source-supported responsibilities.'}]};
 const next=applySemanticGroupMetadataRepair(raw,diagnostic,delta);assert.deepEqual(next.groups[0],raw.groups[0]);assert.deepEqual(next.groups[1].sourceUnitIds,['b']);assert.equal(next.groups[1].pages,2);assert.equal(JSON.stringify(raw),before);
 assert.throws(()=>applySemanticGroupMetadataRepair(raw,diagnostic,{...delta,updates:[{...delta.updates[0],index:0}]}),/Invalid scoped/);
 assert.throws(()=>applySemanticGroupMetadataRepair(raw,diagnostic,{...delta,updates:[{...delta.updates[0],value:'x'.repeat(321)}]}),/Invalid scoped/);
});
test('a clipped bilingual conjunction is repaired locally while authored and locked topics remain intact',async()=>{
 const {inspectOutlineTopicLanguages}=await import(lib+'ppt-topic-title-validation.mjs');const {defaultGenerationPolicy}=await import(lib+'ppt-generation-policy.mjs');
 const p:any={generationPolicy:defaultGenerationPolicy(),source:{text:'输入模式根据资料完整程度选择不同的处理路径，完整文本可以跳过重复研究。',semantic:{inventory:{items:[{id:'u',text:'输入模式根据资料完整程度选择不同的处理路径，完整文本可以跳过重复研究。',sectionPath:['3. Input Layer 与 Creation Modes']}]}}}};
 const slide={title:'与 Creation Modes',sourceUnitIds:['u']};assert.equal(inspectOutlineTopicLanguages(p,[slide])[0].code,'planned_topic_fragment');assert.deepEqual(inspectOutlineTopicLanguages(p,[{...slide,title:'输入模式'}]),[]);assert.deepEqual(inspectOutlineTopicLanguages(p,[{...slide,titleLocked:true}]),[]);
 const {outlineMetadataRepairPrompt,repairOutlineMetadataBatch}=await import(lib+'ppt-outline-protocol.mjs');const raw={version:2,slides:[{title:'Cover',sourceUnitIds:[]},slide]};const diagnostic={details:{metadataConflicts:inspectOutlineTopicLanguages(p,raw.slides)}};assert.ok(outlineMetadataRepairPrompt(p,raw,diagnostic).includes('overriding whole-deck majority'));
 let calls=0;const delta=await repairOutlineMetadataBatch(p,raw,diagnostic,async()=>({version:2,updates:[{pageIndex:1,field:'title',text:++calls===1?'Creation Modes':'输入模式'}]}));assert.equal(calls,2);assert.equal(delta.updates[0].text,'输入模式');
 const authored=structuredClone(p);authored.source.semantic.inventory.items[0].sectionPath=['与 Creation Modes'];assert.deepEqual(inspectOutlineTopicLanguages(authored,[slide]),[]);
 const chinese={title:'与输入适配策略',sourceUnitIds:['u']};assert.equal(inspectOutlineTopicLanguages(p,[chinese])[0].code,'planned_topic_fragment');assert.deepEqual(inspectOutlineTopicLanguages(p,[{...chinese,titleLocked:true}]),[]);
 authored.source.semantic.inventory.items[0].sectionPath=['与输入适配策略'];assert.deepEqual(inspectOutlineTopicLanguages(authored,[chinese]),[],'exact source headings remain authoritative');
 const {topicIsTruncatedFragment}=await import(lib+'ppt-topic-title-validation.mjs');assert.equal(topicIsTruncatedFragment('和谐架构'),false);assert.equal(topicIsTruncatedFragment('或有负债'),false);
 const {auditOutlineSubjects}=await import(lib+'ppt-outline-subject-audit.mjs'),body={...chinese,id:'body'},cover={id:'cover',title:'封面',role:'cover',sourceUnitIds:[]},rawChinese={version:2,slides:[cover,body]};
 const stages:string[]=[];const fixed=await auditOutlineSubjects(p,rawChinese,rawChinese.slides,{slidePlan:[]},async(prompt:string,key:string)=>{stages.push(key);if(key.startsWith('outline:subject-format:')){assert.match(prompt,/actualSelectedBody/);return {version:2,updates:[{pageIndex:1,field:'title',text:'输入适配策略'}]};}return {version:1,checks:[{slideId:'body',status:'aligned',reason:'This complete subject matches its own input strategy.',evidenceSourceUnitIds:['u']}]};});
 assert.equal(fixed.slides[1].title,'输入适配策略');assert.deepEqual(fixed.slides[1].sourceUnitIds,['u']);assert.deepEqual(stages,['outline:subject-format:0','outline:subject-audit:0']);assert.equal(rawChinese.slides[1].title,'与输入适配策略','source candidate is not edited in place');
});
