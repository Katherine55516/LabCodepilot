// A template's label component (Mood-Board's numbered clover: four stacked
// petal pictures, a label beside each, no description slot under the labels)
// is filled from a card (Fable 2026-11-02, P-A): headings into the labels at
// the template's size, the sentences into the frame's own body slot as a list
// numbered like the component (12 pt floor); a heading that does not fit, a
// mismatched count or sentences with no room refuse the frame (never notes).
import assert from 'node:assert/strict';
process.env.COWORK_STATE_DIR ||= '/tmp/ppt-assembly-fill';
const { assemblyPlan } = await import('./lib/ppt-card-pages.mjs');

const IN = 914400;
const text = (id, x, y, w, h, value, pt = 16) => ({ id: 't' + id, type: 'text', nativeRef: { shapeId: id }, geometry: { x: x * IN, y: y * IN, width: w * IN, height: h * IN }, style: { fontSizePt: pt, fontFamily: 'Arial' }, content: { text: value } });
const petal = id => ({ id: 'i' + id, type: 'image', nativeRef: { shapeId: id }, geometry: { x: 7.96 * IN, y: 3.37 * IN, width: 2.41 * IN, height: 2.41 * IN }, content: { mediaRole: 'old_template_content' } });
const number = (id, x, y, n) => ({ ...text(id, x, y, .25, .25, String(n), 14) });
// The clover page: title, a body paragraph under the clover, four labels round it.
const nodes = [text(3, 5.72, .4, 6.89, .8, 'What is a Mood Board?', 28), text(19, 5.72, 5.9, 6.89, 1.4, 'These powerful visual tools serve as the foundation for creative projects across industries and teams.', 14),
  text(7, 5.72, 3.68, 2.24, .45, 'Captures intangible ideas visually'), petal(8), number(9, 8.6, 4.01, 1),
  text(10, 10.37, 3.68, 2.24, .45, 'Aligns teams and stakeholders'), petal(11), number(12, 9.48, 4.01, 2),
  text(13, 10.37, 5.02, 2.24, .45, 'Prevents costly missteps'), petal(14), number(15, 9.48, 4.89, 3),
  text(16, 5.72, 5.02, 2.24, .45, 'Accelerates decision-making'), petal(17), number(18, 8.6, 4.89, 4)];
const slots = [{ shapeId: 19, role: 'content', purpose: 'point-description' },
  ...[7, 10, 13, 16].map(id => ({ shapeId: id, role: 'content', purpose: 'label' })), ...[9, 12, 15, 18].map(id => ({ shapeId: id, role: 'static' }))];
const spec = { nodes, slots };
const project = { planningContract: { version: 3, flow: 'cards' }, inputUnderstanding: { primaryLanguage: 'en' }, generationPolicy: { language: { mode: 'output', locale: 'en' } },
  templateFidelity: { mode: 'preserve', width: 13.333 * IN, height: 7.5 * IN, slides: [spec, spec] }, templateSpec: { fonts: { title: 'Arial', body: 'Arial' } } };
const card = points => ({ id: 'p', title: 'Four parts', keyPoints: points, cardObjects: [] });
const blocks = [['World model', 'A large model learns the world.'], ['Agent V·M·C', 'Vision, memory and a small controller.'], ['Racing in dreams', 'The controller trains in the dream.'], ['VizDoom loops', 'Training refines harder tasks.']];
project.outline = [{ id: 'c' }, card(blocks.map(([label, text]) => ({ label, text })))];

const plan = assemblyPlan(project, 1);
assert.ok(plan, 'the clover fills');
assert.deepEqual([7, 10, 13, 16].map(id => plan.texts[String(id)]), ['World Model', 'Agent V·M·C', 'Racing in Dreams', 'VizDoom Loops'], 'headings in the petal labels, numbered order');
assert.equal(plan.texts['19'].split('\n').length, 4, 'the sentences in the body slot');
assert.ok(plan.texts['19'].startsWith('1. A large model') && plan.texts['19'].includes('\n4. Training'), 'numbered like the component');
assert.ok(!plan.fonts['19'] || plan.fonts['19'] >= 12, 'never under 12 pt');
// An agenda of four short labels fills the labels alone.
project.outline[1] = card(blocks.map(([label]) => ({ label, text: label })));
const agenda = assemblyPlan(project, 1);
assert.ok(agenda && !('19' in agenda.texts) && agenda.leaveOut.includes(19), 'labels only; the body slot is left out');
// A mismatched count, a heading too long, or sentences with no room: refused.
project.outline[1] = card([...blocks, blocks[0]].map(([label, text]) => ({ label, text })));
assert.equal(assemblyPlan(project, 1), null, 'five points never take four petals');
project.outline[1] = card(blocks.map(([label, text], k) => ({ label: k ? label : 'A heading far too long for the small label box beside its petal', text })));
assert.equal(assemblyPlan(project, 1), null, 'a heading that does not fit refuses the frame (never truncated)');
project.outline[1] = card(blocks.map(([label]) => ({ label, text: 'A long sentence that keeps going well past what the single paragraph slot under the clover can hold even at twelve points, repeated. '.repeat(2) })));
assert.equal(assemblyPlan(project, 1), null, 'no room for the sentences: refused, never the notes');
console.log('PASS assembly fill: headings in the component labels, numbered sentences in the frame body, refused on mismatch, overflow or long headings');
