// The number guard on a code-placed card page (Fable F3, 2026-11-01): a point
// whose number the source does not state goes to the speaker notes; when every
// point fails, the points stay and the page is flagged by name, never silently.
import assert from 'node:assert/strict';
import {_internals} from './lib/ppt-api.mjs';
import {bindThemeCardPage} from './lib/ppt-card-pages.mjs';
import {inspectContent} from './lib/ppt-content-qa.mjs';

const IN=914400;
const frame={slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:60},{role:'content',shapeId:10}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},geometry:{x:.6*IN,y:.3*IN,width:11.9*IN,height:.8*IN},style:{fontSizePt:28}},{id:'c',type:'text',nativeRef:{shapeId:10,contractVersion:2},geometry:{x:.6*IN,y:1.4*IN,width:11.9*IN,height:5*IN},style:{fontSizePt:14}}]};
const sourceText='The controller is trained inside the world model. Training ran for 300 generations on 64 workers.';
const build=points=>{
 const page={id:'p',logicalCardId:'card',title:'Training',section:'Training',cardObjects:[],keyPoints:points.map((text,k)=>({text,sourceUnitIds:['b'+k]})),sourceUnitIds:['b0']};
 const project={planningContract:{version:3,cardOutline:{raw:{slides:[{id:'cover'},structuredClone(page)]}}},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[frame,frame]},templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111',background:'#ffffff'}},
  source:{text:sourceText,segments:[{id:'b0',text:sourceText}],semantic:{inventory:{items:[],relationships:[]}}},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},outline:[{id:'cover',title:'Cover'},page],pages:2};
 const slide={id:'p',title:'Training',nodes:[],cardPage:{mode:'theme'}};
 bindThemeCardPage(project,slide,1,page);
 project.deck={slides:[{id:'cover',nodes:[]},slide]};
 return {project,slide,page};
};
{const {project,slide,page}=build(['The controller is trained inside the world model.','Training ran for 300 generations on 64 workers.','Training ran for 900 generations in total.']);
 _internals.numberGuard(project,slide,1,page);
 assert.equal(page.keyPoints.length,2,'the unsupported point leaves the page');
 assert.equal(page.notePoints?.length,1);assert.ok(page.numericNotes?.every(item=>!item.kept));}
{const {project,slide,page}=build(['Training ran for 900 generations.','It used 128 workers.']);
 _internals.numberGuard(project,slide,1,page);
 assert.equal(page.keyPoints.length,2,'every point failing: the points stay');
 assert.ok(page.numericNotes?.length&&page.numericNotes.every(item=>item.kept),'and the page is flagged');
 assert.ok(project.planningContract.cardOutline.raw.slides[1].numericNotes?.length,'the plan keeps the flag');
 const issue=inspectContent(project).issues?.find(item=>item.code==='source_number_to_notes');
 assert.ok(issue?.pageFlag&&/every point carries/.test(issue.message),issue?.message);}
// A failing title (an unverified "· 1/2" counter) never moves or rebuilds
// points, and a point moves only by its whole number (live Mood-Board,
// 2026-11-02: "422,368" left with the counter's "2").
{const {project,slide,page}=build(['The controller is trained inside the world model.','Training ran for 300 generations on 64 workers.']);
 slide.nodes.push({id:'title2',type:'text',semanticRole:'title',content:{text:'Training · 1/2'}});slide.title='Training · 1/2';
 _internals.numberGuard(project,slide,1,page);
 assert.equal(page.keyPoints.length,2,'the title\'s number moves no point');assert.equal(page.cardShapeOverride,undefined,'nor rebuilds the page');}
{const {project,slide,page}=build(['The controller is trained inside the world model.','The controller ran on 6 workers.','Training ran for 300 generations on 64 workers.']);
 _internals.numberGuard(project,slide,1,page);
 assert.deepEqual(page.notePoints?.map(point=>point.text),['The controller ran on 6 workers.'],'an unsupported "6" does not move the point holding 64');
 assert.deepEqual(page.numericNotes.map(item=>[item.value,item.point]),[['6','The controller ran on 6 workers.']],'the ledger names the point and its number');assert.ok(page.numericNotes[0].nodeId);}
