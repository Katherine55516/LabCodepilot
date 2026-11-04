// Table pages (Fable 2026-11-01, review items 2 and 7): a headerless PDF table
// shows its first row as data (no styled header, nothing repeated on a
// continuation); the layout rule itself is checked live.
import assert from 'node:assert/strict';
import {sourceComponent} from './lib/ppt-density-capacity.mjs';
const rows=[['ViT-B/16','600','72.9'],['ViT-L/16','600','77.5'],['ViT-H/14','300','79.3'],['ViT-H/16','300','77.3']];
const whole=sourceComponent({id:'t',type:'TableBlock',rows,headerless:true},{sourceUnitId:'t'});
assert.equal(whole.type,'table');
assert.equal(whole.content.headerRow,false,'no styled header row');
assert.deepEqual(whole.content.rows.map(row=>row[0]),['ViT-B/16','ViT-L/16','ViT-H/14','ViT-H/16'],'every row is shown once, the first as data');
const part=sourceComponent({id:'t',type:'TableBlock',rows,headerless:true},{sourceUnitId:'t',rowStart:2,rowEnd:4});
assert.deepEqual(part.content.rows.map(row=>row[0]),['ViT-H/14','ViT-H/16'],'a continuation repeats no data row as a header');
const headed=sourceComponent({id:'h',type:'TableBlock',rows:[['Arch','Epochs','Top-1'],...rows]},{sourceUnitId:'h',rowStart:3,rowEnd:5});
assert.equal(headed.content.headerRow,undefined,'a table with a header keeps it');
assert.deepEqual(headed.content.rows[0],['Arch','Epochs','Top-1'],'and repeats it on a continuation');
console.log('PASS table pages: headerless tables show their first row as data');
