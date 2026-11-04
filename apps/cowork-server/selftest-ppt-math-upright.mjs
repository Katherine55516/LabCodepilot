/** Upright words in a formula are normal text (Fable review r19 G): sty="p"
 * runs drew italic in LibreOffice (fz p7 Cov/Var, mlq p23 \text). Each word
 * run carries m:nor instead of m:sty; rendered through soffice, its glyphs
 * use an upright face. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {OFFICE_MATH_SCRIPT} from './lib/ppt-math.mjs';import {sourceRichText} from './lib/ppt-source-text.mjs';
const python=process.env.PPT_TEST_PYTHON||'python3',dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-math-upright-'));
const rich=sourceRichText('Beta $\\beta_i=\\frac{\\mathrm{Cov}(r_i,r_m)}{\\mathrm{Var}(r_m)}$ when $\\text{label covers } t$');
try{
 const run=spawnSync(python,['-c',String.raw`
import sys,json,subprocess,os,zipfile,re
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
from pptx.oxml.xmlchemy import OxmlElement
from pptx.oxml.ns import qn
`+OFFICE_MATH_SCRIPT+String.raw`
out=sys.argv[1];rich=json.loads(sys.stdin.read())
p=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);box=s.shapes.add_textbox(Inches(.5),Inches(1),Inches(9),Inches(2))
write_rich_text(box.text_frame.paragraphs[0],rich,28,'242A3B','Arial');path=os.path.join(out,'math.pptx');p.save(path)
xml=zipfile.ZipFile(path).read('ppt/slides/slide1.xml').decode()
runs=re.findall(r'<m:r>(.*?)</m:r>',xml,re.S)
words=[r for r in runs if re.search(r'<m:t[^>]*>[^<]*[A-Za-z]{2,}',r)]
assert words and all('<m:nor/>' in r and '<m:sty' not in r for r in words),words
assert any('<m:sty m:val="i"/>' in r for r in runs),'single letters stay italic'
subprocess.run(['soffice','--headless','--convert-to','pdf','--outdir',out,path],check=True,capture_output=True,timeout=180)
import pdfplumber
with pdfplumber.open(os.path.join(out,'math.pdf')) as pdf:chars=pdf.pages[0].chars
text=''.join(c['text'] for c in chars)
for word in ['Cov','Var','label']:
 at=text.find(word);assert at>=0,(word,text)
 faces={c['fontname'] for c in chars[at:at+len(word)]};assert not any(re.search('italic|oblique',f,re.I) for f in faces),(word,faces)
box2=s.shapes.add_textbox(Inches(.5),Inches(4),Inches(4),Inches(1))
write_rich_text(box2.text_frame.paragraphs[0],{'runs':[{'kind':'text','text':'Use '},{'kind':'text','text':'KFold(shuffle=True).split','code':True}],'plainText':'Use KFold(shuffle=True).split','diagnostics':[]},14,'242A3B','Arial')
code_text=''.join(t.text or '' for t in box2._element.iter(qn('a:t')))
assert 'K\u2060F\u2060o' in code_text and '(\u2060s' in code_text and ').\u2060' not in code_text and '.s' in code_text,repr(code_text)
assert rich_visible_text(box2.text_frame._txBody)=='Use KFold(shuffle=True).split'
print(json.dumps({'uprightWords':len(words),'rendered':'upright','codeJoined':True}))
`,dir],{input:JSON.stringify(rich),encoding:'utf8',maxBuffer:4e6});
 assert.equal(run.status,0,run.stderr);console.log('PASS',run.stdout.trim());
}finally{fs.rmSync(dir,{recursive:true,force:true});}
