// A split card's pages are numbered "<base> · k/n", part 1 included, in
// place of "(cont.)"/"（续）" (Fable 2026-10-27, option D).
import assert from 'node:assert/strict';
import {isContinued,unmarked,numberedTitle,cardPartRuns,unmarkedContinuation} from './lib/ppt-continuation-marker.mjs';
import {numberCardParts,withPartTitle,patchPartCounter,cardTitleFits,inspectCardContinuations} from './lib/ppt-card-pages.mjs';
import {markContinuation} from './lib/ppt-outline-cards.mjs';
import {keepCardContinuation,normalizeTopicTitle} from './lib/ppt-topic-language.mjs';
import {verifiedPartCounter} from './lib/ppt-source-numbers.mjs';

// 1. The counter reads as a marker: a later part is continued, part 1 is not.
assert.equal(isContinued('Attention · 1/3'),false);assert.equal(isContinued('Attention · 2/3'),true);assert.equal(isContinued('Attention (cont.)'),true);
assert.equal(unmarked('Attention · 2/3 | 注意力 · 2/3'),'Attention | 注意力');assert.equal(unmarked('注意力（续）'),'注意力');
assert.equal(numberedTitle('Attention (cont.)',2,3),'Attention · 2/3');
assert.equal(markContinuation('Attention · 2/3'),'Attention (cont.)','the title passes still set the old marker; the numbering pass renumbers it');
// The topic normalizers keep it, as they keep the old marker.
for(const title of ['Attention · 2/3','注意力机制 Attention · 2/3'])assert.equal(keepCardContinuation(true,title,normalizeTopicTitle(title,/\p{Script=Han}/u.test(title)?'zh':'en')),title);

const cards=(...pages)=>({planningContract:{version:3,flow:'cards'},inputUnderstanding:{primaryLanguage:'en'},outline:[{id:'s0',title:'Cover'},...pages.map(([title,card,extra],k)=>({id:'s'+(k+1),title,logicalCardId:card,...extra}))]});
const apply=project=>{const {titles,notes}=numberCardParts(project);project.outline=project.outline.map((page,index)=>titles.has(index)?withPartTitle(project,page,titles.get(index)):page);return notes;};

// 2. A run is a card page and the marked pages after it; every part is numbered.
{const p=cards(['Attention','a'],['Attention (cont.)','a'],['Attention (cont.)','a'],['Summary','b'],['Old Card · 1/2','c']);
 assert.deepEqual(apply(p),[]);
 assert.deepEqual(p.outline.map(page=>page.title),['Cover','Attention · 1/3','Attention · 2/3','Attention · 3/3','Summary','Old Card'],'a stray counter outside a run is removed');
 assert.equal(p.outline[2].focus,'Attention · 2/3');
 assert.deepEqual(cardPartRuns(p.outline),[{start:1,end:3,n:3,base:'Attention',pages:[1,2,3]}]);
 assert.deepEqual(numberCardParts(p).titles.size,0,'numbering is idempotent');
 // A later split adds a part: the whole run is renumbered.
 p.outline.splice(4,0,{id:'s9',title:'Attention (cont.)',logicalCardId:'a'});
 assert.deepEqual([...numberCardParts(p).titles.values()],['Attention · 1/4','Attention · 2/4','Attention · 3/4','Attention · 4/4']);}
// Parts shortened apart get one base (the base is shortened once); a figure page or divider ends a run.
{const p=cards(['Factor Tests on Sorted Portfolios','a'],['Factor Tests (cont.)','a'],['Factor Tests · Figures','a',{figurePage:true}],['Next','b']);
 apply(p);assert.deepEqual(p.outline.slice(1,3).map(page=>page.title),['Factor Tests on Sorted Portfolios · 1/2','Factor Tests on Sorted Portfolios · 2/2']);assert.equal(p.outline[3].title,'Factor Tests · Figures');}
// A figure page of the card between its parts does not break the run (3222 deal-review p8-11).
{const p=cards(['Results','a'],['Driving Is More Stable','a',{figurePage:true}],['Results (cont.)','a'],['Results (cont.)','a'],['Next','b']);
 apply(p);assert.deepEqual(p.outline.map(page=>page.title),['Cover','Results · 1/3','Driving Is More Stable','Results · 2/3','Results · 3/3','Next']);
 assert.deepEqual(cardPartRuns(p.outline).map(run=>run.pages),[[1,3,4]]);
 assert.deepEqual(verifiedPartCounter(p,{id:'s3'},{semanticRole:'title',type:'text',content:{text:'Results · 2/3'}}),{start:7});
 // The live outline has no card ids: they come from the plan's raw slides by page id (3222 mood-board p9-11).
 {const live={...p,outline:p.outline.map(({logicalCardId,...page})=>page),planningContract:{...p.planningContract,cardOutline:{raw:{slides:p.outline.map(page=>({id:page.id,logicalCardId:page.logicalCardId}))}}}};
  assert.deepEqual(verifiedPartCounter(live,{id:'s3'},{semanticRole:'title',type:'text',content:{text:'Results · 2/3'}}),{start:7});
  assert.equal(numberCardParts(live).titles.size,0,'the numbered run is kept');}
 // Another card's figure page is no bridge.
 const q=cards(['Results','a'],['Other Figure','b',{figurePage:true}],['Results (cont.)','a']);apply(q);assert.deepEqual(q.outline.map(page=>page.title),['Cover','Results','Other Figure','Results (cont.)']);}
