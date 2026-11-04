import assert from 'node:assert/strict';
import {inspectOutlineTopicLanguages,topicLanguageMismatch}from './lib/ppt-topic-title-validation.mjs';
import {inspectNativeOutlineTitles}from './lib/ppt-template-fidelity.mjs';
import {BUILT_INS,snapshotTemplate}from './lib/ppt-template.mjs';
import {inspectSystemOutlineTitles}from './lib/ppt-outline-title-fit.mjs';
import {applyOutlineMetadataRepair,fragmentTitle}from './lib/ppt-outline-protocol.mjs';
const p={source:{text:'Architecture design and execution. '.repeat(50)+'少量中文'},generationPolicy:{language:{mode:'source',body:'both'}},templateFidelity:{mode:'preserve',slides:[{nodes:[],slots:[]}]} };
const raw={slides:[{id:'one',title:'Gamma 完整架构 (1–5)',sourceUnitIds:['table'],sourceArtifactRanges:[{sourceUnitId:'table',rowStart:1,rowEnd:6}]}]},original=JSON.stringify(raw);
const conflicts=inspectNativeOutlineTitles(p,raw.slides);assert.equal(conflicts.length,1);assert.equal(conflicts[0].topicLanguage,'en');
assert.throws(()=>applyOutlineMetadataRepair(raw,{details:{metadataConflicts:conflicts}},{version:2,updates:[{pageIndex:0,field:'title',text:'Gamma 完整架构 (1–5)'}]}),/topic_language_mismatch/);
const repaired=applyOutlineMetadataRepair(raw,{details:{metadataConflicts:conflicts}},{version:2,updates:[{pageIndex:0,field:'title',text:'Gamma Architecture (1–5)'}]});assert.deepEqual(inspectOutlineTopicLanguages(p,repaired.slides),[]);assert.deepEqual(repaired.slides[0].sourceArtifactRanges,raw.slides[0].sourceArtifactRanges);assert.equal(JSON.stringify(raw),original);
assert.deepEqual(inspectOutlineTopicLanguages({...p,requestedOutline:{slides:raw.slides}},raw.slides),[]);assert.deepEqual(inspectOutlineTopicLanguages(p,[{...raw.slides[0],titleLocked:true}]),[]);assert.deepEqual(inspectOutlineTopicLanguages({...p,deckTitle:{source:'user'}},raw.slides),[]);
for(const title of ['AIJSX','Gamma','DL ML CNN'])assert.equal(topicLanguageMismatch(title,'zh'),false,title);
assert.equal(topicLanguageMismatch('Card-based Intermediate Representation','zh'),true);assert.equal(topicLanguageMismatch('IR 架构表达','zh'),false);assert.equal(topicLanguageMismatch('Schema (Rows 1-3)','en'),false);
console.log('Post-partition topic language, native/system metadata path, source and user locks: OK');

assert.throws(()=>applyOutlineMetadataRepair(raw,{details:{metadataConflicts:conflicts}},{version:2,updates:[{pageIndex:0,field:'title',text:'Gamma Architecture (1–6)'}]}),/topic_range_mismatch/);

const {readingUnits}=await import('./lib/ppt-semantic-relations.mjs');
const items=[{id:'lead',type:'SummaryBlock',sectionPath:['Intro'],text:'**The architecture is:**'},{id:'body',type:'SummaryBlock',sectionPath:['Intro'],text:'Input → Plan → Render'}];
assert.deepEqual(readingUnits(items,['lead','body']),[['lead','body']]);assert.deepEqual(readingUnits([...items.slice(0,1),{id:'other',type:'HeadingBlock',text:'Other'},items[1]],['lead','body']),[['lead'],['body']]);
assert.deepEqual(readingUnits([items[0],{...items[1],sectionPath:['Other']}],['lead','body']),[['lead'],['body']]);
const {sourceReadingContinuation}=await import('./lib/ppt-source-continuations.mjs');
const cp={source:{semantic:{inventory:{items}}},generationPolicy:{content:'full_source',language:{mode:'source'}},outline:[{id:'before',sourceUnitIds:['lead']},{id:'after',sourceUnitIds:['body']}]};assert.deepEqual(sourceReadingContinuation(cp,0).targets,[{slideId:'after',page:2,sourceUnitIds:['body']}]);

assert.equal(topicLanguageMismatch('概览','en'),true);assert.equal(topicLanguageMismatch('Review','zh'),true);

