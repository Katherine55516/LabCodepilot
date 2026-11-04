// Full review E3 and E7 (template categories, F10, are ported separately).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pptFailureKind, pptRetryPlan } from '../../lib/ppt-retry';
import { pptProgressTotal } from '../../lib/ppt-page-label';
import type { PptProject } from '../../components/ppt/types';

const base: PptProject = { id: 'r', title: 'Retry', prompt: 'Source', template: 'light', model: 'm', configId: 'byok:test', inputKind: 'paste', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', status: 'failed', stage: 'generation', pages: 12, outline: Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, title: 'T' + i, bullets: [] })), revision: 0, error: '', deck: null };
const slide = { id: 'x', title: 'x', bullets: [] };

test('retry names the resumed stage and the finished pages it keeps', () => {
  const nodes = { source: { status: 'done' }, s0: { status: 'done', slide }, s1: { status: 'done', slide }, s2: { status: 'pending' } };
  assert.deepEqual(pptRetryPlan({ ...base, nodes }), { stage: 'generation', kept: 2, total: 12 });
  assert.deepEqual(pptRetryPlan({ ...base, stage: 'outline' }), { stage: 'outline', kept: 0, total: 12 });
  assert.deepEqual(pptRetryPlan({ ...base, stage: 'ingest' }), { stage: 'ingest', kept: 0, total: 12 });
  assert.deepEqual(pptRetryPlan({ ...base, stage: 'outline', failure: { version: 2, stage: 'outline', code: 'request_invalid', model: 'm', at: '', modelStage: 'input:understand' } }), { stage: 'read', kept: 0, total: 12 });
  assert.deepEqual(pptRetryPlan({ ...base, status: 'quality_blocked' }), { stage: 'review', kept: 12, total: 12 });
});

test('failures split into retryable and needs-a-change', () => {
  assert.equal(pptFailureKind({ ...base, error: 'PPT model failure: timeout' }), 'recoverable');
  assert.equal(pptFailureKind({ ...base, error: 'ppt_rate_limit HTTP 429' }), 'recoverable');
  assert.equal(pptFailureKind({ ...base, error: 'ppt_capacity_invalid: content exceeds the template' }), 'needs_change');
  assert.equal(pptFailureKind({ ...base, error: 'PPT model failure: auth' }), 'needs_change');
  assert.equal(pptFailureKind({ ...base, error: 'something unexpected' }), 'unknown');
  assert.equal(pptFailureKind({ ...base, error: 'PPT task attempt limit reached; inspect the failed task before retrying' }), 'needs_change', 'a spent attempt budget is not fixed by retrying');
  assert.equal(pptFailureKind({ ...base, status: 'quality_blocked', qualityBlockReason: 'checks' }), 'needs_change');
  assert.equal(pptFailureKind({ ...base, status: 'quality_blocked', qualityBlockReason: 'export' }), 'unknown', 'an export check failure is not blamed on the content');
});

test('an unread input is not shown as a page total', () => {
  assert.equal(pptProgressTotal({ pages: 3, pageDecision: { finalPageCount: 3, source: 'estimate', includesCover: true, confirmedAt: null, awaitingInputRead: true } }), '…');
  assert.equal(pptProgressTotal({ pages: 12 }), 12);
});


test('task summary cover projection does not turn a 20-page retry into one page',()=>{
 const summary={...base,status:'quality_blocked' as const,pages:20,outline:[{id:'cover',title:'Deck'}],progress:{contentReady:20,previewReady:20,total:20,phase:'quality',quality:'blocked',lastUpdated:''}};
 assert.deepEqual(pptRetryPlan(summary),{stage:'review',kept:20,total:20});
});
