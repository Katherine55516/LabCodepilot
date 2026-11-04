// Card outline (planningContract.flow 'cards', after Gamma): per-topic card tasks,
// the deterministic checks that send a topic back once, the sanitizing that
// keeps a still-failing topic from failing the run, and the assembled outline.
import assert from 'node:assert/strict';
import {continuationTitle,stripSourceIds,stripInlineItems,cardTopicTask,cardTopicProblems,acceptCardTopic,sanitizeCardTopic,assembleCardOutline,numbersIn,cardsFlow,CARD_POINT_MAX,applyCardEdits,CARD_DENSITY,normalizeCardNumbers,cardHeightInches,cardLineBudget,splitCardPage,cardLayoutScore,missingCardPoints,pageVisibleText,fitSlotText,fitCardLabels,placeCardPoints,cardSlotPlan,applyCardSlotPlan} from './lib/ppt-outline-cards.mjs';
import {uncoveredSources,topicPageQuotas,assertPagePreference,editSemantic,publicLogicalOutline} from './lib/ppt-outline-first.mjs';
import {defaultGenerationPolicy} from './lib/ppt-generation-policy.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {selectionConstraints} from './lib/ppt-content-selection.mjs';

const items=[
 {id:'u1',type:'MechanismBlock',text:'Production runs on a pool of 2,000 weak alphas with IC about 0.02 to 0.05.',source_ref:['s1'],chunkRefs:['c1'],languagePairId:'lp1'},
 {id:'u2',type:'MechanismBlock',text:'生产依赖 2,000 个弱因子，单个 IC 约 0.02 至 0.05。',source_ref:['s1'],chunkRefs:['c1'],languagePairId:'lp1'},
 {id:'u3',type:'DefinitionBlock',text:'The look-elsewhere effect: the best of a million random formulas looks significant by chance.',source_ref:['s2'],chunkRefs:['c2']},
 {id:'u4',type:'EquationBlock',text:'IR grows with sqrt(N).',source_ref:['s3'],chunkRefs:['c3']},
 {id:'u5',type:'MechanismBlock',text:'Constrain the search space; fewer, better-motivated searches beat brute force.',source_ref:['s4'],chunkRefs:['c4']},
 {id:'u6',type:'CodeBlock',text:'def candidate_alpha(df): return df',source_ref:['s5'],chunkRefs:['c5']},
];
const card=(id,ids)=>({id,title:'Topic '+id+' | 主题'+id,titleSecondary:'',intent:'Why '+id+' matters',points:['p'],sourceUnitIds:ids,optionalSourceUnitIds:[],dependsOn:[],locked:false});
const policy={...defaultGenerationPolicy('x'),content:'overview',selection:'editorial',language:{mode:'source',body:'both'},code:{presentation:'omit'}};
const project={id:'c'.repeat(32),uid:'cards',generationPolicy:policy,templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),template:'light',
 source:{text:items.map(item=>item.text).join('\n\n'),sha256:'cards',segments:['s1','s2','s3','s4','s5'].map(id=>({id,text:items.filter(item=>item.source_ref.includes(id)).map(item=>item.text).join('\n\n')})),semantic:{inventory:{items,relationships:[]},chunks:[{id:'c1'},{id:'c2'},{id:'c3'},{id:'c4'},{id:'c5'}]}},originalSourceInventory:{items,relationships:[]},
 inputUnderstanding:{primaryLanguage:'en',readManifest:{status:'complete_delivery'}},
 planningContract:{version:3,flow:'cards',phase:'expanding',contentMode:'concise',pagePreference:{mode:'adaptive',target:4,max:6},logicalCards:[card('cover',[]),card('A',['u1','u2','u3','u4','u5','u6'])]}};
const estimate={availableHeightInches:5,unit:{u4:{heightInches:1.2,frozen:true}}};
assert.ok(cardsFlow(project));

// numbers as written: thousands separators removed, decimals kept
assert.deepEqual([...numbersIn('A pool of 2,000 alphas at 0.3–0.8, 10^6 trials')].sort(),['0.3','0.8','10','2000','6']);

// The task: exactly the quota, the topic's own units, policy-omitted code not offered.
const task=cardTopicTask(project,project.planningContract.logicalCards[1],2,estimate);
assert.deepEqual([task.schema.properties.pages.minItems,task.schema.properties.pages.maxItems],[2,2]);
assert.deepEqual(task.ids,['u1','u2','u3','u4','u5'],'code under code: omit is not offered');
assert.deepEqual(task.objectIds,['u4']);
const required=selectionConstraints(project).filter(rule=>task.ids.includes(rule.sourceUnitId)&&!rule.allowedDestinations.includes('excluded')).map(rule=>rule.sourceUnitId);
assert.deepEqual(task.requiredIds,required);
assert.ok(/English \| 中文/.test(task.prompt)&&!task.prompt.includes('def candidate_alpha'),'bilingual rule; omitted code not in the prompt');
assert.ok(task.prompt.includes(CARD_DENSITY.concise)&&!task.prompt.includes(CARD_DENSITY.detailed),'R2: the chosen density (condense)');
// Parallel points carry short labels; "process" is for ordered steps only; an
// uploaded template's picture assemblies are offered (Fable P3/P6, 2026-11-02).
assert.match(task.prompt,/at most 3 words/);assert.match(task.prompt,/"process" only for steps a reader follows in order/);
assert.equal(task.assemblyOffered,undefined,'no template, no assembly hint');
{const IN=914400,pic=(id,x)=>({type:'image',id:'i'+id,nativeRef:{shapeId:id},geometry:{x,y:IN,width:2*IN,height:2*IN},content:{mediaRole:'old_template_content'}}),label=(id,x)=>({type:'text',id:'t'+id,nativeRef:{shapeId:id},geometry:{x,y:3.2*IN,width:2*IN,height:.4*IN},content:{text:'Captures ideas visually'}});
 const spec={nodes:[pic(1,IN),pic(2,IN),label(3,IN),label(4,3.1*IN)],slots:[{shapeId:3,role:'content',purpose:'label'},{shapeId:4,role:'content',purpose:'label'}]};
 const {templateAssemblyHints}=await import('./lib/ppt-template-assemblies.mjs'),size={mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[spec]};
 const hints=templateAssemblyHints(size);
 assert.deepEqual(hints,[{parts:2,chars:23}]);
 const offered=cardTopicTask({...project,templateFidelity:size},project.planningContract.logicalCards[1],2,estimate);assert.deepEqual(offered.assemblyOffered,[2]);assert.match(offered.prompt,/picture layout of 2 labelled parts \(labels of about 23 characters\)/);}
for(const mode of ['standard','detailed'])assert.ok(cardTopicTask({...project,planningContract:{...project.planningContract,contentMode:mode}},project.planningContract.logicalCards[1],2,estimate).prompt.includes(CARD_DENSITY[mode]));
assert.deepEqual(Object.keys(task.schema.properties.pages.items.properties),['title','numbered','visualIntent','points','objects'],'a card is a title and its content; no reader purpose');

let pageTitles=0;const titles=['A pool of weak alphas | 弱因子池','Better-motivated search | 更有动机的搜索','Looking elsewhere | 别处寻找','Weak signals combined | 弱信号组合'];
const pageTitle=k=>titles[k]??`Weak alpha view ${String.fromCharCode(65+(k-titles.length)%26)}${'x'.repeat(Math.floor((k-titles.length)/26))}`;
const page=(points,objects=[],extra={})=>({title:pageTitle(pageTitles++),numbered:false,visualIntent:'text',points,objects,...extra});
const good={pages:[
 page([{text:'Production combines 2,000 weak alphas, IC about 0.02–0.05 | 生产组合 2,000 个弱因子',sourceUnitIds:['u1','u2']},{text:'The look-elsewhere effect: the best of many random formulas looks significant by chance',sourceUnitIds:['u3']}]),
 page([{text:'Fewer, better-motivated searches beat brute force | 更少但动机更充分的搜索胜过蛮力',sourceUnitIds:['u5']}],['u4']),
]};
assert.deepEqual(cardTopicProblems(project,task,good,estimate),[]);
assert.deepEqual(acceptCardTopic(project,task,good,estimate),good);
const kinds=reply=>cardTopicProblems(project,task,reply,estimate).map(problem=>problem.kind);
assert.ok(kinds({pages:[good.pages[0]]}).includes('count'),'the card count is fixed');
// Fable D12 (2026-10-23): an unknown unit goes back; another topic's unit or a
// unit on two cards is listed, not sent back.
assert.ok(kinds({pages:[good.pages[0],page([{text:'Brute force loses',sourceUnitIds:['u9']}])]}).includes('citation'),'only units of the source');
assert.ok(kinds({pages:[good.pages[0],page([{text:'Again the pool',sourceUnitIds:['u1']}])]}).includes('duplicate_soft'),'a unit on two cards is a note');
assert.doesNotThrow(()=>acceptCardTopic(project,task,{pages:[good.pages[0],page([{text:'Again the pool',sourceUnitIds:['u1']}],['u4'])]},estimate),'and is not sent back');
assert.ok(kinds({pages:[good.pages[0],page([{text:'IC reaches 0.08 in sample',sourceUnitIds:['u5']}])]}).includes('number'),'a number the cited unit does not state');
assert.ok(kinds({pages:[good.pages[0],page([],[])]}).includes('empty'));
assert.ok(kinds({pages:[good.pages[0],page([{text:'See b_0123 for details',sourceUnitIds:['u5']}])]}).includes('text'),'no source IDs in reader text');
if(required.length)assert.ok(kinds({pages:[page([{text:'Production combines weak alphas',sourceUnitIds:['u1']}]),page([{text:'Fewer searches',sourceUnitIds:['u5']}])]}).includes('required_soft'),'an uncited required unit is listed');
const long=page(Array.from({length:8},(_,k)=>({text:'A long explanation of the search process and its many parts. '.repeat(4).slice(0,CARD_POINT_MAX),sourceUnitIds:[k?'u5':'u1']})).map((point,k)=>k?{...point,sourceUnitIds:['u5']}:point));
const fitProblems=cardTopicProblems(project,task,{pages:[long,good.pages[1]]},{...estimate,availableHeightInches:1});
assert.ok(fitProblems.some(problem=>problem.kind==='fit'),'a card that does not fit is sent back: '+JSON.stringify(fitProblems.map(p=>p.kind)));
// A small overrun is listed, not sent back (1a1631c4: eight of ten corrections were fit).
{const tall=Math.max(...good.pages.map(page=>cardHeightInches(project,page,estimate))),near={...estimate,availableHeightInches:tall/1.2},far={...estimate,availableHeightInches:tall/2};
 assert.ok(cardTopicProblems(project,task,good,near).some(problem=>problem.kind==='fit_soft'));assert.doesNotThrow(()=>acceptCardTopic(project,task,good,near),'20% over: kept');
 assert.ok(cardTopicProblems(project,task,good,far).some(problem=>problem.kind==='fit'));assert.throws(()=>acceptCardTopic(project,task,good,far),'twice the space: sent back');
 assert.ok(sanitizeCardTopic(project,task,good,near).advisories.some(advisory=>advisory.code==='card_fit'),'listed for review');
 const lines=cardLineBudget(project,estimate);assert.ok(lines>=3&&task.prompt.includes(`about ${lines} lines of text`),'the prompt states the line budget: '+lines);}
assert.throws(()=>acceptCardTopic(project,task,{pages:[good.pages[0]]},estimate),error=>error.code==='planning_contract_invalid'&&error.details.problems.length&&/Write exactly 2 cards/.test(error.message));

// Sanitizing a reply still failing after its correction: a valid outline, problems listed.
const messy={pages:[
 page([{text:'Production combines weak alphas b_0001',sourceUnitIds:['u1','u2','u9']}]),
 page([{text:'Again the pool',sourceUnitIds:['u1']},{text:'IC reaches 0.08',sourceUnitIds:['u5']}]),
 page([],['u4']),
]};
const sanitized=sanitizeCardTopic(project,task,messy,estimate);
assert.equal(sanitized.reply.pages.length,3,'the cards are kept as written; the count is listed');
assert.ok(!JSON.stringify(sanitized.reply).includes('u9')&&!/b_\d{3,}/.test(JSON.stringify(sanitized.reply.pages.map(p=>p.points))),'unknown citations and IDs in text removed');
const citedTwice=sanitized.reply.pages.flatMap(p=>p.points.flatMap(point=>point.sourceUnitIds)).filter(id=>id==='u1');
assert.equal(citedTwice.length,2,'a unit on two cards stays on both');
assert.ok(sanitized.advisories.some(a=>a.code==='card_count'),'the count is listed for review');
assert.ok(sanitized.advisories.some(a=>a.code==='card_point_dropped'),'a point with a number the source does not state is left out and listed (publication would refuse it)');
assert.ok(!cardTopicProblems(project,task,sanitized.reply,estimate).some(p=>p.kind==='number'),'no unsupported number remains');
assert.deepEqual(cardTopicProblems(project,task,sanitized.reply,estimate).filter(p=>!['number','fit','count'].includes(p.kind)&&!/_soft$|number_cite/.test(p.kind)),[],'structurally valid after sanitizing');
const empty=sanitizeCardTopic(project,task,null,estimate);
assert.ok(empty.reply.pages.length>=1&&empty.reply.pages.length<=2&&empty.advisories.some(a=>a.code==='card_topic_excerpts'),'no usable reply: source excerpts, never a failure');

// The assembled outline: cover first, cards in narrative order, points as keyPoints with refs.
const raw=assembleCardOutline(project,[task],[{pages:[good.pages[0],{...good.pages[1],numbered:true}]}]);
assert.equal(raw.version,2);assert.equal(raw.slides.length,3);assert.equal(raw.slides[0].role,'cover');assert.equal(raw.slides[2].numberedPoints,undefined,'its point is not from a source list: not numbered (Fable)');assert.equal(raw.notes[0].code,'card_numbering_dropped');assert.equal(raw.slides[1].numberedPoints,undefined);assert.equal(raw.slides[1].focus,raw.slides[1].title,'no separate reader focus');assert.deepEqual(raw.slides[0].sourceUnitIds,[]);
assert.deepEqual(raw.slides[1].sourceUnitIds,['u1','u2','u3']);assert.deepEqual(raw.slides[2].sourceUnitIds,['u4','u5'],'objects and cited units, in source order');
assert.deepEqual(raw.slides[2].cardObjects,['u4']);
// A topic's second card under the same title continues the first (live fz-r32 p3).
{const same=assembleCardOutline(project,[task],[{pages:[good.pages[0],{...good.pages[1],title:good.pages[0].title}]}]);
 assert.equal(same.slides[2].title,good.pages[0].title.split(' | ').length>1?same.slides[2].title:`${good.pages[0].title} (cont.)`);assert.match(same.slides[2].title,/\(cont\.\)/u);
 assert.ok(same.notes.some(note=>note.code==='card_title_continued'));}
assert.deepEqual(raw.slides[1].keyPoints[0],{text:good.pages[0].points[0].text,refs:['s1'],chunkRefs:['c1'],sourceUnitIds:['u1','u2']});
assert.equal(raw.selection,undefined,'no per-unit selection ledger');
assert.notEqual(raw.slides[1].id,raw.slides[2].id);

