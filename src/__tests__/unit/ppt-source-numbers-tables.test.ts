/* eslint-disable @typescript-eslint/no-explicit-any -- projects and inventories are loose JSON. */
// Real case (verification run 5, 2026-10-22): the result table was selected as
// a summary, so its inventory item became a SummaryTableBlock. The number check
// only read TableBlock rows; the cells were parsed as prose, one per line, and
// each value took its context from the following row. -49% (P50 latency) was
// "attributed" to monthly GPU cost and the verbatim source table blocked
// publication after two critic rounds that could not change it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lib = (name: string) => import(process.cwd() + '/apps/cowork-server/lib/' + name + '.mjs');
const fixture = JSON.parse(fs.readFileSync(process.cwd() + '/apps/cowork-server/test/fixtures/ppt-vector-search-real-replies.json', 'utf8'));

async function deckWith(rows: (table: any) => string[][], type = 'SummaryTableBlock') {
  const { normalizePaste } = await lib('ppt-source');
  const source = normalizePaste(fixture.source);
  const original = source.semantic.inventory;
  const table = original.items.find((item: any) => item.rows?.some((row: string[]) => row.includes('-49%')));
  const shown = { ...table, type, rows: table.rows, text: table.rows.map((row: string[]) => row.join(' | ')).join('\n') };
  const project = {
    source: { ...source, semantic: { ...source.semantic, inventory: { ...original, items: original.items.map((item: any) => item.id === table.id ? shown : item) } } },
    originalSourceInventory: original,
    generationPolicy: { version: 2, knowledge: 'source_only' },
    deck: { slides: [{ id: 's1', title: '优化后量化结果', nodes: [{ id: 't1', type: 'table', semanticRole: 'source-structure', content: { rows: rows(table) }, sourceArtifact: { sourceUnitId: table.id } }] }] },
  };
  return { project, table };
}

test('a summary-selected source table authorizes its own cells', async () => {
  const { inspectSourceNumbers } = await lib('ppt-source-numbers');
  const { project } = await deckWith(table => table.rows);
  assert.deepEqual(inspectSourceNumbers(project), [], 'the verbatim table is the source, not a new claim');
});

test('selected rows of the table are checked against their own row labels', async () => {
  const { inspectSourceNumbers } = await lib('ppt-source-numbers');
  const { project } = await deckWith(table => [table.rows[0], ...table.rows.filter((row: string[]) => /P50|GPU/u.test(row[0]))]);
  assert.deepEqual(inspectSourceNumbers(project), []);
});

test('a value the source does not have is still reported', async () => {
  const { inspectSourceNumbers } = await lib('ppt-source-numbers');
  const { project } = await deckWith(table => table.rows.map((row: string[]) => row.map(cell => cell === '-49%' ? '-55%' : cell)));
  const issues = inspectSourceNumbers(project);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].numericFindings.map((f: any) => [f.raw + f.unit, f.reason]), [['-55%', 'value_or_sign_not_in_input']]);
});
