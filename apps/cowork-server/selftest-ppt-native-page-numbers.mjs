import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {spawnPythonSync} from './test/ppt-local-runtime.mjs';
import {_internals,renderImportedPptx} from './lib/ppt/import-pptx.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-native-numbers-')),python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3';
const execute=(script,args=[],input)=>{const r=spawnSync(python,['-c',script,...args],{input,encoding:'utf8',maxBuffer:8e6});assert.equal(r.status,0,r.stderr);return r.stdout;};
try{
 const original=path.join(root,'original.pptx');
 execute(String.raw`
import sys
from pptx import Presentation
from pptx.util import Inches
from pptx.oxml.xmlchemy import OxmlElement
p=Presentation();p.slides.add_slide(p.slide_layouts[6]);p.slides.add_slide(p.slide_layouts[6])
for owner in [p.slide_masters[0],p.slide_masters[0].slide_layouts[6]]:
 sp=OxmlElement('p:sp');nv=OxmlElement('p:nvSpPr');pr=OxmlElement('p:cNvPr');pr.set('id','999');pr.set('name','Inherited footer');nv.append(pr);nv.append(OxmlElement('p:cNvSpPr'));nv.append(OxmlElement('p:nvPr'));sp.append(nv);sp.append(OxmlElement('p:spPr'))
 tx=OxmlElement('p:txBody');tx.append(OxmlElement('a:bodyPr'));tx.append(OxmlElement('a:lstStyle'));para=OxmlElement('a:p')
 for typ,text in [('slidenum','2'),('datetime1','2026')]:
  fld=OxmlElement('a:fld');fld.set('id','{'+('0' if typ=='slidenum' else '1')*8+'-0000-0000-0000-000000000000}');fld.set('type',typ);t=OxmlElement('a:t');t.text=text;fld.append(t);para.append(fld)
 run=OxmlElement('a:r');t=OxmlElement('a:t');t.text='Brand';run.append(t);para.append(run);tx.append(para);sp.append(tx);owner.shapes._spTree.append(sp)
p.save(sys.argv[1])`,[original]);
 const inspect=String.raw`
import sys,json,zipfile
from lxml import etree
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as z:
 roots=[etree.fromstring(z.read(n)) for n in z.namelist() if n.startswith(('ppt/slideMasters/slideMaster','ppt/slideLayouts/slideLayout')) and n.endswith('.xml')]
 print(json.dumps({'numbers':sum(len(r.xpath('.//a:fld[@type="slidenum"]',namespaces=ns)) for r in roots),'dates':sum(len(r.xpath('.//a:fld[@type="datetime1"]',namespaces=ns)) for r in roots),'brands':sum(len(r.xpath('.//a:t[text()="Brand"]',namespaces=ns)) for r in roots)}))`;
 const before=JSON.parse(execute(inspect,[original]));assert.ok(before.numbers>=2);
 for(const canonicalPageNumbers of [false,true]){
  const file=path.join(root,String(canonicalPageNumbers)+'.pptx');
  const r=spawnPythonSync(python,_internals.EXPORT_SCRIPT,[],{input:JSON.stringify({original,canonicalPageNumbers,fonts:{title:'Arial',body:'Arial',titleEastAsia:'PingFang SC',bodyEastAsia:'PingFang SC'},slides:[{nativeSlideIndex:0,nodes:[]},{nativeSlideIndex:1,nodes:[]}]}),env:{...process.env,PPT_OUTPUT:file},encoding:'utf8',maxBuffer:8e6});assert.equal(r.status,0,r.stderr);
  const after=JSON.parse(execute(inspect,[file]));assert.equal(after.numbers,canonicalPageNumbers?0:before.numbers);assert.equal(after.dates,before.dates);assert.equal(after.brands,before.brands);
 }
 const base={id:'n',uid:'n',deck:{slides:[{id:'s1',title:'Cover',nativeSlideIndex:0,nodes:[]},{id:'s2',title:'Body',nativeSlideIndex:1,nodes:[{id:'number',type:'text',semanticRole:'page-number',geometry:{x:0,y:0,width:914400,height:300000},style:{fontSizePt:10},content:{text:'2'}}]}]},externalPptx:{mode:'preserve',width:9144000,height:5143500,originalPath:original},templateSpec:{fonts:{body:'Arial'}}};
 for(const cards of [false,true]){const project=structuredClone(base);if(cards)project.planningContract={version:3,flow:'cards'};await renderImportedPptx(project,{runPython:async(p,script,input)=>{assert.equal(JSON.parse(input).canonicalPageNumbers,cards);return {};}});}
 console.log('PASS native page numbers: canonical card footers replace inherited fields; ordinary decks, dates and brands retain their fields');
}finally{fs.rmSync(root,{recursive:true,force:true});}
