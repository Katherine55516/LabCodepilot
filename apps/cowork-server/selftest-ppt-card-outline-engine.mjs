// Card outline engine (2026-10-23): the settings form's choices, one deck call
// plus one finishing call, the per-topic fallback, chapters, takeaway, labels,
// the outline summary, and the other-language speaker notes.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-card-engine-'));process.env.COWORK_STATE_DIR=temp;
const {handlePpt}=await import('./lib/ppt-api.mjs'),store=await import('./lib/ppt-store.mjs');
const {newPlanningContract}=await import('./lib/ppt-outline-first.mjs');
const {defaultGenerationPolicy}=await import('./lib/ppt-generation-policy.mjs');
const {normalizePaste}=await import('./lib/ppt-source.mjs');const {BUILT_INS,snapshotTemplate}=await import('./lib/ppt-template.mjs');
const {pagesFor,pagesForTotal,analyzeSourceStructure,planCardDeck}=await import('./lib/ppt-card-outline.mjs');
const {cardLanguageNotes,defaultLanguageChoice,languagePolicy,mergeNotes}=await import('./lib/ppt-card-language.mjs');
const {cardDeckReply}=await import('./ppt-scope-test-helpers.mjs');
const {withSemanticIndex}=await import('./lib/ppt-semantic.mjs');

const uid='card-engine-test',id='e'.repeat(32);
const sections=Array.from({length:10},(_,k)=>`## ${k+1}. Topic ${k+1} heading\n\nThe mechanism of topic ${k+1} holds when its condition is met, and the reader checks it on unseen dates.\n\nPractice for topic ${k+1}: compare the result with a simple baseline before trusting it.`).join('\n\n');
const source=normalizePaste(`# Tutorial 9 — Signal Design: Basics\n\nThis tutorial explains how signals are built and checked.\n\n${sections}`);
const base={uid,id,title:'Signal Design',prompt:'Signal Design',model:'fixture',configId:'fixture',pages:12,template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),
 generationPolicy:defaultGenerationPolicy(),status:'input_ready',stage:'input',outline:[],nodes:{},revision:0,source};
base.planningContract=newPlanningContract(base);
for(const heading of ['Acknowledgements','Acknowledgments','致谢','致謝']){
 const p={...base,source:withSemanticIndex(normalizePaste(`# Research\n\n## Findings\n\nThe experiment supports a useful result.\n\n## ${heading}\n\nWe thank the people who assisted with this work.`))};
 const plan=planCardDeck(p,analyzeSourceStructure(p),{preset:'standard'});
 assert.ok(plan.excludedSections.includes(heading),`${heading} is archived rather than used as a presentation topic`);
 assert.ok(!plan.logicalCards.some(card=>card.title===heading));
}
const calls=[],prompts=new Map();
const jsonLine=(prompt,start)=>JSON.parse(prompt.split('\n').find(line=>line.startsWith(start)));
// A point is a whole sentence: one ending on a colon is a lead-in the outline sends back (report ae88d807).
const firstSentence=text=>String(text).split(/(?<=[.])\s/u)[0].slice(0,88);
const cardsFor=(units,n,title)=>Array.from({length:n},(_,i)=>{const own=units.slice(Math.floor(i*units.length/n),Math.floor((i+1)*units.length/n));
 return{title:`${title} card ${i+1}`.slice(0,38),numbered:false,visualIntent:'text',points:own.map(unit=>({text:firstSentence(unit.text),sourceUnitIds:[unit.id]})),objects:[]};});
