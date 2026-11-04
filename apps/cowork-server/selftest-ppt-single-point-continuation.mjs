// A continuation that holds a single point goes back to its card's page
// (Fable 2026-10-31, World Models p12: "Iterative Training Procedure · 2/2" was
// one paragraph on an otherwise empty page). The merged page's points step
// down the font ladder (body-1, body-2 pt) when all but the last fit, as an
// object page's explanation already does (Fable r19 D); a split never leaves a
// one-point continuation either.
import assert from 'node:assert/strict';
import {fitThemePage,bindThemeCardPage} from './lib/ppt-card-pages.mjs';
import {preflightCardCapacity,cardCapacityHint} from './lib/ppt-card-capacity-preflight.mjs';

const IN=914400;
const frame=h=>({slots:[{role:'title',shapeId:2,maxLines:1,lineVisualUnits:60},{role:'content',shapeId:10}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},geometry:{x:.6*IN,y:.3*IN,width:11.9*IN,height:.8*IN},style:{fontSizePt:28}},{id:'c',type:'text',nativeRef:{shapeId:10,contractVersion:2},geometry:{x:.6*IN,y:1.4*IN,width:11.9*IN,height:h*IN},style:{fontSizePt:14}}]});
const point=k=>({text:`Step ${k}: the controller is trained inside the world model and then evaluated in the actual environment, so its policy can be compared fairly across ${k} rollouts of the task.`,sourceUnitIds:['b_'+k]});
const page=(id,points,extra={})=>({id,logicalCardId:'card',title:'Iterative Training Procedure',section:'Training',cardObjects:[],keyPoints:points,sourceUnitIds:points.flatMap(p=>p.sourceUnitIds),...extra});
const project=(h,slides)=>({templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:slides.map(()=>frame(h))},templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111',background:'#ffffff'}},source:{text:'',semantic:{inventory:{items:[]}}},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},outline:slides,pages:slides.length});
const six=Array.from({length:6},(_,k)=>point(k+1)),seventh={text:'We have shown that one iteration of this training loop was enough to solve simple tasks. For more difficult tasks, the controller must actively explore parts of the environment that improve its world model.',sourceUnitIds:['b_63']};
const fits=(h,points)=>fitThemePage(project(h,[{id:'cover'},page('p',points)]),1,page('p',points))?.fit;
// A frame where six points fit at the 14 pt body and seven do not.
const atBody=fit=>fit.capacity_ok&&fit.measurements.every(m=>m.fontBasis!=='continuation_font_ladder');
let h=2;while(!atBody(fits(h,six)))h+=.02;
for(;atBody(fits(h,six))&&!fits(h,[...six,seventh]).capacity_ok;)h+=.02;
assert.ok(atBody(fits(h,six))&&!atBody(fits(h,[...six,seventh])),'fixture: a frame between the two exists');
{const seven=fits(h,[...six,seventh]);
 assert.equal(fits(h,six).measurements.some(m=>m.fontBasis==='continuation_font_ladder'),false,'a page that fits keeps the body size');
 assert.ok(seven.capacity_ok,'all but one point fit at 14 pt: the page steps down instead of continuing');
 const sizes=[...new Set(seven.measurements.map(m=>m.fontSizePt))];
 assert.equal(sizes.length,1);assert.ok([13,12].includes(sizes[0]),JSON.stringify(sizes));
 assert.ok(seven.measurements.every(m=>m.fontBasis==='continuation_font_ladder'));}

// The preflight puts the one-point continuation back on its card page.
{const slides=[{id:'cover',title:'World Models'},page('p1',six),page('p2',[seventh],{title:'Iterative Training Procedure (cont.)',restoredFrom:'p1'}),page('next',[point(9),point(10)],{logicalCardId:'other',title:'Car Racing'}),{id:'end',title:'Thanks',cardFrame:'closing',keyPoints:[]}];
 const p=project(h,slides),schedule=q=>{q.templateFidelity.slides=q.outline.map(()=>frame(h));};
 const checked=preflightCardCapacity(p,{slides},{schedule});
 assert.deepEqual(checked.raw.slides.map(s=>s.id),['cover','p1','next','end'],'the continuation is gone');
 assert.deepEqual(checked.raw.slides[1].keyPoints,[...six,seventh],'every point is kept, in order');
 assert.ok(checked.raw.slides[1].sourceUnitIds.includes('b_63'));
 assert.ok(checked.raw.notes.some(n=>n.code==='single_point_continuation_merged'));
 assert.deepEqual(checked.unresolved,[]);
 // Bound at the measured smaller size; nothing overflows.
 const slide={id:'p1',title:'Iterative Training Procedure',nodes:[]};bindThemeCardPage(p,slide,1,checked.raw.slides[1]);
 const texts=slide.nodes.filter(n=>n.semanticRole==='source-explanation');
 assert.equal(texts.length,7);assert.ok(texts.every(n=>[13,12].includes(n.style.fontSizePt)),JSON.stringify(texts.map(n=>n.style.fontSizePt)));
 // A continuation with two points, a figure or another card stays.
 const two=[{id:'cover'},page('p1',six),page('p2',[seventh,point(8)]),{id:'end',cardFrame:'closing',keyPoints:[]}];
 assert.equal(preflightCardCapacity(project(h,two),{slides:two},{schedule}).raw.slides.some(s=>s.id==='p2'),true,'two points are a real continuation');
 const figure=[{id:'cover'},page('p1',six),page('p2',[seventh],{sourceImageIds:['img']}),{id:'end',cardFrame:'closing',keyPoints:[]}];
 assert.equal(preflightCardCapacity(project(h,figure),{slides:figure},{schedule}).raw.slides.some(s=>s.id==='p2'),true,'a page with a figure is not a bare continuation');
 // An exact page count keeps its pages.
 const exact={...project(h,slides),planningContract:{settings:{length:{exact:5}}}};
 assert.equal(preflightCardCapacity(exact,{slides},{schedule}).raw.slides.length,5);}

// On an uploaded template no merge makes an unnumbered page hold more blocks
// than its largest component (world_models zh on Mood, 2026-11-03: a 3+2 split
// rejoined as five blocks on a template of 2, 3 and 4 components).
{const four={pageRole:{role:'content'},textSlots:Array.from({length:4},()=>({role:'point-heading'}))};
 const capped=slides=>({...project(h,slides),templateFidelity:{...project(h,slides).templateFidelity,componentProfile:{pages:[four]}}});
 const schedule=q=>{q.templateFidelity.slides=q.outline.map(()=>frame(h));};
 const one=[{id:'cover'},page('p1',six.slice(0,4)),page('p2',[seventh]),page('x1',[point(11)],{logicalCardId:'x'}),page('x2',[point(12)],{logicalCardId:'x'}),{id:'end',cardFrame:'closing',keyPoints:[]}];
 assert.equal(preflightCardCapacity(capped(one),{slides:one},{schedule}).raw.slides.some(s=>s.id==='p2'),true,'a fifth block stays on its continuation');
 const thin=[{id:'cover'},page('a',six.slice(0,3)),page('b',[seventh,point(8)]),page('c',[point(9),point(10),point(11)],{logicalCardId:'c'}),page('d',[point(12),point(13),point(14)],{logicalCardId:'d'}),page('e',[point(15),point(16),point(17)],{logicalCardId:'e'}),page('f',[point(18),point(19),point(20)],{logicalCardId:'f'}),{id:'end',cardFrame:'closing',keyPoints:[]}];
 const kept=preflightCardCapacity(capped(thin),{slides:thin},{schedule}).raw;
 assert.ok(kept.slides.some(s=>s.id==='b')&&!(kept.notes||[]).some(n=>n.code==='thin_card_consolidated'),'3+2 is not rejoined as five: '+JSON.stringify(kept.slides.map(s=>[s.id,s.keyPoints?.length])));
 const merged=preflightCardCapacity(project(h,thin),{slides:thin},{schedule}).raw;
 assert.ok(!merged.slides.some(s=>s.id==='b'),'without component counts the thin page still joins its card');}

// A split never leaves a single point behind: with eight points, of which
// seven fit only on the ladder, at least two move on.
{const eight=[...six,seventh,point(8)],slides=[{id:'cover'},page('p',eight)],p=project(h,slides);
 const hint=cardCapacityHint(p,1);
 assert.ok(hint?.kept>=1&&eight.length-hint.kept>=2,JSON.stringify(hint));}
console.log('PASS one-point continuations merge back on the font ladder; splits keep two points together; real continuations stay');
