// Chrome slots and the no-repeat rule (the user + Fable, 2026-11-02; template
// media plan phases 4–5). A painting in an edge-touching slot spanning a
// quarter of the slide is the frame's style on every page; it is shown once,
// again only 5+ pages later, at most twice; otherwise its slot becomes a flat
// panel in the template's dark colour (never an empty slot), recorded in the
// page's omissions and written by the template exporter.
import assert from 'node:assert/strict';
import {chromePlan,chromeSlot,repeatedChrome,applyChromeFallback,solidPng,chromeColour,paintingUseLimit} from './lib/ppt-chrome-slots.mjs';
import {isSourceOwnedNode} from './lib/ppt-source-artifacts.mjs';

const W=12192000,H=6858000,size={width:W,height:H};
const g=(x,y,w,h)=>({x:x*W,y:y*H,width:w*W,height:h*H});
assert.equal(chromeSlot({geometry:g(0,0,1,.3)},size),true,'a top band');
assert.equal(chromeSlot({geometry:g(0,0,.39,1)},size),true,'a half-bleed panel');
assert.equal(chromeSlot({geometry:g(.07,.28,.41,.41)},size),false,'a picture inside the content area is a content slot');
assert.equal(chromeSlot({geometry:g(.02,.02,.38,.96)},size),true,'a side painting set 2% in is still chrome');
assert.equal(chromeSlot({geometry:g(.03,.067,.33,.87)},size),true,'a tall sidebar picture 0.4 in from the edge is the frame');
assert.equal(chromeSlot({geometry:g(.3,.2,.4,.6)},size),false,'a large picture in the middle is a content slot');
assert.equal(chromeSlot({geometry:g(0,.9,.1,.1)},size),false,'a small corner picture is not chrome');

// A deck of 8 pages alternating two frames with the same band painting.
const tone={continuousTone:true,flat:0,top4:.17,edges:0},ocr={status:'ok',engine:'tesseract.js',outcome:'no_text'};
const band={type:'image',nativeRef:{shapeId:2},geometry:g(0,0,1,.3),content:{imageSha256:'paint-A',ocr,pixels:tone,dataUrl:'data:image/png;base64,AA'}};
const frame=()=>({nodes:[structuredClone(band)],slots:[]});
const project={id:'p',pages:8,templateFidelity:{mode:'preserve',width:W,height:H,slides:Array.from({length:8},frame),slideMap:[0,1,1,1,1,1,1,1]},
 templateSpec:{palette:{background:'#ecefdc',foreground:'#2f3026',accent:'#6b7d5c'}},deck:{slides:[]}};
