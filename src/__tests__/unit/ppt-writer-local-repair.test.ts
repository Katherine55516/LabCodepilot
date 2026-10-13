import test from 'node:test';
import assert from 'node:assert/strict';
import {writerLocalRepairScope, applyWriterLocalDelta} from '../../../apps/cowork-server/lib/ppt-writer-local-repair.mjs';
import {_internals} from '../../../apps/cowork-server/lib/ppt-api.mjs';
import {writerSourceEvidenceIds} from '../../../apps/cowork-server/lib/ppt-prompt-contracts.mjs';
test('native writer and validator share the complete frozen contract/retrieval evidence union', () => {
  const project={templateFidelity:{mode:'preserve'}}, contract={requiredEvidenceIds:['contract-only','shared']}, retrieval={requiredEvidenceIds:['shared','retrieved-only']};
  assert.deepEqual(writerSourceEvidenceIds(project,1,contract,retrieval),['contract-only','shared','retrieved-only']);
  assert.deepEqual(writerSourceEvidenceIds(project,0,contract,retrieval),[]);
  assert.deepEqual(writerSourceEvidenceIds({templateFidelity:{mode:'mapped'}},1,contract,retrieval),[]);
});
test('bounded writer ID repair keeps source table, formula and unrelated content byte-identical', async () => {
  const draft={title:'Source facts',blocks:[{id:'human label!',type:'text',text:'IC 0.02 with a condition'}],sourceArtifacts:[{sourceUnitId:'table',rowStart:1,rowEnd:7}],sourceCommentary:['Keep $\\alpha_i^2$ and condition.']};
  const before=structuredClone(draft);let calls=0;
  const result=await _internals.writeWithContractRepair({prompt:'Frozen source contract',nodeKey:'writer',call:async(prompt:string)=>{
    calls++;if(calls===1)return draft;assert.match(prompt,/allowed_targets/);assert.match(prompt,/do not rewrite the page/);
    return {edits:[{path:['blocks',0,'id'],start:0,end:12,before:'human label!',after:'b1'}]};
  },normalize:(value:typeof draft)=>{if(value.blocks[0].id.includes('!'))throw Error('invalid block id');return value;}});
  assert.ok(result);assert.equal(calls,2);assert.equal(result.content.blocks[0].id,'b1');assert.deepEqual(result.content.sourceArtifacts,before.sourceArtifacts);assert.deepEqual(result.content.sourceCommentary,before.sourceCommentary);assert.deepEqual(draft,before);
});
test('writer span repair refuses stale bases, unrelated paths, number changes and whole page output', () => {
  const draft={sourceCommentary:['IC 0.02 and costs 5 bps.'],sourceArtifacts:[{sourceUnitId:'t',rowStart:1,rowEnd:7}]};
  const scope=writerLocalRepairScope(draft,Error('source_artifact_capacity: {"sourceFits":true}'));
  const good={path:['sourceCommentary',0],start:0,end:25,before:draft.sourceCommentary[0],after:'IC 0.02; costs 5 bps.'};
  good.end=good.before.length;
  assert.equal(applyWriterLocalDelta(draft,scope,{edits:[good]}).value.sourceCommentary[0],good.after);
  assert.throws(()=>applyWriterLocalDelta({...draft,extra:1},scope,{edits:[good]}),/stale/);
  assert.throws(()=>applyWriterLocalDelta(draft,scope,{edits:[{...good,path:['sourceArtifacts',0,'sourceUnitId']}]}),/outside_scope/);
  assert.throws(()=>applyWriterLocalDelta(draft,scope,{edits:[{...good,after:'IC 0.03; costs 5 bps.'}]}),/numeric_change/);
  assert.throws(()=>applyWriterLocalDelta(draft,scope,draft),/schema/);
});
test('math syntax repair touches one diagnosed span, preserving the formula and neighboring prose', () => {
  const draft={subtitle:'Formula: \\alpha_i^2',blocks:[{id:'code',type:'code',text:'literal \\alpha_i^2'}]};
  const scope=writerLocalRepairScope(draft,Error('writer_math_invalid'));assert.ok(scope);assert.equal(scope.targets.length,1);
  const t=scope.targets[0];const after='$\\alpha_i^2$';
  // The missing-delimiter diagnostic covers the whole text run, so retain its prose exactly.
  const edit={...t,after:'Formula: '+after};delete edit.kind;
  const applied=applyWriterLocalDelta(draft,scope,{edits:[edit]});assert.equal(applied.value.subtitle,'Formula: '+after);assert.deepEqual(applied.value.blocks,draft.blocks);
  assert.throws(()=>applyWriterLocalDelta(draft,scope,{edits:[{...edit,after:'Formula: $\\beta_i^2$'}]}),/formula_change/);
});
test('bad local deltas cannot escalate to full page regeneration', async () => {
  let calls=0;await assert.rejects(_internals.writeWithContractRepair({prompt:'Source',nodeKey:'writer',maxRepairs:2,call:async()=>++calls===1?{blocks:[{id:'bad label'}]}:{title:'Whole page replacement'},normalize:()=>{throw Error('invalid block id');}}),/writer_local_repair_schema/);assert.equal(calls,3);
});

test('writer delta request has one response schema and removes conflicting whole-page response instructions',async()=>{
 const {writerLocalRepairPrompt,writerDeltaResponseSchema}=await import('../../../apps/cowork-server/lib/ppt-writer-local-repair.mjs');
 const draft={blocks:[{id:'bad id'}]},scope=writerLocalRepairScope(draft,Error('invalid block id'));
 const prompt=writerLocalRepairPrompt('Source facts\n返回唯一 JSON：{"title":"Old"}。只输出 JSON。\n返回相同 schema。',draft,scope,Error('invalid block id'));
 assert.ok(!prompt.includes('返回唯一 JSON'));assert.ok(!prompt.includes('返回相同 schema'));const schema=writerDeltaResponseSchema(prompt);assert.equal(schema.properties.edits.maxItems,1);assert.deepEqual(schema.required,['edits']);assert.ok(!schema.properties.title);
});
