// Table markup is never drawn as text (Fable, JEPA on Professional-Portfolio,
// 2026-11-01: page 8 showed "| ViT-B/16 | 600 | 72.9 | | --- | --- |" as two
// points). A written table restored by code goes whole, as labelled rows, to
// a card's speaker notes (the hand deck, 2026-11-02 evening); a writer's pasted markup is sent back once and, if it stays,
// goes to the speaker notes with a page flag; markup visible by any other path
// flags its page. A headerless PDF table of 3+ columns stays a table.
import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {tableShape,tableRowPoints,tableRowPoint,markdownTableText,documentWrittenTable} from './lib/ppt-table-roles.mjs';
import {restoreSourceObjects,deckFinishTask,applyDeckLabels} from './lib/ppt-card-outline.mjs';
import {sanitizeCardTopic,cardTopicProblems,acceptCardTopic} from './lib/ppt-outline-cards.mjs';
import {inspectContent} from './lib/ppt-content-qa.mjs';
import {labelledPoint} from './lib/ppt-card-pages.mjs';
import {defaultGenerationPolicy} from './lib/ppt-generation-policy.mjs';

// Headerless tables: the first row is data; 3+ columns have no names to write values with.
const jepa={type:'TableBlock',id:'t',headerless:true,rows:[['ViT-B/16','600','72.9'],['ViT-L/16','600','77.5'],['ViT-H/14','300','79.3']]};
assert.equal(tableShape(jepa),'table','a headerless 3-column table stays a table');
assert.equal(tableShape({...jepa,headerless:undefined}),'grid','with a header it is a small grid');
assert.deepEqual(tableRowPoints({id:'k',headerless:true,rows:[['名称','说明'],['甲','乙']]}).map(point=>point.label),['名称','甲'],'a headerless table keeps its first row');
assert.ok(markdownTableText('| a | b | | --- | --- |')&&!markdownTableText('A | B')&&!markdownTableText('x — y'));

// The restore pass: a written key-value table comes back as rows, never markup.
const rows=Array.from({length:8},(_,k)=>`| 术语${k+1} | 第${k+1}个术语的含义说明 |`).join('\n');
const source=normalizePaste(`# 文档\n\n## 背景\n\n这是背景说明。\n\n## 术语\n\n| 术语 | 含义 |\n|---|---|\n${rows}\n`);
const items=source.semantic.inventory.items,table=items.find(item=>item.type==='TableBlock'),intro=items.find(item=>/背景说明/.test(item.text||''));
const p={source,generationPolicy:defaultGenerationPolicy(),planningContract:{},inputUnderstanding:{primaryLanguage:'zh'},pages:8};
const raw={slides:[{id:'cover',title:'文档',keyPoints:[]},{id:'a',logicalCardId:'la',title:'背景',section:'背景',keyPoints:[{text:'背景说明',sourceUnitIds:[intro.id]}],sourceUnitIds:[intro.id],cardObjects:[]}]};
restoreSourceObjects(p,raw,{logicalCards:[]});
// Since the hand deck (2026-11-02 evening) a missed table goes whole to a card's notes, no card of rows.
assert.ok(!raw.slides.some(slide=>slide.restoredObject),'no card of rows');
const tableNotes=raw.slides[1].notePoints.filter(note=>note.sourceUnitIds?.[0]===table.id);
assert.equal(tableNotes.length,9,'the header and all eight rows, no row dropped');
assert.ok(tableNotes.every(note=>!markdownTableText(note.text))&&tableNotes[1].text.startsWith('术语1：'),'labelled rows, no markup');
assert.ok(!raw.slides.flatMap(slide=>slide.keyPoints||[]).some(point=>markdownTableText(point.text)));

// The writer: pasted markup citing no written table is sent back, then noted.
const task={card:{title:'背景'},ids:[intro.id],objectIds:[],requiredIds:[],quota:1};
const reply={pages:[{title:'背景说明决定范围',visualIntent:'text',points:[{text:'背景说明决定了范围',sourceUnitIds:[intro.id]},{text:'| A | 1 | | --- | --- | | B | 2 |',sourceUnitIds:[intro.id]}],objects:[]}]};
assert.ok(cardTopicProblems(p,task,reply).some(problem=>problem.kind==='table_text'),'sent back once');
const {reply:{pages:[page]},advisories}=sanitizeCardTopic(p,task,reply);
assert.equal(page.points.length,1,'the markup point is not drawn');
assert.ok(page.tableTextNotes&&page.notePoints?.length===1&&advisories.some(item=>item.code==='card_table_text_to_notes'),'it is in the notes');

