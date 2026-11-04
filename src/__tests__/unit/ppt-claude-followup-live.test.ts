/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures intentionally exercise dynamic or malformed model/API payloads. */
import {it} from 'node:test';
import assert from 'node:assert/strict';
const lib=(name:string)=>import('../../../apps/cowork-server/lib/'+name+'.mjs');

it('bilingual section navigation verifies every label and number regardless of language order',async()=>{
 const {inspectSourceNumbers}=await lib('ppt-source-numbers');
 const n=(text:string)=>({id:'nav',type:'text',semanticRole:'section',content:{text}});
 const p:any={source:{text:'## 6. Other Search Approaches | 其他搜索方法'},generationPolicy:{knowledge:'source_only'}};
 for(const text of ['6 其他搜索方法 · Other Search Approaches','6 Other Search Approaches','6 其他搜索方法'])assert.deepEqual(inspectSourceNumbers(p,[{id:'s',nodes:[n(text)]}]),[]);
 for(const text of ['7 其他搜索方法 · Other Search Approaches','6 其他搜索方法 · Revenue growth','6 每年收益率'])assert.ok(inspectSourceNumbers(p,[{id:'s',nodes:[n(text)]}]).length);
});

it('image masks preserve template polygon geometry across crop and preview without inserting XML',async()=>{
 const {imageMask}=await lib('ppt/image-mask');const {imageContract}=await lib('ppt/render-contract');const {slideSvg}=await lib('ppt/exporters/preview');
 const xml='<a:custGeom><a:pathLst><a:path w="100000" h="100000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="99020" y="0"/></a:lnTo><a:lnTo><a:pt x="83010" y="53030"/></a:lnTo><a:lnTo><a:pt x="99020" y="100000"/></a:lnTo><a:lnTo><a:pt x="0" y="100000"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>';
 const m=imageMask(xml);assert.equal(m.status,'supported');assert.deepEqual(m.points[2],[.8301,.5303]);assert.match(m.css,/83.01%/);
 const content={dataUrl:'data:image/png;base64,AA==',crop:[.1,.2,.1,.2],nativeMaskXml:xml};const layout=imageContract(content);assert.deepEqual(layout.crop,content.crop);assert.deepEqual(layout.mask,m);
 const svg=slideSvg({size:{width:100,height:100},elements:[{id:'art',kind:'image',bounds:{x:10,y:20,width:80,height:60},content,imageLayout:layout}]});
 assert.match(svg,/<polygon points="10,20 89.216,20/);assert.match(svg,/clip-path="url\(#mask-art\)"/);assert.match(svg,/clip-path="url\(#clip-art\)"/);assert.ok(!svg.includes('custGeom'));
 assert.equal(imageMask('<a:prstGeom prst="ellipse"/>').kind,'ellipse');assert.equal(imageMask('<a:prstGeom prst="rect"/>').kind,'rect');
 for(const bad of ['<!DOCTYPE x>','<a:prstGeom prst="roundRect"/>',xml.replace('<a:close/>','<a:arcTo/>'),xml.replace('x="83010"','x="guidance"')])assert.equal(imageMask(bad).status,'unsupported');
});

it('drafts reject an old run, source, edit epoch and out-of-order sequence',async()=>{
 const {updateDraft,draftsFor,clearDraft}=await lib('ppt/draft-store');
 const p:any={id:'followup-draft',currentRunId:'run-new',source:{sha256:'source-new'},editing:{epochs:{s:2}}};
 const progress={text:'{"title":"Correct"}',chars:19,seq:2,jobId:'job',runId:'run-new',epoch:2,sourceHash:'source-new'};
 assert.ok(updateDraft(p,'s',progress));
 for(const bad of [{runId:'run-old'},{epoch:1},{sourceHash:'source-old'},{seq:1}])assert.equal(updateDraft(p,'s',{...progress,...bad}),null);
 assert.equal(draftsFor(p.id,['s'],p).s.title,'Correct');
 assert.deepEqual(draftsFor(p.id,['s'],{...p,currentRunId:'next'}),{});
 assert.deepEqual(draftsFor(p.id,['s'],{...p,editing:{epochs:{s:3}}}),{});
 clearDraft(p.id,'s');
});

it('model progress rejects reordered or shrinking partial text and expired leases',async()=>{
 const {createPptModelJobs}=await lib('ppt-model-jobs');const queue=createPptModelJobs({timeoutMs:10000}),seen:any[]=[];
 const pending=queue.request({id:'p',uid:'u',configId:'byok:test',model:'m'},'prompt',()=>true,{onProgress:(value:any)=>seen.push(value)});
 const [{id}]=queue.list('u'),job=queue.claim('u',id);
 assert.equal(queue.progress('u',id,{lease:job.lease,seq:2,chars:10,text:'{"title":'}),true);
 for(const bad of [{seq:1,chars:5,text:'{'},{seq:3,chars:11,text:'{"wrong":'}])assert.equal(queue.progress('u',id,{lease:job.lease,...bad}),false);
 assert.equal(seen.length,1);assert.equal(seen[0].jobId,id);
 queue.complete('u',id,{lease:job.lease,text:'{}'});await pending;
 assert.equal(queue.progress('u',id,{lease:job.lease,seq:4,chars:12,text:'{"title":"'}),false);
});

it('native template skeleton keeps artwork and geometry without leaking old copy or changing final preview',async()=>{
 const {buildTemplateSkeleton}=await lib('ppt/generation-skeleton'),{liveProjectView}=await lib('ppt/project-view');
 const g={x:0,y:0,width:914400,height:914400};const p:any={id:'p',uid:'u',status:'generating',pages:1,currentRunId:'run',outline:[{id:'s',title:'New title'}],nodes:{s:{status:'running'}},source:{sha256:'source'},templateFidelity:{mode:'preserve',width:12192000,height:6858000,slides:[{background:'#efe9dc',slots:[{shapeId:1,role:'title'}],nodes:[{id:'title',type:'text',geometry:g,nativeRef:{shapeId:1},content:{text:'OLD DEAL TITLE'},style:{fontSizePt:32}},{id:'body',type:'text',geometry:g,content:{text:'OLD CONFIDENTIAL DEAL COPY'}},{id:'image',type:'image',geometry:g,content:{dataUrl:'data:image/png;base64,AA=='}}]}]}};
 const before=JSON.stringify(p),scene=buildTemplateSkeleton(p,'s');
 assert.equal(scene.background,'#efe9dc');assert.equal(scene.elements.length,2);assert.ok(scene.elements.every((e:any)=>e.locked));
 assert.equal(scene.elements[0].content.text,'New title');assert.equal(JSON.stringify(p),before);
 const view=liveProjectView(p);assert.equal(view.renderTree.slides[0].elements.length,0);assert.equal(view.progress.previewReady,0);
 assert.ok(view.generationSkeletons.s.elements[1].content.dataUrl.startsWith('/api/ppt/'));assert.ok(!JSON.stringify(view).includes('OLD CONFIDENTIAL'));
 assert.equal(buildTemplateSkeleton({...p,status:'completed'},'s'),null);
});

it('a dense page preserves a feasible artwork subset without changing source or font',async()=>{
 const {mediaPreservingFit}=await lib('ppt-media-preserving-layout');const E=914400;
 const images=[0,5.3].map((x,i)=>({id:'img'+i,type:'image',nativeRef:{shapeId:i+1},geometry:{x:x*E,y:E,width:4.7*E,height:4*E},content:{mediaRole:'template_artwork'}}));
 const p:any={templateFidelity:{width:10*E,height:6*E,slides:[{nodes:images,slots:[]}]}};
 const components=[{type:'text',content:{text:'Original bilingual source remains complete. 原文完整保留。'}}];
 const fit:any={capacity_ok:true,fontSizePt:14.5,canvas:{x:0,y:E,width:10*E,height:4*E},boxes:[],measurements:[]};
 const before=JSON.stringify(components),result=mediaPreservingFit(p,0,components,fit);
 assert.ok(result);assert.equal(result.keptMediaShapeIds.length,1);assert.equal(result.fontSizePt,14.5);assert.equal(JSON.stringify(components),before);
});

it('required media conservation blocks publication while text-only density remains diagnostic',async()=>{
 const {inspectMediaLedger}=await lib('ppt-media-ledger');
 const ledger:any={status:'profiled',buckets:{aid:{expected:0,kept:0},decoration:{expected:10,kept:6,reasons:[]}},conservation:.6,effectiveConservation:.6,retired:[],longestTextOnlyRun:0,templateMediaShare:1};
 assert.equal(inspectMediaLedger(ledger).find((i:any)=>i.code==='media_conservation_blocked').severity,'error');
 assert.ok(!inspectMediaLedger({...ledger,effectiveConservation:.7}).some((i:any)=>i.code==='media_conservation_blocked'));
 assert.equal(inspectMediaLedger({...ledger,effectiveConservation:1,longestTextOnlyRun:3}).find((i:any)=>i.code==='media_text_only_run').severity,'warning');
});

it('capacity delta repair receives a measured shortening budget while retaining scoped numeric guards',async()=>{
 const {writerLocalRepairScope,writerLocalRepairPrompt,applyWriterLocalDelta}=await lib('ppt-writer-local-repair');
 const value={sourceCommentary:[{type:'mechanism',text:'原文已经列出第 7 节与 Tutorial 14，说明需要进一步统计校验，不能直接采用样本内成绩。'}],sourceArtifacts:[{sourceUnitId:'fixed'}]};
 const error=new Error('source_artifact_capacity: {"sourceFits":true,"explanationBudget":{"singleParagraphCjkCharacters":52}}');
 const scope=writerLocalRepairScope(value,error),prompt=writerLocalRepairPrompt('context',value,scope,error);
 assert.match(prompt,/at most 44 CJK-equivalent characters/);assert.match(prompt,/SHORTEN/);
 const target=scope.targets[0],edit={path:target.path,start:target.start,end:target.end,before:target.before,after:'第 7 节与 Tutorial 14 校验候选；样本内成绩不足以采信。'};
 const result=applyWriterLocalDelta(value,scope,{edits:[edit]});assert.deepEqual(result.value.sourceArtifacts,value.sourceArtifacts);
 assert.throws(()=>applyWriterLocalDelta(value,scope,{edits:[{...edit,after:'删去所有数字'}]}),/numeric_change/);
});

it('streamed blocks require complete JSON objects, respect escaped strings and source ranges',async()=>{
 const {draftFromPartialJson}=await lib('ppt/draft-store');
 const partial='{"title":"Title","sourceCommentary":[{"type":"mechanism","text":"Ready text"';
 assert.equal(draftFromPartialJson(partial).blocks.length,0);
 assert.equal(draftFromPartialJson(partial+'}').blocks[0].text,'Ready text');
 const escaped=JSON.stringify({type:'mechanism',text:'literal "sourceUnitId":"foreign"'});
 assert.equal(draftFromPartialJson('{"sourceCommentary":['+escaped).blocks.length,1);
 const item={id:'table',type:'TableBlock',rows:[['H'],['A'],['B']],text:'H A B'};
 assert.equal(draftFromPartialJson('{"sourceArtifacts":[{"sourceUnitId":"table","rowStart":1,"rowEnd":2}',[item]).blocks[0].text,'H\nA');
 assert.equal(draftFromPartialJson('{"sourceArtifacts":[{"sourceUnitId":"foreign"}',[item]).blocks.length,0);
});

it('scaled artwork remains readable and preserves image identity and full source at the same font',async()=>{
 const {mediaPreservingFit}=await lib('ppt-media-preserving-layout'),{fitComponents}=await lib('ppt-density-capacity');const E=914400;
 const images=[0,6].map((x,i)=>({id:'photo'+i,type:'image',nativeRef:{shapeId:i+1},geometry:{x:x*E,y:2*E,width:6*E,height:3*E},content:{mediaRole:'template_artwork',dataUrl:'data:image/png;base64,AA==',imageSha256:'same-'+i}}));
 const p:any={templateFidelity:{width:12*E,height:7*E,slides:[{nodes:images,slots:[]}]}};
 const components=[{type:'text',content:{text:'A compact explanation based on the supplied original source. 原文完整保留，不增加事实。'}}];
 const fit=fitComponents(components,p,0),before=JSON.stringify(p),result=mediaPreservingFit(p,0,components,fit);
 assert.ok(result);assert.equal(result.keptMediaShapeIds.length,2);assert.equal(result.fontSizePt,fit.fontSizePt);assert.equal(JSON.stringify(p),before);
 assert.equal(result.mediaAdaptations.length,2);
 for(const media of result.mediaAdaptations){assert.ok(Math.min(media.geometry.width,media.geometry.height)>=E*.65);assert.ok(Math.abs(media.geometry.width/media.geometry.height-2)<.0001);}
});

it('reflow can restore only automatic source-region retirements, preserving explicit user exclusions',async()=>{
 const {replaceTemplateSourceRegion}=await lib('ppt-source-artifacts');const p:any={templateFidelity:{slides:[{nodes:[{type:'image',nativeRef:{shapeId:1}}]}]}};
 const slide:any={templateOmissions:[{shapeId:1,automatic:true,approvalBasis:'source_region_artwork_avoidance'},{shapeId:1,automatic:false,disposition:'excluded_by_user'}]};
 replaceTemplateSourceRegion(p,slide,0,{x:0,y:0,width:10,height:10},{keep:new Set([1])});
 assert.equal(slide.templateOmissions.length,1);assert.equal(slide.templateOmissions[0].disposition,'excluded_by_user');
});

it('semantic review preserves native exponent structure without changing exact quote text',async()=>{
 const {reviewMathFormatting}=await lib('ppt-quality'),{sourceRichText}=await lib('ppt-rich-text');
 const rich=sourceRichText('Search $10^6$ candidates.');assert.ok(rich.plainText.includes('106'));
 const [math]=reviewMathFormatting({text:rich.plainText,richText:rich});assert.equal(math.tex,'10^6');assert.match(math.mathMl,/<msup>/);assert.ok(math.fallbackRuns.some((run:any)=>run.baseline>0));
});

it('complete source reading units can fill native cards while preserving all original card images',async()=>{
 const {nativeCardFit}=await lib('ppt-media-preserving-layout');const E=914400;
 const nodes=[0,1].flatMap(i=>[{type:'text',nativeRef:{shapeId:i+1},geometry:{x:i*4*E,y:E,width:3*E,height:3*E}},{type:'image',nativeRef:{shapeId:i+10},content:{imageSha256:'original-'+i}}]);
 const p:any={templateFidelity:{slides:[{nodes,slots:[1,2].map(shapeId=>({shapeId,role:'content',purpose:'point-description'}))}]}};
 const components=[{type:'text',pairId:'pair',content:{text:'Complete English definition.'}},{type:'text',pairId:'pair',content:{text:'完整中文定义。'}},{type:'text',content:{text:'A separate source relationship.'}}];
 const fit:any={capacity_ok:true,fontSizePt:14,canvas:{x:0,y:E,width:8*E,height:4*E}};
 const result=nativeCardFit(p,0,components,fit);assert.ok(result);assert.equal(result.layoutId,'native-source-cards');assert.deepEqual(result.keptMediaShapeIds,[10,11]);assert.deepEqual(result.cardBindings[0].componentIndexes,[0,1]);assert.equal(result.fontSizePt,14);
 assert.equal(nativeCardFit(p,0,[...components,{type:'text',content:{text:'too much '.repeat(2000)}}],fit),null);
});


it('terminology audit distinguishes a known rename from ordinary shared-prefix prose',async()=>{
 const {inspectTerminology}=await lib('ppt-deck-coherence');
 const items=[{id:'u',sectionPath:['遗传编程','挖掘过程','算子代数']}];
 const p:any={source:{text:'遗传编程用于挖掘过程。算子代数。',semantic:{inventory:{items}}}};
 const make=(title:string)=>({id:title,title,nodes:[{id:'bound',sourceArtifact:{sourceUnitId:'u'}}]});
 assert.equal(inspectTerminology(p,[make('挖掘能力与算子库作用')]).length,0);
 assert.equal(inspectTerminology(p,[make('遗传规划')])[0].code,'terminology_drift');
});


it('auto edit routing ignores preservation constraints rather than misclassifying a factual correction',async()=>{
 const {classifyMutation}=await lib('ppt/mutation-router');
 assert.equal(classifyMutation('修正PBO说明，保留标题、模板媒体与字体。'),'content');
 assert.equal(classifyMutation('Rewrite the commentary while keeping the font unchanged.'),'content');
 assert.equal(classifyMutation('修正說明，維持字體與版式。'),'content');
 assert.equal(classifyMutation('调整字体与字号。'),'style');
 assert.equal(classifyMutation('保留文字，替换图片。'),'asset');
 assert.equal(classifyMutation('只改标题，保持字号。'),'title');
 assert.equal(classifyMutation('保留模板，修正正文。','content'),'content');
});