// Publishing a card deck: obligations are writer hints (a miss is a warning), and
// the per-unit ledger gate does not apply; the writer is held to the card points.
{const {finalQualityReport}=await import('./lib/ppt-quality.mjs'),{writerPrompt}=await import('./lib/ppt-prompt-contracts.mjs');
 const missed={evaluation:'evaluated',obligationAudit:{checks:[{obligationId:'o1',status:'missing',evidence:[]}]},missing:[],repeated:[],conflicts:[],unsupported:[]};
 const cardReport=finalQualityReport({hardErrors:0,issues:[],cardOutline:true},[],missed),ledgerReport=finalQualityReport({hardErrors:0,issues:[]},[],missed);
 assert.equal(cardReport.publishEligible,true,'a missed obligation does not block a card deck');
 assert.ok(cardReport.modelIssues.some(item=>item.code==='mandatory_content_missing'&&item.severity==='warning'),'still reported for review');
 assert.equal(ledgerReport.publishEligible,false,'the ledger path keeps obligations as a gate');
 const {deterministicReview}=await import('./lib/ppt-quality.mjs'),omitted=[{id:'u6',type:'CodeBlock',text:'def f(): pass',presentation:'omitted_by_policy',source_ref:['s5']}];
// R6: an explanation obligation that is not visible is a review note on a card
// deck and still an error elsewhere (3143, 3285aa5a page 3).
 {const text='Production combines many weak alphas.';const obligationItems=[{id:'o1',type:'MechanismBlock',text},{id:'o2',type:'MechanismBlock',text:'Combined IR grows with breadth.'}];
  const obligation={label:'Pool combination enables weak-alpha model',sourceUnitIds:['o1','o2'],triggerSourceUnitIds:['o1'],relationType:'dependency',placement:'same_page',evidence:[{sourceUnitId:'o1',start:0,end:text.length,quote:text},{sourceUnitId:'o2',start:0,end:obligationItems[1].text.length,quote:obligationItems[1].text}]};
  const deckOf=flow=>({id:'x',generationPolicy:policy,planningContract:flow==='cards'?{version:3,flow}:undefined,inputUnderstanding:{explanationObligations:[obligation]},source:{text:'',semantic:{inventory:{items:obligationItems,relationships:[]}}},outline:[{id:'s1',sourceUnitIds:['o1','o2']}],planning:{slidePlan:[{slideId:'s1',sourceUnitIds:['o1','o2']}]},deck:{slides:[{id:'s1',title:'Pool',nodes:[]}]}});
  const severity=flow=>deterministicReview(deckOf(flow)).issues.find(issue=>issue.code==='explanation_obligation_not_visible')?.severity;
  assert.deepEqual([severity('cards'),severity('legacy')],['warning','error']);}
 const ledgerGate=flow=>deterministicReview({id:'x',generationPolicy:policy,planningContract:flow==='cards'?{version:3,flow}:undefined,source:{text:'',semantic:{inventory:{items:omitted,relationships:[]}}},outline:[],deck:{slides:[]}}).issues.some(issue=>issue.code==='notes_disposition_ledger_missing');
 assert.equal(ledgerGate('cards'),false,'no per-unit ledger is required of a card outline');assert.equal(ledgerGate('legacy'),true,'a legacy outline keeps its ledger gate');
 const outlined={...project,outline:raw.slides,deck:{slides:[]}},prompt=writerPrompt(outlined,raw.slides[1],1,{});
 assert.ok(prompt.includes('reviewed outline card')&&prompt.includes(JSON.stringify(good.pages[0].points[0].text)),'the writer is given the card points as its content');
 assert.ok(!prompt.includes('ordered steps')&&writerPrompt(outlined,{...raw.slides[2],numberedPoints:true},2,{}).includes('ordered steps: keep them as one numbered list'),'numbered cards stay numbered');
 assert.ok(!prompt.includes('point holder'),'no template guidance without a template');
 {let templated='';try{templated=writerPrompt({...outlined,templateFidelity:{mode:'preserve',slides:raw.slides.map(()=>({nodes:[],slots:[]}))}},raw.slides[1],1,{});}catch(error){templated=String(error.message);}
  assert.ok(templated.includes('every card point fills one point holder')&&templated.includes('never a summary'),'on a template every point fills a holder: '+templated.slice(0,200));}
 assert.ok(!writerPrompt({...outlined,planningContract:undefined},raw.slides[1],1,{}).includes('reviewed outline card'),'a legacy page has no card rule');}
// The card count is soft (R1): no authorization gate; a smaller count takes
// pages from the topic left least dense, never below one card per topic.
{const two={...project,planningContract:{...project.planningContract,logicalCards:[card('cover',[]),card('A',['u1','u2','u3']),card('B',['u4','u5'])]}};
 const measured={modes:{concise:{byCard:[{logicalCardId:'A',pages:3,heightInches:12},{logicalCardId:'B',pages:2,heightInches:5}]}}};
 const quotas=pref=>topicPageQuotas({...two,planningContract:{...two.planningContract,pagePreference:pref}},measured).map(q=>q.quota);
 assert.deepEqual(quotas({mode:'adaptive',max:100}),[2,2],'auto: the measured need, at most one card per atom');
 assert.deepEqual(quotas({mode:'fixed',exact:4}),[2,1],'one card fewer: the lighter topic gives it up');
 assert.deepEqual(quotas({mode:'fixed',exact:3}),[1,1],'never below one card per topic');
 assert.deepEqual(quotas({mode:'adaptive',max:3}),[1,1]);
 assert.doesNotThrow(()=>assertPagePreference(two,40),'no page authorization for cards');
 const legacy={...two,planningContract:{...two.planningContract,version:undefined}};assert.throws(()=>assertPagePreference(legacy,40),'a legacy plan keeps its limits');}
// No topic locks: an edit cannot lock a topic and the public outline has no lock.
{const contract={...project.planningContract,phase:'semantic_ready',logicalCards:[{...card('cover',[]),locked:true},card('A',['u1'])]};
 const edited=editSemantic({...project,planningContract:contract},contract.logicalCards.map(c=>({...c,locked:true,title:c.title+' edited'})));
 assert.ok(edited.logicalCards.every(c=>!('locked' in c))&&edited.logicalCards[0].title.endsWith('edited'),'a formerly locked topic is edited, nothing is locked');
 assert.ok(publicLogicalOutline({planningContract:edited}).every(c=>!('locked' in c)));}
// Figure metadata belongs to the server, not the client edit payload. Moving
// or renaming a figure page keeps its image; deleting it removes only that page.
{const [cover,body]=raw.slides;
 const figure={id:'figure-page-test',title:'Figure',figurePage:true,restoredFrom:body.id,sourceImageIds:['figure-test'],keyPoints:[],cardObjects:[],sourceUnitIds:[]};
 const p={...project,outline:[cover,body,figure]};
 const c={id:cover.id,title:cover.title,points:[]},b={id:body.id,title:body.title,points:body.keyPoints.map(point=>point.text)},f={id:figure.id,title:'Renamed figure',points:[]};
 const moved=applyCardEdits(p,[c,f,b]);
 assert.deepEqual(moved.slides[1].sourceImageIds,['figure-test']);assert.equal(moved.slides[1].figurePage,true);assert.equal(moved.slides[1].restoredFrom,body.id);
 const removed=applyCardEdits(p,[c,b]);assert.ok(!removed.slides.some(slide=>slide.id===figure.id));assert.equal(removed.summary.removed,1);
}
// The author's edits: kept points keep their sources, the author's text is
// marked as such, a new card has no sources, a deleted card's sources leave.
{const edited={...project,outline:raw.slides.map((slide,index)=>({...slide,...(index===2?{numberedPoints:true}:{}),titlePair:{primary:slide.title,secondary:'副标题'},titleSecondary:'副标题'}))};
 const [cover,first,second]=edited.outline;
 const result=applyCardEdits(edited,[
  {id:cover.id,title:cover.title,points:[]},
  {id:second.id,title:second.title,points:[second.keyPoints[0].text],numbered:false},
  {title:'Why this matters to us',points:['Our desk trades only liquid names','  ']},
  {id:first.id,title:'A pool of weak alphas, rewritten',points:[first.keyPoints[0].text,'An extra point in my own words']},
 ]);
 const [c0,c1,c2,c3]=result.slides;
 assert.deepEqual([c0.id,c1.id,c3.id],[cover.id,second.id,first.id],'the new order');
 assert.equal(second.numberedPoints,true);assert.equal(c1.numberedPoints,undefined);assert.equal(c1.authorEdited,true,'numbering changed');assert.deepEqual(c1.titlePair,second.titlePair,'an unchanged title keeps its pair');
 assert.deepEqual(c1.keyPoints[0],second.keyPoints[0],'an unchanged point keeps its sources');
 assert.deepEqual({sources:c2.sourceUnitIds,points:c2.keyPoints.map(point=>[point.text,point.author])},{sources:[],points:[['Our desk trades only liquid names',true]]},'a new card: the author\'s text, no sources, blank points dropped');
 assert.equal(c3.titlePair,undefined,'a changed title replaces the generated pair');assert.equal(c3.titleSecondary,undefined);
 assert.deepEqual(c3.keyPoints.map(point=>Boolean(point.author)),[false,true]);assert.deepEqual(c3.keyPoints[0].sourceUnitIds,first.keyPoints[0].sourceUnitIds);
 assert.deepEqual(result.summary,{edited:2,added:1,removed:0,omittedSourceUnitIds:[]});
 const dropped=applyCardEdits(edited,[{id:cover.id,title:cover.title,points:[]},{id:first.id,title:first.title,points:first.keyPoints.map(point=>point.text)}]);
 assert.deepEqual(dropped.summary.omittedSourceUnitIds,second.sourceUnitIds,'a deleted card takes its sources out of the deck');assert.equal(dropped.slides[1].authorEdited,undefined,'an untouched card is not marked');
 // Point headings (report b813b4d3): sent headings replace the point's label ('' removes it), a blank point leaves with its
 // heading, a changed heading marks the card edited; without headings an unchanged point keeps its own.
 {const labelled={...edited,outline:edited.outline.map((slide,index)=>index===1?{...slide,keyPoints:slide.keyPoints.map((point,k)=>({...point,label:'Label '+k}))}:slide)},one=labelled.outline[1],texts=one.keyPoints.map(point=>point.text);
  const kept=applyCardEdits(labelled,[{id:cover.id,title:cover.title,points:[]},{id:one.id,title:one.title,points:texts}]).slides[1];
  assert.deepEqual([kept.keyPoints.map(point=>point.label),kept.authorEdited],[texts.map((_,k)=>'Label '+k),undefined],'no headings sent: labels kept, card untouched');
  const renamed=applyCardEdits(labelled,[{id:cover.id,title:cover.title,points:[]},{id:one.id,title:one.title,points:[texts[0],'  ',...texts.slice(1)],labels:[' My heading ','orphan',...texts.slice(1).map(()=>'')]}]).slides[1];
  assert.deepEqual([renamed.keyPoints.map(point=>point.label),renamed.authorEdited],[['My heading',...texts.slice(1).map(()=>undefined)],true],'sent headings replace labels; a blank point takes its heading with it');
  assert.throws(()=>applyCardEdits(labelled,[{id:cover.id,title:cover.title,points:[]},{id:one.id,title:one.title,points:texts,labels:['x'.repeat(41)]}]),error=>error.code==='planning_contract_invalid','a heading is at most 40 characters');}
 for(const bad of [[{id:first.id,title:'x',points:[]},{id:cover.id,title:'y',points:[]}],[{id:cover.id,title:cover.title},{id:'page_unknown',title:'x'}],[{id:cover.id,title:cover.title},{title:''}],[{id:cover.id,title:cover.title},{title:'x',points:Array(11).fill('p')}],[{id:cover.id,title:cover.title}]])
  assert.throws(()=>applyCardEdits(edited,bad),error=>error.code==='planning_contract_invalid',JSON.stringify(bad).slice(0,80));
 const {writerPrompt}=await import('./lib/ppt-prompt-contracts.mjs'),authored={...project,outline:result.slides,deck:{slides:[]}};
 assert.ok(writerPrompt(authored,c2,2,{}).includes("the author's own words: show each exactly as written"),'the author\'s text is shown as written');
 assert.ok(!writerPrompt(authored,c1,1,{}).includes("author's own words"));
 const {finalQualityReport}=await import('./lib/ppt-quality.mjs');
 const claim={evaluation:'evaluated',claimAudit:{checks:[{claimId:'k',slideId:c2.id,nodeId:'n',status:'unsupported',reason:'Not in the source.'}]},missing:[],repeated:[],conflicts:[],unsupported:[]};
 assert.equal(finalQualityReport({hardErrors:0,issues:[],cardOutline:true,authorEditedSlideIds:[c2.id]},[],claim).publishEligible,true,'an unsupported claim on an author-edited card is a warning');
 // F8/F11 (2026-10-23): on a card deck any model finding is a review note;
 // the same finding still blocks a deck of the older flows.
 const noted=finalQualityReport({hardErrors:0,issues:[],cardOutline:true,authorEditedSlideIds:[]},[],claim);
 assert.equal(noted.publishEligible,true,'a card deck publishes with the finding listed');assert.ok(noted.modelIssues.some(issue=>issue.reviewNote&&issue.severity==='warning'));
 assert.equal(finalQualityReport({hardErrors:0,issues:[],cardOutline:false,authorEditedSlideIds:[]},[],claim).publishEligible,false,'elsewhere it still blocks');
 assert.equal(finalQualityReport({hardErrors:0,issues:[],cardOutline:true,authorEditedSlideIds:[]},[],{evaluation:'not_evaluated',missing:[],repeated:[],conflicts:[],unsupported:[]}).publishEligible,true,'a card deck needs no model review to publish');}
// Numbers the model writes into points belong to the card (seen on 1a1631c4: "1. 1.").
{const numberedPage=normalizeCardNumbers({title:'Steps',numbered:false,points:[{text:'1. Generate candidates | 1. 生成候选',sourceUnitIds:['u1']},{text:'(2) Mask the data | （2）数据掩码',sourceUnitIds:['u2']},{text:'③ Neutralize | 三、中性化',sourceUnitIds:['u3']}]});
 assert.equal(numberedPage.numbered,true);assert.deepEqual(numberedPage.points.map(point=>point.text),['Generate candidates | 生成候选','Mask the data | 数据掩码','Neutralize | 中性化']);
 const plain={title:'Facts',numbered:false,points:[{text:'2,000 weak alphas',sourceUnitIds:['u1']},{text:'IC about 0.02',sourceUnitIds:['u1']}]};assert.equal(normalizeCardNumbers(plain),plain,'a number that is content stays');
 assert.deepEqual(normalizeCardNumbers({...plain,numbered:true,points:[{text:'10. Tenth step'}]}).points[0].text,'Tenth step');
 assert.deepEqual(acceptCardTopic(project,task,{pages:[good.pages[0],{...good.pages[1],numbered:true,points:[{...good.pages[1].points[0],text:'1. '+good.pages[1].points[0].text}]}]},estimate).pages[1].points[0].text,good.pages[1].points[0].text,'accepted replies are normalized');}
// R3 coverage report: passages on no card (a translation partner on a card covers it; policy-omitted code is covered).
assert.equal(uncoveredSources({...project,outline:[{sourceUnitIds:[]},{sourceUnitIds:['u1']}]}),3,'u3, u4, u5; u2 is u1\'s translation, u6 is omitted code');
// A card page on a template layout with more text slots than points: the empty
// slots are omitted (an empty heading/description pair together; a half-filled
// pair is left to the slot check). Found on 3143 (1a1631c4, page 8).
{const fsm=await import('node:fs'),osm=await import('node:os'),pathm=await import('node:path');
 process.env.COWORK_STATE_DIR||=fsm.mkdtempSync(pathm.join(osm.tmpdir(),'ppt-cards-omit-'));
 const {_internals}=await import('./lib/ppt-api.mjs');
 const node=id=>({id:'n'+id,type:'text',nativeRef:{shapeId:id},content:{text:'sample'},geometry:{x:0,y:0,width:100,height:100}});
 const slots=[{shapeId:4,role:'title',capacity:40},{shapeId:5,role:'content',capacity:80},{shapeId:6,role:'content',capacity:80},{shapeId:7,role:'content',capacity:80},{shapeId:8,role:'content',capacity:40,purpose:'group-heading'},{shapeId:9,role:'content',capacity:80,pairedWith:8}];
 const cardPage=[{id:'s1',title:'Steps',keyPoints:[{text:'one',refs:[]},{text:'two',refs:[]}],sourceUnitIds:[]}];
 const omitted=(flow,slotTexts)=>_internals.normalizeSlide({title:'Steps',slotTexts,contentBlocks:[],blocks:[]},cardPage[0],{id:'x',templateFidelity:{mode:'preserve',slides:[{nodes:[4,5,6,7,8,9].map(node),slots}]},outline:cardPage,planningContract:flow==='cards'?{version:3,flow}:undefined,generationPolicy:{version:2,language:{mode:'source',body:'primary'}},source:{text:'',semantic:{inventory:{items:[]}}}},[]).templateOmissions.map(item=>item.shapeId);
 assert.deepEqual(omitted('cards',{'4':'Steps','5':'one','6':'two'}),[7,8,9]);
 assert.deepEqual(omitted('cards',{'4':'Steps','5':'one','6':'two','8':'A heading'}),[7],'a half-filled pair stays for the slot check');
 assert.deepEqual(omitted('legacy',{'4':'Steps','5':'one','6':'two'}),[],'a legacy page still fills its slots');}