// A separate translation and the title pair carry the same counter.
{const p=cards(['因子检验','a',{titleSecondary:'Factor Tests',titlePair:{primary:'因子检验',secondary:'Factor Tests'}}],['因子检验（续）','a',{titleSecondary:'Factor Tests (cont.)',titlePair:{primary:'因子检验（续）',secondary:'Factor Tests (cont.)'}}]);
 p.inputUnderstanding.primaryLanguage='zh';apply(p);
 assert.deepEqual([p.outline[2].title,p.outline[2].titleSecondary,p.outline[2].titlePair.primary,p.outline[2].titlePair.secondary],['因子检验 · 2/2','Factor Tests · 2/2','因子检验 · 2/2','Factor Tests · 2/2']);
 assert.equal(p.outline[1].titleSecondary,'Factor Tests · 1/2');}

// 3. Against the title slot: every part shows its counter; a base that does not fit with it is cut once at a word boundary.
{const IN=914400,spec={slots:[{role:'title',shapeId:2,maxLines:1}],nodes:[{id:'t',type:'text',nativeRef:{shapeId:2,contractVersion:2},nativeTextFrame:{wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}},geometry:{x:IN,y:IN/2,width:6*IN,height:.6*IN},style:{fontSizePt:26,fontFamily:'Arial',lineHeight:1},content:{text:'x'}}]};
 const slotted=(...pages)=>({...cards(...pages),templateFidelity:{mode:'preserve',slides:Array(pages.length+1).fill(spec)}});
 const probe=slotted(['x','a']);let base='Factor';for(const word of 'Tests on Sorted Size and Value Portfolios Across Markets'.split(' ')){const next=base+' '+word;if(!cardTitleFits(probe,1,{title:next}))break;base=next;}
 assert.ok(cardTitleFits(probe,1,{title:base})&&!cardTitleFits(probe,1,{title:base+' Tests'}));
 // A base that fits only without its counter is trimmed at a word boundary so every part shows it
 // (Fable 2026-11-02, superseding 10-27's "the counter never costs a word": identical titles read as a duplicated slide).
 assert.ok(!cardTitleFits(probe,1,{title:numberedTitle(base,1,2)}),'the fixture base fits only without its counter');
 {
  const p=slotted([base,'a'],[base+' (cont.)','a']),notes=apply(p);
  assert.deepEqual(p.outline.slice(1).map(page=>page.title),['Factor Tests · 1/2','Factor Tests · 2/2'],'cut before "on", never on a dangling word');
  assert.deepEqual(notes.map(note=>note.code),['card_title_truncated']);
  assert.deepEqual(inspectCardContinuations({...p,deck:{slides:p.outline.map(page=>({id:page.id,title:page.title,nodes:[]}))}}),[]);
 }
 const long=base+' And Their Long Tails';
 const p=slotted([long,'a'],[long+' (cont.)','a']),notes=apply(p);
 assert.deepEqual(notes.map(note=>note.code),['card_title_truncated']);
 assert.equal(unmarked(p.outline[1].title),unmarked(p.outline[2].title),'one base on every part');
 assert.ok(/ · 1\/2$/u.test(p.outline[1].title)&&/ · 2\/2$/u.test(p.outline[2].title)&&p.outline.slice(1).every((page,k)=>cardTitleFits(p,k+1,page)),JSON.stringify(p.outline.map(page=>page.title)));
 // A numbered run passes the final check.
 assert.deepEqual(inspectCardContinuations({...p,deck:{slides:p.outline.map(page=>({id:page.id,title:page.title,nodes:[]}))}}),[]);
 // No phrase-boundary cut fits: the card's topic title, whole and unused, takes the counter (Fable 2026-11-02 Q2; 3222 mood-board p6-8).
 const nouns='Factor Model Portfolio Return Summary Statistics Table Overview';
 {const q=slotted([nouns,'a'],[nouns+' (cont.)','a']);q.planningContract.logicalCards=[{id:'a',title:'Factor Tests'}];
  assert.deepEqual(apply(q).map(note=>note.code),['card_title_truncated']);assert.deepEqual(q.outline.slice(1).map(page=>page.title),['Factor Tests · 1/2','Factor Tests · 2/2']);}
 // A part's title cut inside another part's phrase is no base ("Full World (cont.)", 3222 mood-board p9-11).
 {const whole='Full World Model Results and Parameter Counts';const q=slotted([whole,'a'],['Full World (cont.)','a']);
  apply(q);assert.ok(!q.outline.slice(1).some(page=>/^Full World(?: ·|$)/u.test(page.title)),JSON.stringify(q.outline.map(page=>page.title)));}
 // The retitle pass refuses a split card's unchanged title that does not fit with its counter, with its limit for the retry (3222 portfolio p7-8).
 {const {retitleItems,acceptRetitles}=await import('./lib/ppt-card-retitle.mjs');
  const q=slotted([nouns,'a',{keyPoints:[{text:'x'}]}],[nouns,'a',{keyPoints:[{text:'y'}]}]),r={slides:q.outline},items=retitleItems(q,r);
  const reply=acceptRetitles(q,r,items,{titles:[{item:1,title:nouns}]});
  assert.deepEqual(reply.refused.map(entry=>entry.reason),['slot']);assert.ok(reply.refused[0].limit>=8&&reply.refused[0].limit<nouns.length,JSON.stringify(reply.refused));}
 // A title refused for another reason still leaves the split card its exact-limit retry; a table row's label is among its words (3222 mood-board p9-10).
 {const {retitleItems,acceptRetitles}=await import('./lib/ppt-card-retitle.mjs');
  const q=slotted([nouns,'a',{keyPoints:[{text:'906 ± 21',label:'FULL WORLD MODEL',rowLabel:true}]}],[nouns,'a',{keyPoints:[{text:'632 ± 251',label:'V MODEL',rowLabel:true}]}]),r={slides:q.outline},items=retitleItems(q,r);
  assert.deepEqual(items[0].points,['FULL WORLD MODEL: 906 ± 21','V MODEL: 632 ± 251']);
  const reply=acceptRetitles(q,r,items,{titles:[{item:1,title:'Memory Raises Scores'}]});
  assert.ok(reply.refused[0].reason.startsWith('words:'),JSON.stringify(reply.refused));
  assert.equal(reply.refused.at(-1).reason,'slot');assert.ok(reply.refused.at(-1).limit>=8);}
 // The deck check flags a split part that repeats its title past the card's figure pages without a counter (3222 deal-review p6/p9).
 {const d=cards(['Results','a'],['Driving Is More Stable','a',{figurePage:true}],['Results','a'],['Next','b']);
  const issues=inspectCardContinuations({...d,deck:{slides:d.outline.map(page=>({id:page.id,title:page.title,nodes:[]}))}});
  assert.deepEqual(issues.map(issue=>[issue.code,issue.slideId]),[['continuation_marker_omitted','s3']]);}
 // ... unless another page already shows it: unnumbered, flagged.
 {const q=slotted([nouns,'a'],[nouns+' (cont.)','a'],['Factor Tests','b']);q.planningContract.logicalCards=[{id:'a',title:'Factor Tests'}];
  assert.deepEqual(apply(q).map(note=>note.code),['continuation_marker_omitted']);assert.ok(!/·/u.test(q.outline[1].title)&&q.outline[1].title===q.outline[2].title);}}

