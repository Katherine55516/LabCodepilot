// Spreadsheet decks are written cards (the user, 2026-10-31): below the full
// length a sheet table is text for the writer unless it is a small comparison;
// cards follow the rows (Fable: about one per five, at most three a sheet, the
// appendix sheet one).
import assert from 'node:assert/strict';
import {spreadsheetSource,spreadsheetCards,smallComparison,writtenTable,sheetCards,spreadsheetRule} from './lib/ppt-spreadsheet-cards.mjs';

const sheet=(rows,cols=3,cell='短')=>({id:'t',rows:[Array.from({length:cols},(_,k)=>'列'+k),...Array.from({length:rows},()=>Array.from({length:cols},()=>cell))]});
const deck=(extension,preset='standard')=>({source:{extension},planningContract:{length:{preset}}});

assert.ok(spreadsheetSource(deck('xlsx'))&&spreadsheetSource(deck('csv'))&&!spreadsheetSource(deck('docx')));
assert.ok(spreadsheetCards(deck('xlsx'))&&spreadsheetCards(deck('xlsx','quick'))&&!spreadsheetCards(deck('xlsx','full')),'below the full length only');
assert.ok(spreadsheetCards({source:{extension:'xlsx'},planningContract:{length:{exact:12}}}),'an exact page count is below full');

assert.ok(smallComparison(sheet(6,4)),'six rows and four short columns stay a table');
assert.ok(!smallComparison(sheet(7,3))&&!smallComparison(sheet(3,5))&&!smallComparison(sheet(3,2,'x'.repeat(41))));
assert.equal(writtenTable(deck('xlsx'),sheet(13)),true,'a large sheet is written as points');
// No table is drawn since the hand deck (the user, 2026-11-02 evening): a small comparison, a
// document table and a full-length sheet are written too.
assert.equal(writtenTable(deck('xlsx'),sheet(4)),true,'a small comparison is written as points');
assert.equal(writtenTable(deck('docx'),{...sheet(13),type:'TableBlock'}),true,'a document table is written as comparison points');
assert.equal(writtenTable(deck('xlsx','full'),sheet(13)),true,'the full length too');

const items=new Map([['a',sheet(12)],['b',sheet(2)],['c',sheet(51)]].map(([id,item])=>[id,{...item,id}]));
assert.equal(sheetCards({ids:['a']},items,false),3);
assert.equal(sheetCards({ids:['b']},items,false),1);
assert.equal(sheetCards({ids:['c']},items,false),3,'at most three cards a sheet');
assert.equal(sheetCards({ids:['c']},items,true),1,'the appendix sheet is one summary card');
assert.match(spreadsheetRule,/summarize/u);
console.log('PASS spreadsheet cards: sheets are text, no table drawn, cards by rows, the appendix sheet one card');
