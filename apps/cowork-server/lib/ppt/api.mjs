import { applyCommand, redo, undo } from './command-service.mjs';
import { operationHistory } from './command-history.mjs';
import { getRun, listEvents, subscribe } from './event-store.mjs';
import { currentRun, cancelRun } from './run-service.mjs';
import { getProject, listRevisions, readRevision, saveProject } from './repository.mjs';
import { publishProject } from './publish-service.mjs';
import { buildSlideRenderTree } from './render-tree.mjs';
import { slideSvg } from './exporters/preview.mjs';
import { validateNodeContent } from './command-schema.mjs';

const PROJECT = '[a-f0-9]{32}';
const RUN = 'run_[a-f0-9]{24}';

async function jsonBody(req, readBody) {
  let raw = '';
  if (readBody) raw = await readBody(req);
  else for await (const chunk of req) raw += chunk;
  if (raw.length > 2_000_000) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('invalid JSON'), { statusCode: 400 }); }
}

function projectOr404(uid, id) {
  const project = getProject(uid, id, { persistMigration: true });
  if (!project || project.deletedAt) throw Object.assign(new Error('not found'), { statusCode: 404 });
  return project;
}

function sse(req, res, project, run, after) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive', 'x-accel-buffering': 'no',
  });
  let last = Number(after || req.headers['last-event-id'] || 0);
  const write = (type, data, id) => {
    if (id && id <= last) return;
    if (id) { last = id; res.write(`id: ${id}\n`); }
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  write('snapshot', { project, run });
  const pending = [];
  let replaying = true;
  const unsubscribe = subscribe(run.id, event => {
    if (replaying) pending.push(event); else write('run-event', event, event.seq);
  });
  for (const event of listEvents(project.uid, project.id, run.id, last)) write('run-event', event, event.seq);
  replaying = false;
  for (const event of pending) write('run-event', event, event.seq);
  const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 15000);
  const close = () => { clearInterval(heartbeat); unsubscribe(); try { res.end(); } catch {} };
  req.on('close', close); res.on('close', close);
  return true;
}

