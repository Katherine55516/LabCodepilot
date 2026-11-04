/** Complete source checkpoints can survive a corrected derived obligation;
 * stale, partial, altered or manually edited pages cannot gain acceptance. */
import assert from 'node:assert/strict';
import { normalizePaste } from './lib/ppt-source.mjs';
import { snapshotTemplate, BUILT_INS } from './lib/ppt-template.mjs';
import { bindSourceArtifacts } from './lib/ppt-source-artifacts.mjs';
import { updateSlidePreview } from './lib/ppt/runtime.mjs';
import { digest } from './lib/ppt/edit-context.mjs';
import { recoverSourceCheckpoint } from './lib/ppt-source-checkpoint-recovery.mjs';
import { _internals as api } from './lib/ppt-api.mjs';

const source=normalizePaste('# Turnover\n\nTurnover compares the traded weight with the portfolio weight before rebalancing.\n\nThe neighboring example earns 4% gross alpha with 800% annual turnover, about 50 bps.');
const units=source.semantic.inventory.items.filter(i=>i.type!=='HeadingBlock'),own=units.find(i=>i.text.includes('Turnover compares')),neighbor=units.find(i=>i.text.includes('50 bps'));
assert.ok(own&&neighbor);own.must_preserve_structure=true;
const atom=source.semantic.evidenceAtoms.find(a=>a.exactText.includes('50 bps'));assert.ok(atom);
const body={id:'body',title:'Turnover definition',focus:'Define portfolio turnover',role:'mechanism',planningProtocolVersion:2,sourceUnitIds:[own.id],sourceImageIds:[],sourceArtifactRanges:[],refs:own.source_ref||[],chunkRefs:own.chunkRefs||[]};
const outline=[{id:'cover',title:'Turnover',role:'cover',sourceUnitIds:[]},body,{id:'closing',title:'Thanks for watching!',role:'closing',sourceUnitIds:[]}];
const refs=[{sourceUnitId:own.id}],p={id:'source-checkpoint',currentRunId:'run_original',revision:0,status:'failed',source,outline,pages:3,template:'violet',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='violet')),generationPolicy:{content:'full_source',knowledge:'source_only'},planning:{slidePlan:[{slideId:'body',role:'mechanism',sourceArtifacts:refs,requiredEvidenceIds:[atom.id]}]},deck:{slides:outline.map(s=>({...s,nodes:[]}))},nodes:{},executionHistory:[{id:'original-five-attempts',attempts:5}]};
const content={...body,nodes:[],nodeOrder:[]};bindSourceArtifacts(p,content,refs,1);p.nodes.body={status:'failed',epoch:0,slide:content,attempts:2};updateSlidePreview(p,'body','writing');
const state=p.runtime.slides.body;state.componentCommit={version:1,slideId:'body',runId:p.currentRunId,epoch:0,baseRevision:0,sourceHash:source.sha256,refs,componentHash:digest(state.canonicalSlide.sourceArtifactNodes)};
const before=JSON.stringify(p.executionHistory),sourceBefore=JSON.stringify(source);
assert.equal(recoverSourceCheckpoint(p,body,1),null,'a failed page without an audited obligation correction is not accepted');
api.revalidateCompletedCopy(p);assert.equal(p.nodes.body.status,'done');assert.equal(p.runtime.sourceCheckpointRevalidation.length,1);assert.deepEqual(p.planning.slidePlan[0].requiredEvidenceIds,[]);assert.equal(JSON.stringify(p.executionHistory),before);assert.equal(JSON.stringify(source),sourceBefore);
const valid=structuredClone(p);valid.nodes.body.status='failed';
for(const mutate of [q=>q.revision++,q=>q.currentRunId='different',q=>q.source.sha256='different',q=>q.editing={epochs:{body:1}},q=>q.runtime.slides.body.accepted=true,q=>q.runtime.slides.body.componentCommit.refs=[],q=>q.runtime.slides.body.canonicalSlide.sourceArtifactNodes[0].content.text='Altered source',q=>q.runtime.slides.body.renderContractVersion=0]){
 const invalid=structuredClone(valid);mutate(invalid);assert.equal(recoverSourceCheckpoint(invalid,body,1),null,'stale/partial/protected/altered checkpoints stay blocked');
}
const missing=structuredClone(valid);missing.planning.slidePlan[0].requiredEvidenceIds=[atom.id];assert.equal(recoverSourceCheckpoint(missing,body,1),null,'a real remaining evidence obligation still blocks checkpoint recovery');
console.log('Exact owned evidence, complete current-run checkpoint recovery, unchanged attempt history and eight stale/protected/altered negative cases passed.');
