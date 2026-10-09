/** Optional local regression using the 49-slide HTML/Gamma fixture. This is a
 * deterministic pipeline replay; it does not claim a real model/Cowork run. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _internals as sourceParser } from './lib/ppt-source.mjs';
import { withSemanticIndex } from './lib/ppt-semantic.mjs';
import { buildPlanning, retrieveSlideSources } from './lib/ppt-planning.mjs';
import { inspectContent } from './lib/ppt-content-qa.mjs';
import { _internals as pptx, projectFromImportedManifest } from './lib/ppt/import-pptx.mjs';
import { fidelityFromImported, rescheduleTemplateFidelity } from './lib/ppt-template-fidelity.mjs';

const sourceFile = process.env.PPT_FIXTURE_HTML || '/Users/dongli/Documents/NVIDIA_Compressing_LLMs/compressing_LLMs.html';
const templateFile = process.env.PPT_FIXTURE_TEMPLATE || '/Users/dongli/Documents/ChatGPT/CodePilot/Gamma-AI.pptx';
const baselineFile = process.env.PPT_FIXTURE_RUN || path.resolve('outputs/nvidia-compressing-llms-gamma-template-semantic-repaired-49-slides-simulated.run.json');
if (![sourceFile, templateFile, baselineFile].every(fs.existsSync)) {
  console.log('Real PPT fixture files unavailable; optional replay skipped.');
  process.exit(0);
}
const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-real-fixture-'));
const run = (script, input, env = {}) => {
  const result = spawnSync(python, ['-c', script], { input, env: { ...process.env, ...env }, maxBuffer: 70_000_000 });
  assert.equal(result.status, 0, result.stderr.toString().slice(-2000));
  return JSON.parse(result.stdout.toString());
};
try {
  const source = withSemanticIndex(run(sourceParser.SCRIPT, fs.readFileSync(sourceFile),
    { PPT_SOURCE_NAME: path.basename(sourceFile), PPT_SOURCE_DIR: root }));
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const outline = baseline.slides.map((slide, index) => ({ id: `fixture_${index + 1}`, title: slide.title,
    focus: slide.title, refs: slide.sourceRefs, chunkRefs: slide.sourceChunks,
    role: index === 0 ? 'cover' : index === baseline.slides.length - 1 ? 'closing' : 'evidence',
    visualIntent: { type: /workflow|path|pipeline|process/iu.test(slide.title) ? 'pipeline'
      : /trade.off|versus|comparison/iu.test(slide.title) ? 'comparison'
        : /evidence|benchmark|size|throughput/iu.test(slide.title) ? 'metric' : 'none' } }));
  // This historical snapshot predates structural HTML segmentation. Its old
  // IDs 611+ are no longer input segment IDs; c_074 now denotes a definition,
  // not the old PTQ result. Migrate these fixed benchmark pages by their
  // explicit source section, never by accepting a nearby unrelated number.
  const benchmarkSections = new Map([[36, /^PTQ is enough for large models/iu],
    [37, /^QAD is recommended over QAT/iu], [42, /^The latency.throughput trade-off/iu]]);
  for (const [page, topic] of benchmarkSections) {
    const matched = source.semantic.chunks.filter(chunk => topic.test(chunk.topic));
    assert.equal(matched.length, 1, `fixture page ${page} must bind its unique original source section`);
    outline[page - 1].chunkRefs = matched.map(chunk => chunk.id);
    outline[page - 1].refs = [...new Set(matched.flatMap(chunk => chunk.sourceRefs))];
  }
  const project = { pages: outline.length, prompt: 'LLM Compression', outline, source,
    templateSpec: { fonts: baseline.template.fonts, palette: baseline.template.palette } };
  project.planning = buildPlanning(project, { brief: { presentationUse: 'technical_explainer' } }, outline);
  const atoms = new Map(source.semantic.evidenceAtoms.map(atom => [atom.id, atom]));
  for (const page of [14, 30, 36, 37, 42]) {
    const contract = project.planning.slidePlan[page - 1];
    assert.ok(contract.requiredEvidenceIds.length, `page ${page} must lock a source atom`);
    const retrieval = retrieveSlideSources(project, outline[page - 1], contract);
    assert.ok(contract.requiredEvidenceIds.every(id => retrieval.evidenceAtoms.some(atom => atom.id === id)));
    console.log(`page ${page} evidence:`, contract.requiredEvidenceIds.map(id => atoms.get(id)?.exactText.slice(0, 140)));
  }
  const baselineDeck = { slides: baseline.slides.map((slide, index) => ({ id: outline[index].id, title: slide.title,
    bullets: slide.content, sourceRefs: slide.sourceRefs, sourceChunks: slide.sourceChunks })) };
  const baselineIssues = inspectContent(project, baselineDeck).issues;
  for (const page of [14, 30, 36, 37, 42]) assert.ok(baselineIssues.some(item =>
    item.code === 'required_evidence_missing' && item.slideId === outline[page - 1].id),
  `old page ${page} must fail the new visible-evidence gate`);
  assert.ok(baselineIssues.some(item => item.code === 'source_page_without_citation' && item.slideId === outline[48].id));
  const templateBytes = fs.readFileSync(templateFile);
  const hash = crypto.createHash('sha256').update(templateBytes).digest('hex');
  const manifest = run(pptx.IMPORT_SCRIPT, templateBytes, { PPT_EXTERNAL_DIR: root });
  const imported = projectFromImportedManifest({ id: 'fixture', uid: 'fixture', title: 'Gamma' }, manifest, hash);
  project.templateFidelity = fidelityFromImported(project, imported, hash);
  rescheduleTemplateFidelity(project);
  assert.equal(project.templateFidelity.slides.length, outline.length);
  const replaced = project.templateFidelity.slides.filter(slide => slide.variant.mediaShapeId).length;
  const semantic = project.templateFidelity.slides.filter(slide => slide.variant.mediaSourceId?.startsWith('semantic-')).length;
  const slides = project.templateFidelity.slides.map((slide, index) => ({ nativeSlideIndex: index,
    nodes: slide.nodes.map(node => ({ type: node.type, semanticRole: node.semanticRole, nativeShapeId: node.nativeRef.shapeId,
      content: node.type === 'image' && !node.content?.mediaReplacement
        ? Object.fromEntries(Object.entries(node.content || {}).filter(([key]) => key !== 'dataUrl')) : node.content,
      geometry: node.geometry, style: node.style })) }));
  const output = path.join(root, 'native-replay.pptx');
  const exported = run(pptx.EXPORT_SCRIPT, JSON.stringify({ original: manifest.path, slides,
    sourceSlideMap: project.templateFidelity.slideMap, fonts: project.templateSpec.fonts }), { PPT_OUTPUT: output });
  assert.equal(exported.slides, outline.length);
  run(`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import json,os
p=Presentation(os.environ['PPT_INPUT'])
assert len(p.slides)==49
assert all(any(s.shape_type==MSO_SHAPE_TYPE.PICTURE for s in slide.shapes) for slide in p.slides)
print(json.dumps({'slides':len(p.slides)}))`, '', { PPT_INPUT: output });
  console.log(JSON.stringify({ semanticChunks: source.semantic.chunks.length, evidenceAtoms: atoms.size,
    templatePages: manifest.slides.length, outputPages: exported.slides, replacedImages: replaced,
    semanticDiagrams: semantic, outputBytes: fs.statSync(output).size, output }, null, 2));
} finally {
  if (!process.env.PPT_KEEP_FIXTURE_OUTPUT) fs.rmSync(root, { recursive: true, force: true });
}