// A card page's density was chosen in the outline: the layout's fill targets
// (point groups, sparse copy) do not apply (3143, 1a1631c4 page 7: 1 of 4 groups).
{const {inspectTemplateSlotDraft}=await import('./lib/ppt-template-fidelity.mjs');
 const slots=[{shapeId:4,role:'title',capacity:60},...[5,6,7,8].map(id=>({shapeId:id,role:'content',purpose:'body',capacity:60,groupId:id}))];
 const spec={nodes:[4,5,6,7,8].map((id,k)=>({id:'n'+id,type:'text',nativeRef:{shapeId:id},content:{text:'sample'},geometry:{x:0,y:k*900000,width:9000000,height:800000}})),slots};
 const issuesFor=flow=>inspectTemplateSlotDraft({templateFidelity:{mode:'preserve',slides:[spec,spec,spec]},pages:3,outline:[{id:'a'},{id:'b'},{id:'c'}],planningContract:flow==='cards'?{version:3,flow}:undefined,planning:{slidePlan:[{slideId:'b',templatePointTarget:4}]}},1,{id:'b',title:'Operator algebra',templateSlotTexts:{'4':'Operator algebra','5':'Fields, operators and the search space in one short paragraph.'},templateOmissions:[6,7,8].map(shapeId=>({shapeId,reason:'The card has fewer points than this layout has text slots.',automatic:true}))}).map(issue=>issue.code);
 assert.ok(!issuesFor('cards').includes('template_point_coverage'),JSON.stringify(issuesFor('cards')));
 assert.ok(issuesFor('legacy').includes('template_point_coverage'),'a legacy page keeps its fill target');
 // the writer's own content blocks are not checked against a planned card page's shortened slots
 const blocksFor=flow=>inspectTemplateSlotDraft({templateFidelity:{mode:'preserve',slides:[spec,spec,spec]},pages:3,outline:[{id:'a'},{id:'b',keyPoints:[{text:'Fields and operators'}],cardObjects:[]},{id:'c'}],planningContract:flow==='cards'?{version:3,flow}:undefined},1,{id:'b',title:'Operator algebra',templateSlotTexts:{'4':'Operator algebra','5':'Fields and operators'},copy:{blocks:[{body:'A long explanation the writer kept as a separate block, never shown in any template slot on this page.'}]}}).map(issue=>issue.code);
 assert.ok(!blocksFor('cards').includes('template_content_unrendered')&&blocksFor('legacy').includes('template_content_unrendered'));}
// A card page too long for its page continues on a second page, by code
// (3143, 3285aa5a page 3: a taxonomy object and six points, 5.9 of 5.5 in).
{const two=splitCardPage(project,raw,1);
 assert.equal(two.raw.slides.length,raw.slides.length+1);assert.deepEqual(two.change.pageIds,[raw.slides[1].id,two.raw.slides[2].id],'the first part keeps the page id');
 assert.deepEqual(two.raw.slides.slice(1,3).map(slide=>slide.keyPoints.map(point=>point.text)),[[good.pages[0].points[0].text],[good.pages[0].points[1].text]],'points keep their order');
 assert.deepEqual(two.raw.slides.slice(1,3).map(slide=>slide.sourceUnitIds),[['u1','u2'],['u3']],'each part cites its own units');
 assert.equal(two.raw.slides[2].title,'A Pool of Weak Alphas (cont.) | 弱因子池（续）','each half marked in its own language (Fable r19 B)');assert.ok(two.raw.slides[2].id!==raw.slides[1].id);
 assert.equal(continuationTitle('总结 | Summary','zh'),'总结（续） | Summary (cont.)');assert.equal(continuationTitle('Stambaugh-Yuan Mispricing | Stambaugh-Yuan 错误定价因子','en'),'Stambaugh-Yuan Mispricing (cont.) | Stambaugh-Yuan 错误定价因子（续）','a Chinese half naming a Latin name is still Chinese (fz-r25 p14)');
 // A record table becomes one page per row; the card's two points join the last row page (Fable plan T17).
 {const rowPages=[1,2,3].map(n=>({title:`Common Mistakes (${n}/3)`,points:[{text:`Trap ${n}`,sourceUnitIds:['u4']},{text:`Mechanism ${n} explained`,label:'Mechanism',sourceUnitIds:['u4']},{text:`Fix ${n} explained`,label:'Fix',sourceUnitIds:['u4']}]}));
  const recordRaw=structuredClone(raw);recordRaw.slides[1]={...recordRaw.slides[1],title:'Common Mistakes',cardObjects:['u4'],keyPoints:recordRaw.slides[1].keyPoints.slice(0,2)};
  const rows=splitCardPage(project,recordRaw,1,{rowPages});
  assert.deepEqual(rows.raw.slides.slice(1,4).map(slide=>[slide.title,slide.keyPoints.length,(slide.cardObjects||[]).length]),[['Common Mistakes (1/3)',3,0],['Common Mistakes (2/3)',3,0],['Common Mistakes (3/3)',5,0]]);
  assert.equal(rows.raw.slides[1].keyPoints[1].label,'Mechanism');}
 assert.equal(splitCardPage({...project,templateFidelity:{mode:'preserve',slides:[{},{slots:[{role:'title',shapeId:1}],nodes:[]}]}},raw,1,{beforeSchedule:true})?.raw.slides[2].title,'A Pool of Weak Alphas (cont.) | 弱因子池（续）','before scheduling the marker is always written (Fable plan T34)');assert.equal(continuationTitle('Horizon Choice (cont.) | 期限选择 (cont.)（续）','en'),'Horizon Choice (cont.) | 期限选择（续）','idempotent; a wrong marker is replaced (Fable r19 K)');assert.equal(continuationTitle('Summary | 总结','en',()=>false),'Summary | 总结（续）','an unfit primary stays unmarked');
 const object=splitCardPage(project,raw,2);
 assert.deepEqual(object.raw.slides.slice(2,4).map(slide=>[slide.sourceUnitIds,slide.keyPoints.length]),[[['u4'],0],[['u5'],1]],'the object stays, the point moves');
 assert.equal(splitCardPage(project,raw,0),null,'never the cover');
 assert.equal(splitCardPage(project,{slides:[raw.slides[0],{...raw.slides[1],keyPoints:[raw.slides[1].keyPoints[0]],sourceUnitIds:['u1','u2']}]},1),null,'one point and no object cannot split');}
// Option 1 (confirmed 2026-10-22): a card page takes the template layout whose
// point holders fit its points; the writer shortens each point into a holder;
// every point must be visible on the page.
{const pair=(heading,description,capacity=80)=>[{shapeId:heading,role:'content',purpose:'point-heading',capacity:12,groupId:heading},{shapeId:description,role:'content',purpose:'point-description',capacity,pairedWith:heading,groupId:heading}];
 const layouts={three:[{shapeId:4,role:'title',capacity:30},...pair(5,6),...pair(7,8),...pair(9,10)],one:[{shapeId:4,role:'title',capacity:30},{shapeId:5,role:'content',purpose:'body',capacity:200}],list:[{shapeId:4,role:'title',capacity:30},{shapeId:5,role:'content',purpose:'list',capacity:240,paragraphCount:4}]};
 const pointText=k=>`Point ${k}: a short claim about weak alphas | 要点${k}：弱因子`;
 const deckOf=(layout,points,extra={})=>({templateFidelity:{slides:[{slots:[]},{slots:layouts[layout]}],slideMap:[0,1]},outline:[{id:'c'},{id:'p',keyPoints:points.map(k=>({text:pointText(k)})),cardObjects:[],...extra}],source:{semantic:{inventory:{items:[{id:'t1',rows:[['a']]}]}}}});
 assert.equal(cardLayoutScore(deckOf('three',[1,2,3]),1),0,'three points, three pairs: fits');
 assert.ok(cardLayoutScore(deckOf('one',[1,2,3]),1)>=2000,'three points on one body: they would merge');
 assert.equal(cardLayoutScore(deckOf('three',[1]),1),300,'one point on three pairs: two spare holders');
 assert.equal(cardLayoutScore(deckOf('list',[1,2,3,4]),1),0,'a four-item list holds four points');
 assert.ok(cardLayoutScore(deckOf('three',[1,2,3]),1)<cardLayoutScore(deckOf('one',[1,2,3]),1));
 assert.equal(cardLayoutScore(deckOf('three',[1,2],{cardObjects:['t1']}),1),null,'a page with an object is fitted by its measured overflow');
 assert.equal(cardLayoutScore(deckOf('three',[1,2,3]),0),null,'never the cover');
 const repeat=deckOf('three',[1,2,3]);repeat.templateFidelity.slides.push({slots:layouts.three});repeat.templateFidelity.slideMap=[0,1,1];repeat.outline.push({...repeat.outline[1],id:'q'});
 assert.equal(cardLayoutScore(repeat,2),60,'repeating the previous layout costs a little');
 // every point visible: shortened is fine, missing is listed, the author's point nearly as written
 const page={keyPoints:[{text:'Production combines 2,000 weak alphas with IC about 0.02-0.05 | 生产组合 2,000 个弱因子'},{text:'Brute-force search finds noise that looks significant | 穷举搜索会找到看似显著的噪声'},{text:'Keep this exactly as I wrote it',author:true}]};
 const written={title:'Weak alphas',templateSlotTexts:{'5':'Pool of weak alphas','6':'2,000 weak alphas, IC 0.02-0.05 | 2,000 个弱因子组合','8':'Keep this exactly as I wrote it'}};
 assert.deepEqual(missingCardPoints(page,written),[page.keyPoints[1].text],'the dropped point is listed');
 assert.deepEqual(missingCardPoints(page,{...written,templateSlotTexts:{...written.templateSlotTexts,'10':'Brute force finds noise | 穷举搜索找到显著噪声'}}),[]);
 assert.deepEqual(missingCardPoints(page,{...written,templateSlotTexts:{...written.templateSlotTexts,'8':'Keep this','10':'Brute force finds noise | 穷举搜索找到显著噪声'}}),[page.keyPoints[2].text],'the author point must be there as written');
 assert.equal(pageVisibleText({templateSlotTexts:{'5':[{label:'Lab',body:'Body text'}]},nodes:[{type:'text',content:{text:'node text'}}]}),'node text','canonical visible objects take precedence over old slot projections');
 // a split card divides its objects: they stay on the first part
 const withObject={slides:[raw.slides[0],{...raw.slides[2],cardObjects:['u4']}]},parts=splitCardPage(project,withObject,1).raw.slides.slice(1);
 assert.deepEqual(parts.map(part=>part.cardObjects),[['u4'],[]]);
 // planning: a card page binds no automatic evidence and shows only its chosen objects verbatim
 const {slidePlan}=await import('./lib/ppt-planning.mjs');
 const planItems=[{id:'u1',type:'MechanismBlock',text:'A claim with 42 percent.',must_preserve_structure:true,source_ref:['s1'],chunkRefs:['c1']},{id:'u4',type:'EquationBlock',text:'IR = IC * sqrt(N)',must_preserve_structure:true,source_ref:['s1'],chunkRefs:['c1']}];
 const planSource={segments:[{id:'s1'}],semantic:{inventory:{items:planItems},chunks:[{id:'c1'}],evidenceAtoms:[{id:'e1',sourceUnitId:'u1',exactText:'42 percent',chunkRef:'c1',segmentRef:'s1'}]}};
 const planned=slidePlan([{id:'c',title:'Cover',sourceUnitIds:[]},{id:'p',title:'Claim',sourceUnitIds:['u1','u4'],cardObjects:['u4'],keyPoints:[{text:'A claim'}]},{id:'z',title:'End',sourceUnitIds:[]}],{},planSource,null);
 assert.deepEqual(planned[1].requiredEvidenceIds,[],'no automatic evidence quote on a card page');
 assert.deepEqual(planned[1].sourceArtifacts.map(artifact=>artifact.sourceUnitId),['u4'],'only the chosen object, not every must-preserve unit');
 const legacy=slidePlan([{id:'c',title:'Cover',sourceUnitIds:[]},{id:'p',title:'Claim',sourceUnitIds:['u1','u4']},{id:'z',title:'End',sourceUnitIds:[]}],{},planSource,null);
 assert.deepEqual(legacy[1].sourceArtifacts.map(artifact=>artifact.sourceUnitId).sort(),['u1','u4'],'a legacy page keeps every must-preserve unit');}
// Labels are cut by code; points the writer still left out are placed by code
// in free holders (3143, 6b823143: one merged commentary paragraph, then an
// empty page; a 10-unit heading overflowed).
{assert.equal(fitSlotText('Generate thousands to millions of candidates | 生成成千上万候选',20,'en'),'Generate thousands to millions','the primary half, cut at a word, no dangling "of"');
 assert.equal(fitSlotText('Generate candidates | 生成候选',12,'zh'),'生成候选');assert.equal(fitSlotText('Short',10),'Short');
 const slots=[{shapeId:4,role:'title',capacity:30},{shapeId:10,role:'content',purpose:'point-heading',capacity:10},{shapeId:11,role:'content',purpose:'point-description',capacity:60,pairedWith:10},{shapeId:15,role:'content',purpose:'point-heading',capacity:10},{shapeId:16,role:'content',purpose:'point-description',capacity:60,pairedWith:15},{shapeId:24,role:'content',purpose:'body',capacity:80},{shapeId:30,role:'content',purpose:'list',capacity:120,paragraphCount:3}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots}]},inputUnderstanding:{primaryLanguage:'en'}};
 const labelled=fitCardLabels(deck,1,{templateSlotTexts:{'10':'Operator library as regularizer | 算子库即正则化','11':'A long description stays as written by the writer'}});
 const {templateVisualUnits}=await import('./lib/ppt-presentation-writing.mjs');
 assert.ok(templateVisualUnits(labelled.templateSlotTexts['10'])<=10&&labelled.templateSlotTexts['10']!=='Operator library as regularizer | 算子库即正则化'&&labelled.templateSlotTexts['11'].startsWith('A long description'),'only labels are cut: '+labelled.templateSlotTexts['10']);
 const written={templateSlotTexts:{'4':'Title','10':'Search','11':'Search composes fields and operators'},templateOmissions:[{shapeId:15},{shapeId:16},{shapeId:24},{shapeId:30}]};
 const placed=placeCardPoints(deck,1,written,['Generate thousands of candidates and rank them by IC | 生成大量候选并按 IC 排序','The economic story comes after the fact']);
 assert.equal(placed.cardPointsPlaced,2);
 assert.ok(placed.templateSlotTexts['16'].startsWith('Generate thousands')&&placed.templateSlotTexts['15'].length>0&&placed.templateSlotTexts['24'].startsWith('The economic story'),JSON.stringify(placed.templateSlotTexts));
 assert.deepEqual(placed.templateOmissions.map(item=>item.shapeId),[30],'placed slots are no longer omitted; the list is left alone');
 assert.equal(placed.templateSlotTexts['11'],'Search composes fields and operators','the writer\'s own slots stay');
 assert.equal(placeCardPoints(deck,1,{templateSlotTexts:{'10':'a','11':'b','15':'c','16':'d','24':'e'}},['x']),null,'no free holder: nothing placed');
 // normalizeSlide: a card page without objects drops a commentary; labels are fitted
 const {_internals}=await import('./lib/ppt-api.mjs');
 const node=id=>({id:'n'+id,type:'text',nativeRef:{shapeId:id},content:{text:'sample'},geometry:{x:0,y:id*400000,width:9000000,height:300000}});
 const cardPage={id:'s1',title:'Steps',keyPoints:[{text:'one'},{text:'two'}],sourceUnitIds:[],cardObjects:[]};
 const cardDeck=objects=>({id:'x',templateFidelity:{mode:'preserve',slides:[{nodes:[4,10,11,15,16,24].map(node),slots:slots.slice(0,6)}]},outline:[{...cardPage,cardObjects:objects}],planningContract:{version:3,flow:'cards'},generationPolicy:{version:2,language:{mode:'source',body:'primary'}},source:{text:'',semantic:{inventory:{items:[]}}},planning:{slidePlan:[{slideId:'s1',sourceArtifacts:[]}]}});
 const normalized=_internals.normalizeSlide({title:'Steps',slotTexts:{'4':'Steps','10':'Operator library as regularizer','11':'one'},sourceCommentary:[{type:'mechanism',text:'This page explains everything in one paragraph.'}],contentBlocks:[],blocks:[]},cardPage,cardDeck([]),[]);
 assert.ok(!(normalized.sourceArtifactNodes||[]).some(item=>item.semanticRole==='source-explanation'),'no commentary paragraph on a card page without objects');
 assert.ok(templateVisualUnits(normalized.templateSlotTexts['10'])<=10,'the heading label fits its slot: '+normalized.templateSlotTexts['10']);}
