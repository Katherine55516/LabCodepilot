import {requireSoffice} from './test/ppt-tool-requirements.mjs';requireSoffice('selftest-ppt-input-visuals');
/** Production parsers: embedded images + vector/native charts, no model required. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {normalizePaste,extractFile,validateFile,mergeSourceMedia} from './lib/ppt-source.mjs';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
import {fitComponents} from './lib/ppt-density-capacity.mjs';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';
import {_internals as api} from './lib/ppt-api.mjs';
import {inspectSlideCopy,materializeCopy} from './lib/ppt-presentation-writing.mjs';
import {bindSourceMedia} from './lib/ppt-source-artifacts.mjs';
import {renderPptx} from './lib/ppt-render.mjs';
import crypto from 'node:crypto';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-input-visuals-'));
const python=process.env.PPT_TEST_PYTHON || 'python3';
const runtime=localPptRuntime(root,python);
try {
 const fixture=spawnSync(python,['-c',String.raw`
import sys,base64
from PIL import Image
from docx import Document
from openpyxl import Workbook
from openpyxl.chart import BarChart,Reference
from openpyxl.drawing.image import Image as ExcelImage
from reportlab.pdfgen import canvas
r=sys.argv[1];Image.new('RGB',(200,100),'#7651b2').save(r+'/evidence.png');Image.new('RGB',(200,100),'#7651b2').save(r+'/evidence.jpg')
d=Document();d.add_paragraph('Evidence: record values and compare conditions.');d.add_picture(r+'/evidence.png');d.sections[0].header.paragraphs[0].add_run().add_picture(r+'/evidence.png');d.save(r+'/evidence.docx')
w=Workbook();s=w.active;s.append(['Method','Value']);s.append(['A',4]);s.append(['B',7]);s.add_image(ExcelImage(r+'/evidence.png'),'D1');c=BarChart();c.title='Evidence chart';c.add_data(Reference(s,min_col=2,min_row=1,max_row=3),titles_from_data=True);c.set_categories(Reference(s,min_col=1,min_row=2,max_row=3));s.add_chart(c,'D8');w.save(r+'/evidence.xlsx')
p=canvas.Canvas(r+'/evidence.pdf');p.drawString(60,760,'Measured evidence: vector diagram');p.line(60,400,300,400);p.rect(80,400,60,100,fill=1);p.rect(180,400,60,150,fill=1);p.rect(60,390,240,180);p.save()
url='data:image/png;base64,'+base64.b64encode(open(r+'/evidence.png','rb').read()).decode()
open(r+'/evidence.html','w').write('<h1>Measured evidence</h1><p>Compare A and B.</p><img alt="Evidence" src="'+url+'"><svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="120" height="140" fill="#7651b2"/></svg>')
`,root],{encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
 const image={id:'attached-image',fileName:'evidence.png',dataUrl:'data:image/png;base64,'+fs.readFileSync(path.join(root,'evidence.png')).toString('base64'),caption:'evidence',width:200,height:100};
 const pasted=normalizePaste('Compare the attached figure.\n![Comparison](evidence.png)',[image]);
 assert.equal(normalizePaste('',[image]).text,'','image-only input does not inject a language-changing placeholder');
 assert.equal(pasted.images.length,1);assert.equal(pasted.mediaWarnings.length,0);assert.match(pasted.images[0].caption,/Comparison/);
 assert.equal(normalizePaste('![Missing](absent.jpg)').mediaWarnings[0].reference,'absent.jpg');
 assert.equal(normalizePaste(`<img alt="Comparison" src="${image.dataUrl}">`).images.length,1);
 assert.equal(mergeSourceMedia(pasted,[image]).images.length,1,'content deduplication');
 const merged=api.mergeSourceSupplement({text:'Imported file context',segments:[{id:'1',text:'Imported file context'}]},
  {segments:[{id:'1',text:'Supplemental chart context',location:'HTML'}],images:[{...image,sourceRefs:['1']}]},'<svg></svg>');
 assert.deepEqual(merged.images[0].sourceRefs,['S1'],'supplemental figures refer to their own newly namespaced text, not the file first paragraph');
 assert.equal(merged.segments.find(s=>s.id===merged.images[0].sourceRefs[0]).text,'Supplemental chart context');
 for(const ext of ['png','jpg','docx','xlsx','pdf','html']) {
  const bytes=fs.readFileSync(path.join(root,'evidence.'+ext));assert.equal(validateFile('evidence.'+ext,bytes),ext);
  const source=await extractFile({id:ext},'evidence.'+ext,bytes,runtime.io);
  assert.ok(source.images.length>=1,ext+' includes visuals');assert.deepEqual(source.mediaWarnings,[],ext+' has no hidden extraction error');
  if(ext==='xlsx')assert.ok(source.images.length>=2||source.segments.some(segment=>segment.kind==='chart'&&segment.chart?.series?.length),'native Excel chart is kept (editable chart data, or a rendered preview) alongside the embedded image');
  if(ext==='html'){assert.equal(source.images.length,2,'HTML PNG and inline SVG');assert.equal(source.images.find(image=>image.location==='HTML inline SVG').caption,'','parser format/location is not a source-authored slide caption');assert.equal(source.images.find(image=>image.location==='HTML embedded image').caption,'Evidence','real alt text is retained');}
  if(ext==='docx')assert.equal(source.images.length,1,'duplicate header/document images use one inventory asset');
  // Verify the complete parser -> semantic media binding -> native PPTX path,
  // rather than counting image candidates only at the parser boundary.
  const project={id:'export-'+ext,source,template:'light',templateSpec:{fonts:{title:'Arial',body:'Arial',titleEastAsia:'Arial',bodyEastAsia:'Arial'},palette:{background:'#ffffff',foreground:'#222222',accent:'#7657e8',muted:'#666666'}},deck:{slides:[{id:'cover',title:'Evidence',nodes:[]},...source.images.map((image,index)=>({id:'media'+index,title:'Observed image '+(index+1),nodes:[]}))]}};
  for(const [index,image]of source.images.entries()){
   assert.ok(image.location?.trim(),ext+' image keeps provenance even when no source caption exists');
   bindSourceMedia(project,project.deck.slides[index+1],[image.id],index+1);
  }
  const pptx=await renderPptx(project,runtime.io);
  const hashes=spawnSync(python,['-c',"import sys,zipfile,hashlib,json\nwith zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps([hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('ppt/media/')]))",pptx.path],{encoding:'utf8'});
  assert.equal(hashes.status,0,hashes.stderr);const embedded=new Set(JSON.parse(hashes.stdout));
  for(const image of source.images){const hash=crypto.createHash('sha256').update(Buffer.from(image.dataUrl.split(',')[1],'base64')).digest('hex');assert.ok(embedded.has(hash),ext+' source image hash survives in the actual PPTX');}
  console.log(ext+': '+source.images.length+' visual assets, '+source.segments.length+' source segments');
 }
 const captioned=await extractFile({id:'captioned-svg'},'captioned.html',Buffer.from('<h1>Source figure</h1><svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><title>Observed groups</title><desc>Counts share the same definition.</desc><rect width="120" height="140" fill="#7651b2"/></svg>'),runtime.io);
 assert.equal(captioned.images[0].caption,'Observed groups\nCounts share the same definition.','SVG title and description remain source-authored visible captions');
 assert.throws(()=>validateFile('fake.png',Buffer.from('invalid')),/signature/);
 const fit=fitComponents([{type:'table',content:{rows:[['Method','Value'],['A','4'],['B','7']]}}]);assert.equal(fit.capacity_ok,true);
 const b=fit.boxes[0],c=fit.canvas;assert.ok(Math.abs((b.y+b.height/2)-(c.y+c.height/2))<1);
 const project={templateSpec:{palette:{background:'#fff'}},deck:{slides:[{id:'table-page',title:'Measured evidence',bullets:[],blocks:[{id:'data',type:'table',rows:[['A','B'],['4','7']]}],layoutId:'table'}]}};
 const e=buildRenderTree(project).slides[0].elements.find(e=>e.kind==='table');assert.ok(Math.abs(e.bounds.x+e.bounds.width/2-6096000)<1000);
 const title=materializeCopy({title:'Evidence (continued 2)'},{id:'a'},null);assert.equal(title.title.title,'Evidence');
 const bad=inspectSlideCopy({title:'Evidence',bullets:['完整来源细节见本页备注。']},{},1,3);assert.ok(bad.some(i=>i.code==='visible_copy_placeholder'&&i.severity==='error'));
 const outline=[{id:'start',title:'Introduction',focus:'Overview',refs:[]},{id:'end',title:'Summary',focus:'Summary',refs:[]}];
 for(const prompt of ['Explain the mechanism.','说明机制和适用条件。']) {
  const p={prompt,outline,templateSpec:{palette:{background:'#fff'}}};
  const ending=api.normalizeSlide({title:'Summary',bullets:['The source describes the mechanism and its conditions.']},outline[1],p);
  assert.equal(ending.title,'Summary','the substantive last page retains its topic');
  assert.deepEqual(ending.bullets,['The source describes the mechanism and its conditions.']);
  assert.ok(ending.nodes.some(node=>node.semanticRole==='closing-greeting'&&node.content.text===(prompt.includes('说明')?'感谢观看':'Thanks for watching!')),'the greeting is a real exportable footer');
 }
 const continuation=materializeCopy({title:'Do not replace',titleCandidates:['Other title']},{id:'a',title:'Measured evidence',capacityPartition:true},null);
 assert.equal(continuation.title.title,'Measured evidence');
 console.log('PPT input visuals, charts, deduplication, component centering and visible-copy contracts: OK');
} finally {fs.rmSync(root,{recursive:true,force:true});}
