// Card deck continuation during generation (Fable R4, 2026-10-23): a page
// that does not fit continues on more pages; finished pages keep their native
// frames, pages not written yet take the frames of the new schedule.
import assert from 'node:assert/strict';
const {_internals:{movedFinishedFrame,pinFinishedFrames}}=await import('./lib/ppt-api.mjs');
const frame=n=>({templatePage:n,slots:[{role:'title',shapeId:n}]});
const project=statuses=>({templateFidelity:{slides:[frame(1),frame(3),frame(5),frame(3)],slideMap:[0,1,2,3]},outline:['a','b','c','d'].map(id=>({id})),nodes:Object.fromEntries(['a','b','c','d'].map((id,k)=>[id,{status:statuses[k]}]))});
// Page b (index 1) failed and splits into b and b2; the new schedule moves page d's frame.
const nextOutline=['a','b','b2','c','d'].map(id=>({id})),changed=new Set(['b','b2']);
const next={templateFidelity:{slides:[frame(1),frame(3),frame(5),frame(5),frame(7)]}};
assert.equal(movedFinishedFrame(project(['done','failed','done','pending']),next,nextOutline,changed),-1,'a pending page takes its new frame');
assert.equal(movedFinishedFrame(project(['done','failed','done','done']),next,nextOutline,changed),3,'a finished page keeps its frame: declined');
assert.equal(movedFinishedFrame(project(['done','failed','accepted','pending']),{templateFidelity:{slides:[frame(1),frame(3),frame(5),frame(3),frame(7)]}},nextOutline,changed),2,'an accepted page counts as finished');
assert.equal(movedFinishedFrame({...project(['done','failed','done','done']),templateFidelity:undefined},next,nextOutline,changed),-1,'no native frames, nothing to keep');
// A moved finished frame is put back, so the continuation goes on (live fz-r4: the takeaway).
{const done=project(['done','failed','done','done']),moved=structuredClone(next);moved.templateFidelity.slideMap=[0,1,2,2,3];
 pinFinishedFrames(done,moved,nextOutline,changed);
 assert.deepEqual(moved.templateFidelity.slides[4],frame(3),'the finished last page keeps its frame');assert.equal(moved.templateFidelity.slideMap[4],3,'and its layout index');
 assert.deepEqual(moved.templateFidelity.slides[2],frame(5),'a page being written keeps its new frame');
 assert.equal(movedFinishedFrame(done,moved,nextOutline,changed),-1);}
// A frame that only moved with its page is the same layout; a pinned frame takes its new position (live fz-r5).
{const placed=(n,at)=>({templatePage:n,index:at,slots:[{role:'title',shapeId:n}],nodes:[{id:'t'+n,nativeRef:{shapeId:n,slideIndex:at}}]});
 const done={templateFidelity:{slides:[placed(1,0),placed(3,1),placed(5,2),placed(3,3)],slideMap:[0,1,2,3]},outline:['a','b','c','d'].map(id=>({id})),nodes:{a:{status:'done'},b:{status:'failed'},c:{status:'done'},d:{status:'done'}}};
 const shifted={templateFidelity:{slides:[placed(1,0),placed(3,1),placed(5,2),placed(5,3),placed(3,4)],slideMap:[0,1,2,2,3]}};
 assert.equal(movedFinishedFrame(done,shifted,nextOutline,changed),-1,'the same layout one position later is not a move');
 const moved={templateFidelity:{slides:[placed(1,0),placed(3,1),placed(5,2),placed(5,3),placed(7,4)],slideMap:[0,1,2,2,4]}};
 pinFinishedFrames(done,moved,nextOutline,changed);
 assert.deepEqual([moved.templateFidelity.slides[4].templatePage,moved.templateFidelity.slides[4].index,moved.templateFidelity.slides[4].nodes[0].nativeRef.slideIndex],[3,4,4],'the kept layout owns its new position');}
// A page that moves keeps its omission approvals: the record names the asset,
// not its position (live fz-r13/mlq-r13: retirements after a continuation lost
// their approval and publication was blocked).
{const {adaptationDisposition,validAdaptation}=await import('./lib/ppt-template-dispositions.mjs');
 const icon=(at,id)=>({id,type:'image',geometry:{x:1,y:1,width:2,height:2},content:{mediaRole:'template_icon'},nativeRef:{shapeId:25,slideIndex:at,sourceSlideIndex:2}});
 const project={source:{text:'Body.'},templateFidelity:{sha256:'t'}};
 const record={...adaptationDisposition(project,icon(3,'node_a'),'template_icon','source_region_card_icon_avoidance','test'),replacementRegion:{x:0,y:0,width:10,height:10}};
 assert.ok(validAdaptation(project,icon(4,'node_b'),record,'template_icon'),'the same asset one page later');
 assert.ok(!validAdaptation(project,{...icon(4,'node_b'),geometry:{x:5,y:5,width:2,height:2}},record,'template_icon'),'a different asset is not approved');
 // A repeated frame's rotated icon is its slot: a continuation re-rotates the image (live mlq-r15).
 const rotated=(at,image)=>({...icon(at,'node_'+image),content:{mediaRole:'template_icon',mediaReplacement:true,dataUrl:'data:image/png;base64,'+image}});
 const rotatedRecord={...adaptationDisposition(project,rotated(3,'AAAA'),'template_icon','source_region_card_icon_avoidance','test'),replacementRegion:{x:0,y:0,width:10,height:10}};
 assert.ok(validAdaptation(project,rotated(4,'BBBB'),rotatedRecord,'template_icon'),'the same slot with another rotated image');}
