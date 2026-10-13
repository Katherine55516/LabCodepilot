import {it} from 'node:test';
import assert from 'node:assert/strict';
const m=(name:string)=>import(process.cwd()+'/apps/cowork-server/lib/'+name+'.mjs');

it('explicit full source binds both source languages and code; legacy and output translation remain reversible',async()=>{
 const {applyPresentationPolicy,codePresentation}=await m('ppt-presentation-policy');
 const source:any={semantic:{inventory:{items:[{id:'en',type:'MechanismBlock',text:'Only independent signals improve diversification.',languagePairId:'pair',must_preserve_structure:false},{id:'zh',type:'MechanismBlock',text:'只有独立信号才能改善分散效果。',languagePairId:'pair',must_preserve_structure:false},{id:'code',type:'CodeBlock',text:'fit(training_only)',must_preserve_structure:true}]}}};
 const project:any={generationPolicy:{content:'full_source',language:{mode:'source'}}};
 const bound=applyPresentationPolicy(source,project);assert.ok(bound.semantic.inventory.items.every((i:any)=>i.must_preserve_structure));assert.equal(bound.semantic.inventory.items[0].text,source.semantic.inventory.items[0].text);assert.equal(source.semantic.inventory.items[0].must_preserve_structure,false);
 assert.equal(codePresentation(project).basis,'full_source_contract');assert.equal(codePresentation({generationPolicy:{content:'full_source',code:{presentation:'omit'}}}).basis,'user_choice');
 assert.equal(applyPresentationPolicy(source,{}).semantic.inventory.items[0].must_preserve_structure,false);
 assert.equal(applyPresentationPolicy(bound,{generationPolicy:{content:'course',language:{mode:'output',locale:'zh'}}}).semantic.inventory.items[0].must_preserve_structure,false);
});

it('only pixel-verified monochrome native card backgrounds can be retired; diagrams and brand cannot',async()=>{
 const {templateMediaRole}=await m('ppt-template-fidelity'),{replaceTemplateSourceRegion}=await m('ppt-source-artifacts'),{validAdaptation}=await m('ppt-template-dispositions');
 const size={width:12000000,height:7000000},g={x:1000000,y:2500000,width:3000000,height:1500000};
 const card:any={id:'card',type:'image',nativeRef:{shapeId:3},geometry:g,content:{monochromePanel:true}};
 const label=(id:number,y:number)=>({id:'n'+id,type:'text',nativeRef:{shapeId:id},geometry:{x:1200000,y,width:2500000,height:300000},content:{text:'Original label'}});
 const spec={nodes:[card,label(4,2700000),label(5,3200000)],slots:[{shapeId:4,role:'content'},{shapeId:5,role:'content'}]};
 const p:any={source:{text:'New source'},templateFidelity:{...size,slides:[spec]}};const slide:any={nodes:[]};
 assert.equal(templateMediaRole(card,spec,size),'template_decoration');replaceTemplateSourceRegion(p,slide,0,{x:1000000,y:2500000,width:6000000,height:3000000});assert.ok(validAdaptation(p,card,slide.templateOmissions.find((o:any)=>o.shapeId===3),'template_decoration'));
 assert.notEqual(templateMediaRole({...card,content:{monochromePanel:false}},spec,size),'template_decoration');assert.notEqual(templateMediaRole(card,{nodes:[card]},size),'template_decoration');
 for(const role of ['brand','source','evidence','semanticDiagram']){assert.equal(templateMediaRole({...card,content:{monochromePanel:true,mediaRole:role}},spec,size),role);}
});

it('writer provenance filler is blocked without rejecting authentic source copy',async()=>{
 const {inspectEditorial}=await m('ppt-editorial-review');const slide:any={id:'s',title:'Actual topic',nodes:[{id:'n',type:'text',semanticRole:'body',content:{text:'本页来源第3节，解释风险控制。'}}]};
 assert.ok(inspectEditorial({},[slide]).some((i:any)=>i.code==='writer_process_metadata'));slide.nodes[0].sourceArtifact={sourceUnitId:'original'};assert.equal(inspectEditorial({},[slide]).filter((i:any)=>i.code==='writer_process_metadata').length,0);
});

it('a full template catalog survives repeated automatic rescheduling even when an intermediate map omits a source page',async()=>{
 const {fidelityFromImported,rescheduleTemplateFidelity}=await m('ppt-template-fidelity');
 const imported:any={externalPptx:{width:12000000,height:7000000,originalPath:'/workspace/template.pptx'},deck:{slides:Array.from({length:4},(_,i)=>({id:'source'+i,nativeBackground:'#ffffff',nodes:[{id:'title'+i,type:'text',nativeRef:{shapeId:2},geometry:{x:500000,y:500000,width:10000000,height:600000},content:{text:'Original title '+i},style:{fontSizePt:28}},{id:'body'+i,type:'text',nativeRef:{shapeId:3},geometry:{x:500000,y:1800000,width:10000000,height:3500000},content:{text:'Complete original source body '+i},style:{fontSizePt:18}}]}))}};
 const p:any={pages:4,outline:[]};p.templateFidelity=fidelityFromImported(p,imported,'catalog-proof');assert.equal(p.templateFidelity.sourceCatalog.length,4);
 // A role/capacity schedule can repeat another page and never use page 2.
 p.templateFidelity.slides=p.templateFidelity.slides.filter((s:any)=>s.sourceIndex!==1);p.templateFidelity.slideMap=p.templateFidelity.slideMap.filter((i:number)=>i!==1);
 rescheduleTemplateFidelity(p);assert.equal(p.templateFidelity.sourceCatalog.length,4);assert.ok(p.templateFidelity.slides.some((s:any)=>s.sourceIndex===1));
 const original=p.templateFidelity.sourceCatalog.map((s:any)=>s.nodes.map((n:any)=>n.geometry));rescheduleTemplateFidelity(p);assert.deepEqual(p.templateFidelity.sourceCatalog.map((s:any)=>s.nodes.map((n:any)=>n.geometry)),original);
});
