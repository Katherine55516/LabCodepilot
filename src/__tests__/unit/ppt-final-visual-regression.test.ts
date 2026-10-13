import {it} from 'node:test';
import assert from 'node:assert/strict';
const m=(name:string)=>import(process.cwd()+'/apps/cowork-server/lib/'+name+'.mjs');
it('CJK punctuation-adjacent strong uses typed runs without changing raw source, code or math',async()=>{
 const {sourceRichText}=await m('ppt-rich-text');
 for(const input of ['与**教程 14（红队审查）**并读','與**教程 14（紅隊審查）**並讀']){const r=sourceRichText(input);assert.equal(r.source,input);assert.ok(r.runs.some((v:any)=>v.bold&&v.text.includes('教程 14')));assert.ok(!r.plainText.includes('**'));}
 const r=sourceRichText('**中文 `x**2` 与 $x^2$ 说明**并读');assert.ok(r.runs.find((v:any)=>v.code&&v.text==='x**2')?.bold);assert.ok(r.runs.find((v:any)=>v.kind==='math')?.bold);assert.equal(r.diagnostics.length,0);assert.equal(r.runs.at(-1).bold,undefined);
 assert.equal(sourceRichText('**中文 $x**2$ 说明**并读').runs.filter((v:any)=>v.kind==='math').length,1);
 for(const input of ['**未闭合','\\*\\*中文\\*\\*','`**中文**`','price $10 and $20'])assert.equal(sourceRichText(input).plainText,input==='\\*\\*中文\\*\\*'?'**中文**':input==='`**中文**`'?'**中文**':input);
 assert.ok(sourceRichText('**English** plain').runs[0].bold);
});
it('rich AST migration reparses original source only for unchanged text and cells',async()=>{
 const {sourceRichText,ensureRichContent,DISPLAY_TRANSFORM_VERSION}=await m('ppt-rich-text');const source='**中文（原始）**继续',old={version:2,source,plainText:source,runs:[{kind:'text',text:source}]};
 const migrated=ensureRichContent({text:source,richText:old});assert.equal(migrated.richText.version,DISPLAY_TRANSFORM_VERSION);assert.equal(migrated.text,'中文（原始）继续');assert.ok(migrated.richText.runs[0].bold);
 assert.equal(ensureRichContent({text:'Edited',richText:old}).text,'Edited');
 const table=ensureRichContent({rows:[[source,'Edited']],cellRich:[[old,{...old,plainText:'Prior'}]]});assert.deepEqual(table.rows,[['中文（原始）继续','Edited']]);assert.equal(table.cellRich[0][0].source,source);assert.equal(table.cellRich[0][1].source,'Edited');
 const typed=sourceRichText('**Prior**');typed.version=2;assert.ok(ensureRichContent({text:'Prior',richText:typed}).richText.runs[0].bold);
});
it('title-only native cover cannot own full source; its introduction must use a content page',async()=>{
 const {compileSkeleton,skeletonPrompt}=await m('ppt-outline-protocol');
 const p:any={templateFidelity:{mode:'preserve',slides:[{slots:[{role:'title'}]}]},source:{semantic:{inventory:{items:[{id:'en',type:'MechanismBlock',text:'Introduction',must_preserve_structure:true},{id:'zh',type:'MechanismBlock',text:'导言',must_preserve_structure:true}]}}}};
 const raw:any={version:2,slides:[{title:'Cover',focus:'Subject',sourceUnitIds:['en','zh']},{title:'Intro',focus:'Context',sourceUnitIds:[]},{title:'Close',focus:'Limits',sourceUnitIds:[]}]};
 assert.throws(()=>compileSkeleton(p,raw),(e:any)=>e.code==='coverage_invalid'&&e.outlineContract===true);assert.match(skeletonPrompt(p,''),/sourceUnitIds MUST be \[\]/);
 raw.slides[0].sourceUnitIds=[];raw.slides[1].sourceUnitIds=['en','zh'];assert.equal(compileSkeleton(p,raw).slides.length,3);
 p.templateFidelity.slides[0].slots.push({role:'content'});raw.slides[0].sourceUnitIds=['en','zh'];assert.equal(compileSkeleton(p,raw).slides.length,3);
});
it('source region can retire overlapping classified artwork with verifiable scope but preserves protected/unknown/outside assets',async()=>{
 const {replaceTemplateSourceRegion}=await m('ppt-source-artifacts'),{validAdaptation}=await m('ppt-template-dispositions');
 const node=(id:number,role:string,x=100)=>({id:'n'+id,type:'image',nativeRef:{shapeId:id},geometry:{x,y:250,width:200,height:200},content:{mediaRole:role}});
 const inside=node(1,'template_artwork'),outside=node(2,'template_artwork',800),protectedNode={...node(3,'template_artwork'),content:{mediaRole:'template_artwork',mustPreserve:true}};
 const p:any={source:{text:'Source'},templateFidelity:{sha256:'template',width:1000,height:700,slides:[{nodes:[inside,outside,protectedNode,...['brand','source','evidence','semanticDiagram','icon','unknown'].map((r,i)=>node(i+4,r))],slots:[]}]}};
 const slide:any={nodes:[]};replaceTemplateSourceRegion(p,slide,0,{x:100,y:200,width:500,height:400});assert.equal(slide.templateOmissions.length,1);const record=slide.templateOmissions[0];assert.ok(validAdaptation(p,inside,record,'template_artwork'));
 assert.equal(validAdaptation(p,inside,{...record,replacementRegion:{x:800,y:200,width:100,height:100}},'template_artwork'),false);
 assert.equal(validAdaptation({...p,source:{text:'changed'}},inside,record,'template_artwork'),false);assert.equal(validAdaptation({...p,templateFidelity:{...p.templateFidelity,sha256:'changed'}},inside,record,'template_artwork'),false);
});

