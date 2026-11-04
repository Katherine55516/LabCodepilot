// Step, page and section numbers are navigation, not facts to check against
// the source (3143, 473472dc page 5 and 2b9803a2 page 9; from
// codex/ppt-report-completion-20261011 30f0a7c8, whose tests lived in the
// option A selftest-ppt-layout-variety).
import assert from 'node:assert/strict';
import {numericRecords,textNumberFailures} from './lib/ppt-source-numbers.mjs';
assert.deepEqual(['Steps 3–4','第 3–4 步'].map(label=>numericRecords(label,'template-text').length),[0,0],'step labels are navigation, not facts');
assert.equal(numericRecords('3 weak alphas','template-text').length,1,'a number in a claim is still checked');
assert.deepEqual(['Step 1 audits data; steps 2–3 evaluate IC','Steps 4-6 check costs','steps 2 and 3 run','steps 2, 3 run','先做第 2–3 步','see section 4','第 2 节'].map(text=>numericRecords(text,'template-text').length),[0,0,0,0,0,0,0],'step and section references inside a sentence');
assert.deepEqual(['steps 2–3% of cases','2–3 days','step 4 of 8 alphas'].map(text=>numericRecords(text,'template-text').map(record=>record.value)),[['3'],['2','3'],['8']],'a percentage, a count or a later quantity is still checked');
assert.deepEqual(['字段：goal（第2–3页）','see pages 2–3'].map(text=>numericRecords(text,'template-text').length>0),[true,true],'a page range stays checked: it must point at real pages (7d761cde)');
// A table read without its header holds a data row in the header position:
// its numbers are still input (JEPA PDF, 2026-10-31: 72.9 blocked the deck).
{const table='| ViT-B/16 | 600 | 72.9 |\n| ViT-L/16 | 600 | 74.8 |';
 const project={source:{text:'Linear probing results.\n'+table,segments:[],semantic:{inventory:{items:[{id:'b_0001',type:'TableBlock',text:table,rows:[['ViT-B/16','600','72.9'],['ViT-L/16','600','74.8']]}]}}}};
 assert.deepEqual(textNumberFailures(project,'ViT-B/16 · 600 · 72.9').map(failure=>failure.raw),[],'a first-row value is supported');
 assert.deepEqual(textNumberFailures(project,'ViT-B/16 reaches 12.34').map(failure=>failure.raw),['12.34'],'an invented value is still refused');}
console.log('PASS source number labels: step, page and section references are navigation; page ranges and quantities stay checked');
