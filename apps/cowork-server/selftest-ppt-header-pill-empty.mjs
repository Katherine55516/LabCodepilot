// A section label a page writes nothing into goes with its header pill
// (Codex 2026-11-03, Deal-Review t8 on 3197 b1dd4719 p18: an empty pill above the title).
import assert from 'node:assert/strict';
import { fitHeaderPills } from './lib/ppt-header-pills.mjs';

const IN = 914400, g = (x, y, w, h) => ({ x: x * IN, y: y * IN, width: w * IN, height: h * IN });
const pill = { id: 'pill', type: 'shape', nativeRef: { shapeId: 3 }, geometry: g(0.72, 0.58, 0.75, 0.23), content: {} };
const label = text => ({ id: 'label', type: 'text', nativeRef: { shapeId: 4 }, geometry: g(0.82, 0.63, 1.23, 0.14), content: { text }, style: { fontSizePt: 10 } });
const title = { id: 'title', type: 'text', nativeRef: { shapeId: 5 }, geometry: g(0.72, 0.87, 6.89, 0.48), content: { text: 'Summary' } };
const spec = { slots: [{ role: 'section', shapeId: 4 }, { role: 'title', shapeId: 5 }], nodes: [pill, label('WRAP-UP'), title] };
const project = { templateFidelity: { mode: 'preserve', width: 13.33 * IN, height: 7.5 * IN, slides: [{}, spec] } };

{const slide = { id: 's', nodes: [structuredClone(pill), label(''), structuredClone(title)] };
 fitHeaderPills(project, slide, 1);
 assert.deepEqual(slide.templateOmissions.map(item => item.shapeId).sort(), [3, 4], 'the empty label and its pill are left out');
 assert.ok(slide.templateOmissions.every(item => item.approvalBasis === 'header_pill_fit'));
 assert.deepEqual(slide.nodes.map(node => node.id), ['title']);}

{const slide = { id: 's', nodes: [structuredClone(pill), label('收尾'), structuredClone(title)] };
 fitHeaderPills(project, slide, 1);
 assert.ok(!(slide.templateOmissions || []).length, 'a written label keeps its pill');}

console.log('PASS header pills: an empty section label leaves with its pill, a written one stays');
