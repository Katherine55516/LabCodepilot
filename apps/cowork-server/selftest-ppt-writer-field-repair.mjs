import assert from 'node:assert/strict';
import{normalizeTypography,materializeCopy,copyBudgetFor}from'./lib/ppt-presentation-writing.mjs';
import{writerLocalRepairScope,applyWriterLocalDelta}from'./lib/ppt-writer-local-repair.mjs';
import{_internals as api}from'./lib/ppt-api.mjs';
const eyebrow='1.3 The central tension: mining power vs. overfitting | 核心张力：挖掘能力与过拟合';
const original={title:'Validation and Constrained Search as Regularization',eyebrow,contentBlocks:[],sourceArtifacts:[{sourceUnitId:'frozen'}],sourceEvidenceIds:['evidence']};
const failed=value=>{normalizeTypography(value.eyebrow,48,['eyebrow']);return value;};
let error;try{failed(original);}catch(e){error=e;}
const scope=writerLocalRepairScope(original,error);assert.deepEqual(scope.targets.map(t=>t.path),[['eyebrow']]);assert.equal(scope.targets[0].maxCharacters,48);
const replacement='1.3 Mining Power and Overfitting';let calls=0;const prompts=[];
const result=await api.writeWithContractRepair({prompt:'FROZEN_SOURCES_SENTINEL',nodeKey:'content:eyebrow',maxRepairs:1,call:async(prompt)=>{prompts.push(prompt);calls++;return calls===1?structuredClone(original):{edits:[{path:['eyebrow'],start:0,end:eyebrow.length,before:eyebrow,after:replacement}]};},normalize:failed});
assert.equal(result.content.eyebrow,replacement);assert.equal(result.content.title,original.title);assert.deepEqual(result.content.sourceArtifacts,original.sourceArtifacts);assert.deepEqual(result.content.sourceEvidenceIds,original.sourceEvidenceIds);assert.equal(original.eyebrow,eyebrow);assert.match(prompts[1],/maxCharacters/);assert.match(prompts[1],/FROZEN_SOURCES_SENTINEL/);
assert.throws(()=>applyWriterLocalDelta(original,scope,{edits:[{path:['title'],start:0,end:original.title.length,before:original.title,after:'Different title'}]}),/scope|target/);
assert.throws(()=>applyWriterLocalDelta(original,scope,{edits:[{path:['eyebrow'],start:0,end:eyebrow.length,before:eyebrow,after:'2.3 Changed section'}]}),/numeric/);
let headingError;try{materializeCopy({title:'Validation',content_blocks:[{heading:'Long metadata heading '.repeat(5),body:'Original body remains intact.'}]},{id:'page',title:'Validation'},{brief:{topicLanguage:'en'},slidePlan:[{slideId:'page',copyBudget:copyBudgetFor('content','summary','en')}]});}catch(e){headingError=e;}
assert.deepEqual(headingError.writerFieldPath,['content_blocks',0,'heading']);
calls=0;await assert.rejects(api.writeWithContractRepair({prompt:'Frozen',nodeKey:'content:bounded',maxRepairs:1,call:async()=>{calls++;return calls===1?structuredClone(original):{edits:[]};},normalize:failed}),/visible text exceeds/);assert.equal(calls,2);
console.log('Diagnosed long metadata gets finite exact-field repair; frozen title/source and numeric tokens remain immutable, aliases carry correct paths.');
