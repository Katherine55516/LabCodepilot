import {it} from 'node:test';import assert from 'node:assert/strict';
const m=(name:string)=>import('../../../apps/cowork-server/lib/'+name+'.mjs');
it('rich source separates code/currency/Markdown/math and flags unsupported structure',async()=>{
 const {sourceRichText,sourceDisplayText}=await m('ppt-rich-text');
 for(const v of ['$10 and $20','snake_case','a*b'])assert.equal(sourceDisplayText(v),v);
 assert.equal(sourceDisplayText('`a**b $x_i$`'),'a**b $x_i$');
 assert.equal(sourceDisplayText('# Title\n- **One**\n- Two'),'Title\n• One\n• Two');
 const rich=sourceRichText('**Model** $x_i^{2}$');assert.ok(rich.runs.some((r:{bold?:boolean})=>r.bold));assert.ok(rich.runs.some((r:{mathMl?:string;fallbackRuns:{baseline:number}[]})=>r.mathMl&&r.fallbackRuns.some((f:{baseline:number})=>f.baseline<0)));assert.equal(rich.diagnostics.length,0);
 assert.equal(sourceRichText('$\\unknownmacro{x}$').diagnostics[0].code,'math_parse_unsupported');assert.equal(sourceRichText('x_i^{RMW}').diagnostics[0].code,'math_delimiter_missing');
});
it('content disposition requires explicit notes authority, complete ledger, immutable source and critical facts',async()=>{
 const {compileContentSelection,selectionSource,selectionNotesBySlide,exactPageConflict}=await m('ppt-content-selection');
 const original={items:[{id:'definition',type:'DefinitionBlock',text:'Definition of the concept',sectionPath:['Topic'],source_ref:['1']},{id:'detail',type:'ExampleBlock',text:'A secondary example.',sectionPath:['Topic'],source_ref:['2']}],relationships:[]};
 const project={pages:3,pageDecision:{mode:'explicit',finalPageCount:3},generationPolicy:{content:'overview',details:'notes'},source:{text:'Immutable full source',semantic:{inventory:original}},deck:{slides:[{id:'one',sourceUnitIds:['definition']},{id:'two'},{id:'three'}]}};
 const raw={slides:project.deck.slides,selection:[{sourceUnitId:'definition',destination:'slides',reason:'Core concept'},{sourceUnitId:'detail',destination:'notes',reason:'Secondary example'}]};
 const ledger=compileContentSelection(project,raw);assert.equal(project.source.semantic.inventory,original);const source=selectionSource(project,ledger);assert.equal(source.text,project.source.text);assert.equal(source.semantic.inventory.items[1].presentation,'notes_by_contract');assert.equal(exactPageConflict(project,raw).length,0);assert.equal(exactPageConflict(project,{slides:raw.slides.slice(1)}).length,1);
 assert.throws(()=>compileContentSelection({...project,generationPolicy:{content:'full_source',details:'notes'}},raw));assert.throws(()=>compileContentSelection(project,{...raw,selection:raw.selection.slice(0,1)}));
 assert.throws(()=>compileContentSelection({...project,source:{...project.source,semantic:{inventory:{...original,items:original.items.map((i:{id:string})=>i.id==='detail'?{...i,text:'Only if the risk is controlled.'}:i)}}}},raw));
 const selected={...project,source,originalSourceInventory:original,contentSelection:ledger};assert.ok(selectionNotesBySlide(selected)[0].text.includes('A secondary example.'));assert.throws(()=>selectionNotesBySlide({...selected,source:{...source,text:'Changed'}}));
});
it('live projection excludes full source, template base64 and unvalidated nodes while preserving real task counters',async()=>{
 const {taskSummary,liveProjectView}=await m('ppt/project-view');
 const p={id:'a'.repeat(32),uid:'owner',status:'generating',pages:2,source:{text:'Private full source'},templateFidelity:{mode:'preserve',width:100,height:60,slides:[{nodes:[{content:{dataUrl:'data:image/png;base64,VERY_LARGE'}}]}]},outline:[{id:'a',title:'One'},{id:'b',title:'Two'}],nodes:{a:{status:'done',slide:{id:'a',nodes:[{id:'ok',type:'text',content:{text:'Validated'}}]}},b:{status:'running',slide:{id:'b',nodes:[{id:'raw',type:'text',content:{text:'RAW TOKEN'}}]}}},runtime:{slides:{a:{preview:{id:'a',slideId:'a',size:{width:100,height:60},elements:[{id:'img',nodeId:'img',kind:'image',content:{dataUrl:'data:image/png;base64,AAAA'}}]}}}}};
 const summary=taskSummary(p);assert.equal(summary.progress.contentReady,1);assert.ok(!JSON.stringify(summary).includes('Private'));assert.ok(!JSON.stringify(summary).includes('VERY_LARGE'));
 const view=liveProjectView(p);assert.equal(view.renderTree.slides[1].elements.length,0);assert.ok(view.renderTree.slides[0].elements[0].content.dataUrl.startsWith('/api/ppt/'));assert.ok(!JSON.stringify(view).includes('RAW TOKEN'));assert.ok(!JSON.stringify(view).includes('Private'));
});
it('long-deck review partitions every obligation and rechecks the complete deck globally',async()=>{
 const {reviewBatches,composeReviews}=await m('ppt-review-batches'),{obligationRegistry}=await m('ppt-obligations'),{normalizeModelReview}=await m('ppt-quality'),{inputFramework}=await m('ppt-input-scope');
 const slides=Array.from({length:24},(_,i)=>({id:'s'+i,title:'Topic',nodes:[]}));const p={prompt:'Only if conditions hold.',deck:{slides},source:{text:'Only if conditions hold.',segments:[],semantic:{inventory:{items:[]}}}};
 const registry=obligationRegistry(p),batches=reviewBatches(p);assert.equal(batches.length,4);assert.equal(batches.at(-1).project.deck.slides.length,24);assert.equal(batches.flatMap((b:{project:{reviewScope:{obligationIds:string[]};deck:{slides:{id:string}[]}}})=>b.project.reviewScope.obligationIds).length,registry.entries.length);
 const results=batches.map((b:{project:{reviewScope:{obligationIds:string[]};deck:{slides:{id:string}[]}}})=>({evaluation:'not_evaluated',missing:[],repeated:[],conflicts:[],unsupported:[],scopeAudit:{frameworkHash:inputFramework(b.project).frameworkHash,checkedSlideIds:b.project.deck.slides.map((s:{id:string})=>s.id),status:'complete'},obligationAudit:{registryHash:obligationRegistry(b.project).registryHash,status:'complete',checks:obligationRegistry(b.project).entries.map((e:{id:string})=>({obligationId:e.id,status:'missing',evidence:[]}))}}));
 const combined=composeReviews(p,batches,results,normalizeModelReview);assert.equal(combined.obligationAudit.checks.length,registry.entries.length);assert.equal(combined.evaluation,'not_evaluated');assert.throws(()=>composeReviews(p,batches,results.slice(1),normalizeModelReview));
});
it('only explicit workflow framing turns a prose arrow chain into ordered stages',async()=>{const {orderedSourceSteps}=await m('ppt-source-boundaries');assert.deepEqual(orderedSourceSteps('The workflow is: collect -> screen -> validate.'),['collect','screen','validate']);assert.equal(orderedSourceSteps('The model (A→B→C), and its limitation.').length,1);});

