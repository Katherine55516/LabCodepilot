// PDF figures (Fable 2026-10-27, the user's world_models.pdf: whole-page renders
// of every page with drawings were required images no card could place, and the
// deck never published). Drawings and raster images cluster into figure
// regions, each cropped and captioned by its own "Figure N." line; captioned
// figures are required, an uncaptioned chart is an optional diagram titled by
// its own heading, and rules alone are no figure.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';import {extractFile} from './lib/ppt-source.mjs';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-pdf-figures-')),python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3',runtime=localPptRuntime(out,python);
const ARIAL='/System/Library/Fonts/Supplemental/Arial.ttf';
try{
 if(!fs.existsSync(ARIAL)){console.log('SKIP pdf figures: Arial.ttf missing');process.exit(0);}
 const file=path.join(out,'figures.pdf');
 const build=spawnSync(python,['-c',`import sys,io
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from PIL import Image
pdfmetrics.registerFont(TTFont('Body',sys.argv[2]))
c=canvas.Canvas(sys.argv[1],pagesize=(612,792))
def text(s,x,y,size=9):c.setFont('Body',size);c.drawString(x,y,s)
def arrow(x0,y0,x1,y1):
    p=c.beginPath();p.moveTo(x0,y0);p.lineTo(x1,y1);p.lineTo(x1-5,y1+3);p.moveTo(x1,y1);p.lineTo(x1-5,y1-3);c.drawPath(p)
def boxes(x,y,w,h):
    # A flow diagram: three round nodes joined by arrows.
    for k in range(3):c.circle(x+k*w/3+w/6,y+h/2,min(w/6,h/2)-6)
    for k in range(2):arrow(x+(k+1)*w/3-10,y+h/2,x+(k+1)*w/3+10,y+h/2)
def chart(x,y,w,h):
    c.line(x,y,x,y+h);c.line(x,y,x+w,y);p=c.beginPath();p.moveTo(x,y);p.curveTo(x+w/3,y+h,x+2*w/3,y,x+w,y+h*.8);c.drawPath(p)
def body(x,y,lines=4):
    for k in range(lines):text('Body text of the column runs here line %d'%k,x,y-k*11)
# Page 1: two stacked figures in the left column, one in the right column.
boxes(54,620,230,90);text('Figure 5. Flow diagram of an autoencoder.',54,608)
body(54,580)
boxes(54,420,230,90);text('Figure 6. A recurrent model with a mixture output.',54,408)
body(320,700,8)
boxes(320,520,230,90);text('Figure 8. Flow diagram of the agent model.',320,508)
c.showPage()
# Page 2: four charts in a grid (their union covers most of the page), four captions.
for k,(x,y) in enumerate([(54,470),(320,470),(54,130),(320,130)]):
    chart(x,y,230,230);text('Figure %d. Histogram of cumulative rewards %d.'%(25+k,k),x,y-14)
c.showPage()
# Page 3: arrows drawn over a raster image are one figure.
buffer=io.BytesIO();Image.new('RGB',(400,200),'#88aacc').save(buffer,format='PNG');buffer.seek(0)
c.drawImage(ImageReader(buffer),100,500,width=400,height=200)
for k in range(3):arrow(150+k*100,600,190+k*100,600)
text('Figure 4. Our agent consists of three components.',100,486)
c.showPage()
# Page 4: horizontal rules only.
for k in range(6):c.line(54,700-k*40,558,700-k*40);text('Ruled line %d'%k,60,705-k*40)
c.showPage()
# Page 5: an uncaptioned chart under its own title.
text('Equity curve of two strategies',60,700,12);chart(60,420,400,250)
c.showPage()
# Page 6: two side-by-side parts under one caption line.
chart(54,500,230,180);chart(320,500,230,180);text('(a)',160,488);text('(b)',430,488)
text('Figure 9. Training curves: (a) car racing and (b) VizDoom.',54,470)
c.showPage()
# Page 7: a caption longer than four lines, with unrelated right-column rows.
chart(54,560,230,140)
for k,line in enumerate(['Figure 10. A complete six-line caption.',
 'The model learns a compact representation.',
 'It predicts the next observation from actions.',
 'Training uses observations from the real task.',
 'The policy is evaluated in the actual environment.',
 'The complete caption ends here.']):text(line,54,546-k*11,9)
text('Parallel column heading',320,532,12)
text('Parallel text must not interrupt the caption.',320,515,10)
text('Body text must not enter the caption.',54,480,10)
c.showPage()
# Page 8: line-stroke drawings have no PDF curves or raster images.
for row in range(4):
    for col in range(8):c.line(54+col*15,650-row*15,62+col*15,657-row*15)
text('Figure 11. A grid of line-stroke sketches.',54,590,9)
c.save()`,file,ARIAL],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);
 const source=await extractFile({id:'figures',uid:'pdf-figures'},'figures.pdf',fs.readFileSync(file),runtime.io);
 const images=(source.images||[]).map(image=>({page:Number(image.location.match(/第 (\d+) 页/u)[1]),caption:image.caption.split(' ').slice(0,2).join(' '),required:image.required,role:image.role,refs:image.sourceRefs,width:image.width,height:image.height}));
 const on=page=>images.filter(image=>image.page===page);
 assert.deepEqual(on(1).map(image=>image.caption).sort(),['Figure 5.','Figure 6.','Figure 8.'],'three regions on a two-column page are three figures: '+JSON.stringify(on(1)));
 assert.ok(on(1).every(image=>image.required&&image.role==='diagram'&&image.refs.length===1),'captioned figures are required and cite their caption text');
 assert.ok(on(1).every(image=>image.width<700&&image.height<400),'each is cropped to its region, not the page: '+JSON.stringify(on(1)));
 assert.deepEqual(on(2).map(image=>image.caption).sort(),['Figure 25.','Figure 26.','Figure 27.','Figure 28.'],'four captioned charts are four figures, though their union covers most of the page');
 assert.deepEqual(on(3).map(image=>[image.caption,image.role,image.required]),[['Figure 4.','diagram',true]],'arrows over a picture are one merged figure, the picture not added again');
 assert.deepEqual(on(4),[],'rules alone are no figure');
 assert.deepEqual(on(5).map(image=>[image.caption,image.role,image.required]),[['Equity curve','diagram',false]],'an uncaptioned chart is an optional diagram titled by its own heading');
 assert.deepEqual(on(6).map(image=>[image.caption,image.required]),[['Figure 9.',true]],'parts under one caption line are one figure');
 const fullCaption=source.images.find(image=>image.caption.startsWith('Figure 10.'))?.caption;
 assert.ok(fullCaption?.endsWith('The complete caption ends here.'),'all six caption lines survive: '+fullCaption);
 assert.ok(!/Parallel|Body text/u.test(fullCaption),'neither the adjacent column nor the following body belongs to the caption');
 assert.deepEqual(on(8).map(image=>[image.caption,image.role,image.required]),[['Figure 11.','diagram',true]],'caption-backed line strokes form one figure without classifying ordinary rules as diagrams');
 assert.ok(!source.images.some(image=>/^Im\d+\.(?:png|jpe?g)$/iu.test(image.caption)),'a file name is never a caption');
 console.log('PASS pdf figures: captioned regions cropped and required, a 2x2 grid kept apart, vector-over-raster merged, rules ignored, an uncaptioned chart optional, sub-parts one figure');
}finally{fs.rmSync(out,{recursive:true,force:true});}
