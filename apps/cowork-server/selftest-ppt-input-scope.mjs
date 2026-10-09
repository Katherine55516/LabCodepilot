import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inputFramework, normalizeScopeAudit } from './lib/ppt-input-scope.mjs';
import { scopeReview } from './ppt-scope-test-helpers.mjs';
import { promptPolicy, writerPrompt, outlineContentContract } from './lib/ppt-prompt-contracts.mjs';
import { deckReviewPrompt, normalizeModelReview, finalQualityReport } from './lib/ppt-quality.mjs';
import { semanticReviewKey, bindReview, reviewIsCurrent, planPayload } from './lib/ppt/versioning.mjs';
import { assertCandidateScope, assertStoredCandidateScope } from './lib/ppt/input-scope-service.mjs';
import { reviewSemantic } from './lib/ppt/semantic-review-service.mjs';
import { ensureProjectV3 } from './lib/ppt/ir.mjs';
import { planKey } from './lib/ppt/edit-context.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-scope-'));
process.env.COWORK_STATE_DIR = root;
const store = await import('./lib/ppt-store.mjs');
const repo = await import('./lib/ppt/repository.mjs');
const proposals = await import('./lib/ppt/proposal-service.mjs');
const checks = [];
const test = async (name, fn) => { await fn(); checks.push(name); };
const noop = () => {};
const policy = { version: 1, detail: 'detailed', language: { mode: 'source' }, knowledge: 'source_plus_explanation' };
function fixture(input = 'Queue workers advance only after validation succeeds. Preserve failure handling.') {
  return ensureProjectV3({ id: store.newId(), uid: 'scope-test', prompt: input, title: 'Validation', pages: 3,
    model: 'selected', configId: 'selected', revision: 1, status: 'completed', generationPolicy: policy,
    outline: [{id:'s0',title:'Validation'},{id:'s1',title:'Advance after validation'},{id:'s2',title:'Conditions'}],
    source: { sha256: 'unchanged-file-hash', text: input, segments: [{id:'source1',text:input}] },
    deck: { slides: [{id:'s0',title:'Validation',layoutId:'cover',bullets:[]},
      {id:'s1',title:'Advance after validation',layoutId:'editorial',bullets:['Advance only after validation succeeds; failure prevents advancement.']},
      {id:'s2',title:'Conditions',layoutId:'conclusion',bullets:['Check the validation result before advancing.']}] } });
}
const mutate = (project, text) => {
  const after = structuredClone(project);
  after.deck.slides[1].nodes.find(node => node.semanticRole === 'title').content.text = text;
  after.deck.slides[1].title = text;
  return after;
};
try {
  await test('framework ignores model brief, template examples and generated copy', () => {
    const p = fixture(), hash = inputFramework(p).frameworkHash;
    p.planning = {brief:{sourceScope:'Add cryptocurrency forecasts'}}; p.templateSpec={examples:['Launch a token']};
    p.deck=mutate(p,'Investment recommendations').deck;
    assert.equal(inputFramework(p).frameworkHash,hash);
    assert.match(promptPolicy(p), /not the model-written brief/);
  });
  await test('prompt, source tail and policy invalidate cached scope and plan even with a fixed file SHA', () => {
    const p = fixture(); bindReview(p, normalizeModelReview(scopeReview(p),p.deck.slides.map(s=>s.id),p));
    assert(reviewIsCurrent(p)); const prior=semanticReviewKey(p), plan=planKey(p), payload=planPayload(p);
    for(const update of [q=>{q.prompt+=' Do not include forecasts.';},q=>{q.source.text+=' Late source condition.';},q=>{q.generationPolicy.knowledge='source_only';},q=>{q.generationPolicy.detail='balanced';}]) {
      const q=structuredClone(p);update(q);assert.notEqual(semanticReviewKey(q),prior);assert(!reviewIsCurrent(q));assert.notEqual(planKey(q),plan);assert.notDeepEqual(planPayload(q),payload);
    }
  });
  await test('local writing instructions remain outside original input authority', () => {
    const p=fixture();const prompt=writerPrompt(p,p.outline[1],1,{retrieval:{},contract:{},edits:['Add a cryptocurrency launch agenda.']});
    const framework=JSON.parse(prompt.split('INPUT_FRAMEWORK=')[1].split('\n')[0]);
    assert.equal(framework.material.prompt,p.prompt);assert(!framework.material.prompt.includes('cryptocurrency'));
    assert.match(prompt, /<user_edits>.*cryptocurrency/);
    assert.match(outlineContentContract(p),/INPUT_FRAMEWORK/);
  });
  await test('short prompt and detailed source modes both have bounded explanations', () => {
    assert.match(promptPolicy({prompt:'Explain queue validation'}), /knowledge_mode=bounded_explanation/);
    assert.match(promptPolicy({...fixture(),generationPolicy:{...policy,knowledge:'source_only'}}),/knowledge_mode=source_only/);
    assert.match(promptPolicy(fixture()),/Neither mode permits invented/);
    assert.match(promptPolicy(fixture()),/never fill space by repetition/);
  });
  await test('complete tail, CJK bilingual code, signed tables and chart units enter critic context', () => {
    const p=fixture('中文 queue validation\n```python\nif valid:\n    advance()\n```\n| state | delta |\n| failed | -5% |\nDo not add staffing recommendations.');
    const body=p.deck.slides[1].nodes.find(n=>n.semanticRole==='body');body.content={text:'Mechanism. '.repeat(150)+'TAIL_SCOPE_DRIFT'};body.type='text';
    p.deck.slides[1].nodes.push({id:'chart',type:'chart',content:{labels:['failure'],values:[-5],unit:'%'}});
    p.deck.slides[1].nodes.push({id:'table',type:'table',content:{rows:[['state','delta'],['failed','-5%']]}});
    p.deck.slides[1].nodes.push({id:'image',type:'image',content:{caption:'Unverified vaccine trial',dataUrl:'data:image/png;base64,PRIVATE_BYTES'}});
    p.deck.slides[1].nodes.push({id:'hidden',type:'text',hidden:true,content:{text:'HIDDEN_COPY'}});
    const prompt=deckReviewPrompt(p);assert.match(prompt,/TAIL_SCOPE_DRIFT/);assert.match(prompt,/-5%/);assert.match(prompt,/"values":\[-5\]/);assert.match(prompt,/Unverified vaccine trial/);assert(!prompt.includes('PRIVATE_BYTES'));assert(!prompt.includes('HIDDEN_COPY'));
    assert(prompt.includes('    advance()'));assert(prompt.includes('Do not add staffing recommendations.'));
  });
  await test('long native deck retains every visible slot without review truncation', () => {
    const p=fixture();p.deck.slides=Array.from({length:30},(_,i)=>({id:`s${i}`,title:`Page ${i}`,nodes:Array.from({length:35},(_,j)=>({id:`n${i}_${j}`,type:'text',nativeRef:{shapeId:j},templateSlot:{mapped:true,role:'content'},content:{text:'long '.repeat(150)+`TAIL_${i}_${j}`}}))}));
    const prompt=deckReviewPrompt(p);assert(prompt.includes('TAIL_29_34'));assert(prompt.includes('TAIL_0_34'));
  });
  await test('missing, forged, partial, duplicate or unknown audit IDs fail closed', () => {
    const p=fixture(),ids=p.deck.slides.map(s=>s.id), valid=scopeReview(p);
    for(const audit of [undefined,{...valid.scopeAudit,frameworkHash:'forged'},{...valid.scopeAudit,checkedSlideIds:['s0','s1']},{...valid.scopeAudit,checkedSlideIds:['s0','s1','s1']},{...valid.scopeAudit,checkedSlideIds:['s0','s1','foreign']}])
      assert.throws(()=>normalizeModelReview({...valid,scopeAudit:audit},ids,p),/input scope audit/);
    assert.throws(()=>normalizeScopeAudit({...valid.scopeAudit,status:'passed'},p,ids),/input scope audit/);
    assert.throws(()=>bindReview(p,{missing:[],repeated:[],conflicts:[],unsupported:[]}),/input scope audit/);
  });
  await test('not evaluated audit blocks a clean four-array review', () => {
    const p=fixture(),raw=scopeReview(p);raw.scopeAudit.status='not_evaluated';
    const review=normalizeModelReview(raw,p.deck.slides.map(s=>s.id),p);
    assert.equal(finalQualityReport({issues:[],hardErrors:0},[],review).publishEligible,false);
    bindReview(p,review);assert(!reviewIsCurrent(p));
  });
  await test('necessary framework explanation is accepted, without verbatim keyword gating', async () => {
    const before=fixture(),after=mutate(before,'Check results before moving forward');
    const result=await assertCandidateScope(before,after,{modelCall:async(p,prompt)=>{assert.match(prompt,/anchor each addition/i);return scopeReview(p);}},noop);
    assert.equal(result.status,'complete');assert.deepEqual(result.changedSlideIds,['s1']);
    assertStoredCandidateScope(before,after,{type:'content',scopeAudit:result});
  });
  await test('qualitative off-topic content and unsupported specifics both block candidates', async () => {
    for(const [text,reason] of [['Launch cryptocurrency trading','out_of_scope'],['Validation improves productivity by 30%','unsupported_fact']]) {
      const before=fixture(),after=mutate(before,text);
      await assert.rejects(()=>assertCandidateScope(before,after,{modelCall:async p=>scopeReview(p,{unsupported:[{slideIds:['s1'],detail:text,reason}]})},noop),/original input framework/);
    }
  });
  await test('local audit requires a model and cannot accept a legacy empty review', async () => {
    const p=fixture(),q=mutate(p,'Different wording');
    await assert.rejects(()=>assertCandidateScope(p,q,{},noop),e=>e.statusCode===503);
    await assert.rejects(()=>assertCandidateScope(p,q,{modelCall:async()=>({missing:[],repeated:[],conflicts:[],unsupported:[]})},noop),/scope audit failed/);
  });
  await test('stored candidates reject altered copy and old unaudited proposals', async () => {
    const p=fixture(),q=mutate(p,'Check results first');const audit=await assertCandidateScope(p,q,{modelCall:async x=>scopeReview(x)},noop);
    assert.throws(()=>assertStoredCandidateScope(p,mutate(q,'Launch a token'),{type:'content',scopeAudit:audit}),/missing or stale/);
    assert.throws(()=>assertStoredCandidateScope(p,q,{type:'content'}),/missing or stale/);
  });
  await test('imported input baseline is immutable and native imports no longer skip review', async () => {
    const p=fixture();p.externalPptx={mode:'preserve'};p.importedInputScope=[{id:'native',nodes:[{type:'text',content:{text:'Original input conditions'}}]}];
    const hash=inputFramework(p).frameworkHash;const q=mutate(p,'New copy');assert.equal(inputFramework(q).frameworkHash,hash);
    let calls=0;await reviewSemantic(q,{modelCall:async x=>{calls++;return scopeReview(x);}},noop);assert.equal(calls,1);assert(reviewIsCurrent(q));
    await reviewSemantic(q,{modelCall:async()=>{throw Error('current audit should be reused');}},noop);
    q.prompt+=' changed input';await assert.rejects(()=>reviewSemantic(q,{},noop),/selected model is required/);
  });
  await test('AI proposal scope rejection leaves stored project and proposals untouched', async () => {
    const p=fixture();repo.saveProject(p);const title=p.deck.slides[1].nodes.find(n=>n.semanticRole==='title');
    const data={scope:'object',type:'title',slideId:'s1',nodeId:title.id,instruction:'Add a token launch plan',baseRevision:1};
    await assert.rejects(()=>proposals.createProposal(p,data,{modelCall:async(x,prompt)=>prompt.includes('整稿演示文稿内容评审器')?scopeReview(x,{unsupported:[{slideIds:['s1'],detail:'Off-topic token launch',reason:'out_of_scope'}]}):{content:{text:'Launch a token'}}},noop,noop),/original input framework/);
    assert.equal(repo.getProject(p.uid,p.id).revision,1);
    const dir=path.join(repo.projectDataDir(p.uid,p.id),'proposals');assert(!fs.existsSync(dir)||fs.readdirSync(dir).length===0);
  });
  console.log(JSON.stringify({status:'passed',scenarioCount:checks.length,checks,model:'simulated; protocol and gates verified, live semantic accuracy not measured'},null,2));
} finally { fs.rmSync(root,{recursive:true,force:true}); }