// The QA: a flagged page, and markup visible by any path.
const deck={slides:[{id:'cover',nodes:[]},{id:'a',nodes:[{id:'l',type:'list',content:{items:[{text:'| A | 1 | | --- | --- |'}]}}]}]};
const project={...p,planningContract:{version:3,cardOutline:{raw:{slides:[{id:'cover'},{id:'a',tableTextNotes:true,notePoints:[{text:'x'}]}]}}},outline:[{id:'cover'},{id:'a',tableTextNotes:true}],deck};
const codes=inspectContent(project).issues.filter(issue=>issue.slideId==='a').map(issue=>issue.code);
assert.ok(codes.includes('table_text_to_notes')&&codes.includes('table_markup_visible'),codes.join(','));
// Tables follow the hand deck (the user, 2026-11-02 evening): the slide shows
// at most four comparison points per table, the whole table is in the notes.
// A header or markup "point" is no point (CodePilot PDF 2026-11-02: five points
// read only the header cell "本手册中的含义").
{const rows9=Array.from({length:9},(_,k)=>`| 术语${k+1} | 第${k+1}个术语的具体说明 |`).join('\n');
 const src=normalizePaste(`# 手册\n\n## 术语速查\n\n| 术语 | 本手册中的含义 |\n|---|---|\n${rows9}\n`);
 const terms=src.semantic.inventory.items.find(item=>item.type==='TableBlock');
 const q={source:src,generationPolicy:defaultGenerationPolicy(),planningContract:{},inputUnderstanding:{primaryLanguage:'zh'},pages:8};
 assert.ok(documentWrittenTable(q,terms),'fixture: a written table');
 const t={card:{title:'术语速查'},ids:[terms.id],objectIds:[],requiredIds:[terms.id],quota:1};
 const shapes={header:terms.rows.slice(1).map(row=>({text:'本手册中的含义',label:row[0]})),termColon:terms.rows.slice(1).map(row=>({text:`${row[0]}：${row[1]}`})),markdown:[{text:terms.text}]};
 for(const [name,points] of Object.entries(shapes)){
  const {reply:{pages}}=sanitizeCardTopic(q,t,{pages:[{title:'术语区分实现概念',visualIntent:'table',points:points.map(point=>({...point,sourceUnitIds:[terms.id]})),objects:[]}]});
  const shown=pages.flatMap(page=>page.points).filter(point=>(point.sourceUnitIds||[]).includes(terms.id));
  assert.ok(shown.length<=4&&shown.every(point=>!markdownTableText(point.text)&&point.text!=='本手册中的含义'),name+': at most four comparison points, never markup or a header');
  const notes=pages.flatMap(page=>page.notePoints||[]).filter(note=>note.sourceUnitIds?.[0]===terms.id&&(note.tableHeader||note.tableRow));
  assert.equal(notes.length,10,name+': the header and all nine rows are in the notes');}
 // The accepted path sends a pasted header or more than four table points back once.
 for(const points of [shapes.header,shapes.termColon])assert.throws(()=>acceptCardTopic(q,t,{pages:[{title:'术语区分实现概念',numbered:false,visualIntent:'table',points:points.slice(0,5).map(point=>({...point,sourceUnitIds:[terms.id]})),objects:[]}]}),/at most 4 comparison points/u);
 // Four comparison points pass, and the whole table rides in the notes.
 const ok=acceptCardTopic(q,t,{pages:[{title:'术语区分实现概念',numbered:false,visualIntent:'table',points:shapes.termColon.slice(0,4).map(point=>({...point,sourceUnitIds:[terms.id]})),objects:[]}]});
 assert.equal(ok.pages.length,1);assert.equal(ok.pages[0].points.length,4);assert.equal(ok.pages[0].notePoints.length,10);
 // A first cell too long for a label: no row is labelled, each keeps its term in the text.
 const long=tableRowPoints({id:'x',rows:[['术语','含义'],['短','一'],['一个远远超过十二个字符的很长术语名称','二']]});
 assert.ok(long.every(point=>!point.label)&&long[1].text.startsWith('一个远远超过'),'all or none: the long term stays in its text');}
