import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-style-capacity-'));process.env.COWORK_STATE_DIR=root;
const store=await import('./lib/ppt-store.mjs');
const {applyCommand,undo,redo}=await import('./lib/ppt/command-service.mjs');
const {getProject}=await import('./lib/ppt/repository.mjs');
const {buildSlideRenderTree,rebuildRenderTree}=await import('./lib/ppt/render-tree.mjs');
const {ensureDeckV3}=await import('./lib/ppt/ir.mjs');
const {processCardPlan}=await import('./lib/ppt-process-cards.mjs');
const {diagramCardPlan}=await import('./lib/ppt-diagram-cards.mjs');
const {slideSvg}=await import('./lib/ppt/exporters/preview.mjs');
const E=914400;
try{
 const uid='style-capacity',id='b'.repeat(32),items=[{id:'one',heading:'Signal',body:'Signals must survive a second independent sample.',text:'Signal\nSignals must survive a second independent sample.'},{id:'two',heading:'Noise',body:'Control variance before expanding the feature space.',text:'Noise\nControl variance before expanding the feature space.'}];
 const cards={id:'cards',type:'list',semanticRole:'source-explanation',geometry:{x:E,y:E*1.5,width:E*10,height:E*3.6},style:{fontSizePt:18,lineHeight:1.18,colorBasis:'template-body'},content:{items,pointLayout:{fontSizePt:18,boxes:[{x:0,y:0,w:.48,h:1},{x:.52,y:0,w:.48,h:1}],overflow:false}},sourceArtifact:{sourceUnitId:'cards',type:'ChecklistBlock'}};
 const text={id:'text',type:'text',semanticRole:'source-explanation',geometry:{x:E,y:E*5.4,width:E*5,height:E*.5},style:{fontSizePt:14,lineHeight:1.18},content:{text:'A short independent conclusion.'},sourceArtifact:{sourceUnitId:'text',type:'TextBlock'}};
 const p={uid,id,revision:0,publishedRevision:0,status:'completed',pages:1,outline:[{id:'s',title:'Styles'}],templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111'}},templateFidelity:{mode:'preserve',width:12*E,height:6.75*E,slides:[{index:0,nodes:[],slots:[]}],slideMap:[0]},nodes:{s:{status:'done'}},deck:ensureDeckV3({slides:[{id:'s',title:'Styles',layoutId:'summary',templateSlideIndex:0,nodes:[cards,text]}]})};
 p.renderTree=rebuildRenderTree(p);store.save(p);
 const command=(type,payload)=>({type,id:'cmd_'+Math.random().toString(16).slice(2),baseRevision:getProject(uid,id).revision,payload:{slideId:'s',...payload}});
 const result=await applyCommand(uid,id,command('nodes.setStyle',{changes:[{nodeId:'cards',style:{fontSizePt:22.5,lineHeight:1.55}},{nodeId:'text',style:{fontSizePt:15,lineHeight:1.4}}]}));
 const rendered=result.project.renderTree.slides[0].elements.find(e=>e.nodeId==='cards');
 assert.equal(rendered.content.pointLayout.fontSizePt,22.5,'manual font wins over the old point cache');assert.equal(rendered.content.pointLayout.lineHeight,1.55);assert.equal(rendered.content.pointLayout.overflow,false);assert.ok(rendered.textStyleOverrides.includes('fontSizePt'));
 assert.match(slideSvg(result.project.renderTree.slides[0]),/line-height:1.55;/,'SVG consumes the same measured line height');
 assert.deepEqual(result.project.deck.slides[0].nodes[0].geometry,cards.geometry,'card reflow stays within its existing frame');
 await undo(uid,id);let now=getProject(uid,id);assert.equal(now.deck.slides[0].nodes[0].style.fontSizePt,18);assert.equal(now.deck.slides[0].nodes[0].style.colorBasis,'template-body','trusted batch undo preserves server style metadata');assert.deepEqual(now.renderTree.slides[0].elements.find(e=>e.nodeId==='cards').content.pointLayout.boxes,cards.content.pointLayout.boxes,'undo restores the original layout');
 await redo(uid,id);now=getProject(uid,id);assert.equal(now.renderTree.slides[0].elements.find(e=>e.nodeId==='cards').content.pointLayout.fontSizePt,22.5);
 // A narrow short frame fits two cards side by side but not stacked.
 const two=structuredClone(p);two.id='d'.repeat(32);const pair=two.deck.slides[0].nodes[0];pair.geometry={x:E,y:E,width:E*7.2,height:E*1.8};pair.style={fontSizePt:20,lineHeight:1.18};pair.content.items=pair.content.items.map(i=>({...i,body:i.body+' Verify the finding before adding features.',text:i.heading+'\n'+i.body+' Verify the finding before adding features.'}));pair.content.pointLayout={fontSizePt:14,columns:2,boxes:[{x:0,y:0,w:.48,h:1},{x:.52,y:0,w:.48,h:1}],overflow:false};two.deck.slides[0].nodes=[pair];two.deck.slides[0].nodeOrder=['cards'];two.renderTree=rebuildRenderTree(two);assert.equal(two.renderTree.slides[0].elements.find(e=>e.nodeId==='cards').style.fontSizePt,14,'the inspector sees actual card typography, not the 20pt template token');assert.equal(pair.style.fontSizePt,20,'canonical template tokens remain intact');store.save(two);
 const styledPair=await applyCommand(uid,two.id,{id:'pair-style',type:'node.setStyle',baseRevision:0,payload:{slideId:'s',nodeId:'cards',style:{fontSizePt:13.5,lineHeight:1.2}}});assert.equal(styledPair.project.renderTree.slides[0].elements.find(e=>e.nodeId==='cards').content.pointLayout.columns,2,'manual reflow tries the existing columns before refusing');
 const before=JSON.stringify(now.deck),revision=now.revision;
 await assert.rejects(applyCommand(uid,id,command('nodes.setStyle',{changes:[{nodeId:'cards',style:{colorBasis:'forged'}}]})),/unsupported fields/,'public commands cannot forge internal style metadata');
 await assert.rejects(applyCommand(uid,id,command('nodes.setStyle',{changes:[{nodeId:'text',style:{fontSizePt:15.5}},{nodeId:'cards',style:{fontSizePt:90,lineHeight:3}}]})),e=>e.code==='style_capacity_exceeded');
 now=getProject(uid,id);assert.equal(now.revision,revision,'a rejected batch creates no revision');assert.equal(JSON.stringify(now.deck),before,'a rejected batch is atomic');
 await assert.rejects(applyCommand(uid,id,command('node.setStyle',{nodeId:'text',style:{fontSizePt:70,lineHeight:3}})),e=>e.code==='style_capacity_exceeded');
 // Live completed pages allow the toolbar's batch command too; unwritten pages remain guarded.
 now.status='generating';now.runtime={slides:{s:{preview:now.renderTree.slides[0],phase:'render_ready',quality:{issues:[]}}}};store.save(now);await applyCommand(uid,id,command('nodes.setStyle',{changes:[{nodeId:'cards',style:{fontSizePt:21,lineHeight:1.4}}]}));
 const content={items,processCards:{version:1},processSource:{sourceUnitId:'steps'}};
 const small=processCardPlan(content,cards.geometry,18,{lineHeight:1.18}),large=processCardPlan(content,cards.geometry,18,{lineHeight:2});
 assert.ok(large.requiredHeight>small.requiredHeight,'process cache includes line height');
 const diagram={items,diagram:{version:1,kind:'card-grid'}};
 const d=diagramCardPlan(diagram,{...cards.geometry,height:E*.3},36.5,{lineHeight:2,fixedFont:true});
 assert.equal(d.fontSizePt,36.5,'an author font never steps down to the diagram floor');assert.equal(d.overflow,true);
 const manual=structuredClone(p);manual.deck.slides[0].nodes[0].content={...diagram,pointLayout:cards.content.pointLayout};manual.deck.slides[0].nodes[0].style={fontSizePt:22.5,lineHeight:1.55};manual.deck.slides[0].nodes[0].textStyleOverrides=['fontSizePt','lineHeight'];
 assert.equal(buildSlideRenderTree(manual,'s').elements.find(e=>e.nodeId==='cards').content.pointLayout.fontSizePt,22.5);
 const processBaseline=structuredClone(p);processBaseline.deck.slides[0].nodes[0].content={...content,pointLayout:{...cards.content.pointLayout,fontSizePt:14}};assert.equal(buildSlideRenderTree(processBaseline,'s').elements.find(e=>e.nodeId==='cards').content.pointLayout.fontSizePt,18,'unedited process cards retain the original style-first font priority');
 // Native growth cannot cover a neighbouring image; a failed command leaves
 // the original native frame, bytes, revision and journal intact.
 const nativeProject=structuredClone(p);nativeProject.id='c'.repeat(32);nativeProject.deck.slides[0].nodes=[
  {id:'native',type:'text',semanticRole:'native-text',nativeRef:{slideIndex:0,shapeId:2},nativeTextFrame:{margins:[0,0,0,0],paragraphs:[{text:'A native label',lineSpacing:1,runs:[{text:'A native label',fontSizePt:14,fontFamily:'Arial'}]}]},geometry:{x:E,y:E,width:E*3,height:E*.4},style:{fontSizePt:14,fontFamily:'Arial'},content:{text:'A native label'}},
  {id:'image',type:'image',nativeRef:{slideIndex:0,shapeId:3},geometry:{x:E,y:E*1.5,width:E*3,height:E},content:{dataUrl:'data:image/png;base64,iVBORw0KGgo='}}];
 nativeProject.deck.slides[0].nodeOrder=['native','image'];nativeProject.renderTree=rebuildRenderTree(nativeProject);store.save(nativeProject);
 await assert.rejects(applyCommand(uid,nativeProject.id,{type:'node.setStyle',id:'native-overlap',baseRevision:0,payload:{slideId:'s',nodeId:'native',style:{fontSizePt:32,lineHeight:1.5}}}),e=>e.code==='style_capacity_exceeded');
 assert.equal(getProject(uid,nativeProject.id).revision,0);
 const dark=structuredClone(nativeProject);dark.deck.slides[0].nodes=[{...dark.deck.slides[0].nodes[0],semanticRole:'template-title'}];dark.deck.slides[0].nodeOrder=['native'];dark.templateFidelity.slides[0].background='#57068c';assert.equal(buildSlideRenderTree(dark,'s').elements.find(e=>e.nodeId==='native').style.color,'#ffffff','a native title with inherited colour stays readable on its dark template');dark.deck.slides[0].nodes[0].style.color='#ff0000';assert.equal(buildSlideRenderTree(dark,'s').elements.find(e=>e.nodeId==='native').style.color,'#ff0000','explicit author title colour still wins');
 console.log('PASS style capacity: preserved card reflow, decimal font and line height, atomic rejection, undo/redo, live batch editing, process cache and fixed diagram typography');
}finally{fs.rmSync(root,{recursive:true,force:true});}
