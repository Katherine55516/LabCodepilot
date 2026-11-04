import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-card-structure-runtime-'));process.env.COWORK_STATE_DIR=root;
const store=await import('./lib/ppt-store.mjs');
const {cardStructureCommands}=await import('./lib/ppt/card-structure.mjs');const {applyCommand,undo,redo}=await import('./lib/ppt/command-service.mjs');
const {getProject}=await import('./lib/ppt/repository.mjs');const {bindThemeCardPage}=await import('./lib/ppt-card-pages.mjs');const {ensureDeckV3}=await import('./lib/ppt/ir.mjs');
const {buildSlideRenderTree}=await import('./lib/ppt/render-tree.mjs');
try{
 const uid='card-structure',id='a'.repeat(32),IN=914400;
 const outline=[{id:'cover',title:'Deck'},{id:'p1',title:'Chapter',cardFrame:'divider',keyPoints:[{text:'Finding',refs:[],sourceUnitIds:[]}],cardObjects:[]},{id:'p2',title:'Finding',section:'Chapter',keyPoints:[{text:'The source supports a clear finding.',refs:[],sourceUnitIds:[]}],sourceUnitIds:[],cardObjects:[]},{id:'close',title:'Closing'}];
 const p={uid,id,revision:0,publishedRevision:0,status:'completed',pages:4,source:{text:'The source supports a clear finding.',segments:[],semantic:{inventory:{items:[],relationships:[]}}},planningContract:{version:3,flow:'cards'},outline,templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111'}},templateFidelity:{mode:'preserve',width:12*IN,height:6.75*IN,slides:Array.from({length:4},(_,index)=>({index,nodes:[],slots:[]})),slideMap:[0,1,2,3]},planning:{slidePlan:[]},nodes:{},deck:{slides:outline.map(s=>({...s,nodes:[],nodeOrder:[]}))}};
 bindThemeCardPage(p,p.deck.slides[1],1,outline[1]);p.deck.slides[1].nodes.push({id:'section-label',type:'text',semanticRole:'eyebrow',content:{text:'Part 1',derivedFrom:'source-navigation'}});bindThemeCardPage(p,p.deck.slides[2],2,outline[2]);
 for(const [index,slide]of p.deck.slides.entries())slide.templateSlideIndex=index;
 p.deck.slides[2].nodes.push({id:'native-title',type:'text',semanticRole:'template-title',content:{text:'Finding'},geometry:{x:IN,y:IN/4,width:8*IN,height:IN/2},style:{fontFamily:'Arial',fontSizePt:24},nativeRef:{contractVersion:2,slideIndex:2,sourceSlideIndex:20,shapeId:2},templateSlot:{role:'title',mapped:true}});
 p.deck=ensureDeckV3(p.deck);for(const s of p.deck.slides)p.nodes[s.id]={status:'done',slide:structuredClone(s)};store.save(p);
 const [command]=cardStructureCommands(p,{slideId:'p1',mergeSlideId:'p2',instruction:'把页面2和页面3的内容合并到一个页面中'});
 const applied=await applyCommand(uid,id,{...command,id:'command_card_structure',baseRevision:0},{allowInternal:true,allowExternalStructure:true});
 assert.equal(applied.project.pages,3);assert.equal(applied.project.templateFidelity.slides.length,3);
 await undo(uid,id);let current=getProject(uid,id);assert.equal(current.pages,4);assert.deepEqual(current.templateFidelity.slideMap,[0,1,2,3]);assert.equal(current.outline[1].cardFrame,'divider');
 await redo(uid,id);current=getProject(uid,id);assert.equal(current.pages,3);assert.deepEqual(current.templateFidelity.slideMap,[0,2,3]);assert.equal(current.deck.slides[1].id,'p2');
 assert.equal(current.deck.slides[1].nodes.filter(n=>n.content?.derivedFrom==='card-page').length,1);
 assert.equal(current.deck.slides[1].templateSlideIndex,1);
 assert.equal(current.deck.slides[1].nodes.find(n=>n.id==='native-title').nativeRef.sourceSlideIndex,20,'source template identity must not be reindexed');
 assert.ok(buildSlideRenderTree(current,'p2').elements.some(e=>e.nodeId==='native-title'&&e.content.text==='Finding'),'the native heading remains visible after apply/undo/redo');
 console.log('PASS card structure journal: apply, undo and redo restore exact page identities, template frames and body');
}finally{fs.rmSync(root,{recursive:true,force:true});}
