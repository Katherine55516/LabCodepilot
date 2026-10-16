/** Real malformed Gamma-style IDs: keep both objects, normalize only working
 * identities, export editable content, preserve original bytes, reject ambiguity. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
import {importEditablePptx,renderImportedPptx} from './lib/ppt/import-pptx.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-native-shape-ids-')),python=process.env.PPT_TEST_PYTHON||'python3',runtime=localPptRuntime(root,python);
try{
 const fixture=spawnSync(python,['-c',String.raw`
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
import sys
r=Presentation();s=r.slides.add_slide(r.slide_layouts[6]);text=s.shapes.add_textbox(Inches(.5),Inches(.5),Inches(8),Inches(1));run=text.text_frame.paragraphs[0].add_run();run.text='Original report label';run.font.name='Arial';run.font.size=Pt(20)
table=s.shapes.add_table(2,2,Inches(.5),Inches(2),Inches(8),Inches(1.2));table.table.cell(0,0).text='Group';table.table.cell(0,1).text='Count';table.table.cell(1,0).text='A';table.table.cell(1,1).text='4'
table._element.find('.//'+qn('p:cNvPr')).set('id',str(text.shape_id))
for label in ['Other report page','Last report page']:
 extra=r.slides.add_slide(r.slide_layouts[6]);box=extra.shapes.add_textbox(Inches(.5),Inches(.5),Inches(8),Inches(1));run=box.text_frame.paragraphs[0].add_run();run.text=label;run.font.name='Arial';run.font.size=Pt(20)
r.save(sys.argv[1]+'/duplicate.pptx')
timing=OxmlElement('p:timing');target=OxmlElement('p:spTgt');target.set('spid',str(text.shape_id));timing.append(target);s._element.append(timing);r.save(sys.argv[1]+'/ambiguous.pptx')
`,root],{encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
 const bytes=fs.readFileSync(root+'/duplicate.pptx'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const project=await importEditablePptx({id:'duplicates',uid:'test',title:'Normalized native IDs'},bytes,hash,runtime.io);
 project.templateSpec=snapshotTemplate(BUILT_INS.find(t=>t.id==='light'));
 const nodes=project.deck.slides[0].nodes;assert.equal(nodes.length,2);assert.equal(new Set(nodes.map(n=>n.id)).size,2);assert.equal(new Set(nodes.map(n=>n.nativeRef.shapeId)).size,2);
 assert.deepEqual(nodes.find(n=>n.type==='table').content.rows,[['Group','Count'],['A','4']]);
 const record=project.externalPptx.nativeIdNormalization;assert.equal(record.version,1);assert.equal(record.changes.length,1);assert.notEqual(record.changes[0].newId,record.changes[0].oldId);
 nodes.find(n=>n.type==='text').content.text='New report label';
 const exported=await renderImportedPptx(project,runtime.io);assert.equal(exported.exportVerification.status,'passed');
 const check=spawnSync(python,['-c',"from pptx import Presentation\nimport sys,json\np=Presentation(sys.argv[1]);s=p.slides[0];print(json.dumps({'ids':[x.shape_id for x in s.shapes],'text':[x.text for x in s.shapes if x.has_text_frame],'table':[[c.text for c in row.cells] for x in s.shapes if x.has_table for row in x.table.rows]}))",exported.path],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);const actual=JSON.parse(check.stdout);assert.equal(new Set(actual.ids).size,2);assert.ok(actual.text.includes('New report label'));assert.deepEqual(actual.table,[['Group','Count'],['A','4']]);
 const subset=structuredClone(project);subset.templateSlideMap=[0];subset.deck.slides=subset.deck.slides.slice(0,1);subset.deck.slides[0].nativeSlideIndex=0;
 const subsetDeck=JSON.stringify(subset.deck);await assert.rejects(()=>renderImportedPptx(subset,runtime.io),/native template slide map/,'plain imported decks cannot silently drop original slides');assert.equal(JSON.stringify(subset.deck),subsetDeck,'failed export preparation cannot mutate the editor candidate');
 subset.templateContentMode='design_only';subset.templateFidelity={mode:'preserve',width:project.externalPptx.width,height:project.externalPptx.height,slides:[{nodes:subset.deck.slides[0].nodes,slots:[]}]};
 const reduced=await renderImportedPptx(subset,runtime.io);assert.equal(reduced.exportVerification.status,'passed');assert.equal(JSON.stringify(subset.deck),subsetDeck,'successful export also leaves candidate geometry unchanged');
 const count=spawnSync(python,['-c','from pptx import Presentation;import sys;print(len(Presentation(sys.argv[1]).slides))',reduced.path],{encoding:'utf8'});assert.equal(count.status,0,count.stderr);assert.equal(count.stdout.trim(),'1','explicit design reuse supports a real three-to-one template map');
 const original=await runtime.readFile(project.id,project.externalPptx.originalPath);assert.equal(crypto.createHash('sha256').update(original).digest('hex'),hash,'normalization never rewrites original package bytes');
 await assert.rejects(()=>importEditablePptx({id:'ambiguous',uid:'test',title:'Ambiguous references'},fs.readFileSync(root+'/ambiguous.pptx'),'ambiguous',runtime.io),/native_shape_id_ambiguous_reference/);
 console.log('Native duplicate shape IDs: both objects retained, stable unique working IDs, real editable PPTX export, original bytes unchanged, ambiguous references blocked');
}finally{fs.rmSync(root,{recursive:true,force:true});}
