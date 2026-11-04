import {test} from 'node:test';
import assert from 'node:assert/strict';
const base=process.cwd()+'/apps/cowork-server/lib/';
type Box={x:number;y:number;width:number;height:number};
type FixtureNode={id:string;type:string;geometry:Box;nativeRef?:{shapeId:number};content?:{text?:string;derivedFrom?:string;templateDesignOnly?:boolean;imageDhash?:string;mediaRole?:string;mustPreserve?:boolean};style?:{fontSizePt:number};templateComponentBinding?:{containerNodeId:string};userGeometry?:boolean;locked?:boolean};
const I=914400;
const geometry={x:4*I,y:1.5*I,width:3*I,height:3*I};
const layers=()=>['a','b'].map((id,i)=>({id,type:'image',nativeRef:{shapeId:i+1},geometry:{...geometry},content:{monochromePanel:true,imageSha256:id,templateDesignOnly:true,mediaRole:'template_artwork'}}));
test('coincident complementary media layers remain atomic, with split and missing-member negatives',async()=>{
 const {templateMediaAssemblies,inspectMediaAssemblies}=await import(base+'ppt-media-assemblies.mjs');const{tierCardDeckIssues}=await import(base+'ppt-gate-tiers.mjs');
 const nodes=layers(),p={templateFidelity:{width:12*I,height:7*I,slides:[{nodes}]},deck:{slides:[{id:'p',nodes:structuredClone(nodes)}]}};
 assert.equal(templateMediaAssemblies({nodes},p.templateFidelity).length,1);assert.deepEqual(inspectMediaAssemblies(p),[]);
 p.deck.slides[0].nodes[1].geometry.y+=I;assert.equal(tierCardDeckIssues(inspectMediaAssemblies(p))[0].severity,'error');
 p.deck.slides[0].nodes.pop();assert.equal(inspectMediaAssemblies(p).length,1);
 p.deck.slides[0].nodes=[];assert.deepEqual(inspectMediaAssemblies(p),[]);
 const separate=layers();separate[1].geometry.x+=4*I;assert.equal(templateMediaAssemblies({nodes:separate},p.templateFidelity).length,0,'neighboring photos are independent');
});
test('design-only disposition retires the entire optional illustration; fixing any member protects the complete assembly',async()=>{
 const{templateDesignView}=await import(base+'ppt-template-design.mjs');const imported={externalPptx:{width:12*I,height:7*I},deck:{slides:[{nodes:layers()}]}};
 assert.ok(templateDesignView(imported).deck.slides[0].nodes.every((n:{content:{mediaRole:string}})=>n.content.mediaRole==='old_template_content'));
 assert.ok(templateDesignView(imported,new Set(),new Set(['a'])).deck.slides[0].nodes.every((n:{content:{mustPreserve:boolean}})=>n.content.mustPreserve));
});
test('single picture enlarges proportionally with its complete caption below and no capacity loophole',async()=>{
 const{wideFigureFit}=await import(base+'ppt-figure-composition.mjs');
 const components=[{type:'image',content:{sourceImageId:'pic',width:200,height:100}},{type:'text',content:{sourceImageCaptionId:'pic',text:'Complete source caption and explanation. '.repeat(5)}}];
 const fit=wideFigureFit(components,{},1);assert.ok(fit);assert.equal(fit.boxes[0].width/fit.boxes[0].height,2);assert.ok(fit.boxes[0].width>200*9144);assert.ok(fit.boxes[1].width>=fit.boxes[0].width);assert.ok(fit.boxes[1].y>=fit.boxes[0].y+fit.boxes[0].height);assert.ok(fit.measurements[1].fontSizePt>=12);
 assert.equal(wideFigureFit([{type:'image',content:{sourceImageId:'pic',width:200,height:100}},{type:'text',content:{sourceImageCaptionId:'pic',text:'Never truncate this full source caption. '.repeat(3000)}}],{},1),null);
});
test('bound source cards use equal-height centered rows without stretching frame images or changing payloads',async()=>{
 const{balanceBoundContainers}=await import(base+'ppt-container-layout.mjs');
 const nodes:FixtureNode[]=Array.from({length:3},(_,k)=>[{id:'frame'+k,type:'image',geometry:{x:k*3*I,y:2*I,width:3*I,height:(1+k*.15)*I},nativeRef:{shapeId:k+1},content:{templateDesignOnly:true}},{id:'text'+k,type:'text',geometry:{x:k*3*I+.15*I,y:2.2*I,width:2.7*I,height:.65*I},style:{fontSizePt:14},content:{text:'Source point '+k},templateComponentBinding:{containerNodeId:'frame'+k}}]).flat();
 const slide={nodes},before=structuredClone(nodes),p={};const fit=balanceBoundContainers(p,slide,1);assert.equal(fit?.cols,3);
 const frames=slide.nodes.filter((n:FixtureNode)=>n.type==='image');assert.equal(new Set(frames.map((n:FixtureNode)=>n.geometry.height)).size,1);assert.equal(new Set(frames.map((n:FixtureNode)=>n.geometry.y)).size,1);
 for(const n of slide.nodes){const old=before.find(x=>x.id===n.id)!;assert.deepEqual(n.content,old.content);assert.deepEqual(n.style,old.style);if(n.type==='image')assert.ok(Math.abs(n.geometry.width/n.geometry.height-old.geometry.width/old.geometry.height)<.0001);}
 slide.nodes.find((n:FixtureNode)=>n.id==='text1')!.userGeometry=true;const snapshot=JSON.stringify(slide);assert.equal(balanceBoundContainers(p,slide,1),null);assert.equal(JSON.stringify(slide),snapshot);
});
test('mathematical glyph aliases preserve Greek functions and elementwise multiplication, but never change an operand',async()=>{
 const{inspectContent}=await import(base+'ppt-content-qa.mjs');const p={source:{text:'z_t = \\sigma(W_z x_t + U_z h_{t-1} + b_z)\nh_t = U_h(r_t \\odot h_{t-1})'},outline:[]};
 const qa=(text:string)=>inspectContent(p,{slides:[{id:'p',title:'Gate',nodes:[{id:'n',type:'text',content:{text}}]}]}).issues.filter((i:{code:string})=>i.code==='visible_formula_unverified');
 assert.deepEqual(qa('sigma(W_z x_t + U_z h_{t-1} + b_z)'),[]);assert.deepEqual(qa('U_h(r_t ⊙ h_{t-1})'),[]);assert.ok(qa('sigma(W_z x_t + U_z h_{t-2} + b_z)').length);
});
test('smart page reflow rejects accepted or manually positioned source objects without mutating the draft',async()=>{
 const{nativeContentLayout}=await import(base+'ppt/native-content-layout.mjs');
 const slide={id:'p',title:'Source',nodes:[{id:'source',type:'text',sourceArtifact:{type:'TextBlock'},userGeometry:true,geometry:{x:I,y:2*I,width:5*I,height:I},content:{text:'The complete original source.'}}]};
 const p={templateFidelity:{mode:'preserve',width:12*I,height:7*I,slides:[{nodes:[],slots:[]}]},deck:{slides:[slide]},runtime:{slides:{p:{accepted:true}}}};
 const before=JSON.stringify(p);assert.throws(()=>nativeContentLayout(p,{scope:'slide',slideId:'p'}),/unlock/);assert.equal(JSON.stringify(p),before);
 p.runtime.slides.p.accepted=false;const unlocked=JSON.stringify(p);assert.throws(()=>nativeContentLayout(p,{scope:'slide',slideId:'p'}),/manual positions/);assert.equal(JSON.stringify(p),unlocked);
});
test('native smart reflow has its own bounded route while general template relayout stays guarded',async()=>{
 const{routeMutation}=await import(base+'ppt/mutation-router.mjs');const p={templateFidelity:{mode:'preserve'},deck:{slides:[]}};
 assert.equal(routeMutation(p,'Arrange sourced content',{type:'layout',mode:'native-content'}).type,'layout');
 assert.throws(()=>routeMutation(p,'Change the layout',{type:'layout'}),/native templates/);
 assert.throws(()=>routeMutation(p,'Merge pages',{type:'structure',mode:'native-content'}),/native templates/);
});
test('unused reference-page frames retire only with original heading/body evidence; complete references and fixed frames survive',async()=>{
 const{retireUnboundContainers,inspectEmptyTemplateComponents}=await import(base+'ppt-component-regions.mjs');
 const frames=Array.from({length:2},(_,k)=>({id:'frame'+k,type:'image',nativeRef:{shapeId:k*3+1},geometry:{x:k*4*I,y:2*I,width:3*I,height:1.5*I},content:{templateDesignOnly:true,imageDhash:'0180414141414141',mediaRole:'template_artwork'},locked:true}));
 const original:FixtureNode[]=frames.flatMap((f,k)=>[f,{id:'heading'+k,type:'text',nativeRef:{shapeId:k*3+2},geometry:{x:f.geometry.x+.2*I,y:2.2*I,width:2.6*I,height:.3*I}},{id:'body'+k,type:'text',nativeRef:{shapeId:k*3+3},geometry:{x:f.geometry.x+.2*I,y:2.5*I,width:2.6*I,height:.7*I}}]);
 const slots=frames.flatMap((_,k)=>[{shapeId:k*3+2,role:'content',purpose:'point-heading'},{shapeId:k*3+3,role:'content',purpose:k===0?'point-description':'list'}]);
 const reference={id:'references',type:'text',semanticRole:'source-explanation',geometry:{x:8*I,y:2*I,width:3*I,height:2*I},content:{text:'[R02] Full author, title and year. Accessed 2026-10-23.',derivedFrom:'card-page'}};
 const slide:{id:string;cardPage:{mode:string};nodes:FixtureNode[]}={id:'p',cardPage:{mode:'theme'},nodes:[...structuredClone(frames),reference]};const p={source:{text:reference.content.text},templateContentMode:'design_only',templateFidelity:{mode:'preserve',sha256:'a',width:12*I,height:7*I,slides:[{nodes:original,slots}]},deck:{slides:[slide]}};
 assert.equal(inspectEmptyTemplateComponents(p).length,2,'legacy generated pages are checked even without componentLayoutVersion');
 slide.nodes[1].content!.mustPreserve=true;p.templateFidelity.slides[0].nodes.find((n:FixtureNode)=>n.id==='frame1')!.content!.mustPreserve=true;
 const originalText=JSON.stringify(reference);assert.deepEqual(retireUnboundContainers(p,slide,0),['frame0']);assert.equal(JSON.stringify(slide.nodes.find((n:FixtureNode)=>n.id==='references')),originalText);assert.ok(slide.nodes.some((n:FixtureNode)=>n.id==='frame1'));assert.equal(inspectEmptyTemplateComponents(p).length,0);
});
test('bibliography can prefer a readable full-width sequence without overriding capacity',async()=>{
 const{fitComponents}=await import(base+'ppt-density-capacity.mjs');const components=Array.from({length:5},(_,k)=>({type:'text',content:{text:'[R0'+k+'] Full author and title, original publication year and source qualifier.'}}));
 const fit=fitComponents(components,{},1,{preferredLayoutId:'stacked-source',fontSizePt:18,center:true});assert.equal(fit.layoutId,'stacked-source');assert.ok(fit.capacity_ok);assert.ok(fit.boxes.every((b:Box)=>b.width===fit.canvas.width));assert.ok(fit.boxes.slice(1).every((b:Box,k:number)=>b.y>=fit.boxes[k].y+fit.boxes[k].height));
});
test('explicit artwork locks are distinguished from imported default locks and survive journal undo provenance',async()=>{
 const{explicitLayoutLocks}=await import(base+'ppt-layout-locks.mjs');const p={deck:{slides:[{nodes:[{id:'import',locked:true},{id:'user',locked:true},{id:'unlocked',locked:false}]}]}};
 const history=[{command:{type:'node.setLocked',payload:{nodeId:'user',locked:true}}},{command:{type:'node.setLocked',payload:{nodeId:'unlocked',locked:true}}}];assert.deepEqual([...explicitLayoutLocks(p,history)],['user']);
});
test('undoing an explicit lock restores the default imported-lock policy; redo restores the explicit constraint',async()=>{
 const{explicitLayoutLocks}=await import(base+'ppt-layout-locks.mjs');const p={deck:{slides:[{nodes:[{id:'frame',locked:true}]}]}};
 const lock={id:'lock',kind:'command',command:{type:'node.setLocked',payload:{nodeId:'frame',locked:true}}},undo={id:'undo',kind:'undo',targetOperationId:'lock'};
 assert.deepEqual([...explicitLayoutLocks(p,[lock,undo])],[]);assert.deepEqual([...explicitLayoutLocks(p,[lock,undo,{id:'redo',kind:'redo',targetOperationId:'lock',command:lock.command}])],['frame']);
});
test('single-page restore tolerates rebuilt graph/order caches but refuses a later manual geometry edit',async()=>{
 const{restoreEditablePageSnapshot}=await import(base+'ppt/proposal-service.mjs');const before={id:'p',nodes:[{id:'a',type:'text',content:{text:'Complete source'},geometry:{x:0,y:0,width:100,height:100}}],nodeOrder:['a'],componentGraph:{version:1,nodes:['a']}};const after=structuredClone(before);after.nodes[0].geometry.x=50;after.componentGraph={version:1,nodes:['a','derived']};const current={...structuredClone(after),nodeOrder:['derived','a'],componentGraph:{version:2,nodes:['derived','a']}};const restored=restoreEditablePageSnapshot(current,before,after,before);assert.deepEqual(restored.nodes,before.nodes);assert.equal(restored.componentGraph,undefined);assert.deepEqual(restored.nodeOrder,['a']);
 current.nodes[0].geometry.x=75;assert.throws(()=>restoreEditablePageSnapshot(current,before,after,before),/manual edit/);assert.equal(current.nodes[0].geometry.x,75);
});

