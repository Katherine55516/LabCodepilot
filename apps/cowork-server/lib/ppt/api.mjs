import {fontManifest,projectNativeFonts,withNativeFontCss} from '../ppt-native-fonts.mjs';
import {readRepairComparison} from './repair-comparison.mjs';
import {liveProjectView,liveProposalView,currentSlidePreview} from './project-view.mjs';
import { startAssetTask, finishAssetTask, retryAssetTask } from './asset-task-service.mjs';
import {retrySourceMedia}from '../ppt-media-refit.mjs';
import {invalidateReviews}from './versioning.mjs';
import { applyCommand, redo, undo } from './command-service.mjs';
import { operationHistory } from './command-history.mjs';
import { getRun, listEvents, subscribe, subscribeTransient } from './event-store.mjs';
import { currentRun, cancelRun } from './run-service.mjs';
import { getProject, saveProject, saveRevision, listRevisions, readRevision, enqueueProject } from './repository.mjs';
import { publishProject, aiCheckProject } from './publish-service.mjs';
import { buildSlideRenderTree } from './render-tree.mjs';
import { slideSvg } from './exporters/preview.mjs';
import {buildTemplateSkeleton,buildPendingSlidePreview} from './generation-skeleton.mjs';
import { createProposal, applyProposal, discardProposal, proposalPreview,reviseProposal,proposalHistory,proposalVersion,restoreProposalVersion } from './proposal-service.mjs';
import { openGenerationScope, submitGenerationEdit, retryGenerationEdit, processGenerationEdits, recordIntentProposal } from './generation-edit-service.mjs';
import { pauseSession, resumeSession, setPageAccepted } from './runtime.mjs';
import { advisoryEditRequest, pageFlagEditRequest, recordReviewDecision } from './review-advisories.mjs';

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
  write('snapshot', { project:liveProjectView(project), run });
  const pending = [];
  let replaying = true;
  const unsubscribe = subscribe(run.id, event => {
    if (replaying) pending.push(event); else write('run-event', event, event.seq);
  });
  for (const event of listEvents(project.uid, project.id, run.id, last)) write('run-event', event, event.seq);
  replaying = false;
  for (const event of pending) write('run-event', event, event.seq);
  const unsubscribeDraft = subscribeTransient(run.id, event => write('draft', event.payload));
  const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 15000);
  const close = () => { clearInterval(heartbeat); unsubscribe(); unsubscribeDraft(); try { res.end(); } catch {} };
  req.on('close', close); res.on('close', close);
  return true;
}