const system={...p,templateFidelity:undefined,template:'violet',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='violet'))};assert.equal(inspectSystemOutlineTitles(system,raw.slides).filter(c=>c.reason==='topic_language_mismatch').length,1);
assert.deepEqual(inspectOutlineTopicLanguages({...p,confirmedOutline:{hash:'frozen'}},raw.slides),[],'a frozen legacy title is not silently translated or newly rejected');
const narrow={...p,templateFidelity:{mode:'preserve',slides:[{nodes:[],slots:[{shapeId:'t',role:'title',capacity:1,fontSizePt:36,maxLines:1}]}]}};
const merged=inspectNativeOutlineTitles(narrow,raw.slides);assert.equal(merged.length,1);assert.equal(merged[0].topicLanguage,'en');assert.equal(merged[0].reason,'native_title_capacity');assert.equal(inspectSystemOutlineTitles(narrow,raw.slides).length,0);

// A real table fragment is titled again on every outline assessment. A
// validated translation must survive, but cannot migrate to different rows.
const tableSource={semantic:{inventory:{items:[{id:'table',type:'TableBlock',sectionPath:['Gamma 完整架构'],rows:[['Stage','Description'],...Array.from({length:8},(_,i)=>['Original architecture stage '+i,'Complete original condition'])]}]}}};
assert.equal(fragmentTitle(repaired.slides[0],tableSource).title,'Gamma Architecture (1–5)');
assert.deepEqual(fragmentTitle(repaired.slides[0],tableSource).sourceArtifactRanges,raw.slides[0].sourceArtifactRanges);
const changedScope={...repaired.slides[0],sourceArtifactRanges:[{sourceUnitId:'table',rowStart:2,rowEnd:7}]};
assert.notEqual(fragmentTitle(changedScope,tableSource).title,repaired.slides[0].title,'a translated range label cannot survive a change of source rows');
assert.equal(fragmentTitle(changedScope,tableSource).titleBasis,'actual_table_range');
assert.equal(JSON.stringify(raw),original);
console.log('Validated fragment topics survive reassessment only for the exact original source scope: OK');

// The exact failed Factor locator was a single source line, not a table row.
// The wire schema and the local validator must express the same English range.
const {outlineMetadataRepairPrompt,outlineResponseSchema}=await import('./lib/ppt-outline-protocol.mjs');
const lineRaw={version:2,slides:[{title:'检验流水线 (第 9–9 行)',sourceUnitIds:['line'],sourceArtifactRanges:[{sourceUnitId:'line',lineStart:8,lineEnd:9}]}]};
const lineConflict=inspectOutlineTopicLanguages(p,lineRaw.slides)[0];assert.equal(lineConflict.topicRangeKind,'line');assert.deepEqual(lineConflict.requiredTopicRange,['9','9']);
const lineDiagnostic={details:{metadataConflicts:[lineConflict]}},linePrompt=outlineMetadataRepairPrompt(p,lineRaw,lineDiagnostic),lineSchema=outlineResponseSchema(linePrompt).properties.updates.items.oneOf[0].properties.text;
assert.ok(new RegExp(lineSchema.pattern,'iu').test('Testing Pipeline (lines 9–9)'));
for(const bad of ['(lines 9–9)','Testing Pipeline (Row 9)','Testing Pipeline (lines 1–1)','Testing Pipeline (第 9–9 行)']){
 assert.equal(new RegExp(lineSchema.pattern,'iu').test(bad),false);
 assert.throws(()=>applyOutlineMetadataRepair(lineRaw,lineDiagnostic,{version:2,updates:[{pageIndex:0,field:'title',text:bad}]}));
}
assert.equal(applyOutlineMetadataRepair(lineRaw,lineDiagnostic,{version:2,updates:[{pageIndex:0,field:'title',text:'Testing Pipeline (lines 9–9)'}]}).slides[0].title,'Testing Pipeline (lines 9–9)');
const copyConflict={pageIndex:0,field:'title',reason:'system_title_copy_budget',maxLength:160,capacityVisualUnits:12,topicLanguage:'en'};
const copySchema=outlineResponseSchema(outlineMetadataRepairPrompt(p,lineRaw,{details:{metadataConflicts:[copyConflict]}})).properties.updates.items.oneOf[0].properties.text;
assert.equal(copySchema.maxLength,Math.floor(12/.55),'system and native schema ceilings use their actual unchanged title budget');
console.log('Line/row kind, English source range, metadata schema and exact bounded local validation agree: OK');
