import assert from 'node:assert/strict';
import {semanticGroupId,semanticGroupRepairTargets,applySemanticGroupPatches,prepareSemanticGroups,semanticGroupsPrompt,semanticPlanningResponseSchema} from './lib/ppt-semantic-groups.mjs';
const items=Array.from({length:26},(_,i)=>({id:'u'+i,text:'Source '+i,type:'MechanismBlock',sectionPath:['Topic'],chunkRefs:['c'+i]}));
const raw={version:2,groups:[0,1].map(i=>({title:'Topic '+i,readerQuestion:'Question '+i,coreMessage:'Distinct source mechanism '+i,narrativeRole:i?'conclusion':'orientation',pages:1,sourceUnitIds:items.slice(i*13,(i+1)*13).map(x=>x.id),supportRoles:items.slice(i*13,(i+1)*13).map(x=>({sourceUnitId:x.id,role:'mechanism'}))}))};
const p={pages:10,pageDecision:{mode:'auto'},generationPolicy:{version:2,detail:'standard',content:'overview',selection:'editorial',archive:'none',language:{mode:'source'},knowledge:'source_only'},source:{sha256:'s',text:'Complete source',semantic:{inventory:{items,relationships:[]}}}};
assert.doesNotMatch(semanticGroupsPrompt(p),/full original detail in notes|visible\/notes\/summary/);
const bad=structuredClone(raw);bad.groups[0].supportRoles.pop();const details={index:0};
const target=semanticGroupRepairTargets(bad,details)[0],other=semanticGroupId(raw.groups[1]);
assert.equal(semanticGroupId({...raw.groups[1],title:'Rewritten title',sourceUnitIds:[...raw.groups[1].sourceUnitIds].reverse()}),other,'ID ignores model ordering/copy');
const patched=applySemanticGroupPatches(bad,details,{version:1,patches:[{id:other,group:{title:'Unauthorized rewrite'}},{id:target.id,group:raw.groups[0]}]});
assert.deepEqual(patched.candidate,raw);assert.equal(patched.dropped[0].code,'repair_out_of_scope');assert.deepEqual(bad.groups[1],raw.groups[1]);
assert.throws(()=>applySemanticGroupPatches(bad,details,{version:1,patches:[{id:other,group:raw.groups[1]}]}),/omitted a required target/);
let stages=[];
await prepareSemanticGroups(p,async(prompt,stage)=>{
 stages.push(stage);if(stage==='outline:semantic-groups')return bad;
 if(stage==='outline:semantic-groups:contract'){
  assert.match(prompt,/Return \{version:1,patches/);assert.equal(semanticPlanningResponseSchema(p,stage).properties.patches.items.properties.id.enum[0],target.id);
  return {version:1,patches:[{id:other,group:{...raw.groups[1],title:'Forbidden rewrite'}},{id:target.id,group:raw.groups[0]}]};
 }
 if(stage==='outline:semantic-editorial')return {version:1,merges:[]};throw Error(stage);
});
assert.deepEqual(stages,['outline:semantic-groups','outline:semantic-groups:contract','outline:semantic-editorial']);
assert.equal(p.semanticGrouping.groups[1].title,raw.groups[1].title);
assert.equal(p.semanticRepairWarnings.length,1);
assert.equal(p.semanticGrouping.groups[1].id,other);
console.log('Stable semantic IDs, scoped patch schema/merge, dropped unauthorized writes and strict missing-target validation: OK');

assert.doesNotThrow(()=>semanticGroupId({sourceUnitIds:42}),'malformed wire fields remain contract diagnostics, not JS iteration crashes');
const multiple=structuredClone(p);delete multiple.semanticGrouping;delete multiple.semanticRepairWarnings;
const twoBad=structuredClone(raw);twoBad.groups.forEach(g=>g.supportRoles.pop());let repairs=0;
await prepareSemanticGroups(multiple,async(prompt,stage)=>{
 if(stage==='outline:semantic-groups')return twoBad;
 if(stage==='outline:semantic-editorial')return {version:1,merges:[]};
 assert.equal(stage,'outline:semantic-groups:contract');
 const packet=JSON.parse(prompt.split('<group_contract_repair>')[1].split('</group_contract_repair>')[0]);
 // Validation lists every invalid group, so one scoped repair targets all.
 assert.deepEqual(packet.targets.map(t=>t.index),[0,1]);assert.deepEqual(packet.details.problems.map(problem=>problem.index),[0,1]);
 for(const t of packet.targets)assert.ok(packet.allowedSourceDirectory.some(item=>item.id===raw.groups[t.index].sourceUnitIds[0]));
 repairs++;return {version:1,patches:packet.targets.map(t=>({id:t.id,group:raw.groups[t.index]}))};
});
assert.equal(repairs,1);assert.deepEqual(multiple.semanticGrouping.groups.map(g=>g.sourceUnitIds),raw.groups.map(g=>g.sourceUnitIds));
console.log('Multiple invalid groups are listed together and repaired by one scoped call; targets retain exact ownership');
