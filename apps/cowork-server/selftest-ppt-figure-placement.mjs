// Captioned figures never fail a deck (Fable F1-F4, 2026-10-27, world_models.pdf:
// eight figures on one card failed generation with source_media_capacity). A
// card holds at most two figures (a wide one counts as two); the rest go to
// later cards citing the same text, else to figure pages right after the card;
// appendix figures are optional below the full length; a page that still cannot
// fit its figures shows them scaled instead of throwing.
import assert from 'node:assert/strict';
import {assignSourceImages} from './lib/ppt-card-outline.mjs';
import {bindSourceMedia} from './lib/ppt-source-artifacts.mjs';
import {optionalFigureNotes} from './lib/ppt-card-language.mjs';
import {cardTitleFits} from './lib/ppt-card-pages.mjs';
import {verifiedFigurePageMarker} from './lib/ppt-source-numbers.mjs';

const image=(id,ref,extra={})=>({id,type:'image',required:true,role:'diagram',width:400,height:400,caption:`Figure ${id}. A figure.`,sourceRefs:[ref],dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=',...extra});
// A card citing page s1 cites u1, the paragraph that names the figures (below the full length only named figures are shown, the user 2026-10-31).
const card=(id,title,refs=[])=>({id,title,section:'Body',logicalCardId:'card_'+id,keyPoints:[{text:'A point.',refs,sourceUnitIds:refs.includes('s1')?['u1']:[]}],cardObjects:[]});
const project=(images,preset='standard')=>({generationPolicy:{language:{mode:'output',locale:'en'}},planningContract:{pagePreference:{preset}},
 source:{images,semantic:{inventory:{items:[{id:'u1',text:Array.from({length:12},(_,k)=>`Figure ${k+1}`).join(', ')+' show the model.',source_ref:['s1'],sectionPath:['Paper','2. Model']},{id:'u9',source_ref:['s9'],sectionPath:['Paper','A. Appendix']}]}}}});

// A card citing five figures keeps two; three go to two figure pages right after it (full length).
{const p=project([1,2,3,4,5].map(k=>image(String(k),'s1')),'full');
 const raw={slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1']),card('b','Results')],notes:[]};
 const out=assignSourceImages(p,raw),titles=out.slides.map(slide=>slide.title);
 assert.deepEqual(titles,['Deck','Agent Model','Agent Model · 2','Agent Model · 3','Results'],'figure pages follow their card; a caption that names nothing ("A figure.") leaves the card title, numbered (N6): '+JSON.stringify(titles));
 assert.deepEqual(out.slides.map(slide=>slide.sourceImageIds||[]),[[],['1','2'],['3','4'],['5'],[]]);
 assert.ok(out.slides.filter(slide=>slide.figurePage).every(slide=>slide.restoredFrom==='a'&&!slide.keyPoints.length));
 assert.ok(out.notes.some(note=>note.code==='figure_pages_added'&&/2 figure pages added for 3 captioned figures/u.test(note.message)));}
// Two figures share a figure page only while each one's own text reads at
// 7 pt there (Fable 2026-11-02, World Models Figures 4 and 8); a figure split
// off for that reason keeps its own page, at every length (the user's review:
// a pointer to the notes is no complete display).
{const small={figureText:{source:'ocr',share:.0125}},images=()=>[image('1','s1'),image('2','s1'),image('3','s1',small),image('4','s1')];
 const raw=()=>({slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 const standard=assignSourceImages(project(images()),raw());
 assert.deepEqual(standard.slides.filter(slide=>slide.figurePage).map(slide=>slide.sourceImageIds),[['3'],['4']],'figure 3 stands alone and figure 4 keeps a page');
 assert.ok(!standard.notes.some(note=>note.code==='figure_pages_capped'),'nothing goes to the notes');
 const {sourceImageComponents}=await import('./lib/ppt-density-capacity.mjs');
 assert.equal(sourceImageComponents(images()[2],'Figure 4: see notes')[1].content.text,'Figure 3. A figure.\nFigure 4: see notes','a caption may still carry a notes pointer');
 const legible=assignSourceImages(project([image('1','s1'),image('2','s1'),image('3','s1',{figureText:{source:'glyphs',share:.0445}}),image('4','s1')]),raw());
 assert.deepEqual(legible.slides.filter(slide=>slide.figurePage).map(slide=>slide.sourceImageIds),[['3','4']],'legible figures still share a page');}
// Figure cards (Fable M4, 2026-11-02): on an uploaded template (in its dark
// panel or its accent), two or three figures on a figure page are headed by the citing
// point's label, else a short caption lead, else all by their numbers.
{const {figurePills}=await import('./lib/ppt-density-packing.mjs');
 const dark=images=>({...project(images),templateFidelity:{mode:'preserve'},templateSpec:{palette:{panel:'#2e2f23'}},outline:[{id:'own',keyPoints:[{label:'Mental Model',text:'Mental Model: the brain keeps a model.',refs:['s1']}]}]});
 const a=image('1','s1',{caption:'Figure 1. A world model, from a comic.'}),b=image('2','s2',{caption:'Figure 2. Dream racing in a learned world.'}),c=image('3','s3',{caption:'Figure 3. What we see is based on the prediction our brain makes of the future.'});
 assert.deepEqual(figurePills(dark([a,b]),{figurePage:true,restoredFrom:'own',sourceImageIds:['1','2']}),['Mental Model','Dream Racing'],'the citing label first, then the caption lead to its first clause');
 assert.deepEqual(figurePills(dark([a,c]),{figurePage:true,restoredFrom:'own',sourceImageIds:['1','3']}),['Figure 1','Figure 3'],'a long lead falls back, and then every figure takes its number');
 assert.equal(figurePills(project([a,b]),{figurePage:true,sourceImageIds:['1','2']}),null,'a built-in template keeps plain figure pages');
 assert.equal(figurePills(dark([a]),{figurePage:true,sourceImageIds:['1']}),null,'a single figure keeps the page title');}
// A wide figure counts as two: a card holds one wide figure, the next goes on.
{const p=project([image('w','s1',{width:800,height:300}),image('n','s1')]);
 const out=assignSourceImages(p,{slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 assert.deepEqual(out.slides.map(slide=>slide.sourceImageIds||[]),[[],['w'],['n']],'one wide figure fills a card');}
// A figure page has no points: landscape figures share it; a very wide chart stands alone.
{const p=project(['w1','w2','w3'].map(id=>image(id,'s1',{width:800,height:400})));
 const out=assignSourceImages(p,{slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 assert.deepEqual(out.slides.map(slide=>slide.sourceImageIds||[]),[[],['w1'],['w2','w3']],'two landscape figures share a figure page');
 const wide=assignSourceImages(project(['v1','v2','v3'].map(id=>image(id,'s1',{width:900,height:300})),'full'),{slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 assert.deepEqual(wide.slides.map(slide=>slide.sourceImageIds||[]),[[],['v1'],['v2'],['v3']],'a very wide chart stands alone');}
// On a preserve template a card page shows no figure (Fable option A): every figure
// goes to figure pages, up to four small landscape figures a page, two portrait ones.
{const preserve=images=>({...project(images,'full'),templateFidelity:{mode:'preserve',width:12192000,height:6858000}});
 const land=assignSourceImages(preserve([1,2,3,4,5].map(k=>image('L'+k,'s1',{width:600,height:400}))),{slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 assert.deepEqual(land.slides.map(slide=>slide.sourceImageIds||[]),[[],[],['L1','L2','L3','L4'],['L5']],'the card holds none; four small landscape figures share a page');
 const tall=assignSourceImages(preserve([1,2,3].map(k=>image('T'+k,'s1',{width:300,height:600}))),{slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 assert.deepEqual(tall.slides.map(slide=>slide.sourceImageIds||[]),[[],[],['T1','T2'],['T3']],'portrait figures stop at two a page');
 const nearest=assignSourceImages(preserve([image('N','12')]),{slides:[{id:'cover',title:'Deck'},card('a','Early',['3']),card('b','Late',['9']),card('c','After',['20'])],notes:[]});
 assert.deepEqual(nearest.slides.map(slide=>slide.title),['Deck','Early','Late','Late · 2','After'],'a figure no card cites follows the card citing the nearest earlier text');}
// Every cited figure stays on the slides (the user, 2026-11-02, replacing the
// 11-01 one-figure-page cap): a card's figures beyond one figure page keep
// further pages, numbered; nothing cited goes to the notes.
{const p=project([1,2,3,4,5].map(k=>image(String(k),'s1')));
 const out=assignSourceImages(p,{slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1']),card('b','Results')],notes:[]});
 assert.deepEqual(out.slides.map(slide=>slide.title),['Deck','Agent Model','Agent Model · 2','Agent Model · 3','Results'],'every figure page stays');
 assert.deepEqual(out.slides.map(slide=>slide.sourceImageIds||[]),[[],['1','2'],['3','4'],['5'],[]]);
 assert.equal(out.optionalFigures,undefined,'no cited figure is optional');
 assert.ok(!out.notes.some(note=>note.code==='figure_pages_capped'));}
// Appendix figures are optional below the full length, required at the full length.
{const images=[image('1','s1'),image('2','s1'),image('A1','s9')],raw=()=>({slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1','s9'])],notes:[]});
 const standard=assignSourceImages(project(images),raw());
 assert.deepEqual(standard.optionalFigures,['A1'],'an appendix figure with no room is optional');
 assert.ok(!standard.slides.some(slide=>slide.figurePage),'no page is added for an optional figure');
 assert.ok(standard.notes.some(note=>note.code==='optional_figures_unplaced'&&note.message.includes('Figure A1.')));
 const notes=optionalFigureNotes({...project(images),planningContract:{cardOutline:{raw:standard}},deck:{slides:[{},{}]}});
 assert.deepEqual(notes.map(note=>[note.index,note.text]),[[1,'Figures not shown on the slides: Figure A1. A figure.']],'the closing page names it');
 const full=assignSourceImages(project(images,'full'),raw());
 assert.equal(full.optionalFigures,undefined);assert.deepEqual(full.slides.at(-1).sourceImageIds,['A1'],'at the full length it gets a figure page');}

// A labelled block keeps its label beside a figure (live Blue, 2026-11-02:
// scores beside Figure 13 lost their method names).
{const images=[image('9','s1',{width:1600,height:900,caption:'Figure 9. A figure.'})];
 const p={...project(images),pages:3,outline:[{id:'c'},{id:'p'},{id:'e'}]};
 const slide={id:'p',title:'Scores',nodes:[],copy:{blocks:[{type:'evidence',heading:'DQN',body:'343 ± 18'},{type:'evidence',heading:'',body:'A plain point.'}]}};
 bindSourceMedia(p,slide,['9'],1);
 assert.deepEqual(slide.nodes.filter(node=>node.semanticRole==='source-explanation'&&!node.content?.sourceImageCaptionId).map(node=>node.content.text).slice(0,2),['DQN：343 ± 18','A plain point.']);}
// A page that cannot fit its figures at full size shows them scaled (F4), never throws.
// Four is the most a page is given (figurePageFits); long captions included.
{const images=[1,2,3,4].map(k=>image(String(k),'s1',{width:1200,height:1600,caption:`Figure ${k}. A tall multi-panel figure with a long caption that takes two lines of text at the body size.`}));
 const p={...project(images),pages:3,outline:[{id:'c'},{id:'p'},{id:'e'}]};
 const slide={id:'p',title:'Results',nodes:[{id:'t',type:'text',semanticRole:'source-explanation',sourceArtifact:{sourceUnitId:'u1',type:'MechanismBlock'},content:{text:'The agent learns a compact policy from the world model and transfers it back to the real environment.'},style:{fontSizePt:18}}],copy:{blocks:[]}};
 bindSourceMedia(p,slide,images.map(image=>image.id),1);
 assert.deepEqual(slide.figureScaled?.imageIds,images.map(image=>image.id),'the figures are scaled, with a note');
 const placed=slide.nodes.filter(node=>node.type==='image');
 assert.equal(placed.length,4,'every figure is on the page');
 assert.ok(placed.every(node=>Math.abs(node.geometry.width/node.geometry.height-1200/1600)<.02),'each keeps its aspect');
 const canvas=slide.sourceArtifactFit.canvas;
 assert.ok(slide.nodes.filter(node=>node.sourceArtifact).every(node=>node.geometry.y>=canvas.y&&node.geometry.y+node.geometry.height<=canvas.y+canvas.height+1),'everything stays on the canvas');}
// A figure page's title fits the template's title slot: a long card title drops
// "Figures", then its own words (live world_models.pdf: a title slot overflowed).
{const narrow={slots:[{role:'title',shapeId:5,maxLines:1,lineVisualUnits:9,fontSizePt:40}],nodes:[{id:'t',type:'text',semanticRole:'template-title',nativeRef:{shapeId:5,contractVersion:2},nativeTextFrame:{wrap:'square',autofit:'none',insets:{left:91440,right:91440,top:45720,bottom:45720}},geometry:{x:0,y:0,width:4200000,height:800000},style:{fontSizePt:40,fontFamily:'Arial',lineHeight:1},content:{text:'Title'}}]};
 const p={...project([1,2,3,4,5].map(k=>image('P'+k,'s1',{width:300,height:600})),'full'),templateFidelity:{mode:'preserve',width:12192000,height:6858000,slides:[narrow,narrow,narrow,narrow,narrow]}};
 p.source.images.push(...[6,7].map(k=>image('Q'+k,'s2',{width:300,height:600})));
 const out=assignSourceImages(p,{slides:[{id:'cover',title:'Deck'},card('a','VizDoom Take Cover Procedure',['s1']),card('b','Car Racing Experiment Results',['s2'])],notes:[]});
 const titles=out.slides.filter(slide=>slide.figurePage).map(slide=>slide.title);
 assert.equal(titles.length,4);assert.ok(titles.every(title=>cardTitleFits(p,1,{title})),'every figure page title fits the slot: '+JSON.stringify(titles));
 assert.equal(new Set(titles).size,4,'and figure pages of different cards stay distinct: '+JSON.stringify(titles));}
// A figure page's "k/n" marker is navigation for the number gate, verified against the outline.
{const p={outline:[{id:'a'},{id:'f1',figurePage:true,restoredFrom:'a'},{id:'f2',figurePage:true,restoredFrom:'a'}]},node=text=>({type:'text',semanticRole:'template-title',content:{text}});
 assert.ok(verifiedFigurePageMarker(p,{id:'f2'},node('Car Racing · 2/2')),'a matching marker is navigation');
 assert.equal(verifiedFigurePageMarker(p,{id:'f2'},node('Car Racing · 2/3')),null,'a marker with the wrong count is checked as a number');
 assert.equal(verifiedFigurePageMarker(p,{id:'a'},node('Results 1/2')),null,'a card title is not a figure page');}
// Long captions count: four landscape figures with long captions take two pages.
{const long='Figure. '+'A long multi-sentence caption that explains every panel of the figure in detail. '.repeat(3);
 const p={...project([1,2,3,4].map(k=>image('C'+k,'s1',{width:600,height:400,caption:long})),'full'),templateFidelity:{mode:'preserve',width:12192000,height:6858000}};
 const out=assignSourceImages(p,{slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 assert.deepEqual(out.slides.filter(slide=>slide.figurePage).map(slide=>slide.sourceImageIds.length),[2,2],'long captions keep two figures a page');}
console.log('PASS figure placement: two figures a card, figure pages after their card, appendix figures optional below full length, an over-full page scales its figures');
// Below the full length a labelled figure that no point names goes to the notes; full keeps it; an unlabelled image is always shown.
{const named=image('1','s1'),unnamed=image('99','s1',{caption:'Figure 99. Not named anywhere.'}),pasted=image('p','s1',{caption:''});
 const raw=()=>({slides:[{id:'cover',title:'Deck'},card('a','Agent Model',['s1'])],notes:[]});
 const std=assignSourceImages(project([named,unnamed,pasted]),raw()),shown=std.slides.flatMap(slide=>slide.sourceImageIds||[]);
 assert.ok(shown.includes('1')&&shown.includes('p')&&!shown.includes('99'),'standard shows named and unlabelled figures: '+JSON.stringify(shown));
 assert.deepEqual(std.optionalFigures,['99'],'the unnamed figure is listed for the notes');
 const full=assignSourceImages(project([named,unnamed,pasted],'full'),raw());
 assert.ok(full.slides.flatMap(slide=>slide.sourceImageIds||[]).includes('99'),'full length keeps every figure');}
console.log('PASS cited figures: below full only named figures show; unlabelled images always do');

