import assert from 'node:assert/strict';
import {inspectSlideCopy} from './lib/ppt-presentation-writing.mjs';
import {presentationPolicyPrompt} from './lib/ppt-prompt-contracts.mjs';
import {defaultGenerationPolicy} from './lib/ppt-generation-policy.mjs';
import {navigationRequired} from './lib/ppt-outline-concision.mjs';
import {globalOutlinePlan} from './lib/ppt-global-outline-plan.mjs';
import {bindNotesDisclosures} from './lib/ppt-notes-disclosure.mjs';

const phrases=['来源细节见备注','完整来源细节见本页备注。','完整表见备注','完整数据见备注','來源細節見備註','原文保存在演讲者备注','See speaker notes for full details.','Complete source details are in speaker notes.'];
for(const index of [0,1,2])for(const phrase of phrases){
 const carriers=[{bullets:[phrase]},{copy:{blocks:[{heading:'',body:phrase}]}},{templateSlotTexts:{footer:phrase}},{nodes:[{type:'text',content:{text:phrase}}]}];
 for(const carrier of carriers){
  const slide={title:'Actual source topic',...carrier},before=JSON.stringify(slide);
  assert.ok(inspectSlideCopy(slide,{},index,3).some(issue=>issue.code==='visible_copy_placeholder'&&issue.severity==='error'),`${index}: ${JSON.stringify(carrier)}`);
  assert.equal(JSON.stringify(slide),before,'diagnostics never truncate actual page content');
 }
}
for(const node of [{sourceArtifact:{sourceUnitId:'original'}},{manualOverlay:{origin:'user'}}]){
 assert.ok(!inspectSlideCopy({title:'Quoted example',nodes:[{...node,type:'text',content:{text:phrases[0]}}]}, {},0,3).some(issue=>issue.code==='visible_copy_placeholder'),'literal source/user content is not a generated notes instruction');
}
assert.deepEqual(inspectSlideCopy({title:'Actual source topic',bullets:['The full table is visible on this page.']},{},0,3),[],'cover is still exempt from body-density rules');
const policy=defaultGenerationPolicy('输出语言：中文');
const prompt=presentationPolicyPrompt({generationPolicy:policy});
assert.match(prompt,/不创建自动备注/);
assert.doesNotMatch(prompt,/在备注及来源存储中保持不变|在显式授权的备注/);
assert.match(presentationPolicyPrompt({generationPolicy:{...policy,version:1,detail:'balanced',details:'notes'}}),/显式授权的备注/,'legacy explicit authorization is not silently migrated');
const project={deck:{slides:[{id:'cover',nodes:[{id:'obsolete',content:{derivedFrom:'notes-disclosure',text:phrases[0]}},{id:'source',sourceArtifact:{sourceUnitId:'s'},content:{text:'Real source fact'}},{id:'user',manualOverlay:{origin:'user'},content:{text:'User comment'}}],nodeOrder:['obsolete','source','user']} ]}};
bindNotesDisclosures(project);
assert.deepEqual(project.deck.slides[0].nodeOrder,['source','user']);
assert.equal(project.deck.slides[0].nodes.length,2);
console.log('All-page notes-placeholder guards, source/user preservation and v2 translation contract: OK');

assert.equal(navigationRequired({generationPolicy:defaultGenerationPolicy()},30),false);
assert.equal(navigationRequired({generationPolicy:defaultGenerationPolicy(),userRequirements:'需要目录'},8),true);
assert.ok(globalOutlinePlan({generationPolicy:defaultGenerationPolicy()}).rules.every(rule=>!rule.includes('full original stays in notes')));
