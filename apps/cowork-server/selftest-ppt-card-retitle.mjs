// The final titling pass (the user, 2026-11-01, B and C): each content page
// is titled from what it shows once code has laid the pages out; a split
// card keeps one base, a figure page a plain title (N6); a title that fails a check
// keeps the old one; a deck subject leading most titles is left out.
import assert from 'node:assert/strict';
import {retitleItems,retitleTask,acceptRetitles,applyRetitles,dropSubjectTitles} from './lib/ppt-card-retitle.mjs';

const items=[
 {id:'u1',type:'Paragraph',text:'The context encoder processes only the visible context patches of the image.',sectionPath:['Method']},
 {id:'u2',type:'Paragraph',text:'The predictor outputs representations of several target blocks from the context.',sectionPath:['Method']},
 {id:'u3',type:'Paragraph',text:'Predicting in pixel space degrades linear probing performance.',sectionPath:['Ablations']},
 {id:'u4',type:'Paragraph',text:'Masking large target blocks improves linear probing.',sectionPath:['Ablations']},
];
const point=(text,ids)=>({text,sourceUnitIds:ids});
const project=()=>({inputUnderstanding:{primaryLanguage:'en'},generationPolicy:{language:{mode:'source',body:'primary'}},
 source:{semantic:{inventory:{items}},images:[{id:'f1',caption:'Figure 3: Linear probing accuracy rises with target block scale.'}]}});
const raw=()=>({slides:[
 {id:'c',title:'I-JEPA',cardFrame:'cover'},
 {id:'a',title:'I-JEPA Method',logicalCardId:'k1',keyPoints:[point('The context encoder processes only visible context patches.',['u1'])]},
 {id:'b1',title:'I-JEPA Ablations · 1/2',logicalCardId:'k2',keyPoints:[point('Predicting in pixel space degrades linear probing performance.',['u3'])]},
 {id:'b2',title:'I-JEPA Ablations · 2/2',logicalCardId:'k2',keyPoints:[point('Masking large target blocks improves linear probing.',['u4'])]},
 {id:'g',title:'Ablations · Figures',logicalCardId:'k2',figurePage:true,sourceImageIds:['f1']},
 {id:'d',title:'I-JEPA Predictor Outputs',logicalCardId:'k3',keyPoints:[point('The predictor outputs representations of several target blocks.',['u2'])]},
 {id:'l',title:'Locked Title',logicalCardId:'k4',titleLocked:true,keyPoints:[point('x',['u2'])]},
 {id:'z',title:'Thanks for watching!',cardFrame:'closing'},
]});

// Items: one per card, the split card's two parts as one, the figure page with its caption.
{const p=project(),r=raw(),list=retitleItems(p,r);
 assert.deepEqual(list.map(item=>item.indexes),[[1],[2,3],[4],[5]]);
 // A figure page of the card between its parts does not split the item (3197 mood-board p8-11).
 const bridged=raw();bridged.slides.splice(3,0,bridged.slides.splice(4,1)[0]);
 assert.deepEqual(retitleItems(p,bridged).map(item=>item.indexes),[[1],[2,4],[3],[5]]);
 assert.equal(list[1].points.length,2);
 assert.equal(list[2].figure,true);assert.match(list[2].captions[0],/target block scale/u);
 assert.deepEqual(list[0].headings,['Method']);
 const task=retitleTask(p,r,list);
 assert.match(task.prompt,/at most \d+ characters/u);assert.match(task.prompt,/Keep the current title, unchanged/u);
 assert.match(task.prompt,/Ablations/u);assert.doesNotMatch(task.prompt,/Locked Title/u);}

