// Deck media metrics (2026-11-02, template media plan phase 1): content-page
// visual coverage, template pictures repeated across pages, and template-page
// use against the reuse cap max(2, floor(N/5)). Warnings only.
import assert from 'node:assert/strict';
import {deckMediaMetrics,deckMediaIssues,layoutReuseCap} from './lib/ppt-deck-media-metrics.mjs';

const pic=(id,sha,extra={})=>({id,type:'image',content:{imageSha256:sha,...extra},geometry:{x:0,y:0,width:10,height:10}});
const text=id=>({id,type:'text',content:{text:'x'},geometry:{x:0,y:0,width:10,height:10}});
const slides=[
 {id:'s0',nodes:[pic('hero','A')],nativeSlideIndex:0},                       // cover (frame page)
 {id:'s1',nodes:[text('t'),pic('band','B')],cardPage:{mode:'theme',templatePage:4}},
 {id:'s2',nodes:[text('t')],cardPage:{mode:'theme',templatePage:4}},           // no visual
 {id:'s3',nodes:[text('t'),pic('fig','F',{sourceImageId:'img1'})],cardPage:{mode:'theme',templatePage:4}},
 {id:'s4',nodes:[text('t'),pic('band2','B')],cardPage:{mode:'theme',templatePage:2}}, // B repeats
 {id:'s5',nodes:[{id:'l',type:'list',content:{diagram:{kind:'card-grid'},items:[]},geometry:{x:0,y:0,width:10,height:10}}],cardPage:{mode:'theme',templatePage:4}},
 {id:'s6',nodes:[text('t')],cardPage:{mode:'theme',templatePage:4}},
 {id:'s7',nodes:[pic('end','A2')],nativeSlideIndex:7}];
const project={templateFidelity:{mode:'preserve'},outline:slides.map((s,k)=>({id:s.id,...(k===7?{role:'closing'}:{})})),deck:{slides}};
const m=deckMediaMetrics(project);
assert.equal(m.contentPages,6,'cover and closing are frame pages');
assert.equal(m.withVisual,4);assert.equal(m.withContentVisual,2,'a source figure and a diagram are content visuals; a band is chrome');
assert.deepEqual(m.pagesWithoutVisual,[3,7]);
assert.deepEqual(m.repeats.map(r=>r.pages),[[2,5]],'a template picture on two pages is a repeat');
assert.equal(m.cap,layoutReuseCap(8));assert.equal(m.cap,2);
assert.deepEqual(m.overCap,[{frame:4,uses:5,pages:[2,3,4,6,7]}]);
assert.deepEqual(deckMediaIssues(m).map(i=>i.code),['media_coverage_low','template_picture_repeat','layout_reuse_cap_exceeded']);
assert.ok(deckMediaIssues(m).every(i=>i.severity==='warning'),'never blocking');
assert.equal(deckMediaMetrics({templateFidelity:{mode:'builtin'},deck:{slides}}),null,'uploaded templates only');
console.log('PASS deck media metrics: coverage, repeats, frame cap (warnings only)');
