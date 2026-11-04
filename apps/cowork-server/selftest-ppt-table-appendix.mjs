// Source tables to the appendix (user decisions 2026-10-31):
// D1 a table needing more than one page moves whole to the appendix; its card
// keeps its points and a pointer, never a truncated head (Fable D 2026-11-01);
// at quick/standard lengths a card keeps one table (the one its points cite
// most) and the source's own appendix leaves the body; full length and an
// exact page count keep tables in place; appendix titles keep their counter.
import assert from 'node:assert/strict';
import {moveLongTablesToAppendix} from './lib/ppt-table-appendix.mjs';

const table=(id,rows,heading='主要业务 API',section='11 前端接口与配置')=>({id,type:'TableBlock',sectionPath:[section,heading],rows:Array.from({length:rows},(_,k)=>[`r${k}`,'x'])});
const project=(items,extra={})=>({generationPolicy:{language:{mode:'output',locale:'zh'}},planningContract:{deckPlan:{length:{preset:'standard'}}},source:{semantic:{inventory:{items}}},...extra});
const range=(sourceUnitId,rowStart,rowEnd)=>({sourceUnitId,rowStart,rowEnd});
const page=(id,card,objects,ranges=[],points=[])=>({id,logicalCardId:card,title:`页 ${card}`,cardObjects:objects,sourceUnitIds:objects,sourceArtifactRanges:ranges,keyPoints:points.map(p=>typeof p==='string'?{text:p}:p)});
const frame=slides=>({slides:[{id:'cover',title:'封面'},...slides,{id:'take',title:'结论',cardFrame:'takeaway',keyPoints:[]},{id:'end',title:'感谢观看',role:'closing',keyPoints:[]}]});
const titles=raw=>raw.slides.filter(s=>s.region==='appendix').map(s=>s.title);

// D1: a long table.
{const raw=frame([page('p1','c1',['small'],[range('small',1,8)],['要点']),page('p2','c2',['big'],[range('big',1,13)]),page('p3','c2',['big'],[range('big',13,25)]),page('p4','c2',['big'],[range('big',25,37)],['a','b']),page('p5','c2',['big'],[range('big',37,49)])]);
 const {raw:moved,moved:report}=moveLongTablesToAppendix(project([table('big',49),table('small',8)]),raw);
 assert.deepEqual(report.map(m=>[m.tableId,m.reason,m.appendixPages]),[['big','long_table',4]]);
 const ids=moved.slides.map(s=>s.id);
 assert.deepEqual(ids.slice(0,3),['cover','p1','p4'],'the one-page table stays; of the long table only its card\'s points stay');
 assert.ok(!ids.includes('p2')&&!ids.includes('p3')&&!ids.includes('p5'),'pages with only rows leave the body: no truncated head');
 const first=moved.slides.find(s=>s.id==='p4');
 assert.deepEqual(first.keyPoints.map(p=>p.text),['a','b','完整表格见附录 A'],'the pointer stays last');assert.ok(!(first.sourceArtifactRanges||[]).some(r=>r.sourceUnitId==='big'),'no rows of it stay in the body');
 assert.deepEqual(titles(moved),[1,2,3,4].map(k=>`附录 A · 主要业务 API · ${k}/4`),'appendix titles keep their counter');
 assert.deepEqual(moved.slides.filter(s=>s.region==='appendix').map(s=>s.sourceArtifactRanges[0].rowStart),[1,13,25,37],'the appendix holds the whole table');
 assert.ok(new Set(moved.slides.filter(s=>s.region==='appendix').map(s=>s.logicalCardId)).size===4,'each appendix page is its own card, so numbering keeps the counter');
 assert.equal(moved.slides.at(-1).id,'end');assert.equal(moved.slides.at(-2).region,'appendix','the appendix comes just before the closing page');
 assert.equal(moveLongTablesToAppendix(project([table('big',49),table('small',8)],{planningContract:{length:{exact:12}}}),raw).moved.length,0,'an exact page count keeps tables in place');}

// A card whose pages only showed the long table keeps its first page, with its
// notes' points and the pointer, so the reviewed topic stays in the body.
{const only=(id,ranges,notes=[])=>({...page(id,'api',['big'],ranges),notePoints:notes.map(text=>({text}))});
 const raw=frame([page('p1','c1',['small'],[range('small',1,8)],['要点']),only('a1',[range('big',1,25)],['接口按用途分组','写操作需要登录']),only('a2',[range('big',25,49)])]);
 const {raw:moved}=moveLongTablesToAppendix(project([table('big',49),table('small',8)]),raw);
 const kept=moved.slides.find(s=>s.id==='a1');
 assert.ok(kept&&!moved.slides.some(s=>s.id==='a2'),'the card keeps one body page');
 assert.deepEqual(kept.keyPoints.map(p=>p.text),['接口按用途分组','写操作需要登录','完整表格见附录 A'],'its notes become its points, the pointer last');
 assert.ok(!kept.cardObjects.includes('big')&&kept.sourceUnitIds.includes('big'),'no table rows, but it still cites the table');}

