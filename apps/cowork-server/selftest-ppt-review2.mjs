// Second 7-input review on 3186 (Fable, 2026-11-01):
// 1 a card whose points follow a numbered source list is numbered;
// 3 a title refused only on length gets one retry with its exact limit;
// 5 PDF captions and table cells lose their line-break hyphens;
// 7 a PDF table whose first row is data is marked header-less.
import assert from 'node:assert/strict';
import {citesListRun} from './lib/ppt-outline-cards.mjs';
import {retitleRetryTask} from './lib/ppt-card-retitle.mjs';
import {mergeSourceMedia} from './lib/ppt-source.mjs';
import {mergeLayoutContinuations} from './lib/ppt-semantic.mjs';
import {headerlessRows} from './lib/ppt-content-inventory.mjs';

// 1: three points in the list's order, another point aside, is a numbered run; out of order is not.
const items=new Map([['g',{id:'g',text:'1. Collect rollouts\n2. Train the VAE\n3. Train the MDN-RNN\n4. Define the controller'}],['x',{id:'x',text:'Other prose'}]]);
const pt=(text,id)=>({text,sourceUnitIds:[id]});
assert.ok(citesListRun({points:[pt('Collect rollouts first','g'),pt('Train the VAE on frames','g'),pt('Train the MDN-RNN next','g'),pt('A note','x')]},items));
assert.ok(!citesListRun({points:[pt('Train the VAE on frames','g'),pt('Collect rollouts first','g'),pt('Train the MDN-RNN next','g')]},items));

// 3: only length and slot refusals with a usable limit are retried, each with its limit.
const task=retitleRetryTask({},[{points:['a']},{points:['b']},{points:['c']}],[{item:1,title:'A Much Too Long Title For Its Frame',reason:'slot',limit:24},{item:2,title:'Label',reason:'label'},{item:3,title:'Short',reason:'slot',limit:4}]);
assert.ok(task);const sent=JSON.parse(task.prompt.slice(task.prompt.indexOf('{"slides"'),task.prompt.indexOf('\nJSON schema=')));
assert.deepEqual(sent.slides.map(slide=>[slide.item,slide.maxCharacters,slide.maxWords]),[[1,24,3]],'an English limit in words too (3222 mood-board: the model ignored a character count)');
assert.equal(retitleRetryTask({},[],[{item:1,reason:'words:x'}]),null);

// 5: a PDF caption and a PDF table cell are de-hyphenated; a Word caption is not touched.
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
assert.equal(mergeSourceMedia({images:[{id:'a',type:'image',location:'PDF 第 9 页',caption:'A controller in- teracting with an environment',dataUrl:png}]}).images[0].caption,'A controller interacting with an environment');
assert.equal(mergeSourceMedia({images:[{id:'a',type:'image',location:'Word 段落 3',caption:'in- teracting',dataUrl:png}]}).images[0].caption,'in- teracting');
assert.equal(mergeLayoutContinuations([{id:'t',type:'table',location:'PDF 第 2 页',text:'| a | represen- tations |',sectionPath:['A'],sourceRefs:['2'],tokenCount:5}])[0].text,'| a | representations |');

// 7: a first row of data is no header; a row of labels is.
assert.ok(headerlessRows([['ViT-B/16','600','72.9'],['ViT-L/16','600','77.5']]));
assert.ok(!headerlessRows([['Method','Arch.','Top-1'],['I-JEPA','ViT-H/14','79.3']]));
assert.ok(!headerlessRows([['MODEL','PARAMETER COUNT'],['VAE','4,348,547']]));
console.log('PASS review 2: numbered runs, retitle retry limits, PDF de-hyphenation, header-less tables');
