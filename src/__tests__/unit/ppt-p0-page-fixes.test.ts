import test from 'node:test';
import assert from 'node:assert/strict';

const m = (name: string) => import('../../../apps/cowork-server/lib/' + name + '.mjs');

type Node = { id: string; type: string; content?: { text?: string; items?: { id: string; text: string }[] }; geometry?: { x: number; y: number; width: number; height: number }; nativeRef?: { shapeId: number }; style?: object };
const geometry = { x: 914400, y: 1828800, width: 3657600, height: 914400 };
const deckWith = (nodes: Node[]) => ({ slides: [{ id: 'page_a', nodes }, { id: 'page_b', nodes: [] as Node[] }] });

test('paste onto another page copies the objects from the page they were copied on', async () => {
  const { _internals } = await m('ppt/command-service');
  const { normalizeCommand } = await m('ppt/command-schema');
  const deck = deckWith([{ id: 'title', type: 'text', content: { text: 'Copied title' }, geometry, style: {} }]);
  const command = normalizeCommand({ type: 'nodes.duplicate', baseRevision: 1, payload: { slideId: 'page_b', sourceSlideId: 'page_a', nodeIds: ['title'] } }, { deck });
  const { deck: next, inverse } = _internals.applyToDeck(structuredClone(deck), command);
  const [source, target] = next.slides;
  assert.deepEqual(source.nodes.map((node: Node) => node.id), ['title'], 'the source page is unchanged');
  const pasted = target.nodes.filter((node: Node) => node.content?.text === 'Copied title');
  assert.equal(pasted.length, 1);
  assert.notEqual(pasted[0].id, 'title', 'the copy has its own id');
  assert.deepEqual(pasted[0].geometry, geometry, 'a paste on another page keeps the copied position');
  assert.deepEqual(inverse, { type: 'nodes.delete', payload: { slideId: 'page_b', nodeIds: [pasted[0].id] } }, 'undo removes the pasted copy from the target page');
});

test('same-page duplicate still offsets, and a missing source page is rejected', async () => {
  const { _internals } = await m('ppt/command-service');
  const { normalizeCommand } = await m('ppt/command-schema');
  const deck = deckWith([{ id: 'title', type: 'text', content: { text: 'Copied title' }, geometry, style: {} }]);
  const same = normalizeCommand({ type: 'nodes.duplicate', baseRevision: 1, payload: { slideId: 'page_a', nodeIds: ['title'] } }, { deck });
  const copy = _internals.applyToDeck(structuredClone(deck), same).deck.slides[0].nodes[1];
  assert.equal(copy.geometry.x, geometry.x + 182880);
  assert.throws(() => normalizeCommand({ type: 'nodes.duplicate', baseRevision: 1, payload: { slideId: 'page_b', sourceSlideId: 'page_x', nodeIds: ['title'] } }, { deck }), /source slide not found/);
  // Before the fix the editor sent source-page ids against the target page.
  const legacy = normalizeCommand({ type: 'nodes.duplicate', baseRevision: 1, payload: { slideId: 'page_b', nodeIds: ['title'] } }, { deck });
  assert.throws(() => _internals.applyToDeck(structuredClone(deck), legacy), /not found/);
});

test('template objects cannot be pasted onto another page', async () => {
  const { _internals } = await m('ppt/command-service');
  const { normalizeCommand } = await m('ppt/command-schema');
  const deck = deckWith([{ id: 'native', type: 'text', nativeRef: { shapeId: 4 }, content: { text: 'Template text' }, geometry, style: {} }]);
  const command = normalizeCommand({ type: 'nodes.duplicate', baseRevision: 1, payload: { slideId: 'page_b', sourceSlideId: 'page_a', nodeIds: ['native'] } }, { deck });
  assert.throws(() => _internals.applyToDeck(structuredClone(deck), command), /only be duplicated on their own page/);
});

test('a cross-page paste reads its objects on the source page for conflict checks', async () => {
  const { commandTargets, commandsConflict } = await m('ppt/command-schema');
  const paste = { type: 'nodes.duplicate', payload: { slideId: 'page_b', sourceSlideId: 'page_a', nodeIds: ['title'] } };
  assert.deepEqual(commandTargets(paste), ['slide:page_b', 'node:page_a:title']);
  assert.equal(commandsConflict(paste, { type: 'node.setContent', payload: { slideId: 'page_a', nodeId: 'title' } }), true, 'a concurrent edit of a copied object is a conflict');
  assert.equal(commandsConflict(paste, { type: 'node.setContent', payload: { slideId: 'page_c', nodeId: 'title' } }), false, 'an edit on an unrelated page is not');
});

