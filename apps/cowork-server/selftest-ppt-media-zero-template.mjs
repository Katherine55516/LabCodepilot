import assert from 'node:assert/strict';
import{buildMediaLedger,inspectMediaLedger}from'./lib/ppt-media-ledger.mjs';
const p={templateContentMode:'keep_fixed',templateFidelity:{mode:'preserve',width:12192000,height:6858000,slides:[{nodes:[{id:'legal',type:'text',content:{text:'2024 · Internal',mustPreserve:true}}]}]},deck:{slides:[{id:'page',nodes:[{id:'legal',type:'text',nativeRef:{shapeId:1},content:{text:'2024 · Internal',mustPreserve:true}}]}]}};
const empty=buildMediaLedger(p,p.deck.slides,{templateAssets:[]});assert.equal(empty.roleWeightedEffectiveConservation,null);assert.equal(empty.roleWeightedConservation,null);assert.deepEqual(inspectMediaLedger(empty),[],'a text-only template has no media conservation denominator, not zero-percent retained media');
for(const role of ['brand','evidence','template_icon']){
 const dropped=buildMediaLedger(p,p.deck.slides,{templateAssets:[{slideId:'page',objectId:'missing',role,status:'missing'}]});assert.equal(dropped.roleWeightedEffectiveConservation,0);assert.ok(inspectMediaLedger(dropped).some(i=>i.code==='media_weighted_conservation_blocked'));
 const kept=buildMediaLedger(p,p.deck.slides,{templateAssets:[{slideId:'page',objectId:'kept',role,status:'retained'}]});assert.equal(kept.roleWeightedEffectiveConservation,1);assert.ok(!inspectMediaLedger(kept).some(i=>i.severity==='error'));
}
console.log('No media means conservation is not applicable; real missing brand/evidence/icons remain blocked and retained media still measures 100%.');
