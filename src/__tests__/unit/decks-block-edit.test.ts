/**
 * Decks block inspector helpers: table rows/columns, chart drafts and number
 * validation, item reordering and optional fields.
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-block-edit.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLE_LIMITS, addChartLabel, addChartSeries, addTableColumn, addTableRow, chartDraft, chartFromDraft, invalidCells, parseNumber,
  removeChartLabel, removeChartSeries, removeTableColumn, removeTableRow, sameChartData, setItemField, setTableCell, setTableHeader, swap,
  type ChartBlock, type TableBlock,
} from '../../components/decks/editor/inspector/block-edit';

const table: TableBlock = { id: 't', type: 'table', header: ['A', 'B'], rows: [['1', '2'], ['3', '4']] };
const chart: ChartBlock = { id: 'c', type: 'chart', chartType: 'bar', labels: ['Q1', 'Q2'], series: [{ name: 'Sales', values: [10, 12.5] }] };

describe('table edits', () => {
  it('sets header and cells without touching the source', () => {
    assert.deepEqual(setTableHeader(table, 1, 'Beta').header, ['A', 'Beta']);
    assert.deepEqual(setTableCell(table, 1, 0, 'x').rows, [['1', '2'], ['x', '4']]);
    assert.deepEqual(table.rows, [['1', '2'], ['3', '4']]);
  });
  it('adds and removes rows and columns, keeping rows aligned with the header', () => {
    const wider = addTableColumn(table, 'C');
    assert.deepEqual(wider.header, ['A', 'B', 'C']);
    assert.ok(wider.rows.every(r => r.length === 3));
    assert.deepEqual(removeTableColumn(wider, 0).rows, [['2', ''], ['4', '']]);
    assert.deepEqual(addTableRow(table).rows[2], ['', '']);
    assert.deepEqual(removeTableRow(table, 0).rows, [['3', '4']]);
  });
  it('keeps at least one row and column and respects the limits', () => {
    const one: TableBlock = { id: 't', type: 'table', header: ['A'], rows: [['1']] };
    assert.equal(removeTableColumn(one, 0), one);
    assert.equal(removeTableRow(one, 0), one);
    let big = table;
    for (let i = 0; i < 20; i++) big = addTableColumn(addTableRow(big), `C${i}`);
    assert.equal(big.rows.length, TABLE_LIMITS.rows);
    assert.equal(big.header.length, TABLE_LIMITS.cols);
  });
});

describe('chart drafts', () => {
  it('parses plain, signed, grouped and decimal numbers only', () => {
    assert.equal(parseNumber('1,234.5'), 1234.5);
    assert.equal(parseNumber(' -3 '), -3);
    assert.equal(parseNumber('−3'), -3);
    assert.equal(parseNumber('.5'), 0.5);
    assert.equal(parseNumber('2e3'), 2000);
    for (const bad of ['', '-', 'abc', '1.2.3', '12%', 'NaN', 'Infinity']) assert.equal(parseNumber(bad), null, bad);
  });
  it('round-trips a chart through its draft', () => {
    const draft = chartDraft(chart);
    assert.deepEqual(draft, { labels: ['Q1', 'Q2'], series: [{ name: 'Sales', values: ['10', '12.5'] }] });
    assert.deepEqual(chartFromDraft(draft), { labels: chart.labels, series: chart.series });
    assert.ok(sameChartData(draft, chart));
  });
  it('withholds data while any value is not a number and flags the cell', () => {
    const draft = chartDraft(chart);
    draft.series[0].values[1] = '1.2.';
    assert.equal(chartFromDraft(draft), null);
    assert.deepEqual(invalidCells(draft), [[false, true]]);
    assert.ok(!sameChartData(draft, chart));
  });
  it('adds and removes labels and series with limits', () => {
    const draft = addChartSeries(addChartLabel(chartDraft(chart), 'Q3'), 'Cost');
    assert.deepEqual(draft.labels, ['Q1', 'Q2', 'Q3']);
    assert.deepEqual(draft.series.map(s => s.values.length), [3, 3]);
    assert.deepEqual(chartFromDraft(draft)?.series[1], { name: 'Cost', values: [0, 0, 0] });
    assert.deepEqual(removeChartLabel(draft, 0).labels, ['Q2', 'Q3']);
    assert.deepEqual(removeChartLabel(draft, 0).series[0].values, ['12.5', '0']);
    const two = chartDraft(chart);
    assert.equal(removeChartLabel(two, 0), two, 'charts keep two labels');
    assert.equal(removeChartSeries(two, 0), two, 'charts keep one series');
    let many = two;
    for (let i = 0; i < 10; i++) many = addChartSeries(many, `S${i}`);
    assert.equal(many.series.length, 4);
  });
});

describe('items', () => {
  it('reorders by swapping neighbours and ignores moves past the ends', () => {
    assert.deepEqual(swap(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
    const list = ['a', 'b'];
    assert.equal(swap(list, 0, -1), list);
    assert.equal(swap(list, 1, 1), list);
  });
  it('removes an emptied optional field instead of storing ""', () => {
    assert.deepEqual(setItemField({ title: 'A', text: 'x' }, 'text', '', true), { title: 'A' });
    assert.deepEqual(setItemField({ title: 'A' }, 'title', '', false), { title: '' });
    assert.deepEqual(setItemField({ value: '1', label: 'L' }, 'value', '42%', false), { value: '42%', label: 'L' });
  });
});
