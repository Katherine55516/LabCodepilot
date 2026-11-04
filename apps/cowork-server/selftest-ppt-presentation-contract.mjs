// Round 7, B1: one presentation contract. Four inputs (mostly Chinese with
// English, mostly English with Chinese, an even split, and code plus image
// captions) give one deck language; every topic field uses it and the body
// keeps both languages.
import assert from 'node:assert/strict';
import { deckLanguage, deckScript, deckLanguageVariant, topicLanguageRule } from './lib/ppt-presentation-contract.mjs';
import { promptPolicy } from './lib/ppt-prompt-contracts.mjs';
import { displayedDocumentTitle, inspectTitleLanguage } from './lib/ppt-deck-coherence.mjs';
import { primaryLanguageEquivalents } from './lib/ppt-outline-concision.mjs';
import { eyebrowCandidates, deckLanguage as eyebrowLanguage } from './lib/ppt-section-eyebrow.mjs';
import { _internals as api } from './lib/ppt-api.mjs';
import {skeletonPrompt} from './lib/ppt-outline-protocol.mjs';
import {dominantInputLanguage} from './lib/ppt-topic-language.mjs';
import {prepareTopicTitleProjection,projectedTopicTitleText} from './lib/ppt-topic-title-projection.mjs';

const zhProse = '模型从重复观察中学习表征，部署前需要验证，并保留适用条件和限制。';
const enProse = 'The model learns a representation from repeated observations and is validated before deployment.';
const fixtures = [
  ['mostly Chinese with English', `# 因子挖掘 | Alpha Mining\n\n${zhProse.repeat(6)}\n\nIC and ICIR measure the signal.`, 'zh'],
  ['mostly English with Chinese', `# Alpha Mining | 因子挖掘\n\n${enProse.repeat(6)}\n\n模型需要验证。`, 'en'],
  ['even split', `# Alpha Mining | 因子挖掘\n\n${enProse}\n\n${zhProse}`, null],
  ['code and image captions', `# 因子挖掘 | Alpha Mining\n\n${zhProse.repeat(3)}\n\n\`\`\`python\n${'def screen(frame): return frame.rank()\n'.repeat(40)}\`\`\`\n\n![Figure: information coefficient by month](ic.png)`, 'zh'],
];
for (const [name, text, expected] of fixtures) {
  const project = { source: { text, semantic: { inventory: { items: [] } } }, generationPolicy: { language: { mode: 'source', body: 'both' } }, prompt: '' };
  const language = deckLanguage(project);
  if (expected) assert.equal(language, expected, name);
  else assert.ok(['zh', 'en'].includes(language), name);
  const script = deckScript(project), han = script === 'han';
  // Topic rule names exactly one language.
  assert.match(topicLanguageRule(project), han ? /ONLY 简体中文/u : /ONLY English/u, name);
  assert.match(promptPolicy(project), new RegExp('topic_language=' + (han ? '简体中文' : 'English')), name);
  const planner=skeletonPrompt(project,'Generate the outline');
  assert.ok(!planner.includes('标题也用简洁双语')&&!planner.includes('封面标题也保留中英双语'),'planner cannot contradict the single-language topic contract');
  assert.match(planner,new RegExp('主要语言 '+language));
  // Cover title: only the deck-language variant of a bilingual heading.
  const cover = displayedDocumentTitle(project);
  assert.ok(cover.variants.every(variant => han ? /\p{Script=Han}/u.test(variant.text) : !/\p{Script=Han}/u.test(variant.text)), `${name}: cover title is single-language`);
  assert.equal(deckLanguageVariant(project, ['Alpha Mining', '因子挖掘']), han ? '因子挖掘' : 'Alpha Mining');
  // Outline titles, sections and slide eyebrows.
  const outline = [{ id: 'a', title: 'Overview | 概览', focus: 'Opening', refs: [] }, { id: 'b', title: 'Screening | 筛选', focus: 'Mechanism', refs: [] }, { id: 'c', title: 'Summary | 总结', focus: 'Close', refs: [] }];
  const normalized = api.normalizeOutline({ slides: outline.map(slide => ({ ...slide, section: slide.title })) }, 3, project.source, null, null, language);
  assert.equal(normalized[1].title, han ? '筛选' : 'Screening', name); assert.equal(normalized[1].section, han ? '筛选' : 'Screening', name);
  const body = ['Screening removes repeats. 筛选会移除重复。'];
  const slide = api.normalizeSlide({ title: 'Screening | 筛选', eyebrow: 'Methods | 方法', section: 'Methods | 方法', bullets: body }, outline[1], { ...project, outline });
  assert.equal(slide.title, han ? '筛选' : 'Screening'); assert.equal(slide.copy.eyebrow, han ? '方法' : 'Methods');
  assert.deepEqual(slide.bullets, body, `${name}: the body keeps both languages`);
  const conclusion=api.normalizeSlide({ title: 'Summary', bullets: body }, outline[2], { ...project, outline });assert.equal(conclusion.title,'Summary');assert.deepEqual(conclusion.bullets,body);assert.ok(conclusion.nodes.some(node=>node.semanticRole==='closing-greeting'&&node.content.text===(han?'感谢观看':'Thanks for watching!')));
  // Eyebrow: "number + deck-language name", never two languages.
  const eyebrow = eyebrowCandidates('1.3 The central tension | 核心张力', eyebrowLanguage(project));
  assert.equal(eyebrow.bilingual, null); assert.equal(eyebrow.primary, han ? '1.3 核心张力' : '1.3 The central tension');
  // Deck check reports titles off the deck language and paired titles.
  const titles = ['封面', ...(han ? ['两种范式', '核心张力', 'Operator algebra'] : ['Two paradigms', 'Central tension', '算子代数'])].map((title, index) => ({ id: 's' + index, title }));
  assert.deepEqual(inspectTitleLanguage(project, titles)[0].off, ['s3'], name);
}
// Explicit output language wins over the input; zh-HK uses Traditional topics.
assert.equal(deckLanguage({ source: { text: zhProse }, generationPolicy: { language: { mode: 'output', locale: 'en' } } }), 'en');
assert.equal(deckLanguage({ source: { text: enProse }, generationPolicy: { language: { mode: 'output', locale: 'zh-HK' } } }), 'zh-Hant');
// body=primary: the visible side of a translation pair is the deck-language side.
{
  const items = [{ id: 'en', type: 'MechanismBlock', text: enProse, languagePairId: 'p', languageRole: 'primary' }, { id: 'zh', type: 'MechanismBlock', text: zhProse, languagePairId: 'p', languageRole: 'translation' }];
  const policy = { content: 'overview', details: 'notes', language: { mode: 'source', body: 'primary' } };
  const zhDeck = { generationPolicy: policy, source: { text: zhProse.repeat(5) + enProse, semantic: { inventory: { items } } } };
  const enDeck = { generationPolicy: policy, source: { text: enProse.repeat(5) + zhProse, semantic: { inventory: { items } } } };
  assert.deepEqual(primaryLanguageEquivalents(zhDeck, items[0], items), ['zh'], 'Chinese deck: the English side goes to notes, carried by the Chinese side');
  assert.deepEqual(primaryLanguageEquivalents(zhDeck, items[1], items), []);
  assert.deepEqual(primaryLanguageEquivalents(enDeck, items[1], items), ['en'], 'English deck: the Chinese side goes to notes');
  assert.deepEqual(primaryLanguageEquivalents(enDeck, items[0], items), []);
}
console.log('PASS presentation contract: one deck language for cover, titles, sections, eyebrows, closing and deck checks across 4 input mixes; body keeps both languages; body=primary follows the deck language');
{
 const project={source:{text:'# Gamma AI 深度架构与工作流分析\n\n'+enProse.repeat(20),semantic:{inventory:{items:[]}}},generationPolicy:{language:{mode:'source',body:'both'}}};
 const original=JSON.stringify(project.source);let calls=0;
 await prepareTopicTitleProjection(project,async prompt=>{
  calls++;
  if(prompt.includes('JSON Language Projection Schema'))return {version:1,translations:[{key:'document-title/line/0',text:'Gamma AI Architecture and Workflow Analysis'}]};
  return {version:1,checks:[{key:'document-title/line/0',equivalent:true,targetLanguage:true,reason:'The heading keeps its subject in the dominant English language.'}]};
 });
 assert.equal(calls,2);assert.equal(projectedTopicTitleText(project),'Gamma AI Architecture and Workflow Analysis');
 assert.equal(displayedDocumentTitle(project).variants[0].text,'Gamma AI Architecture and Workflow Analysis');
 assert.equal(JSON.stringify(project.source),original,'topic-only projection never translates or mutates the multilingual body');
 await prepareTopicTitleProjection(project,()=>{throw Error('A valid audited title must be reused');});
 project.source.text=project.source.text.replace('架构','系统');assert.equal(projectedTopicTitleText(project),null,'an edited source heading invalidates the audited projection');
}
{
 const source={segments:[{text:zhProse.repeat(1000)}]},project={source};
 const started=performance.now();
 for(let i=0;i<500;i++)assert.equal(dominantInputLanguage({...project,source:{...source,segments:source.segments.map(segment=>({...segment}))}}),'zh');
 const milliseconds=performance.now()-started;assert.ok(milliseconds<10000,`Repeated long-source language queries must stay responsive (${milliseconds} ms)`);
 source.segments[0].text=enProse.repeat(500);assert.equal(dominantInputLanguage(project),'en','in-place source edits invalidate the content-keyed result');
 console.log('PASS long-source language reuse: 500 copied-project queries in '+Math.round(milliseconds)+' ms; edited source re-detected');
}