test('native bind retires a late-materialized unused certified frame and leaves complete occupied content intact',async()=>{
 const{bindTemplateFidelity}=await import(base+'ppt-template-fidelity.mjs');const{inspectEmptyTemplateComponents}=await import(base+'ppt-component-regions.mjs');
 const box={x:I,y:2*I,width:4*I,height:2*I};const frame={id:'frame',type:'shape',nativeRef:{shapeId:1,slideIndex:0},geometry:box,style:{fill:'#222222'},content:{templateDesignOnly:true,mediaRole:'template_artwork'},locked:true};
 const slots=[{shapeId:2,role:'content',purpose:'point-heading'},{shapeId:3,role:'content',purpose:'point-description'}];const native=[frame,...slots.map((slot,k)=>({id:'slot'+k,type:'text',nativeRef:{shapeId:slot.shapeId,slideIndex:0},geometry:{x:1.2*I,y:(2.2+k*.5)*I,width:3.6*I,height:.4*I},style:{fontSizePt:14},content:{text:'Old report'}}))];
 const reference={id:'source',type:'text',semanticRole:'source-explanation',geometry:{x:6*I,y:2*I,width:4*I,height:2*I},content:{text:'All four complete original references remain visible.',derivedFrom:'card-page'}};
 const p={planningContract:{version:3,flow:'cards'},templateContentMode:'design_only',templateFidelity:{mode:'preserve',width:12*I,height:7*I,slides:[{nodes:native,slots,shapeCount:3,imageCount:0}]},outline:[{id:'p',cardObjects:[]}],deck:{slides:[{id:'p',title:'References',cardPage:{mode:'native'},nodes:[reference],templateOmissions:slots.map(slot=>({shapeId:slot.shapeId,automatic:true,reason:'Unused content slot omitted.'}))}]}};
 bindTemplateFidelity(p);assert.equal(p.deck.slides[0].nodes.some((n:FixtureNode)=>n.id==='frame'),false);assert.equal(p.deck.slides[0].nodes.find((n:FixtureNode)=>n.id==='source')?.content?.text,reference.content.text);assert.deepEqual(inspectEmptyTemplateComponents(p),[]);
});