it('outline confirmation remeasures a changed native map once, then preserves the measured assignment',async()=>{
 const {fidelityFromImported}=await m('ppt-template-fidelity'),{confirmNativeOutlineFit}=await m('ppt-outline-confirmation');
 const owned={id:'unit',type:'MechanismBlock',text:'Independent hypotheses need out-of-sample validation. '.repeat(12),must_preserve_structure:true};
 const imported:any={externalPptx:{width:12000000,height:7000000,originalPath:'/workspace/template.pptx'},deck:{slides:Array.from({length:6},(_,i)=>({id:'native'+i,nodes:[{id:'title'+i,type:'text',nativeRef:{shapeId:2},geometry:{x:500000,y:400000,width:10000000,height:700000},style:{fontSizePt:28},content:{text:'Topic'}},{id:'body'+i,type:'text',nativeRef:{shapeId:3},geometry:{x:500000,y:1800000,width:i===2?1000000:10000000,height:3500000},style:{fontSizePt:18},content:{text:'Original content'}}]}))}};
 const p:any={pages:4,source:{text:'s'.repeat(9000),semantic:{inventory:{items:[owned]}}},pageDecision:{mode:'auto'},outline:Array.from({length:4},(_,i)=>({id:'s'+i,title:'Page '+i,focus:'Explain the scope',sourceUnitIds:i===2?['unit']:[],planningProtocolVersion:2}))};
 p.templateFidelity=fidelityFromImported({...p,pages:6},imported,'hash');const catalog=p.templateFidelity.sourceCatalog;
 p.templateFidelity.slides=[catalog[0],catalog[1],catalog[2],catalog[5]];p.templateFidelity.slideMap=[0,1,2,5];
 confirmNativeOutlineFit(p);assert.ok(p.outline[2].densityFit.capacity_ok);const accepted=p.templateFidelity;confirmNativeOutlineFit(p);assert.equal(p.templateFidelity,accepted);assert.equal(p.pages,4);
 p.outline[2].sourceUnitIds=['unit'];owned.text=owned.text.repeat(100);assert.throws(()=>confirmNativeOutlineFit(p),(e:any)=>e.code==='capacity_invalid');assert.equal(p.templateFidelity,accepted);assert.equal(p.pages,4);
});

