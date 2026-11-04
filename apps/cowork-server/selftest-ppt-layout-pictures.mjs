// A template layout's page picture (Fable G1, 2026-11-02; Copy-of-Professional-
// Portfolio: the cover's city photo is on slideLayout2, so the editor showed a
// black cover): the topmost opaque full-bleed picture of a layout, certified
// and with nothing translucent above it, becomes a pinned node behind every
// object of each slide using that layout; the export removes it from the layout.
import assert from 'node:assert/strict';
import { layoutPictureCatalog, layoutPictureFor, layoutPictureActions, applyLayoutPicture, isLayoutPicture } from './lib/ppt-layout-pictures.mjs';

const W = 12192000, H = 6858000;
const jpeg = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64');
const png = colourType => { const b = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b); b.write('IHDR', 12); b[25] = colourType; return 'data:image/png;base64,' + b.toString('base64'); };
const read = { ocr: { status: 'ok', outcome: 'no_text' }, pixels: { continuousTone: true } };
const picture = (key, extra = {}) => ({ key: 'inherited:layout:0:1:' + key, scope: 'layout', masterIndex: 0, layoutIndex: 1, shapeId: key, kind: 'image', x: 0, y: 0, width: W, height: H, dataUrl: jpeg, imageSha256: 'h' + key, ...read, ...extra });

// The cover layout: glare, gradient and the city photo on top; the badge is small.
const cover = { width: W, height: H, inherited: [picture(2), picture(3, { pixels: { continuousTone: false } }), picture(4),
  { ...picture(6), width: 900000, height: 200000, dataUrl: png(6) }] };
const catalog = layoutPictureCatalog(cover);
assert.deepEqual(Object.keys(catalog), ['0:1']);
assert.equal(catalog['0:1'].shapeId, 4, 'the topmost opaque picture is the visible one');
assert.equal(layoutPictureFor(catalog, { masterIndex: 0, layoutIndex: 1 }).key, 'inherited:layout:0:1:4');
assert.deepEqual(layoutPictureActions(catalog).map(action => [action.shapeId, action.action]), [[4, 'remove']], 'the export removes it from the layout');

// A translucent overlay above it, an uncertified picture, or text: nothing is promoted.
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [picture(2), picture(5, { dataUrl: png(6) })] }), {}, 'a translucent overlay on top keeps the layout as it is');
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [picture(2, { pixels: { continuousTone: false } })] }), {}, 'an uncertified (flat) picture is not promoted');
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [picture(2, { ocr: { status: 'ok', outcome: 'text' } })] }), {}, 'a picture with text is not promoted');
assert.equal(layoutPictureCatalog({ ...cover, inherited: [picture(2, { dataUrl: png(2) })] })['0:1'].shapeId, 2, 'an RGB PNG is opaque');
// A master picture serves every layout of its master that has none of its own.
assert.equal(layoutPictureFor(layoutPictureCatalog({ ...cover, inherited: [{ ...picture(9), scope: 'master', layoutIndex: -1 }] }), { masterIndex: 0, layoutIndex: 3 }).shapeId, 9);

// The stack decides, for every template (3222, 2026-11-02: Mood-Board's dark
// texture lies under an opaque beige layer and was promoted to the front).
const fill = (key, z, opacity, colour = '#ecf0db') => ({ key: 'inherited:layout:0:1:' + key, scope: 'layout', masterIndex: 0, layoutIndex: 1, shapeId: key, kind: 'fill', x: 0, y: 0, width: W, height: H, z, fill: colour, opacity });
const at = (item, z) => ({ ...item, z });
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [at(picture(2), 0), fill(3, 1, 1)] }), {}, 'an opaque colour layer above hides the picture: nothing is promoted');
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [fill(3, 1, 1), at(picture(2), 0)] }), {}, 'order is by z, not by listing');
const tinted = layoutPictureCatalog({ ...cover, inherited: [at(picture(2), 0), at(picture(4), 1), fill(5, 2, .1, '#1a3353')] })['0:1'];
assert.equal(tinted.shapeId, 4, 'the picture under a light tint is promoted');
assert.deepEqual(tinted.tints.map(tint => [tint.shapeId, tint.opacity]), [[5, .1]], 'with its tint');
assert.ok(tinted.tints[0].dataUrl.startsWith('data:image/png;base64,'), 'the tint is drawn as a translucent picture');
assert.deepEqual(layoutPictureActions({ '0:1': tinted }).map(action => action.shapeId), [4, 5], 'both leave the layout');
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [at(picture(2), 0), fill(3, 1, .9, '#050505')] }), {}, 'a 90% tint leaves the layout as it is');
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [at(picture(2), 0), fill(3, 1, .5), fill(4, 2, .5)] }), {}, 'tints add up (75%)');
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [at(picture(2), 0), { ...fill(3, 1, 1), fillType: 'gradient' }] }), {}, 'an opaque gradient layer covers the picture too');
assert.deepEqual(layoutPictureCatalog({ ...cover, inherited: [at(picture(2), 0), { ...fill(3, 1, .3), fillType: 'gradient' }] }), {}, 'a translucent gradient is no flat tint: the layout stays');
{const project = { templateFidelity: { mode: 'preserve', slides: [{ layoutPicture: tinted.key }], layoutPictures: { [tinted.key]: tinted } } }, slide = { id: 't1', nodes: [] };
 applyLayoutPicture(project, slide, 0);
 assert.deepEqual(slide.nodes.map(node => [node.content.layoutPictureKey === tinted.key ? 'picture' : 'tint', node.zIndex < 0, node.pinned]), [['picture', true, true], ['tint', true, true]]);
 assert.ok(slide.nodes[1].zIndex > slide.nodes[0].zIndex && slide.nodes[1].content.layoutTint.opacity === .1, 'the tint above the picture');}

// The node: pinned, behind everything, once; a deleted one stays deleted.
const project = { templateFidelity: { mode: 'preserve', slides: [{ layoutPicture: catalog['0:1'].key }], layoutPictures: { [catalog['0:1'].key]: catalog['0:1'] } } };
const slide = { id: 's1', nodes: [{ id: 'title', type: 'text' }] };
assert.equal(applyLayoutPicture(project, slide, 0), true);
assert.equal(applyLayoutPicture(project, slide, 0), false, 'added once');
const node = slide.nodes[0];
assert.ok(isLayoutPicture(node) && node.pinned && !node.locked && node.zIndex < 0 && node.content.mediaRole === 'template_decoration' && node.content.pictureCertificate);
slide.nodes = slide.nodes.slice(1); slide.layoutPictureDeleted = node.content.layoutPictureKey;
assert.equal(applyLayoutPicture(project, slide, 0), false, 'the author deleted it: not added again');
assert.equal(applyLayoutPicture({ templateFidelity: { ...project.templateFidelity, mode: 'theme' } }, { id: 's2', nodes: [] }, 0), false, 'uploaded templates only');

// Coverage never counts it as a visual (deck metrics) and the ledger lists it.
{const { pageVisuals } = await import('./lib/ppt-deck-media-metrics.mjs');
 assert.deepEqual(pageVisuals({ nodes: [node] }), { content: [], chrome: [] }, 'the page picture is no visual of the page');}
console.log('PASS layout pictures: topmost opaque certified picture, no overlay above, pinned node behind everything, deletion kept, not a visual');
