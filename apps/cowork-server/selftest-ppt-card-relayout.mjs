// Local "重新排版" on an uploaded template's card page (Fable 2026-11-01): the
// page's code-placed boxes are measured afresh, manual moves discarded; an
// arrangement word or a repeat gives another measured layout; the cover refuses.
import assert from 'node:assert/strict';
import {cardPageRelayout} from './lib/ppt/native-content-layout.mjs';
import {editableCapabilities,codeLaidPage} from './lib/ppt/edit-context.mjs';
import {typedCommands} from './lib/ppt/typed-proposal.mjs';
import {cardPageDraft,setCardLayoutCap} from './lib/ppt-card-pages.mjs';
import {visibleNodes} from './lib/ppt-visible-content.mjs';
const IN=914400,W=12192000,H=6858000;
const text=(id,body,geometry)=>({id,type:'text',semanticRole:'source-explanation',slotId:'absolute',geometry,style:{fontSizePt:18},content:{text:body,derivedFrom:'card-page'}});
const points=['涉及发送、更新等变更时需明确对象与范围，结果需证明预期变更已发生。','能力不可用时呈现阻碍，不能伪造执行结果或自动扩大权限绕过拒绝。','参数模糊且要求固定格式时，先解决歧义再引入模板和工具。','三类能力可组合；MCP 不规定某个分支编号优先。'];
// Page 2: the user dragged the last box onto the third one.
const nodes=points.map((body,k)=>text('n'+k,body,{x:Math.round((1+k*2.9)*IN),y:Math.round(2.2*IN),width:Math.round(2.7*IN),height:Math.round(1.2*IN)}));
nodes[3]={...nodes[3],geometry:{...nodes[2].geometry,y:nodes[2].geometry.y+Math.round(.3*IN)},userGeometry:true};
const project={planningContract:{version:3},templateFidelity:{mode:'preserve',width:W,height:H,slides:[{nodes:[],slots:[]},{nodes:[],slots:[]}]},templateSpec:{fonts:{body:'Arial'}},
 outline:[{id:'cover',title:'Cover'},{id:'p',title:'变更与受限需严格核查',keyPoints:points.map(text=>({text}))}],
 deck:{slides:[{id:'cover',cardPage:{mode:'cover'},nodes:[]},{id:'p',cardPage:{mode:'theme'},nodes}]}};