let failDeck=false,listDeck=false,failCorrection=false,failTopicOnce=false;
let model=async(_p,prompt,_a,_l,o)=>{
 calls.push(o.nodeKey);prompts.set(o.nodeKey,prompt);
 if(/^outline:cards:[^:]+:brief/u.test(o.nodeKey))return cardDeckReply(_p,prompt,o);
 if(/^outline:cards:[^:]+:deck:\d+$/.test(o.nodeKey)){
  if(failDeck)throw Object.assign(Error('Injected invalid deck reply'),{code:'invalid_json'});
  const {topics}=jsonLine(prompt,'{"topics":');
  const reply={topics:topics.map(topic=>({topicId:topic.topicId,cards:cardsFor(topic.sourceUnits.filter(unit=>!/^#/u.test(unit.text)),topic.cards,topic.title)}))};
  // A source list compressed into one point with its item numbers (alpha-r2).
  if(listDeck){const point=reply.topics[0].cards[0].points[0];point.text='Check the mechanism; 2. Compare a baseline; 3. Test unseen dates';}
  return reply;
 }
 if(failCorrection&&/:topic:\d+:contract$/.test(o.nodeKey))throw Object.assign(Error('ppt_timeout'),{code:'timeout'});
 if(failTopicOnce&&/:topic:0$/.test(o.nodeKey)){failTopicOnce=false;throw Object.assign(Error('ppt_timeout'),{code:'timeout'});}
 if(/^outline:cards:[^:]+:topic:\d+(?::retry)?(?::contract)?$/.test(o.nodeKey)){
  const {topic,cards,sourceUnits}=jsonLine(prompt,'{"topic":');
  return{pages:cardsFor(sourceUnits,cards,topic.title)};
 }
 if(/^outline:finish:/.test(o.nodeKey)){
  const task=jsonLine(prompt,'{"chapters":');
  return{chapters:task.chapters.map(chapter=>({title:chapter.headings[0]})),
   takeaway:/at most 40 characters, zh/u.test(prompt)?{title:'先比基准再信结果',text:'先与简单基准比较，再相信结果。',sourceUnitIds:(task.citedSourceUnitIds||[]).slice(-1)}:{title:'Beat a baseline before trusting a result',text:'Compare the result with a simple baseline before trusting it.',sourceUnitIds:(task.citedSourceUnitIds||[]).slice(-1)},
   labels:task.cards.flatMap(card=>card.points.map(point=>({card:card.card,point:point.point,label:(words=>`${words[0]} ${words.at(-1)}`)(point.text.replace(/[.。]$/u,'').split(/\s+/u))})))};
 }
 throw Error('Unexpected model stage '+o.nodeKey);
};
async function request(action,data={},method='POST'){let result;const req=Readable.from([Buffer.from(JSON.stringify(data))]);req.method=method;await handlePpt(req,new URL('http://local/ppt/projects/'+id+'/'+action),{uid,deps:{modelCall:(...args)=>model(...args)},activity:()=>{},log:()=>{},res:{},send:(status,body)=>{result={status,body};return true;}});return result;}
async function settled(){for(let i=0;i<1000;i++){const latest=store.get(uid,id);if(latest.status!=='outlining')return latest;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture timed out');}
const run=async settings=>{store.save(structuredClone(base));calls.length=0;prompts.clear();const r=await request('planning',{command:'outline',...settings});assert.equal(r.status,202,JSON.stringify(r.body));return settled();};

try{
 // Presets (D4): cover and closing always, one table of contents for 8+ standard/full cards, no takeaway
 // (the user, 2026-10-31); exact totals are clamped to 6-40.
 assert.deepEqual(pagesFor('standard',8),{content:8,dividers:1,takeaway:false,closing:true,total:11},'the separate closing page counts');
 assert.deepEqual(pagesFor('quick',2),{content:5,dividers:0,takeaway:false,closing:true,total:7},'at least six pages before the closing');
 assert.deepEqual(pagesForTotal(50),{content:37,dividers:1,takeaway:false,closing:true,total:40},'an exact total includes the closing page');

 // The outline forms in view (P1/P2, 2026-10-31): the planned topics before any
 // call returns, every written card before the finishing call, then named steps.
 {const {liveProjectView}=await import('./lib/ppt/project-view.mjs');
  const plain=model,seen=[];model=async(project,prompt,a,l,o)=>{const current=store.get(uid,id);seen.push([o.nodeKey,structuredClone(current.outlineForming),liveProjectView(current).outlineForming]);return plain(project,prompt,a,l,o);};
  let formed;try{formed=await run({length:{preset:'standard'}});}finally{model=plain;}
  const [,atDeck,deckView]=seen.find(([key])=>/:deck:0$/u.test(key));
  assert.equal(atDeck.phase,'cards');assert.ok(atDeck.total>0&&atDeck.done===0&&atDeck.syllabus.every(item=>item.pending&&item.title),'the planned topics show before any card is written');
  assert.deepEqual(deckView,atDeck,'the live view carries the forming outline while it is written');
  const [,atFinish]=seen.find(([key])=>/^outline:finish:[^:]+$/u.test(key));
  assert.equal(atFinish.phase,'finishing');assert.equal(atFinish.done,atFinish.total,'every topic is written before the finishing call');
  assert.ok(atFinish.syllabus.length>=atFinish.total&&atFinish.syllabus.every(item=>!item.pending&&item.title&&item.points.length),'written cards show their points');
  assert.equal(formed.status,'outline_ready',JSON.stringify({error:formed.error}));
  assert.equal(formed.outlineForming.phase,'checking','the last step before the outline is ready is named');
  assert.equal(liveProjectView(formed).outlineForming,undefined,'a ready outline does not show the forming cards');}

 // Standard length: one deck call and one finishing call, nothing else.
 let saved=await run({length:{preset:'standard'}});
 assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
 assert.equal(saved.planningContract.phase,'page_plan_ready');
 assert.deepEqual(calls.map(key=>key.replace(/:[0-9a-f]{8,}(?=:|$)/u,':R')),['outline:cards:R:deck:0','outline:finish:R','outline:retitle:R'],'the deck, finishing and titling calls: '+calls.join());
 assert.equal(saved.inputUnderstanding.basis,'code_statistics','the source is read by code');
 assert.ok([...prompts.entries()].find(([key])=>/:deck:0$/u.test(key))[1].includes('"3,700 trading days" never becomes "3,700 days"'),'the deck call names quantity qualifiers (report 135c362b)');
 assert.equal(saved.inputUnderstanding.sections.length,10);
 assert.equal(saved.inputUnderstanding.presets.standard.total,11,'8 cards, a table of contents, the cover and the closing');
 assert.deepEqual(saved.generationPolicy.language,{mode:'output',locale:'en'},'an English source defaults to English');
 // Two chapters: no table of contents (it needs three), no dividers, no takeaway (the user, 2026-10-31).
 assert.equal(saved.outline.length,10,saved.outline.map(slide=>slide.title).join(' / '));
 assert.equal(saved.outline[0].coverSourceTitle,saved.outline[0].title,'a cover from the source keeps that title in data');
 assert.ok(!saved.outline.some(slide=>slide.cardFrame),'no divider and no takeaway page');
 assert.equal(saved.outline.at(-1).role,'closing','the deck ends with its closing page');
 assert.deepEqual([saved.outline.at(-1).title,saved.outline.at(-1).keyPoints],['Thanks for watching!',[]],'the closing says only thanks');
 assert.equal(saved.outline[1].section,'Introduction','cards before the first chapter open the deck');
 assert.deepEqual([...new Set(saved.outline.slice(2,-1).map(slide=>slide.section))],['Topic 3 Heading','Topic 7 Heading'],'each card is labelled with its chapter');
 assert.ok(saved.outline.some(slide=>slide.keyPoints?.some(point=>point.label)),'points carry their labels');
 {let chapter='';for(const slide of saved.outline.slice(1)){if(slide.cardFrame==='divider'){chapter=slide.title;continue;}if(chapter&&!slide.cardFrame&&slide.role!=='closing')assert.equal(slide.section,chapter,'a card is labelled with its chapter');assert.doesNotMatch(String(slide.section),/^\d/u,'no source numbering in a section label: '+JSON.stringify([slide.cardFrame,slide.title,slide.section]));}}
 const summary=saved.planningContract.cardOutline.summary;
 assert.equal(saved.outline.at(-2).section,'Topic 7 Heading','the last card keeps its chapter label; no takeaway follows it');
 // Card prompts carry it; the finishing call writes only chapter names and labels (no takeaway since 2026-10-31).
 for(const [key,prompt] of prompts)if(!/^outline:(?:finish|retitle):/u.test(key))assert.ok(prompt.includes('never a LaTeX command outside $...$'),'the LaTeX clause is in the prompt: '+key);
 assert.equal(summary.language,'en');assert.equal(summary.length,'standard');assert.equal(summary.pages,10);assert.deepEqual(summary.chapters,[],'two chapters: no table of contents to list');assert.equal(summary.takeaway,false);
 assert.ok(summary.labelled>0);
 assert.equal(saved.planningContract.cardDraft,undefined,'the draft ends with the outline');

 // No takeaway page (the user, 2026-10-31): the finishing call does not ask for one.
 {const finishPrompt=[...prompts].find(([key])=>/^outline:finish:[^:]+$/u.test(key))[1];
  assert.ok(!finishPrompt.includes('"takeaway"')&&!calls.some(key=>/:takeaway$/u.test(key)),'no takeaway is asked for');}
 // A chapter name that repeats a card title (or is too long) falls back to a distinct heading-based name.
 {const plain=model;model=async(project,prompt,a,l,o)=>{const reply=await plain(project,prompt,a,l,o);if(/^outline:finish:/u.test(o.nodeKey)){const task=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"chapters":')));const first=task.cards.find(card=>card.card>1)?.title;reply.chapters=[{title:first||'x'},{title:'An unusually long chapter name that runs past forty characters'}];}return reply;};
  const repeated=await run({length:{preset:'standard'}});model=plain;
  const cardTitles=new Set(repeated.outline.filter(slide=>!slide.cardFrame).map(slide=>slide.title)),chapters=[...new Set(repeated.outline.slice(2,-1).map(slide=>slide.section))];
  assert.equal(chapters.length,2);assert.ok(chapters.every(title=>!cardTitles.has(title)),'fallback names are distinct: '+chapters.join(' / '));
  assert.ok(repeated.planningContract.cardOutline.advisories.some(advisory=>advisory.code==='chapter_title_fallback'));}
 // Rewrite (D6): quick length, Chinese, and the author's instruction in the prompt.
 saved=await run({length:{preset:'quick'},language:'zh',instruction:'Focus on practice.'});
 assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
 const deckPrompt=[...prompts].find(([key])=>key.includes(':deck:'))[1];
 assert.ok(deckPrompt.includes('Focus on practice.')&&deckPrompt.includes('Simplified Chinese'),'the instruction and the language reach the prompt');
 assert.deepEqual(saved.generationPolicy.language,{mode:'output',locale:'zh'});
 assert.equal(saved.planningContract.languageChoice,'zh');
 assert.equal(saved.outline.length,8,'quick: six cards, the cover and the closing');
 assert.deepEqual([saved.outline.at(-1).title,saved.outline.at(-1).keyPoints],['感谢观看',[]],'a Chinese deck closes with 感谢观看 only');
 assert.equal(saved.outline.filter(slide=>slide.cardFrame==='divider').length,0,'no chapters in a quick deck');

 // An exact total.
 saved=await run({length:{exact:9}});
 assert.equal(saved.status,'outline_ready');assert.equal(saved.outline.length,9);

 // A deck reply that cannot be used: each topic is written on its own.
 failDeck=true;saved=await run({length:{preset:'standard'}});failDeck=false;
 assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
 assert.equal(calls.filter(key=>/:topic:\d+$/u.test(key)).length,8,'one call per topic after the deck call failed');
 assert.equal(saved.outline.length,10,'8 cards, the cover and the closing');
 // Item numbers inside one point send that topic back once (Fable, alpha-r2); the deck is still written.
 listDeck=true;saved=await run({length:{preset:'standard'}});listDeck=false;
 assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
 assert.deepEqual(calls.filter(key=>/:topic:/u.test(key)).map(key=>key.split(':').slice(3).join(':')),['topic:0:contract'],'only the topic with the list goes back, once');
 assert.ok(saved.outline.every(slide=>(slide.keyPoints||[]).every(point=>!/[;；]\s*\d+\.\s/u.test(point.text))),'no item numbers inside a point');
 // A correction call that times out keeps the topic's deck reply, sanitized and listed (D12, F2; live mlq-r4).
 listDeck=true;failCorrection=true;saved=await run({length:{preset:'standard'}});listDeck=false;failCorrection=false;
 assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
 assert.ok(saved.planningContract.cardOutline.advisories.some(advisory=>advisory.code==='card_topic_correction_unavailable'));
 assert.ok(saved.outline.every(slide=>(slide.keyPoints||[]).every(point=>!/[;；]\s*\d+\.\s/u.test(point.text))),'the kept reply is sanitized');
 // A topic with no reply yet is written once more after a timeout (live mlq-r6).
 failDeck=true;failTopicOnce=true;saved=await run({length:{preset:'standard'}});failDeck=false;
 assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
 assert.ok(calls.some(key=>/:topic:0:retry$/u.test(key)),'the timed-out topic is written once more');
 // A topic with no usable reply on a deck in another language than its source
 // (Fable 2026-11-03, Q2 A): one slim call writes its excerpts in the deck's
 // language; if that fails they go to the speaker notes and the topic is flagged.
 {const plain=model;let fail=false;
  model=async(project,prompt,a,l,o)=>{
   if(/:topic:0(?::retry)?(?::contract)?$/u.test(o.nodeKey)){calls.push(o.nodeKey);return{pages:[]};}
   if(/:topic:0:excerpts$/u.test(o.nodeKey)){calls.push(o.nodeKey);if(fail)throw Object.assign(Error('ppt_timeout'),{code:'timeout'});const {passages}=jsonLine(prompt,'{"topic":');return{points:passages.map(passage=>({text:'该主题的机制在条件满足时成立。',sourceUnitIds:passage.sourceUnitIds}))};}
   return plain(project,prompt,a,l,o);};
  const topicIds=current=>new Set(current.planningContract.logicalCards[1].sourceUnitIds||[]);
  try{
   failDeck=true;saved=await run({length:{preset:'standard'},language:'zh'});
   assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
   assert.ok(calls.some(key=>/:topic:0:excerpts$/u.test(key)),'one slim call');
   const own=topicIds(saved),shown=saved.outline.flatMap(slide=>(slide.keyPoints||[]).filter(point=>(point.sourceUnitIds||[]).some(id=>own.has(id))));
   assert.ok(shown.length&&shown.every(point=>point.text==='该主题的机制在条件满足时成立。'),'the excerpts show in the deck\'s language: '+JSON.stringify(shown.map(point=>point.text)));
   assert.ok(saved.planningContract.cardOutline.advisories.some(advisory=>advisory.code==='card_excerpts_rewritten'));
   fail=true;saved=await run({length:{preset:'standard'},language:'zh'});
   assert.equal(saved.status,'outline_ready',JSON.stringify({error:saved.error,calls}));
   const again=topicIds(saved),visible=saved.outline.flatMap(slide=>(slide.keyPoints||[]).filter(point=>(point.sourceUnitIds||[]).some(id=>again.has(id))&&!/\p{Script=Han}/u.test(point.text)));
   assert.deepEqual(visible.map(point=>point.text),[],'no English excerpt on a slide');
   assert.ok(saved.outline.some(slide=>(slide.notePoints||[]).some(note=>(note.sourceUnitIds||[]).some(id=>again.has(id)))),'the excerpts are in the notes');
   assert.ok(saved.planningContract.cardOutline.advisories.some(advisory=>advisory.code==='card_excerpts_to_notes'),'and the topic is flagged');
  }finally{failDeck=false;model=plain;}}

 // Invalid settings are refused.
 store.save(structuredClone(base));
 assert.equal((await request('planning',{command:'outline',length:{preset:'huge'}})).status,400);
 assert.equal((await request('planning',{command:'outline',length:{exact:3}})).status,400);
 assert.equal((await request('planning',{command:'outline',language:'fr'})).status,400);

 // Brief mode (Fable): a prompt with no source document is written in one call.
 {const briefId='b'.repeat(32),brief={...structuredClone(base),id:briefId,title:'平台架构',prompt:'解释平台架构和实施路线',userRequirements:'解释平台架构和实施路线',source:null,generationPolicy:{...defaultGenerationPolicy(),knowledge:'source_plus_explanation'}};
  brief.planningContract=newPlanningContract(brief);
  const briefRequest=async(action,data={})=>{let result;const req=Readable.from([Buffer.from(JSON.stringify(data))]);req.method='POST';await handlePpt(req,new URL('http://local/ppt/projects/'+briefId+'/'+action),{uid,deps:{modelCall:(...args)=>model(...args)},activity:()=>{},log:()=>{},res:{},send:(status,body)=>{result={status,body};return true;}});return result;};
  const briefSettled=async()=>{for(let i=0;i<1000;i++){const latest=store.get(uid,briefId);if(latest.status!=='outlining')return latest;await new Promise(r=>setTimeout(r,10));}throw Error('brief timed out');};
  store.save(structuredClone(brief));calls.length=0;
  assert.equal((await briefRequest('planning',{command:'outline',length:{preset:'standard'}})).status,202);let done=await briefSettled();
  assert.equal(done.status,'outline_ready',JSON.stringify({error:done.error,calls}));
  assert.deepEqual(calls.map(key=>key.replace(/:[0-9a-f]{8,}(?=:|$)/u,'')),['outline:cards:brief','outline:finish','outline:retitle'],'one brief call, the finishing call and the titling call');
  assert.equal(done.inputUnderstanding.brief,true);assert.deepEqual(Object.values(done.inputUnderstanding.presets).map(preset=>preset.total),[8,12,18],'each length plus the closing; a brief has no table of contents');
  assert.deepEqual(done.generationPolicy.language,{mode:'output',locale:'zh'},'a Chinese brief defaults to Chinese');
  assert.equal(done.outline.length,12);assert.ok(!done.outline.some(slide=>slide.cardFrame),'no table of contents and no takeaway');assert.equal(done.outline.at(-1).role,'closing');
  assert.ok(done.outline.every(slide=>!(slide.sourceUnitIds||[]).length),'a brief deck cites no source');
  assert.equal(done.planningContract.cardOutline.summary.basis,'brief');
  // A figure the brief does not give goes back once, then stays listed.
  store.save(structuredClone(brief));calls.length=0;const plain=model;let sent=0;
  model=async(project,prompt,a,l,o)=>{if(/:brief/u.test(o.nodeKey)){sent++;const reply=await plain(project,prompt,a,l,o);reply.cards[0].points[0].text='Adoption grew 37% last year.';return reply;}return plain(project,prompt,a,l,o);};
  assert.equal((await briefRequest('planning',{command:'outline',length:{exact:9}})).status,202);done=await briefSettled();model=plain;
  assert.equal(done.status,'outline_ready');assert.equal(sent,2,'sent back once');assert.equal(done.outline.length,9);
  assert.ok(done.planningContract.cardOutline.advisories.some(advisory=>advisory.code==='card_number_unsourced'),'then listed for the author');}
 // Code the content policy omits (code: omit) is never offered as a card object.
 {const {deckCardsTasks,planCardDeck,codeInputUnderstanding}=await import('./lib/ppt-card-outline.mjs');
  const coded={...structuredClone(base),source:normalizePaste('# Code\n\n## One\n\nA reversal signal ranks recent losers.\n\n```python\ndef alpha(df):\n    return -df.ret\n```\n\n## Two\n\nLiquidity scales the signal.\n\n## Three\n\nCosts cut the edge.\n\n## Four\n\nTest it out of sample.')};
  coded.planningContract=newPlanningContract(coded);coded.inputUnderstanding=codeInputUnderstanding(coded);
  const plan=planCardDeck(coded,coded.inputUnderstanding,{preset:'standard'});coded.planningContract={...coded.planningContract,logicalCards:plan.logicalCards,contentMode:'concise'};
  const code=coded.source.semantic.inventory.items.find(item=>item.type==='CodeBlock');assert.ok(code,'the fixture has a code block');
  const [task]=deckCardsTasks(coded,null,null);
  assert.ok(!task.prompt.includes(code.id),'the omitted code is not shown to the model');
  assert.ok(!JSON.stringify(task.schema).includes(code.id),'nor allowed as an object');
  // Each unit names its own section, so "an object is shown only on a card of its own section" is answerable (Fable 2026-10-26, live fz-i2).
  const offered=JSON.parse(task.prompt.slice(task.prompt.indexOf('{"topics"'),task.prompt.indexOf('\nJSON schema=')));
  const liquidity=offered.topics.flatMap(topic=>topic.sourceUnits).find(unit=>/Liquidity scales/u.test(unit.text));
  assert.equal(liquidity?.section,'Two','a unit carries its section heading: '+JSON.stringify(liquidity));
  assert.ok(/aim for about 75 and 38/u.test(task.prompt),'the point budget names its aim below the limit');
  // A section of only omitted code is no topic, and is listed (report dd4ce71b, 3143 8b31c784).
  const only={...coded,source:normalizePaste('# Code\n\n## One\n\nA reversal signal ranks recent losers.\n\n## Only code\n\n```python\ndef alpha(df):\n    return -df.ret\n```\n\n## Three\n\nCosts cut the edge.\n\n## Four\n\nTest it out of sample.')};
  only.planningContract=newPlanningContract(only);only.inputUnderstanding=codeInputUnderstanding(only);
  const onlyPlan=planCardDeck(only,only.inputUnderstanding,{preset:'standard'});
  assert.ok(!onlyPlan.logicalCards.some(card=>card.title==='Only code'),'no topic for omitted code');assert.deepEqual(onlyPlan.excludedSections,['Only code']);
  // A one-sentence section counts as half a card in the length presets, and planning joins such sections to meet them (Fable, 2026-11-01, review 2 item 6).
  {const long=k=>`## Long ${k}\n\n${'Liquidity, turnover and costs decide whether the signal survives. '.repeat(4)}\n\nThe second paragraph of long ${k} checks it out of sample.`;
   const short=k=>`## Branch ${k}\n\nUse branch ${k} when it fits.`;
   const tiny={...coded,source:normalizePaste(`# Branches\n\n${[short(1),short(2),short(3),short(4),long(1),long(2),long(3)].join('\n\n')}`)};
   tiny.planningContract=newPlanningContract(tiny);tiny.inputUnderstanding=codeInputUnderstanding(tiny);
   const all=codeInputUnderstanding({...tiny,source:normalizePaste(`# Branches\n\n${[long(4),long(5),long(6),long(7),long(1),long(2),long(3)].join('\n\n')}`)});
   assert.ok(tiny.inputUnderstanding.presets.standard.content<all.presets.standard.content,'one-sentence sections count less than full ones');
   const topics=planCardDeck(tiny,tiny.inputUnderstanding,{preset:'standard'}).logicalCards.slice(1).map(card=>card.title);
   assert.equal(topics.length,tiny.inputUnderstanding.presets.standard.content,'the preset is met exactly: '+JSON.stringify(topics));
   assert.ok(['Long 1','Long 2','Long 3'].every(title=>topics.includes(title)),'full sections keep their own cards: '+JSON.stringify(topics));}
  // With few headings, paragraphs are the sections: every unit is in exactly one topic (m2: "来源：财务部" was in two).
  const flat={...coded,source:normalizePaste('# 季度报告\n\n收入增长 10%\n\n来源：财务部')};flat.planningContract=newPlanningContract(flat);flat.inputUnderstanding=codeInputUnderstanding(flat);
  const ids=planCardDeck(flat,flat.inputUnderstanding,{preset:'quick'}).logicalCards.slice(1).flatMap(card=>[...new Set(card.sourceUnitIds)]);
  assert.equal(ids.length,new Set(ids).size,'no unit in two topics: '+ids.join(','));}
 // A cover title that does not fit its native slot gets a headline from its own words (Fable).
 {const {deckFinishTask,acceptDeckFinish,assembleCardDeck}=await import('./lib/ppt-card-outline.mjs');
  const spec={slots:[{role:'title',shapeId:5,maxLines:1,lineVisualUnits:9,fontSizePt:44.5}],nodes:[{id:'t',type:'text',semanticRole:'template-title',nativeRef:{shapeId:5,contractVersion:2},nativeTextFrame:{wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}},geometry:{x:0,y:0,width:6200000,height:800000},style:{fontSizePt:44.5,fontFamily:'Arial',lineHeight:1},content:{text:'Title'}}]};
  const coverProject=title=>({templateFidelity:{slides:[spec]},inputUnderstanding:{primaryLanguage:'en',subject:'Tutorial 12 — '+title+' | 量化金融中的机器学习'},generationPolicy:{language:{mode:'output',locale:'en'}},source:{semantic:{inventory:{items:[{id:'u1',text:'Point one.'}]}}}});
  const rawOf=title=>({slides:[{title,keyPoints:[]},{title:'Card',keyPoints:[{text:'Point one.',sourceUnitIds:['u1']}]}]}),plan={logicalCards:[{sourceUnitIds:[]},{sourceUnitIds:['u1']}],chapters:[]};
  const long=coverProject('Machine Learning for Quantitative Finance'),longRaw=rawOf('Machine Learning for Quantitative Finance'),task=deckFinishTask(long,longRaw,plan);
  assert.ok(task.shortCover&&task.schema.required.includes('coverTitle'),'a headline is asked for when the title does not fit');
  const accept=coverTitle=>acceptDeckFinish(long,longRaw,plan,task,{chapters:[],takeaway:null,labels:[],coverTitle});
  assert.equal(accept('Machine Learning').coverTitle,'Machine Learning');
  for(const bad of ['ML for Quant Finance','Machine Learning for Quantitative Finance','Tutorial 12',''])assert.equal(accept(bad).coverTitle,'',bad);
  assert.ok(accept('ML for Quant Finance').notes.some(note=>note.code==='cover_title_fallback'));
  const deck=assembleCardDeck({...long,planningContract:{logicalCards:[{id:'c',title:'Machine Learning for Quantitative Finance'}]}},[],[],plan,{coverTitle:'Machine Learning',chapters:[],labels:new Map()});
  assert.deepEqual([deck.slides[0].title,deck.slides[0].description],['Machine Learning','Machine Learning for Quantitative Finance'],'the full title stays beneath the headline');
  const alpha=coverProject('Alpha Mining');assert.equal(deckFinishTask(alpha,rawOf('Alpha Mining'),plan).shortCover,false,'a fitting title is kept');}
 // The source's own cover title in another language is translated by the finish
 // call; refused, it stays and the gate lists it, never refuses (Fable 2026-10-26,
 // 01_research_contract.pdf: "研究目标与完整闭环" on an English deck was a 409).
 {const {deckFinishTask,acceptDeckFinish,assembleCardDeck}=await import('./lib/ppt-card-outline.mjs');const {inspectOutlineTopicLanguages}=await import('./lib/ppt-topic-title-validation.mjs');
  const h1='研究目标与完整闭环',p={inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},source:{semantic:{inventory:{items:[{id:'u1',text:'Point one.'}]}}}};
  const raw={slides:[{title:h1,coverSourceTitle:h1,keyPoints:[]},{title:'Card',keyPoints:[{text:'Point one.',sourceUnitIds:['u1']}]}]},plan={logicalCards:[{sourceUnitIds:[]},{sourceUnitIds:['u1']}],chapters:[]};
  const task=deckFinishTask(p,raw,plan);
  assert.ok(task.foreignCover&&!task.shortCover&&task.schema.required.includes('coverTitle')&&task.prompt.includes(`"${h1}" is the source's own title`),'the finish call is asked for the English title');
  const accept=coverTitle=>acceptDeckFinish(p,raw,plan,task,{chapters:[],takeaway:null,labels:[],coverTitle});
  const ok=accept('Research Goals and the Complete Loop');assert.deepEqual([ok.coverTitle,ok.coverTranslated],['Research Goals and the Complete Loop',true]);
  for(const bad of ['研究目标','Research Goals 2024','Research Goals (b_0012)','']){const refused=accept(bad);assert.equal(refused.coverTitle,'',bad);assert.ok(refused.notes.some(note=>note.code==='cover_title_untranslated'),bad);}
  const deck=assembleCardDeck({...p,planningContract:{logicalCards:[{id:'c',title:h1}]}},[],[],plan,{coverTitle:ok.coverTitle,coverTranslated:true,chapters:[],labels:new Map()});
  assert.deepEqual([deck.slides[0].title,deck.slides[0].description,deck.slides[0].coverSourceTitle],['Research Goals and the Complete Loop',undefined,h1],'primary language on the slide, the original in data only');
  // A Chinese deck whose source title is English, on a cover slot of 8 Han
  // (Fable 2026-10-26, 3157 3adb5584): the limit is the Chinese one, an 8-Han
  // headline carries the complete Chinese translation beneath it, a 12-Han reply
  // is repaired once, and a refused repair never falls back to the English title.
  {const {acceptCover,coverCorrectionTask}=await import('./lib/ppt-card-outline.mjs');const {coverSourceNotes}=await import('./lib/ppt-card-language.mjs');
   const en='Reinforcement Learning and LLM Research',slot={slots:[{role:'title',shapeId:5,maxLines:1,lineVisualUnits:8,fontSizePt:40}],nodes:[{id:'t',type:'text',semanticRole:'template-title',nativeRef:{shapeId:5,contractVersion:2},nativeTextFrame:{wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}},geometry:{x:0,y:0,width:4300000,height:800000},style:{fontSizePt:40,fontFamily:'Arial',lineHeight:1},content:{text:'Title'}}]};
   const zh={templateFidelity:{slides:[slot]},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'zh'}},source:{semantic:{inventory:{items:[{id:'u1',text:'Point one.'}]}}}};
   const zhRaw={slides:[{title:en,coverSourceTitle:en,keyPoints:[]},{title:'卡片',keyPoints:[{text:'要点一。',sourceUnitIds:['u1']}]}]},zhTask=deckFinishTask(zh,zhRaw,plan);
   assert.ok(zhTask.foreignCover&&zhTask.schema.required.includes('coverFullTitle'),'the complete translation is asked for');
   assert.ok(zhTask.prompt.includes('at most 8 Chinese characters')&&!zhTask.prompt.includes('at most 14 characters'),'the limit is the Chinese one: '+zhTask.prompt.match(/coverTitle[^\n]*/u)?.[0]);
   assert.equal(zhTask.schema.properties.coverTitle.maxLength,8,'structured output and prose use the same Han limit');
   assert.ok(zhTask.prompt.includes('ONE contiguous substring'),'the Chinese acceptance rule is explicit in the finishing prompt');
   const full='强化学习与大语言模型研究';
   const fine=acceptCover(zh,zhRaw,zhTask,{coverTitle:'大语言模型研究',coverFullTitle:full});
   assert.equal(fine.coverProblem,'',JSON.stringify(fine));assert.deepEqual([fine.coverTitle,fine.coverFullTitle],['大语言模型研究',full],'a headline of the translation\'s own words, the translation beneath');
   const long=acceptCover(zh,zhRaw,zhTask,{coverTitle:full,coverFullTitle:full});
   assert.ok(long.coverProblem.includes('12 characters')&&long.coverProblem.includes('at most 8 Chinese characters'),'the measured reason: '+long.coverProblem);
   assert.equal(long.coverTitle,full,'refused, the Chinese translation stays for the user to edit (never the English source title)');
   assert.ok(long.note.code==='cover_title_untranslated'&&!long.note.message.includes(`"${en}" is kept`),long.note.message);
   const repair=coverCorrectionTask(zh,zhRaw,zhTask,long.coverProblem);
   assert.ok(repair.prompt.includes('12 characters')&&repair.prompt.includes('coverFullTitle')&&repair.schema.required.includes('coverTitle'),'one repair call with the measured reason');
   assert.ok(repair.prompt.includes('ONE contiguous substring'),'the repair repeats the exact acceptance rule');
   assert.ok(acceptCover(zh,zhRaw,zhTask,{coverTitle:'强化学习与大模型研究',coverFullTitle:full}).coverProblem,'the prompt fix must not relax the contiguous-title gate');
   assert.equal(acceptCover(zh,zhRaw,zhTask,{coverTitle:'Reinforcement Learning',coverFullTitle:en}).coverTitle,'','an English reply is not a Chinese title');
   const deck=assembleCardDeck({...zh,planningContract:{logicalCards:[{id:'c',title:en}]}},[],[],plan,{coverTitle:fine.coverTitle,coverTranslated:true,coverFullTitle:full,chapters:[],labels:new Map()});
   assert.deepEqual([deck.slides[0].title,deck.slides[0].description,deck.slides[0].coverTranslation,deck.slides[0].coverSourceTitle],['大语言模型研究',full,full,en],'the headline, the complete translation beneath, the original in data');
   assert.deepEqual(coverSourceNotes({outline:[deck.slides[0]],deck:{slides:[{}]}}),[{index:0,sourceUnitIds:[],text:'原标题：'+en}],'the original title is in the cover\'s speaker notes');}
  // A generic name ("Sheet1") as the only title: the finishing call names the deck from its cards (last resort).
  {const sheet={slides:[{title:'Sheet1',coverSourceTitle:'Sheet1',keyPoints:[]},raw.slides[1]]},generic=deckFinishTask(p,sheet,plan);
   assert.ok(generic.genericCover&&!generic.foreignCover&&generic.prompt.includes('a file name, not a presentation title')&&generic.prompt.includes('sums up the whole input'));
   assert.equal(acceptDeckFinish(p,sheet,plan,generic,{chapters:[],takeaway:null,labels:[],coverTitle:'Decile Returns'}).coverTitle,'Decile Returns');
   // A file-like source title is summed up from the whole input too (the user, 2026-11-03, live f9fe4a3e).
   const file={slides:[{title:'09-MCP 完整链路图(含分支原因,单图版)',coverSourceTitle:'09-MCP 完整链路图(含分支原因,单图版)',keyPoints:[]},raw.slides[1]]},named=deckFinishTask({...p,inputUnderstanding:{subject:'MCP',groups:[{coreMessage:'Host decides when to call MCP'}]}},file,plan);
   assert.ok(named.genericCover&&named.prompt.includes('Host decides when to call MCP'),'the reading goes with the cover request');
   const finished=acceptDeckFinish(p,file,plan,named,{chapters:[],takeaway:null,labels:[],coverTitle:'Decile Returns'});
   assert.equal(finished.coverSummarized,true);
   assert.match(acceptDeckFinish(p,file,plan,named,{chapters:[],takeaway:null,labels:[],coverTitle:'Decile_Returns'}).coverProblem,/names a file/u);
   assert.equal(deckFinishTask({...p,titleSource:'user'},file,plan).genericCover,false,"the author's own title stays");}
  // A bilingual H1 already gave the cover its English half: untouched.
  assert.equal(deckFinishTask(p,{...raw,slides:[{title:'Research Goals',coverSourceTitle:'Research Goals',keyPoints:[]},raw.slides[1]]},plan).foreignCover,false);
  // The gate: the kept source title is a review note on the cover only.
  const card={title:'风险模型',keyPoints:[]},issues=outline=>inspectOutlineTopicLanguages(p,outline).map(issue=>[issue.code,issue.severity,issue.pageIndex]);
  assert.deepEqual(issues([{title:h1,coverSourceTitle:h1},card]),[['cover_title_source_language','warning',0],['planned_topic_language_mismatch','error',1]]);
  assert.deepEqual(issues([{title:h1}]),[['planned_topic_language_mismatch','error',0]],'a cover not taken from the source stays hard');
  assert.deepEqual(issues([{title:'研究目标',coverSourceTitle:h1}]),[['planned_topic_language_mismatch','error',0]],'an edited cover title is checked as written');}
 // Language defaults and the other-language notes (D7).
 assert.equal(defaultLanguageChoice({bilingual:true,primaryLanguage:'en'}),'bilingual');
 assert.equal(defaultLanguageChoice({bilingual:false,primaryLanguage:'zh'}),'zh');
 assert.deepEqual(languagePolicy('bilingual'),{mode:'source',body:'both'});
 const notesProject=on=>({generationPolicy:{language:{mode:'output',locale:'en'}},planningContract:{notesOther:on},
  source:{semantic:{inventory:{items:[{id:'a',text:'Signals rank assets.',languagePairId:'x'},{id:'b',text:'信号给资产排序。',languagePairId:'x'},{id:'c',text:'A table.',rows:[['a']]}]}}},
  outline:[{id:'s0'},{id:'s1',sourceUnitIds:['a','c'],keyPoints:[{text:'Signals rank assets.',sourceUnitIds:['a']}]}],deck:{slides:[{id:'s0'},{id:'s1'}]}});
 assert.deepEqual(cardLanguageNotes(notesProject(true)),[{index:1,sourceUnitIds:['b'],text:'信号给资产排序。'}]);
 assert.deepEqual(cardLanguageNotes(notesProject(false)),[]);
 assert.deepEqual(cardLanguageNotes({...notesProject(true),generationPolicy:{language:{mode:'source',body:'both'}}}),[],'a bilingual deck has no other-language notes');
 assert.deepEqual(mergeNotes([{index:1,sourceUnitIds:['x'],text:'A'}],[{index:1,sourceUnitIds:['b'],text:'B'},{index:0,sourceUnitIds:[],text:'C'}]),[{index:0,sourceUnitIds:[],text:'C'},{index:1,sourceUnitIds:['x','b'],text:'A\n\nB'}]);
 // Mathematics outside $...$ (Fable, fz-r9): a brief deck sends it back, then shows it as plain text;
 // a takeaway gets the source's own formula, else plain text, and a formula the source lacks is refused.
 {const {briefCardProblems,sanitizeBriefDeck,briefDeckTask,acceptTakeaway}=await import('./lib/ppt-card-outline.mjs');
  const briefProject={prompt:'Explain why alpha matters',userRequirements:'Explain why alpha matters',inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},planningContract:{contentMode:'concise'}};
  const cards=[{title:'Positive alpha',numbered:false,visualIntent:'text',points:[{text:'A fund adds value when \\alpha_{i} is positive'}]}];
  assert.ok(briefCardProblems(briefProject,{cards},1).some(problem=>problem.kind==='formula'),'sent back once');
  const brief=sanitizeBriefDeck(briefProject,{n:1},{cards});
  assert.equal(brief.replies[0].pages[0].points[0].text,'A fund adds value when αᵢ is positive');assert.ok(brief.advisories.some(advisory=>advisory.code==='card_formula_plain'));
  assert.ok(briefDeckTask(briefProject,{logicalCards:[{},{}]}).prompt.includes('never a LaTeX command outside $...$'));
  const unit={id:'u1',type:'MechanismBlock',text:'Investment factor: $I/A = \\Delta \\text{Total Assets} / \\text{Total Assets}_{t-1}$, low-minus-high.'};
  const sourced={source:{text:unit.text},originalSourceInventory:{items:[unit]},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}}};
  const raw={slides:[{title:'Cover'},{title:'Investment',keyPoints:[{text:'Conservative firms grow assets slowly',sourceUnitIds:['u1']}]}]},task={cited:['u1']};
  const take=text=>acceptTakeaway(sourced,raw,task,{title:'Growth follows investment',text,sourceUnitIds:['u1']});
  assert.equal(take('Firms with low I/A = \\Delta Total Assets / Total Assets_{t-1} earn more').takeaway.text,'Firms with low $I/A = \\Delta \\text{Total Assets} / \\text{Total Assets}_{t-1}$ earn more','the source formula');
  const plain=take('Exposure \\beta_{i} to investment explains returns');assert.equal(plain.takeaway.text,'Exposure βᵢ to investment explains returns');assert.equal(plain.notes[0].code,'takeaway_math_plain');
  assert.match(take('Returns follow $\\gamma_t$ over time').problems[0],/a formula the source does not/u);
  // The title is in the language the confirmation requires (m2: an English title on a Chinese deck was refused there).
  const zh={...sourced,generationPolicy:{language:{mode:'output',locale:'zh'}},inputUnderstanding:{primaryLanguage:'zh'}};
  assert.match(acceptTakeaway(zh,raw,task,{title:'Growth follows investment',text:'投资少的公司增长更稳。',sourceUnitIds:['u1']}).problems[0],/is not in 简体中文/u);
  assert.equal(acceptTakeaway(zh,raw,task,{title:'投资决定增长',text:'投资少的公司增长更稳。',sourceUnitIds:['u1']}).problems.length,0);
  // A title names the lesson as a claim; a topic title is sent back, then replaced by a plain title (Fable review r11).
  const topic=take('Firms with low investment earn more');assert.ok(topic.takeaway===null||topic.problems.length===0);
  const topical=acceptTakeaway(sourced,raw,task,{title:'Systematic Search Over Formulaic Signals',text:'Firms with low investment earn more',sourceUnitIds:['u1']});
  assert.match(topical.problems[0],/names a topic/u);assert.equal(topical.fallback.takeaway.title,'Key Takeaway');assert.equal(topical.fallback.notes.at(-1).code,'takeaway_title_fallback');
  // A sentence-case title is a claim even without a listed verb; copied source IDs are removed (live fz-r13).
  const both0={...sourced,generationPolicy:{language:{mode:'source',body:'both'}}};
  const live=acceptTakeaway(both0,raw,task,{title:'Good research combines theory and discipline | 好的研究结合理论与纪律',text:'Low investment firms earn more (b_0012) | 投资少的公司收益更高（b_0012）',sourceUnitIds:['u1']});
  assert.deepEqual(live.problems,[]);assert.equal(live.takeaway.text,'Low investment firms earn more | 投资少的公司收益更高');
  // A point from the source's own summary may close the deck (Fable review, fz-r15).
  {const summary={...sourced,originalSourceInventory:{items:[{...unit,sectionPath:['Factor Zoo','Summary']}]}};
   const echoRaw={slides:[{title:'Cover'},{title:'Summary',keyPoints:[{text:'Good research combines theory and discipline',sourceUnitIds:['u1']}]}]};
   assert.deepEqual(acceptTakeaway(summary,echoRaw,task,{title:'Discipline beats data mining',text:'Good research combines theory and discipline',sourceUnitIds:['u1']}).problems,[]);
   assert.match(acceptTakeaway(sourced,echoRaw,task,{title:'Discipline beats data mining',text:'Good research combines theory and discipline',sourceUnitIds:['u1']}).problems[0],/repeats a point/u);}
  // A takeaway title fits a title slot like any card title (live mlq-r14).
  assert.ok(acceptTakeaway(sourced,raw,task,{title:'Good factor research combines theory, careful data discipline, humility and patience over many years',text:'Low investment firms earn more',sourceUnitIds:['u1']}).problems.some(problem=>/characters; at most/u.test(problem)));
  // A bilingual deck's takeaway title has both languages only when titles show both (the user, 2026-10-24).
  const primaryTitles={...sourced,generationPolicy:{language:{mode:'source',body:'both'}}};
  assert.deepEqual(acceptTakeaway(primaryTitles,raw,task,{title:'Growth follows investment',text:'Low investment firms grow steadily | 投资少的公司增长更稳',sourceUnitIds:['u1']}).problems,[],'a primary-language title is accepted');
  const both={...sourced,generationPolicy:{language:{mode:'source',body:'both',title:'both'}}};
  assert.match(acceptTakeaway(both,raw,task,{title:'Growth follows investment',text:'Low investment firms grow steadily | 投资少的公司增长更稳',sourceUnitIds:['u1']}).problems[0],/not bilingual/u);
  assert.equal(acceptTakeaway(both,raw,task,{title:'Growth follows investment | 投资决定增长',text:'Low investment firms grow steadily | 投资少的公司增长更稳',sourceUnitIds:['u1']}).problems.length,0);}
 // Chapters follow the source's top-level sections; a small one joins its neighbour (Fable review fz-r15).
 {const {planCardDeck}=await import('./lib/ppt-card-outline.mjs');
  const section=(top,k,chars)=>({key:top+k,path:[top,top+' '+k],heading:top+' '+k,title:top+' part '+k,titleSecondary:'',parent:JSON.stringify([top]),top,ids:['u'+top+k],chars,objects:{},big:false});
  const sections=[section('1. Opening',1,800),...[1,2,3,4].map(k=>section('2. Theory',k,900)),...[1,2,3,4].map(k=>section('3. Practice',k,900)),section('4. Notes',1,300),section('5. Summary',1,300)];
  const project={title:'Deck',generationPolicy:{language:{mode:'output',locale:'en'}},inputUnderstanding:{primaryLanguage:'en'},source:{sha256:'s'},originalSourceInventory:{items:[]}};
  const plan=planCardDeck(project,{sections,presets:{standard:{content:11,dividers:1,takeaway:false,closing:true,total:14}},primaryLanguage:'en',introSourceUnitIds:[],subject:'Deck'},{preset:'standard'});
  const tops=plan.chapters.map(chapter=>[...new Set(chapter.topicIndexes.map(k=>plan.logicalCards[k+1].sections[0].top))]);
  assert.ok(tops.every((list,k)=>tops.slice(k+1).every(other=>other.every(top=>!list.includes(top)))),'a top-level section is never split across chapters: '+JSON.stringify(tops));
  assert.equal(plan.chapters[0].title,'Theory','a chapter is titled by its top-level heading');
  // One table of contents for 3+ chapters, none for fewer (the user, 2026-10-31).
  assert.equal(plan.pages.dividers,plan.chapters.length>=3?1:0);assert.equal(plan.pages.total,1+plan.pages.content+plan.pages.dividers+1,'cover, cards, contents and closing');}
 console.log('PASS card outline engine: presets, two model calls, brief mode (one call, no citations, figures sent back once), chapters, takeaway, labels, summary, rewrite with instruction and language, exact length, per-topic fallback, invalid settings, other-language notes.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
// Card integrity (Fable review r21 N, fz-r21 p13): a one-point card without an object joins its chapter neighbour;
// a repeated title stays on the card whose sources are that heading's, the other takes its own heading.
{const {cardIntegrity}=await import('./lib/ppt-card-outline.mjs');
 const sy=['T','2. Lineage | 谱系','2.7 Stambaugh-Yuan Mispricing Factors | Stambaugh-Yuan 错误定价因子'],sum=['T','2. Lineage | 谱系','2.8 Summary Table of Models | 模型汇总表'],q=['T','2. Lineage | 谱系','2.6 The q-Factor Model | q 因子模型'];
 const unit=(id,path,type='MechanismBlock')=>({id,type,text:id,sectionPath:path});
 const items=[unit('q1',q),unit('q2',q),unit('s1',sy),unit('s2',sy),unit('s3',sy),unit('t1',sum,'TableBlock'),unit('m1',sum)];
 const p={inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'source',body:'both'}},originalSourceInventory:{items}};
 const plan={logicalCards:[{id:'cover'},{id:'A'},{id:'B'}],chapters:[{topicIndexes:[0,1]}]};
 const pt=(...ids)=>({text:ids.join('+'),sourceUnitIds:ids}),card=(id,topic,title,points,objects=[])=>({id,logicalCardId:topic,title,keyPoints:points,cardObjects:objects,sourceUnitIds:[...points.flatMap(x=>x.sourceUnitIds),...objects]});
 const raw={slides:[{id:'c',title:'Cover'},card('a','A','The q-Factor Model',[pt('q1'),pt('q2')]),card('b','B','Summary Table of Models',[pt('s1','s2')]),card('t','B','Summary Table of Models',[pt('m1')],['t1'])]};
 const lone={slides:[{id:'c',title:'Cover'},card('a','A','The q-Factor Model',[pt('q1')]),card('t','B','Summary Table of Models',[pt('m1')],['t1'])]};cardIntegrity(p,lone,plan);
 assert.equal(lone.slides.length,3,'a topic never loses its only card');
 const notes=cardIntegrity(p,raw,plan);
 assert.deepEqual(raw.slides.map(slide=>[slide.title,(slide.keyPoints||[]).length,(slide.cardObjects||[]).length]),[['Cover',0,0],['The q-Factor Model',2,0],['Summary Table of Models',2,1]],'the one-point card joins its topic neighbour');
 assert.ok(notes.some(note=>note.code==='card_merged'));
 // A two-point card joins the card before it when the two hold at most five points and no table (Fable, 2026-11-01, D3).
 const pair={slides:[{id:'c',title:'Cover'},card('a','A','Q One',[pt('q1'),pt('q2')]),card('b','A','Q Two',[pt('s1'),pt('s2')]),card('d','A','Q Three',[pt('s3'),pt('m1')])]};
 cardIntegrity(p,pair,plan);
 assert.deepEqual(pair.slides.map(slide=>(slide.keyPoints||[]).length),[0,4,2],'two two-point cards join; a third would pass five');
 const tabled={slides:[{id:'c',title:'Cover'},card('t','B','Summary Table of Models',[pt('m1')],['t1']),card('b','B','Lineage',[pt('s1'),pt('s2')])]};
 cardIntegrity(p,tabled,plan);
 assert.equal(tabled.slides.length,3,'never into a card that shows a table');
 const {markdownFree}=await import('./lib/ppt-card-outline.mjs');
 assert.equal(markdownFree('**src/app/ppt/page.tsx 4 **PptPage mounts'),'src/app/ppt/page.tsx 4 PptPage mounts','markdown markers leave a point (B6)');
 assert.equal(markdownFree('- uses `npm test` and __init__'),'uses npm test and __init__');
 const twice={slides:[{id:'c',title:'Cover'},card('b','B','Summary Table of Models',[pt('s1','s2'),pt('s3')]),card('t','B','Summary Table of Models',[pt('m1'),pt('m1')],['t1'])]};
 cardIntegrity(p,twice,plan);
 assert.deepEqual(twice.slides.map(slide=>slide.title),['Cover','Stambaugh-Yuan Mispricing Factors | Stambaugh-Yuan 错误定价因子','Summary Table of Models'],'the card from another section takes its own heading');
 // A point the closing statement repeats leaves its card; a table card keeps its table (Fable review r22 O).
 const closing='Good factor research combines a clear risk story with honest out-of-sample testing';
 const echoed={slides:[{id:'c',title:'Cover'},card('t','B','Summary Table of Models',[pt('m1')],['t1'])]};echoed.slides[1].keyPoints[0].text='Good factor research combines a clear risk story with honest out-of-sample testing.';
 assert.ok(cardIntegrity(p,echoed,plan,closing).some(note=>note.code==='card_point_echo_dropped'));assert.deepEqual([echoed.slides[1].keyPoints.length,echoed.slides[1].cardObjects],[0,['t1']],'the table card ends on its table');
 // The closing is cut at a sentence boundary, never dropped for its length (Fable review r22 P).
 // The closing is never cut mid-clause (Fable review r23 P2): a last-resort cut keeps the same sentences in both halves.
 {const {pairedSentenceCut}=await import('./lib/ppt-card-outline.mjs');
  const long='First the lesson is stated clearly. '+'Then a long tail of supporting detail keeps going on and on without stopping. '.repeat(6)+'| 首先清楚地说明结论。'+'然后是一长串不停延续的支持细节。'.repeat(6);
  const cut=pairedSentenceCut(long),[en,zh]=cut.split(' | ');assert.ok(/[.]$/u.test(en)&&/[。]$/u.test(zh),cut);assert.equal(en.split('. ').length,[...zh.matchAll(/。/gu)].length,'the same sentences in both halves');
  assert.equal(pairedSentenceCut('Short and fine. | 简短。'),'Short and fine. | 简短。');
  // The two r23 closings, whole: within the closing's length (the page steps to 20/18 pt), so never cut.
  const {pointBudgetRatio}=await import('./lib/ppt-outline-cards.mjs');
  for(const closing of ['Good factor research combines theory, data discipline, conservative testing, cost realism, and humility about market regimes. | 好的因子研究必须结合理论、数据纪律、保守检验、成本现实，以及对市场状态的谦逊。',
   'Exhaustive search over a large space against finite history produces false discoveries; a complete pipeline and a candidate graveyard make mined factors trustworthy. | 在有限历史上穷举搜索巨大空间会产生虚假发现；完整流程与候选坟场使挖掘出的因子变得可信。'])
   assert.ok(pointBudgetRatio(closing)<=2,`${pointBudgetRatio(closing)}: ${closing.slice(0,40)}`);}
 console.log('PASS card integrity: one-point cards merge, repeated titles take their own heading');}
// Partially labelled cards: one follow-up call completes them, else a point's lead before ":" (Fable plan T22).
{const {settleLabels,labelCompletionTask}=await import('./lib/ppt-card-outline.mjs');
 const p={inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}}};
 const raw={slides:[{title:'Cover'},{title:'Implementation Risks',keyPoints:[{text:'Factor crowding: many funds hold the same names and exit together'},{text:'High turnover makes trading costs eat most of the gross premium'},{text:'Book capacity: large books move prices against themselves'}]}]};
 const finish=()=>({labels:new Map([['1:0','Factor Crowding']]),notes:[],labelGaps:[{card:1,count:3,missing:[1,2]}]});
 assert.match(labelCompletionTask(p,raw,finish()).prompt,/"label":"Factor Crowding"/u,'the existing labels set the style');
 const completed=settleLabels(p,raw,finish(),{labels:[{card:1,point:2,label:'Turnover Costs'}]});
 assert.deepEqual([...completed.labels.entries()].sort(),[['1:0','Factor Crowding'],['1:1','Turnover Costs'],['1:2','Book capacity']],'the reply fills point 2, the lead fills point 3');
 const bare={slides:[raw.slides[0],{...raw.slides[1],keyPoints:[raw.slides[1].keyPoints[0],{text:'High turnover makes trading costs eat most of the gross premium'},{text:'Large books move prices against themselves'}]}]};
 const none=settleLabels(p,bare,finish(),null);
 assert.ok(none.notes.some(note=>note.code==='labels_partial_dropped')&&!none.labels.size,'no completion and no usable lead: the card shows no labels');
 const leads={slides:[raw.slides[0],{...raw.slides[1],keyPoints:[raw.slides[1].keyPoints[0],{text:'Trading costs: high turnover eats most of the gross premium'},{text:'Book capacity: large books move prices against themselves'}]}]};
 const fromLeads=settleLabels(p,leads,finish(),null);
 assert.deepEqual([...fromLeads.labels.entries()].sort(),[['1:0','Factor Crowding'],['1:1','Trading costs'],['1:2','Book capacity']]);assert.ok(fromLeads.notes.some(note=>note.code==='labels_completed'));

 // Only a card of 3+ points missing one label is asked again; a wider gap settles now (Fable, JEPA 2026-11-01).
 {const {deckFinishTask,acceptDeckFinish}=await import('./lib/ppt-card-outline.mjs');
  const items=[{id:'u1',text:'x'}],q={...p,source:{semantic:{inventory:{items}}}};
  const card=(title,texts)=>({title,keyPoints:texts.map(text=>({text,sourceUnitIds:['u1']}))});
  const deck={slides:[{title:'Cover',keyPoints:[]},card('Risks',['Factor crowding hits every exit','High turnover eats the premium','Book capacity moves prices']),card('Costs',['Management fees reduce returns','Bid spreads widen in stress','Market impact grows with size'])]},plan={logicalCards:[{sourceUnitIds:[]},{sourceUnitIds:['u1']},{sourceUnitIds:['u1']}],chapters:[]};
  const task=deckFinishTask(q,deck,plan);
  const reply={chapters:[],takeaway:null,labels:[{card:1,point:1,label:'Exit Crowding'},{card:1,point:2,label:'Premium Turnover'},{card:2,point:1,label:'Return Fees'}]};
  const finish=acceptDeckFinish(q,deck,plan,task,reply,{deferLabelGaps:true});
  assert.deepEqual(finish.labelGaps?.map(gap=>gap.card),[1],'one missing label: asked again');
  assert.ok(!finish.labels.has('2:0')&&finish.notes.some(note=>note.code==='labels_partial_dropped'),'two missing: the card shows none, no call');}
 console.log('PASS label completion: follow-up labels, point leads, else none');}
