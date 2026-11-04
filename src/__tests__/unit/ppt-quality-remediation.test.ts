import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pptModelReviewState} from '../../lib/ppt-quality-state';
const base=process.cwd()+'/apps/cowork-server/lib/';
test('review result distinguishes never run, stale, active, failed and completed',()=>{
 assert.equal(pptModelReviewState({reviewState:'stale',modelReview:{evaluation:'not_evaluated'}}),'notRun');
 assert.equal(pptModelReviewState({reviewState:'stale',modelReview:{evaluation:'evaluated'}}),'stale');
 assert.equal(pptModelReviewState({reviewState:'running'}),'running');
 assert.equal(pptModelReviewState({reviewState:'failed'}),'failed');
 assert.equal(pptModelReviewState({modelReview:{evaluation:'evaluated'}}),'completed');
});
test('structural roles exempt only actual structural cards, not ungrounded facts',async()=>{
 const {effectivePageRole,isContentPage,visibleSemanticUnits}=await import(base+'ppt-page-semantics.mjs');
 const p={outline:[{id:'cover'},{id:'divider',cardFrame:'divider',role:'mechanism'},{id:'content',role:'mechanism'},{id:'last',cardFrame:'takeaway'}]};
 assert.equal(effectivePageRole(p,p.outline[1],1),'section');assert.equal(isContentPage(p,p.outline[2],2),true);assert.equal(effectivePageRole(p,p.outline[3],3),'closing');
 assert.equal(visibleSemanticUnits({nodes:[1,2,3,4].map(i=>({id:String(i),type:'text',semanticRole:'source-explanation',content:{text:'Independent point '+i}}))}),4);
 assert.equal(visibleSemanticUnits({nodes:[1,2,3,4,5].map(i=>({id:String(i),type:'text',sourceArtifact:{type:'EquationBlock'},content:{mathMl:'<math/>',text:'Equation '+i}}))}),1);
});
test('table ranges distinguish a real repeated fragment from different rows',async()=>{
 const {claimFragmentKey}=await import(base+'ppt-page-semantics.mjs');
 const page=(start:number,end:number)=>({nodes:[{id:'table',type:'table',sourceArtifact:{sourceUnitId:'t',rowStart:start,rowEnd:end},content:{rows:[['A'],['Value']]}}]});
 assert.notEqual(claimFragmentKey(page(1,3),'t'),claimFragmentKey(page(3,5),'t'));
 assert.equal(claimFragmentKey(page(1,3),'t'),claimFragmentKey(page(1,3),'t'));
});
test('formula definitions travel with the linked equation and preserve symbol sentences',async()=>{
 const {objectPointOwner,restoreFormulaDefinitions}=await import(base+'ppt-object-explanation.mjs');
 const items=[{id:'a',type:'EquationBlock'},{id:'d',type:'MechanismBlock',text:'where σ is the sigmoid and ⊙ is elementwise product. Optional example.'},{id:'b',type:'EquationBlock'}];
 const project={source:{semantic:{inventory:{items,relationships:[{type:'definition',unitIds:['a','d']}]}}}};
 assert.equal(objectPointOwner(project,['a','b'])({sourceUnitIds:['d']}),'a');
 const raw:{slides:{cardObjects:string[];keyPoints:{text:string;sourceUnitIds?:string[]}[]}[]}={slides:[{cardObjects:['a','b'],keyPoints:[]}]};
 assert.equal(restoreFormulaDefinitions(project,raw).length,1);assert.match(raw.slides[0].keyPoints[0].text,/sigmoid/);assert.doesNotMatch(raw.slides[0].keyPoints[0].text,/Optional/);
 assert.equal(restoreFormulaDefinitions(project,raw).length,0,'idempotent');
});
test('native geometry and measured Latin fallback remain distinct from CJK font',async()=>{
 const {nativeShapeContract}=await import(base+'ppt/native-shape.mjs');
 const {cssFontFamily,previewFontFamily}=await import(base+'ppt/font-family.mjs');
 const shape=(name:string)=>nativeShapeContract({nativeRef:{autoShapeType:name},content:{shape:'rect'},style:{fill:'#9a6aba',lineColor:'#57068c'}});
 assert.match(shape('OVAL (9)').svg,/<ellipse/);assert.match(shape('SMILEY_FACE (17)').svg,/<path/);
 assert.equal(nativeShapeContract({content:{presetGeometry:'unsupportedCustom'}}).supported,false);
 const substitute=previewFontFamily({templateFidelity:{fontSubstitutions:[{family:'Montserrat',usedFamily:'Verdana'}]}},'Montserrat');
 const css=cssFontFamily('Montserrat','Songti SC',substitute);assert.ok(css.indexOf('Verdana')<css.indexOf('Songti SC'));
});
test('Chinese coverage matches shifted word boundaries, and real missing quantities still fail',async()=>{
 const {recall}=await import(base+'ppt-content-inventory.mjs');const {evidenceVisible}=await import(base+'ppt-evidence.mjs');
 assert.ok(recall('按日期的横截面批处理','训练时采用按日期横截面批处理')>.45);
 assert.equal(evidenceVisible({measurements:[{raw:'5–20',value:'5–20',unit:''}],contextTerms:[]},'Average predictions from 5–20 seeds.'),true);
 assert.equal(evidenceVisible({measurements:[{raw:'5–20',value:'5–20',unit:''}],contextTerms:[]},'Average predictions from several seeds.'),false);
});
test('integrity accepts complete disjoint table fragments but rejects an overlapping primary row',async()=>{
 const {normalizePaste}=await import(base+'ppt-source.mjs');const {inspectObjectIntegrity}=await import(base+'ppt-object-integrity.mjs');
 const source=normalizePaste('# Comparison\n\n| Item | Meaning |\n| --- | --- |\n| Alpha | First |\n| Beta | Second |\n| Gamma | Third |');
 const item=source.semantic.inventory.items.find((i:{type:string})=>i.type==='TableBlock');assert.ok(item);
 const page=(id:string,start:number,end:number)=>({id,nodes:[{id:'node-'+id,type:'table',sourceArtifact:{sourceUnitId:item.id,type:'TableBlock',rowStart:start,rowEnd:end},content:{rows:[item.rows[0],...item.rows.slice(start,end)]}}]});
 assert.equal(inspectObjectIntegrity({source},[page('a',1,3),page('b',3,4)]).issues.some((i:{code:string})=>i.code==='required_source_table_row_duplicate'),false);
 assert.equal(inspectObjectIntegrity({source},[page('a',1,3),page('b',2,4)]).issues.some((i:{code:string})=>i.code==='required_source_table_row_duplicate'),true);
});
test('paired flat taxonomies require equal cardinality before sharing semantic coverage',async()=>{
 const {markLanguagePairs}=await import(base+'ppt-presentation-policy.mjs');
 const a={id:'a',type:'TaxonomyBlock',text:'- Price and volume\n- Raw text',sectionPath:['Inputs']},b={id:'b',type:'TaxonomyBlock',text:'- 价格和成交量\n- 原始文本',sectionPath:['Inputs']};
 const paired=markLanguagePairs([structuredClone(a),structuredClone(b)]);assert.ok(paired[0].languagePairId);assert.equal(paired[0].languagePairId,paired[1].languagePairId);
 const different=markLanguagePairs([structuredClone(a),{...b,text:b.text+'\n- 额外内容'}]);assert.equal(different[0].languagePairId,undefined);
});
test('design-only retired report groups and footer labels do not erase the content canvas',async()=>{
 const {contentCanvas,INCH}=await import(base+'ppt-density-capacity.mjs');
 const p={templateContentMode:'design_only',templateFidelity:{width:10*INCH,height:5.625*INCH,slides:[{}, {slots:[{role:'title',shapeId:1},{role:'content',purpose:'label',shapeId:2}],nodes:[{type:'text',geometry:{x:0,y:0,width:9*INCH,height:.5*INCH},style:{fontSizePt:28},nativeRef:{shapeId:1}},{type:'text',geometry:{x:INCH,y:5.1*INCH,width:2.5*INCH,height:.4*INCH},nativeRef:{shapeId:2}},{type:'foreign',geometry:{x:.6*INCH,y:.8*INCH,width:3*INCH,height:4.2*INCH},content:{templateSample:true,mediaRole:'old_template_content'}}]}]}};
 const free=contentCanvas(p,1).geometry;assert.ok(free.height>3*INCH);assert.ok(free.width>8*INCH);
 p.templateFidelity.slides[1].nodes![2].content={mustPreserve:true,mediaRole:'brand'} as never;
 assert.ok(contentCanvas(p,1).geometry.width<free.width,'explicit fixed group still reserves occupied space');
});
test('spaced display counters stay idempotent and only verified navigation bypasses numeric checks',async()=>{
 const {keepCardContinuation}=await import(base+'ppt-topic-language.mjs');
 const {unmarked,numberedTitle}=await import(base+'ppt-continuation-marker.mjs');
 const {inspectSourceNumbers}=await import(base+'ppt-source-numbers.mjs');
 assert.equal(keepCardContinuation(true,'Research · 1/2','Research · 1 / 2'),'Research · 1/2');
 assert.equal(unmarked('研究 · 1 / 2'),'研究');assert.equal(numberedTitle('研究 · 1 / 2',1,2),'研究 · 1/2');
 const slides=['Cover','研究 · 1/2','研究 · 2/2'].map((title,k)=>({id:'p'+k,title,nodes:[{id:'n'+k,type:'text',semanticRole:'title',content:{text:title}}]}));
 assert.deepEqual(inspectSourceNumbers({source:{text:'研究回路。'},outline:slides},slides),[]);
 assert.ok(inspectSourceNumbers({source:{text:'研究回路。'},outline:[]},slides).length>0,'unverified counters remain factual checks');
});
test('derived labels choose a readable template colour on their own backdrop',async()=>{
 const {templateTextColor,contrastRatio}=await import(base+'ppt-template-colors.mjs');
 const white={type:'text',style:{color:'#ffffff'},nativeRef:{shapeId:1}};
 const title={type:'text',style:{color:'#57068c'},nativeRef:{shapeId:2}};
 const p={templateFidelity:{slides:[{background:'#ffffff',slots:[{shapeId:1,role:'section'},{shapeId:2,role:'title'}],nodes:[white,title]}]},templateSpec:{palette:{foreground:'#57068c'}}};
 assert.ok(contrastRatio(templateTextColor(p,0,'caption','#ffffff').color,'#ffffff')>=3);
 assert.ok(contrastRatio(templateTextColor(p,0,'caption','#57068c').color,'#57068c')>=3);
});
test('table scope captions verify their actual bound rows and total, not arbitrary navigation metadata',async()=>{
 const {inspectSourceNumbers}=await import(base+'ppt-source-numbers.mjs');
 const item={id:'table',type:'TableBlock',rows:[['Name'],['Alpha'],['Beta'],['Gamma']]};
 const caption={id:'scope',type:'text',semanticRole:'source-explanation',content:{text:'Rows 1–2 of 3',derivedFrom:'source-navigation',fragmentScope:{sourceUnitId:'table',rowStart:1,rowEnd:3,totalRows:3}}};
 const slide={id:'page',nodes:[caption,{id:'table-node',type:'table',sourceArtifact:{sourceUnitId:'table',rowStart:1,rowEnd:3},content:{rows:item.rows.slice(0,3)}}]};
 const p={source:{text:'Alpha Beta Gamma',semantic:{inventory:{items:[item]}}}};
 assert.deepEqual(inspectSourceNumbers(p,[slide]),[]);
 caption.content.text='Rows 1–2 of 9';caption.content.fragmentScope.totalRows=9;
 assert.ok(inspectSourceNumbers(p,[slide]).length>0,'invented total is not exempt');
});
test('live editor projection retains actual publication and review versions',async()=>{
 const {liveProjectView}=await import(base+'ppt/project-view.mjs');
 const p={id:'a'.repeat(32),uid:'test',status:'completed',revision:3,publishedRevision:2,renderUpgradePending:true,outline:[],nodes:{},quality:{status:'passed',reviewState:'stale',exportVerification:{renderContractVersion:23,revision:2}},deck:{slides:[]}};
 const view=liveProjectView(p);assert.equal(view.quality.exportVerification.renderContractVersion,23);assert.equal(view.quality.reviewState,'stale');assert.equal(view.renderUpgradePending,true);
});
test('completing an existing paraphrased definition does not append a duplicate continuation',async()=>{
 const {restoreFormulaDefinitions}=await import(base+'ppt-object-explanation.mjs');
 const p={source:{semantic:{inventory:{items:[{id:'eq',type:'EquationBlock'},{id:'en',text:'where g is a linear head on a final or pooled hidden state.'},{id:'zh',text:'其中 g 是作用于最终或池化隐藏状态的线性输出头。'}],relationships:[{type:'definition',unitIds:['eq','en','zh']}]}}}};
 const raw={slides:[{cardObjects:['eq'],keyPoints:[{text:'g reads the hidden state. | g 读取隐藏状态。',sourceUnitIds:['en','zh']}]}]};
 restoreFormulaDefinitions(p,raw);assert.equal(raw.slides[0].keyPoints.length,1);assert.match(raw.slides[0].keyPoints[0].text,/pooled/);assert.match(raw.slides[0].keyPoints[0].text,/池化/);
 assert.equal(restoreFormulaDefinitions(p,raw).length,0);
});
test('formula comparison normalizes display scripts and conditional bars without changing time arithmetic',async()=>{
 const {inspectContent}=await import(base+'ppt-content-qa.mjs');
 const p={source:{text:'The model is P(z_{t+1} | a_{t}, z_{t}, h_{t}).'},outline:[]};
 const deck=(text:string)=>({slides:[{id:'p',title:'Model',nodes:[{id:'n',type:'text',content:{text}}]}]});
 assert.equal(inspectContent(p,deck('P(zt+1∣at,zt,ht)')).issues.some((i:{code:string})=>i.code==='visible_formula_unverified'),false);
 assert.equal(inspectContent(p,deck('P(zt+2∣at,zt,ht)')).issues.some((i:{code:string})=>i.code==='visible_formula_unverified'),true);
});
test('native table diagrams retain row attribution while invented visible values still fail',async()=>{
 const {tableDiagramComponent}=await import(base+'ppt-diagram-cards.mjs');
 const {inspectSourceNumbers}=await import(base+'ppt-source-numbers.mjs');
 const item={id:'t',type:'TableBlock',text:'',rows:[['MODEL','PARAMETER COUNT'],['VAE','4,348,547'],['MDN-RNN','422,368'],['CONTROLLER','867']]};
 const component=tableDiagramComponent(item,'card-grid');const node={...component,id:'diagram',sourceArtifact:{sourceUnitId:'t',type:'TableBlock'}};
 const p={source:{text:'Model parameter counts',semantic:{inventory:{items:[item]}}},generationPolicy:{knowledge:'source_only'}};
 assert.deepEqual(inspectSourceNumbers(p,[{id:'p',nodes:[node]}]),[]);
 node.content.items[0].body+='\nInvented count 999999';
 assert.ok(inspectSourceNumbers(p,[{id:'p',nodes:[node]}]).some((i:{values:string[]})=>i.values.includes('999999')));
});
test('mixed-case model alternatives are prose only in a spaced aside',async()=>{
 const {inspectContent}=await import(base+'ppt-content-qa.mjs');const p={source:{text:'Encode text using FinBERT or LLM.'},outline:[]};
 const deck=(text:string)=>({slides:[{id:'p',title:'Text',nodes:[{id:'n',type:'text',content:{text}}]}]});
 assert.equal(inspectContent(p,deck('encoder (FinBERT/LLM)')).issues.some((i:{code:string})=>i.code==='visible_formula_unverified'),false);
 assert.equal(inspectContent(p,deck('encoder(FinBERT/LLM)')).issues.some((i:{code:string})=>i.code==='visible_formula_unverified'),true);
});
test('design reuse retires full-page report rasters in front of a title, preserving fixed selections',async()=>{
 const {templateDesignView}=await import(base+'ppt-template-design.mjs');
 const original={externalPptx:{width:1000,height:600},deck:{slides:[{nodes:[{id:'title',type:'text',semanticRole:'title',zIndex:0,geometry:{x:0,y:0,width:900,height:70},content:{text:'Old report'}},{id:'raster',type:'image',zIndex:2,geometry:{x:0,y:0,width:1000,height:600},content:{mediaRole:'template_decoration'}}]}]}};
 assert.equal(templateDesignView(original,new Set(),new Set(),{preserveClassifiedDesign:true}).deck.slides[0].nodes[1].content.mediaRole,'old_template_content');
 assert.equal(templateDesignView(original,new Set(),new Set(['raster']),{preserveClassifiedDesign:true}).deck.slides[0].nodes[1].content.mustPreserve,true);
});
test('source fallback retains complete statements and decimal ranges',async()=>{
 const {completeSourceSentence}=await import(base+'ppt-source-excerpt.mjs');
 assert.equal(completeSourceSentence('Sharpe in the 0.3–0.8 range is good. A second statement.'),'Sharpe in the 0.3–0.8 range is good.');
 assert.equal(completeSourceSentence('夏普比率落在 0.3–0.8 区间，因为生产依赖因子池。后文。'),'夏普比率落在 0.3–0.8 区间，因为生产依赖因子池。');
});
test('source arithmetic accepts Unicode minus and multiplication but rejects a changed covariance term',async()=>{
 const {inspectContent}=await import(base+'ppt-content-qa.mjs');const p={source:{text:'improvement = sqrt(N / (1 + (N-1)*rho))'},outline:[]};
 const deck=(text:string)=>({slides:[{id:'p',title:'Math',nodes:[{id:'n',type:'text',content:{text}}]}]});
 assert.equal(inspectContent(p,deck('sqrt(N/(1+(N−1)∗rho))')).issues.some((i:{code:string})=>i.code==='visible_formula_unverified'),false);
 assert.equal(inspectContent(p,deck('sqrt(N/(1+(N−2)∗rho))')).issues.some((i:{code:string})=>i.code==='visible_formula_unverified'),true);
});
test('a complete literal arrow flow retains structure, while reordered or missing independent-test boundaries do not',async()=>{
 const{inspectInventoryCoverage}=await import(base+'ppt-content-inventory.mjs');
 const item={id:'flow',type:'ProcessBlock',text:'Frozen candidate -> separate outer-test evaluator -> decision record',priority:'high',must_preserve_structure:true};const source={semantic:{inventory:{items:[item],relationships:[]}}};
 const check=(text:string)=>inspectInventoryCoverage(source,[{id:'p',nodes:[{id:'n',type:'text',content:{text}}]}],(s:{nodes:{content:{text:string}}[]})=>s.nodes[0].content.text).metrics.items[0].structureRetained;
 assert.equal(check('Frozen candidate → separate outer-test evaluator → decision record'),true);
 assert.equal(check('Frozen candidate → decision record → separate outer-test evaluator'),false);
 assert.equal(check('Frozen candidate → evaluator → decision record'),false);
});
test('shared definitions follow each split equation, including the prediction head sentence',async()=>{
 const{pointBelongsToObjects,formulaDefinitionExcerpt,objectPointOwner}=await import(base+'ppt-object-explanation.mjs');
 const p={source:{semantic:{inventory:{items:[{id:'lstm',type:'EquationBlock'},{id:'intro',type:'MechanismBlock',text:'GRU simplifies the state.'},{id:'gru',type:'EquationBlock'},{id:'d',type:'MechanismBlock'}],relationships:[{type:'definition',unitIds:['lstm','d']},{type:'definition',unitIds:['gru','d']}]}}}};
 assert.equal(pointBelongsToObjects(p,{sourceUnitIds:['d']},['lstm'],['lstm','gru']),true);assert.equal(pointBelongsToObjects(p,{sourceUnitIds:['d']},['gru'],['lstm','gru']),true);
 assert.equal(objectPointOwner(p,['lstm','gru'])({sourceUnitIds:['intro']}),'gru','a leading architecture introduction belongs to the following equation family');
 assert.equal(formulaDefinitionExcerpt('with $u, W$ learned parameters. The prediction head then reads $g(h)$. Optional intuition.'),'with $u, W$ learned parameters. The prediction head then reads $g(h)$.');
});
test('draft edits keep the actual previous publication renderer instead of displaying the new draft as published',async()=>{
 const{liveProjectView}=await import(base+'ppt/project-view.mjs');const p={id:'b'.repeat(32),uid:'test',status:'completed',revision:5,publishedRevision:4,outline:[],nodes:{},quality:{status:'pending'},deck:{slides:[]},publishedRenderTree:{renderContractVersion:24,slides:[]},renderTree:{renderContractVersion:25,slides:[]}};
 assert.equal(liveProjectView(p).publishedRenderContractVersion,24);
});
test('equation family title comes only from the literal leading architecture name',async()=>{
 const{equationFamilyTitle}=await import(base+'ppt-object-explanation.mjs');const p={source:{semantic:{inventory:{items:[{id:'a',type:'EquationBlock'},{id:'intro',text:'GRU simplifies the gates and state.'},{id:'b',type:'EquationBlock'},{id:'c',type:'EquationBlock'}]}}}};
 assert.equal(equationFamilyTitle(p,{title:'LSTM Gate Equations'},['b','c'])?.title,'GRU Gate Equations');assert.equal(equationFamilyTitle(p,{title:'LSTM Gate Equations'},['a']),null);
});
test('preflight measures and merges thin adjacent equation pages, but keeps an explicit page budget',async()=>{
 const{normalizePaste}=await import(base+'ppt-source.mjs');const{preflightCardCapacity}=await import(base+'ppt-card-capacity-preflight.mjs');
 const source=normalizePaste('# State equations\n\n$$x_t = x_{t-1}+a$$\n\n$$y_t = y_{t-1}+b$$\n\n$$z_t = z_{t-1}+c$$');const ids=source.semantic.inventory.items.filter((i:{id:string;type:string})=>i.type==='EquationBlock').map((i:{id:string})=>i.id);assert.equal(ids.length,3);
 const slides=[{id:'cover',title:'State equations'},...ids.map((id:string,k:number)=>({id:'e'+k,title:'State equations',cardObjects:[id],keyPoints:[],sourceUnitIds:[id],pageContract:{requiredUnits:[id]}})),...Array.from({length:4},(_,k)=>({id:'body'+k,title:'Distinct question '+k,keyPoints:[{text:'An independent complete source condition. '.repeat(9)}],sourceUnitIds:[]})),{id:'closing',title:'Thanks',cardFrame:'takeaway'}];
 const p={source,outline:slides,pages:slides.length,pageDecision:{mode:'auto'},generationPolicy:{version:2},planningContract:{flow:'cards'}};const auto=preflightCardCapacity(structuredClone(p),{slides});assert.ok(auto.changes.some((x:{reason:string})=>x.reason.includes('equation family')));assert.deepEqual(new Set(auto.raw.slides.flatMap((s:{cardObjects?:string[]})=>s.cardObjects||[])),new Set(ids));
 const exact=preflightCardCapacity({...structuredClone(p),pageDecision:{mode:'explicit'}},{slides});assert.equal(exact.raw.slides.length,slides.length);
});
test('figure runs normalize a legacy cont first page into the same verified counter sequence',async()=>{
 const{numberCardParts}=await import(base+'ppt-card-pages.mjs');const outline=[{id:'cover',title:'Cover'},{id:'a',title:'Experiment (cont.)',figurePage:true},{id:'b',title:'Experiment · 2/3',figurePage:true},{id:'c',title:'Experiment · 3/3',figurePage:true}];const result=numberCardParts({outline});assert.equal(result.titles.get(1),'Experiment · 1/3');assert.equal(result.titles.has(2),false);
 const locked=numberCardParts({outline:outline.map((s,i)=>i===1?{...s,titleLocked:true}:s)});assert.equal(locked.titles.has(1),false);
});
test('splitting equation-family titles preserves the reviewed logical-topic identity',async()=>{
 const{splitCardPage}=await import(base+'ppt-outline-cards.mjs');
 const items=[{id:'a',type:'EquationBlock',text:'$$a=1$$'},{id:'intro',type:'MechanismBlock',text:'GRU simplifies the gates.'},{id:'b',type:'EquationBlock',text:'$$b=2$$'}];const page={id:'p',title:'LSTM Gate Equations',logicalCardId:'reviewed-topic',cardObjects:['a','b'],sourceUnitIds:['a','b'],keyPoints:[],sourceArtifactRanges:[]};const p={source:{semantic:{inventory:{items,relationships:[]}}},outline:[{id:'cover'},page],inputUnderstanding:{primaryLanguage:'en'}};
 const split=splitCardPage(p,{slides:p.outline},1,{groups:[['a'],['b']],beforeSchedule:true});assert.ok(split);assert.ok(split.raw.slides.slice(1).every((s:{logicalCardId:string})=>s.logicalCardId==='reviewed-topic'));assert.match(split.raw.slides[2].title,/GRU/);
});
test('version metadata never relabels legacy parses and a new-source receipt records its parser hash',async()=>{
 const{projectVersionDetails,sourceParsingReceipt}=await import(base+'ppt-provenance.mjs');const p={revision:3,publishedRevision:2,source:{sha256:'source'},modelUsage:[{stage:'outline',model:'real-model',secret:'never sent'}]};const details=projectVersionDetails(p);assert.equal(details.source,null);assert.equal(details.generation,null);assert.deepEqual(details.models,[{stage:'outline',model:'real-model'}]);const receipt=sourceParsingReceipt(p.source);assert.match(receipt.implementationHash,/^[a-f0-9]{64}$/);assert.equal(receipt.sourceHash,'source');
});
test('reparse copy preserves original file bytes, policies and images, and refuses missing or changed originals',async()=>{
 const{reparseInput}=await import(base+'ppt-provenance.mjs');const crypto=await import('node:crypto');const bytes=Buffer.from('original file bytes');const p={inputKind:'file',source:{name:'source.pdf',sha256:crypto.createHash('sha256').update(bytes).digest('hex')},template:'exact-template',generationPolicy:{version:2},executionPolicy:{qualityLevel:'professional'},inputSnapshot:{images:[{id:'i',dataUrl:'data:image/png;base64,YQ==',caption:'Original chart'}]}};
 const before=JSON.stringify(p),input=reparseInput(p,bytes);assert.equal(Buffer.from(input.fileBase64,'base64').toString(),bytes.toString());assert.equal(input.template,p.template);assert.deepEqual(input.generationPolicy,p.generationPolicy);assert.deepEqual(input.executionPolicy,p.executionPolicy);assert.equal(input.images[0].caption,'Original chart');assert.equal(input.readOnlyInput,true);assert.equal(JSON.stringify(p),before);assert.throws(()=>reparseInput(p,Buffer.from('changed')),/differs/);assert.throws(()=>reparseInput(p),/unavailable/);
 const paste=reparseInput({inputKind:'paste',inputSnapshot:{text:'raw ![chart](chart.png)'},source:{text:'normalized',images:[{id:'chart',dataUrl:'data:image/png;base64,YQ=='}]}});assert.equal(paste.text,'raw ![chart](chart.png)');assert.equal(paste.images.length,1);
});
test('legacy file recreation re-extracts large embedded figures instead of treating their full captions as tiny paste attachments',async()=>{
 const{reparseInput}=await import(base+'ppt-provenance.mjs');const bytes=Buffer.from('original PDF with embedded figures');const crypto=await import('node:crypto');const p={inputKind:'file',source:{name:'figures.pdf',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),images:[{id:'source_image_aabbcc',caption:'Full scientific caption '.repeat(40),dataUrl:'large original raster'}]}};const input=reparseInput(p,bytes);assert.deepEqual(input.images,[]);assert.equal(Buffer.from(input.fileBase64,'base64').toString(),bytes.toString());
});

test('native slot preflight measures final 1.15 line spacing even when nominal line units are absent',async()=>{
 const{nativeCardSlotFits}=await import(base+'ppt-card-pages.mjs');const native={id:'n',type:'text',nativeRef:{shapeId:9},geometry:{x:0,y:0,width:5501344,height:264319},style:{fontSizePt:16},nativeTextFrame:{margins:[0,0,0,0],paragraphs:[{lineSpacing:1,runs:[{text:'Original',fontSizePt:16}]}]}};
 assert.equal(nativeCardSlotFits(native,'World model representation',16),false);const roomy={...native,geometry:{...native.geometry,height:400000}};assert.equal(nativeCardSlotFits(roomy,'World model representation',16),true);
});