// Code places each point in its slots, the writer only shortens (3143, 0d4337fa:
// lists written into a section label and a description, summaries, no points).
{const slots=[{shapeId:3,role:'section',capacity:7},{shapeId:4,role:'title',capacity:30},{shapeId:10,role:'content',purpose:'point-heading',capacity:12},{shapeId:11,role:'content',purpose:'point-description',capacity:80,pairedWith:10},{shapeId:15,role:'content',purpose:'point-heading',capacity:12},{shapeId:16,role:'content',purpose:'point-description',capacity:80,pairedWith:15},{shapeId:24,role:'content',purpose:'body',capacity:60},{shapeId:7,role:'content',purpose:'label',capacity:8}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots}]},inputUnderstanding:{primaryLanguage:'en'}};
 const pageOf=n=>({keyPoints:Array.from({length:n},(_,k)=>({text:`Point ${k+1}: weak alphas combine into a pool | 要点${k+1}：弱因子组合`})),cardObjects:[]});
 const two=cardSlotPlan(deck,1,pageOf(2));
 assert.deepEqual(two.plan.map(entry=>[entry.shapeId,entry.kind]),[[10,'label'],[11,'point'],[15,'label'],[16,'point']]);
 assert.deepEqual(two.leaveOut,[24,7],'unplanned content slots are left out');
 const four=cardSlotPlan(deck,1,pageOf(4));
 assert.deepEqual(four.plan.filter(entry=>entry.kind==='point').map(entry=>[entry.shapeId,entry.point.split('\n').map(point=>point.slice(0,7))]),[[11,['Point 1','Point 2']],[16,['Point 3']],[24,['Point 4']]],'a point beyond the holders joins where a point has most room, in order');
 assert.equal(cardSlotPlan(deck,1,{...pageOf(2),cardObjects:['t1']}),null,'a page with objects keeps the writer\'s slots');
 const written={templateSlotTexts:{'3':[{label:'x',body:'y'}],'10':'Weak alphas','11':'Point 1: weak alphas combine into a pool','15':'An overly long label for the slot','16':'Point 2: weak alphas combine into a pool of thousands of signals with low correlation and small IC each, and the combined information ratio grows with the square root of breadth | 要点2：成千上万个低相关弱因子组合，组合信息比率随广度平方根增长','24':'stray summary','7':'stray'},templateOmissions:[{shapeId:10}]};
 const shortened=applyCardSlotPlan(deck,1,pageOf(2),written);
 // A bilingual slot keeps the planned bilingual point over the writer's English-only text: one page never mixes (Fable, 2026-10-26).
 assert.equal(written.templateSlotTexts['11'],pageOf(2).keyPoints[0].text,'the planned bilingual point stays');
 const {templateVisualUnits}=await import('./lib/ppt-presentation-writing.mjs');
 assert.ok(templateVisualUnits(written.templateSlotTexts['15'])<=12,'an over-long label is cut to fit');
 // A writer expansion that would be cut gives way to the planned point, which fits (Fable, 2026-10-24; 3143, 2b9803a2 page 9).
 assert.equal(written.templateSlotTexts['16'],pageOf(2).keyPoints[1].text,'the planned point replaces the cut expansion');
 assert.deepEqual(shortened,[],'nothing is cut');
 assert.ok(!('24' in written.templateSlotTexts)&&!('7' in written.templateSlotTexts),'stray text in unplanned slots is dropped');
 assert.deepEqual(written.templateOmissions.map(item=>item.shapeId).sort(),[24,7].sort(),'planned slots are not omitted; unplanned ones are');
 const empty={templateSlotTexts:{},templateOmissions:[]};applyCardSlotPlan(deck,1,pageOf(1),empty);
 assert.ok(empty.templateSlotTexts['11'].startsWith('Point 1')&&empty.templateSlotTexts['10'].length>0,'a missing point is filled from the card');
 // the writer is given the plan
 const {writerPrompt}=await import('./lib/ppt-prompt-contracts.mjs');
 const planned=writerPrompt({...project,templateFidelity:deck.templateFidelity,outline:[{id:'c'},{id:'p',title:'Pool',...pageOf(2)}],deck:{slides:[]}},{id:'p',title:'Pool',...pageOf(2)},1,{});
 assert.ok(planned.includes('<card_slot_plan>')&&planned.includes('return slotTexts for exactly the planned shapeIds'),'the plan reaches the writer');
 // a one-card topic gets a section label that differs from its title
 const single=assembleCardOutline({...project,source:{...project.source,semantic:{...project.source.semantic,inventory:{items:items.map(item=>item.id==='u1'?{...item,sectionPath:['Why weak alphas']}:item),relationships:[]}}},originalSourceInventory:undefined},[{...task,card:{...task.card,title:'A pool of weak alphas | 弱因子池'}}],[{pages:[good.pages[0],good.pages[1]]}]);
 assert.equal(single.slides[1].section,'Why weak alphas','the source heading when the topic title is the page title');
 assert.equal(single.slides[2].section,'A pool of weak alphas | 弱因子池');}
// Holders are the page gate's slot groups (3143, 1826ec0a: on layout 6 a
// description is paired with a body; four points kept the description and
// left the body out, template_point_group_partial; a short point's label
// repeated it; a paired body's text became a heading over 48 characters).
{const {templateVisualUnits}=await import('./lib/ppt-presentation-writing.mjs');
 const layout6=[{shapeId:3,role:'section',capacity:7,groupId:3},{shapeId:4,role:'title',capacity:21,groupId:4},{shapeId:5,role:'content',purpose:'body',capacity:21,groupId:5},
  {shapeId:10,role:'content',purpose:'point-heading',capacity:10,groupId:10},{shapeId:11,role:'content',purpose:'point-description',capacity:95,pairedWith:10,groupId:10},
  {shapeId:15,role:'content',purpose:'point-heading',capacity:12,groupId:15},{shapeId:16,role:'content',purpose:'point-description',capacity:114,pairedWith:15,groupId:15},
  {shapeId:20,role:'content',purpose:'point-heading',capacity:12,groupId:20},{shapeId:21,role:'content',purpose:'point-description',capacity:95,pairedWith:20,groupId:20},
  {shapeId:23,role:'content',purpose:'point-description',capacity:195,pairedWith:24,groupId:24},{shapeId:24,role:'content',purpose:'body',capacity:150,groupId:24}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:layout6,nodes:[]}],slideMap:[0,1]},inputUnderstanding:{primaryLanguage:'en'}};
 const pageOf=(n,extra={})=>({id:'p',keyPoints:Array.from({length:n},(_,k)=>({text:`Point ${k+1}: hypothesis-driven research tests one formula at a time | 要点${k+1}：逐一检验`})),cardObjects:[],...extra});
 const kinds=plan=>plan.plan.map(entry=>[entry.shapeId,entry.kind]);
 assert.deepEqual(kinds(cardSlotPlan(deck,1,pageOf(4))).slice(-2),[[23,'point'],[24,'label']],'one point for the pair: the body the description pairs with holds its label');
 assert.deepEqual(cardSlotPlan(deck,1,pageOf(4)).leaveOut,[5],'only the narrow body is left out, never half a group');
 const five=cardSlotPlan(deck,1,pageOf(5));
 assert.deepEqual(kinds(five).slice(-2),[[23,'point'],[24,'label']],'a pair takes one point even when more are left: its partner stays the label');
 assert.equal(five.plan.find(entry=>entry.shapeId===23).point.split('\n').length,2,'the fifth point joins where it has most room');
 const outline=n=>({...deck,outline:[{id:'c'},pageOf(n)]});
 assert.ok(cardLayoutScore(outline(4),1)===0&&cardLayoutScore(outline(3),1)===150&&cardLayoutScore(outline(5),1)>=1000,'four pairs hold four points');
 const {inspectTemplateSlotDraft}=await import('./lib/ppt-template-fidelity.mjs');
 const written={id:'p',title:'Hypothesis first',templateSlotTexts:{'3':[{label:'stray',body:'list'}],'4':'Hypothesis first','10':'Hypothesis','11':'Point 1: hypothesis-driven research tests one formula at a time','15':'Two','16':'Point 2: hypothesis-driven research tests one formula at a time','20':'Three','21':'An unrelated sentence about the deck','23':'Point 4: hypothesis-driven research tests one formula at a time'},templateOmissions:[]};
 applyCardSlotPlan(deck,1,pageOf(4),written);
 assert.ok(!('3' in written.templateSlotTexts),'a stray list in the section slot is dropped');
 assert.ok(written.templateSlotTexts['21'].startsWith('Point 3'),'a written text that does not carry its point is replaced by the point');
 assert.ok(written.templateSlotTexts['24']&&templateVisualUnits(written.templateSlotTexts['24'])<=24,'the label slot gets a short label: '+written.templateSlotTexts['24']);
 const gate=inspectTemplateSlotDraft({...deck,outline:[{id:'c'},pageOf(4)],pages:3,planningContract:{version:3,flow:'cards'}},1,{...written,section:'Research'}).map(issue=>issue.code);
 assert.ok(!gate.includes('template_point_group_partial'),'the pair is kept whole: '+gate.join(','));
 // a label that only repeats its short point: the page's labels become ordinals
 const short={id:'p',keyPoints:['Multiple-testing correction.','Paper-trading or walk-forward confirmation.','Data and timestamp audit.'].map(text=>({text})),cardObjects:[],numberedPoints:true};
 const steps={templateSlotTexts:{'10':'Multiple-testing','11':'Multiple-testing correction.'},templateOmissions:[]};applyCardSlotPlan(deck,1,short,steps);
 assert.deepEqual(['10','15','20'].map(key=>steps.templateSlotTexts[key]),['Step 1','Step 2','Step 3'],'ordered steps get step labels');
 const plain={templateSlotTexts:{'10':'Multiple-testing','11':'Multiple-testing correction.'},templateOmissions:[]};applyCardSlotPlan(deck,1,{...short,numberedPoints:undefined},plain);
 assert.equal(plain.templateSlotTexts['10'],'01');
 // more points than holders: the extra joins where it has most room, order kept
 const eight=cardSlotPlan(deck,1,pageOf(7)).plan.filter(entry=>entry.kind==='point').map(entry=>entry.point.split('\n').map(point=>Number(point.match(/Point (\d)/u)[1])));
 assert.deepEqual(eight.flat(),[1,2,3,4,5,6,7]);assert.equal(eight.length,4);
 // no compatibility copy is derived from the planned slots: the paired body's long text is no heading, and the body list repeats nothing
 const {_internals}=await import('./lib/ppt-api.mjs');
 const page={id:'s1',title:'Hypothesis first',keyPoints:pageOf(5).keyPoints,sourceUnitIds:[],cardObjects:[]};
 const node=id=>({id:'n'+id,type:'text',nativeRef:{shapeId:id},content:{text:'sample'},geometry:{x:0,y:id*200000,width:9000000,height:150000}});
 const cardDeck={id:'x',templateFidelity:{mode:'preserve',slides:[{nodes:[],slots:[]},{nodes:[3,4,5,10,11,15,16,20,21,23,24].map(node),slots:layout6}]},outline:[{id:'c',title:'Cover'},page],planningContract:{version:3,flow:'cards'},generationPolicy:{version:2,language:{mode:'source',body:'primary'}},inputUnderstanding:{primaryLanguage:'en'},source:{text:'',semantic:{inventory:{items:[]}}},planning:{slidePlan:[{slideId:'s1',sourceArtifacts:[]}]}};
 const long='推理产出公式 Formula as the output of reasoning, tested one signal at a time | 逐一检验';
 const normalized=_internals.normalizeSlide({title:'Hypothesis first',slotTexts:{'3':'Research','4':'Hypothesis first','24':long},blocks:[]},page,cardDeck,[]);
 assert.equal(normalized.copy.blocks.length,0);
 assert.ok(!(normalized.nodes||[]).some(node=>node.semanticRole==='body'&&node.content?.items?.length),'the body list stays empty');
 assert.equal(missingCardPoints(page,normalized).length,5,'a normalized draft with old sample nodes is not visible slot coverage yet');
 const boundProject={...cardDeck,deck:{slides:[{id:'c',nodes:[]},normalized]}};
 const {bindTemplateFidelity}=await import('./lib/ppt-template-fidelity.mjs');bindTemplateFidelity(boundProject);
 assert.deepEqual(missingCardPoints(page,boundProject.deck.slides[1]),[],'all five points are visible after the actual native slot bind');
 // a list holds exactly its items
 const listDeck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:[{shapeId:4,role:'title',capacity:30},{shapeId:5,role:'content',purpose:'list',capacity:240,paragraphCount:3,groupId:5}]}]},inputUnderstanding:{primaryLanguage:'en'}};
 const listed={templateSlotTexts:{'5':[{label:'One',body:'Point 1: hypothesis-driven research tests one formula at a time'}]},templateOmissions:[]};
 applyCardSlotPlan(listDeck,1,pageOf(4),listed);
 assert.equal(listed.templateSlotTexts['5'].length,3,'three items for a three-item list');
 assert.deepEqual(cardSlotPlan(listDeck,1,pageOf(4)).plan[0].items.map(item=>item.split('\n').length),[1,1,2],'the fourth point joins the last item');
 assert.ok(listed.templateSlotTexts['5'].every(item=>item.label&&templateVisualUnits(item.label+item.body)<=80),'each item fits its share of the list');
 assert.equal(cardSlotPlan(listDeck,1,pageOf(2)),null,'two points cannot fill a three-item list');}
// A slot's room is measured on its native frame (3143, 1efa0344: the
// template's own sample overflowed a four-line frame, so its 95-unit capacity
// assumed five lines; 11 slots overflowed at render).
{const {templateVisualUnits}=await import('./lib/ppt-presentation-writing.mjs');const {measureText}=await import('./lib/ppt/render-contract.mjs');
 const frame={type:'text',nativeRef:{shapeId:21},geometry:{x:8167682,y:2967037,width:3213714,height:848122},style:{color:'#606a6b',fontFamily:'Roboto',fontSizePt:11.5},nativeTextFrame:{wordWrap:true,autoSize:'TEXT_TO_FIT_SHAPE (2)',margins:[0,0,0,0],paragraphs:[{text:'sample',level:0,lineSpacing:1.19,runs:[{text:'sample',fontSizePt:11.5,fontFamily:'Roboto'}]}],originalHeight:848122}};
 const slots=[{shapeId:4,role:'title',capacity:30},{shapeId:20,role:'content',purpose:'point-heading',capacity:12,groupId:20},{shapeId:21,role:'content',purpose:'point-description',capacity:95,maxLines:5,lineVisualUnits:19,pairedWith:20,groupId:20}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots,nodes:[{...frame,nativeRef:{shapeId:20},geometry:{...frame.geometry,y:2600000,height:250000}},frame]}]},inputUnderstanding:{primaryLanguage:'en'}};
 const point='Tutorials 05–09 taught how to hypothesize a factor (value, momentum, quality) and test it one signal at a time, then compare it against the existing pool';
 const page={keyPoints:[{text:point}],cardObjects:[]},plan=cardSlotPlan(deck,1,page),entry=plan.plan.find(item=>item.shapeId===21);
 assert.ok(entry.maxVisualUnits<95&&entry.maxVisualUnits>=60,'the writer targets the measured room: '+entry.maxVisualUnits);
 const written={templateSlotTexts:{'21':point},templateOmissions:[]};applyCardSlotPlan(deck,1,page,written);
 const fits=text=>!measureText({...frame,kind:'text',bounds:frame.geometry,content:{text}}).overflow;
 assert.ok(!fits(point)&&fits(written.templateSlotTexts['21'])&&templateVisualUnits(written.templateSlotTexts['21'])<=95,'the code cut fits the measured frame: '+written.templateSlotTexts['21']);
 assert.deepEqual(written.cardCodeShortened,[21]);
 const shorter='Tutorials 05–09 taught how to hypothesize a factor (value, momentum, quality) and test it one signal at a time';
 const kept={templateSlotTexts:{'21':shorter},templateOmissions:[]};applyCardSlotPlan(deck,1,page,kept);
 assert.ok(fits(shorter)&&kept.templateSlotTexts['21']===shorter&&!kept.cardCodeShortened,'a fitting writer text beyond the target is kept');}
