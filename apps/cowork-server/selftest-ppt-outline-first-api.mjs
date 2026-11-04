// Card outline API (2026-10-23, S10/S11): the input is read by code, the
// settings form's one 'outline' command writes the whole outline (one deck call
// and one finishing call), the author edits and confirms it; the retired
// semantic/expand/save commands, the outline pause and the old /outline route
// are refused; a user-supplied outline becomes cards without a model call.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-outline-first-'));process.env.COWORK_STATE_DIR=temp;
const {handlePpt}=await import('./lib/ppt-api.mjs'),store=await import('./lib/ppt-store.mjs');
const {newPlanningContract,assertPlanningReady}=await import('./lib/ppt-outline-first.mjs');
const {defaultGenerationPolicy}=await import('./lib/ppt-generation-policy.mjs');
const {normalizePaste}=await import('./lib/ppt-source.mjs');const {BUILT_INS,snapshotTemplate}=await import('./lib/ppt-template.mjs');
const {cardDeckReply}=await import('./ppt-scope-test-helpers.mjs');
const uid='outline-first-test',id='c'.repeat(32),calls=[];
const p={uid,id,title:'Evidence',prompt:'Evidence',model:'fixture',configId:'fixture',pages:12,template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),generationPolicy:defaultGenerationPolicy(),status:'input_ready',stage:'input',outline:[],nodes:{},revision:0,
 source:normalizePaste('# Evidence\n\n## Mechanism\n\nA signal is informative only when known before trading.\n\n## Practice\n\nEvaluate on unseen dates; avoid leakage.\n\n## Limits\n\nCosts and capacity limit what a signal can earn.\n\n## Review\n\nCompare every result with a simple baseline.'),pageDecision:{mode:'auto',initialPageCount:12,finalPageCount:12}};