it('summary tables keep explicit row/cell derivation, complete notes and reject omitted risk rows',async()=>{
 const {compileContentSelection,selectionSource,selectionNotes}=await m('ppt-content-selection');
 const original={id:'t',type:'TableBlock',rows:[['Metric','Value'],['A','10%'],['B','20%'],['C','30%']],text:'Metrics',must_preserve_structure:true};
 const p={pages:3,generationPolicy:{content:'overview',details:'notes',language:{mode:'output',locale:'en'}},source:{text:'immutable',semantic:{inventory:{items:[original],relationships:[]}}}};
 const raw={slides:[{sourceUnitIds:['t']}],selection:[{sourceUnitId:'t',destination:'summary',reason:'Select A and C',rowIndices:[1,3]}]};
 const ledger=compileContentSelection(p,raw),derived=selectionSource(p,ledger).semantic.inventory.items[0];
 assert.equal(derived.type,'SummaryTableBlock');assert.equal(derived.rows[1][1],'10%');assert.equal(derived.derivedSummary.sourceCellMap[2][1].row,3);assert.equal(derived.rows[0][0],'Metric','the visible table keeps its real header without notes placeholders');assert.equal(derived.derivedSummary.selectedRows,true);assert.equal(original.rows[0][0],'Metric');
 const selected={...p,contentSelection:ledger,originalSourceInventory:p.source.semantic.inventory};assert.match(selectionNotes(selected)[0].text,/B \| 20%/);
 const unsafe=structuredClone(selected);unsafe.originalSourceInventory.items[0].rows[2][0]='Risk limitation';assert.throws(()=>compileContentSelection(unsafe,raw),/condition\/risk/);
});