// A connection failure must resume the audited heading checkpoint; semantic
// failures are repaired and authentication failures remain visible immediately.
{
 const make=()=>({source:{text:'# Gamma AI 深度架构与工作流分析\n\n'+enProse.repeat(20)},generationPolicy:{language:{mode:'source'}}});
 const translation={version:1,translations:[{key:'document-title/line/0',text:'Gamma AI Architecture and Workflow Analysis'}]};
 const audit={version:1,checks:[{key:'document-title/line/0',equivalent:true,targetLanguage:true,reason:'Equivalent English heading.'}]};
 const phases=[];let failedAudit=false;const project=make();
 await prepareTopicTitleProjection(project,async(_prompt,phase)=>{
  phases.push(phase);
  if(!phase.includes(':audit:'))return translation;
  if(!failedAudit){failedAudit=true;throw Object.assign(Error('Connection timed out'),{code:'timeout'});}
  return audit;
 });
 assert.deepEqual(phases,['planning:topic-title:0','planning:topic-title:audit:0','planning:topic-title:audit:1']);
 assert.equal(projectedTopicTitleText(project),'Gamma AI Architecture and Workflow Analysis');
 let authCalls=0;
 await assert.rejects(prepareTopicTitleProjection(make(),async()=>{authCalls++;throw Object.assign(Error('Unauthorized'),{code:'auth'});}),{code:'auth'});
 assert.equal(authCalls,1,'credentials errors must not be hidden by transport retries');
 console.log('PASS topic heading retry: audited candidate reused after timeout; authentication errors fail immediately');
}

{
 const {languagePairCandidates}=await import('./lib/ppt-language-pair-audit.mjs');
 const items=[{id:'en-list',type:'ChecklistBlock',text:'- Check coverage.\n- Preserve conditions.',languagePairId:'list',languageRole:'primary'},{id:'zh-list',type:'ChecklistBlock',text:'- 检查覆盖率。\n- 保留条件。',languagePairId:'list',languageRole:'translation'}];
 const policy={content:'overview',details:'notes',language:{mode:'source',body:'primary'}};
 const project={generationPolicy:policy,source:{text:zhProse.repeat(20)+enProse,semantic:{inventory:{items}}}};
 assert.deepEqual(languagePairCandidates(project).map(pair=>[pair.sourceUnitId,pair.targetUnitId]),[['en-list','zh-list']],'independent structured-pair audit targets the dominant body language, even when the original pair was English-first');
 console.log('PASS structured-pair target: the shared dominant-language contract wins over original-side label counts');
}
