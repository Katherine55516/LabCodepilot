/** A deck builder's mark ("Made with GAMMA") never ships (user decision
 * 2026-10-24): the template carries it as a linked badge picture on its slide
 * layout; the native export removes it from every master, layout and slide,
 * keeps the slide's own pictures, and the export verifier blocks any mark
 * that remains. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';import {importEditablePptx,renderImportedPptx} from './lib/ppt/import-pptx.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
const python=process.env.PPT_TEST_PYTHON||'python3',root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-builder-mark-'));
const {BUILDER_MARK_SCRIPT}=await import('./lib/ppt-template-security.mjs');
try{
 const source=path.join(root,'source.pptx');
 const build=spawnSync(python,['-c',String.raw`
import sys,io
from pptx import Presentation
from pptx.util import Emu,Inches
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from PIL import Image
def png(color,size):
    buffer=io.BytesIO();Image.new('RGB',size,color).save(buffer,'PNG');buffer.seek(0);return buffer
prs=Presentation();prs.slide_width=Emu(12192000);prs.slide_height=Emu(6858000)
layout=prs.slide_layouts[6];slide=prs.slides.add_slide(layout)
photo=slide.shapes.add_picture(png((40,90,60),(320,200)),Inches(1),Inches(1),Inches(4),Inches(2.5))
badge=slide.shapes.add_picture(png((0,32,80),(220,52)),Emu(11076875),Emu(6558991),Emu(1071843),Emu(256032))
badge.name='Image 1';badge.click_action.hyperlink.address='https://gamma.app/?utm_source=made-with-gamma'
element=badge._element;slide.shapes._spTree.remove(element)
NS='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
blip=element.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip');link=element.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}hlinkClick')
image_part=slide.part.related_part(blip.get(NS+'embed'));old_link=link.get(NS+'id')
blip.set(NS+'embed',layout.part.relate_to(image_part,RT.IMAGE));link.set(NS+'id',layout.part.relate_to('https://gamma.app/?utm_source=made-with-gamma',RT.HYPERLINK,is_external=True))
layout.shapes._spTree.append(element);slide.part.drop_rel(old_link)
prs.save(sys.argv[1])
`,source],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const scan=file=>spawnSync(python,['-c',`import sys,json\nfrom pptx import Presentation\n${BUILDER_MARK_SCRIPT}\nprs=Presentation(sys.argv[1])\nprint(json.dumps({'marks':[m['reasons'] for m in builder_marks(prs)],'pictures':[s.shape_type for s in prs.slides[0].shapes].count(13),'links':sum('gamma.app' in r.target_ref for p in [*prs.slide_layouts,*prs.slides] for r in p.part.rels.values() if r.is_external)}))`,file],{encoding:'utf8'});
 const before=JSON.parse(scan(source).stdout);
 assert.deepEqual(before,{marks:[['builder_link']],pictures:1,links:1},'the fixture carries one linked corner badge on its layout');
 const runtime=localPptRuntime(root,python),project=await importEditablePptx({id:'builder-mark',uid:'builder-mark',title:'Builder mark'},fs.readFileSync(source),'builder-source',runtime.io);
 project.templateSpec=snapshotTemplate(BUILT_INS.find(t=>t.id==='light'));
 const out=await renderImportedPptx(project,runtime.io);assert.equal(out.exportVerification.status,'passed');
 assert.deepEqual(JSON.parse(scan(out.path).stdout),{marks:[],pictures:1,links:0},'the mark and its link are gone; the slide photo stays');
 // A badge drawn as text (Fable M6, 2026-11-02): a small corner text box reading
 // "Made with Gamma" is a mark; a body sentence that mentions Gamma is not.
 const texts=path.join(root,'texts.pptx');
 const made=spawnSync(python,['-c',String.raw`
import sys
from pptx import Presentation
from pptx.util import Emu,Inches
prs=Presentation();prs.slide_width=Emu(12192000);prs.slide_height=Emu(6858000)
slide=prs.slides.add_slide(prs.slide_layouts[6])
slide.shapes.add_textbox(Emu(10900000),Emu(6500000),Inches(1.2),Inches(.3)).text_frame.text='Made with Gamma'
slide.shapes.add_textbox(Inches(1),Inches(1),Inches(8),Inches(2)).text_frame.text='We compared decks made with Gamma, Canva and PowerPoint across forty teams and three quarters of usage data.'
prs.save(sys.argv[1])
`,texts],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
 const textMarks=spawnSync(python,['-c',`import sys,json\nfrom pptx import Presentation\n${BUILDER_MARK_SCRIPT}\nprint(json.dumps([m['reasons'] for m in builder_marks(Presentation(sys.argv[1]))]))`,texts],{encoding:'utf8'});
 assert.deepEqual(JSON.parse(textMarks.stdout),[['builder_text']],'only the corner badge text is a mark');
 console.log('PASS builder mark: removed from the layout at export, slide pictures kept, verifier clean; text badges too');
}finally{fs.rmSync(root,{recursive:true,force:true});}
