import assert from 'node:assert/strict';
import {prepareNavigationPlan,navigationResponseSchema,applyNavigationLabelDelta}from './lib/ppt-navigation-plan.mjs';
import {templateVisualUnits}from './lib/ppt-presentation-writing.mjs';

const project={source:{text:'The presentation engine, media pipeline and export architecture'},outline:[{id:'cover'},{id:'nav',role:'navigation'}]};
const entries=['Presentation Engine','Media Pipeline','Export Architecture'].map((section,i)=>({section,displayLabel:section+' with complete source responsibilities and integration',targets:[{slideId:'source-'+i,page:i+3}]}));
const source=JSON.stringify(project.source);let plans=0,audits=0,characterLimit;
await prepareNavigationPlan(project,entries,async prompt=>{
 if(prompt.includes('Navigation Plan Schema=')){
  const schema=navigationResponseSchema(prompt);characterLimit=schema.properties.groups.items.properties.label.maxLength;
  assert.ok(characterLimit<38,'the schema itself must reject the observed overlong label, rather than only asking the model to count visual units');
  plans++;
  if(plans===2)assert.match(prompt,/rejected_navigation/);
  return {version:1,groups:[{label:plans===1?'Presentation Engine and Media Pipeline':'Engine, Media & Export',memberIndexes:[0,1,2]}]};
 }
 audits++;return {version:1,checks:[{groupIndex:0,faithful:true,reason:'Engine, media and export all retain their original topic'}]};
});
assert.equal(plans,2);assert.equal(audits,1);assert.equal(project.navigationPlan.audit.status,'passed');
assert.ok(project.navigationPlan.groups.every(g=>g.label.length<=characterLimit&&templateVisualUnits(g.label)<=project.navigationPlan.limits.maxVisualUnits));
assert.deepEqual(project.navigationPlan.groups.flatMap(g=>g.memberIndexes),[0,1,2]);
assert.equal(JSON.stringify(project.source),source);
// Width is still validated after the schema; multibyte characters and a
// rejected semantic audit cannot bypass the same bounded three attempts.
let attempts=0;
await assert.rejects(()=>prepareNavigationPlan({...project,navigationPlan:undefined},entries,async prompt=>{
 if(prompt.includes('Navigation Plan Schema=')){attempts++;return {version:1,groups:[{label:'Engine only',memberIndexes:[0,1,2]}]};}
 if(prompt.includes('Navigation Label Repair Schema=')){attempts++;return {version:1,updates:[{groupIndex:0,label:'Engine only'}]};}
 return {version:1,checks:[{groupIndex:0,faithful:false,reason:'The media and export subjects are missing'}]};
}),/independent label audit failed/);
assert.equal(attempts,3,'a shorter but misleading label remains blocked within the original finite budget');
console.log('Navigation schema obeys measured label width; exact ledger ownership, independent semantic audit and finite retries remain enforced: OK');

// A critic must receive explicit source names nested under each group. A
// failure only reopens that label; already accepted labels/members never move.
const local={...project,navigationPlan:undefined,navigationDraft:undefined};let initialCalls=0,localAudits=0,localRepairs=0,saves=0;
const localEntries=['Architecture','Collaboration','Latency'].map((section,i)=>({section,displayLabel:section+' with a long complete source topic name',targets:[{slideId:'local-'+i,page:i+3}]}));
await prepareNavigationPlan(local,localEntries,async prompt=>{
 if(prompt.includes('Navigation Plan Schema=')){initialCalls++;return {version:1,groups:[{label:'Architecture',memberIndexes:[0]},{label:'Collaboration',memberIndexes:[1]},{label:'Wrong subject',memberIndexes:[2]}]};}
 if(prompt.includes('Navigation Label Repair Schema=')){localRepairs++;const bad=JSON.parse(prompt.match(/<failed_groups>(.*?)<\/failed_groups>/su)[1]);assert.deepEqual(bad.map(g=>g.groupIndex),[2]);assert.equal(bad[0].assignedSections[0].section,'Latency');return {version:1,updates:[{groupIndex:2,label:'Latency'}]};}
 localAudits++;const groups=JSON.parse(prompt.match(/<groups>(.*?)<\/groups>/su)[1]);assert.ok(groups.every(g=>g.assignedSections.every(s=>s.section===localEntries[s.index].section)));
 if(localAudits===2)assert.deepEqual(groups.map(g=>g.groupIndex),[2],'accepted groups are not repeatedly judged while repairing another label');
 return {version:1,checks:groups.map(g=>({groupIndex:g.groupIndex,faithful:g.label!=='Wrong subject',reason:g.label==='Wrong subject'?'Assigned section is Latency.':'The complete assigned subject is retained.'}))};
},async()=>{saves++;});
assert.equal(initialCalls,1);assert.equal(localRepairs,1);assert.equal(localAudits,2);assert.ok(saves>=2);assert.equal(local.navigationPlan.audit.status,'passed');assert.equal(local.navigationDraft,undefined);assert.deepEqual(local.navigationPlan.groups.map(g=>g.memberIndexes),[[0],[1],[2]]);
const before=JSON.stringify(local.navigationPlan);
assert.throws(()=>applyNavigationLabelDelta(local.navigationPlan,[2],{version:1,updates:[{groupIndex:0,label:'Overwritten'}]}),/diagnosed groups/);
assert.throws(()=>applyNavigationLabelDelta(local.navigationPlan,[2],{version:1,updates:[{groupIndex:2,label:'Latency',memberIndexes:[0]}]}),/memberships/);
assert.throws(()=>applyNavigationLabelDelta(local.navigationPlan,[2],{version:1,updates:[]}),/diagnosed groups/);
assert.equal(JSON.stringify(local.navigationPlan),before);
