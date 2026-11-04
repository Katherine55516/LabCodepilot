// Text that cannot be seen on its background blocks a card deck where the deck
// rebuilt the text (theme and object pages; Fable 2026-10-25 and 2026-10-26; 3143 g4 page 4: a removed dark box left a white heading and a
// light description on the light slide).
import assert from 'node:assert/strict';
import {inspectTextContrast,contrastRatio} from './lib/ppt-text-contrast.mjs';
import {tierCardDeckIssues} from './lib/ppt-gate-tiers.mjs';

assert.ok(Math.abs(contrastRatio('#ffffff','#000000')-21)<.01);
assert.ok(Math.abs(contrastRatio('#ffffff','#ecf0db')-1.16)<.01,'the g4 page 4 heading on its slide');

const text=(id,color,z,y)=>({id,type:'text',zIndex:z,style:{color},geometry:{x:100,y,width:400,height:40},content:{text:'Parsimony regularization'}});
const box={id:'box',type:'shape',zIndex:5,style:{fill:'#2e2f23'},geometry:{x:80,y:80,width:440,height:120}};
const project=(nodes,mode='theme')=>({templateFidelity:{mode:'preserve',slides:[{background:'#ecf0db'}]},deck:{slides:[{id:'p4',cardPage:{mode},nodes}]}});

// On its dark box the white heading reads; with the box removed it does not.
assert.deepEqual(inspectTextContrast(project([box,text('h','#ffffff',6,100)])),[]);
const lost=inspectTextContrast(project([text('h','#ffffff',6,100)]));
assert.equal(lost.length,1);assert.equal(lost[0].code,'text_contrast_insufficient');assert.equal(lost[0].basis,'slide-background');
assert.equal(lost[0].pageMode,'theme');assert.equal(tierCardDeckIssues(lost)[0].severity,'error','an integrity block on a rebuilt card page');
assert.equal(tierCardDeckIssues(inspectTextContrast(project([text('h','#ffffff',6,100)],'native')))[0].severity,'warning','a note on a native page: the template\'s own colours');
// Dark text on the light slide reads.
assert.deepEqual(inspectTextContrast(project([text('d','#2e2f23',6,300)])),[]);
// A picture without a known panel colour is listed, not blocked; with one it is checked.
const photo={id:'photo',type:'image',zIndex:1,content:{},geometry:{x:0,y:0,width:1000,height:1000}};
const listed=inspectTextContrast(project([photo,text('t','#ffffff',6,300)]));
assert.deepEqual(listed.map(issue=>[issue.code,issue.severity]),[['text_contrast_unchecked','warning']]);
assert.equal(inspectTextContrast(project([{...photo,content:{panelColor:'#f5f5f5'}},text('t','#ffffff',6,300)]))[0].code,'text_contrast_insufficient');
// Only preserved templates are checked.
assert.deepEqual(inspectTextContrast({deck:{slides:[{id:'x',nodes:[text('h','#ffffff',6,100)]}]}}),[]);
console.log('PPT text contrast: invisible text blocks, readable text passes, unknown picture backgrounds are listed: OK');

// The source formula's own opaque white plate is the actual background.
const formula={...text('formula','#111827',6,100),style:{color:'#111827',fill:'#ffffff'},sourceArtifact:{type:'EquationBlock'}};
const purple=project([formula]);purple.templateFidelity.slides[0].background='#57068c';
assert.deepEqual(inspectTextContrast(purple),[]);
for(const style of [{color:'#111827'},{...formula.style,fillMode:'none'},{...formula.style,opacity:0.5}]){
 const negative=structuredClone(purple);negative.deck.slides[0].nodes[0].style=style;
 assert.equal(inspectTextContrast(negative)[0].code,'text_contrast_insufficient');
}
const bad=structuredClone(purple);bad.deck.slides[0].nodes[0].style.color='#ffffff';
assert.equal(inspectTextContrast(bad)[0].basis,'text-surface','own plate must still block white-on-white');
