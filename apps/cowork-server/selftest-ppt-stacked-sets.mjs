// A stacked template drawing (a funnel, a staircase of pictures) retires whole:
// a theme page never leaves one piece floating (Codex 2026-11-03, Capabilities
// t9 on 3197 0b5a7f1b p2).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replaceTemplateSourceRegion } from './lib/ppt-source-artifacts.mjs';
import { slotsFor } from './lib/ppt-template-fidelity.mjs';

const f = JSON.parse(fs.readFileSync(new URL('./test/fixtures/fill-profiles/capabilities.json', import.meta.url))), IN = 914400;
const spec = { ...f.catalog[8], slots: slotsFor({ nodes: f.catalog[8].nodes }) };
const project = { templateFidelity: { mode: 'preserve', width: f.width, height: f.height, slides: [{}, spec] }, outline: [{}, { id: 'p' }] };
// A content region over the funnel's top half only.
const slide = { id: 's', templateOmissions: [] };
replaceTemplateSourceRegion(project, slide, 1, { x: 5.72 * IN, y: 1.4 * IN, width: 6.9 * IN, height: 2.2 * IN }, { retireIcons: true, oldContentByPosition: true });
const ids = new Set(slide.templateOmissions.map(item => String(item.shapeId)));
assert.deepEqual(['4', '9', '14', '19'].filter(id => ids.has(id)), ['4', '9', '14', '19'], 'every piece of the funnel');
assert.deepEqual(['5', '10', '15', '20'].filter(id => ids.has(id)), ['5', '10', '15', '20'], 'and the icons on it');
// The four trapezoids are one set, so no theme page keeps one as stand-alone
// artwork (live 640e0f98 p7 kept the third piece beside its bullets).
{const { stackedPictureIds } = await import('./lib/ppt-stacked-pictures.mjs');
 assert.deepEqual([...stackedPictureIds(spec)].sort(), ['14', '19', '4', '9']);
 const partly = { id: 's2', templateOmissions: [] };
 replaceTemplateSourceRegion(project, partly, 1, { x: 5.72 * IN, y: 1.4 * IN, width: 6.9 * IN, height: 2.2 * IN }, { keep: new Set([14]), retireIcons: true, oldContentByPosition: true });
 assert.ok(partly.templateOmissions.some(item => String(item.shapeId) === '14'), 'a kept piece still goes with its set');}
console.log('PASS stacked template drawings retire whole, and no piece is kept alone');
