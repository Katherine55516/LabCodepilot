/* eslint-disable @typescript-eslint/no-explicit-any -- projects, routes and replies are loose JSON. */
// Plan ppt-editor-review-advisories: judged deck-review findings published as
// advisories are flagged in the editor, applied through the AI proposal and
// command path (undo/redo reopen and re-apply them) and dismissed in a ledger
// that survives the report being rebuilt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-review-advisories-'));
process.env.COWORK_STATE_DIR = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const lib = (name: string) => import(process.cwd() + '/apps/cowork-server/lib/' + name + '.mjs');

const BODY = 'The source-backed mechanism preserves its condition.';
const advisory = (extra: Record<string, unknown> = {}) => ({ code: 'model_unsupported', severity: 'warning', advisory: true, requiresReview: true, slideIds: ['s1'],
  detail: `“${BODY}” claims more than the source states.`, suggestedFix: 'State the condition exactly as the source does.', ...extra });

async function deckProject(uid: string) {
  const [store, ir, templates, repo] = await Promise.all(['ppt-store', 'ppt/ir', 'ppt-template', 'ppt/repository'].map(lib));
  const slides = ['Opening', 'Mechanism', 'Boundary'].map((title, i) => ({ id: 's' + i, title, bullets: i ? [[null, BODY, 'Applicability depends on the stated source condition.'][i]] : [], layoutId: i ? 'summary' : 'cover' }));
  const project = ir.ensureProjectV3({ uid, id: store.newId(), title: 'Advisories', template: 'light', templateSpec: templates.snapshotTemplate(templates.BUILT_INS.find((t: any) => t.id === 'light')),
    prompt: 'Explain the source-backed mechanism and its condition.', pages: 3, status: 'completed', revision: 1, publishedRevision: 1,
    outline: slides.map(s => ({ id: s.id, title: s.title, focus: s.title, refs: [] })), deck: { slides }, nodes: {},
    quality: { status: 'passed_with_warnings', checkedAt: 'report-1', reviewAdvisories: 1, modelIssues: [{ code: 'numeric_source', severity: 'error' }, advisory()] } });
  repo.saveProject(project); repo.saveRevision(project, 'baseline');
  return project;
}

test('an advisory has a stable identity and the reviewer\'s words locate its node', async () => {
  const { advisoryId, advisoryTarget } = await lib('ppt/review-advisories');
  assert.equal(advisoryId({ ...advisory(), slideIds: ['s2', 's1'] }), advisoryId({ ...advisory(), slideIds: ['s1', 's2'] }));
  assert.notEqual(advisoryId(advisory()), advisoryId(advisory({ detail: 'another finding' })));
  assert.match(advisoryId(advisory()), /^adv_[a-f0-9]{20}$/);
  const node = (id: string, type: string, semanticRole: string, content: any) => ({ id, type, semanticRole, content });
  const project = { deck: { slides: [{ id: 's1', nodes: [node('title_1', 'text', 'title', { text: 'Mechanism' }),
    node('body_1', 'list', 'body', { items: [{ id: 'i1', text: BODY }, { id: 'i2', text: 'Second point.' }] }), node('note_1', 'text', 'caption', { text: 'Footnote for the chart.' })] }] } };
  const target = (extra: Record<string, unknown>) => advisoryTarget(project, { slideIds: ['s1'], detail: 'Too broad.', ...extra }, 's1');
  assert.deepEqual(target({ nodeId: 'note_1' }), { slideId: 's1', nodeId: 'note_1', basis: 'reviewer' });
  assert.deepEqual(target({ detail: 'Node title_1 overstates the page.' }), { slideId: 's1', nodeId: 'title_1', basis: 'named' });
  assert.deepEqual(target({ bulletIndexes: [1] }), { slideId: 's1', nodeId: 'body_1', basis: 'bullets' });
  assert.deepEqual(target({ detail: `「${BODY}」 is unsupported.` }), { slideId: 's1', nodeId: 'body_1', basis: 'quote' });
  assert.deepEqual(target({ detail: 'The page omits the boundary condition.' }), { slideId: 's1', nodeId: null, basis: 'page' });
  assert.equal(advisoryTarget(project, { slideIds: ['s9'], detail: 'x' }, 's1'), null, 'a page the finding does not flag is not a target');
});

test('dismissed findings stay reviewed across reports; an applied fix only for the report it fixed', async () => {
  const { advisoryId, reviewAdvisoryView } = await lib('ppt/review-advisories');
  const issue = advisory(), id = advisoryId(issue);
  const project = (status: string, checkedAt: string) => ({ deck: { slides: [] }, quality: { checkedAt, modelIssues: [issue, issue] }, reviewAdvisoryDecisions: { [id]: { status, checkedAt: 'report-1', at: 't' } } });
  assert.equal(reviewAdvisoryView({ deck: { slides: [] }, quality: { modelIssues: [issue, issue] } }).modelIssues.length, 1, 'one entry per identity');
  assert.deepEqual(reviewAdvisoryView(project('dismissed', 'report-2')).reviewAdvisories, 0);
  assert.equal(reviewAdvisoryView(project('applied', 'report-1')).reviewAdvisories, 0);
  assert.equal(reviewAdvisoryView(project('applied', 'report-2')).reviewAdvisories, 1, 'a fresh review that still reports it reopens it');
  assert.equal(reviewAdvisoryView(project('undone', 'report-1')).reviewAdvisories, 1);
});

