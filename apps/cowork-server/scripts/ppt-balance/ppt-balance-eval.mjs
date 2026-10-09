#!/usr/bin/env node
/** Evaluation harness for docs/exec-plans/active/ppt-general-content-media-balance.md.
 *
 *   node scripts/ppt-balance/ppt-balance-eval.mjs estimate [--out DIR]
 *   node scripts/ppt-balance/ppt-balance-eval.mjs inspect  [--out DIR] [--write-bands]
 *   node scripts/ppt-balance/ppt-balance-eval.mjs run --input ID --template ID --adapter dry|cli|routine [--pages N] [--out DIR]
 *
 * estimate: deterministic page/assumption/allocation metrics for every input (no model).
 * inspect:  balance metrics (repetition, media scaling, density, numbers) for Gamma
 *           references and module outputs; --write-bands writes lib/ppt-gamma-reference-bands.json.
 * run:      end-to-end generation through the product API with a real model adapter.
 *           cli uses PPT_EVAL_CLAUDE_BIN (a local Claude Code CLI with the user's own
 *           credentials) and the production PPT system prompt; routine uses the product's
 *           Docker/Cowork model path; dry stops at the first model call to verify wiring.
 * Python: PPT_TEST_PYTHON should point at a runtime with python-pptx (+ LibreOffice on
 * PATH for PDF); inspection itself only needs the standard library. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { inspectPptx } from './pptx-inspect.mjs';
import { deckMetrics } from './metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(serverRoot, '../..');
const matrix = JSON.parse(fs.readFileSync(path.join(here, 'matrix.json'), 'utf8'));
const args = process.argv.slice(2);
const mode = args[0];
const option = (name, fallback = null) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
const flag = name => args.includes(`--${name}`);
const resolvePath = value => value && (path.isAbsolute(value) ? value : path.join(repoRoot, value));
const python = process.env.PPT_TEST_PYTHON || 'python3';
const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const outDir = resolvePath(option('out', `outputs/ppt-general-balance-baseline-${stamp}`));
fs.mkdirSync(outDir, { recursive: true });
const policy = code => ({ version: 1, detail: 'balanced', language: { mode: 'source' }, knowledge: 'source_only', ...(code ? { code: { presentation: code } } : {}) });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function runPython(script, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', script], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(chunk)); child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(Buffer.concat(err).toString('utf8').slice(-2000) || `python exit ${code}`)));
    child.stdin.end(input);
  });
}

async function loadSource(input) {
  const { normalizePaste } = await import('../../lib/ppt-source.mjs');
  const { withSemanticIndex } = await import('../../lib/ppt-semantic.mjs');
  const { estimationSource } = await import('../../lib/ppt-planning.mjs');
  if (input.kind === 'prompt') return { source: estimationSource({ inputKind: 'prompt', prompt: input.prompt }), text: input.prompt, bytes: Buffer.from(input.prompt) };
  const file = resolvePath(input.path);
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  if (input.kind === 'paste') return { source: normalizePaste(bytes.toString('utf8')), text: bytes.toString('utf8'), bytes };
  const { _internals } = await import('../../lib/ppt-source.mjs');
  const raw = JSON.parse(await runPython(_internals.SCRIPT, bytes, { PPT_SOURCE_NAME: path.basename(file), PPT_SOURCE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-eval-src-')) }));
  const source = withSemanticIndex(raw);
  return { source, text: source.text || '', bytes };
}

// ---------------------------------------------------------------- estimate
async function estimateMode() {
  const { estimatePageRecommendation } = await import('../../lib/ppt-planning.mjs');
  const rows = [];
  for (const input of matrix.inputs) {
    const loaded = await loadSource(input).catch(error => ({ error }));
    if (!loaded) { rows.push({ input: input.id, skipped: 'missing file' }); continue; }
    if (loaded.error) { rows.push({ input: input.id, error: String(loaded.error.message).slice(0, 300) }); continue; }
    const items = loaded.source?.semantic?.inventory?.items || [];
    const row = { input: input.id, traits: input.traits, sha256: sha(loaded.bytes), chars: loaded.text.length,
      inventory: Object.fromEntries(Object.entries(items.reduce((m, item) => (m[item.type] = (m[item.type] || 0) + 1, m), {})).sort()),
      languagePairs: new Set(items.map(item => item.languagePairId).filter(Boolean)).size,
      diagrams: items.filter(item => item.diagramSource).length, mergedEquivalent: items.filter(item => item.presentation === 'merged_equivalent').length, estimates: {} };
    for (const code of ['auto', 'keep']) {
      const started = Date.now();
      try {
        const result = estimatePageRecommendation({ inputKind: input.kind, source: loaded.source, prompt: input.kind === 'prompt' ? input.prompt : '', generationPolicy: policy(code) });
        const sections = (result.sectionAllocation || []).filter(section => !/^(?:table of contents|contents|目录)/iu.test(section.title));
        const body = result.recommended - 1;
        row.estimates[code] = { recommended: result.recommended, range: result.range, basis: result.estimationBasis, ms: Date.now() - started,
          warnings: (result.warnings || []).map(item => item.code), assumptions: (result.assumptions || []).map(item => `${item.topic}:${item.decision}`),
          sections: sections.length,
          // C1/C2 are Phase 3 targets; recorded here as the baseline.
          sectionsBelowOnePage: body >= sections.length ? sections.filter(section => section.slides < 1).length : null,
          maxSectionPages: sections.length ? Math.max(...sections.map(section => section.slides)) : null,
          allocation: sections.map(section => [section.title.split('|')[0].trim().slice(0, 48), section.slides]) };
      } catch (error) { row.estimates[code] = { error: String(error.message).slice(0, 300) }; }
    }
    rows.push(row);
  }
  fs.writeFileSync(path.join(outDir, 'estimate.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  return rows;
}

// ---------------------------------------------------------------- inspect
async function inspectMode() {
  const templateById = new Map(matrix.templates.map(item => [item.id, item]));
  const inputById = new Map(matrix.inputs.map(item => [item.id, item]));
  const templateInspections = new Map();
  const templateInspection = async id => {
    const template = templateById.get(id); if (!template?.path || !fs.existsSync(resolvePath(template.path))) return null;
    if (!templateInspections.has(id)) templateInspections.set(id, await inspectPptx(resolvePath(template.path)));
    return templateInspections.get(id);
  };
  const sourceText = id => { const input = inputById.get(id); const file = resolvePath(input?.path); return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; };
  const decks = [];
  for (const [group, list] of [['gamma', matrix.gammaReferences], ['module', matrix.moduleOutputs]]) for (const deck of list) {
    const file = resolvePath(deck.path);
    if (!fs.existsSync(file)) { decks.push({ group, id: deck.id, skipped: 'missing file' }); continue; }
    const inspection = await inspectPptx(file);
    const template = deck.template ? await templateInspection(deck.template) : null;
    decks.push({ group, id: deck.id, template: deck.template, templateClass: deck.templateClass || templateById.get(deck.template)?.templateClass || 'unknown',
      input: deck.input, llm: deck.llm || 'gamma', sha256: sha(fs.readFileSync(file)), metrics: deckMetrics(inspection, { template, sourceText: deck.input ? sourceText(deck.input) : '' }) });
  }
  const templates = [];
  for (const template of matrix.templates.filter(item => item.path)) {
    const inspection = await templateInspection(template.id);
    if (inspection) templates.push({ id: template.id, templateClass: template.templateClass, metrics: deckMetrics(inspection) });
  }
  fs.writeFileSync(path.join(outDir, 'inspect.json'), JSON.stringify({ generatedAt: new Date().toISOString(), decks, templates, domReferences: matrix.domReferences }, null, 2));
  if (flag('write-bands')) writeBands(decks);
  return { decks, templates };
}

function writeBands(decks) {
  const samples = decks.filter(deck => deck.group === 'gamma' && deck.metrics).map(deck => ({ id: deck.id, templateClass: deck.templateClass, input: deck.input,
    slides: deck.metrics.slides, bodyUnits: deck.metrics.density.bodyUnits, latinWords: deck.metrics.density.latinWords, cjkChars: deck.metrics.density.cjkChars,
    verticalFill: deck.metrics.density.verticalFill, bodyFontSizes: deck.metrics.density.bodyFontSizes, mediaPerContentSlide: deck.metrics.media.perContentSlide,
    mediaConservationVsTemplate: deck.metrics.media.conservation ?? null, longestTextOnlyRun: deck.metrics.media.longestTextOnlyRun }));
  const classes = {};
  for (const sample of samples) (classes[sample.templateClass] ||= []).push(sample.id);
  const bands = { version: 1, generatedAt: new Date().toISOString(), basis: 'Gamma PPTX exports measured by apps/cowork-server/scripts/ppt-balance (body = text <26pt excluding cover; media classes by size). Observations, not hard limits.',
    samples, domSamples: matrix.domReferences, classes };
  fs.writeFileSync(path.join(serverRoot, 'lib/ppt-gamma-reference-bands.json'), JSON.stringify(bands, null, 2) + '\n');
}

// ---------------------------------------------------------------- run
function cliAdapter(PPT_SYSTEM_PROMPT, parseModelJson) {
  const bin = process.env.PPT_EVAL_CLAUDE_BIN;
  if (!bin) throw new Error('cli adapter needs PPT_EVAL_CLAUDE_BIN (a local Claude Code CLI signed in with your own account or ANTHROPIC_API_KEY)');
  return async (project, prompt) => new Promise((resolve, reject) => {
    const child = spawn(bin, ['-p', '--output-format', 'json', '--system-prompt', PPT_SYSTEM_PROMPT, '--tools', '', '--disallowedTools', 'mcp__*',
      ...(process.env.PPT_EVAL_MODEL ? ['--model', process.env.PPT_EVAL_MODEL] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err = (err + data).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`model CLI exit ${code}: ${err}`));
      try { const result = JSON.parse(out); if (result.is_error) throw new Error(result.result || 'model error'); resolve(parseModelJson(result.result)); }
      catch (error) { reject(error); }
    });
    child.stdin.end(prompt);
  });
}

async function runMode() {
  const input = matrix.inputs.find(item => item.id === option('input'));
  const template = matrix.templates.find(item => item.id === option('template'));
  const adapterName = option('adapter', 'dry');
  if (!input || !template) throw new Error('run needs --input and --template ids from matrix.json');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-balance-run-'));
  process.env.COWORK_STATE_DIR = stateDir;
  const [{ handlePpt, _internals: api }, store, { localPptRuntime }, prompts, fidelity, renderer, pdf, source, templates, importer] = await Promise.all([
    import('../../lib/ppt-api.mjs'), import('../../lib/ppt-store.mjs'), import('../../test/ppt-local-runtime.mjs'), import('../../lib/ppt-prompt-contracts.mjs'),
    import('../../lib/ppt-template-fidelity.mjs'), import('../../lib/ppt-render.mjs'), import('../../lib/ppt-pdf.mjs'), import('../../lib/ppt-source.mjs'),
    import('../../lib/ppt-template.mjs'), import('../../lib/ppt/import-pptx.mjs')]);
  const runtime = localPptRuntime(path.join(stateDir, 'workspace'), python);
  const calls = [];
  const adapters = {
    dry: async (_project, prompt) => { calls.push({ chars: prompt.length }); throw new Error(`dry adapter: wiring reached the first model call (${prompt.length} chars)`); },
    cli: null, routine: api.defaultDeps.modelCall,
  };
  const adapter = adapterName === 'cli' ? cliAdapter(prompts.PPT_SYSTEM_PROMPT, api.parseModelJson) : adapters[adapterName];
  if (!adapter) throw new Error(`unknown adapter ${adapterName}`);
  const uid = 'ppt-balance-eval';
  const deps = { ...api.defaultDeps,
    modelCall: async (project, prompt, activity, log, options = {}) => { const started = Date.now(); const value = await adapter(project, prompt, activity, log, options); calls.push({ node: options.nodeKey || 'outline', chars: prompt.length, ms: Date.now() - started }); return value; },
    analyzeTemplate: (u, id, extension, bytes) => templates.analyzeTemplate(u, id, extension, bytes, runtime.io),
    importTemplateIR: (project, bytes, hash) => importer.importEditablePptx(project, bytes, hash, runtime.io),
    prepareTemplateFidelity: (project, bytes, hash, tpl) => fidelity.prepareTemplateFidelity(project, bytes, hash, tpl, { importPptx: (p, b, h) => importer.importEditablePptx(p, b, h, runtime.io), writeFile: runtime.writeFile }),
    renderPptx: project => project.templateFidelity?.mode === 'preserve' ? fidelity.renderTemplatePptx(project, runtime.io) : renderer.renderPptx(project, runtime.io),
    renderPdf: project => pdf.renderPdf(project, runtime.io),
    extractFile: (project, name, bytes) => source.extractFile(project, name, bytes, runtime.io),
    readFile: async (id, value) => { const bytes = await runtime.readFile(id, value); return { stream: Readable.from(bytes), size: bytes.length }; },
    removeContainer: async () => {} };
  const request = async (method, route, data) => {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]); req.method = method; let result;
    await handlePpt(req, new URL(`http://local${route}`), { uid, deps, activity: () => {}, log: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
    return result;
  };
  const waitFor = async (id, statuses) => {
    for (let i = 0; i < 36000; i++) { const p = store.get(uid, id); if (statuses.includes(p?.status)) return p; if (['failed', 'cancelled'].includes(p?.status)) return p; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('timed out');
  };
  const report = { input: input.id, template: template.id, adapter: adapterName, startedAt: new Date().toISOString(), calls };
  try {
    let templateId = template.builtin;
    if (!templateId) {
      const bytes = fs.readFileSync(resolvePath(template.path));
      const uploaded = await request('POST', '/ppt/templates', { fileName: path.basename(template.path), name: template.id, fileBase64: bytes.toString('base64') });
      if (uploaded.status !== 201) throw new Error(`template upload ${uploaded.status}: ${JSON.stringify(uploaded.body).slice(0, 300)}`);
      templateId = uploaded.body.template.id;
    }
    const loaded = await loadSource(input);
    const body = { inputKind: input.kind, prompt: input.kind === 'prompt' ? input.prompt : '', template: templateId, generationPolicy: policy(),
      model: process.env.PPT_EVAL_MODEL || '', configId: 'ppt-balance-eval', ...(option('pages') ? { pages: Number(option('pages')) } : {}),
      ...(input.kind === 'paste' ? { text: loaded.text } : input.kind === 'file' ? { fileName: path.basename(input.path), fileBase64: loaded.bytes.toString('base64') } : {}) };
    const created = await request('POST', '/ppt/projects', body);
    if (created.status !== 201) throw new Error(`project create ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`);
    const id = created.body.project.id;
    let project = await waitFor(id, ['outline_ready']);
    const { estimatePageRecommendation } = await import('../../lib/ppt-planning.mjs');
    const estimate = estimatePageRecommendation(project);
    report.pages = project.pages; report.pageDecision = project.pageDecision?.mode || null;
    report.estimate = { recommended: estimate.recommended, range: estimate.range, assumptions: estimate.assumptions, warnings: estimate.warnings };
    if (project.status !== 'outline_ready') throw new Error(`${project.status}: ${project.error}`);
    report.outlinePages = project.outline.length;
    const generated = await request('POST', `/ppt/projects/${id}/generate`);
    if (generated.status !== 202) throw new Error(`generate ${generated.status}: ${JSON.stringify(generated.body).slice(0, 300)}`);
    project = await waitFor(id, ['completed', 'quality_blocked']);
    report.status = project.status; report.quality = project.quality?.status || null;
    report.issues = (project.quality?.deterministic?.issues || []).slice(0, 40).map(issue => ({ code: issue.code, severity: issue.severity, slideId: issue.slideId }));
    const exported = await deps.renderPptx(project);
    const file = path.join(outDir, `run-${input.id}-${template.id}.pptx`);
    fs.copyFileSync(exported.path || runtime.host(project, '/workspace/presentation.pptx'), file);
    const templateFile = template.path ? resolvePath(template.path) : null;
    report.output = file;
    report.metrics = deckMetrics(await inspectPptx(file), { template: templateFile ? await inspectPptx(templateFile) : null, sourceText: loaded.text });
  } catch (error) {
    report.error = String(error.message).slice(0, 600);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, `run-${input.id}-${template.id}-${adapterName}.json`), JSON.stringify(report, null, 2));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  return report;
}

const handlers = { estimate: estimateMode, inspect: inspectMode, run: runMode };
if (!handlers[mode]) { console.error('usage: ppt-balance-eval.mjs estimate|inspect|run [options]'); process.exit(2); }
const result = await handlers[mode]();
console.log(JSON.stringify({ mode, outDir, summary: Array.isArray(result) ? result.length : result?.decks ? result.decks.length : result?.error || result?.status }, null, 0));
