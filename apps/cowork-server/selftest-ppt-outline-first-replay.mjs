// F0 replay: actual qwen3.8-max outline-first replies from one Factor Zoo run
// (test/fixtures/ppt-qwen-outline-first-factor-zoo.json) go through the semantic
// planning contract and the card outline's measured topic quotas. Source prose is
// omitted. The capacity allocation, materialization and editorial replays went
// with the ledger outline path (removed 2026-10-22, R1-R8).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from './lib/ppt-outline-first.mjs';
import {failureTrace} from './lib/ppt-failure-trace.mjs';
const fx=JSON.parse(fs.readFileSync(new URL('./test/fixtures/ppt-qwen-outline-first-factor-zoo.json',import.meta.url)));
const items=fx.inventory.map(i=>({id:i.id,type:i.type,...(i.languagePairId?{languagePairId:i.languagePairId}:{}),text:'Source unit '+i.id+' (omitted).',...(i.rowCount?{rows:Array.from({length:i.rowCount},()=>['…'])}:{})}));
const project=()=>({model:'qwen3.8-max',configId:'fixture',pages:12,prompt:'Factor Zoo',templateSpec:{},generationPolicy:structuredClone(fx.policy),
 inputUnderstanding:{readManifest:{status:'complete_delivery'}},source:{text:'',sha256:'factor-zoo-fixture',semantic:{inventory:{items:structuredClone(items),relationships:[]}}},
 planningContract:{version:3,phase:'semantic_planning',contentMode:null,logicalCards:[],pagePreference:null}});
const code=fn=>{try{fn();return null;}catch(error){return error;}};

// 1. Semantic outline without a cover card: detected; the cover repair applies.
let p=project();
assert.match(code(()=>engine.acceptSemantic(p,{cards:fx.semantic.noCover})).message,/cover cannot own/);
const cover=engine.semanticCoverRepairTask(p,{cards:fx.semantic.noCover});assert.ok(cover,'a missing cover yields a bounded cover task');
const withCover=engine.applySemanticCoverRepair({cards:fx.semantic.noCover},cover,{title:'Tutorial 04 — The Factor Zoo',titleSecondary:'',intent:'Orient the reader',points:['Theory, taxonomy and practice']});
assert.deepEqual(withCover.cards.slice(1).map(c=>c.sourceUnitIds),fx.semantic.noCover.map(c=>c.sourceUnitIds),'content ownership is frozen by the cover repair');
assert.equal(engine.acceptSemantic(p,withCover).logicalCards.length,fx.semantic.noCover.length+1,'with the inserted cover the actual reply is a valid contract');

// 2. A covered-except-two reply: exactly the intro pair is missing.
assert.equal(code(()=>engine.acceptSemantic(p,{cards:fx.semantic.uncovered})).code,'semantic_coverage_invalid');
assert.deepEqual(engine.semanticCoverageRepairTask(p,{cards:fx.semantic.uncovered}).missing,['b_0002','b_0003']);

// 3. The reply that was repaired in production: the actual coverage repair makes it acceptable.
const coverage=engine.semanticCoverageRepairTask(p,{cards:fx.semantic.repairable});
assert.deepEqual(coverage.missing,fx.semantic.coverageRepair.assignments.map(a=>a.sourceUnitId));
const repaired=engine.applySemanticCoverageRepair({cards:fx.semantic.repairable},coverage,fx.semantic.coverageRepair);
const contract=engine.acceptSemantic(p,repaired);
assert.deepEqual(contract.logicalCards.map(c=>c.title),fx.acceptedCards.map(c=>c.title),'the replayed contract equals the accepted production outline');
p.planningContract={...contract,contentMode:fx.contentMode,pagePreference:fx.pagePreference};

// 9. F1: every replayed real failure yields a classified trace with concrete
//    evidence (page, field or source IDs), never a message alone.
const traced=(error)=>failureTrace({stage:'outline',error,project:{template:'process-improvement',templateFidelity:{mode:'preserve'}}});
const fresh=project();
const evidence=[
 ['cover',code(()=>engine.acceptSemantic(fresh,{cards:fx.semantic.noCover})),'planning',t=>t.pageIndex===0&&t.sourceUnitIds.length>0],
 ['coverage',code(()=>engine.acceptSemantic(fresh,{cards:fx.semantic.uncovered})),'planning',t=>t.sourceUnitIds.join()==='b_0002,b_0003'],
];
for(const [name,error,cls,has] of evidence){const t=traced(error);assert.equal(t.class,cls,name);assert.ok(has(t),name+' trace carries concrete evidence: '+JSON.stringify(t));}

