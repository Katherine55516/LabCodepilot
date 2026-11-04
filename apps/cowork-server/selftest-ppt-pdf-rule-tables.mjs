// A PDF table drawn with horizontal rules only becomes a table, and a page is a
// drawing only by its curves, diagonals and boxes, not its rules (Fable
// 2026-10-26: the user's 01_research_contract.pdf page 2 became a full-page
// picture that filled a divider's photo frame). A surviving page render is a
// diagram, never a photo.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';import {extractFile} from './lib/ppt-source.mjs';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-rule-tables-')),python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3',runtime=localPptRuntime(out,python);
const ARIAL='/System/Library/Fonts/Supplemental/Arial.ttf';
const build=(name,body)=>{const file=path.join(out,name+'.pdf');const made=spawnSync(python,['-c',`import sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Body',sys.argv[2]))
c=canvas.Canvas(sys.argv[1]);c.setFont('Body',10)
${body}
c.save()`,file,ARIAL],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);return file;};
const read=async file=>extractFile({id:path.basename(file,'.pdf'),uid:'rules'},path.basename(file),fs.readFileSync(file),runtime.io);
try{
 if(!fs.existsSync(ARIAL)){console.log('SKIP pdf rule tables: Arial.ttf missing');process.exit(0);}
 // A rule-only table under a header band, with a footer rule and body text below.
 const table=build('rule-table',`c.setFillColorRGB(.9,.95,.93);c.rect(52,762,500,27,fill=1,stroke=0);c.setFillColorRGB(0,0,0)
c.drawString(60,772,'Contract field');c.drawString(300,772,'Example')
rows=[('Signal clock','After close t'),('Entry and exit','Open t+1 to open t+2'),('Benchmark','Equal-weight universe'),('Selection budget','24 predeclared candidates'),('Failure rule','Reject after a failed test')]
y=762
for a,b in rows:
    c.line(52,y,552,y);c.drawString(60,y-17,a);c.drawString(300,y-17,b);y-=27
c.line(52,y,552,y)
c.drawString(52,y-30,'These numbers are teaching choices, not institutional standards.')
c.line(46,40,549,40);c.drawString(46,28,'ALPHA MINING / SECTION 01')`);
 const source=await read(table),tables=source.semantic.inventory.items.filter(item=>item.type==='TableBlock');
 assert.deepEqual(tables.map(item=>[item.rows.length,item.rows[0].length]),[[6,2]],'the rule-only table with its header row');
 assert.deepEqual(tables[0].rows[0],['Contract field','Example']);
 assert.ok(source.text.includes('These numbers are teaching choices'),'the text outside the table stays');
 assert.deepEqual(source.images||[],[],'no page render');
 // Two aligned gaps in plain body text are no table.
 const prose=await read(build('prose',`for k in range(5):
    c.line(52,760-30*k,552,760-30*k);c.drawString(60,745-30*k,'Line %d of text'%k)`));
 assert.equal(prose.semantic.inventory.items.filter(item=>item.type==='TableBlock').length,0,'one column is no table');
 // A curve drawing is still a drawing, kept as a diagram (a page witness).
 const chart=await read(build('curves',`p=c.beginPath();p.moveTo(60,600);p.curveTo(150,750,250,450,400,700);c.drawPath(p)
p=c.beginPath();p.moveTo(60,500);p.curveTo(200,650,300,400,450,550);c.drawPath(p)
c.line(55,420,55,770);c.line(55,420,470,420)
c.drawString(60,780,'Equity curve of two strategies')`));
 // Its two lines share the axes: one figure, cropped to the chart, optional
 // (no "Figure N" line) and titled by its own heading (Fable 2026-10-27).
 assert.deepEqual((chart.images||[]).map(image=>[image.role,/矢量图/u.test(image.location),image.required,image.caption]),[['diagram',true,false,'Equity curve of two strategies']],'a curve drawing renders as a diagram');
 // A source whose only image is a diagram leaves template photo frames alone.
 const {_internals}=await import('./lib/ppt-template-fidelity.mjs');
 const sourceMediaFor=_internals?.sourceMediaFor;
 if(sourceMediaFor){const frame={geometry:{x:0,y:0,width:3000000,height:4000000}};
  assert.equal(sourceMediaFor({source:{images:chart.images},outline:[{title:'Part 2'}]},0,2,frame),null,'a diagram never fills a photo frame');}
 console.log('PASS pdf rule tables: rule-only tables are tables, rules are not drawings, a page render is a diagram and never a photo');
}finally{fs.rmSync(out,{recursive:true,force:true});}
