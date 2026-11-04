// Built-in templates place a card's reviewed points by code (the user,
// 2026-11-01: on Blue the writer rewrote four labelled points into one
// paragraph); a short source's lengths show the pages it fills; the label
// notes carry their card for the editor to word.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.COWORK_STATE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-builtin-cards-'));
const {builtinCardDraft}=await import('./lib/ppt-card-pages.mjs');
const {analyzeSourceStructure,pagesFor,formulaPointsToNotes}=await import('./lib/ppt-card-outline.mjs');
const {normalizePaste}=await import('./lib/ppt-source.mjs');
const {withSemanticIndex}=await import('./lib/ppt-semantic.mjs');
const {coverTitlePt,builtinTitleFits}=await import('./lib/ppt-layout.mjs');
const {cardFiguresFit}=await import('./lib/ppt-source-artifacts.mjs');

const page={title:'試點先選取穩定且邊界清楚的業務場景',role:'workflow',keyPoints:[
 {text:'先選擇諮詢內容相對穩定、處理邊界清楚的業務場景。',label:'穩定的業務場景',refs:['1']},
 {text:'遇到資訊不足或超出適用範圍的問題，仍轉交人工處理。',label:'超出適用範圍',refs:['1']}]};
const draft=builtinCardDraft(page);
assert.equal(draft.title,page.title);
assert.deepEqual(draft.contentBlocks.map(block=>[block.type,block.heading,block.body]),page.keyPoints.map(point=>['stage',point.label,point.text]),'each point verbatim, its label the heading');
assert.deepEqual(draft.sourceArtifacts,[]);
const unlabelled=builtinCardDraft({title:'評估',role:'comparison',keyPoints:[{text:'評估重點是答案是否準確。'}]});
assert.deepEqual(unlabelled.contentBlocks.map(block=>[block.type,block.heading]),[['contrast','']],'a card without labels shows none');
assert.equal(builtinCardDraft({title:'x',role:'other',keyPoints:[{text:'y'}]}).contentBlocks[0].type,'support');

// demo-input: four short sections; every length used to say 7 pages for a 6-page outline.
const demo=withSemanticIndex(normalizePaste(['# 客户支持知识库试点方案',...['背景与目标','试点方案','职责与推进','评估与下一步'].map(h=>`## ${h}\n\n${'支持团队整理常见问题和处理方法，保留必要的人工判断。'.repeat(4)}`)].join('\n\n')));
const presets=analyzeSourceStructure({source:demo,generationPolicy:{language:{mode:'source'}}}).presets;
for(const name of ['quick','standard','full'])assert.ok(presets[name].total<=6&&presets[name].content<=4,`${name}: ${JSON.stringify(presets[name])}`);
assert.equal(presets.full.total,6,'four sections, a cover and the closing');
assert.equal(pagesFor('standard',8).total,11,'pagesFor itself is unchanged');

// A long source title steps down on a built-in cover (JEPA on Blue, 2026-11-01).
assert.equal(coverTitlePt('客户支持知识库试点方案'),38);
assert.equal(coverTitlePt('Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture'),28);

// A built-in card holds a figure only where its points and the figure fit (world_models on Blue).
const figure={source:{images:[{id:'i1',width:1600,height:1200,caption:'Figure 1. The world model and its controller.',sourceRefs:['1']}]}};
assert.equal(cardFiguresFit(figure,['A short point.','Another short point.'],['i1']),true);
const long=Array.from({length:10},(_,k)=>`The controller acts on the features of the world model and is trained by evolution strategies inside the dream environment, point ${k}.`);
assert.equal(cardFiguresFit(figure,long,['i1']),false,'ten long points leave the figure no room');
assert.equal(cardFiguresFit(figure,['x'],['missing']),false);
// A built-in figure page's title is measured too (JEPA on Blue: "… · Figures" took three lines).
assert.equal(builtinTitleFits('Representation-space Loss and Multi-block Masking Guide Learning · Figures'),false);
assert.equal(builtinTitleFits('Representation-space Loss · Figures'),true);

// Garbled approximate PDF formula text goes to the notes; an emptied card points to the source page (Fable, 2026-11-01).
{const p={generationPolicy:{language:{mode:'output',locale:'zh-CN'}},source:{mediaWarnings:[{code:'source_pdf_math_requires_confirmation',pages:[12]}],segments:[{id:'s1',location:'第 12 页'},{id:'s2',location:'第 3 页'}],
  semantic:{inventory:{items:[{id:'u1',text:'a = max',source_ref:['s1']},{id:'u2',text:'说明',source_ref:['s2']}]}}}};
 const garbled='h =max (measureText(cell_{ij}).height + 6 pt ) (12b)';
 const raw={slides:[{id:'c0',keyPoints:[]},{id:'c1',keyPoints:[{text:garbled,sourceUnitIds:['u1']},{text:'单元格高度取内容高度加边距。',sourceUnitIds:['u2']}]},{id:'c2',keyPoints:[{text:garbled,sourceUnitIds:['u1']}]},{id:'c3',keyPoints:[{text:'$h = \\max(x)$',sourceUnitIds:['u1']}]}]};
 const out=formulaPointsToNotes(p,raw);
 assert.deepEqual(out.slides[1].keyPoints.map(point=>point.text),['单元格高度取内容高度加边距。'],'the garbled point leaves the card');
 assert.ok(out.slides[1].notePoints[0].approximateFormula&&out.slides[1].notePoints[0].text.endsWith(garbled),'and goes to its notes');
 assert.deepEqual(out.slides[2].keyPoints.map(point=>point.text),['公式见原文第 12 页（待核对）'],'an emptied card points to the source page');
 assert.equal(out.slides[3],raw.slides[3],'a typeset formula stays');}

const outline=fs.readFileSync(new URL('./lib/ppt-card-outline.mjs',import.meta.url),'utf8');
assert.equal((outline.match(/params:\{title:String\(raw\.slides\[gap\.card\]\?\.title\|\|''\)/gu)||[]).length,3,'label notes name their card');
console.log('PASS built-in card pages: reviewed points by code, short-source lengths match the outline, label notes carry their card, long cover titles step down, built-in card figures and figure titles are measured, garbled approximate formulas go to the notes');
