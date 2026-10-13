import assert from 'node:assert/strict';
import {nativeTextStyleOverrides,textParagraphs} from './lib/ppt/render-contract.mjs';
const node={kind:'text',content:{text:'Heading: body',paragraphs:[{label:'Heading',body:'body'}]},style:{fontSizePt:28},nativeTextFrame:{paragraphs:[{runs:[{text:'Heading',fontSizePt:24,bold:true},{text:': body',fontSizePt:16,bold:false}]}]}};
assert.deepEqual(nativeTextStyleOverrides(node),{});assert.deepEqual(textParagraphs(node)[0].runs.map(r=>r.fontSizePt),[24,16]);
const edited={...node,nativeStyleBaseline:{fontSizePt:24},style:{fontSizePt:28}};
assert.equal(nativeTextStyleOverrides(edited).fontSizePt,28);assert.deepEqual(textParagraphs(edited)[0].runs.map(r=>r.fontSizePt),[28,28]);
const restored={...edited,style:{fontSizePt:24}};assert.deepEqual(textParagraphs(restored)[0].runs.map(r=>r.fontSizePt),[24,16]);
console.log('PASS: mixed native hierarchy is preserved; an actual object style change applies uniformly and restoring baseline restores native run sizes.');