// One table per card: the most-cited table stays; another a point cites moves whole to the appendix;
// one no point cites leaves the deck and raw.optionalTables names it (the user, 2026-10-31).
{const raw=frame([page('q1','card',['t1'],[],[{text:'路由',sourceUnitIds:['t2']},{text:'环境',sourceUnitIds:['t2']}]),page('q2','card',['t2']),page('q3','card',['t3'],[],[{text:'配置',sourceUnitIds:['t3']}])]);
 const items=[table('t1',6,'入口'),table('t2',6,'路由'),table('t3',6,'配置')];
 const {raw:moved,moved:report}=moveLongTablesToAppendix(project(items),raw);
 assert.deepEqual(report.map(m=>[m.tableId,m.reason]),[['t1','uncited_table'],['t3','one_table_per_card']],'t2 is cited most and stays');
 assert.deepEqual(moved.optionalTables,['t1'],'the uncited table is named for the notes');
 assert.deepEqual(moved.slides.filter(s=>s.region!=='appendix').map(s=>s.id),['cover','q2','take','end'],'points-only pages before and after the table page join it');
 const kept=moved.slides.find(s=>s.id==='q2');
 assert.deepEqual(kept.cardObjects,['t2']);
 assert.deepEqual(kept.keyPoints.map(p=>p.text),['路由','环境','配置','完整表格见附录 A'],'one line, last, points to the moved table');
 assert.deepEqual(titles(moved),['附录 A · 配置']);
 // 繁體中文 (the user, 2026-10-31): the pointer and the appendix title in traditional characters.
 const hant=moveLongTablesToAppendix(project(items,{generationPolicy:{language:{mode:'output',locale:'zh-HK'}}}),raw).raw;
 assert.deepEqual([titles(hant),hant.slides.find(s=>s.id==='q2').keyPoints.at(-1).text],[['附錄 A · 配置'],'完整表格見附錄 A']);
 const full=moveLongTablesToAppendix(project(items,{planningContract:{deckPlan:{length:{preset:'full'}}}}),raw);
 assert.equal(full.moved.length,0,'full length keeps every table on its card');}

// The source's own appendix leaves the body with no pointer; a heading that says appendix is not doubled.
{const raw=frame([page('r1','main',['body'],[],['要点']),page('r2','restored',['ex'])]);
 const items=[table('body',5,'正文表'),table('ex',6,'附录_交互示例','附录_交互示例')];
 const {raw:moved,moved:report}=moveLongTablesToAppendix(project(items),raw);
 assert.deepEqual(report.map(m=>[m.tableId,m.reason]),[['ex','source_appendix']]);
 assert.ok(!moved.slides.some(s=>s.id==='r2'),'the restored appendix card leaves the body');
 assert.ok(!moved.slides.some(s=>(s.keyPoints||[]).some(p=>/附录/u.test(p.text))),'no pointer: it was an appendix already');
 assert.deepEqual(titles(moved),['附录 A · 交互示例']);}
// A card's points-only pages after its table page give their points back to it;
// the capacity pass then sends what does not fit to the notes.
{const raw=frame([page('s1','card',['t1'],[],[{text:'a',sourceUnitIds:['t1']},{text:'b',sourceUnitIds:['t1']}]),page('s2','card',['t2'],[],['c']),page('s3','card',['t3'],[],['d']),page('s4','card',['t4'],[],['e','f'])]);
 const {raw:moved}=moveLongTablesToAppendix(project([table('t1',6,'一'),table('t2',6,'二'),table('t3',6,'三'),table('t4',6,'四')]),raw);
 const body=moved.slides.filter(s=>s.logicalCardId==='card');
 assert.deepEqual(body.map(s=>[s.id,s.keyPoints.map(p=>p.text)]),[['s1',['a','b','c','d','e','f']]],'the card keeps its cited table and takes back its points-only pages; uncited tables leave without a pointer');
 assert.deepEqual([titles(moved),moved.optionalTables],[[],['t2','t3','t4']]);}
// Without a table page before them, points-only pages merge at six points a page.
{const raw=frame([page('u1','k',[],[],['a','b','c']),page('u2','k',['t1'],[],['d']),page('u3','k',['t2'],[],[{text:'e',sourceUnitIds:['t2']}]),page('u4','k',['t3'],[],['f','g','h','i'])]);
 const {raw:moved}=moveLongTablesToAppendix(project([table('t1',6,'一'),table('t2',6,'二'),table('t3',6,'三')]),raw);
 assert.deepEqual(moved.slides.filter(s=>s.logicalCardId==='k').map(s=>[s.id,s.keyPoints.map(p=>p.text)]),[['u3',['a','b','c','d','e','f','g','h','i']]],'points-only pages around the kept table page join it, theirs first');}
// Section numbers before an appendix heading go, however many ("13 11 共享文本测量").
{const raw=frame([page('v1','m',['n1'],[],[{text:'x',sourceUnitIds:['n1']}]),page('v2','m',['n2'],[],[{text:'y',sourceUnitIds:['n2']},{text:'z',sourceUnitIds:['n2']}])]);
 const {raw:moved}=moveLongTablesToAppendix(project([table('n1',6,'13 11 共享文本测量','13 数学公式'),table('n2',6,'3D Views')]),raw);
 assert.deepEqual(titles(moved),['附录 A · 共享文本测量']);}
