/** M1 PPT Workspace API and durable, server-side job orchestration.
 * All model calls and PPTX rendering run in a Cowork container. Project JSON
 * lives on the server data disk, so a second signed-in desktop sees the same
 * project and can export its completed presentation. */
import * as store from './ppt-store.mjs';
import * as orch from './orchestrator.mjs';
import * as files from './files.mjs';
import { runRoutine } from './routine-runner.mjs';
import { renderPptx } from './ppt/exporters/pptx.mjs';
import { renderPdf } from './ppt/exporters/pdf.mjs';
import { extractFile, normalizePaste, validateFile, sha256 } from './ppt-source.mjs';
import { BUILT_INS, templateFor, validateTemplate, analyzeTemplate, snapshotTemplate } from './ppt-template.mjs';
import { normalizeBlocks, normalizeSourceImages } from './ppt-blocks.mjs';
import { applyLayoutRegistry, LAYOUTS } from './ppt-layout.mjs';
import { boundedAll, dagNodeId, nodeRecord } from './ppt-dag.mjs';
import { deckReviewPrompt, deterministicReview, finalQualityReport, inspectMedia, inspectSourceForSlide, normalizeModelReview, repairProject } from './ppt-quality.mjs';
import { ensureDeckV3, ensureProjectV3, newId as newIrId } from './ppt/ir.mjs';
import { buildRenderTree } from './ppt/render-tree.mjs';
import { emitRunProgress, completeRun, recoverRun, startRun, transitionNode } from './ppt/run-service.mjs';
import { getProject as getStructuredProject, saveProject as saveStructuredProject, saveRevision } from './ppt/repository.mjs';
import { handleStructuredPpt } from './ppt/api.mjs';
import { importEditablePptx, renderImportedPptx } from './ppt/import-pptx.mjs';
import { enrichAssetRefs } from './ppt/assets.mjs';

