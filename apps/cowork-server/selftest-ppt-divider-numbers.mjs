// A chapter divider lists the cards it opens; a number in a card title is
// checked on that card's page, so on the divider it reads against the whole
// deck (JEPA 2026-10-31: "1% ImageNet-1K" in a listed title blocked the deck).
import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {inspectContent} from './lib/ppt-content-qa.mjs';

const source=normalizePaste('# Results\n\nSemi-supervised evaluation uses only 1% of the available labels and reaches strong accuracy.\n\n# Discussion\n\nThe method avoids collapse by design.');
const chunk=source.segments[0]?.id;
const text=(id,value)=>({id,type:'text',semanticRole:'body',content:{text:value}});
const project={source,outline:[{id:'c0',role:'cover'},{id:'c1',role:'mechanism',chunkRefs:[chunk]},{id:'d1',cardFrame:'divider',role:'mechanism'},{id:'c2',role:'mechanism',chunkRefs:[chunk]},{id:'end',role:'closing'}],
 deck:{slides:[{id:'c0',title:'Cover',nodes:[]},
  {id:'c1',title:'Results',sourceChunks:[chunk],sourceRefs:[chunk],nodes:[text('n1','Training with 1% of labels still reaches strong accuracy.')]},
  {id:'d1',title:'Supplementary Details',nodes:[text('n2','Ablations on 1% ImageNet-1K\nCollapse avoided by design')]},
  {id:'c2',title:'Ablations',sourceChunks:[chunk],sourceRefs:[chunk],nodes:[text('n3','Ablations keep the 1% label budget.')]},
  {id:'end',title:'Thanks',nodes:[]}]}};
const issues=inspectContent(project).issues.filter(issue=>issue.code==='visible_numeric_fidelity');
assert.ok(!issues.some(issue=>issue.slideId==='d1'),'a divider listing a card title with a source number is not an unsupported number: '+JSON.stringify(issues));
project.deck.slides[2].nodes[0].content.text='Ablations on 37% ImageNet-1K';
assert.ok(inspectContent(project).issues.some(issue=>issue.code==='visible_numeric_fidelity'&&issue.slideId==='d1'),'a number no page states is still refused on a divider');
console.log('PASS divider numbers: a divider reads numbers against the deck; a number no page states is still refused');
