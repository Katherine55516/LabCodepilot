import {fitComponents} from './lib/ppt-density-capacity.mjs';
import {richTextContent} from './lib/ppt-rich-text.mjs';
import {splitCardPage} from './lib/ppt-outline-cards.mjs';
import {candidateFit} from './lib/ppt-density-packing.mjs';
import assert from 'node:assert/strict';
import {fitCardFigures,placeCardFigures,legibleBeside} from './lib/ppt-card-figure-layout.mjs';
import {placeScheduledCardFigures,bindThemeCardPage} from './lib/ppt-card-pages.mjs';
import {contentCanvas,INCH} from './lib/ppt-density-capacity.mjs';
const image={id:'figure',width:1200,height:600,caption:'Figure 1. The source chart.',dataUrl:'data:image/png;base64,AA=='};
const p={pages:3,source:{images:[image]},outline:[{id:'cover'},{id:'card',title:'Results'},{id:'end'}],templateFidelity:{mode:'preserve',width:12*INCH,height:6.75*INCH,slides:[{}, {}, {}]},templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111'}}};
const components=Array.from({length:3},(_,k)=>({type:'text',content:{text:'Point '+k+' explains the source finding.'}}));
const page={...p.outline[1],sourceImageIds:['figure']},fit=fitCardFigures(p,1,page,components);
assert.ok(fit?.fit.capacity_ok);assert.ok(fit.fit.fontSizePt>contentCanvas(p,1).fontSizePt,'three short points grow on a sparse page');
// One column of points and the figure on one top line (the user, 2026-10-31: World Models p2 was ragged).
{const text=fit.fit.boxes.slice(0,3);assert.equal(new Set(text.map(box=>box.x)).size,1,'one column');assert.equal(Math.min(...text.map(box=>box.y)),fit.fit.boxes[3].y,'text and figure share a top line');}
assert.equal(fit.components.filter(c=>c.type==='image').length,1);
const picture=fit.fit.boxes[3],caption=fit.fit.boxes[4];assert.ok(picture.width>=2.2*INCH);assert.ok(caption.y>=picture.y+picture.height);
assert.equal(fit.fit.measurements[4].fontBasis,'figure_caption');
const long=Array.from({length:6},()=>({type:'text',content:{text:'A complete source condition needs explanation in this measured column. '.repeat(7)}}));
assert.equal(fitCardFigures(p,1,page,long),null,'dense text stays on its page; the picture must remain on a figure page');
assert.equal(fitCardFigures(p,1,{...page,sourceImageIds:['missing']},components),null);
const raw={slides:[{id:'cover',title:'Deck'},{id:'card',title:'Results',cardObjects:[],keyPoints:components.map(c=>({text:c.content.text,refs:[]}))},{id:'figure-page',title:'Results · Figures',figurePage:true,restoredFrom:'card',sourceImageIds:['figure'],keyPoints:[]},{id:'end',title:'Closing',cardFrame:'takeaway'}]};
const base=()=>({...p,pages:4,outline:raw.slides,templateFidelity:{...p.templateFidelity,slides:[{},{},{},{}]}});
const inlineProject=base(),placed=placeScheduledCardFigures(inlineProject,raw,()=>{});
assert.equal(placed.slides.length,3);assert.equal(placed.slides[1].cardFigureLayout,true);
assert.deepEqual(placed.slides.flatMap(s=>s.sourceImageIds||[]),['figure'],'source image appears exactly once');
const native=placeCardFigures(base(),raw,{reschedule:()=>{},isNative:()=>true,components:()=>components});assert.deepEqual(native.slides.map(({figureOnlyReason,figureOnlyDetail,...page})=>page),raw.slides,'native slot cards retain their figure page');assert.ok(native.slides[2].figureOnlyReason,'with its reason');
const rejected=base(),prior=rejected.templateFidelity;
const unfit=placeCardFigures(rejected,raw,{reschedule:trial=>{trial.templateFidelity.width=2*INCH;},isNative:()=>false,components:()=>components});
assert.deepEqual(unfit.slides.map(({figureOnlyReason,figureOnlyDetail,...page})=>page),raw.slides);assert.equal(rejected.templateFidelity,prior,'a rejected reschedule does not mutate the original frame');
const slide={id:'card',title:'Results',nodes:[]};bindThemeCardPage(inlineProject,slide,1,placed.slides[1]);
assert.equal(slide.nodes.filter(n=>n.sourceArtifact?.type==='SourceImage').length,1);
assert.equal(slide.nodes.filter(n=>n.sourceArtifact?.type==='SourceImageCaption').length,1);
console.log('PASS measured inline figures: sparse fit, dense fallback, one column grown on a sparse page and top-aligned with its figure, full caption and minimum image width');

assert.equal(candidateFit(placed.slides[1],inlineProject,1).capacity_ok,true,'confirmation measures the same inline layout');
const fallback=splitCardPage(inlineProject,placed,1,{figureFallback:true});
assert.ok(fallback);assert.equal(fallback.raw.slides[1].inlineFigureFallback,true);
assert.deepEqual(fallback.raw.slides.flatMap(s=>s.sourceImageIds||[]),['figure'],'fallback never duplicates or drops images');
assert.deepEqual(fallback.raw.slides[1].keyPoints,placed.slides[1].keyPoints,'fallback preserves every reviewed point');
const again=placeScheduledCardFigures({...inlineProject,outline:fallback.raw.slides},fallback.raw,()=>{});
assert.deepEqual(again.slides,fallback.raw.slides,'a capacity fallback cannot oscillate back into the same inline layout');

// Live world_models p16: fit height was true but an inline formula exceeded
// the narrow point column. A layout cannot hide this final width failure.
const mathPoints=Array.from({length:4},(_,k)=>({type:'text',content:richTextContent(k===2?'Train M to model $P(x , r , a , d |x , a , h )$; train C to optimize rewards in M':'A complete source condition needs a clear explanation.')}));
const measured=fitComponents(mathPoints,p,1,{canvas:{...contentCanvas(p,1).geometry,width:3.8*INCH}});
assert.ok(!measured.capacity_ok||measured.measurements.every(m=>!m.overflow),'a height-only fit must not override inline math width');

// Retry must not pass SourceImage IDs to the text/table source binder.
{const {_internals:api}=await import('./lib/ppt-api.mjs');const {bindSourceMedia}=await import('./lib/ppt-source-artifacts.mjs');
 const retry={...structuredClone(p),id:'retry-figures',planningContract:{version:3,flow:'cards'},source:{images:[image],semantic:{inventory:{items:[],relationships:[]},evidenceAtoms:[]}},pages:3,outline:[{id:'cover',title:'Cover'},{id:'fig',title:'Results',figurePage:true,sourceImageIds:['figure'],sourceUnitIds:[]},{id:'end',title:'Closing'}],nodes:{},runtime:{slides:{}},planning:{slidePlan:[]}};
 retry.templateFidelity.slides=retry.templateFidelity.slides.map(s=>({...s,nodes:[],slots:[]}));retry.templateFidelity.slideMap=[0,1,2];retry.confirmedOutline={version:1,titlesFrozen:true};retry.deck={slides:retry.outline.map(s=>({...s,nodes:[],nodeOrder:[]}))};
 const fig=retry.deck.slides[1];bindSourceMedia(retry,fig,['figure'],1);retry.nodes.fig={status:'done',slide:fig};
 assert.doesNotThrow(()=>api.revalidateCompletedCopy(retry));
 assert.equal(retry.nodes.fig.status,'done');assert.equal(retry.nodes.fig.slide.nodes.filter(n=>n.type==='image').length,1);
}

// The legibility floor beside points (Fable 2026-11-02, World Models p3): a
// diagram's measured text is ≥7 pt at its placed width; unread vector text
// needs 1.75× its printed size; a raster diagram 40% of the content width;
// photos are exempt.
{const pt=72*12700,wide=10*pt;
 assert.equal(legibleBeside({role:'diagram',figureText:{source:'ocr',share:.0125}},4.4*pt,wide),false,'Figure 4 at the 4.4 in column: ~4 pt');
 assert.equal(legibleBeside({role:'diagram',figureText:{source:'ocr',share:.0125}},8*pt,wide),true);
 assert.equal(legibleBeside({role:'diagram',figureText:{source:'glyphs',share:.0445}},2.3*pt,wide),true,'Figure 6 (9.96 pt glyphs) still fits beside');
 assert.equal(legibleBeside({role:'diagram',figureText:{source:'ocr_unread',boxWidthPt:245.56}},4.4*pt,wide),false,'unread vector text below 1.75×');
 assert.equal(legibleBeside({role:'diagram',figureText:{source:'ocr_unread',boxWidthPt:200}},5*pt,wide),true);
 assert.equal(legibleBeside({role:'diagram',figureText:{source:'ocr_failed'}},3*pt,wide),false,'a raster diagram under 40% of the width');
 assert.equal(legibleBeside({role:'source_content'},2*pt,wide),true,'photos and game frames are exempt');
 assert.equal(legibleBeside({role:'source_content',continuousTone:false},1.8*pt,wide),false,'a raster line drawing is held like a diagram (Fable 2026-11-02)');
 assert.equal(legibleBeside({role:'source_content',continuousTone:true},1.8*pt,wide),true);}
console.log('PASS inline figures: legibility floor beside points');