assert.equal(codeLaidPage(project,'p'),true);
assert.equal(codeLaidPage(project,'cover'),false,'the cover is not code-laid');
assert.equal(editableCapabilities(project).relayout,true,'an uploaded-template card deck can be laid out again');
const [command]=cardPageRelayout(project,{slideId:'p',instruction:'重新排版'});
assert.equal(command.type,'nodes.setGeometry');
const boxes=command.payload.changes.map(change=>change.geometry);
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
assert.ok(boxes.every((a,i)=>boxes.every((b,j)=>i===j||!overlap(a,b))),'no box overlaps another after relayout');
assert.ok(command.payload.changes.every(change=>change.userGeometry===false),'manual moves are discarded');
assert.ok(boxes.every(box=>Object.values(box).every(Number.isInteger)),'geometry is whole EMU');
// Applying it and asking again gives a different measured layout.
const applied=structuredClone(project);applied.deck.slides[1].nodes=nodes.map((n,i)=>({...n,geometry:boxes[i],userGeometry:false}));
const [again]=cardPageRelayout(applied,{slideId:'p',instruction:'重新排版'});
assert.ok(again.payload.changes.some((change,i)=>JSON.stringify(change.geometry)!==JSON.stringify(boxes[i])),'a repeat never returns the same layout');
const [two]=cardPageRelayout(project,{slideId:'p',instruction:'改成两栏'});
assert.equal(new Set(two.payload.changes.map(change=>change.geometry.x)).size,2,'"两栏" gives two columns');
assert.throws(()=>cardPageRelayout(project,{slideId:'cover',instruction:'重新排版'}),/cover keeps its template layout/);
// Guards (Fable 2026-11-01): a banner statement, a locked box or an accepted
// page refuses; an arrangement already on the page refuses instead of a no-op.
const variant=edit=>{const copy=structuredClone(project);edit(copy.deck.slides[1].nodes,copy);return copy;};
assert.throws(()=>cardPageRelayout(variant(n=>{n[0].style.colorBasis='template_banner_text';}),{slideId:'p'}),/template's banner/);
assert.throws(()=>cardPageRelayout(variant(n=>{n[1].locked=true;}),{slideId:'p'}),/locked box/);
assert.throws(()=>cardPageRelayout(variant((n,p)=>{p.runtime={slides:{p:{accepted:true}}};}),{slideId:'p'}),/unlock the page/);
const [one]=cardPageRelayout(project,{slideId:'p',instruction:'单栏'});
const stacked=structuredClone(project);stacked.deck.slides[1].nodes=nodes.map((n,i)=>({...n,geometry:one.payload.changes[i].geometry,userGeometry:false}));
assert.throws(()=>cardPageRelayout(stacked,{slideId:'p',instruction:'单栏'}),/already has this arrangement/);
// A figure page: the figure keeps its aspect, nothing overlaps, whole EMU.
const figurePage=structuredClone(project);figurePage.outline[1].figurePage=true;figurePage.deck.slides[1].cardPage={};
figurePage.deck.slides[1].nodes=[{id:'img',type:'image',semanticRole:'source-media',slotId:'absolute',geometry:{x:IN,y:2*IN,width:9*IN,height:3*IN},content:{sourceImageId:'f1',width:1600,height:900}},text('t',points[0],{x:IN,y:5.2*IN,width:10*IN,height:IN})];
const [fig]=cardPageRelayout(figurePage,{slideId:'p',instruction:'重新排版'});
const [pic,words]=fig.payload.changes.map(change=>change.geometry);
assert.ok([pic,words].every(box=>Object.values(box).every(Number.isInteger))&&!overlap(pic,words),'figure page relays out without overlap in whole EMU');
assert.ok(Math.abs(pic.width/pic.height-16/9)<.02,'the figure keeps its aspect');
// The editor's "调整来源内容布局" button (mode native-content) reaches the same
// relayout on a card page, even after a drag.
for(const scope of ['slide','object']){
 const [button]=await typedCommands(project,{type:'layout',mode:'native-content',scope,slideId:'p',nodeId:'n3',instruction:'调整来源内容布局'},{},null,()=>{});
 assert.ok(button.payload.changes.every(change=>change.userGeometry===false),`the ${scope} button relays out the dragged page`);
}
// Rule 3: a page written into the template's own text slots becomes a
// code-laid theme page on the same frame; text edited since the outline refuses.
{const slot=(id,x)=>({id:'s'+id,type:'text',nativeRef:{shapeId:id,contractVersion:2},nativeTextFrame:{wordWrap:true},geometry:{x:x*IN,y:2*IN,width:3.8*IN,height:3*IN},style:{fontSizePt:14},content:{text:'Body'}});
 const spec=k=>({sourceIndex:k,variantId:'original',slots:[{role:'title',shapeId:1,capacity:40,maxLines:1},{role:'content',shapeId:2,purpose:'body',capacity:200},{role:'content',shapeId:3,purpose:'body',capacity:200}],nodes:[{id:'s1',type:'text',semanticRole:'template-title',nativeRef:{shapeId:1,contractVersion:2},nativeTextFrame:{wordWrap:true},geometry:{x:.6*IN,y:.4*IN,width:11*IN,height:.8*IN},style:{fontSizePt:28},content:{text:'Title'}},slot(2,.6),slot(3,4.8)]});
 const page={id:'p',title:'Validation comes first',keyPoints:[{text:'Validation must precede any live allocation step'},{text:'Costs decide which signals survive in practice'}]};
 const native={pages:2,planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'output',locale:'en'}},templateSpec:{fonts:{title:'Arial',body:'Arial'}},templateFidelity:{mode:'preserve',width:13.333*IN,height:7.5*IN,slides:[spec(0),spec(1)]},outline:[{id:'c',title:'Cover'},page]};
 setCardLayoutCap(Infinity);
 const draft=cardPageDraft(native,1,page);assert.equal(draft.cardPage.mode,'native');
 native.deck={slides:[{id:'c',cardPage:{mode:'cover'},nodes:[]},{id:'p',title:page.title,cardPage:{mode:'native'},nodes:spec(1).nodes.map(n=>({...n,content:{text:draft.slotTexts[String(n.nativeRef.shapeId)]}}))}]};
 setCardLayoutCap(null);
 assert.equal(editableCapabilities(native).relayout,true,'a deck with a template-slot page can be laid out again');
 const [replace]=cardPageRelayout(native,{slideId:'p',instruction:'重新排版'});
 assert.equal(replace.type,'deck.replace');
 const after=replace.payload.deck.slides[1],shown=visibleNodes(after).map(n=>n.content?.text);
 assert.equal(after.cardPage.mode,'theme','the page becomes a theme page');
 assert.ok(page.keyPoints.every(point=>shown.filter(text=>text===point.text).length===1),'each point shows once, in a code-placed box');
 assert.ok(shown.includes(page.title),'the template title stays');
 // Text edited on the page is carried into the points and the outline (Fable D1).
 const edited=structuredClone(native);edited.deck.slides[1].nodes[1].content.text='A point the user rewrote';
 setCardLayoutCap(Infinity);
 const [carried]=cardPageRelayout(edited,{slideId:'p',instruction:'重新排版'});
 setCardLayoutCap(null);
 const texts=visibleNodes(carried.payload.deck.slides[1]).map(n=>n.content?.text);
 assert.ok(texts.includes('A point the user rewrote')&&!texts.includes(page.keyPoints[0].text),'the edit survives the relayout');
 assert.deepEqual(carried.payload.projectState.outline[1].keyPoints.map(p=>p.text),['A point the user rewrote',page.keyPoints[1].text],'and reaches the outline');}
console.log('PASS card page relayout: fresh measured layout, manual moves discarded, repeats differ, the cover refuses');
