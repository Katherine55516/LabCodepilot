import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process';
import {validateTemplate,runTemplateParser,_internals} from './lib/ppt-template.mjs';
import {templateLimits} from './lib/ppt-template-security.mjs';
const python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
function fixture(kind){const r=spawnSync(python,['-c',String.raw`
import io,sys,zipfile,os
from pptx import Presentation
from pptx.util import Inches
p=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);s.shapes.add_textbox(Inches(1),Inches(1),Inches(6),Inches(2)).text='Template validation'
b=io.BytesIO();p.save(b);kind=sys.argv[1]
with zipfile.ZipFile(io.BytesIO(b.getvalue())) as z: parts={n:z.read(n) for n in z.namelist()}
if kind=='traversal': parts['../evil.txt']=b'x'
if kind=='macro': parts['ppt/vbaProject.bin']=b'x'
if kind=='ole': parts['ppt/embeddings/oleObject1.bin']=b'x'
if kind=='entity': parts['ppt/unsafe.xml']=b'<!DOCTYPE x [<!ENTITY a "bad">]><x>&a;</x>'
if kind=='xml': parts['ppt/unsafe.xml']=b'<unclosed>'
if kind=='external': parts['ppt/slides/_rels/slide1.xml.rels']=b'<Relationships><Relationship TargetMode="External" Target="file:///tmp/private" Type="image"/></Relationships>'
if kind=='svg': parts['ppt/media/unsafe.svg']=b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://unsafe.test/image.png"/></svg>'
if kind=='safe_svg': parts['ppt/media/safe.svg']=b'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url( &quot;#gradient&quot; )"/></svg>'
if kind=='bomb': parts['ppt/padding.bin']=b'a'*2000000
if kind=='slides':
 for i in range(2,103): parts['ppt/slides/slide%d.xml'%i]=parts['ppt/slides/slide1.xml']
if kind=='objects': parts['ppt/unsafe.xml']=b'<x>'+b'<sp/>'*10001+b'</x>'
if kind=='pixels':
 from PIL import Image
 image=io.BytesIO();Image.new('RGB',(50,50),'white').save(image,format='PNG');parts['ppt/media/test.png']=image.getvalue()
if kind=='entries':
 for i in range(5001): parts['ppt/pad%d.bin'%i]=b'x'
if kind in ('small','medium','near_user','near_managed'):
 size={'small':0,'medium':4000000,'near_user':16700000,'near_managed':67000000}[kind]
 if size: parts['ppt/padding.bin']=os.urandom(size)
out=io.BytesIO()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for n,data in parts.items(): z.writestr(n,data)
sys.stdout.buffer.write(out.getvalue())
`,kind],{maxBuffer:140_000_000});assert.equal(r.status,0,r.stderr.toString());return r.stdout;}
const parser=(bytes)=>runTemplateParser(python,['-c',_internals.SCRIPT],bytes,{PPT_TEMPLATE_EXT:'pptx',PPT_TEMPLATE_LIMITS:JSON.stringify(templateLimits())});
for(const [kind,pattern] of [['traversal',/template_unsafe/],['macro',/template_unsafe/],['ole',/template_unsafe/],['entity',/template_unsafe/],['xml',/template_corrupted/],['external',/template_unsafe/],['svg',/template_unsafe/],['bomb',/template_unsafe/],['slides',/template_too_large/],['objects',/template_(too_large|unsafe)/],['entries',/template_too_large/]])await assert.rejects(parser(fixture(kind)),pattern,kind);
await assert.rejects(parser(Buffer.from('PKcorrupt')),/template_corrupted/);
for(const kind of ['small','medium','near_user','near_managed']) {const bytes=fixture(kind);assert.equal(validateTemplate('valid.pptx',bytes,kind==='near_managed'),'pptx');const result=await parser(bytes);assert.equal(result.pages,1);console.log(kind,bytes.length,'accepted');}
assert.throws(()=>validateTemplate('large.pptx',Buffer.alloc(templateLimits().userBytes+1)),/template_too_large/);
assert.throws(()=>validateTemplate('large.pptx',Buffer.alloc(templateLimits().managedBytes+1),true),/template_too_large/);
process.env.PPT_TEMPLATE_MAX_IMAGE_PIXELS='2000';await assert.rejects(parser(fixture('pixels')),/image pixel limit/);delete process.env.PPT_TEMPLATE_MAX_IMAGE_PIXELS;
assert.equal((await parser(fixture('safe_svg'))).pages,1);
process.env.PPT_TEMPLATE_PARSE_TIMEOUT='30';await assert.rejects(runTemplateParser(python,['-c','import time;time.sleep(1)'],Buffer.alloc(0)),/template_timeout/);delete process.env.PPT_TEMPLATE_PARSE_TIMEOUT;
console.log('PPT template binary bounds, expansion, unsafe package, XML, relationships and timeout: OK');