// A card deck requires only the objects its outline chose; others are carried by the card's points (3143, 1efa0344).
{const {inspectObjectIntegrity}=await import('./lib/ppt-object-integrity.mjs');
 const checklist={id:'k1',type:'ChecklistBlock',text:'1. Data audit. 2. IC decay.',items:['Data audit.','IC decay.'],must_preserve_structure:true,source_ref:['s1']};
 const deckOf=flow=>({source:{semantic:{inventory:{items:[checklist]}}},outline:[{id:'c'},{id:'p',sourceUnitIds:['k1'],keyPoints:[{text:'Data audit.'},{text:'IC decay.'}],cardObjects:[]}],planningContract:flow?{version:3,flow}:undefined,planning:{slidePlan:[]}});
 const codes=project=>inspectObjectIntegrity(project,[{id:'p',nodes:[{id:'n',type:'text',content:{text:'Data audit. IC decay.'}}]}]).issues.map(issue=>issue.code);
 assert.ok(!codes(deckOf('cards')).includes('required_source_object_missing')&&codes(deckOf()).includes('required_source_object_missing'));
 const chosen=deckOf('cards');chosen.outline[1].cardObjects=['k1'];assert.ok(codes(chosen).includes('required_source_object_missing'),'a chosen object must be shown');}
// A card page's section label differs from its title after normalization (3143, 058cd50b pages 7-8).
{const {_internals}=await import('./lib/ppt-api.mjs');
 const top='Tutorial 10 — Alpha Mining: Formulaic Alphas, Operators, and Automated Search | 因子挖掘：公式化因子、算子与自动化搜索';
 const source={segments:[],semantic:{inventory:{items:[{id:'f1',type:'MechanismBlock',text:'Start with clean fields.',sectionPath:[top,'4. Data Fields for Mining | 挖掘用数据字段']},{id:'g1',type:'MechanismBlock',text:'Trees.',sectionPath:[top,'5. Genetic Programming for Alpha Mining | 遗传编程与因子挖掘']}]}}};
 const card=(title,section,ids)=>({title,focus:title,section,sourceUnitIds:ids,cardObjects:[],keyPoints:[{text:'A point'}]});
 const out=_internals.normalizeOutline({slides:[{title:'Alpha Mining',focus:'Cover',sourceUnitIds:[]},card('Data Fields for Mining','Data Fields for Mining',['f1']),card('Candidate Generation','Candidate Generation: Genetic Programming and Alternatives',['g1']),card('Operator Algebra','Search and Operators',['g1'])]},4,source,null,null,'en');
 const key=value=>String(value).replace(/^[\d.\s]+/u,'').toLowerCase().replace(/[^a-z0-9]/gu,'');
 assert.ok(out.slice(1).every(slide=>key(slide.section)!==key(slide.title)),JSON.stringify(out.map(slide=>[slide.title,slide.section])));
 assert.equal(out[3].section,'Search and Operators','a distinct label stays');
 const legacy=_internals.normalizeOutline({slides:[{title:'Alpha Mining',focus:'Cover',sourceUnitIds:[]},{title:'Data Fields',focus:'x',section:'Data Fields',sourceUnitIds:['f1']}]},2,source,null,null,'en');
 assert.equal(legacy[1].section,'Data Fields','legacy pages are unchanged');}
// Option D1 (2026-10-22): a bilingual point stays bilingual when it fits its
// slot, else its primary-language half, with a character budget for the
// writer; slots are measured as rendered rich text; a cut never breaks math or
// a decimal (3143, 5b42efc9).
{const {templateVisualUnits}=await import('./lib/ppt-presentation-writing.mjs');const {measureText}=await import('./lib/ppt/render-contract.mjs');const {richTextContent}=await import('./lib/ppt-source-text.mjs');
 const slots=[{shapeId:4,role:'title',capacity:30},{shapeId:10,role:'content',purpose:'point-heading',capacity:12,groupId:10},{shapeId:11,role:'content',purpose:'point-description',capacity:60,pairedWith:10,groupId:10},{shapeId:15,role:'content',purpose:'point-heading',capacity:12,groupId:15},{shapeId:16,role:'content',purpose:'point-description',capacity:60,pairedWith:15,groupId:15}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots}]},inputUnderstanding:{primaryLanguage:'en'}};
 const short='Data audit | 数据审计',long='Single-alpha Sharpe ratios in the 0.3–0.8 range are considered good because the model relies on pooling | 单个因子夏普比率落在 0.3–0.8 区间被视为良好，因为模型依赖组合';
 const page={keyPoints:[{text:short},{text:long}],cardObjects:[]},plan=cardSlotPlan(deck,1,page).plan;
 const [a,b]=plan.filter(entry=>entry.kind==='point');
 assert.deepEqual([a.language,a.point,a.maxCharacters],['both',short,short.length],'a bilingual point that fits stays bilingual');
 assert.ok(b.language==='en'&&!b.point.includes('|')&&b.maxCharacters===Math.floor(60/.55),'a long one shows its primary half, budgeted in characters: '+JSON.stringify(b));
 assert.equal(plan.find(entry=>entry.shapeId===15).language,'en','its label follows the slot language');
 const {writerPrompt}=await import('./lib/ppt-prompt-contracts.mjs');
 const prompt=writerPrompt({...project,templateFidelity:deck.templateFidelity,inputUnderstanding:deck.inputUnderstanding,outline:[{id:'c'},{id:'p',title:'Pool',...page}],deck:{slides:[]}},{id:'p',title:'Pool',...page},1,{});
 const view=JSON.parse(prompt.match(/<card_slot_plan>(.*?)<\/card_slot_plan>/su)[1]);
 assert.ok(view.every(entry=>!('maxVisualUnits' in entry)&&!('full' in entry))&&view.some(entry=>entry.maxCharacters),'the writer sees characters, not visual units');
 const written={templateSlotTexts:{'16':long},templateOmissions:[]};applyCardSlotPlan(deck,1,page,written);
 assert.ok(!written.templateSlotTexts['16'].includes('单个')&&written.templateSlotTexts['16'].includes('0.3–0.8')&&templateVisualUnits(written.templateSlotTexts['16'])<=60,'an over-long bilingual text keeps its primary half, decimals whole: '+written.templateSlotTexts['16']);
 assert.deepEqual(missingCardPoints(page,{templateSlotTexts:{'11':short,'16':written.templateSlotTexts['16']}}),[]);
 // a slot is measured as rendered rich text (math runs are taller)
 const frame={type:'text',nativeRef:{shapeId:14},geometry:{x:8127400,y:2685058,width:3262330,height:585192},style:{color:'#606a6b',fontFamily:'Roboto',fontSizePt:11},nativeTextFrame:{wordWrap:true,autoSize:'TEXT_TO_FIT_SHAPE (2)',margins:[0,0,0,0],paragraphs:[{text:'sample',level:0,lineSpacing:1.16,runs:[{text:'sample',fontSizePt:11,fontFamily:'Roboto'}]}],originalHeight:585192}};
 const mathText='2,000 weakly-correlated alphas at ICIR $\\approx 0.3$ each can combine to a book-level ICIR well above 2.';
 const measure=content=>measureText({...frame,kind:'text',bounds:frame.geometry,content});
 assert.ok(!measure({text:mathText}).overflow&&measure(richTextContent(mathText)).overflow,'fixture: plain text fits, rendered math overflows');
 const mathDeck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:[{shapeId:4,role:'title',capacity:30},{shapeId:13,role:'content',purpose:'point-heading',capacity:12,groupId:13},{shapeId:14,role:'content',purpose:'point-description',capacity:60,maxLines:3,lineVisualUnits:20,pairedWith:13,groupId:13}],nodes:[{...frame,nativeRef:{shapeId:13},geometry:{...frame.geometry,y:2300000,height:250000}},frame]}]},inputUnderstanding:{primaryLanguage:'en'}};
 const mathPage={keyPoints:[{text:mathText}],cardObjects:[]},fitted={templateSlotTexts:{'14':mathText},templateOmissions:[]};applyCardSlotPlan(mathDeck,1,mathPage,fitted);
 assert.ok(!measure(richTextContent(fitted.templateSlotTexts['14'])).overflow,'the code cut fits the rendered frame: '+fitted.templateSlotTexts['14']);
 assert.equal(fitted.templateSlotTexts['14'].split('$').length%2,1,'no math span is left open');
 for(const capacity of [30,40,45,50]){const cut=fitSlotText('Search composes fields into candidate expressions $\\alpha = g(f_1, f_2)$ ranked by IC over history.',capacity);
  assert.ok(templateVisualUnits(cut)<=capacity&&(cut.includes('$\\alpha = g(f_1, f_2)$')||!cut.includes('$')),'a math span is kept whole or left out: '+cut);}}
// Writer labels go on the points they name and keep only their point's numbers (3143, 631ea11e pages 8-9).
{const pair=(h,d)=>[{shapeId:h,role:'content',purpose:'point-heading',capacity:22,groupId:h},{shapeId:d,role:'content',purpose:'point-description',capacity:120,pairedWith:h,groupId:h}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:[{shapeId:4,role:'title',capacity:30},{shapeId:5,role:'content',purpose:'body',capacity:200,groupId:5},...pair(7,8),...pair(10,11),...pair(13,14),...pair(16,17)]}]},inputUnderstanding:{primaryLanguage:'en'}};
 const points=['A production pipeline separates roles: data team, research platform, evaluation','Every alpha should have lineage: who generated it, with what data, when','A-share mining needs guardrails: price-limit masks, suspension handling','Many beautiful formulaic alphas in A-shares are actually limit-up fill assumptions','Because the market has undergone major regime changes, evaluate formula alphas across regimes'];
 const page={keyPoints:points.map(text=>({text})),cardObjects:[]};
 const shuffled={templateSlotTexts:{'5':points[0],'7':'A-Share Guardrails','8':points[1],'10':'Regime Evaluation','11':points[2],'13':'Alpha Lineage','14':points[3],'16':'False Alpha Risk','17':points[4]},templateOmissions:[]};
 applyCardSlotPlan(deck,1,page,shuffled);
 assert.deepEqual(['7','10','13'].map(key=>shuffled.templateSlotTexts[key]),['Alpha Lineage','A-Share Guardrails','False Alpha Risk'],'labels return to the points they name');
 assert.equal(shuffled.templateSlotTexts['16'],'Regime Evaluation');
 const steps={keyPoints:[{text:'Every mined alpha should pass a gauntlet'},{text:'Data/timestamp audit; 2. IC/ICIR and decay; 3. Quantile spread; 4. Turnover and costs'}],cardObjects:[],numberedPoints:true};
 const ranged={templateSlotTexts:{'5':steps.keyPoints[0].text,'7':'Steps 1–4','8':steps.keyPoints[1].text},templateOmissions:[]};
 applyCardSlotPlan(deck,1,steps,ranged);
 assert.ok(!/\d/u.test(ranged.templateSlotTexts['7'])&&ranged.templateSlotTexts['7'].length>0,'a label with a number its point lacks is replaced: '+ranged.templateSlotTexts['7']);
 const acronym={keyPoints:[{text:'Single-alpha Sharpe ratios in the 0.3–0.8 range are good'},{text:'If each alpha has IC about 0.02 the combined ratio grows with breadth'},{text:'2,000 weakly-correlated alphas can combine to a high book-level ratio'}],cardObjects:[]};
 const swapped={templateSlotTexts:{'5':acronym.keyPoints[0].text,'7':'IC Growth','8':acronym.keyPoints[1].text,'10':'','11':acronym.keyPoints[2].text},templateOmissions:[]};
 const narrow={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:[{shapeId:4,role:'title',capacity:30},{shapeId:5,role:'content',purpose:'body',capacity:200,groupId:5},{shapeId:7,role:'content',purpose:'point-heading',capacity:6,groupId:7},{shapeId:8,role:'content',purpose:'point-description',capacity:120,pairedWith:7,groupId:7},{shapeId:10,role:'content',purpose:'point-heading',capacity:6,groupId:10},{shapeId:11,role:'content',purpose:'point-description',capacity:120,pairedWith:10,groupId:10}]}]},inputUnderstanding:{primaryLanguage:'en'}};
 applyCardSlotPlan(narrow,1,acronym,swapped);
 assert.equal(swapped.templateSlotTexts['7'],'IC Growth','an acronym label stays on its point');
 assert.ok(/\p{L}{3}/u.test(swapped.templateSlotTexts['10']),'a code label keeps a word, never a bare number: '+swapped.templateSlotTexts['10']);
 assert.equal(fitSlotText('Search is cheap but validation is everything; generators are factories',12),'Search is cheap','a cut never ends on "but"');
 assert.equal(fitSlotText('Any claimed IC = 0.08 remains merely a candidate',9),'Any claimed IC','a cut never ends on "="');
 {const {_internals:gate}=await import('./lib/ppt-template-fidelity.mjs');const text='Practical combination shrinks weights toward equal weight, penalizes turnover and correlation, caps so one recent winner cannot dominate.';
  for(const capacity of [51,56,60])assert.equal(gate.incompletePhrase(fitSlotText(text,capacity)),false,'a cut satisfies the gate fragment rule (3143, 5968fafa: "caps so one")');}
 const dash=fitSlotText('Evaluating a million random formulas against pure noise makes the best by in-sample IC look statistically dazzling purely by chance—the look-elsewhere effect.',74);
 assert.ok(dash.endsWith('purely by chance'),'a dangling word after a dash is trimmed (3143, 1a7894ad page 5): '+dash);
 const {_internals:fidelity}=await import('./lib/ppt-template-fidelity.mjs');assert.equal(fidelity.incompletePhrase(dash),false);}
// Layout 2 of the 3143 template (367a72d8): whole rows are filled before the
// full-width body, and a left-out group's bar, icon box and icon go with it.
{const {inspectTemplateSlotDraft}=await import('./lib/ppt-template-fidelity.mjs');
 const E=914400,box=(x,y,w,h)=>({x:Math.round(x*E),y:Math.round(y*E),width:Math.round(w*E),height:Math.round(h*E)});
 const text=(id,g)=>({id:'t'+id,type:'text',nativeRef:{shapeId:id},geometry:g,content:{text:'sample'}});
 const slots=[{shapeId:3,role:'section',capacity:7},{shapeId:4,role:'title',capacity:40},{shapeId:5,role:'content',purpose:'body',capacity:120,groupId:5}];
 const nodes=[text(3,box(.82,.64,1.22,.14)),text(4,box(.72,.88,11.89,.38)),text(5,box(.72,1.46,11.89,.43))];
 const columns=[.88,4.88,8.89],rows=[[3.09,2.86,2.63],[5.59,5.36,5.13]];let id=6;const groups=[];
 rows.forEach(row=>row.forEach((y,c)=>{const bar=id++,heading=id++,description=id++,boxId=100+bar,icon=200+bar,x=columns[c];
  slots.push({shapeId:heading,role:'content',purpose:'point-heading',capacity:20,groupId:heading},{shapeId:description,role:'content',purpose:'point-description',capacity:90,pairedWith:heading,groupId:heading});
  nodes.push({id:'b'+bar,type:'shape',nativeRef:{shapeId:bar},geometry:box(x+.07,y-.44,3.64,.15)},text(heading,box(x,y,3.57,.23)),text(description,box(x,y+.31,3.57,.85)),
   {id:'x'+boxId,type:'shape',nativeRef:{shapeId:boxId},geometry:box(x-.16,y-.59,.46,.46)},{id:'i'+icon,type:'image',nativeRef:{shapeId:icon},geometry:box(x-.04,y-.48,.23,.23),content:{mediaRole:'template_icon',dataUrl:'data:image/png;base64,AA==',imageSha256:'h'+icon}});
  groups.push({bar,heading,description,boxId,icon});}));
 nodes.push({id:'band',type:'shape',nativeRef:{shapeId:300},geometry:box(.5,2.0,12,.2)});
 const deck={id:'d',templateFidelity:{mode:'preserve',width:12192000,height:6858000,slides:[{slots:[],nodes:[]},{slots,nodes}]},inputUnderstanding:{primaryLanguage:'en'},source:{text:'x'}};
 const pageOf=n=>({id:'p',keyPoints:Array.from({length:n},(_,k)=>({text:`Point ${k+1} explains one idea about weak alphas`})),cardObjects:[]});
 const holders=n=>cardSlotPlan(deck,1,pageOf(n)).plan.filter(entry=>entry.kind==='point').map(entry=>entry.shapeId);
 const H=groups.map(group=>group.description);
 assert.deepEqual(holders(4),[5,...H.slice(0,3)],'four points: the body and the first row');
 assert.deepEqual(cardSlotPlan(deck,1,pageOf(4)).plan.filter(entry=>entry.kind==='label').map(entry=>entry.ordinal),[1,2,3],'the body point has no label: the groups are numbered from 01 (3143 o62 page 4)');
 assert.deepEqual(cardSlotPlan(deck,1,pageOf(6)).plan.filter(entry=>entry.kind==='label').map(entry=>entry.ordinal),[1,2,3,4,5,6],'without a body point the groups follow the points');
 assert.deepEqual(holders(5),H.slice(0,5),'five points: both rows of pairs, the body left out');
 assert.deepEqual(holders(6),H,'six points: both rows, the body left out');
 assert.deepEqual(holders(3),H.slice(0,3),'three points: one whole row');
 const slide={id:'p',title:'Weak alphas',templateSlotTexts:{},templateOmissions:[]};applyCardSlotPlan(deck,1,pageOf(5),slide);
 const omitted=new Set(slide.templateOmissions.map(item=>item.shapeId)),last=groups.at(-1);
 assert.ok([last.bar,last.boxId,last.icon,last.heading,last.description].every(shape=>omitted.has(shape)),'the left-out group goes with its bar, box and icon: '+[...omitted].join(','));
 assert.ok(!omitted.has(groups[0].bar)&&!omitted.has(300),'used groups and a shared band stay');
 assert.equal(slide.templateOmissions.find(item=>item.shapeId===last.icon).approvalBasis,'card_group_omitted');
 const issues=inspectTemplateSlotDraft({...deck,outline:[{id:'c'},pageOf(5)],pages:3,planningContract:{version:3,flow:'cards'}},1,{...slide,section:'Alphas',title:'Weak alphas'}).map(issue=>issue.code);
 assert.ok(!issues.includes('template_omission_invalid'),'decoration omissions are valid: '+issues.join(','));}