test('apply suggestion runs through the proposal and command path; undo reopens, redo re-applies', async () => {
  const [repo, proposals, commands, { advisoryId, reviewAdvisoryView, advisoryEditRequest }, { liveProjectView }] = await Promise.all(['ppt/repository', 'ppt/proposal-service', 'ppt/command-service', 'ppt/review-advisories', 'ppt/project-view'].map(lib));
  const { scopeReview } = await import(process.cwd() + '/apps/cowork-server/ppt-scope-test-helpers.mjs');
  const uid = 'advisory-apply', created = await deckProject(uid), id = advisoryId(advisory());
  // The live view every client reads used to drop modelIssues and the count.
  const view = liveProjectView(created).quality;
  assert.deepEqual(view.modelIssues.map((item: any) => [item.id, item.targets]), [[id, [{ slideId: 's1', nodeId: created.deck.slides[1].nodes.find((n: any) => n.semanticRole === 'body').id, basis: 'quote' }]]]);
  assert.equal(view.reviewAdvisories, 1);

  const request = advisoryEditRequest(created, { reviewAdvisoryId: id, slideId: 's1', baseRevision: 1, preview: true, instruction: 'client text is ignored' });
  assert.equal(request.scope, 'object'); assert.equal(request.type, 'content'); assert.equal(request.reviewAdvisoryId, id);
  assert.match(request.instruction, /State the condition exactly as the source does\./); assert.ok(request.instruction.length <= 1000);
  assert.throws(() => advisoryEditRequest(created, { reviewAdvisoryId: id, slideId: 's2', baseRevision: 1 }), /does not flag this page/);
  const body = created.deck.slides[1].nodes.find((n: any) => n.id === request.nodeId);
  const deps = { modelCall: async (project: any, prompt: string) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(project)
    : { content: { items: body.content.items.map((item: any) => ({ ...item, text: 'The mechanism preserves its condition when the source condition holds.' })) } } };
  const proposal = await proposals.createProposal(created, request, deps, () => {}, () => {});
  assert.equal(proposal.reviewAdvisoryId, id); assert.equal(repo.getProject(uid, created.id).revision, 1, 'a preview writes nothing');

  let project = (await proposals.applyProposal(uid, created.id, proposal.id)).project;
  assert.equal(project.revision, 2);
  const applied = reviewAdvisoryView(project);
  assert.equal(applied.reviewAdvisories, 0); assert.equal(applied.modelIssues[0].review.status, 'applied'); assert.equal(applied.modelIssues[0].review.operationId, proposal.id);

  project = (await commands.undo(uid, created.id)).project;
  assert.equal(reviewAdvisoryView(project).reviewAdvisories, 1, 'undoing the fix reopens the finding');
  assert.equal(project.deck.slides[1].nodes.find((n: any) => n.id === body.id).content.items[0].text, BODY);
  project = (await commands.redo(uid, created.id)).project;
  assert.equal(reviewAdvisoryView(project).modelIssues[0].review?.status, 'applied', 'redo applies it again');
  project = (await commands.undo(uid, created.id)).project;
  assert.equal(reviewAdvisoryView(repo.getProject(uid, created.id)).reviewAdvisories, 1, 'undo of the redo reopens it again');
});

test('dismiss and reopen through the API: revision checked but not advanced, count lowered, published state kept', async () => {
  const [{ handleStructuredPpt }, repo, { advisoryId }] = await Promise.all(['ppt/api', 'ppt/repository', 'ppt/review-advisories'].map(lib));
  const uid = 'advisory-dismiss', created = await deckProject(uid), id = advisoryId(advisory());
  const call = async (route: string, body: unknown) => {
    let result: any;
    const handled = await handleStructuredPpt({ method: 'POST', headers: {} }, new URL(`http://cowork/ppt/projects/${created.id}/${route}?view=live`),
      { uid, send: (status: number, value: unknown) => { result = { status, value }; return true; }, readBody: async () => JSON.stringify(body), deps: {}, log: () => {} });
    assert.ok(handled); return result;
  };
  const stale = await call(`review-advisories/${id}`, { status: 'dismissed', baseRevision: 0 });
  assert.equal(stale.status, 409); assert.equal(stale.value.details.currentRevision, 1);
  assert.equal((await call('review-advisories/adv_00000000000000000000', { status: 'dismissed', baseRevision: 1 })).status, 404);
  const dismissed = await call(`review-advisories/${id}`, { status: 'dismissed', baseRevision: 1 });
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.value.project.quality.reviewAdvisories, 0); assert.equal(dismissed.value.project.quality.reviewedAdvisories, 1);
  assert.equal(dismissed.value.project.quality.modelIssues[0].review.status, 'dismissed');
  const stored = repo.getProject(uid, created.id);
  assert.equal(stored.revision, 1); assert.equal(stored.publishedRevision, 1, 'a review note does not turn the published deck into a draft');
  assert.equal(stored.reviewAdvisoryDecisions[id].status, 'dismissed');
  assert.equal((await call(`review-advisories/${id}`, { status: 'dismissed', baseRevision: 1 })).status, 200, 'dismiss is idempotent');
  assert.equal((await call(`ai-edit`, { reviewAdvisoryId: id, slideId: 's1', baseRevision: 1, preview: true })).status, 409, 'a reviewed finding has no suggestion to apply');
  const reopened = await call(`review-advisories/${id}`, { status: 'open', baseRevision: 1 });
  assert.equal(reopened.value.project.quality.reviewAdvisories, 1); assert.equal(reopened.value.project.quality.modelIssues[0].review, undefined);
  assert.equal((await call(`review-advisories/${id}`, { status: 'resolved', baseRevision: 1 })).status, 400);
});