it('pure prompt compiles with no fake source IDs; scoped request schema restricts identifiers',async()=>{
 const {compileSkeleton,inspectSkeletonOwnership,skeletonPrompt,outlineResponseSchema}=await m('ppt-outline-protocol');
 const p={prompt:'Explain the factor model',source:null,generationPolicy:{content:'full_source'}};
 const raw={version:2,slides:['Model','Exposure','Limits'].map(title=>({title,focus:title,sourceUnitIds:[]}))};
 assert.equal(compileSkeleton(p,raw).slides.length,3);assert.deepEqual(inspectSkeletonOwnership(p,raw),[]);
 const schema=outlineResponseSchema(skeletonPrompt(p,''));assert.equal(schema.properties.slides.items.properties.sourceUnitIds.maxItems,0);
 raw.slides[1].sourceUnitIds=['invented'] as never[];assert.throws(()=>compileSkeleton(p,raw));
});

it('sentence selection retains exact definition and conditions; related complete math stays on main slides',async()=>{
 const {compileContentSelection,selectionSource,selectionNotes}=await m('ppt-content-selection');
 const items=[{id:'d',type:'DefinitionBlock',text:'Exposure measures sensitivity. An illustrative example follows. Risk must be controlled.',source_ref:[]},{id:'e',type:'EquationBlock',text:'$r=bf$',source_ref:[]}];
 const inventory={items,relationships:[{id:'r',unitIds:['d','e']}]};
 const p={pages:3,generationPolicy:{content:'overview',details:'notes'},source:{text:'Immutable original',semantic:{inventory}},originalSourceInventory:inventory};
 const raw={slides:[{sourceUnitIds:['d','e']}],selection:[{sourceUnitId:'d',destination:'summary',sentenceIndices:[0,2],reason:'Definition and risk retained'},{sourceUnitId:'e',destination:'slides',reason:'Formula'}]};
 const ledger=compileContentSelection(p,raw),selected=selectionSource(p,ledger);assert.equal(selected.semantic.inventory.relationships.length,1);assert.match(selected.semantic.inventory.items[0].text,/Risk must/);assert.ok(!selected.semantic.inventory.items[0].text.includes('illustrative'));assert.match(selectionNotes({...p,contentSelection:ledger})[0].text,/illustrative/);
 assert.throws(()=>compileContentSelection(p,{...raw,selection:[{...raw.selection[0],sentenceIndices:[0]},raw.selection[1]]}),/condition\/risk/);
 });