export async function handleStructuredPpt(req, url, ctx) {
  const { uid, send, res, readBody, deps, activity, log = () => {} } = ctx;
  let match;
  try {
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/run$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const run = currentRun(project);
      if (req.method === 'GET') return send(200, { project, run, events: run ? listEvents(uid, project.id, run.id, Number(url.searchParams.get('after') || 0)) : [] });
      if (req.method === 'DELETE') { const cancelled = cancelRun(project); return send(200, { project: getProject(uid, project.id), run: cancelled }); }
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/events$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const run = currentRun(project);
      if (!run) return send(404, { error: 'run not found' });
      if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) return sse(req, res, project, run, url.searchParams.get('after'));
      if (req.method === 'GET') return send(200, { run, events: listEvents(uid, project.id, run.id, Number(url.searchParams.get('after') || 0)) });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/runs/(${RUN})$`, 'i')))) {
      const projectId = String(url.searchParams.get('projectId') || ''); projectOr404(uid, projectId);
      const run = getRun(uid, projectId, match[1]); return run ? send(200, { run }) : send(404, { error: 'run not found' });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/commands$`, 'i')))) {
      const project = projectOr404(uid, match[1]);
      if (req.method === 'GET') return send(200, { operations: operationHistory(uid, project.id) });
      if (req.method === 'POST') {
        const result = await applyCommand(uid, project.id, await jsonBody(req, readBody));
        return send(200, result);
      }
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/(undo|redo)$`, 'i')))) {
      projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const result = match[2] === 'undo' ? await undo(uid, match[1]) : await redo(uid, match[1]);
      return send(200, result);
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/publish$`, 'i')))) {
      projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      return send(200, await publishProject(uid, match[1], deps));
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/revisions$`, 'i')))) {
      projectOr404(uid, match[1]);
      if (req.method === 'GET') return send(200, { revisions: listRevisions(uid, match[1]).map(item => ({ revision: item.revision, reason: item.reason, createdAt: item.createdAt })) });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/revisions/(\\d+)/restore$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const snapshot = readRevision(uid, project.id, Number(match[2]));
      if (!snapshot) return send(404, { error: 'revision not found' });
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const result = await applyCommand(uid, project.id, { type: 'deck.replace', baseRevision: project.revision, payload: { deck: snapshot.deck } }, { allowExternalStructure: true, allowInternal: true });
      result.project.template = snapshot.template; result.project.templateSpec = snapshot.templateSpec;
      result.project.renderTree = snapshot.renderTree || result.project.renderTree; saveProject(result.project);
      return send(200, result);
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/slides/([a-zA-Z0-9_-]{1,80})/preview$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const tree = buildSlideRenderTree(project, match[2]);
      if (!tree) return send(404, { error: 'slide not found' });
      if (url.searchParams.get('format') === 'svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store', etag: `"${project.renderTree?.hash || project.revision}"` });
        res.end(slideSvg(tree)); return true;
      }
      return send(200, { slide: tree, revision: project.revision });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/ai-edit$`, 'i')))) {
      const project = projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await jsonBody(req, readBody); const slide = project.deck?.slides.find(item => item.id === data.slideId);
      if (!slide) return send(404, { error: 'slide not found' });
      const instruction = String(data.instruction || '').trim().slice(0, 1000);
      if (!instruction) return send(400, { error: 'instruction is required' });
      const scope = data.scope === 'slide' ? 'slide' : 'object'; const relayout = data.mode === 'relayout';
      if (scope === 'object') {
        const node = slide.nodes?.find(item => item.id === data.nodeId); if (!node) return send(404, { error: 'node not found' });
        if (node.type === 'foreign' || node.locked) return send(409, { error: 'node is locked' });
        const prompt = `你只修改给定演示文稿对象的语义内容。不得输出坐标、尺寸、字体、颜色、ID 或页面操作。对象：${JSON.stringify({ type: node.type, content: node.content })}\n用户指令：${instruction}\n只返回 JSON：{"content":{...}}，字段必须与原 content 兼容。`;
        const answer = await deps.modelCall(project, prompt, activity, log);
        const candidate = answer?.content && typeof answer.content === 'object' ? answer.content : answer;
        const content = validateNodeContent(node.type, candidate);
        const proposal = { scope, slideId: slide.id, nodeId: node.id, before: node.content, content };
        if (data.preview !== false) return send(200, { proposal });
        return send(200, await applyCommand(uid, project.id, { type: 'ai.objectPatch', baseRevision: Number(data.baseRevision), payload: { slideId: slide.id, nodeId: node.id, patch: { content } } }));
      }
      const editable = (slide.nodes || []).filter(node => !node.locked && ['text', 'list', 'chart', 'table', 'shape'].includes(node.type)).slice(0, 30);
      if (!editable.length) return send(409, { error: 'slide has no editable semantic objects' });
      const prompt = `你只修改当前演示文稿页面的语义内容${relayout ? '，并可从 cover, summary, editorial, big-number, comparison, chart, table, image-text, timeline, conclusion 中选择一个 layoutId' : ''}。不得输出坐标、尺寸、字体、颜色或新 ID。页面对象：${JSON.stringify(editable.map(node => ({ nodeId: node.id, type: node.type, content: node.content })))}\n用户指令：${instruction}\n只返回 JSON：{"patches":[{"nodeId":"现有ID","content":{...}}]${relayout ? ',"layoutId":"summary"' : ''}}。`;
      const answer = await deps.modelCall(project, prompt, activity, log); const raw = answer?.patches ? answer : answer?.content?.patches ? answer.content : {};
      const byId = new Map(editable.map(node => [node.id, node])); const patches = [];
      for (const item of Array.isArray(raw.patches) ? raw.patches : []) { const node = byId.get(item?.nodeId); if (!node) continue; patches.push({ nodeId: node.id, before: node.content, content: validateNodeContent(node.type, item.content) }); }
      if (!patches.length) return send(422, { error: 'AI returned no valid object patches' });
      const layouts = new Set(['cover', 'summary', 'editorial', 'big-number', 'comparison', 'chart', 'table', 'image-text', 'timeline', 'conclusion']);
      const layoutId = relayout && layouts.has(raw.layoutId) ? raw.layoutId : undefined;
      const proposal = { scope, slideId: slide.id, patches, ...(layoutId ? { layoutId } : {}) };
      if (data.preview !== false) return send(200, { proposal });
      return send(200, await applyCommand(uid, project.id, { type: 'ai.slidePatch', baseRevision: Number(data.baseRevision), payload: { slideId: slide.id, patches: patches.map(({ nodeId, content }) => ({ nodeId, content })), ...(layoutId ? { layoutId } : {}) } }));
    }
    return false;
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    if (status === 500) log(`structured ppt API error: ${String(error?.stack || error).slice(0, 1000)}`);
    return send(status, { error: status === 500 ? 'PPT service error' : error.message, ...(error?.details ? { details: error.details } : {}) });
  }
}