// 15. C1 on the real cards: measured unit heights of cd5a2737 (no prose).
//     The card outline sets each topic's cards from this estimate.
const lm=fx.loadModel,capacityB=engine.layoutCapacity(lm.layouts);
// Basis B: capacity is the mean body area of all 7 native content layouts (2.92-5.73 in tall,
// 6.6-11.9 in wide), as an equivalent height at the largest layout's width - not page 1's layout.
assert.deepEqual([capacityB.layouts,capacityB.reference.heightInches,capacityB.reference.widthInches,capacityB.availableHeightInches.toFixed(2)],[7,5.73,11.73,'4.19']);
const estimate=engine.estimateTopicLoads(p.planningContract.logicalCards,lm.unit,capacityB.availableHeightInches);
assert.ok(engine.estimateTopicLoads(p.planningContract.logicalCards,lm.unit,2.92).modes.concise.pages>=35,'the version-1 basis (page 1 got the 2.92 in layout after the 22-page plan) jumped to 36 pages for the same content');
assert.deepEqual(Object.fromEntries(Object.entries(estimate.modes).map(([m,v])=>[m,v.pages])),lm.production,'the replay reproduces the production estimate');
assert.ok(Math.abs(estimate.modes.standard.heightInches-lm.actualStandardInches)/lm.actualStandardInches<0.05,'calibrated: standard estimate '+estimate.modes.standard.heightInches+' in vs accepted plan '+lm.actualStandardInches+' in');
assert.ok(estimate.modes.concise.pages<estimate.modes.standard.pages&&estimate.modes.standard.pages<estimate.modes.detailed.pages);

// 25. Cards per topic: on 12_ml_quant (7976bd9a, concise, max 45; 198 units,
//     12 topics) one whole-deck reply gave topics 1-5 two to three times their
//     measured need and left six topics without a page. Code fixes each topic's
//     count from the measured load (topicPageQuotas); the card writer fills it.
const mtCard=(id,ids,optional=[])=>({id,title:'Topic '+id+' | 主题'+id,titleSecondary:'',intent:'Why '+id+' matters',points:['p'],sourceUnitIds:ids,optionalSourceUnitIds:optional,dependsOn:[],locked:false});
const mtItems=['u1','u2','u3','u4','u5','u6','u7','u8','u9','u10','u11'].map(id=>({id,type:id==='u9'?'EquationBlock':'MechanismBlock',text:'Text of '+id,...(['u3','u4'].includes(id)?{languagePairId:'lp3'}:['u7','u8'].includes(id)?{languagePairId:'lp7'}:{})}));
// u11 is listed by no card: it has no topic and is left out of the deck.
const mtProject={id:'m'.repeat(32),uid:'mt',generationPolicy:structuredClone(fx.policy),source:{text:'',sha256:'mt',semantic:{inventory:{items:mtItems,relationships:[]}}},originalSourceInventory:{items:mtItems},
 planningContract:{version:3,phase:'expanding',contentMode:'concise',pagePreference:{mode:'adaptive',target:6,max:8},logicalCards:[mtCard('cover',[]),mtCard('A',['u1','u2','u3','u4']),mtCard('B',['u5','u6','u7','u8']),mtCard('C',['u9','u10'])]}};
const mtEstimate={availableHeightInches:5,unit:Object.fromEntries(mtItems.map(i=>[i.id,{heightInches:4,frozen:false}])),modes:{concise:{pages:5,byCard:[{logicalCardId:'A',pages:1,heightInches:4},{logicalCardId:'B',pages:2,heightInches:6},{logicalCardId:'C',pages:3,heightInches:4}]}}};
const mtTopics=engine.unitTopics(mtProject);
assert.deepEqual(['u4','u11'].map(id=>mtTopics.get(id)),['A',undefined],'topics follow the approved cards; an unlisted unit has none');
const mtQuotas=engine.topicPageQuotas(mtProject,mtEstimate);
assert.deepEqual(mtQuotas.map(q=>[q.card.id,q.quota]),[['A',1],['B',2],['C',2]],'the measured need (C measures 3 but has 2 atoms), at most one page per atom');
const mtFixed=engine.topicPageQuotas({...mtProject,planningContract:{...mtProject.planningContract,pagePreference:{mode:'fixed',exact:8}}},mtEstimate);
assert.equal(mtFixed.reduce((n,q)=>n+q.quota,0),7,'a fixed count is filled (cover excluded)');assert.ok(mtFixed.every(q=>q.quota>=mtQuotas.find(o=>o.card.id===q.card.id).quota));
assert.equal(engine.topicPageQuotas(mtProject,null),null,'no estimate: no quotas');
// A unit the policy can only leave out (12_ml_quant: code blocks under code: omit)
// is no atom of its topic: it is not offered to the card writer.
const mtCodeItems=[...mtItems,{id:'u12',type:'CodeBlock',text:'def f(x):\n    return x'}];
const mtCode={...mtProject,generationPolicy:{...mtProject.generationPolicy,code:{presentation:'omit'}},source:{...mtProject.source,semantic:{inventory:{items:mtCodeItems,relationships:[]}}},originalSourceInventory:{items:mtCodeItems},planningContract:{...mtProject.planningContract,logicalCards:mtProject.planningContract.logicalCards.map(card=>card.id==='B'?{...card,sourceUnitIds:[...card.sourceUnitIds,'u12']}:card)}};
assert.ok(engine.policyExcluded(mtCode,'u12')&&!engine.policyExcluded(mtCode,'u5'));
const mtCodeEstimate={...mtEstimate,unit:{...mtEstimate.unit,u12:{heightInches:4,frozen:true}}};
assert.deepEqual(engine.topicPageQuotas(mtCode,mtCodeEstimate).map(q=>q.quota),[1,2,2],'an omitted code block is no atom');

console.log('PPT outline-first replay: semantic cover and coverage repairs replayed from real Qwen replies, classified failure traces, the C1 estimate and the card quotas per topic: OK');
process.exit(0);