// The live path (Fable 2026-11-02): a split card whose halves stand around a
// figure page, on an outline without card ids; the second half's counter
// verifies through the plan, so nothing moves and nothing is flagged.
{const {project,slide,page}=build(['The controller is trained inside the world model.','Training ran for 300 generations on 64 workers.']);
 const first={id:'q',title:'Training · 1/2',keyPoints:[{text:'The controller is trained inside the world model.'}],cardObjects:[]},figure={id:'f',title:'Figure',figurePage:true,keyPoints:[]};
 project.outline=[project.outline[0],first,figure,{...project.outline[1],title:'Training · 2/2'}];
 project.planningContract.cardOutline.raw.slides=[{id:'cover'},{...first,logicalCardId:'card'},{...figure,logicalCardId:'card'},{...project.planningContract.cardOutline.raw.slides[1],title:'Training · 2/2',logicalCardId:'card'}];
 project.templateFidelity.slides=[...project.templateFidelity.slides,...project.templateFidelity.slides];
 project.deck={slides:[{id:'cover',nodes:[]},{id:'q',nodes:[]},{id:'f',nodes:[]},slide]};
 slide.nodes.push({id:'title2',type:'text',semanticRole:'title',content:{text:'Training · 2/2'}});
 _internals.numberGuard(project,slide,3,page);
 assert.equal(page.keyPoints.length,2);assert.equal(page.numericNotes,undefined,'no guard move, no flag');
 const {inspectSourceNumbers}=await import('./lib/ppt-source-numbers.mjs');
 assert.ok(!inspectSourceNumbers(project,[slide]).some(issue=>(issue.nodeIds||[]).includes('title2')),'the counter verifies across the figure page');}
// The moved point is on the slide's record too, and the export notes carry it;
// an attribution the guard cannot verify across languages moves nothing
// (3197 85a2621c p5: "采样尺度(0.85, 1.0)" left the slide and reached no notes).
{const {project,slide,page}=build(['The controller is trained inside the world model.','Training ran for 300 generations on 64 workers.','Training ran for 900 generations in total.']);
 _internals.numberGuard(project,slide,1,page);
 assert.deepEqual(slide.guardNotePoints?.map(point=>point.text),['Training ran for 900 generations in total.']);
 const {unshownPointNotes}=await import('./lib/ppt-card-language.mjs');
 const stored={...project,outline:[{id:'cover',title:'Cover'},{...page,keyPoints:[...page.keyPoints,{text:'Training ran for 900 generations in total.',sourceUnitIds:['b2']}],notePoints:[]}]};
 const notes=unshownPointNotes(stored);
 assert.equal(notes.length,1);assert.match(notes[0].text,/900 generations/u);assert.equal(notes[0].text.split('\n').length,1,'once, not twice');}
{const zh='训练在世界模型内进行，共300代，使用64个worker。';
 const {project,slide,page}=build(['控制器在世界模型内训练。',zh]);
 project.source={text:'Training ran for 300 generations on 64 workers.',segments:[{id:'b0',text:'Training ran for 300 generations on 64 workers.'}],semantic:{inventory:{items:[],relationships:[]}}};
 project.generationPolicy={language:{mode:'output',locale:'zh-CN'}};
 _internals.numberGuard(project,slide,1,page);
 assert.equal(page.keyPoints.length,2,'a Chinese point with the source\'s own numbers stays');}
// The last net: an outline point the slide does not show goes to the notes.
{const {unshownPointNotes}=await import('./lib/ppt-card-language.mjs');
 const project={outline:[{id:'c'},{id:'p',keyPoints:[{text:'目标块表征：图块经编码器得到表征。'},{text:'上下文块：采样尺度(0.85, 1.0)的上下文块。',sourceUnitIds:['b9']}]}],deck:{slides:[{id:'c',nodes:[]},{id:'p',nodes:[{type:'text',content:{text:'目标块表征：图块经编码器得到表征。'}}]}]}};
 assert.deepEqual(unshownPointNotes(project).map(note=>[note.index,note.text]),[[1,'上下文块：采样尺度(0.85, 1.0)的上下文块。']]);}
console.log('PASS number guard: unsupported points to notes; an all-failing page keeps its points and is flagged');