const running = new Set();
const editing = new Set();
const MAX_PROMPT = 12000;
const MAX_TEXT = 160;
const PPT_NODE_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.PPT_NODE_CONCURRENCY) || 3));
const PPT_RE = /^\/ppt\/projects(?:\/([a-f0-9]{32}))?(?:\/(outline|generate|retry|export|pdf|source|duplicate|trash|restore|permanent|versions|rewrite))?$/i;
const FOLDER_RE = /^\/ppt\/folders(?:\/([a-f0-9]{32}))?$/i;
const TEMPLATE_RE = /^\/ppt\/templates(?:\/(violet|blue|light|marketing|education|[a-f0-9]{32}))?$/i;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function bounded(value, max, field, required = true) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = value.trim();
  if ((required && !s) || s.length > max) throw new HttpError(400, `${field} length invalid`);
  return s;
}
function pages(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 3 || n > 50) throw new HttpError(400, 'pages must be between 3 and 50');
  return n;
}
function parseModelJson(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); }
  catch {
    const first = raw.indexOf('{'); const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
    try { return JSON.parse(raw); }
    catch { throw new Error('模型未返回有效的结构化内容，请重试'); }
  }
}
function sourceFromDeck(base) {
  const segments = (base.deck?.slides || []).map((slide, index) => ({ id: String(index + 1), location: `旧版第 ${index + 1} 页`, text: `${slide.title}\n${(slide.bullets || []).join('\n')}` }));
  return { kind: 'base', name: base.title, text: segments.map(s => s.text).join('\n\n'), segments };
}
function mergeSources(parts) {
  const segments = parts.flatMap(({ origin, info }) => (info.segments || []).map((item, index) => ({
    id: `${origin === 'base' ? 'B' : 'U'}${index + 1}`, origin,
    location: `${origin === 'base' ? '旧版' : '进展'} · ${item.location}`, text: item.text,
  })));
  return { kind: 'update', name: parts.map(p => p.info.name).join(' + '), text: segments.map(s => s.text).join('\n\n').slice(0, 80000), segments, truncated: parts.some(p => p.info.truncated) };
}
function normalizeOutline(value, count, source, update = null) {
  if (!Array.isArray(value?.slides) || value.slides.length !== count) throw new HttpError(400, `大纲需要恰好 ${count} 页`);
  const validRefs = new Set((source?.segments || []).map(s => s.id));
  const usedBaseIds = new Set();
  return value.slides.map((s, index) => {
    if (!s || typeof s !== 'object') throw new HttpError(400, `slide ${index + 1} invalid`);
    const proposedBaseId = s.change === 'add' ? null : s.baseSlideId;
    if (update && proposedBaseId && !update.baseSnapshot?.deck?.slides.some(slide => slide.id === proposedBaseId)) throw new HttpError(400, 'unknown base slide id');
    const baseSlideId = update && typeof proposedBaseId === 'string' && update.baseSnapshot?.deck?.slides.some(slide => slide.id === proposedBaseId) ? proposedBaseId : null;
    if (baseSlideId && usedBaseIds.has(baseSlideId)) throw new HttpError(400, 'one old slide may only map to one new slide');
    if (baseSlideId) usedBaseIds.add(baseSlideId);
    let change = update ? (baseSlideId ? (s.change === 'keep' ? 'keep' : 'rewrite') : 'add') : undefined;
    const base = baseSlideId ? update.baseSnapshot.deck.slides.find(slide => slide.id === baseSlideId) : null;
    const title = bounded(s.title, MAX_TEXT, `slide ${index + 1} title`);
    const focus = bounded(s.focus || s.summary || s.title, 360, `slide ${index + 1} focus`);
    const oldFocus = update?.baseSnapshot.outline?.find(slide => slide.id === baseSlideId)?.focus;
    if (change === 'keep' && (title !== base.title || (oldFocus && focus !== oldFocus))) change = 'rewrite';
    return { id: typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s.id) ? s.id : newIrId('slide'), title,
      focus,
      section: bounded(s.section || s.title, MAX_TEXT, `slide ${index + 1} section`),
      refs: Array.isArray(s.refs) ? [...new Set(s.refs.map(String))].filter(ref => validRefs.has(ref)).slice(0, 10) : [],
      ...(update ? { baseSlideId, change } : {}) };
  });
}
function normalizeDeck(value, outline) {
  if (!Array.isArray(value?.slides) || value.slides.length !== outline.length) throw new HttpError(400, `内容需要恰好 ${outline.length} 页`);
  const deck = {
    schemaVersion: 1,
    slides: value.slides.map((s, index) => {
      if (!s || typeof s !== 'object') throw new HttpError(400, `slide ${index + 1} invalid`);
      if (!Array.isArray(s.bullets) || s.bullets.length > 6) throw new HttpError(400, `第 ${index + 1} 页要点无效`);
      if (s.bullets.reduce((n, b) => n + (typeof b === 'string' ? b.length : 0), 0) > 500) {
        throw new HttpError(400, `第 ${index + 1} 页文字过多，请缩短要点`);
      }
      let blocks;
      try { blocks = normalizeBlocks(s.blocks); } catch (error) { throw new HttpError(400, `slide ${index + 1}: ${error.message}`); }
      if (blocks.length && (s.bullets.length > 3 || s.bullets.join('').length > 180)) throw new HttpError(400, `slide ${index + 1}: visual slide allows at most 3 short bullets`);
      const layout = s.layout || 'text-first';
      if (!['text-first', 'visual-first'].includes(layout)) throw new HttpError(400, `slide ${index + 1}: invalid layout`);
      const layoutId = s.layoutId === undefined ? undefined : bounded(s.layoutId, 40, `slide ${index + 1} layout`);
      if (layoutId && !LAYOUTS[layoutId]) throw new HttpError(400, `slide ${index + 1}: unknown layout`);
      return {
        id: outline[index].id,
        title: bounded(s.title, MAX_TEXT, `slide ${index + 1} title`),
        bullets: s.bullets.map((b) => bounded(b, 120, 'bullet')),
        sourceRefs: outline[index].refs || [],
        blocks,
        layout,
        ...(layoutId ? { layoutId } : {}),
      };
    }),
  };
  return ensureDeckV3(applyLayoutRegistry(deck));
}
function outlinePrompt(p) {
  if (p.update) {
    const base = p.update.baseSnapshot;
    const old = base.deck?.slides?.map(slide => `[${slide.id}] ${slide.title}: ${(slide.bullets || []).join('；')}`).join('\n').slice(0, 16000) || base.source?.text?.slice(0, 16000) || '';
    const progress = (p.source?.segments || []).filter(s => s.origin === 'progress').map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 14000);
    return `你是演示文稿版本更新规划器。仅分析旧版与用户提供的新进展；不搜索、不调用工具、不编造数字。旧版：${base.title}\n旧版内容：\n${old}\n最新进展：\n${progress || p.prompt}\n生成恰好 ${p.pages} 页的新大纲，返回唯一 JSON：{"slides":[{"section":"章节","title":"标题","focus":"主张","baseSlideId":"旧页 ID 或 null","change":"keep|rewrite|add","refs":["新进展来源 ID"]}]}。原样保留且内容不变的页用 keep 并保留原标题；需要改写的旧页用 rewrite；新页用 add。不得虚构旧页 ID 或来源编号。只输出 JSON。`;
  }
  if (p.source?.segments?.length) {
    const source = p.source.segments.map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 28000);
    return `你是演示文稿叙事规划器。只分析以下用户提供的来源，不搜索、不调用工具、不编造数字。文件名：${p.title}；页数：${p.pages}。\n来源（编号用于溯源）：\n${source}\n返回唯一 JSON：{"slides":[{"section":"章节标题","title":"本页标题","focus":"本页主张","refs":["来源编号"]}]}。slides 恰好 ${p.pages} 个；第一页封面，最后一页总结。相邻页面可以共享 section，每页 refs 只能引用上面实际存在的编号。只输出 JSON。`;
  }
  return `你是演示文稿叙事规划器。只做内容结构，不写代码、不调用工具、不生成 PPTX、不搜索网页。\n主题：${p.prompt}\n文件名：${p.title}\n页数：${p.pages}。\n返回唯一 JSON 对象，格式 {"slides":[{"title":"...","focus":"该页要表达的核心观点"}]}。slides 必须恰好 ${p.pages} 个，第一页是封面，最后一页是结论。每页有不同的逻辑作用，不要编造具体数字。只输出 JSON。`;
}
function contentPrompt(p, slide, index) {
  const plan = p.outline.map((s, i) => `${i + 1}. ${s.title} — ${s.focus}`).join('\n');
  if (p.update) {
    const old = slide.baseSlideId ? p.update.baseSnapshot.deck?.slides.find(item => item.id === slide.baseSlideId) : null;
    const selected = slide.refs?.length ? p.source.segments.filter(s => slide.refs.includes(s.id)) : p.source.segments.filter(s => s.origin === 'progress').slice(0, 8);
    const progress = selected.map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 16000);
    return `你是演示文稿更新文案编辑。仅写第 ${index + 1} 页，不调用工具、不编造数字。旧页：${old ? `${old.title}；${(old.bullets || []).join('；')}` : '新增'}。最新进展：${progress}\n已确认大纲：\n${plan}\n本页主张：${slide.focus}\n返回唯一 JSON：{"title":"...","bullets":["..."]}，0–5 条要点，每条不超过 70 字。只用旧版与最新进展中的事实。只输出 JSON。`;
  }
  if (p.source?.segments?.length) {
    const selected = slide.refs?.length ? p.source.segments.filter(s => slide.refs.includes(s.id)) : p.source.segments.slice(0, 8);
    const excerpts = selected.map(s => `[${s.id}] ${s.location}: ${s.text}`).join('\n').slice(0, 16000);
    return `你是演示文稿文案编辑。只用给定来源写第 ${index + 1} 页，不搜索、不调用工具、不编造数字、来源或单位。\n大纲：\n${plan}\n本页主张：${slide.focus}\n本页来源：\n${excerpts}\n返回唯一 JSON：{"title":"...","bullets":["..."]}。0–5 条要点，每条不超过 70 字；来源没有的事实不要写。只输出 JSON。`;
  }
  return `你是演示文稿文案编辑。只写文本，不调用工具、不写代码、不生成坐标或 PPTX。不得编造数字或来源。\n用户主题：${p.prompt}\n已确认大纲：\n${plan}\n当前任务只写第 ${index + 1} 页，标题：${slide.title}；核心观点：${slide.focus}。\n返回唯一 JSON 对象 {"title":"...","bullets":["..."]}。本页 0–5 条简明要点；封面可以 0 条。每条不超过 70 字。只输出 JSON。`;
}
async function modelCall(p, prompt, activity, log, options = {}) {
  const sid = options.nodeKey ? sha256(Buffer.from(`${p.id}:${options.nodeKey}`)).slice(0, 32) : p.id;
  try {
    const result = await runRoutine({ sid, uid: p.uid, kind: orch.KIND_PPT, prompt, model: p.model, configId: p.configId, activity, log });
    if (!result.ok) throw new Error(result.error || `模型任务失败：${result.status}`);
    return parseModelJson(result.resultText);
  } finally {
    if (sid !== p.id) await orch.removeContainer(sid, { keepVolume: false }).catch(() => {});
  }
}
const defaultDeps = { modelCall, renderPptx, renderPdf, extractFile, analyzeTemplate, readFile: files.readFile, removeContainer: orch.removeContainer };
function normalizeSlide(value, outlineSlide) {
  const slide = normalizeDeck({ slides: [value] }, [outlineSlide]).slides[0];
  if (value?.layoutId === undefined) { delete slide.layoutId; delete slide.layoutRef; }
  return slide;
}
function applySourceImages(deck, source) {
  const images = source?.images || [];
  if (!images.length || !deck?.slides?.length) return deck;
  // Source image placement happens before IR v3 becomes canonical. Rebuild the
  // affected slides from the compatibility projection so the image nodes are
  // created once with stable block IDs instead of being shadowed by stale nodes.
  const slides = deck.slides.map(({ nodes: _nodes, nodeOrder: _nodeOrder, ...slide }) => ({ ...slide, blocks: [...(slide.blocks || [])] }));
  const targets = slides.length > 1 ? slides.slice(1) : slides;
  for (let index = 0; index < images.length; index++) {
    const slide = targets[Math.floor(index / 2) % targets.length];
    if (slide.blocks.length >= 2) throw new Error('not enough slides for pasted images');
    slide.blocks.push(images[index]);
    slide.layout = 'visual-first';
    let remaining = 180;
    slide.bullets = (slide.bullets || []).slice(0, 3).map(bullet => {
      const value = bullet.slice(0, remaining);
      remaining -= value.length;
      return value;
    }).filter(Boolean);
  }
  return { ...deck, slides };
}

function persistDagNode(uid, id, nodeId, status, patch = {}) {
  const project = store.get(uid, id);
  if (!project) return null;
  project.dagNodes ||= {};
  project.dagNodes[nodeId] = nodeRecord(status, project.dagNodes[nodeId], patch);
  store.save(project);
  try { transitionNode(project, nodeId, status === 'done' ? 'completed' : status, patch); } catch {}
  return project.dagNodes[nodeId];
}

function ensureProjectTemplate(project) {
  if (!project) return project;
  if (project.templateSpec?.fonts && project.templateSpec?.palette) return project;
  const template = templateFor(project.uid, project.template, store);
  project.templateSpec = snapshotTemplate(template);
  return project;
}