// The outline compile keeps a card's code-set continuation marker (live fz-r34 p3); other flows still strip it.
{const {_internals:{normalizeOutline}}=await import('./lib/ppt-api.mjs');
 const slides=[{title:'Cover',focus:'c'},{title:'Factor Definitions',focus:'a'},{title:'Factor Definitions (cont.)',focus:'b'},{title:'因子定义（续）',focus:'z'}];
 assert.deepEqual(normalizeOutline({slides},4,{text:''},null,null,'en',{keepContinuation:true}).map(s=>s.title),['Cover','Factor Definitions','Factor Definitions (cont.)','因子定义（续）']);
 assert.deepEqual(normalizeOutline({slides},4,{text:''},null,null,'en').map(s=>s.title),['Cover','Factor Definitions','Factor Definitions','因子定义']);
 // So do the title hierarchy and the distinct-title pass before it (live fz-r35 p3).
 const {planTitleHierarchy}=await import('./lib/ppt-title-hierarchy.mjs'),{distinctPageTitles}=await import('./lib/ppt-page-titles.mjs');
 const card={planningContract:{version:3},generationPolicy:{version:2,language:{mode:'source',body:'both'}},inputUnderstanding:{primaryLanguage:'en'},source:{text:''}};
 const raw={slides:[{id:'a',title:'Cover'},{id:'b',title:'Factor Definitions'},{id:'c',title:'Factor Definitions (cont.)'}]};
 assert.equal(planTitleHierarchy(card,raw).slides[2].title,'Factor Definitions (cont.)');
 {const {normalizeTopicTitle}=await import('./lib/ppt-topic-language.mjs');assert.equal(normalizeTopicTitle('Financial ML Summary (3/5)','en'),'Financial ML Summary (3/5)');}
 // A record row's counter survives the hierarchy, which splits " / " as a language separator (live mlq-r39).
 assert.equal(planTitleHierarchy(card,{slides:[{id:'a',title:'Cover'},{id:'r',title:'Financial ML Summary (3/5)'}]}).slides[1].title,'Financial ML Summary (3/5)');assert.equal(distinctPageTitles(card,raw.slides).slides[2].title,'Factor Definitions (cont.)');
 // The shared rule every title step uses, page writing included (live fz-r37 p3).
 const {keepCardContinuation}=await import('./lib/ppt-topic-language.mjs');
 assert.equal(keepCardContinuation(true,'Factor Definitions (cont.)','Factor Definitions'),'Factor Definitions (cont.)');
 assert.equal(keepCardContinuation(true,'因子定义（续）','因子定义'),'因子定义（续）');
 assert.equal(keepCardContinuation(true,'Factor Definitions (cont.)','Factor Definitions (cont.)'),'Factor Definitions (cont.)','never twice');
 assert.equal(keepCardContinuation(false,'Factor Definitions (cont.)','Factor Definitions'),'Factor Definitions','other flows unchanged');
 assert.equal(keepCardContinuation(true,'A (cont.) | 甲（续）','A | 甲'),'A (cont.) | 甲','the primary half carries it');
 const legacy={...card,planningContract:undefined};assert.equal(distinctPageTitles(legacy,raw.slides).slides[2].title.includes('(cont.)'),false,'other flows still strip it');}
// A points-only card that splits keeps at least half of its characters and two
// points on the first page (Fable D6; live mlq-r38 kept "3" and "Trap" only).
{const {splitCardPage}=await import('./lib/ppt-outline-cards.mjs');
 const items=[{id:'u1',type:'TableBlock',text:'row'}],project={source:{semantic:{inventory:{items}}},inputUnderstanding:{primaryLanguage:'en'}};
 const point=(label,n)=>({text:label+' '+'x'.repeat(n),label,sourceUnitIds:['u1']});
 const raw={slides:[{id:'c',title:'Cover'},{id:'r',title:'Summary (3 / 5)',keyPoints:[point('Trap',55),point('Mechanism',468),point('Fix',454)],sourceUnitIds:['u1']}]};
 const split=splitCardPage(project,raw,1,{});assert.deepEqual(split.raw.slides.slice(1).map(s=>s.keyPoints.map(k=>k.label)),[['Trap','Mechanism'],['Fix']]);}