test('inline list edits keep item ids by content, not by line number', async () => {
  const { inlineListItems } = await import('../../lib/ppt-inline-list');
  const before = [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }, { id: 'c', text: 'Gamma', richText: { source: '**Gamma**' } }];
  let counter = 0; const newId = () => `new${++counter}`;
  const ids = (text: string) => { const result = inlineListItems(before, text, newId); assert.ok('items' in result); return result.items.map(item => item.id); };
  assert.deepEqual(ids('Inserted\nAlpha\nBeta\n**Gamma**'), ['new1', 'a', 'b', 'c'], 'inserting at the top does not shift the following ids');
  assert.deepEqual(ids('Alpha\nBeta edited\n**Gamma**'), ['a', 'b', 'c'], 'a line edited in place keeps its id');
  assert.deepEqual(ids('**Gamma**\nAlpha\nBeta'), ['c', 'a', 'b'], 'a moved line keeps its id');
  assert.deepEqual(ids('Alpha\n\n  \n**Gamma**'), ['a', 'c'], 'blank lines are dropped and the deleted item is gone');
  assert.deepEqual(ids('Alpha\nNew one\nNew two\nBeta\n**Gamma**'), ['a', 'new2', 'new3', 'b', 'c']);
});

test('inline list edits over the server item limit are rejected instead of truncated', async () => {
  const { inlineListItems, PPT_MAX_LIST_ITEMS } = await import('../../lib/ppt-inline-list');
  const lines = Array.from({ length: PPT_MAX_LIST_ITEMS + 3 }, (_, index) => `Item ${index + 1}`).join('\n');
  assert.deepEqual(inlineListItems([], lines, () => 'x'), { error: { max: PPT_MAX_LIST_ITEMS, count: PPT_MAX_LIST_ITEMS + 3 } });
  const atLimit = inlineListItems([], lines.split('\n').slice(0, PPT_MAX_LIST_ITEMS).join('\n'), () => 'x');
  assert.ok('items' in atLimit && atLimit.items.length === PPT_MAX_LIST_ITEMS);
  // The client limit mirrors the server's content.items validation.
  const { validateNodeContent } = await m('ppt/command-schema');
  const items = (count: number) => ({ items: Array.from({ length: count }, (_, index) => ({ id: `i${index}`, text: `Item ${index}` })) });
  assert.doesNotThrow(() => validateNodeContent('list', items(PPT_MAX_LIST_ITEMS)));
  assert.throws(() => validateNodeContent('list', items(PPT_MAX_LIST_ITEMS + 1)), /items is invalid/);
});

type Polled = { id: string; status: string; error?: string };
const messages = { failedMessage: 'failed', timeoutMessage: 'timeout' };

test('outline polling returns the ready project and reports each read', async () => {
  const { pollOutlineProject } = await import('../../lib/ppt-outline-poll');
  const states = ['ingesting', 'outlining', 'outline_ready'];
  const seen: string[] = [];
  const project = await pollOutlineProject<Polled>({ ...messages, read: async () => ({ id: 'p1', status: states.shift()! }), onProgress: value => seen.push(value.status), wait: async () => {} });
  assert.equal(project.status, 'outline_ready');
  assert.deepEqual(seen, ['ingesting', 'outlining', 'outline_ready']);
});

test('aborting outline polling stops further reads and drops the in-flight result', async () => {
  const { pollOutlineProject, isPptAbort } = await import('../../lib/ppt-outline-poll');
  const controller = new AbortController();
  let reads = 0; const seen: string[] = [];
  const polling = pollOutlineProject<Polled>({ ...messages, signal: controller.signal, intervalMs: 5,
    read: async () => { reads++; if (reads === 2) controller.abort(); return { id: 'stale', status: 'outlining' }; },
    onProgress: value => seen.push(value.id) });
  await assert.rejects(polling, error => isPptAbort(error));
  assert.equal(reads, 2, 'no read starts after the abort');
  assert.deepEqual(seen, ['stale'], 'the read that resolved after the abort is not reported');
});

test('aborting during the wait between reads stops immediately', async () => {
  const { pollOutlineProject, isPptAbort } = await import('../../lib/ppt-outline-poll');
  const controller = new AbortController(); let reads = 0;
  const polling = pollOutlineProject<Polled>({ ...messages, signal: controller.signal, intervalMs: 60_000, read: async () => { reads++; return { id: 'p', status: 'outlining' }; } });
  setTimeout(() => controller.abort(), 10);
  const started = Date.now();
  await assert.rejects(polling, error => isPptAbort(error));
  assert.ok(Date.now() - started < 5_000, 'the one-minute wait is cut short');
  assert.equal(reads, 1);
});

