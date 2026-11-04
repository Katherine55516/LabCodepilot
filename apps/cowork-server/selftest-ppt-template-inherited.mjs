import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _internals as importer, projectFromImportedManifest } from './lib/ppt/import-pptx.mjs';
import { fidelityFromImported, bindTemplateFidelity, templateMediaRole } from './lib/ppt-template-fidelity.mjs';
import { templateDesignView } from './lib/ppt-template-design.mjs';
import { _internals as api } from './lib/ppt-api.mjs';

// A template that is a real deck: its slide master and layouts paint text and
// pictures on every page. Design-only reuse clears that old text and removes
// old pictures; a small logo survives as a template icon; a user may keep an
// inherited object (3143: "ACME MASTER CONFIDENTIAL" reached every export).
const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/labcodepilot/ppt-python/bin/python';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-template-inherited-'));
process.env.COWORK_STATE_DIR = root;
const run = (script, input, env = {}) => { const r = spawnSync(python, ['-c', script], { input, env: { ...process.env, ...env }, maxBuffer: 50_000_000 }); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout.toString(); };
try {
  const template = path.join(root, 'template.pptx');
  run(`from pptx import Presentation
from pptx.util import Inches, Pt
from PIL import Image
from copy import deepcopy
import io, os
p=Presentation(); p.slide_width=Inches(12); p.slide_height=Inches(6.75)
master=p.slide_master; layout=p.slide_layouts[6]
tmp=p.slides.add_slide(layout)
def to(owner,element,shape_id):
    copy=deepcopy(element); copy.xpath('./*[1]/p:cNvPr')[0].set('id',str(shape_id)); owner.shapes._spTree.append(copy); return copy
def picture(owner,colour,size,left,width,shape_id):
    buffer=io.BytesIO(); Image.new('RGB',size,colour).save(buffer,format='PNG'); buffer.seek(0)
    shape=tmp.shapes.add_picture(buffer,Inches(left),Inches(.3),width=Inches(width)); copy=to(owner,shape._element,shape_id)
    blip=copy.xpath('.//a:blip')[0]; old=blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
    blip.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed',owner.part.relate_to(tmp.part.related_part(old),tmp.part.rels[old].reltype))
text=tmp.shapes.add_textbox(Inches(.5),Inches(6.3),Inches(6),Inches(.3)); text.text='ACME MASTER CONFIDENTIAL 2023'; to(master,text._element,900)
footer=tmp.shapes.add_textbox(Inches(7),Inches(6.3),Inches(4.5),Inches(.3)); footer.text='ACME LAYOUT FOOTER'; to(layout,footer._element,901)
# A page-number field is this deck's own page number, not old content.
number=tmp.shapes.add_textbox(Inches(11.4),Inches(6.3),Inches(.5),Inches(.3)); paragraph=number.text_frame.paragraphs[0]._p
field=paragraph.makeelement('{http://schemas.openxmlformats.org/drawingml/2006/main}fld',{'id':'{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}','type':'slidenum'})
t=field.makeelement('{http://schemas.openxmlformats.org/drawingml/2006/main}t',{});t.text='‹#›';field.append(t);paragraph.append(field);to(layout,number._element,905)
# The same placeholder typed as plain text is old text (Fable): it is cleared.
typed=tmp.shapes.add_textbox(Inches(10.6),Inches(6.3),Inches(.5),Inches(.3)); typed.text='‹#› typed'; to(layout,typed._element,906)
picture(master,'#3366aa',(400,300),6,3.5,902)
picture(master,'#aa2222',(40,40),11.2,.4,903)
# A "Made with" badge on the layout and a linked picture on a slide (3143,
# 5f440e7f): pictures that link out are the old deck's attribution or brand.
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
def link(owner,element,url):
    hlink=element.makeelement('{http://schemas.openxmlformats.org/drawingml/2006/main}hlinkClick',{})
    hlink.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id',owner.part.relate_to(url,RT.HYPERLINK,is_external=True))
    element.xpath('./p:nvPicPr/p:cNvPr')[0].append(hlink)
picture(layout,'#112244',(120,40),10.9,1,904); link(layout,layout.shapes._spTree[-1],'https://gamma.app/?utm_source=made-with-gamma')
ids=p.slides._sldIdLst; first=list(ids)[0]; p.part.drop_rel(first.rId); ids.remove(first)
for index in range(3):
 s=p.slides.add_slide(layout); t=s.shapes.add_textbox(Inches(.8),Inches(1.4),Inches(9),Inches(.7)); t.text='OLD TITLE %d'%index
 t.text_frame.paragraphs[0].runs[0].font.size=Pt(32)
 if index==0:
  buffer=io.BytesIO(); Image.new('RGB',(60,60),'#225522').save(buffer,format='PNG'); buffer.seek(0)
  badge=s.shapes.add_picture(buffer,Inches(11),Inches(5.6),width=Inches(.5)); badge.click_action.hyperlink.address='https://old-company.example/'
 b=s.shapes.add_textbox(Inches(.8),Inches(2.6),Inches(10),Inches(1.5)); b.text='Old revenue grew 23 percent in 2023 at ACME, a fact from the old deck'
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: template });
  const bytes = fs.readFileSync(template), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const imported = projectFromImportedManifest({ id: 'inherited', uid: 'test', title: 'Inherited' }, JSON.parse(run(importer.IMPORT_SCRIPT, bytes, { PPT_EXTERNAL_DIR: root })), hash);
  const inherited = imported.externalPptx.inherited, keyOf = predicate => inherited.find(predicate)?.key;
  const masterText = keyOf(item => item.text === 'ACME MASTER CONFIDENTIAL 2023'), layoutText = keyOf(item => item.text === 'ACME LAYOUT FOOTER');
  const photo = keyOf(item => item.shapeId === 902), logo = keyOf(item => item.shapeId === 903);
  assert.ok(masterText && layoutText && photo && logo, 'the import lists master and layout text and pictures: ' + JSON.stringify(inherited.map(item => item.key)));
  assert.ok(!inherited.some(item => item.shapeId === 905), 'a page-number field alone is not old content');
  assert.ok(inherited.some(item => item.shapeId === 906 && item.text === '‹#› typed'), 'a typed "‹#›" is old text');
  assert.deepEqual(imported.deck.slides.map(slide => Boolean(slide.nativeLayout)), [true, true, true], 'each slide records its layout');
  const rows = api.inheritedObjectRows(imported);
  assert.ok(rows.some(row => row.id === masterText && row.inherited && row.page === 1), 'the picker lists inherited objects on the first page that uses them');
  const badge = inherited.find(item => item.shapeId === 904);
  assert.equal(badge?.href, 'https://gamma.app/?utm_source=made-with-gamma', 'a linked layout picture records its link');
  assert.equal(rows.find(row => row.id === badge.key)?.href, badge.href, 'the picker shows where a linked picture points');
  assert.ok(['unavailable', 'ok', 'failed'].includes(badge.ocr?.status), 'a master/layout picture is read whatever its size');
  const linkedSlidePicture = imported.deck.slides[0].nodes.find(node => node.type === 'image' && node.content?.href);
  assert.equal(linkedSlidePicture?.content.href, 'https://old-company.example/', 'a linked slide picture records its link');
  const retired = templateDesignView(imported, new Set(), new Set(), { preserveClassifiedDesign: true, roleFor: templateMediaRole });
  assert.equal(retired.deck.slides[0].nodes.find(node => node.id === linkedSlidePicture.id).content.mediaRole, 'old_template_content', 'a linked slide picture is never decoration');
  assert.ok(retired.externalPptx.inheritedActions.some(action => action.key === badge.key && action.action === 'remove'), 'the linked badge is removed');
  // Linked pictures are left out and listed, never silently; unread pictures are kept and only noted.
  {const { inspectTemplateFidelity } = await import('./lib/ppt-template-fidelity.mjs');
   const fidelity = fidelityFromImported({ pages: 3 }, retired, 'hash'), notes = inspectTemplateFidelity({ templateFidelity: fidelity, deck: { slides: [] } });
   const linkedNote = notes.find(issue => issue.code === 'template_linked_picture_retired');
   assert.ok(linkedNote && linkedNote.severity === 'warning' && /gamma\.app/u.test(linkedNote.message) && /old-company\.example/u.test(linkedNote.message), 'both linked pictures are listed: ' + JSON.stringify(linkedNote));
   assert.ok(!retired.externalPptx.inheritedActions.some(action => action.key === logo), 'an unread kept logo is not retired');
   if (retired.externalPptx.imageTextReader === 'tesseract_missing') {
    const unread = notes.find(issue => issue.code === 'template_image_text_unchecked');
    assert.ok(unread && unread.severity === 'warning' && /tesseract is not installed/u.test(unread.message), 'the missing reader is named: ' + JSON.stringify(unread));
   }}

  const exportWith = keep => {
    const view = templateDesignView(imported, new Set(), new Set(keep), { preserveClassifiedDesign: true, roleFor: templateMediaRole });
    const project = { id: 'inherited', uid: 'test', pages: 3, templateContentMode: keep.length ? 'keep_fixed' : 'design_only', generationPolicy: { version: 2 },
      templateSpec: { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsiaHant: 'Noto Sans CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC' } },
      templateFidelity: fidelityFromImported({ pages: 3 }, view, hash), deck: { slides: [] } };
    project.deck.slides = project.templateFidelity.slides.map((source, index) => ({ id: `new_${index}`, title: `New title ${index + 1}`, section: 'New', bullets: ['New body'], nodes: [],
      templateSlotTexts: Object.fromEntries(source.slots.filter(slot => slot.role === 'content').map(slot => [String(slot.shapeId), 'New body text for the new deck'])) }));
    bindTemplateFidelity(project);
    const slides = project.deck.slides.map(slide => ({ nativeSlideIndex: slide.templateSlideIndex, omitShapeIds: (slide.templateOmissions || []).map(item => item.shapeId), nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole, nativeShapeId: node.nativeRef.shapeId, content: node.content, geometry: node.geometry, style: node.style })) }));
    const output = path.join(root, `generated-${keep.length}.pptx`);
    run(importer.EXPORT_SCRIPT, JSON.stringify({ original: template, slides, fonts: project.templateSpec.fonts, inheritedActions: project.templateFidelity.inheritedActions }), { PPT_OUTPUT: output });
    return JSON.parse(run(`import json,os
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn
p=Presentation(os.environ['PPT_INPUT'])
owners=[p.slide_master,*p.slide_master.slide_layouts]
text=' '.join(node.text or '' for owner in owners for shape in owner.shapes for node in shape._element.iter(qn('a:t')))
pictures=sorted(int(shape.shape_id) for shape in p.slide_master.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE)
layout_pictures=sorted(int(shape.shape_id) for layout in p.slide_master.slide_layouts for shape in layout.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE)
links=[rel.target_ref for layout in p.slide_master.slide_layouts for rel in layout.part.rels.values() if rel.is_external]
slides=' '.join(node.text or '' for slide in p.slides for shape in slide.shapes for node in shape._element.iter(qn('a:t')))
fields=[node.get('type') for owner in owners for node in owner._element.iter(qn('a:fld'))]
slide_pictures=[[i,int(shape.shape_id),shape.name,shape.width,shape.height] for i,slide in enumerate(p.slides) for shape in slide.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE]
print(json.dumps({'inherited':text,'pictures':pictures,'layoutPictures':layout_pictures,'links':links,'slides':slides,'fields':fields,'slidePictures':slide_pictures}))`, '', { PPT_INPUT: output }));
  };
  const design = exportWith([]);
  assert.ok(!/ACME|1\/27\/13/u.test(design.inherited), 'design-only reuse clears master and layout text, footer and date: ' + design.inherited);
  assert.deepEqual(design.pictures, [903], 'the old photo is removed; the small logo stays as a template icon');
  assert.ok(design.fields.includes('slidenum'), 'the page-number field stays');
  assert.ok(!/typed/u.test(design.inherited), 'a typed "‹#›" is cleared');
  assert.deepEqual(design.slidePictures, [], 'the kept logo shows once, from its master: our render does not copy it onto the pages');
  assert.ok(!design.layoutPictures.includes(904) && !design.links.some(link => /gamma\.app/u.test(link)), 'the badge and its link relationship are gone: ' + JSON.stringify(design));
  assert.ok(!/OLD TITLE|Old revenue/u.test(design.slides) && /New body text/u.test(design.slides), 'slide text is the new deck');
  const kept = exportWith([masterText, photo]);
  assert.ok(/ACME MASTER CONFIDENTIAL 2023/u.test(kept.inherited) && !/ACME LAYOUT FOOTER/u.test(kept.inherited), 'a kept inherited text stays; the rest is cleared');
  assert.deepEqual(kept.pictures, [902, 903], 'a kept inherited picture stays');
  // A kept decorative picture with old text read on it is old content; an
  // unreadable one (no tesseract here) stays and is counted for review.
  const picture = (id, ocr) => ({ id, type: 'image', geometry: { x: 0, y: 0, width: 6000000, height: 4000000 }, content: { dataUrl: 'data:image/png;base64,AA==', ...(ocr ? { ocr } : {}) } });
  const synthetic = { externalPptx: { width: 12192000, height: 6858000, inherited: [
    { key: 'inherited:master:0:-1:9', scope: 'master', masterIndex: 0, layoutIndex: -1, shapeId: 9, kind: 'image', x: 0, y: 0, width: 6000000, height: 4000000, ocr: { status: 'ok', words: 4, digitRun: false } }] },
    deck: { slides: [{ id: 's', nodes: [picture('words', { status: 'ok', words: 3, digitRun: false }), picture('digits', { status: 'ok', words: 0, digitRun: true }),
      picture('clean', { status: 'ok', words: 2, digitRun: false }), picture('unread', { status: 'unavailable' })] }] } };
  const decorative = () => 'template_decoration';
  const view = templateDesignView(synthetic, new Set(), new Set(), { preserveClassifiedDesign: true, roleFor: decorative });
  const roleOf = id => view.deck.slides[0].nodes.find(node => node.id === id).content.mediaRole;
  assert.deepEqual(['words', 'digits', 'clean', 'unread'].map(roleOf), ['old_template_content', 'old_template_content', 'template_decoration', 'template_decoration'], 'pictures with read text are retired');
  assert.equal(view.externalPptx.imageTextUnchecked, 1, 'the unreadable picture is counted for review');
  assert.deepEqual(view.externalPptx.inheritedActions.map(action => action.action), ['remove'], 'an inherited picture with text is removed');
  const { inspectTemplateFidelity } = await import('./lib/ppt-template-fidelity.mjs');
  assert.ok(inspectTemplateFidelity({ templateFidelity: { mode: 'preserve', slides: [], imageTextUnchecked: 1 }, deck: { slides: [] } }).some(issue => issue.code === 'template_image_text_unchecked' && issue.severity === 'warning'));
  // Gap 5: old template text left in the new deck blocks publish and is sent
  // back from the page gate; kept objects, source text and single words pass.
  const { inspectTemplateLeak } = await import('./lib/ppt-template-leak.mjs');
  const leakProject = { templateContentMode: 'design_only', templateFixedObjectIds: ['kept'], source: { text: 'Our study covers Revenue Outlook in depth.' },
    templateFidelity: { mode: 'preserve', slides: [{ slots: [{ shapeId: 4, role: 'title', capacity: 40 }, { shapeId: 5, role: 'content', purpose: 'body', capacity: 120, groupId: 5 }], nodes: [] }],
      sourceCatalog: [{ nodes: [{ id: 'a', type: 'text', content: { text: 'Market Analysis' } }, { id: 'b', type: 'text', content: { text: 'Organizations worldwide are grappling with outdated systems that slow every process' } },
        { id: 'c', type: 'text', content: { text: 'Revenue Outlook' } }, { id: 'd', type: 'text', content: { text: 'Benefits' } }, { id: 'kept', type: 'text', content: { text: 'Acme Holdings Confidential' } }, { id: 'e', type: 'text', content: { text: 'Thank you' } }] }] } };
  const node = (id, text, extra = {}) => ({ id, type: 'text', content: { text }, ...extra });
  const leakSlides = [{ id: 's1', nodes: [node('n1', 'Market Analysis'), node('n2', 'Teams: organizations worldwide are grappling with outdated systems today'), node('n3', 'Revenue Outlook'),
    node('n4', 'Benefits'), node('n5', 'Acme Holdings Confidential'), node('n6', 'Thank you', { semanticRole: 'closing-greeting' }), node('n7', 'A new sentence about weak alphas')] }];
  assert.deepEqual(inspectTemplateLeak(leakProject, leakSlides).map(issue => issue.nodeIds[0]), ['n1', 'n2'], 'an equal template text and a six-word run leak; source text, single words, kept objects and code text pass');
  const { inspectTemplateSlotDraft } = await import('./lib/ppt-template-fidelity.mjs');
  const draftIssues = inspectTemplateSlotDraft(leakProject, 0, { id: 's1', title: 'Weak alphas in pools', templateSlotTexts: { '4': 'Weak alphas in pools', '5': 'Market Analysis' } });
  assert.ok(draftIssues.some(issue => issue.code === 'template_content_leak' && issue.shapeId === 5 && issue.repair === 'fill_template_slots'), 'the page gate sends a stale slot back');
  assert.deepEqual(inspectTemplateLeak({ ...leakProject, templateContentMode: undefined }, leakSlides), [], 'only a template reused for its design is checked');
  console.log('PPT template inherited objects: master/layout text and pictures are cleared on design-only reuse, a logo stays, kept objects stay, pictures with old text are retired, old template text is caught: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