// The legacy pagination pass leaves a card deck's markers alone even with
// unfrozen titles (live fz/mlq-r42: "X (cont.)" lost as an "orphan" suffix).
{const {normalizePaginationTitles}=await import('./lib/ppt-deck-navigation.mjs');
 const pages=()=>[{id:'a',title:'Factor Definitions'},{id:'b',title:'Factor Definitions (cont.)'},{id:'c',title:'Summary (3/5)'}];
 const card={planningContract:{version:3},confirmedOutline:{titlesFrozen:false},outline:pages(),deck:{slides:pages().map(s=>({...s,nodes:[]}))}};
 normalizePaginationTitles(card);assert.deepEqual(card.deck.slides.map(s=>s.title),['Factor Definitions','Factor Definitions (cont.)','Summary (3/5)']);assert.equal(card.outline[1].title,'Factor Definitions (cont.)');
 const legacy={confirmedOutline:{titlesFrozen:false},outline:[{id:'b',title:'Factor Definitions (cont.)'}],deck:{slides:[{id:'b',title:'Factor Definitions (cont.)',nodes:[]}]}};
 normalizePaginationTitles(legacy);assert.equal(legacy.deck.slides[0].title,'Factor Definitions','other decks still drop an orphan suffix');
 // The final review catches the next pass that drops a marker (Fable 2026-10-26).
 const {inspectCardContinuations}=await import('./lib/ppt-card-pages.mjs');
 const deckOf=(...titles)=>({planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},outline:['Cover',...titles].map((title,k)=>({id:'s'+k,title})),deck:{slides:['Cover',...titles].map((title,k)=>({id:'s'+k,title,nodes:[]}))}});
 assert.deepEqual(inspectCardContinuations(deckOf('Factor Definitions','Factor Definitions')).map(i=>[i.code,i.slideId]),[['continuation_marker_missing','s2']],'the r42 shape fails the review');
 assert.deepEqual(inspectCardContinuations(card),[]);assert.deepEqual(inspectCardContinuations(deckOf('Factor Definitions','Factor Definitions (cont.)','Summary (3/5)','Summary (4/5)')),[],'markers and row counters pass');
 assert.deepEqual(inspectCardContinuations(deckOf('因子定义 | Factor Definitions','因子定义（续） | Factor Definitions (cont.)')),[],'a marked bilingual pair passes');
 assert.deepEqual(inspectCardContinuations({...deckOf('A','A'),planningContract:{version:2}}),[],'legacy decks are not checked');}
console.log('PASS card continuation: finished pages keep their frames (put back when a schedule moves them), pending pages follow the new schedule; outline compile keeps card continuation markers; a points split keeps half the characters.');

{const {commitContinuation,continuationRevision}=await import('./lib/ppt-outline-continuation.mjs');
 const before={status:'generating',planningContract:{version:3,flow:'cards'},outline:[{id:'a'},{id:'b'}],nodes:{a:{status:'done'},b:{status:'failed'}},trace:{stages:{'content:b':{status:'failed',error:'capacity_invalid'},'content:a':{status:'completed'}}},dagNodes:{'content:b':{status:'failed',error:'capacity_invalid',completedAt:'old'}}};
 const after=commitContinuation(before,{...before,outline:[...before.outline,{id:'b2'}]},{pageIds:['b','b2']},continuationRevision(before));
 assert.equal(after.nodes.b.status,'pending');assert.equal(after.trace.stages['content:b'].status,'pending');assert.equal(after.trace.stages['content:b'].error,null);
 assert.equal(after.dagNodes['content:b'].completedAt,null);assert.equal(after.runtime.capacityFailureHistory[0].error,'capacity_invalid');
 assert.equal(after.trace.stages['content:a'].status,'completed');assert.equal(before.trace.stages['content:b'].status,'failed','the original snapshot is immutable');
}

{const {repairCapacityBatch}=await import('./lib/ppt-card-capacity-preflight.mjs');
 let p={outline:[{id:'done'},{id:'b',over:true},{id:'d',over:true}],nodes:{done:{status:'done'},b:{status:'failed'},d:{status:'failed'}}};const order=[];
 const ok=await repairCapacityBatch({getProject:()=>structuredClone(p),needsRepair:(q,i)=>q.outline[i].over,repair:async id=>{
  order.push(id);p.outline.find(s=>s.id===id).over=false;p.nodes[id]={status:'pending'};
  if(id==='b'){p.outline.splice(2,0,{id:'b2',over:true});p.nodes.b2={status:'pending'};}return true;
 }});
 assert.equal(ok,true);assert.deepEqual(order,['b','d','b2'],'repair both original failures and remeasure the continuation before restarting');assert.equal(p.nodes.done.status,'done');
 p={outline:[{id:'x',over:true}],nodes:{x:{status:'failed'}}};let attempts=0;
 assert.equal(await repairCapacityBatch({getProject:()=>p,needsRepair:()=>true,repair:async()=>{attempts++;return true;},maxRepairs:3}),false,'unchanged failures cannot restart forever');assert.equal(attempts,3);
 assert.equal(await repairCapacityBatch({getProject:()=>p,repair:async()=>false}),false,'an unrecoverable page stops the wave');
}
console.log('PASS capacity recovery batch: all failures, child remeasurement, bounded non-progress and hard failures.');
