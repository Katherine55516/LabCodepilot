// A two-column LaTeX-style PDF is a tested input (Fable 2026-10-26, the user's
// world_models.pdf: 21 per-page warnings blocked generation; its words were
// glued, its columns interleaved and the arXiv margin stamp read as text).
// The fixture is drawn word by word with tight gaps and no space glyphs, as
// LaTeX does, with a rotated margin stamp, a left-column line ending 1 pt before
// the cut, a full-width caption between two column blocks, "model-free … 10³"
// and a ligature and a detached accent.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';import {extractFile} from './lib/ppt-source.mjs';
import {DOCUMENT_EXTRACTION_SCRIPT} from './lib/ppt-document-extraction-python.mjs';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-pdf-two-column-')),python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3',runtime=localPptRuntime(out,python);
const ARIAL='/System/Library/Fonts/Supplemental/Arial.ttf';
try{
 if(!fs.existsSync(ARIAL)){console.log('SKIP pdf two-column: Arial.ttf missing');process.exit(0);}
 // Text clean-up: ligatures, a detached accent, never a space between two Han glyphs.
 const clean=spawnSync(python,['-c',DOCUMENT_EXTRACTION_SCRIPT+"\nimport json\nprint(json.dumps([pdf_clean_text(v) for v in ['\\ufb01nd the \\ufb02ow','Ju\\u00a8rgen','\\u5f3a\\u5316 \\u5b66\\u4e60 and RL']],ensure_ascii=False))"],{encoding:'utf8'});
 assert.equal(clean.status,0,clean.stderr);assert.deepEqual(JSON.parse(clean.stdout),['find the flow','Jürgen','强化学习 and RL']);
 const file=path.join(out,'two-column.pdf');
 const build=spawnSync(python,['-c',`import sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Body',sys.argv[2]))
c=canvas.Canvas(sys.argv[1],pagesize=(612,792))
def words(text,x,y,size=10,gap=2.0):
    for word in text.split(' '):
        c.setFont('Body',size);c.drawString(x,y,word);x+=pdfmetrics.stringWidth(word,'Body',size)+gap
    return x
c.setFont('Body',20);c.drawString(220,740,'Compressed World Models')
left=['Alpha one compressed spatial and temporal','alpha two representation of the agent','alpha three learns a compact policy here','alpha four trains inside its own dream']
right=['Beta one large networks learn rich data','beta two many model-free methods use 10','beta three small networks with few weights','beta four credit assignment is the limit']
for k,(a,b) in enumerate(zip(left,right)):
    y=690-k*14;words(a,54,y);end=words(b,315,y)
    if k==1:c.setFont('Body',6);c.drawString(end,y+4,'3')
# A left-column line ending 1 pt before the cut (306).
end=words('alpha five ends near the gutter edge',54,620)
c.setFont('Body',10);c.drawString(305-pdfmetrics.stringWidth('x','Body',10),620,'x')
words('beta five continues the right column',315,620)
# A full-width caption between the two column blocks.
words('Figure 1. A caption that spans the whole page width between both column blocks of text',54,590,9)
for k in range(4):
    y=560-k*14;words('gamma %d lower left column text runs on'%(k+1),54,y);words('delta %d lower right column text runs on'%(k+1),315,y)
# The rotated arXiv stamp in the left margin.
c.saveState();c.translate(30,250);c.rotate(90);c.setFont('Body',18);c.drawString(0,0,'arXiv:1803.10122v4 [cs.LG] 9 May 2018');c.restoreState()
c.showPage()
# Large alternating pictures leave only three paired baselines (world_models p7).
for k in range(3):
    y=690-k*150
    words('SparseLeft%d complete left column prose here'%k,54,y)
    words('SparseRight%d complete right column prose here'%k,315,y)
for k in range(5):words('Left-only paragraph continues in this column',54,650-k*14)
for k in range(5):words('Right-only paragraph stays in its own column',315,350-k*14)
c.showPage()
# Three split-looking rows do not turn wide single-column prose into columns.
for k in range(3):
    words('Short left fragment here',54,690-k*150)
    words('Short right fragment here',315,690-k*150)
for k in range(12):words('A continuous full width sentence crosses the middle gutter and remains one paragraph.',54,650-k*14)
c.save()`,file,ARIAL],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);
 const source=await extractFile({id:'two-column',uid:'pdf-two-column'},'two-column.pdf',fs.readFileSync(file),runtime.io);
 const text=source.text,warnings=source.mediaWarnings||[];
 assert.ok(text.includes('Alpha one compressed spatial and temporal'),'words keep their spaces: '+text.slice(0,300));
 const at=marker=>{const index=text.indexOf(marker);assert.ok(index>=0,'missing: '+marker+'\n'+text);return index;};
 // Reading order: the upper left column, the upper right column, the caption, the lower columns.
 const order=['alpha four','alpha five ends near the gutter edge','Beta one','beta five','Figure 1.','gamma 1','gamma 4','delta 1','delta 4'].map(at);
 assert.deepEqual(order,[...order].sort((a,b)=>a-b),'columns are read one after the other: '+text);
 assert.ok(!/arXiv|LG\]|8102|yaM/u.test(text),'the margin stamp is not body text');
 const margin=warnings.filter(w=>w.code==='source_pdf_margin_text');
 assert.equal(margin.length,1);assert.equal(margin[0].required,false);assert.equal(margin[0].params.text,'arXiv:1803.10122v4 [cs.LG] 9 May 2018');
 assert.deepEqual(warnings.filter(w=>w.required).map(w=>w.code),[],'a two-column page with "model-free … 10³" needs no confirmation: '+JSON.stringify(warnings));
 const columns=warnings.find(w=>w.code==='source_pdf_columns');assert.deepEqual([columns?.required,columns?.pages],[false,[1,2]],'sparse columns are detected, single-column prose is not');
 assert.ok(at('SparseLeft2')<at('SparseRight0'),'sparse columns are read in column order');
 console.log('PASS pdf two-column: spaced words, column order around a full-width caption, a glyph at the cut read once, margin stamp left out and noted, no false formula');
}finally{fs.rmSync(out,{recursive:true,force:true});}
