/* eslint-disable @typescript-eslint/no-explicit-any -- model replies and schemas are loose JSON. */
// Plan ppt-pipeline-unblocked phase 4: every model reply is settled against its
// own stage schema before any validator. Only identifiers, enum values and
// planning reasons change; visible content text never does.
import test from 'node:test';
import assert from 'node:assert/strict';

const lib = (name: string) => import(process.cwd() + '/apps/cowork-server/lib/' + name + '.mjs');
const ids = { type: 'array', items: { type: 'string', enum: ['b_0020', 'b_0022'] } };
const schema = { type: 'object', properties: {
  sufficient: { type: 'boolean' }, missingSourceUnitIds: ids, reason: { type: 'string', minLength: 1, maxLength: 40 },
  cards: { type: 'array', items: { type: 'object', properties: { title: { type: 'string', maxLength: 8 }, points: { type: 'array', items: { type: 'string' } }, dependsOn: { type: 'array', uniqueItems: true, items: { type: 'integer' } } } } },
  checks: { type: 'array', items: { type: 'object', properties: { status: { type: 'string', enum: ['entailed', 'unsupported'] }, reason: { type: 'string', maxLength: 30 } } } },
} };

test('a repeated ID is removed; a repeated content line is not', async () => {
  const { normalizeReply } = await lib('ppt-reply-normalize');
  // Real reply (2026-10-22): missingSourceUnitIds [b_0020, b_0020].
  const { value, notes } = normalizeReply({ sufficient: false, missingSourceUnitIds: ['b_0020', 'b_0020'], reason: 'Risk list is absent.', cards: [{ title: 'Risks', points: ['P99 420 ms', 'P99 420 ms'], dependsOn: [1, 1, 2] }] }, schema);
  assert.deepEqual(value.missingSourceUnitIds, ['b_0020']);
  assert.deepEqual(value.cards[0].dependsOn, [1, 2]);
  assert.deepEqual(value.cards[0].points, ['P99 420 ms', 'P99 420 ms'], 'points are content: unchanged');
  assert.deepEqual(notes.map((n: any) => [n.code, n.path]), [['duplicate_ids_removed', 'missingSourceUnitIds'], ['duplicate_ids_removed', 'cards[0].dependsOn']]);
});

test('an enum value in whitespace is trimmed; an unknown value is left for the validator', async () => {
  const { normalizeReply } = await lib('ppt-reply-normalize');
  const { value, notes } = normalizeReply({ missingSourceUnitIds: [' b_0022', 'b_9999'], checks: [{ status: 'entailed\n' }, { status: 'maybe' }] }, schema);
  assert.deepEqual(value.missingSourceUnitIds, ['b_0022', 'b_9999']);
  assert.deepEqual(value.checks.map((c: any) => c.status), ['entailed', 'maybe']);
  assert.deepEqual(notes.map((n: any) => n.path), ['missingSourceUnitIds[0]', 'checks[0].status']);
});

test('only a planning reason is shortened, at a boundary and within its limit', async () => {
  const { normalizeReply } = await lib('ppt-reply-normalize');
  const long = 'The first sentence is complete. The second one runs past the limit.';
  const { value, notes } = normalizeReply({ reason: long, cards: [{ title: 'A title longer than eight' }], checks: [{ status: 'unsupported', reason: '来源只说先路由到分片，没有说默认，这一条理由超过了三十个字的上限。' }] }, schema);
  assert.equal(value.reason, 'The first sentence is complete.');
  assert.ok(value.checks[0].reason.length <= 30 && value.checks[0].reason.endsWith('默认'), value.checks[0].reason);
  assert.equal(value.cards[0].title, 'A title longer than eight', 'a visible title over its limit is the validator\'s decision');
  assert.deepEqual(notes.map((n: any) => n.code), ['reason_shortened', 'reason_shortened']);
});

test('a reply that needs nothing is returned as is', async () => {
  const { normalizeReply } = await lib('ppt-reply-normalize');
  const reply = { sufficient: true, missingSourceUnitIds: [], reason: 'Covered.', cards: [{ title: 'Risks', points: ['a'], dependsOn: [0] }] };
  const { value, notes } = normalizeReply(reply, schema);
  assert.equal(value, reply);
  assert.deepEqual(notes, []);
  assert.equal(normalizeReply(reply, undefined).value, reply);
});