// A label that fits another point far better leaves its own (3143, 5f748349 page 9).
{const pair=(h,d)=>[{shapeId:h,role:'content',purpose:'point-heading',capacity:22,groupId:h},{shapeId:d,role:'content',purpose:'point-description',capacity:120,pairedWith:h,groupId:h}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:[{shapeId:4,role:'title',capacity:30},...pair(7,8),...pair(10,11),...pair(13,14),...pair(16,17),...pair(19,20)]}]},inputUnderstanding:{primaryLanguage:'en'}};
 const points=['Combining alphas is a forecasting problem: simple average, IC-weighted, ridge','Avoid overfitting the combiner; a meta-model can overfit mined alphas','Practical combination shrinks weights toward equality','Production pipeline separates roles: data, research platform, evaluation','Every alpha needs lineage: generator, data, time, variants tried'];
 const page={keyPoints:points.map(text=>({text})),cardObjects:[]};
 const slide={templateSlotTexts:{'7':'Alpha Lineage','8':points[0],'10':'Combiner Overfitting','11':points[1],'13':'Weight Constraints','14':points[2],'16':'Pipeline Roles','17':points[3],'19':'Lineage Tracking','20':points[4]},templateOmissions:[]};
 applyCardSlotPlan(deck,1,page,slide);
 assert.ok(!/lineage/iu.test(slide.templateSlotTexts['7']),'the lineage label leaves the combination point: '+slide.templateSlotTexts['7']);
 assert.ok(/lineage/iu.test(slide.templateSlotTexts['19']));
 assert.deepEqual(['10','13','16'].map(key=>slide.templateSlotTexts[key]),['Combiner Overfitting','Weight Constraints','Pipeline Roles'],'well-placed labels stay');}
// Section labels fit the outline's 80-character limit; the cover has none (3143, 2c6bc0eb).
{const longCover='Tutorial 10 — Alpha Mining: Formulaic Alphas, Operators, and Automated Search | 因子挖掘：公式化因子、算子与自动化搜索';
 const longTopic='Operator Algebra, Data Fields and the Many Ways Formulaic Alphas Are Read in Practice | 算子代数、数据字段与公式化因子的多种解读方式';
 const deck={...project,inputUnderstanding:{...(project.inputUnderstanding||{}),primaryLanguage:'en'},planningContract:{...project.planningContract,logicalCards:project.planningContract.logicalCards.map((card,index)=>index===0?{...card,title:longCover}:card)}};
 const longTask={...task,card:{...task.card,title:longTopic}};
 const out=assembleCardOutline(deck,[longTask],[good]);
 assert.equal(out.slides[0].section,undefined,'the cover has no section label');
 assert.ok(out.slides.slice(1).every(slide=>slide.section.length<=80)&&out.slides[1].section.startsWith('Operator Algebra')&&!out.slides[1].section.includes('|'),'a long section keeps its primary half within 80: '+out.slides[1].section);}
// An abstract label with no shared word keeps its slot; a code label that is
// no phrase turns the page's labels into ordinals (3143, fae64fb8 page 11).
{const pair=(h,d)=>[{shapeId:h,role:'content',purpose:'point-heading',capacity:22,groupId:h},{shapeId:d,role:'content',purpose:'point-description',capacity:120,pairedWith:h,groupId:h}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:[{shapeId:4,role:'title',capacity:30},...pair(7,8),...pair(10,11),...pair(13,14)]}]},inputUnderstanding:{primaryLanguage:'en'}};
 const points=['A-share guardrails: price-limit masks, suspension handling','Many beautiful A-share formulaic alphas are actually limit-up fill assumptions','Evaluate formula alphas across policy and crowding regimes'];
 const page={keyPoints:points.map(text=>({text})),cardObjects:[]};
 const kept={templateSlotTexts:{'7':'A-Share Rules','8':points[0],'10':'Spurious Signals','11':points[1],'13':'Regime Testing','14':points[2]},templateOmissions:[]};
 applyCardSlotPlan(deck,1,page,kept);
 assert.deepEqual(['7','10','13'].map(key=>kept.templateSlotTexts[key]),['A-Share Rules','Spurious Signals','Regime Testing'],'an abstract label stays on its point');
 const weak={templateSlotTexts:{'7':'A-Share Rules','8':points[0],'10':'','11':points[1],'13':'Regime Testing','14':points[2]},templateOmissions:[]};
 applyCardSlotPlan({...deck,templateFidelity:{...deck.templateFidelity,slides:[{slots:[]},{slots:deck.templateFidelity.slides[1].slots.map(slot=>slot.shapeId===10?{...slot,capacity:4}:slot)}]}},1,page,weak);
 assert.deepEqual(['7','10','13'].map(key=>weak.templateSlotTexts[key]),['01','02','03'],'a code label that is no phrase makes the page ordinal: '+weak.templateSlotTexts['10']);}
// A lead-in point ending with a colon (3143, 5d135455 page 9): the outline sends
// it back; the fallback merges it into a single following item or drops the
// colon; a planned slot never ends on a colon in either language half.
{const leadIn={text:'A production pipeline separates roles: | 生产流水线会分离角色：',sourceUnitIds:['u1']};
 const multi={text:'Data team: fields and timestamps. Research platform: formula grammar | 数据团队：字段与时间戳。研究平台：公式语法',sourceUnitIds:['u2']};
 const single={text:'Data team owns fields and timestamps | 数据团队负责字段与时间戳',sourceUnitIds:['u2']};
 const reply=points=>({pages:[page(points),good.pages[1]]});
 assert.ok(kinds(reply([leadIn,multi])).includes('lead_in'),'a lead-in goes back for correction');
 const kept=sanitizeCardTopic(project,task,reply([leadIn,multi]),estimate).reply.pages[0].points.map(point=>point.text);
 assert.deepEqual(kept.slice(0,2),['A production pipeline separates roles | 生产流水线会分离角色',multi.text],'before a multi-item point the colon goes, the items stay parallel');
 const merged=sanitizeCardTopic(project,task,reply([leadIn,single]),estimate).reply.pages[0].points;
 assert.equal(merged[0].text,'A production pipeline separates roles: Data team owns fields and timestamps | 生产流水线会分离角色：数据团队负责字段与时间戳');
 assert.deepEqual(merged[0].sourceUnitIds,['u1','u2'],'the merged point cites both');
 const slots=[{shapeId:4,role:'title',capacity:30},{shapeId:10,role:'content',purpose:'point-heading',capacity:24,groupId:10},{shapeId:11,role:'content',purpose:'point-description',capacity:120,pairedWith:10,groupId:10}];
 const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots}]},inputUnderstanding:{primaryLanguage:'en'}};
 const slide={templateSlotTexts:{'10':'Role Separation','11':leadIn.text},templateOmissions:[]};applyCardSlotPlan(deck,1,{keyPoints:[{text:leadIn.text}],cardObjects:[]},slide);
 assert.equal(slide.templateSlotTexts['11'],'A production pipeline separates roles | 生产流水线会分离角色','no colon ends either half');}
// A code label never cuts inside a number (3143, 0395f2aa page 4: "2 | 2").
{const deck={templateFidelity:{mode:'preserve',slides:[{slots:[]},{slots:[{shapeId:4,role:'title',capacity:30},{shapeId:13,role:'content',purpose:'point-heading',capacity:24,groupId:13},{shapeId:14,role:'content',purpose:'point-description',capacity:120,pairedWith:13,groupId:13}]}]},inputUnderstanding:{primaryLanguage:'en'}};
 const page={keyPoints:[{text:'2,000 weakly-correlated alphas at ICIR 0.3 each can combine to a book-level ICIR well above 2 | 2,000 个弱相关因子可组合成远高于 2 的 ICIR'}],cardObjects:[]};
 const written={templateSlotTexts:{'14':page.keyPoints[0].text},templateOmissions:[]};applyCardSlotPlan(deck,1,page,written);
 assert.ok(/[a-z]/u.test(written.templateSlotTexts['13'])&&written.templateSlotTexts['13'].startsWith('2,000'),'the label keeps the number whole: '+written.templateSlotTexts['13']);}
// The visible-body target does not apply to a card page (3143, 0395f2aa page 5).
{const {inspectContent}=await import('./lib/ppt-content-qa.mjs');
 const slides=[0,1,2].map(k=>({id:'s'+k,title:'Page '+k,nodes:[{id:'t'+k,type:'text',content:{text:'Short card point.'}}]}));
 const deckOf=cards=>({source:{text:'x'.repeat(9000)},inputProfile:{level:'rich'},outline:slides.map(slide=>({id:slide.id,cardObjects:[]})),planningContract:cards?{version:3,flow:'cards'}:undefined,planning:{slidePlan:[]},deck:{slides}});
 const sparse=project=>inspectContent(project).issues.filter(issue=>issue.code==='visible_content_sparse').length;
 assert.ok(sparse(deckOf(false))>0&&sparse(deckOf(true))===0);}
// A compacted writer context keeps the page rules, the card contract and the template slots (3143, 0395f2aa).
{const {writerCorrectionContext}=await import('./lib/ppt-prompt-contracts.mjs');
 const framework={frameworkHash:'h',material:{knowledge:'source_only',prompt:'',sourceText:'x'.repeat(20000)}};
 const long=`INPUT_FRAMEWORK=${JSON.stringify(framework)}\n当前任务只写第 2 页，共 3 页。\n<slide_contract>{}</slide_contract>\n<page_rules>Keep title exactly "A".</page_rules>\n<card_contract>This page is a reviewed outline card. <card_slot_plan>[]</card_slot_plan></card_contract>\n<template_slot_contract><page_header_language>en</page_header_language> slots</template_slot_contract>\nUntagged prose ${'y'.repeat(12000)}\n<source_packet>{}</source_packet>\n返回唯一 JSON：{"title":"A"}。只输出 JSON。`;
 const compact=writerCorrectionContext(long);
 assert.ok(compact.length<long.length&&!compact.includes('Untagged prose'),'large untagged text is still dropped');
 assert.ok(['<page_rules>','<card_slot_plan>','<template_slot_contract>','<page_header_language>'].every(tag=>compact.includes(tag)),'rules survive compaction');}
// A bilingual point shown in one language is visible (3143, 8f49c688 page 7).
{const point={text:'WorldQuant-style alphas are deliberately simple price/volume expressions; value lies in combining a large pool of weak, diverse formulas. | WorldQuant 风格 alpha 是由价量构成的简单表达式；价值在于组合大量弱而多样的公式。'};
 assert.deepEqual(missingCardPoints({keyPoints:[point]},{templateSlotTexts:{'11':'WorldQuant-style alphas are deliberately simple price/volume expressions'}}),[]);
 assert.deepEqual(missingCardPoints({keyPoints:[point]},{templateSlotTexts:{'11':'Simple expressions'}}),[point.text]);}
// A complete sentence ending with a phrasal verb's particle is not a fragment (3143, 8f49c688 page 7).
{const {_internals}=await import('./lib/ppt-template-fidelity.mjs');
 assert.equal(_internals.incompletePhrase('Read each formula by asking what known factor exposure it smuggles in.'),false);
 assert.equal(_internals.incompletePhrase('Read each formula by asking what known factor exposure does it smuggle in?'),false,'a question with a base-form verb (3143, 7611ae64 page 6)');
 assert.ok(_internals.incompletePhrase('Read each formula, check five factors, 2 in.'),'the particle must follow a word');
 assert.ok(_internals.incompletePhrase('Keep history for')&&_internals.incompletePhrase('Read each formula by asking what it smuggles in')&&_internals.incompletePhrase('Fields are in.'),'unpunctuated or short phrases stay fragments');}
// Math the cited units write as $...$ keeps its delimiters in a card point (3143, 1efa0344 page 5).
{const deck={...project,source:{...project.source,semantic:{...project.source.semantic,inventory:{items:items.map(item=>item.id==='u1'?{...item,text:'Searching $10^6$ candidate formulas against 3,700 days.'}:item),relationships:[]}}},originalSourceInventory:undefined};
 const reply=[{pages:[{...good.pages[0],points:[{text:'Searching 10^6 formulas | 搜索 10^6 个公式',sourceUnitIds:['u1']}]},good.pages[1]]}];
 const out=assembleCardOutline(deck,[task],reply);
 assert.equal(out.slides[1].keyPoints[0].text,'Searching $10^6$ formulas | 搜索 $10^6$ 个公式');}
// A shorter source expression inside a longer one is not wrapped again (live fz-r5 page 9).
{const deck={...project,source:{...project.source,semantic:{...project.source.semantic,inventory:{items:items.map(item=>item.id==='u1'?{...item,text:'Investors hold $\\Sigma^{-1}(\\mu - r_f\\mathbf 1)$, where $\\mu$ is the mean.'}:item),relationships:[]}}},originalSourceInventory:undefined};
 const reply=[{pages:[{...good.pages[0],points:[{text:'Proportions \\Sigma^{-1}(\\mu - r_f\\mathbf 1) with mean \\mu',sourceUnitIds:['u1']}]},good.pages[1]]}];
 assert.equal(assembleCardOutline(deck,[task],reply).slides[1].keyPoints[0].text,'Proportions $\\Sigma^{-1}(\\mu - r_f\\mathbf 1)$ with mean $\\mu$');}
// The last card is content, not a closing page (3143, d27276ed).
{const {compileSkeleton}=await import('./lib/ppt-outline-protocol.mjs');
 const roleOfLast=planningContract=>{try{return compileSkeleton({...project,planningContract},raw).slides.at(-1).role;}catch(error){return 'ERR '+error.message.slice(0,80);}};
 assert.equal(roleOfLast(project.planningContract),'mechanism');assert.equal(roleOfLast(undefined),'closing','a legacy deck still closes on its last page');}