// Live CodePilot PDF on the combined branch (2026-11-02), three more paths:
// 1. the restore pass found the table's owner card and appended its markdown;
{const rows4=Array.from({length:4},(_,k)=>`| 项${k+1} | 第${k+1}项的说明文字 |`).join('\n');
 const src=normalizePaste(`# 文档\n\n## 分工\n\n分工说明。\n\n| 项 | 说明 |\n|---|---|\n${rows4}\n`);
 const tbl=src.semantic.inventory.items.find(item=>item.type==='TableBlock'),intro=src.semantic.inventory.items.find(item=>/分工说明/.test(item.text||''));
 const q={source:src,generationPolicy:defaultGenerationPolicy(),planningContract:{},inputUnderstanding:{primaryLanguage:'zh'},pages:8};
 const deck={slides:[{id:'cover',title:'文档',keyPoints:[]},{id:'a',logicalCardId:'own',title:'分工',section:'分工',keyPoints:[{text:'分工说明',sourceUnitIds:[intro.id]}],sourceUnitIds:[intro.id],cardObjects:[]}]};
 restoreSourceObjects(q,deck,{logicalCards:[{id:'cover'},{id:'own',sourceUnitIds:[intro.id,tbl.id]}]});
 assert.ok(!deck.slides.flatMap(slide=>slide.keyPoints||[]).some(point=>markdownTableText(point.text)),'never the markdown, even with an owner card');
 assert.deepEqual(deck.slides[1].notePoints.filter(note=>note.tableRow).map(note=>note.text.split('：')[0]),['项1','项2','项3','项4'],'the whole table in its card\'s notes');}
// 2. a writer point joining "header：value" fragments, or quoting two rows, restates the table;
{const terms={rows:[['术语','本手册中的含义'],['epoch','页级变更代次，用于拒绝迟到或过期结果。'],['lease','任务或生成执行的有期限占用身份。']]};
 assert.ok(tableRowPoint(terms,{text:'本手册中的含义：页级变更代次，用于拒绝迟到或过期结果。；本手册中的含义：任务或生成执行的有期限占用身份。'}));
 assert.ok(tableRowPoint(terms,{text:'页级变更代次，用于拒绝迟到或过期结果。；任务或生成执行的有期限占用身份。'}));
 assert.ok(!tableRowPoint(terms,{text:'epoch 让迟到的结果不会覆盖新稿。'}),'prose naming a term is not a row');}
// 3. a card whose labels the finish dropped kept rows without their terms.
{const slides=[{title:'c',keyPoints:[]},{title:'容量',keyPoints:[{label:'卡片估算',text:'写卡时约束语言长度',rowLabel:true},{label:'几何预测',text:'按共享合同预测几何',rowLabel:true},{text:'可用内容区考虑模板标题'}]},{title:'术语',keyPoints:[{label:'epoch',text:'页级变更代次',rowLabel:true},{label:'lease',text:'有期限占用身份',rowLabel:true}]}];
 const finish={labelCards:[1,2],labels:new Map([['2:0','代次']])};
 const [,mixed,rows]=applyDeckLabels(slides,finish);
 assert.deepEqual(mixed.keyPoints.map(point=>[point.label,point.text]),[[undefined,'卡片估算：写卡时约束语言长度'],[undefined,'几何预测：按共享合同预测几何'],[undefined,'可用内容区考虑模板标题']],'no labels on the card: the term leads its text');
 assert.deepEqual(rows.keyPoints.map(point=>point.label),['epoch','lease'],'a row is never relabelled');}
// A table's own term is shown as the source writes it (live CodePilot PDF: "quality_blocked" was drawn "Qualityblocked").
assert.deepEqual(['quality_blocked','canonical nodes','on_demand'].map(label=>labelledPoint({label,text:'x',rowLabel:true},'zh').label),['quality_blocked','canonical nodes','on_demand']);
assert.equal(labelledPoint({label:'pool size',text:'x'},'en').label,'Pool Size','a written label is still title-cased');
assert.equal(labelledPoint({label:'run_id',text:'x'},'en').label,'run_id','an identifier keeps its underscore');
// An ordinal first column is the rows' order, not a name; a label names one
// row only (MCP xlsx 2026-11-02: steps read "1. 17：示例阶段…").
{const steps=tableRowPoints({id:'s',rows:[['编号','示例阶段','发送方','消息'],['1','0 初始化','Host','initialize'],['2','0 初始化','Server','initializeResult']]});
 assert.deepEqual(steps.map(point=>[point.label,point.text]),[[undefined,'示例阶段：0 初始化；发送方：Host；消息：initialize'],[undefined,'示例阶段：0 初始化；发送方：Server；消息：initializeResult']],'no ordinal label; a repeated first cell is no label');
 assert.deepEqual(tableRowPoints({id:'n',rows:[['阶段','说明','负责人'],['1','准备','甲'],['2','执行','乙'],['3','复盘','丙']]}).map(point=>point.label),['准备','执行','复盘'],'all-number first cells are an ordinal column');}
