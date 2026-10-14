import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedPageDecision } from '../../../apps/cowork-server/lib/ppt-page-decision.mjs';
const project = { pages: 15, template: 'uploaded', pageDecision: { mode: 'auto', source: 'estimate', initialPageCount: 9, finalPageCount: 15, fitValidated: true } };
test('confirming module-calibrated N preserves initial estimate, mode and fit provenance', () => {
  const before = structuredClone(project);
  assert.deepEqual(confirmedPageDecision(project, { nextPages: 15, pageSource: 'estimate', template: 'uploaded' }, 'now'), { ...project.pageDecision, confirmedAt: 'now' });
  assert.deepEqual(project, before);
});
test('changed N, template or explicit request never inherits an automatic fit', () => {
  for (const input of [{nextPages: 14, pageSource: 'estimate'}, {nextPages: 15, pageSource: 'estimate', template: 'other'}, {nextPages: 15, pageSource: 'user'}, {nextPages: 15}]) {
    const result = confirmedPageDecision(project, input, 'now');
    assert.equal(result.mode, 'explicit'); assert.equal(result.fitValidated, undefined); assert.equal(result.initialPageCount, undefined);
  }
});

test('only an explicit current revision action releases a manual budget, preserving protected imported modes', async()=>{
 const {automaticPageDecision}=await import('../../../apps/cowork-server/lib/ppt-page-decision.mjs');
 const p={...project,revision:2,status:'quality_blocked',planning:{pageRecommendation:{recommended:9}}};
 assert.throws(()=>automaticPageDecision(p,1));assert.throws(()=>automaticPageDecision({...p,externalPptx:{}},2));assert.throws(()=>automaticPageDecision({...p,status:'generating'},2));
 const next=automaticPageDecision(p,2,'now');assert.equal(next.mode,'auto');assert.equal(next.finalPageCount,15);assert.equal(next.initialPageCount,9);assert.equal(p.pageDecision.finalPageCount,15);
});