// A number written with a unit the source does not use is sent back (the publish gate's unit rule).
{const unit={pages:good.pages.map((card,index)=>index?card:{...card,points:[{...card.points[0],text:'Production combines 2,000天 of weak alphas'},...card.points.slice(1)]})};
 assert.ok(cardTopicProblems(project,task,unit,estimate).some(problem=>problem.kind==='number'&&/changes the source's unit/.test(problem.message)));}
// A title repeated within one topic reply is sent back once (Fable, 2026-10-23).
{const twin={pages:good.pages.map(card=>({...card,title:good.pages[0].title}))};
 assert.ok(cardTopicProblems(project,task,twin,estimate).some(problem=>problem.kind==='duplicate_title'));
 assert.throws(()=>acceptCardTopic(project,task,twin,estimate),/repeats the title/);}
// List items with their numbers inside one point (alpha-r2, Fable 2026-10-23):
// sent back once, then the numbers are removed; a source list or heading number is never a figure.
{const listed={text:'Data audit; 2. IC about 0.02; 3. Spread | 数据审计；2. IC 约 0.02；3. 价差',sourceUnitIds:['u1','u2']};
 const reply={pages:[{...good.pages[0],points:[listed,...good.pages[0].points.slice(1)]},good.pages[1]]};
 const found=kinds(reply);assert.ok(found.includes('list')&&!found.includes('number'),'inline item numbers are a list problem, not unsupported figures: '+found);
 assert.throws(()=>acceptCardTopic(project,task,reply,estimate),/list items with their numbers/);
 assert.equal(stripInlineItems('A; 2. B; 3. C | 甲；2. 乙'),'A; B; C | 甲；乙');assert.equal(stripInlineItems('IC 0.5; Sharpe 2. Next'),'IC 0.5; Sharpe 2. Next');assert.equal(stripInlineItems('1. A; 2. B'),'A; B');
 const {reply:clean,advisories}=sanitizeCardTopic(project,task,reply,estimate);
 assert.equal(clean.pages[0].points[0].text,'Data audit; IC about 0.02; Spread | 数据审计；IC 约 0.02；价差','the numbers go, the items stay');
 assert.ok(advisories.some(note=>note.code==='card_list_numbers_stripped')&&!advisories.some(note=>note.code==='card_point_dropped'),'stripped and listed, never dropped');
 const {numericRecords}=await import('./lib/ppt-source-numbers.mjs');
 assert.deepEqual(numericRecords(clean.pages[0].points[0].text).map(record=>record.raw),['0.02','0.02'],'only the source figure is left for the gate');
 // A card that is only an inline list becomes a numbered card, one point per item.
 const only={pages:[{...good.pages[0],points:[{text:'1. Audit; 2. Spread; 3. Turnover | 1. 审计；2. 价差；3. 换手',sourceUnitIds:['u1']}]},good.pages[1]]};
 const split=sanitizeCardTopic(project,task,only,estimate).reply.pages[0];
 assert.equal(split.numbered,true);assert.deepEqual(split.points.map(point=>point.text),['Audit | 审计','Spread | 价差','Turnover | 换手']);assert.ok(split.points.every(point=>point.sourceUnitIds.includes('u1')));
 // A list marker of the source is not a figure: "8 checks" from an eight-item list goes back.
 const deck={...project,source:{...project.source,semantic:{...project.source.semantic,inventory:{items:[...items,{id:'u7',type:'ListBlock',text:'1. Audit.\n2. IC.\n3. Spread.\n4. Turnover.\n5. Correlation.\n6. Robustness.\n7. Multiple testing.\n8. Paper-trading.',source_ref:['s4'],chunkRefs:['c4']}],relationships:[]}}},originalSourceInventory:undefined};
 const listTask={...task,ids:[...task.ids,'u7']},marker={pages:[{...good.pages[0],points:[{text:'An 8-step gauntlet of checks',sourceUnitIds:['u7']},{text:'IC about 0.02',sourceUnitIds:['u1']}]},good.pages[1]]};
 const problems=cardTopicProblems(deck,listTask,marker,estimate).filter(problem=>problem.kind==='number');
 assert.equal(problems.length,1,'only the marker number goes back');assert.match(problems[0].message,/point 1: 8 is not a figure/);}
// splitCardPage takes the measured continuation (Fable R2/R3).
{const objectPage={...raw.slides[1],id:'page_measured',cardObjects:['u4'],sourceUnitIds:['u1','u3','u4','u5'],keyPoints:[{text:'One',sourceUnitIds:['u1']},{text:'Two',sourceUnitIds:['u3']},{text:'Three',sourceUnitIds:['u5']}]};
 const deck={...raw,slides:[raw.slides[0],objectPage]};
 const two=splitCardPage(project,deck,1,{kept:2});assert.deepEqual(two.raw.slides.slice(1).map(slide=>slide.keyPoints.length),[2,1]);assert.deepEqual(two.raw.slides[1].cardObjects,['u4']);assert.deepEqual(two.raw.slides[2].cardObjects,[]);
 const none=splitCardPage(project,deck,1,{kept:0});assert.deepEqual(none.raw.slides.slice(1).map(slide=>[slide.cardObjects.length,slide.keyPoints.length]),[[1,0],[0,3]],'objects alone first, every point moves');
 assert.match(none.raw.slides[2].title,/\(cont\.\)|（续）/u);
 const ranges=splitCardPage(project,deck,1,{ranges:[{sourceUnitId:'u4',rowStart:1,rowEnd:4},{sourceUnitId:'u4',rowStart:4,rowEnd:7}]});
 assert.deepEqual(ranges.raw.slides.slice(1).map(slide=>slide.sourceArtifactRanges),[[{sourceUnitId:'u4',rowStart:1,rowEnd:4}],[{sourceUnitId:'u4',rowStart:4,rowEnd:7}]]);
 assert.deepEqual(ranges.raw.slides.slice(1).map(slide=>slide.keyPoints.length),[0,3],'the points follow the last rows (Fable review r16: ranges stay consecutive)');
 const both={...objectPage,cardObjects:['u4','u6'],keyPoints:[{text:'About the table',sourceUnitIds:['u4']},{text:'About the code',sourceUnitIds:['u6']},{text:'General',sourceUnitIds:['u1']}]};
 const each=splitCardPage({...project,generationPolicy:{...project.generationPolicy,code:{presentation:'keep'}}},{...raw,slides:[raw.slides[0],both]},1,{each:true});
 assert.deepEqual(each.raw.slides.slice(1).map(slide=>[slide.cardObjects,slide.keyPoints.map(point=>point.text)]),[[['u4'],['About the table','General']],[['u6'],['About the code']]]);
 assert.equal(each.change.pageIds.length,2);assert.equal(each.raw.slides[1].id,'page_measured','the first page keeps its identity');}
// A card point is checked by the publish gate's own number rules (live mlq-r9
// page 5: "252 days" for "252 trading days" passed the outline, blocked publication).
{const {cardNumberProblems}=await import('./lib/ppt-outline-cards.mjs');
 const text='A panel with 3,000 stocks × 252 trading days × 30 years looks huge; adjacent rows share 20 of 21 days. An R2 of 0.5%–1% is good.\n\n一个包含 3000 只股票 × 252 个交易日 × 30 年的面板，R2 达到 0.5%–1% 已很好。';
 const project={source:{text,segments:[{id:'s1',text}]}},sources=[text];
 assert.deepEqual(cardNumberProblems(project,'3,000 stocks × 252 trading days × 30 years; rows share 20 days | 3000股×252个交易日×30年；R2达0.5%–1%',sources),[]);
 const [problem]=cardNumberProblems(project,'3,000 stocks × 252 days × 30 years looks huge',sources);
 assert.match(problem,/"252 days" is not stated with this unit/u);assert.match(problem,/252 trading days/u,'the correction quotes the source');
 assert.match(cardNumberProblems(project,'Only 7 stocks qualify',sources)[0],/7 is not a figure the source states/u);}
// Mathematics outside $...$ (Fable, live fz-r9 page 14): the source's own
// formula is restored (both languages, by the pair), else sent back once,
// then shown as plain text, never dropped.
{const {sourceRichText}=await import('./lib/ppt-source-text.mjs');
 const mathItems=[{id:'m1',type:'MechanismBlock',text:'- **I/A** — investment-to-assets factor: $I/A = \\Delta \\text{Total Assets} / \\text{Total Assets}_{t-1}$, low-minus-high.',source_ref:['s1'],chunkRefs:['c1'],languagePairId:'lpm'},
  {id:'m2',type:'MechanismBlock',text:'**I/A**——资产投资比因子：$I/A = \\Delta \\text{总资产} / \\text{总资产}_{t-1}$，低减高。',source_ref:['s1'],chunkRefs:['c1'],languagePairId:'lpm'}];
 const text=mathItems.map(item=>item.text).join('\n\n');
 const mathProject={...project,source:{text,sha256:'math',segments:[{id:'s1',text}],semantic:{inventory:{items:mathItems,relationships:[]},chunks:[{id:'c1',text}]}},originalSourceInventory:{items:mathItems,relationships:[]},
  planningContract:{...project.planningContract,logicalCards:[card('cover',[]),card('A',['m1','m2'])]}};
 const mathTask=cardTopicTask(mathProject,mathProject.planningContract.logicalCards[1],1,null),one=points=>({pages:[{title:'Investment factor',numbered:false,visualIntent:'text',points,objects:[]}]});
 const live='I/A = \\Delta Total Assets / Total Assets_{t-1}, low-minus-high | I/A = \\Delta 总资产 / 总资产_{t-1}，低减高';
 assert.ok(!cardTopicProblems(mathProject,mathTask,one([{text:live,sourceUnitIds:['m1','m2']}])).some(problem=>problem.kind==='formula'),'the live point is the source formula');
 const accepted=acceptCardTopic(mathProject,mathTask,one([{text:live,sourceUnitIds:['m1','m2']}]));
 assert.equal(accepted.pages[0].points[0].text,'$I/A = \\Delta \\text{Total Assets} / \\text{Total Assets}_{t-1}$, low-minus-high | $I/A = \\Delta \\text{总资产} / \\text{总资产}_{t-1}$，低减高','both halves carry the exact source spans');
 assert.deepEqual(sourceRichText(accepted.pages[0].points[0].text).diagnostics,[]);
 assert.match(acceptCardTopic(mathProject,mathTask,one([{text:live,sourceUnitIds:['m1']}])).pages[0].points[0].text,/\$I\/A = \\Delta \\text\{总资产\}/u,'the Chinese half is repaired by the pair');
 // A formula the source does not write: sent back with the source's formulas, then plain text.
 const wrong=one([{text:'Sales growth is \\Delta Sales / Sales_{t-1}',sourceUnitIds:['m1']}]),[formula]=cardTopicProblems(mathProject,mathTask,wrong).filter(problem=>problem.kind==='formula');
 assert.match(formula.message,/without \$\.\.\.\$ \("\\Delta Sales \/ Sales_\{t-1\}"\)/u);assert.match(formula.message,/\$I\/A = \\Delta/u,'the message quotes the source formula');
 assert.throws(()=>acceptCardTopic(mathProject,mathTask,wrong),'sent back once');
 const sanitized=sanitizeCardTopic(mathProject,mathTask,wrong);
 // The source's $\\Delta$ stays typeset; the rest shows as text with a real subscript run (Fable, 2026-11-01, M2/M3).
 assert.equal(sanitized.reply.pages[0].points[0].text,'Sales growth is $\\Delta$ Sales / Sales~t-1~','shown as plain text, not dropped');
 assert.ok(sanitized.advisories.some(advisory=>advisory.code==='card_formula_plain')&&!sanitized.advisories.some(advisory=>advisory.code==='card_point_dropped'));
 assert.ok(!cardTopicProblems(mathProject,mathTask,sanitized.reply).some(problem=>problem.kind==='formula'));
 // Existing math is never wrapped across: the rest is sent back.
 const split=one([{text:'I/A = $\\Delta$ Total Assets / Total Assets_{t-1}',sourceUnitIds:['m1']}]);
 assert.ok(acceptCardTopic.length&&cardTopicProblems(mathProject,mathTask,split).some(problem=>problem.kind==='formula'),'not wrapped across existing math');
 // A title with LaTeX is a formula problem too.
 assert.ok(cardTopicProblems(mathProject,mathTask,{pages:[{...one([{text:'Low minus high',sourceUnitIds:['m1']}]).pages[0],title:'Market \\beta_{i} exposure'}]}).some(problem=>problem.kind==='formula'&&/title/u.test(problem.message)));}
// A bilingual point takes the field's standard Chinese term (Fable plan T11): universe is 股票池, never 宇宙.
{const {fixTerminology}=await import('./lib/ppt-terminology-glossary.mjs');
 assert.equal(fixTerminology('A broad universe of weak alphas | 广泛宇宙中的弱因子').text,'A broad universe of weak alphas | 广泛股票池中的弱因子');
 assert.equal(fixTerminology('Profitability and capacity matter | 盈利能力与容量都重要').text,'Profitability and capacity matter | 盈利能力与容量都重要','an accepted term of another word is never touched');
 const termed={pages:[{...good.pages[0],points:[{...good.pages[0].points[0],text:'Production combines 2,000 weak alphas across the universe | 生产在整个宇宙中组合 2,000 个弱因子'},good.pages[0].points[1]]},good.pages[1]]};
 assert.match(acceptCardTopic(project,task,termed,estimate).pages[0].points[0].text,/整个股票池中/u);}
// Card and divider titles are Title Case in their Latin half (Fable plan T18).
{const {titleCase}=await import('./lib/ppt-outline-cards.mjs');
 assert.equal(titleCase('data dictionary and lags'),'Data Dictionary and Lags');assert.equal(titleCase('The q-Factor Model and q5'),'The q-Factor Model and q5');
 assert.equal(titleCase('risk: the hidden cost | 风险：隐藏成本'),'Risk: The Hidden Cost | 风险：隐藏成本');assert.equal(titleCase('q-theory meets iPhone'),'q-theory Meets iPhone');
 // A title taken from a source heading follows the same rule (mlq-r43 p10).
 const {sourceHeadingTitle}=await import('./lib/ppt-outline-cards.mjs');
 const heading={inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{version:2,language:{mode:'output',locale:'en'}},originalSourceInventory:{items:[{id:'u1',sectionPath:['2.2.1 Raw forward return']},{id:'u2',sectionPath:['2.2.1 Raw forward return']}]}};
 assert.equal(sourceHeadingTitle(heading,['u1','u2']),'Raw Forward Return');}
// Source IDs leave no empty brackets behind (Fable r19 E, alpha p14 "可信 [, , , ]"); content brackets and math stay.
assert.equal(stripSourceIds('护栏使挖掘因子可信 [b_0012, b_0013, b_0014, b_0015]'),'护栏使挖掘因子可信');
assert.equal(stripSourceIds('护栏使挖掘因子可信 [, , , ]'),'护栏使挖掘因子可信');
assert.equal(stripSourceIds('Fama and French (1993) (b_0001) show it'),'Fama and French (1993) show it');
assert.equal(stripSourceIds('returns in [0, 1]'),'returns in [0, 1]');
assert.equal(stripSourceIds('the set $[a, b]$ holds ()'),'the set $[a, b]$ holds');
// An object joins only the card of its own section (Fable r16, fz p13); a card of its own needs at least two
// points about that section, else the neighbouring card that names it, else it stays (Fable r19 C, fz-r19 p13).
{const path=leaf=>['Tutorial | 教程','2. Theoretical Lineage | 理论谱系',leaf],sy=path('2.7 Stambaugh-Yuan Mispricing Factors | Stambaugh-Yuan 错误定价因子'),cmp=path('2.8 Model Comparison Table | 模型比较表');
 const unit=(id,type,text,sectionPath,extra={})=>({id,type,text,sectionPath,source_ref:['s1'],chunkRefs:['c1'],...extra});
 const secItems=[unit('y1','MechanismBlock','Stambaugh and Yuan cluster eleven anomalies into two factors.',sy),unit('y2','MechanismBlock','MGMT is dominated by investment and accrual anomalies.',sy),
  unit('y3','EquationBlock','$$r_i - r_f = \\alpha_i + \\beta_i MKT$$',sy),unit('y4','TableBlock','| Model | Factors |\n|---|---|\n| FF3 | 3 |',cmp,{rows:[['Model','Factors'],['FF3','3']]}),
  unit('y5','MechanismBlock','The comparison shows what each factor adds.',cmp),unit('y6','MechanismBlock','The comparison lists each main limitation.',cmp)];
 const text=secItems.map(item=>item.text).join('\n\n');
 const secProject={...project,source:{text,sha256:'sec',segments:[{id:'s1',text}],semantic:{inventory:{items:secItems,relationships:[]},chunks:[{id:'c1',text}]}},originalSourceInventory:{items:secItems,relationships:[]},
  planningContract:{...project.planningContract,logicalCards:[card('cover',[]),card('A',secItems.map(item=>item.id))]}};
 const secTask=cardTopicTask(secProject,secProject.planningContract.logicalCards[1],2,null);
 const pt=(text,ids)=>({text,sourceUnitIds:ids}),cardOf=(title,points,objects=[])=>({title,numbered:false,visualIntent:'text',points,objects});
 const syCard=cardOf('Stambaugh-Yuan Mispricing',[pt('Eleven anomalies cluster into two factors',['y1'])],['y3','y4']),mgmt=cardOf('The MGMT Cluster',[pt('MGMT is dominated by investment and accrual anomalies',['y2'])]);
 const stray=cardTopicProblems(secProject,secTask,{pages:[syCard,mgmt]}).filter(problem=>problem.kind==='object_section');
 assert.equal(stray.length,1,'the §2.7 equation stays; only the §2.8 table is stray');
 assert.match(stray[0].message,/y4 from the section "2\.8 Model Comparison Table \| 模型比较表".*titled "Model Comparison Table \| 模型比较表"/u);
 assert.throws(()=>acceptCardTopic(secProject,secTask,{pages:[syCard,mgmt]}),'sent back once');
 // No points about §2.8 and no neighbour naming it: it stays, listed (never a table alone on a page).
 const stays=sanitizeCardTopic(secProject,secTask,{pages:[syCard,mgmt]});
 assert.deepEqual(stays.reply.pages.map(page=>page.objects),[['y3','y4'],[]]);assert.ok(stays.advisories.some(advisory=>advisory.code==='card_object_section'));
 // Two points about §2.8 on the card: they go with the table to its own card, titled by the heading in the deck language.
 const mixed=cardOf('Stambaugh-Yuan Mispricing',[pt('Eleven anomalies cluster into two factors',['y1']),pt('MGMT is dominated by investment anomalies',['y2']),pt('Both clusters share one driver',['y1','y3']),pt('The comparison shows what each factor adds',['y5']),pt('The comparison lists each main limitation',['y6'])],['y3','y4']);
 const own=sanitizeCardTopic(secProject,secTask,{pages:[mixed,mgmt]});
 assert.deepEqual(own.reply.pages.map(page=>[page.title,page.points.length,page.objects]),[['Stambaugh-Yuan Mispricing',3,['y3']],['Model Comparison Table | 模型比较表',2,['y4']],['The MGMT Cluster',1,[]]]);
 assert.ok(own.advisories.some(advisory=>advisory.code==='card_object_moved'));
 const english={...secProject,generationPolicy:{...secProject.generationPolicy,language:{mode:'output',locale:'en'}}};
 assert.equal(sanitizeCardTopic(english,secTask,{pages:[mixed,mgmt]}).reply.pages[1].title,'Model Comparison Table','a one-language deck titles it in its language');
 // A neighbouring card whose title names the section takes it.
 const notes=cardOf('Model Comparison Notes',[pt('MGMT is dominated by investment and accrual anomalies',['y2'])]);
 assert.deepEqual(sanitizeCardTopic(secProject,secTask,{pages:[syCard,notes]}).reply.pages.map(page=>page.objects),[['y3'],['y4']],'the neighbour that names it');
 // A card of this topic whose points come from §2.8 takes it first.
 const models=cardOf('What Each Model Adds',[pt('The comparison shows what each factor adds',['y5'])]);
 assert.deepEqual(sanitizeCardTopic(secProject,secTask,{pages:[syCard,models]}).reply.pages.map(page=>page.objects),[['y3'],['y4']],'joins the card of its section');
 assert.ok(!cardTopicProblems(secProject,secTask,{pages:[{...syCard,objects:['y3']},{...models,objects:['y4']}]}).some(problem=>problem.kind==='object_section'));
 // Points that follow a numbered source list in order are its steps, whatever the model's flag (Fable plan T31).
 {const {followsSourceList}=await import('./lib/ppt-outline-cards.mjs');
  const gauntlet=new Map([['g',{id:'g',text:'1. Sanity check the raw signal\n2. Neutralize against risk factors\n3. Test turnover and capacity\n4. Validate out of sample'}]]);
  const steps=texts=>({points:texts.map(text=>({text,sourceUnitIds:['g']}))});
  assert.ok(followsSourceList(steps(['Sanity check the raw signal first','Neutralize the signal against risk factors','Test turnover and capacity limits','Validate everything out of sample']),gauntlet));
  assert.ok(!followsSourceList(steps(['Neutralize the signal against risk factors','Sanity check the raw signal first','Test turnover and capacity limits']),gauntlet),'out of order');
  assert.ok(!followsSourceList(steps(['Momentum persists for months','Value earns a premium','Size matters less now']),gauntlet),'not the list');}
 // An object the source gives once per language shows once, in the deck's primary language (Fable plan T26, mlq p30/p31).
 {const {objectPairs}=await import('./lib/ppt-object-pairs.mjs');
  const en=unit('d1','CodeBlock','Timeline (left = past):\n|-- train --|-- purge --|== VALIDATION ==|\nPurge region: removes rows',cmp),zh=unit('d2','CodeBlock','时间轴(左 = 过去):\n|-- 训练 --|-- 净化 --|== 验证折 ==|\n净化区域：移除训练行',cmp);
  const pairItems=[...secItems,en,zh],pairProject={...secProject,originalSourceInventory:{items:pairItems,relationships:[]},source:{...secProject.source,semantic:{...secProject.source.semantic,inventory:{items:pairItems,relationships:[]}}},inputUnderstanding:{primaryLanguage:'en'}};
  assert.deepEqual([...objectPairs(pairProject)],[['d2','d1']],'the Chinese copy folds into the English one');
  const pairTask={...secTask,ids:[...secTask.ids,'d1','d2'],objectIds:[...secTask.objectIds,'d1','d2']};
  const shown=sanitizeCardTopic(pairProject,pairTask,{pages:[cardOf('Purged K-Fold',[pt('The comparison shows what each factor adds',['y5'])],['d2']),cardOf('Embargo',[pt('The comparison lists each main limitation',['y6'])],['d1'])]});
  assert.deepEqual(shown.reply.pages.map(page=>page.objects),[['d1'],[]],'shown once, in English, on the first card');}
 // A card title that joins two section headings goes back once, then takes the first heading (Fable plan T14).
 {const joined={...secTask,card:{...secTask.card,sections:[{title:'Why Factors Earn Premia',titleSecondary:'因子为何有溢价'},{title:'Factor Zoo',titleSecondary:'因子动物园'}]}};
  const bad={pages:[cardOf('Why Factors Earn Premia · Factor Zoo',[pt('Eleven anomalies cluster into two factors',['y1'])]),mgmt]};
  assert.ok(cardTopicProblems(secProject,joined,bad).some(problem=>problem.kind==='title_join'));
  assert.ok(!cardTopicProblems(secProject,joined,{pages:[cardOf('Where Factor Premia Come From',[pt('Eleven anomalies cluster into two factors',['y1'])]),mgmt]}).some(problem=>problem.kind==='title_join'));
  assert.equal(sanitizeCardTopic(secProject,joined,bad).reply.pages[0].title,'Why Factors Earn Premia | 因子为何有溢价');
  // A title that only names its section, a subject in front or not, goes back once (the user, 2026-11-01, A).
  const label=title=>cardTopicProblems(secProject,joined,{pages:[cardOf(title,[pt('Eleven anomalies cluster into two factors',['y1'])]),mgmt]}).some(problem=>problem.kind==='title_label');
  assert.ok(label('Factor Zoo'));assert.ok(label('SY Factor Zoo'));
  assert.ok(!label('Eleven Anomalies Form Two Factors'));
  assert.ok(!label('Why Factors Earn Premia · Factor Zoo'),'a two-heading join is the title_join check');}
 // A Chinese-primary deck measures its titles' Chinese half, never the English half (Fable 2026-10-25).
 {const zh={...secProject,inputUnderstanding:{...secProject.inputUnderstanding,primaryLanguage:'zh'}};
  const longEnglish='A very long English rendering of the title that runs well past any slot budget for a title | 因子定价';
  assert.ok(!cardTopicProblems(zh,secTask,{pages:[cardOf(longEnglish,[pt('Eleven anomalies cluster into two factors',['y1'])]),mgmt]}).some(problem=>problem.kind==='length'&&/^Card 1/u.test(problem.message)),'the Chinese half fits');}
 // A section of 300+ characters is never left without a point (Fable plan T27): sent back once, then a short source excerpt.
 const covered={...secProject,inputUnderstanding:{...secProject.inputUnderstanding,sections:[{title:'Stambaugh-Yuan',ids:['y1','y2','y3'],chars:900},{title:'Model Comparison',ids:['y4','y5','y6'],chars:420},{title:'Tiny',ids:['y6'],chars:120}]}};
 const onlySy={pages:[cardOf('Stambaugh-Yuan Mispricing',[pt('Eleven anomalies cluster into two factors',['y1'])],['y3']),mgmt]};
 const missing=cardTopicProblems(covered,secTask,onlySy).filter(problem=>problem.kind==='section');
 assert.equal(missing.length,1);assert.match(missing[0].message,/"Model Comparison" \(420 characters\)/u);
 const restored=sanitizeCardTopic(covered,secTask,onlySy);
 assert.ok(restored.reply.pages.some(page=>page.points.some(point=>point.sourceUnitIds.includes('y5'))),'an excerpt of the section is added');
 assert.ok(restored.advisories.some(advisory=>advisory.code==='card_section_restored'));
 assert.ok(!cardTopicProblems(covered,secTask,restored.reply).some(problem=>problem.kind==='section'));
 // A topic that joins sections holds one more point per card, so a merged leaf keeps its point.
 const six={pages:[cardOf('Stambaugh-Yuan Mispricing',Array.from({length:6},(_,k)=>pt('Point '+k+' about mispricing',['y1']))),mgmt]};
 const merged={...secTask,card:{...secTask.card,sections:[{title:'Stambaugh-Yuan'},{title:'Model Comparison'}]}},single={...secTask,card:{...secTask.card,sections:[{title:'Stambaugh-Yuan'}]}};
 assert.ok(!cardTopicProblems(covered,merged,six).some(problem=>problem.kind==='shape'&&/at most/u.test(problem.message)),'six points on a merged topic');
 assert.ok(cardTopicProblems(covered,single,six).some(problem=>problem.kind==='shape'&&/at most 5/u.test(problem.message)),'five on a single section');}
// A card is numbered only when every point comes from a source list (Fable review, alpha-r9 p11).
{const listItems=[{id:'l1',type:'ChecklistBlock',text:'- Audit the data\n- Check IC\n- Test unseen dates',source_ref:['s1']},{id:'l2',type:'MechanismBlock',text:'Combine the survivors.',source_ref:['s1']}];
 const listProject={...project,originalSourceInventory:{items:listItems,relationships:[]},source:{...project.source,semantic:{inventory:{items:listItems,relationships:[]},chunks:[]}}};
 const numbered=points=>assembleCardOutline(listProject,[{card:project.planningContract.logicalCards[1]}],[{pages:[{title:'Checks',numbered:true,visualIntent:'process',points,objects:[]}]}]);
 const fromList=numbered([{text:'Audit the data',sourceUnitIds:['l1']},{text:'Check IC',sourceUnitIds:['l1']}]);
 assert.equal(fromList.slides[1].numberedPoints,true);assert.equal(fromList.notes,undefined);
 const mixed=numbered([{text:'Audit the data',sourceUnitIds:['l1']},{text:'Combine the survivors',sourceUnitIds:['l2']}]);
 assert.equal(mixed.slides[1].numberedPoints,undefined,'a point outside the list: not numbered');assert.equal(mixed.notes[0].code,'card_numbering_dropped');}
// Joined source list items (report 4ed33bce, 3143 o61): two item leads go back
// once; item numbers inside a point are the 'list' check; one item passes.
{const withList={...project,originalSourceInventory:{items:items.map(item=>item.id==='u5'?{...item,text:'The gauntlet:\n1. Data audit of timestamps\n2. IC and ICIR decay curve\n3. Quantile spread checks'}:item),relationships:[]}};
 const reply=text=>({pages:[good.pages[0],page([{text,sourceUnitIds:['u5']}],['u4'])]});
 const kindsOf=text=>cardTopicProblems(withList,task,reply(text),estimate).map(problem=>problem.kind);
 assert.ok(kindsOf('Data audit of timestamps; IC and ICIR decay curve').includes('list_join'),'two item leads go back');
 assert.ok(kindsOf('Data audit of timestamps; 2. IC and ICIR decay curve').includes('list')&&!kindsOf('Data audit of timestamps; 2. IC and ICIR decay curve').includes('list_join'),'embedded numbers are the list check');
 assert.ok(!kindsOf('IC and ICIR decay curve').includes('list_join'),'one item passes');}
// Quantity qualifiers are named in the card prompts (report 135c362b; 3143 o55, o58, o63).
assert.ok(cardTopicTask(project,project.planningContract.logicalCards[1],2,estimate).prompt.includes('"3,700 trading days" never becomes "3,700 days"'));
// Confirmation refuses a card point the publish gate would block, checked live
// with the gate's rules; editing the point clears it (report 98981dcf).
{const {cardFactIssues}=await import('./lib/ppt-content-qa.mjs');
 const deck=points=>({...project,source:{...project.source,segments:[{id:'s1',text:'x'}],semantic:{...project.source.semantic,evidenceAtoms:[],inventory:{items:[{id:'u1',text:'x'}]},chunks:[{id:'c1',text:'Searching 15 years of data (roughly 3,700 trading days) is costly.'}]}},
  outline:[{title:'Cover'},{title:'Search',refs:[],chunkRefs:['c1'],keyPoints:points.map(text=>({text}))}]});
 const found=cardFactIssues(deck(['Searching ~3,700 days is costly','Compose α = g(f_{i_1}, θ)']));
 assert.deepEqual(found.map(issue=>[issue.code,issue.pageIndex]),[['card_quantity_unstated',1],['card_math_untypeset',1]]);
 assert.ok(found[0].message.includes('3,700 trading days'),'names the source words: '+found[0].message);
 assert.deepEqual(cardFactIssues(deck(['Searching ~3,700 trading days is costly','Compose $\\alpha = g(f_{i_1}, \\theta)$'])),[],'the edited points pass');
 // A point from a PDF's approximate formula text publishes with its page flagged (2026-11-01, CodePilot PDF on Blue).
 {const pdf=deck(['Compose α = g(f_{i_1}, θ)']);pdf.outline[1].keyPoints[0].sourceUnitIds=['u1'];
  pdf.source={...pdf.source,segments:[{id:'s1',text:'x',location:'第 3 页'}],mediaWarnings:[{code:'source_pdf_math_requires_confirmation',pages:[3]}],semantic:{...pdf.source.semantic,inventory:{items:[{id:'u1',text:'x',source_ref:['s1']}]}}};
  assert.deepEqual(cardFactIssues(pdf).map(issue=>issue.code),[],'an approximate PDF formula does not block confirmation');}
 // One targeted rewrite (report 013a8282): kept only when it clears its issue
 // and changes no other quantity or formula.
 const {cardFactRepairTask,acceptCardFactRepair}=await import('./lib/ppt-outline-cards.mjs');
 const page=deck(['Searching ~3,700 days is costly, about 12 hours of compute']);page.source.semantic.chunks[0].text+=' Each run takes about 12 hours.';
 const [issue]=cardFactIssues(page);assert.equal(cardFactIssues(page).length,1);
 const task=cardFactRepairTask(page,page.outline,issue);
 assert.ok(task.prompt.includes('3,700 days')&&task.prompt.includes('roughly 3,700 trading days'),'the prompt names the quantity and the source words');
 const accept=text=>acceptCardFactRepair(page,page.outline,issue,{text},cardFactIssues);
 assert.equal(accept('Searching ~3,700 trading days is costly, about 12 hours of compute'),'Searching ~3,700 trading days is costly, about 12 hours of compute');
 assert.equal(accept('Searching ~3,700 trading days is costly, about 20 hours of compute'),null,'another quantity changed');
 assert.equal(accept('Searching ~3,700 days is very costly, about 12 hours of compute'),null,'the issue remains');
 assert.equal(accept('Searching ~3,700 trading days is costly, about 12 hours of compute $x_1$'),null,'a new formula');
 // An assembled deck carries its sources on the points until the outline is normalized.
 assert.deepEqual(cardFactIssues({...page,outline:[{title:'Cover'},{title:'Search',keyPoints:[{text:'Searching ~3,700 trading days is costly',chunkRefs:['c1'],refs:[]}]}]}),[],'point-level sources count');}
console.log('PPT outline cards: per-topic tasks, deterministic checks (count, units, duplicates, numbers, required, fit, IDs), sanitizing, assembly, the publish gate, soft card count, no locks, and the author edits: OK');
// Section labels drop the tutorial's section numbers (Fable, 2026-10-24).
{const {_cardLayoutInternals:{sectionFor}}=await import('./lib/ppt-outline-cards.mjs');
 const headings=new Map([['h1',{sectionPath:['Tutorial 10','11 Worked Example']}],['h2',{sectionPath:['2.3 Search Methods']}]]);
 assert.deepEqual([['h1'],['h2']].map(ids=>sectionFor({title:'End-to-End Loop'},{title:'End-to-End Loop'},ids,headings)),['Worked Example','Search Methods']);
 assert.equal(sectionFor({title:'1. What Alpha Mining Is'},{title:'Two Research Paradigms'},[],null),'What Alpha Mining Is','a numbered topic title too');
 assert.equal(sectionFor({title:'2×3 Sorts'},{title:'Other'},[],null),'2×3 Sorts','a leading number that is part of the name stays');
 console.log('PASS section labels without source section numbers');}

process.exit(0);
