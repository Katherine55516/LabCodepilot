/** Editor side of judged deck-review advisories (plan:
 * docs/exec-plans/completed/ppt-editor-review-advisories-20261022.md).
 *
 * The quality report is rebuilt on every publish, so an advisory is identified
 * by a digest of what the reviewer said, and the user's decisions live in a
 * ledger on the project (`reviewAdvisoryDecisions`), not on the report entry:
 * - dismissed: kept across reports; the same finding text stays reviewed.
 * - applied:   set by the command that applied the suggested fix; valid only
 *              for the report it fixed (a fresh review that still reports it
 *              reopens it). Undo of that command reopens it, redo applies again. */
import { digest, editError } from './edit-context.mjs';
import { visibleNodes, nodeContentText } from '../ppt-visible-content.mjs';

export const ADVISORY_ID = /^adv_[a-f0-9]{20}$/;
const MAX_DECISIONS = 200;
const INSTRUCTION_LIMIT = 1000;
const QUOTES = [['“', '”'], ['"', '"'], ['「', '」'], ['『', '』'], ['‘', '’']]
  .map(([open, close]) => new RegExp(`${open}([^${open}${close}\\n]{4,200})${close}`, 'gu'));

export function advisoryId(issue) {
  return 'adv_' + digest([issue.code || '', [...(issue.slideIds || [])].map(String).sort(), issue.nodeId || null, String(issue.detail || '')]).slice(0, 20);
}

const squash = value => String(value || '').replace(/\s+/gu, ' ').trim();
function quotes(text) {
  return QUOTES.flatMap(pattern => [...String(text || '').matchAll(pattern)].map(match => squash(match[1]))).filter(Boolean);
}

/** The object a finding is about on one flagged page. Model findings rarely
 * carry a node ID, so the reviewer's own words locate it; when nothing does,
 * the whole page is the target (nodeId null). */
export function advisoryTarget(project, issue, slideId) {
  const slide = project.deck?.slides?.find(item => item.id === slideId);
  if (!slide || !(issue.slideIds || []).includes(slideId)) return null;
  const nodes = visibleNodes(slide), byId = new Map(nodes.map(node => [node.id, node]));
  if (issue.nodeId && byId.has(issue.nodeId)) return { slideId, nodeId: issue.nodeId, basis: 'reviewer' };
  const named = (`${issue.detail || ''}\n${issue.suggestedFix || ''}`.match(/[A-Za-z0-9_-]{3,80}/gu) || []).find(token => byId.has(token));
  if (named) return { slideId, nodeId: named, basis: 'named' };
  if (issue.bulletIndexes?.length) {
    const body = nodes.find(node => ['list', 'timeline'].includes(node.type) && node.semanticRole === 'body');
    if (body && issue.bulletIndexes.every(index => index < (body.content?.items?.length || 0))) return { slideId, nodeId: body.id, basis: 'bullets' };
  }
  for (const quote of quotes(issue.detail).sort((a, b) => b.length - a.length)) {
    const owner = nodes.find(node => squash(nodeContentText(node)).includes(quote));
    if (owner) return { slideId, nodeId: owner.id, basis: 'quote' };
  }
  return { slideId, nodeId: null, basis: 'page' };
}

function decision(project, id) {
  const value = project.reviewAdvisoryDecisions?.[id];
  if (value?.status === 'dismissed') return value;
  if (value?.status === 'applied' && value.checkedAt === (project.quality?.checkedAt ?? null)) return value;
  return null;
}

/** Advisories of the current report, one per identity, with their targets and
 * the user's decision (`review`, absent while open). */
export function reviewAdvisories(project) {
  const seen = new Set();
  return (project.quality?.modelIssues || []).filter(issue => issue?.advisory).flatMap(issue => {
    const id = advisoryId(issue); if (seen.has(id)) return []; seen.add(id);
    const review = decision(project, id);
    return [{ id, code: issue.code, severity: issue.severity, detail: String(issue.detail || ''), slideIds: issue.slideIds || [], advisory: true, requiresReview: true,
      ...(issue.suggestedFix ? { suggestedFix: issue.suggestedFix } : {}), ...(issue.nodeId ? { nodeId: issue.nodeId } : {}), ...(issue.reason ? { reason: issue.reason } : {}),
      targets: (issue.slideIds || []).map(slideId => advisoryTarget(project, issue, slideId)).filter(Boolean),
      ...(review ? { review: { status: review.status, at: review.at, ...(review.operationId ? { operationId: review.operationId } : {}) } } : {}) }];
  });
}

/** Client projection. Its `modelIssues` lists only the advisories (blocking
 * findings reach the client through deterministic/modelReview), and
 * `reviewAdvisories` counts the ones still open. */
export function reviewAdvisoryView(project) {
  const items = reviewAdvisories(project);
  return { modelIssues: items, reviewAdvisories: items.filter(item => !item.review).length, reviewedAdvisories: items.filter(item => item.review).length };
}

function prune(ledger) {
  const ids = Object.keys(ledger);
  if (ids.length <= MAX_DECISIONS) return;
  for (const id of ids.sort((a, b) => String(ledger[a].at).localeCompare(String(ledger[b].at))).slice(0, ids.length - MAX_DECISIONS)) delete ledger[id];
}

/** Dismiss or reopen one advisory. Like accepting a page, this is a review
 * decision, not a deck edit: the revision is checked but not advanced, so a
 * published deck does not turn into an unsaved draft. */