// 4. The number gate reads the counter as navigation only when the outline's run verifies it.
{const p=cards(['Attention · 1/2','a'],['Attention · 2/2','a'],['Summary','b']);
 const node=text=>({semanticRole:'title',type:'text',content:{text}});
 assert.deepEqual(verifiedPartCounter(p,{id:'s2'},node('Attention · 2/2')),{start:9});
 assert.equal(verifiedPartCounter(p,{id:'s2'},node('Attention · 2/3')),null,'n is the run length');
 assert.equal(verifiedPartCounter(p,{id:'s3'},node('Summary · 3/3')),null,'a page outside a run');
 assert.equal(verifiedPartCounter(p,{id:'s2'},{...node('Attention · 2/2'),semanticRole:'body'}),null,'titles only');
 const broken=cards(['Attention · 1/2','a'],['Other · 2/2','a']);assert.deepEqual(cardPartRuns(broken.outline),[],'parts share one base');}

// 5. A finished part whose counter changed is patched in place, not drafted again (Fable 2026-10-27, option A).
{const slide={id:'s1',title:'Attention · 1/2',titlePair:{primary:'Attention · 1/2'},nodes:[{semanticRole:'template-title',content:{text:'Attention · 1/2'}},{semanticRole:'body',content:{text:'Step · 1/2'}}]};
 const patched=patchPartCounter(slide,'Attention · 1/2','Attention · 1/3');
 assert.deepEqual([patched.title,patched.titlePair.primary,patched.nodes[0].content.text,patched.nodes[1].content.text],['Attention · 1/3','Attention · 1/3','Attention · 1/3','Step · 1/2']);
 assert.equal(patchPartCounter(slide,'Attention · 1/2','Attn · 1/3'),null,'a new base is a new draft');
 assert.equal(patchPartCounter({...slide,nodes:[]},'Attention · 1/2','Attention · 1/3'),null,'nothing shown to patch');}

console.log('selftest-ppt-part-counter: ok');

// Live d1 pages 15/16 lost the continuation marker in a narrow title slot.
{const p=cards(['Architecture Guidance for Low SNR','a'],['Architecture Guidance for Low SNR','a']);apply(p);
 assert.deepEqual(p.outline.slice(1).map(page=>page.title),['Architecture Guidance for Low SNR · 1/2','Architecture Guidance for Low SNR · 2/2']);}
{const p=cards(['Same title','a'],['Same title','b']);apply(p);
 assert.deepEqual(p.outline.slice(1).map(page=>page.title),['Same title','Same title'],'distinct cards are not silently grouped');}
