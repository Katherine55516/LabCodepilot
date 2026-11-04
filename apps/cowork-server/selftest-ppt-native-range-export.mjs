import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
import {importEditablePptx,renderImportedPptx} from './lib/ppt/import-pptx.mjs';
import {patchEditTarget,resolveEditTarget} from './lib/ppt/edit-target.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {surfaceFill} from './lib/ppt/surface-fill.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-native-range-')),python=process.env.PPT_TEST_PYTHON||'python3';
try{
 const source=path.join(root,'source.pptx');
 const build=spawnSync(python,['-c',`from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
import sys
p=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);f=s.shapes.add_textbox(Inches(.5),Inches(.5),Inches(8),Inches(3)).text_frame
q=f.paragraphs[0];r=q.add_run();r.text='Keep link ';r.font.name='Arial';r.font.size=Pt(24);r.font.bold=True;r.font.color.rgb=RGBColor.from_string('113399');r.hyperlink.address='https://example.com/preserved';r.font.underline=True
r=q.add_run();r.text='repeat repeat';r.font.name='Arial';r.font.size=Pt(16);r.font.color.rgb=RGBColor.from_string('773311')
q=f.add_paragraph();r=q.add_run();r.text='Keep second paragraph';r.font.name='Arial';r.font.size=Pt(18);r.font.italic=True;r.font.color.rgb=RGBColor.from_string('227744')
p.save(sys.argv[1])`,source],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const runtime=localPptRuntime(root,python),p=await importEditablePptx({id:'native-range',uid:'range-test',title:'Preserve unselected runs'},fs.readFileSync(source),'range-source',runtime.io);
 p.templateSpec=snapshotTemplate(BUILT_INS.find(t=>t.id==='light'));
 const n=p.deck.slides[0].nodes.find(n=>n.type==='text'),before=structuredClone(n.nativeTextFrame.paragraphs);
 const start=n.content.text.lastIndexOf('repeat');n.content=patchEditTarget(n,{kind:'range',start,end:start+6,expectedText:'repeat'},'clear');
 assert.equal(n.content.text,'Keep link repeat clear\nKeep second paragraph');
 const expected=r=>({...r,bold:Boolean(r.bold),italic:Boolean(r.italic)});
 assert.deepEqual(n.content.nativeRunProjection.paragraphs[0].runs[0],expected(before[0].runs[0]));
 assert.deepEqual(n.content.nativeRunProjection.paragraphs[1].runs,before[1].runs.map(expected));
 const grapheme={type:'text',content:{text:'a e\u0301 family 👨‍👩‍👧'}};
 assert.throws(()=>resolveEditTarget(grapheme,{kind:'range',start:2,end:3,expectedText:'e'}),/UTF-16/);
 const out=await renderImportedPptx(p,runtime.io);assert.equal(out.exportVerification.status,'passed');
 const reopen=spawnSync(python,['-c',`from pptx import Presentation
import sys
p=Presentation(sys.argv[1]);f=next(s.text_frame for s in p.slides[0].shapes if s.has_text_frame)
assert f.text=='Keep link repeat clear\\nKeep second paragraph',repr(f.text)
r=f.paragraphs[0].runs[0];assert r.font.bold and r.font.size.pt==24 and str(r.font.color.rgb)=='113399' and r.font.underline
assert r.hyperlink.address=='https://example.com/preserved'
r=f.paragraphs[1].runs[0];assert r.font.italic and r.font.size.pt==18 and str(r.font.color.rgb)=='227744'
`,out.path],{encoding:'utf8'});assert.equal(reopen.status,0,reopen.stderr);
 assert.equal(surfaceFill({type:'text'}).mode,'none');
 console.log('PASS actual native range export: repeated substring targeting; grapheme boundaries; untouched font sizes, color, hyperlink, underline, paragraph formatting; reopened PPTX/PDF verification.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
