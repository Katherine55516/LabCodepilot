// The fill-template-first contract (the user, 2026-11-03; Fable's design):
// the template page profiles the media side publishes and the main flow
// matches and writes against. Both sides run this test. The fixtures are three
// uploaded templates of clearly different style (Mood-Board: cream with dark
// cards; Capabilities: dark navy, photo-heavy; Deal-Review: light 4:3-style
// corporate, untuned), their pages without picture bytes, and the profiles
// they must yield.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fillProfiles, profileAccepts, blocksFit, fillUnits, FILL_KINDS, FILL_PROFILE_VERSION } from './lib/ppt-template-fill-profile.mjs';

const load = name => JSON.parse(fs.readFileSync(new URL(`./test/fixtures/fill-profiles/${name}.json`, import.meta.url)));
const project = fixture => ({ templateFidelity: { mode: 'preserve', width: fixture.width, height: fixture.height, sourceCatalog: fixture.catalog } });

// The schema every profile carries.
const shape = profile => {
  assert.equal(profile.version, FILL_PROFILE_VERSION);
  assert.equal(typeof profile.profileId, 'string');assert.ok(Number.isInteger(profile.page));
  assert.ok(profile.kind === null ? typeof profile.reason === 'string' : FILL_KINDS.includes(profile.kind), JSON.stringify(profile).slice(0, 120));
  if (profile.reason === 'cover') return;
  assert.equal(profile.blocks, profile.blockSlots.length);
  for (const block of profile.blockSlots) {
    assert.ok(block.body.cap > 0 && block.body.shapeId !== undefined);
    if (block.heading) assert.ok(block.heading.cap > 0);
  }
  assert.equal(typeof profile.lead.present, 'boolean');if (profile.lead.present) assert.ok(profile.lead.cap > 0);
  assert.equal(typeof profile.summary.present, 'boolean');
  assert.equal(profile.figures, profile.figureSlots.length);
  for (const key of ['numbered', 'paired', 'stackMayHoldFewer']) assert.equal(typeof profile[key], 'boolean');
  assert.ok(Array.isArray(profile.groupHeadingShapeIds));
};

for (const name of ['mood-board', 'capabilities', 'deal-review']) {
  const fixture = load(name), profiles = fillProfiles(project(fixture));
  assert.deepEqual(profiles, fixture.profiles, `${name}: the profiles are what the contract publishes`);
  profiles.forEach(shape);
  assert.equal(profiles[0].reason, 'cover');
  assert.ok(profiles.filter(profile => profile.kind).length >= 4, `${name}: most content pages are recognised`);
}

// Mood-Board page by page against the hand deck (p3 two figures, p4 steps, p5 2×2, p7 three columns).
{const mood = load('mood-board').profiles, kinds = mood.map(profile => profile.kind ? `${profile.kind}-${profile.blocks}` : profile.reason);
 assert.deepEqual(kinds, ['cover', 'unclaimed_slots', 'compare-2', 'steps-4', 'cards-4', 'layered_artwork_deferred', 'cards-3', 'cards-2']);
 assert.equal(mood[2].figures, 2);assert.ok(mood[2].paired);
 assert.ok(mood[3].lead.present && mood[3].stackMayHoldFewer);
 assert.ok(mood[4].lead.present);assert.equal(mood[6].figures, 3);
 assert.ok(mood[7].lastPage);}

