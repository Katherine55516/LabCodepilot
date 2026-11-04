import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-empty-component-'));process.env.COWORK_STATE_DIR=root;
const {templateContentContainers,fillComponentIntent,bindContainerPoints,inspectEmptyTemplateComponents}=await import('./lib/ppt-component-regions.mjs');
const {pointIdentity,cardVisibleObjects,validCardPointProof,auditCardPoints}=await import('./lib/ppt-card-coverage.mjs');
const {missingCardPoints,pageVisibleText}=await import('./lib/ppt-outline-cards.mjs');
const {fillComponentCommands}=await import('./lib/ppt/component-fill.mjs');
const {routeMutation}=await import('./lib/ppt/mutation-router.mjs');
function fixture(){
 const first='Researcher/LLM -> candidate card -> compiler -> evaluator on development',second='Frozen candidate -> separate outer-test evaluator -> decision record';
 const frames=[{x:660000,y:2700000,width:3500000,height:1320000},{x:4330000,y:2480000,width:3500000,height:1540000},{x:660000,y:4600000,width:3500000,height:1540000}];
 const native=[],slots=[];
 for(const [i,g]of frames.entries()){
  native.push({id:'frame'+i,type:'image',geometry:g,locked:true,nativeRef:{shapeId:6+i*3,slideIndex:1,sourceSlideIndex:1},content:{templateDesignOnly:true,mustPreserve:false,mediaRole:'template_artwork',imageDhash:'4141414141414141'}});
  for(let k=1;k<=2;k++){const n={id:`sample${i}_${k}`,type:'text',nativeRef:{shapeId:6+i*3+k},geometry:{x:g.x+170000,y:g.y+300000+(k-1)*310000,width:3160000,height:k===1?232000:530000},content:{text:'Original example'}};native.push(n);slots.push({shapeId:n.nativeRef.shapeId,role:'content',purpose:k===1?'point-heading':'list',fontSizePt:k===1?14.5:11.5});}
 }
 const slide={id:'page',title:'研究回路必须有数据边界',nodes:[...native.filter(n=>n.type==='image'),{id:'loose1',type:'text',geometry:{x:660000,y:1530000,width:10800000,height:415000},semanticRole:'source-explanation',content:{text:first,derivedFrom:'card-page'},style:{fontSizePt:18}},{id:'loose2',type:'text',geometry:{x:8000000,y:2480000,width:3500000,height:1380000},semanticRole:'source-explanation',content:{text:second,derivedFrom:'card-page'},style:{fontSizePt:18}}],copy:{blocks:[{body:first},{body:second}]},sourceRefs:['2']};
 const page={id:'page',keyPoints:[{text:first,sourceUnitIds:['u1']},{text:second,sourceUnitIds:['u2']}],pageContract:{requiredRelations:['r1','r2']}};
 return {uid:'fixture',id:'c'.repeat(32),revision:1,sourceRevision:1,prompt:first+'\n'+second,generationPolicy:{version:2,language:{mode:'output',locale:'zh'}},planningContract:{flow:'cards'},templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111'}},templateFidelity:{mode:'preserve',width:12192000,height:6858000,sha256:'template',slides:[{}, {nodes:native,slots}],slideMap:[0,1]},source:{text:first+'\n'+second,semantic:{inventory:{items:[{id:'u1',type:'ProcessBlock',text:first},{id:'u2',type:'ProcessBlock',text:second}]}}},outline:[{id:'cover'},page],deck:{slides:[{id:'cover',nodes:[]},slide]}};
}
function semanticReply(project,{reject=false}={}){const slide=project.deck.slides[1],page=project.outline[1],objects=cardVisibleObjects(slide).filter(n=>n.text);return {unsupported:[],points:page.keyPoints.map((p,i)=>({id:pointIdentity(page,i),preserved:!reject,nodeIds:objects.map(n=>n.id),quotes:objects.map(n=>n.text),reason:'Checked all ordered process stages and the independent frozen outer-test boundary.'}))};}
try{
 const p=fixture(),s=p.deck.slides[1],page=p.outline[1],containers=templateContentContainers(p,s,1);assert.equal(containers.length,3);assert.equal(containers[0].frameNodeId,'frame0','staggered first row reads left to right');
 assert.equal(routeMutation(p,'请补充方框内的内容，保持字体',{type:'content'}).strategy,'fill-component');assert.ok(fillComponentIntent('Fill the empty boxes from the source'));assert.equal(routeMutation(p,'补充空框内容并调整排版').strategy,'fill-component','specific fill intent precedes generic layout nouns');assert.equal(routeMutation(p,'精简这段内容',{type:'content'}).strategy,'content-patch');
 const photo=structuredClone(p);photo.deck.slides[1].nodes[0].content.imageDhash='ffffffffffffffff';assert.equal(templateContentContainers(photo,photo.deck.slides[1],1).length,2,'photo-like raster is never assumed to be a text container');
 const fixed=structuredClone(p);fixed.templateFixedObjectIds=['frame0'];assert.equal(templateContentContainers(fixed,fixed.deck.slides[1],1).length,2);
 const translated=structuredClone(s);translated.nodes.find(n=>n.id==='loose1').content.text='研究员/LLM → 候选卡片 → 编译器 → 开发集上的评估器';translated.nodes.find(n=>n.id==='loose2').content.text='冻结候选 → 独立外部测试评估器 → 决策记录';
 assert.equal(missingCardPoints(page,translated).length,2,'English-only lexical gate reproduces reported translation failure');
 translated.cardPointCoverage=await auditCardPoints(p,translated,page,{modelCall:async()=>semanticReply({...p,deck:{slides:[p.deck.slides[0],translated]}})},()=>{},()=>{});assert.deepEqual(missingCardPoints(page,translated),[]);assert.ok(validCardPointProof(page,translated,1));assert.equal(validCardPointProof(page,translated,1,{...p,sourceRevision:2}),false,'source revision changes invalidate semantic proof');
 translated.nodes.reverse();assert.ok(validCardPointProof(page,translated,1),'canonical footer serialization order does not change positioned content');translated.nodes.reverse();
 translated.nodes.find(n=>n.id==='loose2').geometry.height+=10000;assert.ok(validCardPointProof(page,translated,1),'publication font measurement may adjust size without changing semantic position');translated.nodes.find(n=>n.id==='loose2').geometry.x+=10000;assert.equal(validCardPointProof(page,translated,1),false,'a changed process position invalidates semantic proof');translated.nodes.find(n=>n.id==='loose2').geometry.x-=10000;
 translated.nodes.find(n=>n.id==='loose2').content.text='候选 → 决策';assert.equal(validCardPointProof(page,translated,1),false,'deleting the boundary invalidates the stored proof');
 await assert.rejects(()=>auditCardPoints(p,translated,page,{modelCall:async()=>semanticReply(p,{reject:true})},()=>{},()=>{}),/流程边界/);
 const hidden=structuredClone(s);hidden.nodes=hidden.nodes.map(n=>({...n,hidden:true}));assert.equal(pageVisibleText(hidden),'');assert.equal(pageVisibleText({...hidden,nodes:[],nodeOrder:[]}), '','deleting all canonical objects cannot resurrect old copy');assert.equal(missingCardPoints(page,hidden).length,2,'old copy cannot substitute for invisible objects');
 const table={nodes:[{id:'table',type:'table',content:{rows:[['Development','Frozen'],['Compiler','Outer-test evaluator']]}}]};assert.ok(pageVisibleText(table).includes('Outer-test evaluator'));
 const before=JSON.stringify(p),assignments=['研究员 / LLM\n→ 候选卡片','候选卡片 → 编译器\n→ 开发集上的评估器','冻结候选\n→ 独立外部测试评估器\n→ 决策记录'];
 const deps={modelCall:async()=>({components:containers.map((c,i)=>({id:c.id,text:assignments[i],pointIds:[pointIdentity(page,i===2?1:0)]}))})};
 const commands=await fillComponentCommands(p,{slideId:'page',scope:'slide',instruction:'补充空框内容',proposalId:'test'},deps,()=>{},()=>{});assert.equal(JSON.stringify(p),before,'planning cannot mutate the live project');
 const after={...p,deck:commands[0].payload.deck};assert.equal(inspectEmptyTemplateComponents(after).length,0);assert.deepEqual(after.deck.slides[0],p.deck.slides[0]);assert.equal(after.deck.slides[1].nodes.filter(n=>n.type==='image').length,3);assert.equal(after.deck.slides[1].nodes.filter(n=>n.type==='text').length,3);
 // The short instruction gets a complete source-to-box plan, not a request
 // for the model to decide whether two whole points can occupy three boxes.
 let calls=0;
 const planned=await fillComponentCommands(p,{slideId:'page',scope:'slide',instruction:'请根据本页来源补充方框内的内容，保持标题和其他页面',proposalId:'planned'},{modelCall:async(_p,prompt)=>{
  calls++;const allocation=JSON.parse(prompt.split('\nServer allocation: ')[1].split('\nInstruction: ')[0]);assert.equal(allocation.assignments.length,3);
  assert.deepEqual(allocation.assignments.map(a=>a.pointIds),[[pointIdentity(page,0)],[pointIdentity(page,0)],[pointIdentity(page,1)]]);
  return {components:allocation.assignments.map((a,i)=>({id:a.id,text:assignments[i]}))};
 }},()=>{},()=>{});
 assert.equal(calls,1);assert.equal(planned[0].payload.componentFill.allocation.assignments.length,3);
 const single=await fillComponentCommands(p,{slideId:'page',scope:'object',nodeId:'frame2',instruction:'补充空框',proposalId:'one'},{modelCall:async(_p,prompt)=>{const a=JSON.parse(prompt.split('\nServer allocation: ')[1].split('\nInstruction: ')[0]).assignments;assert.equal(a.length,1);assert.deepEqual(a[0].pointIds,[pointIdentity(page,1)]);return {components:[{id:a[0].id,text:assignments[2]}]};}},()=>{},()=>{});
 assert.deepEqual(single[0].payload.deck.slides[1].nodes.filter(n=>n.templateComponentBinding).map(n=>n.templateComponentBinding.pointIds),[[pointIdentity(page,1)]]);
 let rejectedCalls=0;
 await assert.rejects(()=>fillComponentCommands(p,{slideId:'page',scope:'slide',instruction:'补充空框'},{modelCall:async()=>{rejectedCalls++;return {components:containers.map((c,i)=>({id:c.id,text:i===2?'':assignments[i],pointIds:i===2?[]:[pointIdentity(page,i===2?1:0)]}))};}},()=>{},()=>{}),/空文字/);
 assert.equal(rejectedCalls,1,'an empty model response is rejected, never silently retried or applied');
 const short=structuredClone(p);short.outline[1].keyPoints=[{text:'Only one short statement.',sourceUnitIds:['u1']}];
 await assert.rejects(()=>fillComponentCommands(short,{slideId:'page',scope:'slide',instruction:'补充空框'},{modelCall:async()=>{throw Error('must not request fabricated text');}},()=>{},()=>{}),/来源不足/);
 const oneProse=await fillComponentCommands(short,{slideId:'page',scope:'object',nodeId:'frame2',instruction:'补充此框'},{modelCall:async(_p,prompt)=>{const a=JSON.parse(prompt.split('\nServer allocation: ')[1].split('\nInstruction: ')[0]).assignments;assert.equal(a.length,1);assert.equal(a[0].fragments[0].sourceText,'Only one short statement.');return {components:[{id:a[0].id,text:'Only one short statement.'}]};}},()=>{},()=>{});
 assert.equal(oneProse[0].payload.componentFill.allocation.assignments.length,1,'an object scope never requires filling unselected boxes');
 await assert.rejects(()=>fillComponentCommands(p,{slideId:'page',scope:'slide',instruction:'补充空框'},{modelCall:async()=>({components:containers.map((c,i)=>({id:c.id,text:assignments[i],pointIds:[pointIdentity(page,i===2?0:1)]}))})},()=>{},()=>{}),/无效来源要点/);
 assert.equal(JSON.stringify(p),before,'allocation and rejected replies never mutate the source project');
 await assert.rejects(()=>fillComponentCommands(p,{slideId:'page',scope:'object',nodeId:'loose1',instruction:'补充空框'},deps,()=>{},()=>{}),/没有经原模板/);
 await assert.rejects(()=>fillComponentCommands(p,{slideId:'page',scope:'slide',instruction:'补充空框'},{modelCall:async()=>({components:containers.map(c=>({id:c.id,text:'过长内容'.repeat(200),pointIds:[pointIdentity(page,0)]}))})},()=>{},()=>{}),/可读容量/);
 const generation=structuredClone(p),bound=bindContainerPoints(generation,generation.deck.slides[1],1,page);assert.ok(bound);assert.equal(inspectEmptyTemplateComponents(generation).length,0,'generation binds two points and retires the unused third whole container');
 const empty=structuredClone(p);empty.deck.slides[1].componentLayoutVersion=1;assert.equal(inspectEmptyTemplateComponents(empty).length,3,'new content cannot publish empty certified containers');
 console.log('PASS empty-container binding, fill routing, capacity, source ownership, canonical visibility, bilingual proof and stale/deleted-boundary rejection');
}finally{fs.rmSync(root,{recursive:true,force:true});}
