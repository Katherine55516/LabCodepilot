import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-structured-'));
process.env.COWORK_STATE_DIR = root;
const [store, repo, ir, runs, events, commands, history, render, importer, structuredApi, pptxExporter, previewExporter] = await Promise.all([
  import('./lib/ppt-store.mjs'), import('./lib/ppt/repository.mjs'), import('./lib/ppt/ir.mjs'),
  import('./lib/ppt/run-service.mjs'), import('./lib/ppt/event-store.mjs'), import('./lib/ppt/command-service.mjs'),
  import('./lib/ppt/command-history.mjs'), import('./lib/ppt/render-tree.mjs'), import('./lib/ppt/import-pptx.mjs'), import('./lib/ppt/api.mjs'),
  import('./lib/ppt-render.mjs'), import('./lib/ppt/exporters/preview.mjs'),
]);
const uid = 'structured-test'; const id = store.newId();
const templateSpec = { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Arial', bodyEastAsia: 'Arial', cjkExplicit: true }, palette: { background: '#ffffff', accent: '#334155', foreground: '#111827', muted: '#475569' } };

try {
  let project = ir.ensureProjectV3({ id, uid, title: 'Structured', prompt: 'Test', pages: 2, template: 'light', templateSpec,
    status: 'completed', stage: 'completed', revision: 1, outline: [{ title: 'One' }, { title: 'Two' }],
    deck: { schemaVersion: 2, slides: [{ title: 'One', bullets: ['A'], blocks: [], layoutId: 'cover' }, { title: 'Two', bullets: ['B'], blocks: [], layoutId: 'summary' }] },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const originalIds = project.deck.slides.map(slide => slide.id); repo.saveProject(project); repo.saveRevision(project, 'baseline');
  assert.deepEqual(repo.getProject(uid, id).deck.slides.map(slide => slide.id), originalIds, 'migration must keep stable slide ids');
  assert.ok(project.deck.slides.every(slide => slide.nodes.every(node => node.id)), 'all objects need stable IDs');

  const run = runs.startRun(project); runs.transitionNode(project, 'source', 'running'); runs.transitionNode(project, 'source', 'completed');
  const eventRows = events.listEvents(uid, id, run.id); assert.deepEqual(eventRows.map(row => row.seq), [1, 2, 3]);
  const running = runs.transitionNode(project, 'content:page', 'running').run; const recovered = runs.recoverRun(repo.getProject(uid, id));
  assert.equal(recovered.id, running.id); assert.equal(recovered.nodes['content:page'].status, 'pending');
  assert.ok(events.listEvents(uid, id, run.id).at(-1).type === 'run.recovered');
  const req = new EventEmitter(); req.method = 'GET'; req.headers = { accept: 'text/event-stream' };
  const res = new EventEmitter(); let stream = ''; res.writeHead = status => assert.equal(status, 200); res.write = chunk => { stream += chunk; }; res.end = () => {};
  const handled = await structuredApi.handleStructuredPpt(req, new URL(`http://test/ppt/projects/${id}/events?after=0`), { uid, res, send: () => true, deps: {}, log: () => {} });
  assert.equal(handled, true); req.emit('close'); assert.match(stream, /event: snapshot/); assert.match(stream, /event: run-event/);

  project = repo.getProject(uid, id); project.status = 'completed'; project.renderTree = render.buildRenderTree(project); repo.saveProject(project);
  const firstTree = project.renderTree; assert.equal(firstTree.units, 'emu'); assert.equal(firstTree.slides.length, 2);
  assert.ok(firstTree.slides.every(slide => slide.elements.every(element => Number.isInteger(element.bounds.x))));
  assert.match(previewExporter.slideSvg(firstTree.slides[0]), new RegExp(firstTree.slides[0].elements.find(element => element.semanticRole === 'title').nodeId));

  const slideOne = project.deck.slides[0]; const slideTwo = project.deck.slides[1];
  const titleOne = slideOne.nodes.find(node => node.semanticRole === 'title'); const titleTwo = slideTwo.nodes.find(node => node.semanticRole === 'title');
  let result = await commands.applyCommand(uid, id, { id: 'cmd_first', type: 'node.setContent', baseRevision: 1, payload: { slideId: slideOne.id, nodeId: titleOne.id, content: { text: 'Changed one' } } });
  assert.equal(result.project.deck.slides[0].title, 'Changed one'); const unchangedScene = result.project.renderTree.slides[1];
  result = await commands.applyCommand(uid, id, { id: 'cmd_second', type: 'node.setContent', baseRevision: 1, payload: { slideId: slideTwo.id, nodeId: titleTwo.id, content: { text: 'Changed two' } } });
  assert.equal(result.project.deck.slides[1].title, 'Changed two', 'disjoint stale command should rebase');
  assert.deepEqual(result.project.renderTree.slides[0].id, firstTree.slides[0].id);
  assert.equal(unchangedScene.id, slideTwo.id);
  await assert.rejects(() => commands.applyCommand(uid, id, { id: 'cmd_conflict', type: 'node.setContent', baseRevision: 1, payload: { slideId: slideOne.id, nodeId: titleOne.id, content: { text: 'Conflict' } } }), error => error.statusCode === 409);
  const repeat = await commands.applyCommand(uid, id, { id: 'cmd_second', type: 'node.setContent', baseRevision: 1, payload: { slideId: slideTwo.id, nodeId: titleTwo.id, content: { text: 'Wrong' } } });
  assert.equal(repeat.idempotent, true); assert.equal(repeat.project.deck.slides[1].title, 'Changed two');
  result = await commands.undo(uid, id); assert.equal(result.project.deck.slides[1].title, 'Two');
  result = await commands.redo(uid, id); assert.equal(result.project.deck.slides[1].title, 'Changed two');
  result = await commands.undo(uid, id); assert.equal(result.project.deck.slides[1].title, 'Two', 'redo must be undoable again');
  assert.ok(history.operationHistory(uid, id).length >= 5); assert.ok(repo.listRevisions(uid, id).length >= 6);

  project = repo.getProject(uid, id); project.externalPptx = { path: '/tmp/original.pptx', sha256: 'test' }; repo.saveProject(project);
  const restoreDeck = structuredClone(project.deck); restoreDeck.slides[0].nodes.find(node => node.semanticRole === 'title').content.text = 'Restored external title';
  await assert.rejects(() => commands.applyCommand(uid, id, { id: 'external_public_replace', type: 'deck.replace', baseRevision: project.revision, payload: { deck: restoreDeck } }), error => error.statusCode === 409);
  result = await commands.applyCommand(uid, id, { id: 'external_internal_restore', type: 'deck.replace', baseRevision: project.revision, payload: { deck: restoreDeck } }, { allowExternalStructure: true });
  assert.equal(result.project.deck.slides[0].title, 'Restored external title', 'revision restore may replace an external deck through the internal path');

  const python = '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
  if (fs.existsSync(python)) {
    const sharedOutput = path.join(root, 'shared-tree.pptx');
    const shared = spawnSync(python, ['-c', pptxExporter._internals.SCRIPT], { input: JSON.stringify({ slides: project.deck.slides, renderTree: firstTree, template: 'light', palette: templateSpec.palette, fonts: templateSpec.fonts }), env: { ...process.env, PPT_OUTPUT: sharedOutput }, maxBuffer: 4_000_000 });
    assert.equal(shared.status, 0, shared.stderr.toString());
    const expectedTitle = firstTree.slides[0].elements.find(element => element.semanticRole === 'title');
    const sharedCheck = spawnSync(python, ['-c', `from pptx import Presentation; import sys
p=Presentation(sys.argv[1]); target=next(s for s in p.slides[0].shapes if getattr(s,'text','')=='One'); assert target.left==int(sys.argv[2]); assert target.top==int(sys.argv[3]); print('ok')`, sharedOutput, String(expectedTitle.bounds.x), String(expectedTitle.bounds.y)]);
    assert.equal(sharedCheck.status, 0, sharedCheck.stderr.toString());
    const fixture = spawnSync(python, ['-c', `import io,sys
from pptx import Presentation
from pptx.util import Inches
p=Presentation(); s=p.slides.add_slide(p.slide_layouts[6]); t=s.shapes.add_textbox(Inches(1),Inches(1),Inches(5),Inches(1)); t.text='Original'; s.shapes.add_shape(1,Inches(1),Inches(3),Inches(2),Inches(1)); b=io.BytesIO(); p.save(b); sys.stdout.buffer.write(b.getvalue())`], { maxBuffer: 4_000_000 });
    assert.equal(fixture.status, 0, fixture.stderr.toString());
    const externalDir = path.join(root, 'external');
    const parsed = spawnSync(python, ['-c', importer._internals.IMPORT_SCRIPT], { input: fixture.stdout, env: { ...process.env, PPT_EXTERNAL_DIR: externalDir }, maxBuffer: 4_000_000 });
    assert.equal(parsed.status, 0, parsed.stderr.toString()); const manifest = JSON.parse(parsed.stdout);
    assert.equal(manifest.slides.length, 1); assert.equal(manifest.slides[0].shapes.length, 2);
    const textShape = manifest.slides[0].shapes.find(shape => shape.kind === 'text'); const output = path.join(root, 'preserved.pptx');
    const exported = spawnSync(python, ['-c', importer._internals.EXPORT_SCRIPT], { input: JSON.stringify({ original: manifest.path, slides: [{ nativeSlideIndex: 0, nodes: [{ nativeShapeId: textShape.shapeId, type: 'text', content: { text: 'Edited' }, geometry: { x: textShape.x, y: textShape.y, width: textShape.width, height: textShape.height } }] }] }), env: { ...process.env, PPT_OUTPUT: output }, maxBuffer: 4_000_000 });
    assert.equal(exported.status, 0, exported.stderr.toString());
    const inspected = spawnSync(python, ['-c', `from pptx import Presentation; import sys; p=Presentation(sys.argv[1]); assert len(p.slides[0].shapes)==2; assert any(getattr(s,'text','')=='Edited' for s in p.slides[0].shapes); print('ok')`, output]);
    assert.equal(inspected.status, 0, inspected.stderr.toString());
  }
  console.log('PPT structured IR, run log, render tree, command journal, recovery and conservative PPTX edit: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
