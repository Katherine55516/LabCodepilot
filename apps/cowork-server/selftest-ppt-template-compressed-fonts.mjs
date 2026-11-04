// A template's fonts compressed with MicroType Express (EOT flag 0x4; every
// font of a Google Slides export, live GPH-GU2353) are the author's assets:
// they stay byte-identical in the export, are listed with the installed face
// measured in their place, and never throw (Fable 2026-10-26: alpha-gph2 was
// blocked by native_font_unsupported_eot).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnPythonSync } from './test/ppt-local-runtime.mjs';
import { _internals as importer, projectFromImportedManifest } from './lib/ppt/import-pptx.mjs';
import { fidelityFromImported, bindTemplateFidelity, inspectTemplateFidelity } from './lib/ppt-template-fidelity.mjs';
import { OFFICE_FONT_ENV_SCRIPT } from './lib/ppt-fonts.mjs';
import { parseEmbeddedFonts } from './lib/ppt-native-fonts.mjs';
const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/labcodepilot/ppt-python/bin/python';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-compressed-fonts-'));
process.env.COWORK_STATE_DIR = root;
const run = (script, input, env = {}) => { const r = spawnPythonSync(python, script, [], { input, env: { ...process.env, ...env }, maxBuffer: 50_000_000 }); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout.toString(); };
try {
  const template = path.join(root, 'template.pptx');
  run(`from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.opc.package import Part
from pptx.opc.packuri import PackURI
from lxml import etree
import os, struct
p=Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(5.625)
for title,body in (('Cover Title','Final Project'),('Results','Stepwise selection keeps four predictors and the adjusted R squared rises.')):
    s=p.slides.add_slide(p.slide_layouts[6])
    t=s.shapes.add_textbox(Inches(.5),Inches(.4),Inches(9),Inches(.8));t.text=title;t.text_frame.paragraphs[0].runs[0].font.size=Pt(32);t.text_frame.paragraphs[0].runs[0].font.name='Montserrat Medium'
    b=s.shapes.add_textbox(Inches(.5),Inches(1.6),Inches(9),Inches(2));para=b.text_frame.paragraphs[0]
    # A bullet glyph run at 20 pt, then the sample text at 17 pt (GPH tpl9).
    for text,size in (('\u25cf',20),(body,17)):
        r=para.add_run();r.text=text;r.font.size=Pt(size);r.font.name='Montserrat Medium'
def eot(family):
    name=family.encode('utf-16-le');body=b'\\x00'*16+b'MTX-compressed-font-data'*40
    head=struct.pack('<IIII',0,len(body),0x20002,4)+b'\\x00'*10+b'\\x01\\x00'+struct.pack('<I',400)+struct.pack('<H',0)+struct.pack('<H',0x504C)+b'\\x00'*16+b'\\x00'*8+b'\\x00'*4+b'\\x00'*16+b'\\x00'*2+struct.pack('<H',len(name))+name
    data=head+b'\\x00'*12+body
    return struct.pack('<I',len(data))+data[4:]
lst=etree.SubElement(p.part._element,'{http://schemas.openxmlformats.org/presentationml/2006/main}embeddedFontLst')
# The third part's EOT name ("Montserrat") differs from the typeface it is declared for, as in GPH.
for k,(family,inner) in enumerate((('Montserrat Medium','Montserrat Medium'),('Roboto','Roboto'),('Montserrat ExtraBold','Montserrat'))):
    part=Part(PackURI('/ppt/fonts/font%d.fntdata'%(k+1)),'application/x-fontdata',p.part.package,eot(inner))
    rid=p.part.relate_to(part,'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font')
    item=etree.SubElement(lst,'{http://schemas.openxmlformats.org/presentationml/2006/main}embeddedFont')
    etree.SubElement(item,'{http://schemas.openxmlformats.org/presentationml/2006/main}font',typeface=family)
    etree.SubElement(item,'{http://schemas.openxmlformats.org/presentationml/2006/main}regular',{'{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id':rid})
# The schema puts the list after notesSz.
notes=p.part._element.find('{http://schemas.openxmlformats.org/presentationml/2006/main}notesSz');notes.addnext(lst)
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: template });
  const bytes = fs.readFileSync(template), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  // Import lists each compressed family with the installed face measured in its place.
  const imported = projectFromImportedManifest({ id: 'compressed', uid: 'test', title: 'Compressed' }, JSON.parse(run(importer.IMPORT_SCRIPT, bytes, { PPT_EXTERNAL_DIR: root })), hash);
  const subs = imported.externalPptx.fontSubstitutions;
  assert.deepEqual(subs.map(item => item.family).sort(), ['Montserrat ExtraBold', 'Montserrat Medium', 'Roboto'], 'each compressed font is listed by the typeface runs use: ' + JSON.stringify(subs));
  const installed = family => spawnSync('fc-list', [family, 'family'], { encoding: 'utf8' }).stdout.trim().length > 0;
  for (const [family, expected] of [['Montserrat Medium', ['Verdana', 'DejaVu Sans', 'Arial']], ['Roboto', ['Arial', 'Helvetica', 'Liberation Sans']]]) {
    const used = subs.find(item => item.family === family).usedFamily, first = expected.find(installed) || 'default';
    assert.equal(used, installed(family) ? family : first, `${family}: the first installed measured substitute (${used})`);
  }
  // The editor's font loader and the Office font environment skip them without throwing.
  assert.deepEqual(parseEmbeddedFonts(bytes), [], 'no compressed font is served to the editor');
  const env = JSON.parse(run(OFFICE_FONT_ENV_SCRIPT + `\nimport json,sys\nenv=office_font_environment(sys.argv[1] if len(sys.argv)>1 else '${path.join(root, 'profile')}', open('${template}','rb').read())\nprint(json.dumps({'config':open(env['FONTCONFIG_FILE']).read()}))`, ''));
  assert.ok(/<family>Montserrat Medium<\/family><accept><family>Verdana<\/family>/u.test(env.config), 'the compressed family falls to its measured substitute: ' + env.config.slice(0, 400));
  // The gate notes it: the families, the face used, and that measurements used it.
  const fidelity = fidelityFromImported({ pages: 2 }, imported, hash);
  const note = inspectTemplateFidelity({ templateFidelity: fidelity, deck: { slides: [] } }).find(issue => issue.code === 'template_font_compressed');
  assert.ok(note && note.severity === 'warning' && /Montserrat Medium/u.test(note.message) && /measurement/u.test(note.message), 'a warning names the families: ' + JSON.stringify(note));
  // Export keeps the font parts byte-identical and their relationships intact.
  const project = { id: 'compressed', uid: 'test', pages: 2, generationPolicy: { version: 2 }, templateSpec: { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsiaHant: 'Noto Sans CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC' } },
    templateFidelity: fidelity, deck: { slides: fidelity.slides.map((source, index) => ({ id: `s${index}`, title: `New title ${index + 1}`, section: 'New', bullets: [], nodes: [], templateSlotTexts: Object.fromEntries(source.slots.filter(slot => slot.role === 'content').map(slot => [String(slot.shapeId), 'New body text for the deck'])) })) } };
  bindTemplateFidelity(project);
  const slides = project.deck.slides.map(slide => ({ nativeSlideIndex: slide.templateSlideIndex, omitShapeIds: (slide.templateOmissions || []).map(item => item.shapeId), nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole, nativeShapeId: node.nativeRef.shapeId, geometry: node.geometry, content: node.content, style: node.style, templateSlot: node.templateSlot })) }));
  const output = path.join(root, 'generated.pptx');
  run(importer.EXPORT_SCRIPT, JSON.stringify({ original: template, slides, fonts: project.templateSpec.fonts, inheritedActions: [] }), { PPT_OUTPUT: output });
  const parts = file => JSON.parse(run(`import zipfile,hashlib,json,os,re
z=zipfile.ZipFile(os.environ['PPT_INPUT'])
fonts={n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('ppt/fonts/')}
rels=z.read('ppt/_rels/presentation.xml.rels').decode();xml=z.read('ppt/presentation.xml').decode()
ids=re.findall(r'<p:regular r:id="([^"]+)"',xml)
print(json.dumps({'fonts':fonts,'linked':sorted(re.search(r'Id="%s"[^>]*Target="([^"]+)"'%i,rels).group(1) if re.search(r'Id="%s"[^>]*Target="([^"]+)"'%i,rels) else re.search(r'Target="([^"]+)"[^>]*Id="%s"'%i,rels).group(1) for i in ids)}))`, '', { PPT_INPUT: file }));
  // The deck keeps the embedded family's name for its Latin text, and an emptied template run does not stay behind.
  const typefaces = JSON.parse(run(`import json,os
from pptx import Presentation
p=Presentation(os.environ['PPT_INPUT'])
print(json.dumps([[r.font.name,r.text,r.font.size.pt if r.font.size else None] for s in p.slides for sh in s.shapes if sh.has_text_frame for pg in sh.text_frame.paragraphs for r in pg.runs]))`, '', { PPT_INPUT: output }));
  assert.ok(typefaces.length && typefaces.every(([name]) => name === 'Montserrat Medium'), 'the embedded family stays the typeface: ' + JSON.stringify(typefaces));
  assert.ok(typefaces.every(([, text]) => text !== ''), 'no emptied template run is left: ' + JSON.stringify(typefaces));
  const before = parts(template), after = parts(output);
  assert.deepEqual(after.fonts, before.fonts, 'the font parts survive byte-identical');
  assert.deepEqual(after.linked, before.linked, 'and stay linked from the font list');
  console.log('PASS compressed template fonts: listed with their measured substitute, never thrown, noted by the gate, kept byte-identical and linked in the export');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