// Matching: the kind and the block count from the content, exact; a vertical
// stack may hold one fewer; steps and cards share pages; a text-figure page needs a figure.
{const [, , compare, steps, grid] = load('mood-board').profiles;
 assert.equal(profileAccepts(grid, { kind: 'cards', blocks: 4 }), true);
 assert.equal(profileAccepts(grid, { kind: 'cards', blocks: 3 }), false, 'a 2×2 grid is exact');
 assert.equal(profileAccepts(grid, { kind: 'cards', blocks: 5 }), false, 'never more blocks than the page holds');
 assert.equal(profileAccepts(steps, { kind: 'steps', blocks: 3 }), true, 'a vertical stack holds one fewer');
 assert.equal(profileAccepts(steps, { kind: 'steps', blocks: 5 }), false, 'a 5-step procedure is not cut to 4 (Fable: rail fallback)');
 assert.equal(profileAccepts(steps, { kind: 'cards', blocks: 4 }), false, 'parallel cards never take a steps page (its line claims a sequence)');
 assert.equal(profileAccepts(grid, { kind: 'steps', blocks: 4 }), true, 'a procedure may take a cards page, numbered in order');
 assert.equal(profileAccepts(compare, { kind: 'compare', blocks: 2, figures: 2 }), true);
 assert.equal(profileAccepts(compare, { kind: 'compare', blocks: 2, figures: 3 }), false, 'every figure needs a slot');
 assert.equal(profileAccepts(compare, { kind: 'compare', blocks: 2, figures: 1 }), false, 'a two-figure compare page takes a figure on each side');
 assert.equal(profileAccepts(compare, { kind: 'compare', blocks: 2, figures: 0 }), false, 'no figures: a cards-2 or theme page instead (compare_requires_figures)');
 assert.equal(profileAccepts(compare, { kind: 'cards', blocks: 2 }), false);
 const textFigure = { kind: 'text-figure', blocks: 1, figures: 1, stackMayHoldFewer: false };
 assert.equal(profileAccepts(textFigure, { kind: 'text-figure', blocks: 1, figures: 1 }), true);
 assert.equal(profileAccepts(textFigure, { kind: 'text-figure', blocks: 1, figures: 0 }), false);
 assert.equal(profileAccepts({ kind: null, reason: 'irregular_blocks' }, { kind: 'cards', blocks: 3 }), false, 'an unrecognised page is never filled');}

// Capabilities: the staircase (t8) and the funnel (t9) are cards with a summary line, not title-body;
// a page whose small blocks the reader cannot pair is left unrecognised, never half-filled.
{const capabilities = load('capabilities').profiles;
 assert.deepEqual([7, 8].map(k => [capabilities[k].kind, capabilities[k].blocks, capabilities[k].summary.present]), [['cards', 3, true], ['cards', 4, true]]);
 assert.equal(capabilities[2].lead.columns, 2, 'the two-column lead');
 assert.ok([3, 6, 9].every(k => capabilities[k].kind === null));}

// Deal-Review t5: each block's small label is a kicker the binding numbers.
{const t5 = load('deal-review').profiles[4];
 assert.equal(t5.kind, 'cards');assert.ok(t5.blockSlots.every(block => block.kicker?.shapeId !== undefined));}

// Writing within the caps, measured as the binding measures.
{const grid = load('mood-board').profiles[4], cap = grid.blockSlots[0];
 assert.equal(fillUnits('VAE'), fillUnits('VAE'));assert.ok(fillUnits('视觉模型') > fillUnits('VAE'));
 const fits = Array.from({ length: 4 }, () => ({ heading: 'Vision', body: 'The encoder compresses each frame.' }));
 assert.deepEqual(blocksFit(grid, fits), { ok: true });
 assert.equal(blocksFit(grid, [{ heading: 'x', body: 'word '.repeat(Math.ceil(cap.body.cap)) }]).reason, 'body_over_cap');
 assert.equal(blocksFit(grid, fits, { lead: 'One lead line.' }).ok, true);
 assert.equal(blocksFit(grid, Array.from({ length: 5 }, () => fits[0])).reason, 'too_many_blocks');
 assert.equal(blocksFit(grid, [{ heading: '', body: 'A bare phrase.' }]).reason, 'heading_missing', 'headed slots need their headings');}

console.log('PASS template fill contract: three templates profiled as published, hand-deck kinds on Mood-Board, exact matching with the stack rule and one-way steps→cards sharing, kickers, caps measured as the binding measures');
