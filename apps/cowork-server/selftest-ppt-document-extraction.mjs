import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {snapshotTemplate,BUILT_INS} from './lib/ppt-template.mjs';
import {fidelityFromImported,bindTemplateFidelity} from './lib/ppt-template-fidelity.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {importEditablePptx,renderImportedPptx} from './lib/ppt/import-pptx.mjs';
import {extractFile} from './lib/ppt-source.mjs';import {localPptRuntime} from './test/ppt-local-runtime.mjs';
const out=process.env.PPT_DOCUMENT_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ppt-documents-')),python=process.env.PPT_TEST_PYTHON||'python3';fs.mkdirSync(out,{recursive:true});const runtime=localPptRuntime(out,python),report=[];
const build=spawnSync(python,['-c',String.raw`
from pathlib import Path
from docx import Document
from docx.oxml import parse_xml
from openpyxl import Workbook
from openpyxl.chart import BarChart,Reference
from reportlab.pdfgen import canvas
from PIL import Image,ImageDraw,ImageFont
from zipfile import ZipFile
import io,sys
out=Path(sys.argv[1]);d=Document();p=d.add_paragraph('Body refers to a note.');p._p.append(parse_xml('<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnoteReference w:id="9"/></w:r>'));p._p.append(parse_xml('<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:txbxContent><w:p><w:r><w:t>Textbox condition: never release without review.</w:t></w:r></w:p></w:txbxContent></w:r>'));b=io.BytesIO();d.save(b)
with ZipFile(b,'a') as z:z.writestr('word/footnotes.xml','<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="9"><w:p><w:r><w:t>Footnote caveat: independent samples only.</w:t></w:r></w:p></w:footnote></w:footnotes>')
(out/'notes.docx').write_bytes(b.getvalue())
c=canvas.Canvas(str(out/'columns.pdf'),pagesize=(612,792));c.setFont('Helvetica-Bold',20);c.drawString(40,760,'COLUMN DOCUMENT');c.setFont('Helvetica',11)
for i in range(8):c.drawString(40,710-i*25,'Left topic %s retains its condition.'%i);c.drawString(330,710-i*25,'Right topic %s retains its evidence.'%i)
c.save()
w=Workbook();s=w.active;s.title='Risk data';s.append(['Period','Risk']);s.append(['One',10]);s.append(['Two',20]);s.append(['Tail',30]);chart=BarChart();chart.add_data(Reference(s,min_col=2,min_row=1,max_row=4),titles_from_data=True);chart.set_categories(Reference(s,min_col=1,min_row=2,max_row=4));chart.title='Saved risk chart';chart.x_axis.title='Period';chart.y_axis.title='Risk units';chart.y_axis.numFmt='0.0';s.add_chart(chart,'D1');w.save(out/'chart.xlsx');chart.y_axis.scaling.logBase=10;w.save(out/'log-chart.xlsx')
im=Image.new('RGB',(1800,2400),'white');draw=ImageDraw.Draw(im);font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',60)
for i,text in enumerate(['Scanned evidence','Preserve cost and timing.','Only independent samples qualify.']):draw.text((120,200+i*160),text,fill='black',font=font)
im.save(out/'scanned.pdf','PDF',resolution=200)
` ,out],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
const word=await extractFile({id:'notes',uid:'doc'},'notes.docx',fs.readFileSync(out+'/notes.docx'),runtime.io);
assert.equal(word.text.match(/Textbox condition/g)?.length,1);assert.equal(word.text.match(/Footnote caveat/g)?.length,1);assert.ok(word.segments.some(s=>s.sourceContainer==='footnote'&&s.referenceId==='9'));assert.ok(word.segments.some(s=>s.sourceContainer==='textbox'));report.push({format:'docx',status:'passed',scenarios:['footnote at reference','textbox exactly once'],segments:word.segments});
const columns=await extractFile({id:'cols',uid:'doc'},'columns.pdf',fs.readFileSync(out+'/columns.pdf'),runtime.io);assert.ok(columns.mediaWarnings.some(w=>w.geometry?.status==='columns'));assert.ok(columns.text.indexOf('Left topic 7')<columns.text.indexOf('Right topic 0'));assert.equal(columns.text.match(/topic [0-7]/g).length,16);report.push({format:'pdf',status:'passed',scenario:'two columns, heading before both, exact glyph coverage',text:columns.text,warnings:columns.mediaWarnings});
const chart=await extractFile({id:'chart',uid:'doc'},'chart.xlsx',fs.readFileSync(out+'/chart.xlsx'),runtime.io);assert.ok(chart.semantic.inventory.items.some(i=>i.type==='ChartBlock'&&i.chart.chartSource.series[0].points[2].value===30));assert.ok(chart.segments.some(s=>s.location.includes('/ data')&&s.rows[3][0]==='Tail'));assert.ok(!chart.mediaWarnings.some(w=>w.required));assert.equal(chart.semantic.inventory.items.find(i=>i.type==='ChartBlock').chart.series[0].name,'Risk');
assert.equal(chart.semantic.inventory.items.find(i=>i.type==='ChartBlock').chart.chartTitle,'Saved risk chart');assert.deepEqual(chart.semantic.inventory.items.find(i=>i.type==='ChartBlock').chart.axisTitles,['Period','Risk units']);const logChart=await extractFile({id:'log-chart',uid:'doc'},'log-chart.xlsx',fs.readFileSync(out+'/log-chart.xlsx'),runtime.io);assert.ok(logChart.mediaWarnings.some(w=>w.required));assert.ok(logChart.segments.some(s=>s.rows?.at(-1)?.includes('30')));assert.ok(!logChart.segments.some(s=>s.kind==='chart'),'log semantics cannot be normalized into an ordinary linear chart');
report.push({format:'xlsx',status:'passed',scenario:'bound categories/cached numeric tail+editable chart contract',chartSource:chart.semantic.inventory.items.find(i=>i.type==='ChartBlock').chart.chartSource});
const scanned=await extractFile({id:'scan',uid:'doc'},'scanned.pdf',fs.readFileSync(out+'/scanned.pdf'),runtime.io);const warning=scanned.mediaWarnings.find(w=>/source_ocr/.test(w.code));assert.ok(warning?.required);if(warning.code==='source_ocr_requires_confirmation'){assert.match(scanned.text,/independent samples/);assert.ok(scanned.segments.some(s=>s.ocr?.words.length>0));}report.push({format:'pdf',scenario:'image-only OCR',status:warning.code==='source_ocr_unavailable'?'external_runtime_blocked':'passed, confirmation required',warning});
for(const [lang,title] of [['en','Risk model'],['zh','因子模型'],['zh-HK','營運風險']]){const text=title+'\n\n'+('Evidence retains conditions. '.repeat(6));const parsed=await extractFile({id:'txt-'+lang,uid:'doc'},'input.txt',Buffer.from(text),runtime.io);assert.ok(parsed.text.startsWith('# '+title));report.push({format:'txt',language:lang,status:'passed',title});}
const makePpt=spawnSync(python,['-c',`from pptx import Presentation
from pptx.util import Inches,Pt
import sys
p=Presentation();p.slide_width=Inches(13.33);p.slide_height=Inches(7.5)
s=p.slides.add_slide(p.slide_layouts[6]);q=s.shapes.add_textbox(Inches(.6),Inches(.6),Inches(12),Inches(.7));q.text='Editable source chart';q.text_frame.paragraphs[0].runs[0].font.size=Pt(32)
p.save(sys.argv[1])`,out+'/chart-template.pptx'],{encoding:'utf8'});assert.equal(makePpt.status,0,makePpt.stderr);
const cp=await importEditablePptx({id:'native-source-chart',uid:'doc',revision:1},fs.readFileSync(out+'/chart-template.pptx'),'nativechart',runtime.io);cp.source=chart;cp.templateFidelity=fidelityFromImported(cp,cp,'nativechart');cp.outline=cp.deck.slides.map(s=>({id:s.id,title:s.title,sourceUnitIds:[],refs:[]}));cp.templateSpec=snapshotTemplate(BUILT_INS.find(t=>t.id==='light'));const ci=chart.semantic.inventory.items.find(i=>i.type==='ChartBlock');cp.planning={slidePlan:[{slideId:cp.deck.slides[0].id,sourceArtifacts:[{sourceUnitId:ci.id}]}]};bindSourceArtifacts(cp,cp.deck.slides[0],[{sourceUnitId:ci.id}],0);bindTemplateFidelity(cp);const ce=await renderImportedPptx(cp,runtime.io);assert.equal(ce.exportVerification.status,'passed');fs.copyFileSync(ce.path,out+'/editable-chart.pptx');report.push({format:'xlsx-native-export',status:'passed',verification:ce.exportVerification});
fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log('Production source decoder: DOCX footnote/textbox, PDF columns/OCR boundary, XLSX chart provenance, TXT multilingual title passed');