it('section-only repair final schema does not instruct the model to copy the rejected navigation text',async()=>{
 const {writerRepairPrompt}=await m('ppt-prompt-contracts');
 const context='<final_native_limits>[{"shapeId":2,"role":"section","maxVisualUnits":8},{"shapeId":3,"role":"title","maxVisualUnits":20}]</final_native_limits>\n<frozen_source_selection>[{"sourceUnitId":"unit"}]</frozen_source_selection>\n<source_commentary_budget>{"sourceFits":true,"singleParagraphCjkCharacters":20}</source_commentary_budget>';
 const draft={id:'s',title:'Two paradigms',templateSlotTexts:{'2':'1.1 Two research paradigms','3':'Two paradigms'},nodes:[]};
 const prompt=writerRepairPrompt(context,draft,[{code:'template_slot_overflow',slotRole:'section',shapeId:2,capacity:8}]);const marker='返回唯一 JSON：';const last=prompt.slice(prompt.lastIndexOf(marker)+marker.length).split('。只输出 JSON')[0];const schema=JSON.parse(last);
 assert.equal(schema.title,draft.title);assert.equal(schema.slotTexts['3'],draft.title);assert.notEqual(schema.slotTexts['2'],draft.templateSlotTexts['2']);assert.match(schema.slotTexts['2'],/至多 8/);
});

it('a model-only omission reason cannot suppress a proven scoped adaptation, and out-of-region model omissions remain unapproved',async()=>{
 const {replaceTemplateSourceRegion}=await m('ppt-source-artifacts'),{validAdaptation}=await m('ppt-template-dispositions');
 const n:any={id:'art',type:'image',nativeRef:{shapeId:4},geometry:{x:100,y:200,width:100,height:100},content:{mediaRole:'template_artwork'}};
 const p:any={source:{text:'frozen'},templateFidelity:{width:1000,height:700,sha256:'hash',slides:[{nodes:[n],slots:[]}]}};
 const s:any={nodes:[],templateOmissions:[{shapeId:4,reason:'The model wants this decorative shape omitted'}]};replaceTemplateSourceRegion(p,s,0,{x:100,y:200,width:500,height:400});assert.ok(validAdaptation(p,n,s.templateOmissions[0],'template_artwork'));const first=structuredClone(s.templateOmissions);replaceTemplateSourceRegion(p,s,0,{x:100,y:200,width:500,height:400});assert.deepEqual(s.templateOmissions,first);
 n.geometry.x=900;const outside:any={nodes:[],templateOmissions:[{shapeId:4,reason:'Model asks'}]};replaceTemplateSourceRegion(p,outside,0,{x:100,y:200,width:500,height:400});assert.equal(outside.templateOmissions[0].automatic,undefined);assert.equal(validAdaptation(p,n,outside.templateOmissions[0],'template_artwork'),false);
});

it('native coverage preserves missing original layouts and their media without changing N or source, and rejects an accepted target',async()=>{
 const {fidelityFromImported,restoreNativeTemplateCoverage}=await m('ppt-template-fidelity');
 const imported:any={externalPptx:{width:12000000,height:7000000,originalPath:'/workspace/template.pptx'},deck:{slides:Array.from({length:4},(_,i)=>({id:'native'+i,nodes:[{id:'title'+i,type:'text',nativeRef:{shapeId:2},geometry:{x:500000,y:400000,width:10000000,height:700000},style:{fontSizePt:28},content:{text:'Topic'}},{id:'body'+i,type:'text',nativeRef:{shapeId:3},geometry:{x:500000,y:1800000,width:10000000,height:3500000},style:{fontSizePt:18},content:{text:'Original'}},{id:'image'+i,type:'image',nativeRef:{shapeId:4},geometry:{x:1,y:1,width:1,height:1},content:{dataUrl:'data:image/png;base64,original'+i}}]}))}};
 const p:any={pages:6,source:{text:'Original immutable source'},outline:Array.from({length:6},(_,i)=>({id:'s'+i,title:'Page '+i}))};
 p.templateFidelity=fidelityFromImported(p,imported,'hash');assert.equal(p.templateFidelity.sourceCatalog.flatMap((s:any)=>s.nodes).filter((n:any)=>n.type==='image'&&n.content.dataUrl).length,4);
 p.templateFidelity.slideMap=[0,1,1,1,1,3];const source=p.source.text;restoreNativeTemplateCoverage(p,()=>0);assert.equal(p.pages,6);assert.equal(p.source.text,source);assert.equal(new Set(p.templateFidelity.slideMap).size,4);assert.equal(p.templateFidelity.slides.find((s:any)=>s.sourceIndex===2).nodes.find((n:any)=>n.type==='image').content.dataUrl,'data:image/png;base64,original2');
 p.templateFidelity.slideMap=[0,1,1,1,1,3];const prior=p.templateFidelity;assert.throws(()=>restoreNativeTemplateCoverage(p,()=>Infinity),(e:any)=>e.code==='capacity_invalid');assert.equal(p.templateFidelity,prior);assert.deepEqual(p.templateFidelity.slideMap,[0,1,1,1,1,3]);
});

