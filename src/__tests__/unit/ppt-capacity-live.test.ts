/* eslint-disable @typescript-eslint/no-explicit-any -- malformed/partial writer and execution fixtures */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentGenerationDraft,generationPageStarted,mergeGenerationDrafts} from '../../lib/ppt-generation-view';
const lib=process.cwd()+'/apps/cowork-server/lib/';
test('streaming prose keeps its full prefix through string and object closure',async()=>{
 const {draftFromPartialJson:parse}=await import(lib+'ppt/draft-store.mjs');
 const text='A complete explanation 中文 with an escaped "quote". '.repeat(8),prefix='{"sourceCommentary":[{"type":"mechanism","text":';
 const wire=JSON.stringify(text),before=parse(prefix+wire.slice(0,-1)),closed=parse(prefix+wire+','),object=parse(prefix+wire+'}');
 assert.equal(before.typing,text);assert.equal(closed.typing,text);assert.equal(closed.blocks.length,0);assert.equal(object.typing,'');assert.equal(object.blocks[0].text,text);
 assert.ok(before.typing.length>200);assert.ok(before.typing.startsWith('A complete explanation'));
 assert.deepEqual(parse('{"sourceArtifacts":[{"sourceUnitId":"foreign"}').blocks,[]);
});
test('snapshot and SSE drafts use the newest valid attempt without reopening future pages',()=>{
 const p:any={currentRunId:'run',nodes:{s:{status:'pending',epoch:2}},editing:{epochs:{s:2}},drafts:{s:{runId:'run',epoch:2,jobId:'job',seq:12,chars:200,typing:'new snapshot'}},runtime:{slides:{}},generationStages:{pages:{}}};
 const old={s:{...p.drafts.s,seq:9,typing:'old SSE'}};
 assert.equal(mergeGenerationDrafts(p,old).s.typing,'new snapshot');
 assert.equal(mergeGenerationDrafts(p,{s:{...old.s,seq:13,typing:'new SSE'}}).s.typing,'new SSE');
 assert.equal(mergeGenerationDrafts(p,{s:{...old.s,runId:'prior',seq:100}}).s.typing,'new snapshot');
 assert.equal(mergeGenerationDrafts(p,{s:{...old.s,epoch:1,seq:100}}).s.typing,'new snapshot');
 assert.equal(generationPageStarted(p,'future'),false);assert.equal(generationPageStarted(p,'s'),true);
 delete p.editing.epochs.s;assert.ok(currentGenerationDraft(p,'s',p.drafts.s));
 for(const stage of ['layout','previewing','validating']){p.generationStages.pages.s=stage;delete p.drafts.s;assert.equal(generationPageStarted(p,'s'),true);}
});
