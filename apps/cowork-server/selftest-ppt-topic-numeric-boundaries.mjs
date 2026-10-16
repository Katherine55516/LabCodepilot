import assert from 'node:assert/strict';
import {distinctPageTitles}from './lib/ppt-page-titles.mjs';

const cases=[
 {language:'en',focus:'Individual IC ≈ 0.02–0.05 compounds via square-root scaling under the stated independence condition.',number:'0.02–0.05'},
 {language:'en',focus:'2,000 independent signals feed the validated pool.',number:'2,000'},
 {language:'en',focus:'The threshold remains 1.25e-6 under the original condition.',number:'1.25e-6'},
 {language:'zh',focus:'相关性的下降条件为0.0123456789–0.05%且需完整保留。',number:'0.0123456789–0.05%'},
];
for(const fixture of cases){
 const text=fixture.language==='zh'?'原文条件'.repeat(50):'Original source requirements '.repeat(50);
 const project={source:{text,semantic:{inventory:{items:[{id:'detail',type:'SummaryBlock',text:fixture.focus}]}}}};
 const slides=[{title:'Cover'},{title:'Condition'},{title:'Condition',sourceUnitIds:['detail'],focus:fixture.focus}],snapshot=JSON.stringify({project,slides});
 const result=distinctPageTitles(project,slides);
 assert.ok(result.slides[2].title.includes(fixture.number),result.slides[2].title);
 assert.doesNotMatch(result.slides[2].title,/IC ≈ 0$/,'do not introduce an unsupported zero by splitting a decimal at its period');
 assert.equal(JSON.stringify({project,slides}),snapshot);
 assert.notEqual(result.slides[1].title,result.slides[2].title);
}
const longTitle='A'.repeat(150),focus='The threshold is 0.0123456789 under the full source condition.';
const result=distinctPageTitles({source:{text:'English requirements',semantic:{inventory:{items:[]}}}},[{title:'Cover'},{title:longTitle},{title:longTitle,focus}]);
assert.ok(!result.slides[2].title.includes('threshold')||result.slides[2].title.includes('0.0123456789'),'a metadata length ceiling cannot truncate a numeric literal');
console.log('Duplicate topic qualification preserves decimal ranges, thousands, scientific notation and complete Chinese numeric literals: OK');
