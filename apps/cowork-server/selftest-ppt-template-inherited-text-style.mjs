// A template title's size, typeface and weight come from its layout and master
// when the run sets none (live GPH-GU2353, a Google Slides export: titles set
// only on the master, 28 pt Montserrat ExtraBold, were measured at the 18 pt
// default and overflowed the rendered page).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _internals as importer } from './lib/ppt/import-pptx.mjs';
const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/labcodepilot/ppt-python/bin/python';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-inherited-style-'));
const run = (script, input, env = {}) => { const r = spawnSync(python, ['-c', script], { input, env: { ...process.env, ...env }, maxBuffer: 50_000_000 }); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout.toString(); };
try {
  const template = path.join(root, 'template.pptx');
  run(`from pptx import Presentation
from pptx.util import Inches, Pt
from lxml import etree
import os
p=Presentation()
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
# The master's title style: 28 pt, a named typeface, bold; the layout title adds nothing.
level=p.slide_master._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}titleStyle/'+A+'lvl1pPr')
props=level.find(A+'defRPr');props.set('sz','2800');props.set('b','1')
for child in list(props):
    if child.tag==A+'latin':props.remove(child)
etree.SubElement(props,A+'latin',typeface='Montserrat ExtraBold')
s=p.slides.add_slide(p.slide_layouts[5]);s.shapes.title.text='A title set only on the master'
b=s.shapes.add_textbox(Inches(1),Inches(2),Inches(6),Inches(1));b.text='Own size';b.text_frame.paragraphs[0].runs[0].font.size=Pt(15)
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: template });
  const manifest = JSON.parse(run(importer.IMPORT_SCRIPT, fs.readFileSync(template), { PPT_EXTERNAL_DIR: root }));
  const shapes = manifest.slides[0].shapes, title = shapes.find(shape => shape.text === 'A title set only on the master'), own = shapes.find(shape => shape.text === 'Own size');
  assert.equal(title.fontSizePt, 28, 'the master sets the size: ' + JSON.stringify(title));
  assert.equal(title.fontFamily, 'Montserrat ExtraBold', 'and the typeface');
  assert.equal(title.bold, true, 'and the weight');
  assert.deepEqual(title.textFrame.paragraphs[0].runs.map(r => [r.fontSizePt, r.fontFamily, r.bold]), [[28, 'Montserrat ExtraBold', true]], 'each run carries it for measurement');
  assert.equal(own.fontSizePt, 15, 'a run with its own size keeps it');
  console.log('PASS inherited text style: a run without its own size, typeface or weight takes its layout and master values; its own values win');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
