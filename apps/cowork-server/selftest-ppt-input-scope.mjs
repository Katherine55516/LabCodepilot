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
    assert(reviewIsCurrent(p)); const oldProtocol=structuredClone(p);oldProtocol.quality.rubricVersion--;assert(!reviewIsCurrent(oldProtocol),'a previous review protocol cannot certify the upgraded reviewer');
    for(const key of['claimAudit','obligationAudit']){const incomplete=structuredClone(p);incomplete.quality.modelReview[key]={...incomplete.quality.modelReview[key],status:'not_evaluated'};assert(!reviewIsCurrent(incomplete),'an incomplete structured audit must not freeze its failure as a reusable final review');}
    const prior=semanticReviewKey(p), plan=planKey(p), payload=planPayload(p);
    for(const update of [q=>{q.prompt+=' Do not include forecasts.';},q=>{q.source.text+=' Late source condition.';},q=>{q.generationPolicy.knowledge='source_only';},q=>{q.generationPolicy.detail='balanced';}]) {
      const q=structuredClone(p);update(q);assert.notEqual(semanticReviewKey(q),prior);assert(!reviewIsCurrent(q));assert.notEqual(planKey(q),plan);assert.notDeepEqual(planPayload(q),payload);
    }
  });
  await test('local writing instructions remain outside original input authority', () => {
    const p=fixture();const prompt=writerPrompt(p,p.outline[1],1,{retrieval:{},contract:{},edits:['Add a cryptocurrency launch agenda.']});
    const framework=JSON.parse(prompt.split('INPUT_FRAMEWORK=')[1].split('\n')[0]);
    assert.equal(framework.material.promptRef,'sourceText');assert.equal(framework.material.sourceText,p.prompt);assert(!framework.material.sourceText.includes('cryptocurrency'));
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
  await test('a card deck edit is checked by code on its pages, without a model review (Fable 2026-10-25)', async () => {
    const cards=project=>({...project,planningContract:{version:3,flow:'cards'},generationPolicy:{...project.generationPolicy,knowledge:'source_only'}});
    const before=cards(fixture('Queue workers advance only after 3 validations succeed. Preserve failure handling.'));
    const noModel={modelCall:async()=>{throw new Error('a card deck edit must not call the model review');}};
    const edited=cards(mutate(before,'Advance after three checks pass')),clean=await assertCandidateScope(before,edited,noModel,noop);
    assertStoredCandidateScope(before,edited,{type:'content',scopeAudit:clean});
    assert.equal(clean.status,'complete');assert.equal(clean.coverage,'deterministic_card');assert.deepEqual(clean.checkedSlideIds,['s1']);
    await assert.rejects(()=>assertCandidateScope(before,cards(mutate(before,'Advance after 47 validations succeed')),noModel,noop),/changes facts, objects or citations/);
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
  await test('a card deck AI edit sends the card policy and the page cited units only (Fable 2026-10-25, live fz-r32: 125k characters)', async () => {
    const units=Array.from({length:20},(_,k)=>({id:'u'+k,type:'MechanismBlock',text:`Unit ${k} marker-${k}: `+'Workers advance after validation and keep failure handling. '.repeat(33)}));
    const p=fixture(units.map(unit=>unit.text).join('\n\n'));
    Object.assign(p,{planningContract:{version:3,flow:'cards'},generationPolicy:{...p.generationPolicy,knowledge:'source_only'},originalSourceInventory:{items:units,relationships:[]}});
    p.outline[1]={...p.outline[1],keyPoints:[{text:'Advance only after validation succeeds',sourceUnitIds:['u1']}],cardObjects:[]};
    repo.saveProject(p);const body=p.deck.slides[1].nodes.find(n=>n.semanticRole!=='title'&&n.type==='text')||p.deck.slides[1].nodes.find(n=>n.semanticRole==='title');
    body.content={...body.content,richText:{runs:[{kind:'text',text:'x'.repeat(500)}]}};body.geometry={x:914400,y:1828800,width:5486400,height:914400};body.style={...body.style,fontSizePt:18};repo.saveProject(p);
    let editPrompt='';
    await proposals.createProposal(p,{scope:'object',type:'content',slideId:'s1',nodeId:body.id,instruction:'Tighten the wording',baseRevision:1},{modelCall:async(x,prompt,a,l,options)=>{if(String(options?.nodeKey||'').startsWith('ai:'))editPrompt=prompt;return {content:{text:'Advance only after validation succeeds; failure handling stays.'}};}},noop,noop).catch(()=>{});
    assert.ok(editPrompt.length>0&&editPrompt.length<15000,'prompt '+editPrompt.length);
    assert.match(editPrompt,/<card_edit_policy>/);assert.match(editPrompt,/marker-1:/);assert.doesNotMatch(editPrompt,/marker-5:/);assert.doesNotMatch(editPrompt,/"richText"/);
    // The deck's laid-out form, not the outline's "English | 中文" drafting form (live alpha/mlq-r34).
    const {cardEditPolicy}=await import('./lib/ppt-prompt-contracts.mjs'),bilingual=cardEditPolicy({...p,generationPolicy:{...p.generationPolicy,language:{mode:'source',body:'both'}}});
    assert.match(bilingual,/line break/);assert.doesNotMatch(bilingual,/ONE line as/);
    // A card text box's measured room is in the prompt, and an overlong candidate is refused in plain words (Fable D2).
    assert.match(editPrompt,/"measured":true,"maxLines":\d+,"linesNow":\d+,"charactersNow":\d+/);
    // A tightening edit uses the text's own facts; sources check, they do not add (live fz/mlq-r37).
    assert.match(editPrompt,/not longer than it/);
    // The built-in growing actions are exempt (Fable 2026-10-25).
    for(const action of ['expand','specific','translate'])assert.doesNotMatch(cardEditPolicy(p,action),/not longer than it/,action);
    assert.match(cardEditPolicy(p,'shorten'),/not longer than it/);
    const fresh=repo.getProject(p.uid,p.id);
    // One retry with the measured limit; a second overrun is the 422 (Fable D2').
    let editCalls=[];const long={content:{text:'Advance only after validation succeeds. '.repeat(40)}};
    await assert.rejects(()=>proposals.createProposal(fresh,{scope:'object',type:'content',slideId:'s1',nodeId:body.id,instruction:'Tighten the wording',baseRevision:fresh.revision},{modelCall:async(x,prompt,a,l,options)=>{if(String(options?.nodeKey||'').startsWith('ai:')){editCalls.push(prompt);return long;}return scopeReview(x);}},noop,noop),/needs \d+ lines and its box holds \d+/);
    assert.equal(editCalls.length,2,'exactly one retry');assert.match(editCalls[1],/did not fit:[\s\S]*needs \d+ lines; its box holds \d+[\s\S]*only the facts already in the text/);
    editCalls=[];const fixed=await proposals.createProposal(repo.getProject(p.uid,p.id),{scope:'object',type:'content',slideId:'s1',nodeId:body.id,instruction:'Tighten the wording',baseRevision:fresh.revision},{modelCall:async(x,prompt,a,l,options)=>{if(String(options?.nodeKey||'').startsWith('ai:')){editCalls.push(prompt);return editCalls.length===1?long:{content:{text:'Advance only after validation.'}};}return scopeReview(x);}},noop,noop);
    assert.equal(editCalls.length,2);assert.equal(fixed.content.text,'Advance only after validation.','the retried version is the proposal');
  });
  await test('AI proposal scope rejection leaves stored project and proposals untouched', async () => {
    const p=fixture();repo.saveProject(p);const title=p.deck.slides[1].nodes.find(n=>n.semanticRole==='title');
    const data={scope:'object',type:'title',slideId:'s1',nodeId:title.id,instruction:'Add a token launch plan',baseRevision:1};
    await assert.rejects(()=>proposals.createProposal(p,data,{modelCall:async(x,prompt)=>prompt.includes('整稿演示文稿内容评审器')?scopeReview(x,{unsupported:[{slideIds:['s1'],detail:'Off-topic token launch',reason:'out_of_scope'}]}):{content:{text:'Launch a token'}}},noop,noop),/original input framework/);
    assert.equal(repo.getProject(p.uid,p.id).revision,1);
    const dir=path.join(repo.projectDataDir(p.uid,p.id),'proposals');assert(!fs.existsSync(dir)||fs.readdirSync(dir).length===0);
  });
  await test('large local edits audit changed pages and all shared obligation owners with full original authority',async()=>{
    const p=fixture();const base=p.deck.slides[1];p.deck.slides=Array.from({length:25},(_,i)=>({...structuredClone(base),id:'s'+i,nodes:base.nodes.map(n=>({...structuredClone(n),id:'n'+i+'_'+n.id}))}));p.outline=p.deck.slides.map(x=>({id:x.id,title:x.title}));
    p.planning={slidePlan:[{slideId:'s1',requiredDetails:['Queue workers advance only after validation succeeds.']},{slideId:'s9',requiredDetails:['Queue workers advance only after validation succeeds.']}]};
    const q=mutate(p,'Check results before moving forward');let checked;
    const audit=await assertCandidateScope(p,q,{modelCall:async view=>{checked=view.deck.slides.map(s=>s.id);assert.equal(view.source.text,p.source.text);assert.ok(Array.isArray(view.reviewScope.fullObjectCoverage));return scopeReview(view);}},noop);
    assert.deepEqual(checked,['s1','s9']);assert.equal(audit.coverage,'changed_and_dependency_pages');assert.equal(audit.publicationReviewRequired,true);assertStoredCandidateScope(p,q,{scopeAudit:audit});
    const drift=structuredClone(q);drift.deck.slides[12].nodes[0].content.text='Unrelated newer modification';assert.throws(()=>assertStoredCandidateScope(p,drift,{scopeAudit:audit}),/missing or stale/);
    const latest=structuredClone(p),rebased=structuredClone(q);latest.deck.slides[12].nodes[0].content.text=rebased.deck.slides[12].nodes[0].content.text='User edit on another page';assertStoredCandidateScope(latest,rebased,{scopeAudit:audit});
    const dependent=structuredClone(p),dependentCandidate=structuredClone(q);dependent.deck.slides[9].nodes[0].content.text=dependentCandidate.deck.slides[9].nodes[0].content.text='Changed shared obligation context';assert.throws(()=>assertStoredCandidateScope(dependent,dependentCandidate,{scopeAudit:audit}),/missing or stale/);
    await assert.rejects(()=>assertCandidateScope(p,q,{modelCall:async view=>scopeReview(view,{unsupported:[{slideIds:['s1'],detail:'Unsupported new fact',reason:'unsupported_fact'}]})},noop),/original input framework/);
  });
  await test('local scope corrects malformed review identities without suppressing semantic findings',async()=>{
    const p=fixture(),q=mutate(p,'Check results before moving forward');let calls=0;
    const audit=await assertCandidateScope(p,q,{modelCall:async view=>++calls===1?scopeReview(view,{unsupported:[{slideIds:['unknown-page'],detail:'Invalid identity',reason:'unsupported_fact'}]}):scopeReview(view)},noop);assert.equal(calls,2);assert.equal(audit.status,'complete');
    await assert.rejects(()=>assertCandidateScope(p,q,{modelCall:async view=>scopeReview(view,{unsupported:[{slideIds:['s1'],detail:'Actual unsupported fact',reason:'unsupported_fact'}]})},noop),/original input framework/);
  });
  console.log(JSON.stringify({status:'passed',scenarioCount:checks.length,checks,model:'simulated; protocol and gates verified, live semantic accuracy not measured'},null,2));
} finally { fs.rmSync(root,{recursive:true,force:true}); }