p.planningContract=newPlanningContract(p);
let model=async(project,prompt,_a,_l,o)=>{calls.push(o.nodeKey);const reply=cardDeckReply(project,prompt,o);if(reply)return reply;throw Error('Unexpected model stage '+o.nodeKey);};
async function request(action,data={},method='POST'){let result;const req=Readable.from([Buffer.from(JSON.stringify(data))]);req.method=method;await handlePpt(req,new URL('http://local/ppt/projects/'+id+(action?'/'+action:'')),{uid,deps:{modelCall:(...args)=>model(...args)},activity:()=>{},log:()=>{},res:{},send:(status,body)=>{result={status,body};return true;}});return result;}
async function settled(){for(let i=0;i<1000;i++){const latest=store.get(uid,id);if(latest.status!=='outlining')return latest;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture timed out');}
try{
 store.save(structuredClone(p));
 let r=await request('generate');assert.equal(r.status,409,'reading cannot enter the writer');
 // Retired planning commands and route (S10/S11).
 for(const command of ['semantic','expand','save'])assert.equal((await request('planning',{command})).status,400,command+' was retired');
 assert.equal((await request('outline',{pages:6})).status,410,'the ledger outline route was retired');
 // One step: the settings form's command writes the whole outline.
 r=await request('planning',{command:'outline',length:{preset:'standard'},contentMode:'standard'});assert.equal(r.status,202,JSON.stringify(r.body));
 assert.equal((await request('pause')).status,409,'an outline is not paused (S10)');
 let saved=await settled();
 assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));assert.equal(saved.planningContract.phase,'page_plan_ready');
 assert.deepEqual(calls.map(key=>key.replace(/:[0-9a-f]{8,}(?=:|$)/u,'')),['outline:cards:deck:0','outline:finish','outline:retitle','outline:retitle:standard'],'the deck, finishing and titling calls (with the title standard retry, N5): '+calls.join());
 assert.equal(saved.inputUnderstanding.basis,'code_statistics');assert.equal(saved.planningContract.contentMode,'standard');
 assert.ok(saved.outline.slice(1,-1).every(slide=>slide.keyPoints?.length&&slide.keyPoints.every(point=>point.text&&point.refs)),'cards carry their points as keyPoints');
 assert.deepEqual(saved.outline.at(-1).keyPoints,[],'the closing says only its thanks (the user, 2026-10-31)');
 assert.equal(saved.contentSelection,undefined,'no per-unit selection ledger');
 assert.equal(saved.outline.length,saved.planningContract.cardOutline.raw.slides.length);
 assert.equal(saved.planningContract.cardDraft,undefined,'no outline draft');
 assertPlanningReady(saved);
 // The author edits the written cards (no model call), then confirms them.
 {const before=calls.length,[cover,...rest]=saved.outline,edit=[{id:cover.id,title:cover.title,points:[]},{title:'My own framing',points:['A point in my own words']},...rest.map(slide=>({id:slide.id,title:slide.title,points:slide.keyPoints.map(point=>point.text),numbered:Boolean(slide.numberedPoints)}))];
  r=await request('planning',{command:'edit',semanticRevision:'stale',cards:edit});assert.equal(r.status,409,'a stale revision is refused');
  r=await request('planning',{command:'edit',semanticRevision:saved.planningContract.semanticRevision,cards:[edit[1],edit[0]]});assert.equal(r.status,400,'the cover stays first');
  r=await request('planning',{command:'edit',semanticRevision:saved.planningContract.semanticRevision,cards:edit});assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(calls.length,before,'editing calls no model');
  const edited=store.get(uid,id);assert.equal(edited.status,'outline_ready');assert.equal(edited.outline.length,saved.outline.length+1);assert.equal(edited.pages,edited.outline.length);
  assert.deepEqual({title:edited.outline[1].title,author:edited.outline[1].authorEdited,points:edited.outline[1].keyPoints},{title:'My own framing',author:true,points:[{text:'A point in my own words',author:true,refs:[],chunkRefs:[]}]});
  assert.deepEqual(edited.planningContract.actualPageIds,edited.outline.map(slide=>slide.id));
  // A point stating a quantity its sources do not would block publishing:
  // confirming and generating refuse it until the author edits it (live check, report 98981dcf).
  {const wrong=structuredClone(edit);wrong[2].points=[...wrong[2].points,'The condition holds for 3,700 days'];
   r=await request('planning',{command:'edit',semanticRevision:store.get(uid,id).planningContract.semanticRevision,cards:wrong});assert.equal(r.status,200,JSON.stringify(r.body));
   const unstated=store.get(uid,id);
   r=await request('outline',{slides:unstated.outline,finalPageCount:unstated.outline.length},'PATCH');assert.equal(r.status,409,'confirmation refuses an unstated quantity');
   assert.ok(r.body.issues?.some(issue=>issue.code==='card_quantity_unstated'&&issue.quantity==='3,700 days'),JSON.stringify(r.body).slice(0,400));
   r=await request('generate',{});assert.equal(r.status,409,'generating does not confirm it either');assert.ok(/before generating/.test(r.body.error),r.body.error);assert.ok(!store.get(uid,id).confirmedOutline);
   r=await request('planning',{command:'edit',semanticRevision:store.get(uid,id).planningContract.semanticRevision,cards:edit});assert.equal(r.status,200,'the author edits it away');}
  // Two cards with the same title: a review note, not a refusal (Fable).
  {const twins=edited.outline.map((slide,index)=>({id:slide.id,title:index===3?edited.outline[2].title:slide.title,points:(slide.keyPoints||[]).map(point=>point.text),numbered:Boolean(slide.numberedPoints)}));
   assert.equal((await request('planning',{command:'edit',semanticRevision:edited.planningContract.semanticRevision,cards:twins})).status,200);}
  const twinned=store.get(uid,id);assert.equal(twinned.outline[3].title,twinned.outline[2].title);
  r=await request('outline',{slides:twinned.outline,finalPageCount:twinned.outline.length},'PATCH');assert.equal(r.status,200,'the edited outline is confirmed for writing: '+JSON.stringify(r.body).slice(0,300));
  assert.ok(store.get(uid,id).confirmedOutline);}
 // A storage failure leaves the saved project as it was.
 {const before=store.get(uid,id),write=fs.writeFileSync;try{fs.writeFileSync=(file,...args)=>{if(String(file).startsWith(temp)&&String(file).endsWith('.tmp'))throw Object.assign(Error('Injected storage full'),{code:'ENOSPC'});return write(file,...args);};assert.throws(()=>store.save({...before,title:'Uncommitted change'}),{code:'ENOSPC'});}finally{fs.writeFileSync=write;}assert.deepEqual(store.get(uid,id),before);}
 // A failed run is written again in full on retry (no kept topics, S10).
 {store.save(structuredClone(p));calls.length=0;let failOnce=true;const cards=model;
  model=async(project,prompt,a,l,o)=>{if(/:deck:/u.test(o.nodeKey)&&failOnce){failOnce=false;calls.push(o.nodeKey);throw Object.assign(Error('Injected provider unavailable'),{code:'transport'});}return cards(project,prompt,a,l,o);};
  r=await request('planning',{command:'outline'});assert.equal(r.status,202);
  // A deck call that fails is not fatal: each topic is written on its own.
  saved=await settled();assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
  assert.ok(calls.some(key=>/:topic:\d+$/u.test(key)),'the topics are written one by one after the deck call failed');
  store.save(structuredClone(p));calls.length=0;failOnce=true;
  model=async(project,prompt,a,l,o)=>{if(/:finish:|:topic:|:deck:/u.test(o.nodeKey)&&failOnce&&/:finish:/u.test(o.nodeKey)){failOnce=false;calls.push(o.nodeKey);throw Object.assign(Error('Injected provider unavailable'),{code:'transport'});}return cards(project,prompt,a,l,o);};
  r=await request('planning',{command:'outline'});saved=await settled();
  assert.equal(saved.status,'outline_ready','a failed finishing call keeps the cards: chapters use their headings, no takeaway');
  assert.ok(saved.planningContract.cardOutline.advisories.some(advisory=>advisory.code==='outline_finish_unavailable'));
  model=cards;}
 // A user-supplied outline is the card outline as written: no model call.
 {const author={...structuredClone(p),status:'outlining',stage:'outline',readOnlyInput:false,requestedOutline:[{id:'cover',title:'Evidence'},{id:'one',title:'Why signals work',children:[{title:'Known before trading'},{title:'Unseen dates'}]},{id:'two',title:'Limits',description:'Costs and capacity'}]};
  store.save(author);calls.length=0;const {startOutlineForTest}=await import('./lib/ppt-api.mjs').then(api=>({startOutlineForTest:api._internals.startOutline}));
  startOutlineForTest(uid,id,()=>{},()=>{},{modelCall:(...args)=>model(...args)});saved=await settled();
  assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error}));assert.equal(calls.length,0,'no model call');
  assert.deepEqual(saved.outline.map(slide=>slide.title),['Evidence','Why signals work','Limits']);
  assert.deepEqual(saved.outline[1].keyPoints.map(point=>point.text),['Known before trading','Unseen dates']);
  assert.ok(saved.outline.slice(1).every(slide=>slide.authorEdited&&slide.keyPoints.every(point=>point.author)),'the author\'s own text');
  assert.equal(saved.requestedOutline,undefined);}
 // A project of the retired ledger flow is not planned again (editor only).
 {const legacy={...structuredClone(p),status:'failed',stage:'outline',planningContract:undefined};store.save(legacy);
  assert.equal((await request('retry')).status,409,'a retired-flow outline is not retried');}
 console.log('PASS card outline API: code reading, one-step outline with two model calls, retired commands and route refused, no outline pause, deck-call fallback, finishing-call fallback, edit and confirm, atomic storage, the author outline as cards, retired-flow projects editor-only.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
process.exit(0);
