/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures intentionally exercise dynamic or malformed model/API payloads. */
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const m=(name:string)=>import(process.cwd()+'/apps/cowork-server/lib/'+name+'.mjs');

it('automatic pruning synchronizes the navigation total with the retained pages',async()=>{
 const {pruneEmptySelectedPages}=await m('ppt-outline-protocol');
 const p:any={generationPolicy:{content:'overview',details:'notes',knowledge:'source_only'},source:{semantic:{inventory:{items:[{id:'a'}]}}}};
 const raw={version:2,selection:[{sourceUnitId:'a',destination:'slides'}],slides:[{role:'cover',title:'Flow',sourceUnitIds:[]},{role:'navigation',title:'Navigation',focus:'本演示文稿共5页，覆盖三个分支。',sourceUnitIds:[]},{role:'mechanism',title:'Branch',sourceUnitIds:['a']},{role:'mechanism',title:'Unowned',sourceUnitIds:[]},{role:'closing',title:'Summary',sourceUnitIds:[]}]};
 const fixed=pruneEmptySelectedPages(p,raw);assert.equal(fixed.slides.length,4);assert.equal(fixed.slides[1].focus,'本演示文稿共4页，覆盖三个分支。');assert.equal(raw.slides[1].focus,'本演示文稿共5页，覆盖三个分支。');
});

it('sequence diagram core branches may be summarized but cannot disappear into notes',async()=>{
 const {withSemanticIndex}=await m('ppt-semantic'),{selectionConstraints,compileContentSelection}=await m('ppt-content-selection');
 const source=withSemanticIndex({segments:[{id:'1',location:'PDF 第 1 页',diagram:{kind:'sequence',topologyEvidence:'source image'},text:'# Flow\n\n## [5A) Tool]\n触发: 参数明确。\n直接调用 tools/call。\n\n## [5B) Resource]\n触发: 参数有歧义。\n先读取 resources/read，再调用 tools/call。'}]});
 const p:any={source,generationPolicy:{content:'overview',details:'notes',knowledge:'source_only',language:{mode:'source',body:'both'}}};
 assert.equal(source.semantic.inventory.items.length,2);
 for(const rule of selectionConstraints(p)){assert.ok(!rule.allowedDestinations.includes('notes'));assert.ok(rule.allowedDestinations.includes('summary'));}
 const id=source.semantic.inventory.items[0].id;
 const selection=source.semantic.inventory.items.map((i:any)=>({sourceUnitId:i.id,destination:'notes',reason:'put branch in notes'}));
 assert.throws(()=>compileContentSelection(p,{version:2,slides:[],selection}),/presentation contract/);
 const ordinary=withSemanticIndex({segments:[{id:'1',text:'Ordinary optional background explanation.'}]});
 assert.ok(selectionConstraints({...p,source:ordinary})[0].allowedDestinations.includes('notes'));
});

it('PDF sequence detection requires lifelines and branches, and preserves ordinary API tables',async()=>{
 const {DOCUMENT_EXTRACTION_SCRIPT}=await m('ppt-document-extraction-python');
 const probe=String.raw`
class Page:
    height=792
    def __init__(self,text,verticals):
        self.text=text
        self.lines=[{'x0':x,'x1':x,'top':100,'bottom':700} for x in range(verticals)]
    def extract_text(self):return self.text
protocols='tools/list tools/call resources/list resources/read prompts/get initializeResult'
assert pdf_sequence_diagram(Page(protocols+' alt [5A) Tool] [5B) Resource]',5))
assert not pdf_sequence_diagram(Page(protocols,5)), 'API table without alt branches'
assert not pdf_sequence_diagram(Page(protocols+' alt alt',0)), 'prose without lifelines'
assert not pdf_sequence_diagram(Page('alt alt ordinary table',5)), 'table geometry without sequence vocabulary'
print('sequence/table classification passed')
`;
 assert.match(execFileSync('python3',['-c',DOCUMENT_EXTRACTION_SCRIPT+probe],{encoding:'utf8'}),/classification passed/);
});

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