// A spreadsheet deck keeps the writer's points that quote cells; only a bare header is rebuilt
// (live MCP xlsx, 2026-11-02: 13 pages became 27 of raw rows).
{const rows=[['阶段','发送方','接收方','消息'],...[1,2,3,4,5,6,7,8].map(k=>[`阶段${k}初始化`,`发送方Host${k}`,`接收方Server${k}`,`消息内容第${k}条`])];
 const sheet={id:'x1',type:'TableBlock',rows,text:rows.map(row=>'| '+row.join(' | ')+' |').join('\n'),sectionPath:['Sheet1']};
 const xp={source:{extension:'xlsx',semantic:{inventory:{items:[sheet]}}},generationPolicy:defaultGenerationPolicy(),planningContract:{length:{preset:'standard'}},inputUnderstanding:{primaryLanguage:'zh'},pages:6};
 const xt={card:{title:'交互阶段'},ids:['x1'],objectIds:[],requiredIds:[],quota:1};
 const quoting={pages:[{title:'交互从初始化开始',visualIntent:'text',points:[{text:'阶段1初始化时由发送方Host1发出消息内容第1条',sourceUnitIds:['x1']},{text:'阶段2初始化后由接收方Server2回复',sourceUnitIds:['x1']}],objects:[]}]};
 const {reply:{pages:kept}}=sanitizeCardTopic(xp,xt,quoting);
 assert.deepEqual(kept[0].points.map(point=>point.text),quoting.pages[0].points.map(point=>point.text),'the writer\'s points stay');
 const bare={pages:[{title:'交互从初始化开始',visualIntent:'text',points:[{text:'消息',sourceUnitIds:['x1']},{text:'阶段2初始化后由接收方Server2回复',sourceUnitIds:['x1']}],objects:[]}]};
 const {reply:{pages:rebuilt}}=sanitizeCardTopic(xp,xt,bare);
 assert.ok(rebuilt.flatMap(page=>page.points).every(point=>point.text!=='消息'),'a bare header is rebuilt');
 // Rebuilt rows never add pages to a spreadsheet deck: the rows past the card are in its notes; an accepted reply goes back instead.
 assert.equal(rebuilt.length,1,'one card, no continuation');
 assert.equal(rebuilt[0].points.length+(rebuilt[0].notePoints||[]).length,9,'every row (and the writer\'s other point) is on the card or in its notes');
 assert.throws(()=>acceptCardTopic(xp,xt,bare),error=>/table rows|Card problems/u.test(error.message),'an accepted reply that would grow the deck goes back');}
// Score tables: the writer's comparison points stay on one card, the whole
// tables are in its notes (the hand deck's slide 9: four result cards, table 1
// in the notes; it replaced Fable M2's seven-score tile card).
{const scores=['343 ± 18','591 ± 45','652 ± 10','838 ± 11','632 ± 251','788 ± 141','906 ± 21'];
 const src=normalizePaste(`# Paper\n\n## Results\n\nThe full model combines both vectors to drive steadily.\n\n| Model | Parameters |\n|---|---|\n| VAE | 4,348,547 |\n| MDN-RNN | 422,368 |\n| Controller | 867 |\n\n| Method | Score |\n|---|---|\n${scores.map((score,k)=>`| Method ${k+1} | ${score} |`).join('\n')}\n`);
 const items=src.semantic.inventory.items,[params,results]=items.filter(item=>item.type==='TableBlock'),prose=items.find(item=>/combines both vectors/.test(item.text||''));
 const q={source:src,generationPolicy:defaultGenerationPolicy(),planningContract:{},inputUnderstanding:{primaryLanguage:'en'},pages:8};
 const t={card:{title:'Results'},ids:[prose.id,params.id,results.id],objectIds:[],requiredIds:[params.id,results.id],quota:1};
 const cards=[{label:'Earlier deep RL',text:'DQN 343 ± 18; A3C 591 ± 45 and 652 ± 10.',sourceUnitIds:[results.id]},{label:'V only',text:'632 ± 251: the car wobbles.',sourceUnitIds:[results.id]},{label:'Full world model',text:'906 ± 21: steady driving.',sourceUnitIds:[results.id]},{label:'Controller',text:'Controller 867, VAE 4,348,547.',sourceUnitIds:[params.id]}];
 const accepted=acceptCardTopic(q,t,{pages:[{title:'Full World Model Scores 906 ± 21',numbered:false,visualIntent:'comparison',points:[{text:'The full model combines both vectors to drive steadily.',sourceUnitIds:[prose.id]},...cards],objects:[]}]});
 assert.equal(accepted.pages.length,1,'one card');assert.equal(accepted.pages[0].points.length,5,'the prose point and four comparison points');
 const notes=accepted.pages[0].notePoints;
 assert.equal(notes.filter(note=>note.sourceUnitIds[0]===results.id).length,8,'the score table, header and seven rows, in the notes');
 assert.equal(notes.filter(note=>note.sourceUnitIds[0]===params.id).length,4,'the parameter table too');
 assert.ok(scores.every(score=>notes.some(note=>note.text.includes(score))),'every score is kept');}
console.log('PASS table markup: at most four comparison points per table, whole tables in the notes, markup and headers never points, visible markup flagged');