it('review checkpoint is hash/model scoped and never caches an incomplete response',async()=>{
 const {reviewWithContractRepair}=await m('ppt-quality'),{obligationRegistry}=await m('ppt-obligations'),{inputFramework}=await m('ppt-input-scope');
 const p={model:'model-a',prompt:'Explain the model.',source:null,outline:[{id:'s'}],deck:{slides:[{id:'s',title:'Model',nodes:[]}]}};
 const records=new Map<string,unknown>(),checkpoint={load:(k:string)=>records.get(k),save:(k:string,v:unknown)=>{records.set(k,v);}};let calls=0;
 const call=async()=>{calls++;return {evaluation:'not_evaluated',missing:[],repeated:[],conflicts:[],unsupported:[],scopeAudit:{frameworkHash:inputFramework(p).frameworkHash,checkedSlideIds:['s'],status:'complete'},obligationAudit:{registryHash:obligationRegistry(p).registryHash,status:'complete',checks:obligationRegistry(p).entries.map((e:{id:string})=>({obligationId:e.id,status:'not_evaluated',evidence:[]}))}};};
 await reviewWithContractRepair(p,call,{checkpoint});await reviewWithContractRepair(p,call,{checkpoint});assert.equal(calls,1);p.model='model-b';await reviewWithContractRepair(p,call,{checkpoint});assert.equal(calls,2);p.deck.slides[0].title='Changed';await reviewWithContractRepair(p,call,{checkpoint});assert.equal(calls,3);
 const before=records.size;await assert.rejects(()=>reviewWithContractRepair({...p,prompt:'New scope'},async()=>({missing:[]}),{checkpoint,maxRepairs:0}));assert.equal(records.size,before);
});
it('production point-card rendering retains inline math and its unsupported diagnostics',async()=>{
 const {applyRenderContract}=await m('ppt/render-contract');
 const e=applyRenderContract({kind:'list',content:{pointLayout:{boxes:[{x:0,y:0,w:1,h:1}]},items:[{text:'Model\n**Condition** $x_i^2$'}]},style:{fontSizePt:18}});
 assert.ok(e.content.items[0].bodyRich.runs.some((r:{kind:string})=>r.kind==='math'));assert.ok(!e.content.items[0].text.includes('$'));
});

it('writer repairs an invalid visual block identifier, retains facts and keeps transport failures bounded',async()=>{
 const {_internals}=await m('ppt-api'),{normalizeBlocks}=await m('ppt-blocks');let calls=0;
 const result=await _internals.writeWithContractRepair({prompt:'Return a shape with existing fact',nodeKey:'content:test',call:async()=>++calls===1?{blocks:[{id:'步骤 1',type:'shape',shape:'rect',fill:'#ffffff',text:'Existing fact'}]}:{edits:[{path:['blocks',0,'id'],start:0,end:4,before:'步骤 1',after:'step_1'}]},normalize:(raw:{blocks:unknown[]})=>normalizeBlocks(raw.blocks)});assert.equal(calls,2);assert.equal(result.content[0].text,'Existing fact');assert.equal(result.content[0].id,'step_1');
});
it('imported native equations require typed source and do not silently flatten to text',async()=>{
 const {_internals}=await m('ppt/command-service');
 const node={id:'n',type:'text',nativeRef:{shapeId:1},content:{text:'x1',nativeMath:true,nativeOriginalText:'x1',nativeMathStructures:['original']},nativeTextFrame:{paragraphs:[{text:'x1'}]}};
 const base={deck:{slides:[{id:'s',nodes:[node]}]}};
 assert.throws(()=>_internals.applyToDeck(structuredClone(base.deck),{type:'node.setContent',payload:{slideId:'s',nodeId:'n',content:{text:'ordinary text'}}}),/typed_source/);
 const edited=structuredClone(base);const applied=_internals.applyToDeck(edited.deck,{type:'node.setContent',payload:{slideId:'s',nodeId:'n',content:{text:'$x_1^2$'}}});assert.equal(applied.deck.slides[0].nodes[0].content.nativeMath,false);assert.ok(applied.deck.slides[0].nodes[0].content.richText.runs.some((r:{kind:string})=>r.kind==='math'));
});

it('source arithmetic flags an explicit inconsistent product without rewriting facts or unrelated toy-universe counts',async()=>{
 const {inspectSourceArithmetic}=await m('ppt-source-arithmetic');const text='Independent $2\\times3\\times3$ sorts on size, investment and profitability (27 portfolios).';const p={source:{text,segments:[{id:'1',text}]}};assert.equal(inspectSourceArithmetic(p)[0].details.calculated,18);assert.equal(p.source.text,text);
 assert.equal(inspectSourceArithmetic({source:{segments:[{id:'1',text:'A 2×3 sort on a toy universe (12 stocks). A 2×3×3 sort (18 portfolios).'}]}}).length,0);
});