it('nested Chinese emphasis closes inner italic before outer strong and keeps literal math/code',async()=>{
 const{sourceRichText}=await m('ppt-rich-text');for(const raw of ['它需要的是**弱、便宜，并且与已有因子*不同***。','需要**弱、便宜，與已有因子*不同***。']){const r=sourceRichText(raw);assert.equal(r.source,raw);assert.ok(!r.plainText.includes('*'));const nested=r.runs.find((v:any)=>v.text==='不同');assert.ok(nested.bold&&nested.italic);assert.equal(r.runs.at(-1).bold,undefined);}
 assert.equal(sourceRichText('`x*y**z` 与 $x**2$').runs[0].text,'x*y**z');assert.equal(sourceRichText('**English *different*** plain').plainText,'English different plain');assert.equal(sourceRichText('中文*未闭合').plainText,'中文*未闭合');assert.equal(sourceRichText('与*不同*。').runs.find((r:any)=>r.text==='不同').italic,true);
});

it('automatic native partitions require a usable assigned layout while legacy portable partitions still require every layout',async()=>{
 const{applyOutlineCapacityRepair}=await m('ppt-outline-capacity-repair'),{candidateFit}=await m('ppt-density-packing'),{sourceComponent,fitComponents}=await m('ppt-density-capacity');const I=914400;
 const spec=(width:number)=>({nodes:[{id:'body',type:'text',nativeRef:{shapeId:3},geometry:{x:I,y:I,width:width*I,height:1.5*I},style:{fontSizePt:18},content:{text:'Original'}}],slots:[{shapeId:3,role:'content'}]});
 const p:any={pages:3,outline:[],source:{text:'Original',semantic:{inventory:{items:[]}}},templateFidelity:{mode:'preserve',width:13.33*I,height:7.5*I,slides:[spec(10),spec(10),spec(2)]}};
 let chosen=false,slide:any;for(let count=1;count<30;count++){p.source.semantic.inventory.items=['a','b'].map(id=>({id,type:'MechanismBlock',text:'alpha validation '.repeat(count),must_preserve_structure:true}));slide={title:'Actual claim',sourceUnitIds:['a','b'],sourceImageIds:[],sourceArtifactRanges:[],keyPoints:[],requiredDetails:[],requiredEvidenceIds:[],planningProtocolVersion:2};if(p.source.semantic.inventory.items.every((item:any)=>[1,2].every(i=>fitComponents([sourceComponent(item)],p,i).capacity_ok))&&candidateFit(slide,p,1).capacity_ok&&!candidateFit(slide,p,2).capacity_ok){chosen=true;break;}}
 assert.ok(chosen,'fixture needs a valid wide layout and a genuinely overflowing narrow layout');const a:any={project:p,outline:[{},slide],rawOutline:{slides:[{},slide]}};const response={slides:[{title:slide.title,sourceUnitIds:['a','b'],sourceImageIds:[],sourceArtifactRanges:[],keyPointIndexes:[],requiredDetailIndexes:[],requiredEvidenceIds:[]}]};
 assert.throws(()=>applyOutlineCapacityRepair(a,1,response),/fails measured native capacity/);p.nativeCapacityAssignment=true;const result=applyOutlineCapacityRepair(a,1,response);assert.deepEqual(result[0].sourceUnitIds,['a','b']);assert.equal(candidateFit(result[0],p,2).capacity_ok,false);assert.equal(candidateFit(result[0],p,1).capacity_ok,true);
});