export async function handleStructuredPpt(req, url, ctx) {
  const { uid, send:rawSend, res, readBody, deps, activity, resumeGeneration, log = () => {} } = ctx;
  const send=(status,value)=>{
    if(url.searchParams.get('view')!=='live')return rawSend(status,value);
    const view=value?.project?{...value,project:liveProjectView(value.project)}:value;
    return rawSend(status,view?.proposal?{...view,proposal:liveProposalView(view.proposal)}:view);
  };
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
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/ai-check$`, 'i')))) {
      projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      return send(200, await aiCheckProject(uid, match[1], deps, activity, log));
    }
    if ((match=url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/source-media/retry$`,'i')))) {
      if(req.method!=='POST')return send(405,{error:'method not allowed'});
      const data=await jsonBody(req,readBody);
      const project=await enqueueProject(uid,match[1],()=>{
        const next=retrySourceMedia(projectOr404(uid,match[1]),data);
        next.revision++;invalidateReviews(next);next.status='quality_blocked';next.stage='repair';delete next.qualityBlockReason;
        delete next.publishedRevision;delete next.publishedArtifactPath;
        next.quality={...next.quality,exportable:false,publishEligible:false,status:'pending'};
        // A successful refit is a draft, pending the same publication gates.
        saveProject(next);saveRevision(next,'scoped-source-media-retry');return next;
      });
      return send(200,{project});
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
    if((match=url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/native-fonts(?:/([a-f0-9]{64})\\.ttf)?$`,'i')))){
      if(req.method!=='GET')return send(405,{error:'method not allowed'});
      const project=projectOr404(uid,match[1]);
      if(!match[2])return send(200,{fonts:fontManifest(project)});
      const font=projectNativeFonts(project).find(font=>font.sha256===match[2]);if(!font)return send(404,{error:'font not found'});
      res.writeHead(200,{'content-type':'font/ttf','cache-control':'private, max-age=3600','x-content-type-options':'nosniff'});res.end(font.bytes);return true;
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/slides/([a-zA-Z0-9_-]{1,80})/assets/([a-zA-Z0-9_-]{1,100})$`, 'i')))) {
      if(req.method!=='GET')return send(405,{error:'method not allowed'});
      const project=projectOr404(uid,match[1]);
      const tree=project.runtime?.slides?.[match[2]]?.preview||buildTemplateSkeleton(project,match[2])||buildSlideRenderTree(project,match[2]);
      const data=tree?.elements?.find(e=>(e.nodeId||e.id)===match[3])?.content?.dataUrl;
      const asset=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/u.exec(data||'');
      if(!asset)return send(404,{error:'asset not found'});
      res.writeHead(200,{'content-type':'image/'+asset[1],'cache-control':'private, no-store'});res.end(Buffer.from(asset[2],'base64'));return true;
    }
    if ((match=url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/slides/([a-zA-Z0-9_-]{1,80})/repair-comparison/([a-f0-9]{32})/(before|after)$`,'i')))) {
      if(req.method!=='GET')return send(405,{error:'method not allowed'});
      const project=projectOr404(uid,match[1]),svg=readRepairComparison(project,match[2],match[3],match[4]);if(!svg)return send(404,{error:'repair comparison not found'});
      res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','cache-control':'private, no-store'});res.end(svg);return true;
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/slides/([a-zA-Z0-9_-]{1,80})/preview$`, 'i')))) {
      const project = projectOr404(uid, match[1]); const tree = ['generating', 'paused'].includes(project.status)
        ? currentSlidePreview(project,match[2])||buildPendingSlidePreview(project,match[2])||(url.searchParams.get('draft')==='1'?buildTemplateSkeleton(project,match[2]):null) : buildSlideRenderTree(project, match[2]);
      if (!tree) return send(404, { error: 'slide not found' });
      if (url.searchParams.get('format') === 'svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store', etag: `"${project.renderTree?.hash || project.revision}"` });
        res.end(withNativeFontCss(project,slideSvg(tree))); return true;
      }
      return send(200, { slide: tree, revision: project.revision });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/ai-edit$`, 'i')))) {
      const project = projectOr404(uid, match[1]); if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      let data = await jsonBody(req, readBody);
      // "Apply suggestion" on a review advisory: the stored finding, not the client, supplies the instruction and target.
      if (data.reviewAdvisoryId !== undefined) data = advisoryEditRequest(project, data);
      // "AI fix this page" on a page the publish gate flagged: the stored flag supplies the instruction.
      else if (data.pageFlagCode !== undefined) data = pageFlagEditRequest(project, data);
      const proposal = await createProposal(project, data, deps, activity, log);
      // Compatibility clients requesting a direct edit still use a server-owned validated proposal.
      return data.preview === false ? send(200, await applyProposal(uid, project.id, proposal.id)) : send(200, { proposal });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/review-advisories/(adv_[a-f0-9]{20})$`, 'i')))) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await jsonBody(req, readBody);
      const project = await enqueueProject(uid, match[1], () => {
        const current = recordReviewDecision(projectOr404(uid, match[1]), match[2], { status: data.status, baseRevision: data.baseRevision, actor: uid });
        saveProject(current); return current;
      });
      return send(200, { project });
    }
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/asset-tasks(?:/(asset_[a-f0-9]+)(/retry)?)?$`, 'i')))) {
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
      const data = await jsonBody(req, readBody);
      if (match[3]) return send(200, { task: await retryAssetTask(uid, match[1], match[2]) });
      return send(200, match[2] ? await finishAssetTask(uid, match[1], match[2], data, deps, activity, log) : { task: await startAssetTask(uid, match[1], data) });
    }
    if ((match=url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/proposals$`,'i'))) && req.method==='GET')return send(200,{proposals:proposalHistory(projectOr404(uid,match[1]))});
    if ((match = url.pathname.match(new RegExp(`^/ppt/projects/(${PROJECT})/proposals/(proposal_[a-f0-9]+)(?:/(apply|discard|revise|version|restore))?$`, 'i')))) {
      const project = projectOr404(uid, match[1]);
      if(req.method==='GET'&&match[3]==='version')return send(200,{version:proposalVersion(project,match[2],url.searchParams.get('side'))});
      if (req.method === 'GET' && !match[3]) return send(200, { proposal: proposalPreview(project, match[2]) });
      if (req.method !== 'POST' || !match[3]) return send(405, { error: 'method not allowed' });
      if(match[3]==='revise')return send(200,{proposal:await reviseProposal(project,match[2],await jsonBody(req,readBody),deps,activity,log)});
      if(match[3]==='restore')return send(200,await restoreProposalVersion(project,match[2],await jsonBody(req,readBody)));
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
      return send(200, { scope: await openGenerationScope(uid, match[1], data.slideId, data.previousScopeId, data.scope) });
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
    // A model call that fails upstream (live fz-r35: the gateway answered 504
    // after 122 s) is the model service's failure, told as such, not a 500.
    if (!error?.statusCode && /^ppt_(?:transport|timeout|network|rate_limit|model_unavailable|empty_visible_output|truncated_output)$/u.test(String(error?.message))) {
      const d = error.diagnostic || {}, seconds = Number.isFinite(d.elapsedMs) ? ` after ${Math.round(d.elapsedMs / 1000)} s` : '';
      log(`structured ppt API model failure: ${error.message} ${JSON.stringify(d).slice(0, 300)}`);
      return send(502, { error: `The model service did not return a usable answer (${error.code}${d.httpStatus ? ' ' + d.httpStatus : ''}${seconds}); try again.`, details: { code: error.code, modelStage: error.modelStage, diagnostic: d } });
    }
    const status = Number(error?.statusCode || 500);
    if (status === 500) log(`structured ppt API error: ${String(error?.stack || error).slice(0, 1000)}`);
    return send(status, { error: status === 500 ? 'PPT service error' : error.message, ...(status !== 500 && error?.code ? { code: error.code } : {}), ...(error?.details ? { details: error.details } : {}) });
  }
}