function deterministicGate(project, modelReview = project.quality?.modelReview || { missing: [], repeated: [], conflicts: [], unsupported: [] }) {
  project = ensureProjectTemplate(project);
  const initial = deterministicReview(project);
  const repaired = repairProject(project, initial);
  const report = finalQualityReport(repaired.review, repaired.repairs, modelReview);
  repaired.project.quality = report;
  return repaired.project;
}
function qualityError(project) {
  return project.quality?.deterministic?.issues?.filter(item => item.severity === 'error').slice(0, 3).map(item => item.message).join('；') || '';
}
function fail(uid, id, stage, error, log) {
  const p = store.get(uid, id);
  if (!p) return;
  if (p.status === 'cancelled') return;
  p.status = 'failed'; p.stage = stage;
  p.error = String(error?.message || error).slice(0, 400);
  store.save(p);
  try { transitionNode(p, stage, 'failed', { error: p.error }); emitRunProgress(p, 'run.failed', { stage, error: p.error }); } catch {}
  log(`ppt ${id} ${stage} failed: ${p.error}`);
}
function startIngest(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  void (async () => {
    let next = false;
    try {
      const p = store.get(uid, id);
      if (!p || p.status !== 'ingesting') return;
      try { transitionNode(p, 'source', 'running'); } catch {}
      let source;
      let baseSource = null;
      if (p.update) {
        const parts = [];
        if (p.update.baseFile) { baseSource = await deps.extractFile(p, p.update.baseFile.name, store.readInput(uid, id, 'base')); parts.push({ origin: 'base', info: baseSource }); }
        else if (p.update.baseSnapshot.deck) parts.push({ origin: 'base', info: sourceFromDeck(p.update.baseSnapshot) });
        else if (p.update.baseSnapshot.source) parts.push({ origin: 'base', info: p.update.baseSnapshot.source });
        if (p.update.progressKind === 'file') parts.push({ origin: 'progress', info: await deps.extractFile(p, p.update.progressFile.name, store.readInput(uid, id, 'progress')) });
        else if (p.update.progressKind === 'paste') parts.push({ origin: 'progress', info: p.update.progressSource });
        else parts.push({ origin: 'progress', info: normalizePaste(p.update.progressText) });
        source = mergeSources(parts);
      } else source = await deps.extractFile(p, p.source.name, store.readSource(uid, id));
      const latest = store.get(uid, id);
      if (!latest || latest.status !== 'ingesting') return;
      if (baseSource) latest.update.baseSnapshot.source = baseSource;
      latest.source = source; latest.status = 'outlining'; latest.stage = 'outline'; latest.error = '';
      store.save(latest); next = true;
      try { transitionNode(latest, 'source', 'completed', { segments: source.segments?.length || 0 }); } catch {}
    } catch (error) { fail(uid, id, 'ingest', error, log); }
    finally { running.delete(id); if (next) startOutline(uid, id, activity, log, deps); }
  })();
}
function startOutline(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  void (async () => {
    try {
      const p = store.get(uid, id);
      if (!p || p.status !== 'outlining') return;
      try { transitionNode(p, 'outline', 'running'); } catch {}
      const outline = normalizeOutline(await deps.modelCall(p, outlinePrompt(p), activity, log), p.pages, p.source, p.update);
      const current = store.get(uid, id);
      if (!current || current.status !== 'outlining') return;
      current.outline = outline; current.status = 'outline_ready'; current.stage = 'outline'; current.error = '';
      current.diff = diffSummary(current);
      store.save(current);
      try { transitionNode(current, 'outline', 'completed', { slideCount: outline.length }); emitRunProgress(current, 'outline.ready', { outline }); } catch {}
    } catch (error) { fail(uid, id, 'outline', error, log); }
    finally { running.delete(id); }
  })();
}
function startGeneration(uid, id, activity, log, deps = defaultDeps) {
  if (running.has(id)) return;
  running.add(id);
  void (async () => {
    try {
      const p = ensureProjectTemplate(store.get(uid, id));
      if (!p || p.status !== 'generating') return;
      try { emitRunProgress(p, 'generation.started', { slideCount: p.outline.length }); } catch {}
      p.stage = 'source-check'; p.nodes ||= {}; p.dagNodes ||= {}; store.save(p);
      if (p.update?.baseSnapshot?.deck) {
        for (const slide of p.outline.filter(slide => slide.change === 'keep' && slide.baseSlideId)) {
          if (p.nodes[slide.id]?.status === 'done') continue;
          const original = p.update.baseSnapshot.deck.slides.find(item => item.id === slide.baseSlideId);
          if (original) {
            p.nodes[slide.id] = { status: 'done', attempts: 0, slide: { ...original, id: slide.id, sourceRefs: slide.refs } };
            p.dagNodes[dagNodeId('content', slide.id)] = nodeRecord('done', p.dagNodes[dagNodeId('content', slide.id)], { reused: true });
          }
        }
        store.save(p);
      }

      await boundedAll(p.outline, PPT_NODE_CONCURRENCY, async (slide) => {
        const nodeId = dagNodeId('source', slide.id);
        const existing = store.get(uid, id)?.dagNodes?.[nodeId];
        if (existing?.status === 'done') return existing.result;
        persistDagNode(uid, id, nodeId, 'running');
        const latest = store.get(uid, id);
        const issues = inspectSourceForSlide(latest, slide);
        const hard = issues.filter(item => item.severity === 'error');
        persistDagNode(uid, id, nodeId, 'done', { result: { passed: hard.length === 0, issues } });
        return issues;
      });

      const contentSlides = p.outline.map((slide, index) => ({ slide, index })).filter(({ slide }) => store.get(uid, id)?.nodes?.[slide.id]?.status !== 'done');
      const sourceImages = p.source?.images || [];
      const readyNodes = [
        ...contentSlides.map(item => ({ kind: 'content', ...item })),
        ...sourceImages.map((image, index) => ({ kind: 'media', image, index })),
      ];
      await boundedAll(readyNodes, PPT_NODE_CONCURRENCY, async (work) => {
        if (work.kind === 'media') {
          const targetIndex = p.outline.length > 1 ? 1 + Math.floor(work.index / 2) % (p.outline.length - 1) : 0;
          const slideId = p.outline[targetIndex].id;
          const nodeId = dagNodeId('media', work.image.id);
          const existing = store.get(uid, id)?.dagNodes?.[nodeId];
          if (existing?.status === 'done') return existing.result;
          persistDagNode(uid, id, nodeId, 'running', { slideId });
          const issues = inspectMedia(work.image, slideId);
          const hard = issues.filter(item => item.severity === 'error');
          persistDagNode(uid, id, nodeId, 'done', { result: { slideId, passed: hard.length === 0, issues } });
          return issues;
        }
        const { slide, index } = work;
        const nodeId = dagNodeId('content', slide.id);
        const snapshot = store.get(uid, id);
        if (!snapshot || snapshot.status !== 'generating') throw new Error('generation stopped');
        if (snapshot.nodes?.[slide.id]?.status === 'done') return snapshot.nodes[slide.id].slide;
        snapshot.stage = 'content'; snapshot.nodes ||= {};
        snapshot.nodes[slide.id] = { status: 'running', attempts: (snapshot.nodes[slide.id]?.attempts || 0) + 1 };
        snapshot.dagNodes ||= {}; snapshot.dagNodes[nodeId] = nodeRecord('running', snapshot.dagNodes[nodeId]);
        store.save(snapshot);
        try {
          const content = normalizeSlide(await deps.modelCall(snapshot, contentPrompt(snapshot, slide, index), activity, log, { nodeKey: nodeId }), slide);
          const latest = store.get(uid, id);
          if (!latest || latest.status !== 'generating') throw new Error('generation stopped');
          latest.nodes[slide.id] = { ...latest.nodes[slide.id], status: 'done', slide: content };
          latest.dagNodes[nodeId] = nodeRecord('done', latest.dagNodes[nodeId]);
          store.save(latest);
          return content;
        } catch (error) {
          persistDagNode(uid, id, nodeId, 'failed', { error: String(error?.message || error).slice(0, 300) });
          throw error;
        }
      });

      let current = store.get(uid, id);
      if (!current || current.status !== 'generating') return;
      current.deck = applyLayoutRegistry(applySourceImages({ schemaVersion: 2, slides: current.outline.map((s) => current.nodes[s.id].slide) }, current.source));
      current.deck = ensureDeckV3(current.deck);
      enrichAssetRefs(current);
      current.renderTree = buildRenderTree(current);
      current.stage = 'review'; store.save(current);
      try { transitionNode(current, 'content', 'completed'); transitionNode(current, 'media', 'completed'); transitionNode(current, 'layout', 'completed'); transitionNode(current, 'preview', 'completed'); transitionNode(current, 'quality', 'running'); } catch {}

      const initialReview = deterministicReview(current);
      const reviewNodeId = 'review:deck';
      let modelReview = current.quality?.modelReview || current.dagNodes?.[reviewNodeId]?.result;
      if (!modelReview) {
        persistDagNode(uid, id, reviewNodeId, 'running');
        const reviewStarted = Date.now();
        try {
          const rawReview = await deps.modelCall(current, deckReviewPrompt(current), activity, log, { nodeKey: reviewNodeId });
          modelReview = normalizeModelReview(rawReview, current.deck.slides.map(slide => slide.id));
          persistDagNode(uid, id, reviewNodeId, 'done', { durationMs: Date.now() - reviewStarted, result: modelReview });
        } catch (error) {
          persistDagNode(uid, id, reviewNodeId, 'failed', { durationMs: Date.now() - reviewStarted, error: String(error?.message || error).slice(0, 300) });
          throw error;
        }
      }

      current = store.get(uid, id);
      current.stage = 'repair'; store.save(current);
      try { transitionNode(current, 'quality', 'completed'); transitionNode(current, 'review', 'completed'); transitionNode(current, 'repair', 'running'); } catch {}
      const repaired = repairProject(current, initialReview);
      current = repaired.project;
      const reviewDuration = current.dagNodes?.[reviewNodeId]?.durationMs || 0;
      current.quality = finalQualityReport(repaired.review, repaired.repairs, modelReview, { reviewMs: reviewDuration });
      current.stage = 'publish'; store.save(current);
      try { transitionNode(current, 'repair', 'completed'); } catch {}
      if (repaired.review.hardErrors) {
        current.status = 'quality_blocked'; current.stage = 'repair';
        current.error = `PPT quality gate blocked publish: ${qualityError(current)}`;
        store.save(current);
        return;
      }
      persistDagNode(uid, id, 'publish:deck', 'running');
      const exportInfo = await deps.renderPptx(current);
      const finished = store.get(uid, id);
      if (!finished || finished.status !== 'generating') return;
      finished.exportBytes = exportInfo.bytes; finished.status = 'completed'; finished.stage = 'completed';
      finished.dagNodes['publish:deck'] = nodeRecord('done', finished.dagNodes['publish:deck'], { bytes: exportInfo.bytes });
      finished.error = ''; finished.revision = Math.max(1, Number(finished.revision || 0)); finished.draftRevision = finished.revision;
      finished.publishedRevision = finished.revision; finished.renderTree = buildRenderTree(finished); saveStructuredProject(finished); saveRevision(finished, 'initial-publish');
      try { transitionNode(finished, 'publish:deck', 'completed', { bytes: exportInfo.bytes }); transitionNode(finished, 'publish', 'completed', { bytes: exportInfo.bytes }); completeRun(finished, { revision: finished.revision }); } catch {}
    } catch (error) { fail(uid, id, 'generation', error, log); }
    finally { running.delete(id); }
  })();
}

