import { startAssetTask, finishAssetTask, retryAssetTask } from './asset-task-service.mjs';
import { applyCommand, redo, undo } from './command-service.mjs';
import { operationHistory } from './command-history.mjs';
import { getRun, listEvents, subscribe } from './event-store.mjs';
import { currentRun, cancelRun } from './run-service.mjs';
import { getProject, listRevisions, readRevision, enqueueProject } from './repository.mjs';
import { publishProject } from './publish-service.mjs';
import { buildSlideRenderTree } from './render-tree.mjs';
import { slideSvg } from './exporters/preview.mjs';
import { createProposal, applyProposal, discardProposal, proposalPreview } from './proposal-service.mjs';
import { openGenerationScope, submitGenerationEdit, retryGenerationEdit, processGenerationEdits, recordIntentProposal } from './generation-edit-service.mjs';
import { pauseSession, resumeSession, setPageAccepted } from './runtime.mjs';

const PROJECT = '[a-f0-9]{32}';
const RUN = 'run_[a-f0-9]{24}';

async function jsonBody(req, readBody) {
  let raw = '';
  if (readBody) raw = await readBody(req);
  else for await (const chunk of req) raw += chunk;
  if (raw.length > 2_000_000) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
  try { const value = JSON.parse(raw || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape'); return value; } catch { throw Object.assign(new Error('invalid JSON'), { statusCode: 400 }); }
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
  const { uid, send, res, readBody, deps, activity, resumeGeneration, log = () => {} } = ctx;
  let match;
  try {
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/slides/([a-zA-Z0-9_-]{1,80})/accept$`, 'i')))) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await jsonBody(req, readBody);
      return send(200, { project: await setPageAccepted(uid, match[1], match[2], data.accepted, data.renderHash, data.baseRevision) });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/(pause|resume)$`, 'i')))) {
      projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const project = match[2] === 'pause' ? await pauseSession(uid, match[1]) : await resumeSession(uid, match[1]);
      if (match[2] === 'resume') resumeGeneration?.(uid, match[1]);
      return send(202, { project });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/run$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const run = currentRun(project);
      if (req.method === 'GET') return send(200, { project, run, events: run ? listEvents(uid, project.id, run.id, Number(url.searchParams.get('after') || 0)) : [] });
      if (req.method === 'DELETE') { const cancelled = await enqueueProject(uid, project.id, () => cancelRun(getProject(uid, project.id))); return send(200, { project: getProject(uid, project.id), run: cancelled }); }
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
      const data = await jsonBody(req, readBody);
      const result = match[2] === 'undo' ? await undo(uid, match[1], uid, data.operationId || null) : await redo(uid, match[1]);
      return send(200, result);
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/publish$`, 'i')))) {
      projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      return send(200, await publishProject(uid, match[1], deps, activity, log));
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/revisions$`, 'i')))) {
      projectOr404(uid, match[1]);
      if (req.method === 'GET') return send(200, { revisions: listRevisions(uid, match[1]).map(item => ({ revision: item.revision, reason: item.reason, createdAt: item.createdAt })) });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/revisions/(\\d+)/restore$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const snapshot = readRevision(uid, project.id, Number(match[2]));
      if (!snapshot) return send(404, { error: 'revision not found' });
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const result = await applyCommand(uid, project.id, { type: 'deck.replace', baseRevision: project.revision, payload: { deck: snapshot.deck, projectState: { template: snapshot.template ?? project.template, templateSpec: snapshot.templateSpec ?? project.templateSpec, outline: snapshot.outline || snapshot.deck.slides.map(slide => ({ id: slide.id, title: slide.title, refs: slide.sourceRefs || [] })), pages: snapshot.deck.slides.length, pageDecision: snapshot.pageDecision ?? { ...project.pageDecision, finalPageCount: snapshot.deck.slides.length }, planning: snapshot.planning, constraints: snapshot.constraints } } }, { allowExternalStructure: true, allowInternal: true });
      return send(200, result);
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/slides/([a-zA-Z0-9_-]{1,80})/preview$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const tree = ['generating', 'paused'].includes(project.status)
        ? project.runtime?.slides?.[match[2]]?.preview : buildSlideRenderTree(project, match[2]);
      if (!tree) return send(404, { error: 'slide not found' });
      if (url.searchParams.get('format') === 'svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store', etag: `"${project.renderTree?.hash || project.revision}"` });
        res.end(slideSvg(tree)); return true;
      }
      return send(200, { slide: tree, revision: project.revision });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/ai-edit$`, 'i')))) {
      const project = projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await jsonBody(req, readBody);
      const proposal = await createProposal(project, data, deps, activity, log);
      // Compatibility clients requesting a direct edit still use a server-owned validated proposal.
      return data.preview === false ? send(200, await applyProposal(uid, project.id, proposal.id)) : send(200, { proposal });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/asset-tasks(?:/(asset_[a-f0-9]+)(/retry)?)?$`, 'i')))) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await jsonBody(req, readBody);
      if (match[3]) return send(200, { task: await retryAssetTask(uid, match[1], match[2]) });
      return send(200, match[2] ? await finishAssetTask(uid, match[1], match[2], data, deps, activity, log) : { task: await startAssetTask(uid, match[1], data) });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/proposals/(proposal_[a-f0-9]+)(?:/(apply|discard))?$`, 'i')))) {
      const project = projectOr404(uid, match[1]);
      if (req.method === 'GET' && !match[3]) return send(200, { proposal: proposalPreview(project, match[2]) });
      if (req.method !== 'POST' || !match[3]) return send(405, { error: 'method not allowed' });
      if (match[3] === 'discard') {
        const proposal = await discardProposal(uid, match[1], match[2]); await recordIntentProposal(uid, match[1], match[2], 'discarded');
        return send(200, { proposal, project: getProject(uid, match[1]) });
      }
      const result = await applyProposal(uid, match[1], match[2]);
      await recordIntentProposal(uid, match[1], match[2], 'applied', result.operation.id);
      return send(200, { ...result, project: getProject(uid, match[1]) });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/generation-edit-scopes$`, 'i')))) {
      projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await jsonBody(req, readBody);
      return send(200, { scope: await openGenerationScope(uid, match[1], data.slideId) });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/generation-edits(?:/(intent_[a-f0-9]+)(/retry)?)?$`, 'i')))) {
      const project = projectOr404(uid, match[1]);
      if (req.method === 'GET') {
        const intent = project.editing?.intents?.[match[2]];
        return match[2] ? (intent ? send(200, { intent }) : send(404, { error: 'intent not found' })) : send(200, { intents: Object.values(project.editing?.intents || {}) });
      }
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      if (match[2] && !match[3]) return send(405, { error: 'method not allowed' });
      const result = match[3] ? await retryGenerationEdit(uid, match[1], match[2]) : await submitGenerationEdit(uid, match[1], await jsonBody(req, readBody));
      void processGenerationEdits(uid, match[1], deps, activity, log).catch(error => log(String(error)));
      return send(202, result);
    }
    return false;
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    if (status === 500) log(`structured ppt API error: ${String(error?.stack || error).slice(0, 1000)}`);
    return send(status, { error: status === 500 ? 'PPT service error' : error.message, ...(error?.details ? { details: error.details } : {}) });
  }
}