// Accepted: a point stated in the page's words; the split card's parts share
// one base; the figure page keeps its marker. Refused: a heading label, a word
// the page does not have, another page's title, TeX, a format ("Figure 3 shows").
{const p=project(),r=raw(),list=retitleItems(p,r);
 const reply={titles:[
  {item:1,title:'Method'},
  {item:2,title:'Pixel Prediction Degrades Probing'},
  {item:3,title:'Accuracy Rises With Scale'},
  {item:4,title:'The Predictor Outputs Quantum Representations'},
 ]};
 const accepted=acceptRetitles(p,r,list,reply,'I-JEPA');
 assert.equal(accepted.titles.has(1),false,'a heading label keeps the old title');
 assert.equal(accepted.titles.get(2),'Pixel Prediction Degrades Probing');
 assert.equal(accepted.titles.get(3),'Pixel Prediction Degrades Probing');
 assert.equal(accepted.titles.get(4),'Accuracy Rises With Scale','a figure page carries no marker; its eyebrow says "Figure" (N6)');
 assert.equal(accepted.titles.has(5),false,'"Quantum" is not on the page');
 assert.equal(accepted.count,2);
 const again=acceptRetitles(p,r,list,{titles:[{item:4,title:'Pixel Prediction Degrades Probing'},{item:1,title:'$x$ Encodes Context'}]});
 assert.equal(again.titles.size,0,'a repeated title and TeX are refused');
 assert.deepEqual(again.refused.map(entry=>entry.reason),['words:Pixel,Degrades','text'],'another page\'s words (a generic verb such as "Probing" is free), then TeX');
 const format=acceptRetitles(p,r,list,{titles:[{item:4,title:'Figure 3 Shows Accuracy Rising'},{item:1,title:'This Table Lists the Context Encoder'}]});
 assert.deepEqual(format.refused.map(entry=>entry.reason),['format','format'],'a title naming the page format is refused');
 const saved=applyRetitles(p,{raw:r,advisories:[]},accepted);
 assert.equal(saved.raw.slides[2].focus,'Pixel Prediction Degrades Probing');
 assert.equal(saved.advisories.at(-1).code,'card_titles_rewritten');}

// A subject in the deck's subject is dropped where the rest reads as a title;
// "I-JEPA Method" (one word left) keeps it. Nothing changes without a subject.
{const p=project(),r=raw();
 const dropped=dropSubjectTitles(p,r);
 assert.equal(dropped.subject,'I-JEPA');
 assert.equal(dropped.titles.get(5),'Predictor Outputs');
 assert.equal(dropped.titles.has(1),false);
 assert.equal(dropped.titles.has(0),false);
 const plain={slides:r.slides.map(slide=>({...slide,title:String(slide.title).replace(/^I-JEPA /u,'')}))};
 assert.equal(dropSubjectTitles(p,plain).titles.size,0);}

// The word check reads past inflection (Fable, 2026-11-01, B2): "Encodes Frames"
// for a source that says "encode each frame"; a word the page lacks is still refused.
{const p=project(),r=raw();r.slides[5]={...r.slides[5],keyPoints:[point('The VAE should encode each frame into a latent vector.',['u2'])]};
 const list=retitleItems(p,r),at=list.findIndex(item=>item.indexes[0]===5)+1;
 const ok=acceptRetitles(p,r,list,{titles:[{item:at,title:'The VAE Encodes Frames'}]});
 assert.equal(ok.titles.get(5),'The VAE Encodes Frames',JSON.stringify(ok.refused));
 const bad=acceptRetitles(p,r,list,{titles:[{item:at,title:'The VAE Compresses Audio'}]});
 assert.match(bad.refused[0].reason,/^words:/u);
 // No prompt asks the model to drop the deck subject (B1): code drops it only where it is not the sentence's subject.
 assert.doesNotMatch(retitleTask(p,r,list).prompt,/Do not begin a title with/u);}
{const {titleCase}=await import('./lib/ppt-outline-cards.mjs');
 assert.equal(titleCase('CMA-ES solves for Wc and bc in nm'),'CMA-ES Solves for Wc and bc in nm','a symbol is never title-cased (B3)');}
// No content, no call.
assert.equal(retitleTask(project(),{slides:[{title:'Cover',cardFrame:'cover'}]},[]),null);
console.log('ppt card retitle selftest passed');
