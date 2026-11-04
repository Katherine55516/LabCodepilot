import {requireSoffice} from './test/ppt-tool-requirements.mjs';requireSoffice('selftest-ppt-hyperlink-contrast');
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync}from 'node:child_process';
import {OFFICE_MATH_SCRIPT}from './lib/ppt-math.mjs';
// Specification: https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/3c384794-9e01-480a-accf-8dfb4d99d645
const root=process.env.PPT_BENCH_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ppt-hyperlink-')),python=process.env.PPT_TEST_PYTHON||'python3';fs.mkdirSync(root,{recursive:true});
const script=String.raw`
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
from pptx.oxml.xmlchemy import OxmlElement
from pptx.oxml.ns import qn
from PIL import Image
import sys,subprocess,zipfile,shutil
from pypdf import PdfReader
out=Path(sys.argv[1]);p=Presentation();p.slide_width=Inches(10);p.slide_height=Inches(5.625)
`+OFFICE_MATH_SCRIPT+String.raw`
for bg,fg in [('171B31','F5F6FC'),('F8F9FC','242A3B')]:
 s=p.slides.add_slide(p.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=RGBColor.from_string(bg)
 shape=s.shapes.add_textbox(Inches(.7),Inches(2),Inches(8),Inches(1))
 write_rich_text(shape.text_frame.paragraphs[0],{'runs':[{'kind':'text','text':'Readable source reference','href':'https://example.com/source'}]},28,fg,'Arial')
positive=out/'positive.pptx';negative=out/'negative.pptx';p.save(positive)
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','h':'http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor'}
for slide in p.slides:
 for h in slide._element.findall('.//a:hlinkClick',ns):
  assert h.find('.//h:hlinkClr',ns).get('val')=='tx'
  for x in list(h):h.remove(x)
p.save(negative)
with zipfile.ZipFile(positive)as z:
 links=[z.read(n)for n in z.namelist()if n.startswith('ppt/slides/_rels/')]
 assert sum(b'https://example.com/source' in x for x in links)==2
for name in ['positive','negative']:
 folder=out/name;folder.mkdir(exist_ok=True)
 subprocess.run(['soffice','-env:UserInstallation='+ (out/(name+'-profile')).as_uri(),'--headless','--convert-to','pdf','--outdir',str(folder),str(out/(name+'.pptx'))],check=True,timeout=150,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 # pdftoppm (poppler) where installed, else pypdfium2 from the PPT Python env.
 if shutil.which('pdftoppm'):subprocess.run(['pdftoppm','-png','-r','80',str(folder/(name+'.pdf')),str(folder/'page')],check=True,timeout=60,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 else:
  import pypdfium2
  for k,page in enumerate(pypdfium2.PdfDocument(str(folder/(name+'.pdf')))):page.render(scale=80/72).to_pil().save(folder/f'page-{k+1}.png')
 pdftext='\n'.join(page.extract_text() for page in PdfReader(folder/(name+'.pdf')).pages);assert pdftext.count('Readable source reference')==2
 def blue(page):return sum(b>140 and r<80 and g<120 for r,g,b in Image.open(page).convert('RGB').getdata())
 if name=='positive':good=blue(folder/'page-1.png');light=Image.open(folder/'page-2.png').convert('RGB');assert sum(r<90 and g<90 and b<110 for r,g,b in light.getdata())>100
 else:bad=blue(folder/'page-1.png')
assert bad>100 and good<bad*.05,(good,bad)
print('Native links retain hrefs and readable paint on dark/light backgrounds; default-theme negative is detected:',good,bad)
`;
const r=spawnSync(python,['-c',script,path.resolve(root)],{encoding:'utf8',timeout:360000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr||r.error?.message);console.log(r.stdout.trim());