test('failed and timed-out outline polling carry the last known project', async () => {
  const { pollOutlineProject } = await import('../../lib/ppt-outline-poll');
  await assert.rejects(pollOutlineProject<Polled>({ ...messages, read: async () => ({ id: 'p', status: 'failed', error: 'model error' }), wait: async () => {} }),
    (error: Error & { project?: Polled }) => error.message === 'model error' && error.project?.id === 'p');
  await assert.rejects(pollOutlineProject<Polled>({ ...messages, maxAttempts: 2, read: async () => ({ id: 'p', status: 'outlining' }), wait: async () => {} }),
    (error: Error & { project?: Polled }) => error.message === 'timeout' && error.project?.status === 'outlining');
  const initial = { id: 'created', status: 'ingesting' };
  await assert.rejects(pollOutlineProject<Polled>({ ...messages, initial, read: async () => { throw new Error('network'); } }),
    (error: Error & { project?: Polled }) => error.project === initial, 'a read failure still points the failure dialog at the created project');
});

// Real-run regression (2026-10-22): a summary page restating "P99 降低 67%" and
// body-page numbers was quality-blocked although every number was sourced.
const sourceText = '索引规模约 4,800 万条向量。跨业务查询占总查询的 9%，P99 约 420 ms。';
const table = { id: 'b_table', type: 'TableBlock', text: '| 指标 | 优化前 | 优化后 | 变化 |', rows: [['指标', '优化前', '优化后', '变化'], ['P99 延迟', '640 ms', '210 ms', '-67%'], ['P50 延迟', '95 ms', '48 ms', '-49%'], ['每月 GPU 成本', '21.4 万元', '11.2 万元', '-48%']] };
const numberProject = (closing: string) => {
  const textNode = (id: string, text: string) => ({ id, type: 'text', content: { text } });
  return {
    source: { text: sourceText + '\n' + table.text, segments: [{ id: 'seg1', text: sourceText }], semantic: { inventory: { items: [table], relationships: [] }, chunks: [], evidenceAtoms: [] } },
    generationPolicy: { knowledge: 'source_only' },
    outline: [{ id: 'p1', role: 'problem' }, { id: 'p2', role: 'closing' }],
    deck: { slides: [
      { id: 'p1', title: '背景', sourceRefs: ['seg1'], nodes: [textNode('a', sourceText)] },
      { id: 'p2', title: '总结', sourceRefs: [], nodes: [textNode('b', closing)] },
    ] },
  };
};

test('a decrease word states a negative source value; the opposite direction is still unsupported', async () => {
  const { inspectSourceNumbers } = await m('ppt-source-numbers');
  const reasons = (closing: string) => inspectSourceNumbers(numberProject(closing)).flatMap((issue: { numericFindings: { raw: string; reason: string }[] }) => issue.numericFindings.map(f => `${f.raw}:${f.reason}`));
  assert.deepEqual(reasons('P99 降低 67%，每月 GPU 成本下降了 48%。'), []);
  // The source also has "48 ms"; that positive value must not shadow -48%.
  assert.deepEqual(reasons('P50 优化后为 48 ms，每月 GPU 成本降低 48%。'), []);
  assert.deepEqual(reasons('P99 提升 67%。'), ['67:value_or_sign_not_in_input'], 'an increase is not the source -67%');
  assert.deepEqual(reasons('P99 降至 67%。'), ['67:value_or_sign_not_in_input'], '"降至" names a level, not a change');
});

test('a closing page without its own source may restate numbers the other pages cite, and only those', async () => {
  const { inspectContent } = await m('ppt-content-qa');
  const unsupported = (closing: string) => inspectContent(numberProject(closing)).issues.filter((issue: { code: string; slideId: string }) => issue.code === 'visible_numeric_fidelity' && issue.slideId === 'p2').map((issue: { message: string }) => issue.message);
  assert.deepEqual(unsupported('当前 4,800 万条向量规模下，跨业务查询占比 9% 且 P99 约 420 ms。'), []);
  const extra = unsupported('当前 4,800 万条向量，GPU 成本 99 万元。');
  assert.equal(extra.length, 1, 'a number no page cites is still blocked');
  assert.match(extra[0], /99 万/);
});