// A point on a small card that repeats the closing is reworded once, never silently kept (Fable plan T19).
{const {echoRewriteTask,applyEchoRewrites}=await import('./lib/ppt-card-outline.mjs');
 const p={inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}}};
 const closing='Good factor research combines a clear risk story with honest out-of-sample testing';
 const replies=[{pages:[{title:'Summary',points:[{text:'Good factor research combines a clear risk story with honest out-of-sample testing.',sourceUnitIds:['s1']},{text:'Costs decide which premia survive',sourceUnitIds:['s2']}]}]}];
 const task=echoRewriteTask(p,replies,closing);assert.equal(task.items.length,1);
 const ok=applyEchoRewrites(p,replies,task,{points:[{item:1,text:'Each factor needs an economic reason and a clean test after the sample period'}]},closing);
 assert.equal(ok.replies[0].pages[0].points[0].text,'Each factor needs an economic reason and a clean test after the sample period');assert.ok(ok.notes.some(note=>note.code==='takeaway_echo_reworded'));
 const kept=applyEchoRewrites(p,replies,task,{points:[{item:1,text:'Good factor research combines a clear risk story with honest testing in 2024'}]},closing);
 assert.equal(kept.replies[0].pages[0].points[0].text,replies[0].pages[0].points[0].text,'a rewording that still echoes or adds a number is refused');assert.ok(kept.notes.some(note=>note.code==='takeaway_echo'));
 console.log('PASS takeaway echo: small-card points reworded once');}
process.exit(0);