// A page left with only an appendix pointer joins the page before it, of any card
// (CodePilot PDF 2026-10-31: "业务接口按处理器执行 · 2/2" held only its pointer).
{const pointerOnly={id:'x2',logicalCardId:'B',title:'x2',cardObjects:[],sourceUnitIds:[],sourceArtifactRanges:[],keyPoints:[{text:'完整表格见附录 Z',navigation:true}],tableAppendix:'Z'};
 const raw=frame([page('x1','A',['tA'],[],[{text:'p',sourceUnitIds:['tA']}]),pointerOnly,page('y1','C',['t1','t2'],[],[{text:'q',sourceUnitIds:['t1']}])]);
 const {raw:moved}=moveLongTablesToAppendix(project([table('tA',6,'甲'),table('t1',6,'一'),table('t2',6,'二')]),raw);
 assert.ok(!moved.slides.some(s=>s.id==='x2'),'the pointer-only page is gone');
 assert.deepEqual(moved.slides.find(s=>s.id==='x1').keyPoints.map(p=>p.text),['p','完整表格见附录 Z'],'its pointer joins the page before');}
// Two cards of one topic stay two cards: a numbered procedure card is not folded
// into the next card's table page under that card's title (world_models.pdf p8:
// the VizDoom procedure showed as "Temperature Effects on Scores"), and each
// keeps its own table; a later part ("· 2/2") still joins its table page.
{const card=(id,title,objects,points)=>({...page(id,'topic',objects,[],points),title});
 const raw=frame([card('w1','Take Cover Procedure',[],['collect','train V','train M']),card('w2','Temperature Effects',['t1'],[{text:'τ',sourceUnitIds:['t1']}]),card('w3','Scores',['t2'],[{text:'s',sourceUnitIds:['t2']}]),card('w4','Scores · 2/2',[],['more'])]);
 const {raw:moved,moved:report}=moveLongTablesToAppendix(project([table('t1',6,'一'),table('t2',6,'二')]),raw);
 assert.deepEqual(report,[],'one table on each card: nothing moves');
 assert.deepEqual(moved.slides.filter(s=>s.logicalCardId==='topic').map(s=>[s.title,s.keyPoints.map(p=>p.text)]),
  [['Take Cover Procedure',['collect','train V','train M']],['Temperature Effects',['τ']],['Scores',['s']],['Scores · 2/2',['more']]],'pages keep their cards when no table moved');
 const second=frame([card('w1','Take Cover Procedure',[],['collect','train V','train M']),card('w2','Temperature Effects',['t1','t2'],[{text:'τ',sourceUnitIds:['t1']}]),card('w3','Temperature Effects · 2/2',[],['more'])]);
 const after=moveLongTablesToAppendix(project([table('t1',6,'一'),table('t2',6,'二')]),second).raw;
 assert.deepEqual(after.slides.filter(s=>s.logicalCardId==='topic').map(s=>[s.title,s.keyPoints.map(p=>p.text)]),
  [['Take Cover Procedure',['collect','train V','train M']],['Temperature Effects',['τ','more']]],'the procedure card stays apart; the table card takes back its own later part');}
// With no table cited, the card keeps the table whose cells its points use
// (world_models 2026-11-01: parameter counts were kept beside the temperature results).
{const params={id:'pc',type:'TableBlock',sectionPath:['4','VizDoom'],rows:[['MODEL','PARAMETER COUNT'],['VAE','4,446,915'],['CONTROLLER','1,088']]};
 const temps={id:'tt',type:'TableBlock',sectionPath:['4','VizDoom'],rows:[['TEMPERATURE','ACTUAL SCORE'],['1.15','1092 ± 556'],['1.30','753 ± 139']]};
 const raw=frame([{...page('z1','viz',['pc','tt'],[],[{text:'Best actual score is 1092 ± 556 with τ = 1.15',sourceUnitIds:['u']}]),title:'Raising Temperature'}]);
 const {raw:moved}=moveLongTablesToAppendix(project([params,temps]),raw);
 assert.deepEqual(moved.slides.find(s=>s.id==='z1').cardObjects,['tt'],'the temperature table stays');
 assert.deepEqual(moved.optionalTables,['pc']);
 // Common short words do not make a bigger table win the tie.
 const wordy={id:'ww',type:'TableBlock',sectionPath:['4','VizDoom'],rows:[['the','and','with'],['for','the','was'],['are','the','its'],['has','the','and']]};
 const tie=frame([{...page('z2','viz2',['ww','tt'],[],[{text:'The best score was 1092 ± 556 and the agent has its policy',sourceUnitIds:['u']}]),title:'Scores'}]);
 assert.deepEqual(moveLongTablesToAppendix(project([wordy,temps]),tie).raw.slides.find(s=>s.id==='z2').cardObjects,['tt'],'the numbers decide, not "the" and "and"');}
console.log('PASS table appendix: long tables, one table per card and the source appendix move before the closing page with counted titles');