assert.deepEqual(repeatedChrome(project,0),[],'the first use is free');
// Since 2026-11-03 (the user, Deal-Review p5/p18): with no other painting of
// its size, a painting repeats instead of giving way to a flat panel.
assert.deepEqual([0,1,2,3,4,5,6,7].map(k=>repeatedChrome(project,k).length),[0,0,0,0,0,0,0,0],'never a panel');
const slide={id:'s1',nodes:[{id:'n',type:'image',nativeRef:{shapeId:2},geometry:band.geometry,content:{imageSha256:'paint-A'}},{id:'t',type:'text',content:{text:'x'}}]};
assert.deepEqual(applyChromeFallback(project,slide,1),[],'the painting stays');assert.ok(slide.nodes.some(node=>node.id==='n'));
// The panel helpers stay for a template with no painting data.
const bytes=Buffer.from(solidPng('#2f3026',256,77).split(',')[1],'base64');
assert.equal(bytes.subarray(1,4).toString(),'PNG');
assert.equal(chromeColour(project),'#2f3026','the darkest palette colour');
// A second use waits for the size class (Fable 2026-11-02): while another
// painting of that size is still unshown on content pages, page 6 shows a
// panel; paintings on the cover's and the closing's frames are reserved.
{const other={...structuredClone(band),content:{...structuredClone(band.content),imageSha256:'paint-B'}};
 const withPool=catalog=>({...project,templateFidelity:{...project.templateFidelity,sourceCatalog:catalog}});
 // Since 2026-11-03 (the user: template media that could apply must not vanish)
 // the unshown paint-B takes the slot instead of a panel; the two then
 // alternate under the five-page gap.
 const pooled=withPool([{nodes:[]},frame(),{nodes:[other],slots:[]}]);
 assert.deepEqual([0,1,2,3,4,5,6,7].map(k=>repeatedChrome(pooled,k).length),[0,0,0,0,0,0,0,0],'paint-B takes page 1; then A and B repeat, never a panel');
 const shownSeq=[0,1,2,3,4,5,6,7].map(k=>chromePlan(pooled,k)[0].show.content.imageSha256);
 assert.deepEqual(shownSeq.slice(0,2),['paint-A','paint-B'],'the unused painting first');
 assert.ok(shownSeq.every((hash,k)=>!k||hash!==shownSeq[k-1]),'no painting on two pages in a row while another is free: '+shownSeq.join(','));
 {const rotated={...structuredClone(project),templateFidelity:{...pooled.templateFidelity,sourceCatalog:[{nodes:[]},frame(),{nodes:[{...other,content:{...other.content,dataUrl:'data:image/png;base64,AAAA',width:400,height:100}}],slots:[]}]}};
  const page={id:'s2',nodes:[{id:'n',type:'image',nativeRef:{shapeId:2},geometry:band.geometry,content:{imageSha256:'paint-A',nativeMaskXml:'<mask/>'}}]};
  assert.deepEqual(applyChromeFallback(rotated,page,1),[2]);
  const swap=page.nodes.find(node=>node.id==='n');
  assert.ok(swap.content.imageSha256==='paint-B'&&swap.content.mediaReplacement&&swap.content.borrowedPicture,'another painting of the template in the slot\'s own picture');
  assert.equal(swap.content.nativeMaskXml,'<mask/>','its mask and frame stay (3197 7d153b8a: an added picture lost the mask)');
  assert.ok(swap.nativeRef&&!isSourceOwnedNode(swap),'exported as the native picture, once');assert.equal(page.nodes.length,1);
  assert.deepEqual(page.chromeRotations,[{shapeId:2,from:'paint-A',to:'paint-B'}]);}
 assert.deepEqual([0,1,2,3,4,5,6,7].map(k=>chromePlan(withPool([{nodes:[other],slots:[]},frame()]),k)[0]?.show.content.imageSha256),['paint-A','paint-A','paint-A','paint-A','paint-A','paint-A','paint-A','paint-A'],'paint-B on the cover frame is reserved: paint-A repeats');}
// Long decks with few paintings (Fable 2026-11-02, Codex's 37-page Portfolio
// deck): a painting may show ceil(content pages / (5 × paintings of its size)),
// at least twice, at most three times.
{const deckOf=pages=>({outline:Array.from({length:pages},(_,k)=>({id:'p'+k}))}),pool=[{hash:'a',geometry:band.geometry}];
 assert.equal(paintingUseLimit(deckOf(8),band,pool),2);assert.equal(paintingUseLimit(deckOf(13),band,pool),3);assert.equal(paintingUseLimit(deckOf(37),band,pool),3,'never more than three');
 assert.equal(paintingUseLimit(deckOf(13),band,[...pool,{hash:'b',geometry:band.geometry}]),2,'two paintings of its size share the deck');}
assert.equal(applyChromeFallback({...project,templateFidelity:{...project.templateFidelity,mode:'builtin'}},{id:'x',nodes:[]},1).length,0,'uploaded templates only');
assert.ok(solidPng('#123456',4,2).startsWith('data:image/png;base64,'));
console.log('PASS chrome slots: edge slots keep paintings, no repeat within 5 pages or past 2 uses, flat panel instead of a gap');