export function recoverPptJobs(activity, log = () => {}, deps = defaultDeps) {
  for (const p of store.listPending()) {
    try { recoverRun(ensureProjectV3(p)); } catch {}
    if (p.status === 'ingesting') startIngest(p.uid, p.id, activity, log, deps);
    else if (p.status === 'outlining') startOutline(p.uid, p.id, activity, log, deps);
    else startGeneration(p.uid, p.id, activity, log, deps);
  }
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 24_000_000) throw new HttpError(413, 'request too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const data = JSON.parse(raw || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
    return data;
  } catch { throw new HttpError(400, 'invalid JSON object'); }
}

function folderName(value) { return bounded(value, 80, 'folder name'); }
function folderExists(uid, id) { return store.listFolders(uid).some(folder => folder.id === id); }
function folderSummary(uid) {
  const projects = store.list(uid).filter(project => !project.deletedAt);
  return store.listFolders(uid).map(folder => ({ ...folder, count: projects.filter(project => project.folderId === folder.id).length }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}
function listProjects(uid, url) {
  let projects = store.list(uid);
  const trash = url.searchParams.get('trash') === '1';
  projects = projects.filter(project => Boolean(project.deletedAt) === trash);
  const q = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  if (q) projects = projects.filter(project => `${project.title} ${(project.tags || []).join(' ')}`.toLocaleLowerCase().includes(q));
  if (url.searchParams.get('favorite') === '1') projects = projects.filter(project => project.favorite);
  if (url.searchParams.get('status')) projects = projects.filter(project => project.status === url.searchParams.get('status'));
  if (url.searchParams.has('folderId')) projects = projects.filter(project => (project.folderId || '') === url.searchParams.get('folderId'));
  const sort = url.searchParams.get('sort') || 'updated';
  const order = { updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt), created: (a, b) => b.createdAt.localeCompare(a.createdAt), name: (a, b) => a.title.localeCompare(b.title) }[sort];
  if (!order) throw new HttpError(400, 'invalid sort mode');
  return projects.sort((a, b) => Number(b.pinned) - Number(a.pinned) || order(a, b))
    .map(({ source, nodes, update, updateRequest, ...project }) => ({
      ...project,
      source: source ? { kind: source.kind, name: source.name, extension: source.extension } : null,
      deck: project.deck ? { slides: project.deck.slides.slice(0, 1).map(slide => ({ title: slide.title })) } : null,
      outline: project.outline?.slice(0, 1).map(slide => ({ title: slide.title })) || [],
    }));
}
async function permanentlyRemove(project, deps = defaultDeps) {
  if (running.has(project.id) || editing.has(project.id)) throw new HttpError(409, 'project has an active job');
  await deps.removeContainer(project.id, { keepVolume: false });
  store.remove(project.uid, project.id);
}
function setMetadata(project, data) {
  if (data.title !== undefined) {
    const title = bounded(data.title, 160, 'title');
    if (title === project.title) throw new HttpError(400, 'name is unchanged');
    project.title = title;
  }
  if (data.favorite !== undefined) {
    if (typeof data.favorite !== 'boolean') throw new HttpError(400, 'favorite must be boolean');
    project.favorite = data.favorite;
  }
  if (data.pinned !== undefined) {
    if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean');
    project.pinned = data.pinned;
  }
  if (data.folderId !== undefined) {
    if (data.folderId !== null && (typeof data.folderId !== 'string' || !folderExists(project.uid, data.folderId))) throw new HttpError(400, 'folder does not exist');
    project.folderId = data.folderId;
  }
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags) || data.tags.length > 10) throw new HttpError(400, 'invalid tags');
    project.tags = [...new Set(data.tags.map(tag => bounded(tag, 40, 'tag')))];
  }
  return store.save(project);
}
function createFolder(uid, name) {
  const folders = store.listFolders(uid);
  const value = folderName(name);
  if (folders.some(folder => folder.name.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new HttpError(409, 'folder name already exists');
  const folder = { id: store.newId(), name: value, pinned: false, createdAt: new Date().toISOString() };
  store.saveFolders(uid, [...folders, folder]);
  return folder;
}
function decodeFile(name, encoded, validator = validateFile) {
  if (typeof encoded !== 'string' || encoded.length > 11_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HttpError(400, 'invalid file payload');
  const bytes = Buffer.from(encoded, 'base64');
  let extension;
  try { extension = validator(name, bytes); } catch (error) { throw new HttpError(400, error.message); }
  return { bytes, extension, name, sha256: sha256(bytes) };
}
function resolveTemplate(uid, id) {
  try { return templateFor(uid, id, store); }
  catch (error) { throw new HttpError(400, error.message); }
}
function templateList(uid, url) {
  const pins = new Set(store.listTemplatePins(uid));
  let rows = [...BUILT_INS.map(item => ({ ...item, pinned: pins.has(item.id) })), ...store.listTemplates(uid)];
  const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  if (query) rows = rows.filter(item => `${item.name} ${item.category} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLocaleLowerCase().includes(query));
  const category = url.searchParams.get('category');
  if (category && category !== '全部') rows = rows.filter(item => item.category === category);
  return rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}
async function handleTemplates(req, id, uid, url, send, deps) {
  const customs = store.listTemplates(uid);
  if (!id && req.method === 'GET') return send(200, { templates: templateList(uid, url) });
  if (!id && req.method === 'POST') {
    const data = await body(req);
    if (customs.length >= 30) throw new HttpError(409, 'template limit is 30');
    const upload = decodeFile(data.fileName, data.fileBase64, validateTemplate);
    const templateId = store.newId();
    let analysis;
    try { analysis = await deps.analyzeTemplate(uid, templateId, upload.extension, upload.bytes); }
    catch (error) { throw new HttpError(422, String(error?.message || error).slice(0, 300)); }
    finally { await deps.removeContainer(templateId, { keepVolume: false }).catch(() => {}); }
    if (!analysis || !['mapped', 'reference'].includes(analysis.compatibility) || !Number.isInteger(analysis.pages) || analysis.pages < 1 || analysis.pages > 100) throw new HttpError(422, 'template analysis is invalid');
    const palette = analysis.compatibility === 'mapped' ? analysis.palette : null;
    if (palette && ['background', 'accent', 'foreground', 'muted'].some(key => !/^#[a-f0-9]{6}$/i.test(palette[key] || ''))) throw new HttpError(422, 'template colors are invalid');
    const fonts = analysis.compatibility === 'mapped' ? analysis.fonts : null;
    if (fonts && ['title', 'body', 'titleEastAsia', 'bodyEastAsia'].some(key => typeof fonts[key] !== 'string' || !fonts[key].trim() || fonts[key].length > 120)) throw new HttpError(422, 'template fonts are invalid');
    if (analysis.compatibility === 'mapped' && !fonts) throw new HttpError(422, 'mapped template must include extracted fonts');
    const item = { id: templateId, name: bounded(data.name || data.fileName.replace(/\.[^.]+$/, ''), 120, 'template name'), category: '我的模板',
      description: String(analysis.reason || '').slice(0, 300), kind: 'uploaded', compatibility: analysis.compatibility, version: 1,
      pages: analysis.pages, palette, fonts, sampleTitles: (analysis.sampleTitles || []).slice(0, 3), tags: ['自定义', '上传'], pinned: false,
      fileName: data.fileName, extension: upload.extension, sha256: upload.sha256, createdAt: new Date().toISOString() };
    store.writeTemplate(uid, templateId, upload.bytes);
    store.saveTemplates(uid, [...customs, item]);
    return send(201, { template: item });
  }
  const builtIn = BUILT_INS.find(row => row.id === id);
  if (builtIn && req.method === 'PATCH') {
    const data = await body(req);
    if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean');
    const pins = new Set(store.listTemplatePins(uid));
    if (data.pinned) pins.add(id); else pins.delete(id);
    store.saveTemplatePins(uid, [...pins]);
    return send(200, { template: { ...builtIn, pinned: data.pinned } });
  }
  const item = customs.find(row => row.id === id);
  if (!item) return send(404, { error: 'template not found' });
  if (req.method === 'PATCH') {
    const data = await body(req);
    if (data.pinned !== undefined) { if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean'); item.pinned = data.pinned; }
    if (data.name !== undefined) item.name = bounded(data.name, 120, 'template name');
    store.saveTemplates(uid, customs);
    return send(200, { template: item });
  }
  if (req.method === 'DELETE') {
    store.saveTemplates(uid, customs.filter(row => row.id !== id));
    store.removeTemplate(uid, id);
    return send(200, { ok: true });
  }
  return send(404, { error: 'not found' });
}
function diffSummary(project) {
  if (!project.update) return null;
  const used = new Set(project.outline.map(slide => slide.baseSlideId).filter(Boolean));
  return { kept: project.outline.filter(slide => slide.change === 'keep').length,
    rewritten: project.outline.filter(slide => slide.change === 'rewrite').length,
    added: project.outline.filter(slide => slide.change === 'add').length,
    removed: (project.update.baseSnapshot.deck?.slides || []).filter(slide => !used.has(slide.id)).map(slide => ({ id: slide.id, title: slide.title })) };
}
async function handleUpdates(req, uid, send, activity, log, deps) {
  if (req.method !== 'POST') return send(404, { error: 'not found' });
  const data = await body(req);
  const requestId = data.requestId === undefined ? null : bounded(data.requestId, 80, 'requestId');
  if (requestId && !/^[a-zA-Z0-9_-]+$/.test(requestId)) throw new HttpError(400, 'invalid requestId');
  const requestHash = requestId ? sha256(Buffer.from(JSON.stringify({ ...data, requestId: undefined }))) : null;
  if (requestId) {
    const prior = store.list(uid).find(item => item.updateRequest?.id === requestId);
    if (prior) {
      if (prior.updateRequest.hash !== requestHash) throw new HttpError(409, 'requestId was used for different inputs');
      return send(200, { project: prior });
    }
  }
  if (store.list(uid).filter(item => !item.deletedAt).length >= 50) throw new HttpError(409, 'workspace limit is 50 presentations');
  if (Boolean(data.baseProjectId) === Boolean(data.baseFileBase64)) throw new HttpError(400, 'choose exactly one base version');
  if (data.baseProjectId && (typeof data.baseProjectId !== 'string' || !/^[a-f0-9]{32}$/.test(data.baseProjectId))) throw new HttpError(400, 'invalid base project id');
  let baseProject = null; let baseFile = null;
  if (data.baseProjectId) {
    baseProject = store.get(uid, data.baseProjectId);
    if (!baseProject || baseProject.deletedAt || baseProject.status !== 'completed') throw new HttpError(404, 'completed base presentation not found');
  } else baseFile = decodeFile(data.baseFileName, data.baseFileBase64);
  const progressKind = data.progressKind || 'prompt';
  if (!['prompt', 'paste', 'file'].includes(progressKind)) throw new HttpError(400, 'invalid progress kind');
  const progressFile = progressKind === 'file' ? decodeFile(data.progressFileName, data.progressFileBase64) : null;
  const progressText = progressKind === 'file' ? '' : bounded(data.progressText, progressKind === 'paste' ? 80000 : MAX_PROMPT, 'latest progress');
  const progressSource = progressKind === 'paste' ? normalizePaste(progressText) : null;
  const template = resolveTemplate(uid, data.template || baseProject?.template || 'violet');
  const baseSnapshot = baseProject ? { id: baseProject.id, title: baseProject.title, deck: structuredClone(baseProject.deck), outline: structuredClone(baseProject.outline), source: null, revision: baseProject.revision }
    : { id: null, title: baseFile.name.replace(/\.[^.]+$/, ''), deck: null, outline: [], source: null, revision: 0 };
  const rootId = baseProject?.version?.rootId || baseProject?.id || null;
  const nextVersion = rootId ? Math.max(1, ...store.list(uid).filter(item => item.version?.rootId === rootId).map(item => item.version.number || 1)) + 1 : 1;
  const id = store.newId();
  const count = pages(data.pages ?? Math.min(30, Math.max(6, (baseProject?.pages || 8) + 2)));
  if (count < 6 || count > 30) throw new HttpError(400, 'update pages must be between 6 and 30');
  const update = { baseSnapshot, baseFile: baseFile && { name: baseFile.name, extension: baseFile.extension, sha256: baseFile.sha256 },
    progressKind, progressText, progressSource, progressFile: progressFile && { name: progressFile.name, extension: progressFile.extension, sha256: progressFile.sha256 } };
  const mustIngest = Boolean(baseFile || progressFile);
  const source = mustIngest ? null : mergeSources([{ origin: 'base', info: sourceFromDeck(baseSnapshot) },
    { origin: 'progress', info: progressSource || normalizePaste(progressText) }]);
  const project = { id, uid, title: `${baseSnapshot.title} · 更新版`.slice(0, 160), prompt: progressText || progressFile.name, pages: count,
    template: template.id, templateSpec: snapshotTemplate(template), inputKind: 'update',
    update, updateRequest: requestId ? { id: requestId, hash: requestHash } : null,
    version: { rootId: rootId || id, parentId: baseProject?.id || null, number: nextVersion, baseFileName: baseFile?.name || null }, source,
    sourceRevision: 1, outlineRevision: 0, status: mustIngest ? 'ingesting' : 'outlining', stage: mustIngest ? 'ingest' : 'outline',
    model: typeof data.model === 'string' ? data.model.slice(0, 120) : '', configId: bounded(data.configId, 120, 'configId'),
    outline: [], deck: null, nodes: {}, revision: 0, favorite: false, pinned: false, folderId: baseProject?.folderId || null,
    tags: ['更新', template.name.slice(0, 40)].slice(0, 10), deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (baseFile) store.writeInput(uid, id, 'base', baseFile.bytes);
  if (progressFile) store.writeInput(uid, id, 'progress', progressFile.bytes);
  store.save(project);
  if (mustIngest) startIngest(uid, id, activity, log, deps); else startOutline(uid, id, activity, log, deps);
  return send(201, { project });
}
async function handleFolders(req, id, uid, send) {
  const folders = store.listFolders(uid);
  if (!id) {
    if (req.method === 'GET') return send(200, { folders: folderSummary(uid) });
    if (req.method === 'POST') return send(201, { folder: createFolder(uid, (await body(req)).name) });
    return send(404, { error: 'not found' });
  }
  const folder = folders.find(item => item.id === id);
  if (!folder) return send(404, { error: 'not found' });
  if (req.method === 'PATCH') {
    const data = await body(req);
    if (data.name !== undefined) {
      const value = folderName(data.name);
      if (value === folder.name) throw new HttpError(400, 'name is unchanged');
      if (folders.some(item => item.id !== id && item.name.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new HttpError(409, 'folder name already exists');
      folder.name = value;
    }
    if (data.pinned !== undefined) {
      if (typeof data.pinned !== 'boolean') throw new HttpError(400, 'pinned must be boolean');
      folder.pinned = data.pinned;
    }
    store.saveFolders(uid, folders);
    return send(200, { folder });
  }
  if (req.method === 'DELETE') {
    for (const project of store.list(uid).filter(project => project.folderId === id)) { project.folderId = null; store.save(project); }
    store.saveFolders(uid, folders.filter(item => item.id !== id));
    return send(200, { ok: true });
  }
  return send(404, { error: 'not found' });
}

async function handleBulk(req, uid, send, deps) {
  if (req.method !== 'POST') return send(404, { error: 'not found' });
  const data = await body(req);
  if (!Array.isArray(data.ids) || data.ids.length < 1 || data.ids.length > 100 || new Set(data.ids).size !== data.ids.length || data.ids.some(id => !/^[a-f0-9]{32}$/.test(id))) throw new HttpError(400, 'invalid project ids');
  const projects = data.ids.map(id => store.get(uid, id));
  if (projects.some(project => !project)) return send(404, { error: 'not found' });
  if (!['move', 'trash', 'restore', 'permanent'].includes(data.action)) throw new HttpError(400, 'invalid bulk action');
  if (data.action === 'move' && data.folderId !== null && !folderExists(uid, data.folderId)) throw new HttpError(400, 'folder does not exist');
  if (data.action === 'permanent' && projects.some(project => !project.deletedAt || running.has(project.id) || editing.has(project.id))) throw new HttpError(409, 'projects must be in trash and idle');
  if (data.action === 'restore' && store.list(uid).filter(project => !project.deletedAt).length + projects.filter(project => project.deletedAt).length > 50) throw new HttpError(409, 'workspace limit is 50 presentations');
  const at = new Date().toISOString();
  for (const project of projects) {
    if (data.action === 'move') project.folderId = data.folderId;
    if (data.action === 'trash') project.deletedAt = at;
    if (data.action === 'restore') project.deletedAt = null;
    if (data.action === 'permanent') await permanentlyRemove(project, deps);
    else store.save(project);
  }
  return send(200, { ok: true, count: projects.length });
}

export async function handlePpt(req, url, { uid, send, res, readBody, activity, log = () => {}, deps = defaultDeps }) {
  const structured = await handleStructuredPpt(req, url, { uid, send, res, readBody, activity, log, deps });
  if (structured) return true;
  const folderMatch = url.pathname.match(FOLDER_RE);
  const templateMatch = url.pathname.match(TEMPLATE_RE);
  const updates = url.pathname === '/ppt/updates';
  const bulk = url.pathname === '/ppt/projects/bulk';
  const match = url.pathname.match(PPT_RE);
  if (!match && !folderMatch && !templateMatch && !bulk && !updates) return false;
  const [, id, action] = match || [];
  try {
    if (folderMatch) return await handleFolders(req, folderMatch[1], uid, send);
    if (templateMatch) return await handleTemplates(req, templateMatch[1], uid, url, send, deps);
    if (updates) return await handleUpdates(req, uid, send, activity, log, deps);
    if (bulk) return await handleBulk(req, uid, send, deps);
    if (!id) {
      if (req.method === 'GET') return send(200, { projects: listProjects(uid, url) });
      if (req.method === 'POST') {
        const data = await body(req);
        if (store.list(uid).filter(project => !project.deletedAt).length >= 50) throw new HttpError(409, 'workspace limit is 50 presentations');
        const inputKind = data.inputKind || 'prompt';
        if (!['prompt', 'paste', 'file'].includes(inputKind)) throw new HttpError(400, 'invalid input kind');
        let source = null; let sourceBytes = null;
        if (inputKind === 'paste') {
          try { source = { ...normalizePaste(data.text), images: normalizeSourceImages(data.images) }; } catch (error) { throw new HttpError(400, error.message); }
        }
        if (inputKind === 'file') {
          if (typeof data.fileBase64 !== 'string' || data.fileBase64.length > 11_200_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.fileBase64)) throw new HttpError(400, 'invalid file payload');
          sourceBytes = Buffer.from(data.fileBase64, 'base64');
          let ext;
          try { ext = validateFile(data.fileName, sourceBytes); } catch (error) { throw new HttpError(400, error.message); }
          source = { kind: 'file', name: data.fileName, extension: ext, bytes: sourceBytes.length, sha256: sha256(sourceBytes), text: '', segments: [], truncated: false };
        }
        const prompt = inputKind === 'prompt' ? bounded(data.prompt, MAX_PROMPT, 'prompt') : bounded(data.prompt || source.name, MAX_PROMPT, 'prompt');
        const title = bounded(data.title || prompt.slice(0, 60), 160, 'title');
        const template = resolveTemplate(uid, data.template || 'violet');
        const project = { id: store.newId(), uid, title, prompt, pages: pages(data.pages ?? 10), template: template.id,
          templateSpec: snapshotTemplate(template), inputKind, source, sourceRevision: source ? 1 : 0, outlineRevision: 0,
          model: typeof data.model === 'string' ? data.model.slice(0, 120) : '',
          configId: bounded(data.configId || (source?.extension === 'pptx' && data.importMode === 'editable' ? 'pptx-import' : ''), 120, 'configId'),
          status: sourceBytes ? 'ingesting' : 'outlining', stage: sourceBytes ? 'ingest' : 'outline', error: '', outline: [], deck: null, nodes: {}, revision: 0,
          favorite: false, pinned: false, folderId: null, tags: [], deletedAt: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (sourceBytes) store.writeSource(uid, project.id, sourceBytes);
        store.save(project);
        const editableImport = Boolean(sourceBytes && source?.extension === 'pptx' && data.importMode === 'editable');
        if (editableImport) {
          startRun(ensureProjectV3(project), 'pptx-import');
          try {
            const imported = await importEditablePptx(project, sourceBytes, source.sha256);
            const analysis = await deps.analyzeTemplate(uid, project.id, 'pptx', sourceBytes);
            if (analysis?.fonts) imported.templateSpec.fonts = analysis.fonts;
            if (analysis?.palette) imported.templateSpec.palette = analysis.palette;
            imported.renderTree = buildRenderTree(imported); imported.status = 'completed'; imported.stage = 'completed'; imported.error = '';
            imported.revision = 1; imported.draftRevision = 1; imported.publishedRevision = 1;
            await renderImportedPptx(imported); saveStructuredProject(imported); saveRevision(imported, 'external-import');
            for (const nodeId of ['source', 'outline', 'content', 'media', 'layout', 'preview', 'quality', 'review', 'repair', 'publish']) transitionNode(imported, nodeId, 'completed');
            completeRun(imported, { imported: true, revision: 1 });
            return send(201, { project: getStructuredProject(uid, project.id) });
          } catch (error) {
            fail(uid, project.id, 'ingest', error, log); throw error;
          }
        }
        try {
          startRun(ensureProjectV3(project), sourceBytes ? 'ingest-and-generate' : 'generation');
          if (!sourceBytes) transitionNode(project, 'source', 'completed', { inputKind });
        } catch {}
        if (sourceBytes) startIngest(uid, project.id, activity, log, deps);
        else startOutline(uid, project.id, activity, log, deps);
        return send(201, { project: getStructuredProject(uid, project.id) || project });
      }
      return send(404, { error: 'not found' });
    }
    const project = getStructuredProject(uid, id, { persistMigration: true });
    if (!project) return send(404, { error: 'not found' });
    if (project.deletedAt && !['restore', 'permanent'].includes(action)) return send(404, { error: 'not found' });

    if (action === 'trash' && req.method === 'POST') {
      project.deletedAt = new Date().toISOString();
      return send(200, { project: store.save(project) });
    }
    if (action === 'restore' && req.method === 'POST') {
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 presentations' });
      project.deletedAt = null;
      return send(200, { project: store.save(project) });
    }
    if (action === 'permanent' && req.method === 'DELETE') {
      if (!project.deletedAt) return send(409, { error: 'move project to trash first' });
      await permanentlyRemove(project, deps);
      return send(200, { ok: true });
    }
    if (action === 'duplicate' && req.method === 'POST') {
      if (project.status !== 'completed') return send(409, { error: 'only completed presentations can be duplicated' });
      if (store.list(uid).filter(item => !item.deletedAt).length >= 50) return send(409, { error: 'workspace limit is 50 presentations' });
      const copy = structuredClone(project);
      copy.id = store.newId(); copy.title = `${project.title} · 副本`.slice(0, 160);
      delete copy.update; delete copy.updateRequest; delete copy.diff;
      copy.version = { rootId: copy.id, parentId: null, number: 1 };
      copy.favorite = false; copy.pinned = false; copy.deletedAt = null;
      copy.status = 'generating'; copy.stage = 'rendering'; copy.error = ''; copy.revision = 0; copy.pdfRevision = 0;
      copy.createdAt = new Date().toISOString();
      copy.nodes = Object.fromEntries(copy.deck.slides.map(slide => [slide.id, { status: 'done', attempts: 0, slide }]));
      if (copy.source?.kind === 'file') store.writeSource(uid, copy.id, store.readSource(uid, id));
      store.save(copy);
      startGeneration(uid, copy.id, activity, log, deps);
      return send(202, { project: copy });
    }

    if (action === 'export' && req.method === 'GET') {
      if (project.status !== 'completed') return send(409, { error: 'presentation is not ready' });
      const { stream, size } = await deps.readFile(id, '/workspace/presentation.pptx');
      const safe = project.title.replace(/[\\/\r\n"<>|:*?]/g, '_').slice(0, 120) || 'presentation';
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-length': size, 'content-disposition': `attachment; filename="presentation.pptx"; filename*=UTF-8''${encodeURIComponent(safe)}.pptx` });
      stream.on('error', () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      res.on('close', () => { try { stream.destroy(); } catch {} });
      return true;
    }
    if (action === 'pdf' && req.method === 'GET') {
      if (project.status !== 'completed') return send(409, { error: 'presentation is not ready' });
      if (project.pdfRevision !== project.revision) {
        await deps.renderPdf(project);
        const latest = store.get(uid, id);
        if (latest?.revision === project.revision) { latest.pdfRevision = project.revision; store.save(latest); }
      }
      const { stream, size } = await deps.readFile(id, '/workspace/presentation.pdf');
      const safe = project.title.replace(/[\\/\r\n"<>|:*?]/g, '_').slice(0, 120) || 'presentation';
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': size,
        'content-disposition': `attachment; filename="presentation.pdf"; filename*=UTF-8''${encodeURIComponent(safe)}.pdf` });
      stream.on('error', () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      res.on('close', () => { try { stream.destroy(); } catch {} });
      return true;
    }
    if (action === 'versions' && req.method === 'GET') {
      const rootId = project.version?.rootId || project.id;
      const versions = store.list(uid).filter(item => !item.deletedAt && (item.id === rootId || item.version?.rootId === rootId))
        .map(item => ({ id: item.id, title: item.title, status: item.status, parentId: item.version?.parentId || null,
          number: item.version?.number || 1, updatedAt: item.updatedAt, pages: item.pages })).sort((a, b) => a.number - b.number);
      return send(200, { versions });
    }
    if (action === 'rewrite' && req.method === 'POST') {
      const data = await body(req);
      if (!['completed', 'quality_blocked'].includes(project.status)) throw new HttpError(409, 'presentation is not editable');
      if (editing.has(id)) throw new HttpError(409, 'another save is in progress');
      if (data.revision !== project.revision) throw new HttpError(409, 'presentation changed on another device; reload first');
      const slide = project.deck.slides.find(item => item.id === data.slideId);
      if (!slide) throw new HttpError(404, 'slide not found');
      const instruction = bounded(data.instruction, 1000, 'instruction');
      editing.add(id);
      try {
        const source = (project.source?.segments || []).filter(item => slide.sourceRefs?.includes(item.id)).map(item => `[${item.id}] ${item.text}`).join('\n').slice(0, 8000);
        const block = data.blockId ? (slide.blocks || []).find(item => item.id === data.blockId) : null;
        if (data.blockId && (!block || !['image', 'shape'].includes(block.type))) throw new HttpError(400, 'only image captions and shape labels can be rewritten');
        const prompt = block
          ? `你只改写一个演示文稿视觉元素的文字，不调用工具，不改图片、图表数据、形状或坐标。用户指令：${instruction}\n元素原文：${block.type === 'image' ? block.caption : block.text}\n本页来源：${source || '无额外来源'}\n仅返回 JSON：{"text":"..."}，最多 100 字。`
          : `你只修改一页演示文稿的标题和要点。不得调用工具、生成坐标、改变图表数据或添加没有来源的数字。用户指令：${instruction}\n当前页：${slide.title}\n${slide.bullets.join('\n')}\n来源：${source || '无额外来源'}\n仅返回 JSON：{"title":"...","bullets":["..."]}；不超过 6 个要点。`;
        const result = await deps.modelCall(project, prompt, activity, log);
        const index = project.deck.slides.findIndex(item => item.id === slide.id);
        const raw = block ? { ...slide, blocks: slide.blocks.map(item => item.id === block.id
          ? { ...item, [block.type === 'image' ? 'caption' : 'text']: bounded(result.text, 100, 'rewritten text') } : item) } : { ...result, blocks: slide.blocks || [], layout: slide.layout, layoutId: slide.layoutId };
        const rewritten = normalizeDeck({ slides: [raw] }, [project.outline[index]]).slides[0];
        const gated = deterministicGate({ ...project, deck: applyLayoutRegistry({ ...project.deck, slides: project.deck.slides.map(item => item.id === slide.id ? rewritten : item) }) });
        gated.revision++;
        gated.pdfRevision = 0;
        if (gated.quality.status === 'blocked') {
          gated.status = 'quality_blocked'; gated.stage = 'repair'; gated.error = `PPT quality gate blocked publish: ${qualityError(gated)}`;
          return send(200, { project: store.save(gated) });
        }
        await deps.renderPptx(gated);
        gated.status = 'completed'; gated.stage = 'completed'; gated.error = '';
        return send(200, { project: store.save(gated) });
      } finally { editing.delete(id); }
    }
    if (action === 'source' && req.method === 'PATCH') {
      if (project.inputKind !== 'paste' || project.status !== 'outline_ready') return send(409, { error: 'pasted source is not editable now' });
      const data = await body(req);
      if (data.sourceRevision !== project.sourceRevision) return send(409, { error: 'source changed on another device; reload first' });
      let source;
      try { source = { ...normalizePaste(data.text), images: project.source?.images || [] }; } catch (error) { throw new HttpError(400, error.message); }
      if (source.text === project.source.text) return send(200, { project });
      project.source = source; project.sourceRevision++; project.outlineRevision = 0;
      project.outline = []; project.nodes = {}; project.status = 'outlining'; project.stage = 'outline';
      store.save(project); startOutline(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'outline' && req.method === 'PATCH') {
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      const data = await body(req);
      project.pages = pages(data.slides?.length);
      if (project.update && (project.pages < 6 || project.pages > 30)) throw new HttpError(400, 'update outline needs 6 to 30 slides');
      project.outline = normalizeOutline({ slides: data.slides }, project.pages, project.source, project.update);
      project.outlineRevision = (project.outlineRevision || 0) + 1;
      project.nodes = {};
      project.diff = diffSummary(project);
      store.save(project);
      return send(200, { project });
    }
    if (action === 'outline' && req.method === 'POST') {
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      project.outline = []; project.nodes = {}; project.outlineRevision = 0;
      project.diff = null;
      project.status = 'outlining'; project.stage = 'outline'; project.error = '';
      store.save(project); startOutline(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'generate' && req.method === 'POST') {
      if (project.status !== 'outline_ready') return send(409, { error: 'outline not ready' });
      project.status = 'generating'; project.stage = 'content'; project.error = '';
      store.save(project);
      startGeneration(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (action === 'retry' && req.method === 'POST') {
      if (project.status !== 'failed') return send(409, { error: 'project is not failed' });
      project.status = project.stage === 'ingest' ? 'ingesting' : project.stage === 'outline' ? 'outlining' : 'generating';
      project.error = ''; store.save(project);
      if (project.status === 'ingesting') startIngest(uid, id, activity, log, deps);
      else if (project.status === 'outlining') startOutline(uid, id, activity, log, deps);
      else startGeneration(uid, id, activity, log, deps);
      return send(202, { project });
    }
    if (!action && req.method === 'GET') return send(200, { project });
    if (!action && req.method === 'PATCH') {
      const data = await body(req);
      if (data.slides === undefined && data.slidePatches === undefined && data.template === undefined) {
        if (!['title', 'favorite', 'pinned', 'folderId', 'tags'].some(key => key in data)) return send(400, { error: 'no metadata changes' });
        return send(200, { project: setMetadata(project, data) });
      }
      if (!['completed', 'quality_blocked'].includes(project.status)) return send(409, { error: 'presentation is not editable' });
      if (editing.has(id)) return send(409, { error: 'another save is in progress' });
      if (data.revision !== project.revision) return send(409, { error: 'presentation changed on another device; reload first' });
      if (data.slides !== undefined && data.slidePatches !== undefined) throw new HttpError(400, 'choose full slides or slide patches');
      if (data.slides !== undefined && (!Array.isArray(data.slides) || data.slides.length < project.deck.slides.length || data.slides.length > project.deck.slides.length + 1 || data.slides.length > 50)) {
        return send(400, { error: 'slides may only be edited or one slide appended' });
      }
      editing.add(id);
      try {
        let nextSlides = data.slides || project.deck.slides;
        if (data.slidePatches !== undefined) {
          if (!Array.isArray(data.slidePatches) || data.slidePatches.length > project.deck.slides.length || (data.appendSlide && project.deck.slides.length >= 50)) throw new HttpError(400, 'invalid slide patches');
          const patches = new Map();
          for (const patch of data.slidePatches) {
            if (!patch || !project.deck.slides.some(slide => slide.id === patch.id) || patches.has(patch.id)) throw new HttpError(400, 'invalid or duplicate slide patch');
            patches.set(patch.id, patch);
          }
          nextSlides = project.deck.slides.map(slide => patches.get(slide.id) || slide);
          if (data.appendSlide) nextSlides = [...nextSlides, data.appendSlide];
        }
        const outline = nextSlides.length > project.outline.length
          ? [...project.outline, { id: String(project.outline.length + 1), title: nextSlides.at(-1)?.title, focus: nextSlides.at(-1)?.title }]
          : project.outline;
        const template = data.template === undefined ? null : resolveTemplate(uid, data.template);
        const updated = { ...project, outline, pages: outline.length, deck: normalizeDeck({ slides: nextSlides }, outline),
          template: template?.id || project.template,
          templateSpec: template ? snapshotTemplate(template) : project.templateSpec };
        const gated = deterministicGate(updated);
        gated.revision++;
        gated.pdfRevision = 0;
        if (gated.quality.status === 'blocked') {
          gated.status = 'quality_blocked'; gated.stage = 'repair'; gated.error = `PPT quality gate blocked publish: ${qualityError(gated)}`;
          return send(200, { project: store.save(gated) });
        }
        await deps.renderPptx(gated);
        gated.status = 'completed'; gated.stage = 'completed'; gated.error = '';
        return send(200, { project: store.save(gated) });
      } finally { editing.delete(id); }
    }
    return send(404, { error: 'not found' });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) log(`ppt API error: ${String(error?.message || error).slice(0, 300)}`);
    return send(status, { error: status === 500 ? 'PPT service error' : error.message });
  }
}

export const _internals = { normalizeOutline, normalizeDeck, parseModelJson, pages, outlinePrompt, contentPrompt };
