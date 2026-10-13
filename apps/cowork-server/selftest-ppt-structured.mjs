import { scopeReview } from './ppt-scope-test-helpers.mjs';
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
const templateSpec = { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true }, palette: { background: '#ffffff', accent: '#334155', foreground: '#111827', muted: '#475569' } };

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

  project = repo.getProject(uid, id);
  await assert.rejects(() => commands.applyCommand(uid, id, { type: 'node.setGeometry', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeId: titleOne.id, geometry: { x: -1, y: 0, width: 100, height: 100 } } }), error => error.statusCode === 400, 'geometry outside the slide must fail closed');
  await assert.rejects(() => commands.applyCommand(uid, id, { type: 'node.setStyle', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeId: titleOne.id, style: { color: 'red', dangerous: true } } }), error => error.statusCode === 400, 'unsupported style payload must fail closed');
  await assert.rejects(() => commands.applyCommand(uid, id, { type: 'node.setStyle', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeId: titleOne.id, style: { fontFamily: 'Arial; color:red' } } }), error => error.statusCode === 400, 'a malformed font declaration must fail closed');
  await assert.rejects(() => commands.applyCommand(uid, id, { type: 'node.setLocked', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeId: titleOne.id, locked: 'false' } }), error => error.statusCode === 400, 'boolean fields must not coerce arbitrary strings');
  await assert.rejects(() => commands.applyCommand(uid, id, { type: 'node.insert', baseRevision: project.revision, payload: { slideId: slideOne.id, node: { type: 'image', content: { dataUrl: 'data:image/png;base64,AAAA', text: '' }, geometry: { x: 0, y: 0, width: 914400, height: 914400 } } } }), error => error.statusCode === 400, 'invalid image bytes must fail closed');
  const bodyOne = slideOne.nodes.find(node => node.semanticRole === 'body');
  result = await commands.applyCommand(uid, id, { type: 'nodes.group', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeIds: [titleOne.id, bodyOne.id] } });
  assert.equal(result.project.deck.slides[0].nodes.find(node => node.id === titleOne.id).groupId, result.project.deck.slides[0].nodes.find(node => node.id === bodyOne.id).groupId);
  result = await commands.undo(uid, id); assert.equal(result.project.deck.slides[0].nodes.find(node => node.id === titleOne.id).groupId, null, 'grouping must be undoable');
  project = result.project; result = await commands.applyCommand(uid, id, { type: 'nodes.duplicate', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeIds: [titleOne.id, bodyOne.id] } });
  assert.equal(result.project.deck.slides[0].nodes.length, 4, 'multi-object duplicate must be atomic');
  result = await commands.undo(uid, id); assert.equal(result.project.deck.slides[0].nodes.length, 2, 'multi-object duplicate must be undoable');

  project = result.project;
  result = await commands.applyCommand(uid, id, { type: 'node.setRotation', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeId: titleOne.id, rotation: 27 } });
  assert.equal(result.project.deck.slides[0].nodes.find(node => node.id === titleOne.id).rotation, 27);
  result = await commands.undo(uid, id); assert.equal(result.project.deck.slides[0].nodes.find(node => node.id === titleOne.id).rotation ?? 0, 0, 'rotation must be undoable');
  project = result.project;
  result = await commands.applyCommand(uid, id, { type: 'nodes.delete', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeIds: [bodyOne.id] } });
  assert.equal(result.project.deck.slides[0].nodes.length, 1);
  result = await commands.undo(uid, id); assert.equal(result.project.deck.slides[0].nodes.length, 2, 'multi-object deletion must restore the original object');
  project = result.project;
  const paletteBefore = structuredClone(project.templateSpec.palette);
  const darkPalette = { background: '#181818', foreground: '#f7f7f7', muted: '#c9c9c9', accent: '#9b8cff' };
  result = await commands.applyCommand(uid, id, { type: 'theme.setPalette', baseRevision: project.revision, payload: { palette: darkPalette } });
  assert.deepEqual(result.project.templateSpec.palette, darkPalette);
  result = await commands.undo(uid, id); assert.deepEqual(result.project.templateSpec.palette, paletteBefore, 'theme changes must be undoable');
  project = result.project;
  result = await commands.applyCommand(uid, id, { type: 'ai.slidePatch', baseRevision: project.revision, payload: { slideId: slideOne.id, patches: [{ nodeId: titleOne.id, content: { text: 'AI reviewed title' } }, { nodeId: bodyOne.id, content: { items: [{ id: 'item_ai', text: 'AI reviewed body' }] } }], layoutId: 'comparison' } });
  assert.equal(result.project.deck.slides[0].title, 'AI reviewed title');
  assert.equal(result.project.deck.slides[0].layoutId, 'comparison');
  result = await commands.undo(uid, id); assert.notEqual(result.project.deck.slides[0].title, 'AI reviewed title', 'an AI page patch must be atomic and undoable');

  project = result.project;
  const visualGeometry = { x: 6400800, y: 3200400, width: 1828800, height: 1371600 };
  result = await commands.applyCommand(uid, id, { type: 'node.insert', baseRevision: project.revision, payload: { slideId: slideOne.id, node: { type: 'chart', content: { chartType: 'line', labels: ['A', 'B'], values: [1, 2], unit: '' }, geometry: visualGeometry } } });
  project = result.project;
  result = await commands.applyCommand(uid, id, { type: 'node.insert', baseRevision: project.revision, payload: { slideId: slideOne.id, node: { type: 'table', content: { rows: [['指标', '目标'], ['质量', '通过']] }, geometry: { ...visualGeometry, x: 8229600 } } } });
  project = result.project;
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  result = await commands.applyCommand(uid, id, { type: 'node.insert', baseRevision: project.revision, payload: { slideId: slideOne.id, node: { type: 'image', content: { dataUrl: pixel, text: 'pixel' }, geometry: { ...visualGeometry, x: 9144000, y: 1371600, width: 914400, height: 914400 } } } });
  const imageNode = result.project.deck.slides[0].nodes.find(node => node.type === 'image');
  project = result.project;
  result = await commands.applyCommand(uid, id, { type: 'node.setRotation', baseRevision: project.revision, payload: { slideId: slideOne.id, nodeId: imageNode.id, rotation: 15 } });
  const richProject = structuredClone(result.project); const richTree = structuredClone(result.project.renderTree);
  const richSvg = previewExporter.slideSvg(richTree.slides[0]);
  assert.match(richSvg, /<polyline/); assert.match(richSvg, />指标</); assert.match(richSvg, /<image /, 'SVG preview must render charts, tables and images rather than placeholders'); assert.match(richSvg, /rotate\(15 /);

  let apiResponse;
  const aiRequest = new EventEmitter(); aiRequest.method = 'POST'; aiRequest.headers = {};
  await structuredApi.handleStructuredPpt(aiRequest, new URL(`http://test/ppt/projects/${id}/ai-edit`), {
    uid, res: {}, readBody: async () => JSON.stringify({ scope: 'object', preview: true, slideId: slideOne.id, nodeId: titleOne.id, instruction: '聚焦标题', baseRevision: result.project.revision }),
    send: (status, body) => { apiResponse = { status, body }; return true; }, deps: { modelCall: async (p, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(p) : ({ content: { text: 'API AI title' }, geometry: { x: -1 } }) }, activity: () => {}, log: () => {},
  });
  assert.equal(apiResponse.status, 200, JSON.stringify(apiResponse.body)); assert.equal(apiResponse.body.proposal.content.text, 'API AI title'); assert.equal(apiResponse.body.proposal.geometry, undefined, 'AI proposals must not carry coordinates');
  await structuredApi.handleStructuredPpt(aiRequest, new URL(`http://test/ppt/projects/${id}/ai-edit`), {
    uid, res: {}, readBody: async () => JSON.stringify({ scope: 'slide', mode: 'relayout', preview: true, slideId: slideOne.id, instruction: '精简页面', baseRevision: result.project.revision }),
    send: (status, body) => { apiResponse = { status, body }; return true; }, deps: { modelCall: async () => ({ patches: [{ nodeId: titleOne.id, content: { text: 'Reviewed page title' } }, { nodeId: 'made_up', content: { text: 'ignore' } }], layoutId: 'conclusion', coordinates: [] }) }, activity: () => {}, log: () => {},
  });
  assert.equal(apiResponse.status, 422, 'out-of-scope model targets must fail closed');
  await structuredApi.handleStructuredPpt(aiRequest, new URL(`http://test/ppt/projects/${id}/ai-edit`), {
    uid, res: {}, readBody: async () => JSON.stringify({ scope: 'slide', mode: 'relayout', preview: true, slideId: slideOne.id, instruction: '精简页面', baseRevision: result.project.revision }),
    send: (status, body) => { apiResponse = { status, body }; return true; }, deps: { modelCall: async () => ({ layoutId: 'conclusion' }) }, activity: () => {}, log: () => {},
  });
  assert.equal(apiResponse.status, 200, JSON.stringify(apiResponse.body)); assert.equal(apiResponse.body.proposal.commands[0].type, 'slide.setLayout'); assert.equal(apiResponse.body.proposal.commands[0].payload.layoutId, 'conclusion'); assert.equal(apiResponse.body.proposal.type, 'layout');

  const singleId = store.newId();
  const single = ir.ensureProjectV3({ ...structuredClone(result.project), id: singleId, revision: 0, publishedRevision: 0, deck: { slides: [{ title: 'Only', bullets: [], blocks: [], layoutId: 'cover' }] } });
  repo.saveProject(single);
  await assert.rejects(() => commands.applyCommand(uid, singleId, { type: 'slide.delete', baseRevision: 0, payload: { slideId: single.deck.slides[0].id } }), error => error.statusCode === 400, 'the final slide cannot be deleted');

  project = repo.getProject(uid, id); project.externalPptx = { path: '/tmp/original.pptx', sha256: 'test' }; repo.saveProject(project);
  const restoreDeck = structuredClone(project.deck); restoreDeck.slides[0].nodes.find(node => node.semanticRole === 'title').content.text = 'Restored external title';
  await assert.rejects(() => commands.applyCommand(uid, id, { id: 'external_public_replace', type: 'deck.replace', baseRevision: project.revision, payload: { deck: restoreDeck } }), error => error.statusCode === 400);
  await assert.rejects(() => commands.applyCommand(uid, id, { type: 'nodes.setGroup', baseRevision: project.revision, payload: { slideId: slideOne.id, entries: [{ nodeId: titleOne.id, groupId: null }] } }), error => error.statusCode === 400, 'inverse-only commands must not be exposed by the public API');
  result = await commands.applyCommand(uid, id, { id: 'external_internal_restore', type: 'deck.replace', baseRevision: project.revision, payload: { deck: restoreDeck } }, { allowExternalStructure: true, allowInternal: true });
  assert.equal(result.project.deck.slides[0].title, 'Restored external title', 'revision restore may replace an external deck through the internal path');

  const python = process.env.PPT_TEST_PYTHON || 'python3';
  if (fs.existsSync(python)) {
    const sharedOutput = path.join(root, 'shared-tree.pptx');
    const shared = spawnSync(python, ['-c', pptxExporter._internals.SCRIPT], { input: JSON.stringify({ slides: project.deck.slides, renderTree: firstTree, template: 'light', palette: templateSpec.palette, fonts: templateSpec.fonts }), env: { ...process.env, PPT_OUTPUT: sharedOutput }, maxBuffer: 4_000_000 });
    assert.equal(shared.status, 0, shared.stderr.toString());
    const expectedTitle = firstTree.slides[0].elements.find(element => element.semanticRole === 'title');
    const sharedCheck = spawnSync(python, ['-c', `from pptx import Presentation; import sys
p=Presentation(sys.argv[1]); assert (p.slide_width,p.slide_height)==(12192000,6858000); target=next(s for s in p.slides[0].shapes if getattr(s,'text','')=='One'); assert target.left==int(sys.argv[2]); assert target.top==int(sys.argv[3]); print('ok')`, sharedOutput, String(expectedTitle.bounds.x), String(expectedTitle.bounds.y)]);
    assert.equal(sharedCheck.status, 0, sharedCheck.stderr.toString());
    const richOutput = path.join(root, 'rich-tree.pptx');
    const rich = spawnSync(python, ['-c', pptxExporter._internals.SCRIPT], { input: JSON.stringify({ slides: richProject.deck.slides, renderTree: richTree, template: 'light', palette: templateSpec.palette, fonts: templateSpec.fonts }), env: { ...process.env, PPT_OUTPUT: richOutput }, maxBuffer: 4_000_000 });
    assert.equal(rich.status, 0, rich.stderr.toString());
    const richCheck = spawnSync(python, ['-c', `from pptx import Presentation; import sys
p=Presentation(sys.argv[1]); shapes=list(p.slides[0].shapes); assert any(getattr(s,'has_chart',False) for s in shapes); assert any(getattr(s,'has_table',False) for s in shapes); assert any(s.shape_type==13 and round(s.rotation)==15 for s in shapes); print('ok')`, richOutput]);
    assert.equal(richCheck.status, 0, richCheck.stderr.toString());
    const fixture = spawnSync(python, ['-c', `import io,sys
from pptx import Presentation
from pptx.util import Inches
from PIL import Image
p=Presentation(); s=p.slides.add_slide(p.slide_layouts[6]); t=s.shapes.add_textbox(Inches(1),Inches(1),Inches(5),Inches(1)); t.text='Original'; s.shapes.add_shape(1,Inches(1),Inches(3),Inches(2),Inches(1))
image=io.BytesIO(); Image.new('RGBA',(80,40),(35,45,55,180)).save(image,'PNG'); image.seek(0); s.shapes.add_picture(image,Inches(4),Inches(3),Inches(2),Inches(1))
b=io.BytesIO(); p.save(b); sys.stdout.buffer.write(b.getvalue())`], { maxBuffer: 4_000_000 });
    assert.equal(fixture.status, 0, fixture.stderr.toString());
    const externalDir = path.join(root, 'external');
    const parsed = spawnSync(python, ['-c', importer._internals.IMPORT_SCRIPT], { input: fixture.stdout, env: { ...process.env, PPT_EXTERNAL_DIR: externalDir }, maxBuffer: 4_000_000 });
    assert.equal(parsed.status, 0, parsed.stderr.toString()); const manifest = JSON.parse(parsed.stdout);
    assert.equal(manifest.slides.length, 1); assert.equal(manifest.slides[0].shapes.length, 3);
    const textShape = manifest.slides[0].shapes.find(shape => shape.kind === 'text'); const output = path.join(root, 'preserved.pptx');
    const exported = spawnSync(python, ['-c', importer._internals.EXPORT_SCRIPT], { input: JSON.stringify({ original: manifest.path, fonts: templateSpec.fonts, slides: [{ nativeSlideIndex: 0, nodes: [{ nativeShapeId: textShape.shapeId, type: 'text', semanticRole: 'title', content: { text: '编辑后的中文标题' }, geometry: { x: textShape.x, y: textShape.y, width: textShape.width, height: textShape.height } }] }] }), env: { ...process.env, PPT_OUTPUT: output }, maxBuffer: 4_000_000 });
    assert.equal(exported.status, 0, exported.stderr.toString());
    const inspected = spawnSync(python, ['-c', `from pptx import Presentation; from zipfile import ZipFile; import hashlib,sys
p=Presentation(sys.argv[1]); original=Presentation(sys.argv[2]); assert (p.slide_width,p.slide_height)==(original.slide_width,original.slide_height)==(9144000,6858000); assert len(p.slides[0].shapes)==3; assert any(getattr(s,'text','')=='编辑后的中文标题' for s in p.slides[0].shapes)
with ZipFile(sys.argv[1]) as archive:
    xml=archive.read('ppt/slides/slide1.xml').decode('utf-8'); assert '<a:ea typeface=' in xml; assert 'lang="zh-CN"' in xml
    output_media={name:hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist() if name.startswith('ppt/media/')}
with ZipFile(sys.argv[2]) as archive:
    original_media={name:hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist() if name.startswith('ppt/media/')}
assert output_media == original_media
print('ok')`, output, manifest.path]);
    assert.equal(inspected.status, 0, inspected.stderr.toString());
  }
  console.log('PPT structured IR, run log, render tree, command journal, recovery and conservative PPTX edit: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
