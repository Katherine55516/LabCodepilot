/* eslint-disable @typescript-eslint/no-explicit-any -- projects and decks are loose JSON. */
// Real case (verification run 1, 2026-10-22): a one-page outline card's section
// equals its page title. Copy normalization cleared that eyebrow, but the final
// repair re-derived it, so "第四季度改进计划" printed twice and the deck review
// flagged the page.
import test from 'node:test';
import assert from 'node:assert/strict';

const lib = (name: string) => import(process.cwd() + '/apps/cowork-server/lib/' + name + '.mjs');

async function project() {
  const { normalizePaste } = await lib('ppt-source');
  const source = normalizePaste('# 复盘\n\n## 风险与计划\n\n跨业务查询仍然走全分片检索。\n\n第四季度建立联合路由模型。');
  const [risk, plan] = source.semantic.inventory.items;
  const eyebrow = (id: string, text: string) => ({ id, type: 'text', semanticRole: 'eyebrow', content: { text } });
  return {
    generationPolicy: { version: 2, language: { mode: 'source', body: 'both' } }, planning: { editorialBlueprint: { version: 1 } }, source,
    outline: [
      { id: 'cover', title: '复盘', sourceUnitIds: [] },
      { id: 'plan', title: '第四季度改进计划', section: '第四季度改进计划', planningProtocolVersion: 2, sourceUnitIds: [plan.id] },
      { id: 'risk', title: '遗留风险', section: '风险与计划', planningProtocolVersion: 2, sourceUnitIds: [risk.id] },
    ],
    deck: { slides: [
      { id: 'cover', title: '复盘', nodes: [] },
      { id: 'plan', title: '第四季度改进计划', copy: { eyebrow: '第四季度改进计划' }, nodes: [eyebrow('e1', '第四季度改进计划')] },
      { id: 'risk', title: '遗留风险', copy: { eyebrow: '旧标签' }, nodes: [eyebrow('e2', '旧标签')] },
    ] },
  } as any;
}

test('a navigation label that only repeats its page title is not shown', async () => {
  const { normalizeDeckEyebrows } = await lib('ppt-section-eyebrow');
  const p = await project();
  normalizeDeckEyebrows(p);
  const plan = p.deck.slides[1];
  assert.equal(plan.copy.eyebrow, '');
  assert.equal(plan.nodes[0].content.text, '');
});

test('a distinct section label is kept, and re-deriving it is stable', async () => {
  const { normalizeDeckEyebrows } = await lib('ppt-section-eyebrow');
  const p = await project();
  normalizeDeckEyebrows(p);
  const once = JSON.stringify(p.deck);
  normalizeDeckEyebrows(p);
  assert.equal(JSON.stringify(p.deck), once);
  assert.equal(p.deck.slides[2].copy.eyebrow, '风险与计划');
  assert.equal(p.deck.slides[2].nodes[0].content.text, '风险与计划');
});

test('a numbered label over the same title still places the page and stays', async () => {
  const { normalizeDeckEyebrows } = await lib('ppt-section-eyebrow');
  const p = await project();
  p.outline[1].section = '3 第四季度改进计划';
  normalizeDeckEyebrows(p);
  assert.equal(p.deck.slides[1].copy.eyebrow, '3 第四季度改进计划');
});
