/** A card deck's table with room exports minimum rows that the renderer grows
 * to their text (Fable review fz-r15: the conservative row estimate left loose
 * rows). Rendered through soffice: every cell's text is visible and the grown
 * table stays inside its box. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {_internals as exporter} from './lib/ppt-render.mjs';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';import {importEditablePptx,renderImportedPptx} from './lib/ppt/import-pptx.mjs';import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
const python=process.env.PPT_TEST_PYTHON||'python3',dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-table-min-rows-'));
const IN=914400,bounds={x:IN,y:IN,width:8*IN,height:4*IN};
const rows=[['Factor','Risk story','Note'],['Momentum','Crash exposure and optionality','Past winners keep winning for months, then reverse sharply when the market turns; the crash risk is the premium'],['Value 价值','账面市值比高的公司','Cheap firms earn more']];
// Measured (conservative) weights: the audit's overflow bound, 2.9 in of the 4 in box.
const elements=[{id:'table',nodeId:'table',kind:'table',bounds,content:{rows,columnWeights:[1,1.6,2.4],rowWeights:[26,46,90],rowExport:'min'},style:{fontSizePt:14}}];
const file=path.join(dir,'actual.pptx');
try{
 const result=spawnSync(python,['-c',exporter.SCRIPT],{input:JSON.stringify({slides:[{title:'Minimum rows',bullets:[]}],renderTree:{slides:[{id:'s',size:{width:12192000,height:6858000},elements}]},fonts:{title:'Arial',body:'Arial',titleEastAsia:'Noto Sans CJK SC',bodyEastAsia:'Noto Sans CJK SC',cjkExplicit:true},palette:{background:'#ffffff',accent:'#6758c8',foreground:'#111827',muted:'#222222'}}),env:{...process.env,PPT_OUTPUT:file},maxBuffer:4e6});
 assert.equal(result.status,0,result.stderr.toString());
 const check=spawnSync(python,['-c',String.raw`
import sys,json,subprocess,os
from pptx import Presentation
p=Presentation(sys.argv[1]);table=next(shape for shape in p.slides[0].shapes if shape.has_table)
minimum=int((14*1.18+6)*12700)
assert all(abs(row.height-minimum)<=2 for row in table.table.rows),[row.height for row in table.table.rows]
assert abs(table.height-sum(row.height for row in table.table.rows))<=12700,('the frame is the sum of its rows',table.height)
out=os.path.dirname(sys.argv[1])
subprocess.run(['soffice','--headless','--convert-to','pdf','--outdir',out,sys.argv[1]],check=True,capture_output=True,timeout=180)
pdf=os.path.join(out,'actual.pdf')
from pypdf import PdfReader
text=''.join(page.extract_text() for page in PdfReader(pdf).pages).replace('\n',' ')
for needle in ['Momentum','optionality','reverse','Cheap']:assert needle in text,(needle,text)
# CJK glyphs extract under their font encoding: count them (2 + 9 in the cells).
import re
assert len(re.findall(r'[\u4e00-\u9fff]',text))>=11,text
subprocess.run(['pdftoppm','-r','40','-png','-singlefile',pdf,os.path.join(out,'page')],check=True,capture_output=True)
from PIL import Image
image=Image.open(os.path.join(out,'page.png')).convert('L');w,h=image.size
# Ink below the box (1 in + 4 in of 7.5 in) inside the table's columns would mean the grown table left its box.
bottom=int(h*5/7.5)+2
ink=[x for y in range(bottom,h) for x in range(int(w*1/13.333),int(w*9/13.333)) if image.getpixel((x,y))<200]
assert not ink,('ink below the box',len(ink))
print(json.dumps({'minimumRows':True,'allCellTextVisible':True,'insideBox':True}))
`,file],{maxBuffer:4e6});
 assert.equal(check.status,0,check.stderr.toString());console.log(check.stdout.toString().trim());
 // The native template path writes the same minimum rows and passes the export check (fz-r17 was blocked:
 // that writer still split the box by row weights).
 const source=path.join(dir,'template.pptx');
 const build=spawnSync(python,['-c','from pptx import Presentation\nimport sys\np=Presentation();p.slides.add_slide(p.slide_layouts[6]);p.save(sys.argv[1])',source],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const runtime=localPptRuntime(dir,python),project=await importEditablePptx({id:'min-rows',uid:'min-rows',title:'Minimum rows'},fs.readFileSync(source),'min-rows-source',runtime.io);
 project.templateSpec=snapshotTemplate(BUILT_INS.find(t=>t.id==='light'));
 project.deck.slides[0].nodes=[{id:'node_min_rows_table',type:'table',slotId:'absolute',geometry:bounds,content:{rows,columnWeights:[1,1.6,2.4],rowWeights:[26,46,90],rowExport:'min'},style:{fontSizePt:14},sourceArtifact:{sourceUnitId:'t1',type:'TableBlock'}}];
 project.deck.slides.forEach(slide=>slide.nodeOrder=slide.nodes.map(node=>node.id));delete project.renderTree;
 const out=await renderImportedPptx(project,runtime.io);
 assert.equal(out.exportVerification.status,'passed',JSON.stringify(out.exportVerification).slice(0,600));
 const rowsCheck=spawnSync(python,['-c','from pptx import Presentation\nimport sys\nt=next(s for s in Presentation(sys.argv[1]).slides[0].shapes if s.has_table).table\nm=int((14*1.18+6)*12700)\nassert all(abs(r.height-m)<=2 for r in t.rows),[r.height for r in t.rows]',out.path],{encoding:'utf8'});
 assert.equal(rowsCheck.status,0,rowsCheck.stderr);console.log('PASS template path: minimum rows exported and verified');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
