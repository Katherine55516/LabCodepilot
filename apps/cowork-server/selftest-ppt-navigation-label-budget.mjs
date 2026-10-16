import assert from 'node:assert/strict';
import {prepareNavigationPlan,navigationResponseSchema}from './lib/ppt-navigation-plan.mjs';
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
 return {version:1,checks:[{groupIndex:0,faithful:false,reason:'The media and export subjects are missing'}]};
}),/independent label audit failed/);
assert.equal(attempts,3,'a shorter but misleading label remains blocked within the original finite budget');
console.log('Navigation schema obeys measured label width; exact ledger ownership, independent semantic audit and finite retries remain enforced: OK');