export function recordReviewDecision(project, id, { status, baseRevision, actor }) {
  if (!ADVISORY_ID.test(String(id))) throw editError('invalid review advisory', 400);
  if (!['dismissed', 'open'].includes(status)) throw editError('status must be dismissed or open', 400);
  if (!['completed', 'quality_blocked'].includes(project.status)) throw editError('project is not editable in its current state', 409);
  if (!Number.isInteger(baseRevision) || baseRevision !== project.revision) throw editError('refresh the project before reviewing this finding', 409, { currentRevision: project.revision });
  const item = reviewAdvisories(project).find(entry => entry.id === id);
  if (!item) throw editError('review advisory not found', 404);
  if (item.review?.status === 'applied') throw editError('the suggested fix was applied; undo that change to reopen the finding', 409);
  const ledger = project.reviewAdvisoryDecisions ||= {};
  if (status === 'open') delete ledger[id];
  else if (item.review?.status !== 'dismissed') ledger[id] = { status, at: new Date().toISOString(), actor: String(actor || '').slice(0, 120), checkedAt: project.quality?.checkedAt ?? null };
  prune(ledger);
  project.updatedAt = new Date().toISOString();
  return project;
}

const clip = (text, max) => { const value = squash(text); return value.length <= max ? value : value.slice(0, Math.max(0, max - 1)) + '…'; };
/** AI-edit request for "Apply suggestion": the server builds the instruction
 * from the stored finding and picks the target, so the proposal is linked to
 * the advisory and the client cannot redirect it. */
export function advisoryEditRequest(project, data) {
  const item = reviewAdvisories(project).find(entry => entry.id === data.reviewAdvisoryId);
  if (!item) throw editError('review advisory not found', 404);
  if (!item.suggestedFix) throw editError('this finding has no suggested fix', 409);
  if (item.review) throw editError('this finding was already reviewed', 409);
  const target = item.targets.find(entry => entry.slideId === data.slideId);
  if (!target) throw editError('the finding does not flag this page', 400);
  const head = 'Apply the deck reviewer\'s suggested fix. Change only what it requires; keep every sourced fact, number and condition.\nSuggested fix: ';
  const fix = clip(item.suggestedFix, 520), finding = '\nReviewer finding: ';
  return { scope: target.nodeId ? 'object' : 'slide', type: 'content', slideId: target.slideId, ...(target.nodeId ? { nodeId: target.nodeId } : {}),
    instruction: head + fix + finding + clip(item.detail, INSTRUCTION_LIMIT - head.length - fix.length - finding.length),
    baseRevision: data.baseRevision, preview: data.preview, reviewAdvisoryId: item.id };
}

/** "AI fix this page" for a page the publish gate flagged (D2, 2026-10-31):
 * the server builds the instruction from the stored flag, so the client can
 * neither redirect it nor write it. Only text problems an edit can fix are
 * offered: a title that does not fit and content that overflows its page. */
const TITLE_FLAGS=new Set(['rendered_title_capacity','title_overflow','planned_native_title_overflow','template_cjk_title_frame_capacity']);
const OVERFLOW_FLAGS=new Set(['render_overflow','template_slot_overflow','card_page_capacity','typography_capacity','point_layout_capacity','source_artifact_capacity','component_label_capacity','table_cell_capacity','export_page_visibility']);
export function pageFlagFixable(code){return TITLE_FLAGS.has(code)||OVERFLOW_FLAGS.has(code);}
export function pageFlagEditRequest(project, data) {
  const flag = (project.quality?.deterministic?.issues || []).find(issue => issue.pageFlag && issue.code === data.pageFlagCode && (issue.slideIds?.length ? issue.slideIds : [issue.slideId]).includes(data.slideId));
  if (!flag) throw editError('this page has no such flagged problem', 404);
  if (!pageFlagFixable(flag.code)) throw editError('this problem cannot be fixed by an AI edit', 409);
  const instruction = TITLE_FLAGS.has(flag.code)
    ? 'Shorten this page\'s title so it fits its title box. Keep its meaning and language; change nothing else on the page.'
    : 'This page\'s content does not fit its space. Tighten the wording of its points so everything fits, without removing any sourced fact, number, condition or table row. Keep the title.';
  return { scope: 'slide', type: 'content', slideId: data.slideId, instruction: clip(instruction + '\nFlagged problem: ' + (flag.message || flag.code), INSTRUCTION_LIMIT),
    baseRevision: data.baseRevision, preview: data.preview };
}

/** Called by the command commit, inside the same write as the operation, so
 * an advisory's applied state follows the operation journal through undo/redo. */
export function recordAdvisoryOperation(project, operation, meta = {}) {
  const at = new Date().toISOString();
  if (meta.reviewAdvisoryId && operation.kind === 'command') {
    const ledger = project.reviewAdvisoryDecisions ||= {};
    ledger[meta.reviewAdvisoryId] = { status: 'applied', at, actor: operation.actor, operationId: operation.id, checkedAt: project.quality?.checkedAt ?? null };
    prune(ledger);
  }
  for (const value of Object.values(project.reviewAdvisoryDecisions || {})) {
    if (operation.kind === 'undo' && value.status === 'applied' && value.operationId === operation.targetOperationId) Object.assign(value, { status: 'undone', at });
    else if (operation.kind === 'redo' && value.status === 'undone' && value.operationId === operation.targetOperationId) Object.assign(value, { status: 'applied', operationId: operation.id, at });
  }
}