it('built-in captions have physical space for their unchanged fonts and native captions keep original margins',async()=>{
 const {regionsFor}=await m('ppt-layout'),{applyRenderContract,measureText}=await m('ppt/render-contract');
 for(const layoutId of ['cover','summary','editorial']){
  const region=regionsFor({layoutId,copy:{subtitle:'Caption'}}).find((r:{id:string;w:number;h:number})=>r.id==='subtitle');const e=applyRenderContract({kind:'text',semanticRole:'subtitle',bounds:{width:region.w*914400,height:region.h*914400},content:{text:'面向研究员'},style:{fontSizePt:14,lineHeight:1.12}});assert.equal(measureText(e,e.textLayout).overflow,false);
 }
 const native=applyRenderContract({kind:'text',nativeRef:{shapeId:1},semanticRole:'eyebrow',bounds:{width:9000000,height:300000},content:{text:'Label'},style:{fontSizePt:11},nativeTextFrame:{margins:[10000,20000,30000,40000]}});assert.equal(native.textLayout.margins[1],20000/12700);
});
it('decorative image retirement is region/hash scoped and protected media remain intact',async()=>{
 const {replaceTemplateSourceRegion}=await m('ppt-source-artifacts'),{validAdaptation}=await m('ppt-template-dispositions');
 const canvas={x:1000000,y:1000000,width:8000000,height:4000000},asset={id:'decor',type:'image',nativeRef:{shapeId:7},geometry:{x:2000000,y:2000000,width:1000000,height:1000000},content:{mediaRole:'template_decoration'}};
 const p={source:{text:'New source'},templateFidelity:{width:12000000,height:7000000,slides:[{nodes:[asset],slots:[]}]}};const slide:{nodes:unknown[];templateOmissions?:Record<string,unknown>[]}={nodes:[]};replaceTemplateSourceRegion(p,slide,0,canvas);assert.ok(validAdaptation(p,asset,slide.templateOmissions![0],'template_decoration'));assert.equal(validAdaptation({...p,source:{text:'Changed'}},asset,slide.templateOmissions![0],'template_decoration'),false);
 for(const role of ['evidence','semanticDiagram','source','brand']){const protectedP=structuredClone(p);protectedP.templateFidelity.slides[0].nodes[0].content.mediaRole=role;const s:{nodes:unknown[];templateOmissions?:Record<string,unknown>[]}={nodes:[]};replaceTemplateSourceRegion(protectedP,s,0,canvas);assert.ok(!s.templateOmissions?.length);}
});

it('editorial checks parse actual generated card math and still reject unknown macros',async()=>{
 const {inspectEditorial}=await m('ppt-editorial-review');
 const p={deck:{slides:[{id:'s',title:'Math',nodes:[{id:'n',type:'list',semanticRole:'body',content:{items:[{text:'Model\n$x_i^2$'}]}}]}]}};
 assert.equal(inspectEditorial(p).filter((i:{code:string})=>i.code==='visible_source_markup').length,0);
 p.deck.slides[0].nodes[0].content.items[0].text='$\\unknownmacro{x}$';
 assert.ok(inspectEditorial(p).some((i:{code:string})=>i.code==='math_parse_unsupported'));
});

it('mapped cover source copy reserves the actual centered header and editorial eyebrow fits unchanged font',async()=>{
 const {contentCanvas,fitComponents}=await m('ppt-density-capacity'),{regionsFor}=await m('ppt-layout'),{applyRenderContract,measureText}=await m('ppt/render-contract');
 const p={pages:8,outline:[{id:'cover',role:'cover'},...Array.from({length:7},(_,i)=>({id:'s'+i}))]};
 const canvas=contentCanvas(p,0).geometry;assert.equal(canvas.y,Math.round(4.18*914400));assert.equal(canvas.height,Math.round(.85*914400));
 const fit=fitComponents([{type:'text',content:{text:'本培训面向研究员，说明数据质量检查的规则与五步流程。'}}],p,0);assert.equal(fit.capacity_ok,true);assert.ok(fit.boxes[0].y>=canvas.y);
 const region=regionsFor({layoutId:'editorial'}).find((r:{id:string;w:number;h:number})=>r.id==='eyebrow');const e=applyRenderContract({kind:'text',semanticRole:'eyebrow',bounds:{width:region.w*914400,height:region.h*914400},content:{text:'执行流程 · 步骤一'},style:{fontSizePt:11,lineHeight:1.12}});assert.equal(measureText(e).overflow,false);
});
