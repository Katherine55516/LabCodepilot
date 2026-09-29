import assert from 'node:assert/strict';
import { _internals as pptApi } from './lib/ppt-api.mjs';
import { normalizeCommand } from './lib/ppt/command-schema.mjs';
import { estimatePageRecommendation } from './lib/ppt-planning.mjs';

assert.equal(pptApi.pages(100), 100);
assert.throws(() => pptApi.pages(101), /between 3 and 100/);
const project = { uid: 'long-limits-test', deck: { slides: Array.from({ length: 99 }, (_, index) => ({ id: `s${index}`, title: `Slide ${index}`, nodes: [] })) },
  templateSpec: { fonts: { title: 'Arial', body: 'Arial' } } };
const insert = { type: 'slide.insert', baseRevision: 0, payload: { index: 99,
  slide: { title: 'New slide', bullets: [], blocks: [], layoutId: 'summary' } } };
assert.equal(normalizeCommand(insert, project).payload.index, 99);
project.deck.slides.push({ id: 's99', title: 'Slide 99', nodes: [] });
assert.throws(() => normalizeCommand(insert, project), /at most 100 slides/);
const recommendation = estimatePageRecommendation({ pages: 100, inputKind: 'file', source: { kind: 'file', text: 'x', semantic: { chunks: [] } } });
assert.equal(recommendation.selected, 100);
console.log('PPT 100-page API, planner and editor command limits: OK');
