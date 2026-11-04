import assert from 'node:assert/strict';
import {fitComponents} from './lib/ppt-density-capacity.mjs';
import {fitSourceLayout} from './lib/ppt-source-layout-fit.mjs';
import {defaultGenerationPolicy,normalizeGenerationPolicy} from './lib/ppt-generation-policy.mjs';
const p={generationPolicy:defaultGenerationPolicy(),outline:[{id:'cover'},{id:'body',title:'Conditions'}]};
let sample;
for(let length=10;length<180;length+=1){
 const components=[{type:'text',content:{text:'Source fact and condition. '.repeat(length)}}];
 const original=fitComponents(components,p,1);
 if(original.capacity_ok)continue;
 const fitted=fitSourceLayout(components,p,1);
 if(fitted.capacity_ok){sample={components,original,fitted};break;}
}
assert.ok(sample,'a genuinely marginal overflow has a bounded solution');
const {components,original,fitted}=sample,before=JSON.stringify(components);
assert.ok(fitted.fontSizePt>=16&&fitted.fontSizePt>=original.fontSizePt*.9&&fitted.fontSizePt<original.fontSizePt);
assert.equal(fitted.fontAdaptation.originalFontSizePt,original.fontSizePt);
assert.equal(fitted.fontAdaptation.fontSizePt,fitted.fontSizePt);
assert.equal(JSON.stringify(components),before,'all source wording remains intact');
assert.equal(fitSourceLayout(components,{...p,generationPolicy:{...p.generationPolicy,sourceTypography:undefined}},1).capacity_ok,false,'legacy/unopted records are unchanged');
for(const protection of [{editing:{epochs:{body:1}}},{sourceFontFloors:{body:original.fontSizePt}},{deck:{slides:[{}, {locked:true}]}}]){
 const result=fitSourceLayout(components,{...p,...protection},1);assert.equal(result.capacity_ok,false);assert.equal(result.fontSizePt,original.fontSizePt);
}
assert.equal(fitSourceLayout(components.map(c=>({...c,userStyle:true})),p,1).capacity_ok,false);
assert.throws(()=>fitComponents(components,p,1,{fontSizePt:12,boundedTypography:true}),/invalid bounded/);
assert.throws(()=>normalizeGenerationPolicy({...p.generationPolicy,sourceTypography:'unbounded'}),/invalid generation policy/);
assert.ok(!fitSourceLayout([{type:'text',content:{text:'W'.repeat(3000),codeBlock:{preserveLayout:true}}}],p,1).capacity_ok,'genuine width overflow remains blocked');
assert.equal(normalizeGenerationPolicy(p.generationPolicy).sourceTypography,'bounded');
console.log(`Bounded source typography: ${original.fontSizePt}pt -> ${fitted.fontSizePt}pt, exact source, floors/protection/true overflow verified`);
