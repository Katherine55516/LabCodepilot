// Round 5 (Alpha Mining T/MD/F-P0-2): template text colours, media-preserving
// source layout, card-icon re-anchoring, the media conservation gate and the
// derived cover subtitle. Synthetic template IR; no Alpha Mining branches.
import assert from 'node:assert/strict';
import { templateTextColor, contrastRatio } from './lib/ppt-template-colors.mjs';
import { mediaPreservingFit, anchorCardIcons, regionArtwork } from './lib/ppt-media-preserving-layout.mjs';
import { fitComponents } from './lib/ppt-density-capacity.mjs';
import { inspectMediaLedger } from './lib/ppt-media-ledger.mjs';
import { bindDerivedCoverSubtitle } from './lib/ppt-template-fidelity.mjs';

const E = 914400, box = (x, y, w, h) => ({ x: Math.round(x * E), y: Math.round(y * E), width: Math.round(w * E), height: Math.round(h * E) });
let shape = 1;
const text = (role, purpose, g, color, extra = {}) => { const id = shape++; return { node: { id: 'n' + id, type: 'text', nativeRef: { shapeId: id }, geometry: g, style: { color, fontSizePt: extra.pt || 14.5 }, content: { text: 'x' } }, slot: { shapeId: id, role, purpose } }; };
const image = (g, mediaRole) => ({ id: 'i' + shape, type: 'image', nativeRef: { shapeId: shape++ }, geometry: g, content: { mediaRole, dataUrl: 'data:image/png;base64,AA==' } });
const panel = (g, fill) => ({ id: 's' + shape, type: 'shape', nativeRef: { shapeId: shape++ }, geometry: g, style: { fill }, content: { shape: 'rect' } });

// Page 1: four circular image cards (images left of text columns), light background.
function cardPage() {
  const title = text('title', undefined, box(.7, 1, 11.9, .6), '#151617', { pt: 37 }), section = text('section', undefined, box(.7, .6, 1.7, .2), '#6f7680', { pt: 11 });
  const nodes = [section.node, title.node], slots = [section.slot, title.slot];
  for (const [x, y] of [[.7, 2.4], [6.8, 2.4], [.7, 4.5], [6.8, 4.5]]) {
    nodes.push(image(box(x, y, 1.7, 1.7), 'template_artwork'));
    const heading = text('content', 'point-heading', box(x + 2, y, 3.9, .3), '#1e2a44', { pt: 18.5 }), body = text('content', 'list', box(x + 2, y + .5, 3.9, 1), '#6f7680');
    nodes.push(heading.node, body.node); slots.push(heading.slot, body.slot);
  }
  return { background: '#efe9dc', nodes, slots };
}
// Page 2: dark panels carrying white card text.
function darkCardPage() {
  const title = text('title', undefined, box(.7, 1, 6.9, 1.2), '#151617', { pt: 34.5 });
  const nodes = [title.node], slots = [title.slot];
  for (const [x, y] of [[.7, 2.9], [4.3, 2.9]]) {
    nodes.push(panel(box(x, y, 3.4, 1.7), '#1e2a44'));
    const body = text('content', 'list', box(x + .2, y + .6, 3, .9), '#ffffff', { pt: 13.5 }); nodes.push(body.node); slots.push(body.slot);
  }
  return { background: '#efe9dc', nodes, slots };
}
const cover = (() => { const title = text('title', undefined, box(7.39, 3.32, 5.22, .96), '#151617', { pt: 51 }); return { background: '#efe9dc', nodes: [image(box(0, 0, 7.33, 7.5), 'template_decoration'), title.node], slots: [title.slot] }; })();
const project = { templateSpec: { palette: { background: '#efe9dc', foreground: '#242a3b', muted: '#505b6f', accent: '#1e2a44' }, fonts: { body: 'Source Sans 3' } },
  templateFidelity: { width: 12192000, height: 6858000, slides: [cover, cardPage(), darkCardPage()] },
  deckTitle: { source: 'agent' }, source: { text: '# Tutorial 10 — Alpha Mining: Formulaic Alphas, Operators, and Automated Search | 因子挖掘：公式化因子、算子与自动化搜索\n\nBody.' } };

// T: colours follow the template role on the same backdrop; never forced black.
assert.equal(templateTextColor(project, 1, 'body').color, '#6f7680');
assert.equal(templateTextColor(project, 1, 'label').color, '#1e2a44');
assert.equal(templateTextColor(project, 0, 'body').color, '#6f7680', 'a cover without body slots uses the template-wide body colour');
assert.equal(templateTextColor(project, 2, 'body', '#1e2a44').color, '#ffffff', 'text kept on a dark card uses the card text colour');
const onPage2 = templateTextColor(project, 2, 'body');
assert.notEqual(onPage2.color, '#ffffff', 'white card text is not lifted onto the light page');
assert.ok(contrastRatio(onPage2.color, '#efe9dc') >= 3);
const builtIn = templateTextColor({ templateSpec: { palette: { background: '#f8f9fc', foreground: '#242a3b', muted: '#505b6f' } } }, 1, 'body');
assert.deepEqual(builtIn, { color: '#242a3b', basis: 'palette_foreground' }, 'built-in themes keep their designed foreground');
for (const result of [templateTextColor(project, 1, 'body'), templateTextColor(project, 2, 'label'), builtIn]) assert.notEqual(result.color, '#111111');

// MD-P0-1: short components flow into the columns beside the images; images kept.
const para = (value) => ({ type: 'text', content: { text: value } });
const short = [para('Formulaic alpha mining starts with a small language of fields and operators.'), para('公式化 alpha 挖掘从一门小型语言开始，由字段与算子组成。'), para('The operator library is the first regularizer: limit depth and penalize complexity.')];
const base = fitComponents(short, project, 1);
assert.ok(base.capacity_ok);
const preserved = mediaPreservingFit(project, 1, short, base);
assert.match(preserved?.layoutId,/native-unit-grid/);
assert.equal(preserved.componentInstances.length,short.length);assert.equal(new Set(preserved.componentInstances.map(c=>c.id)).size,short.length);
const images = preserved.componentInstances.filter(n=>n.type==='image').map(n=>n.geometry);
for (const b of preserved.boxes) for (const g of images) assert.ok(b.x >= g.x + g.width || b.x + b.width <= g.x || b.y>=g.y+g.height || b.y+b.height<=g.y, 'text columns never cover the kept images');
assert.ok(preserved.boxes.every((b, i, all) => !i || b.x > all[i - 1].x || b.y > all[i - 1].y), 'reading order kept');
// Too much text for the free columns: keep the caller's fit (nothing shortened or shrunk).
const long = Array.from({ length: 6 }, (_, i) => para(`Paragraph ${i}: `.padEnd(420, 'complete source sentence ')));
const longBase = fitComponents(long, project, 1);
if (longBase.capacity_ok) {const fitted=mediaPreservingFit(project,1,long,longBase);if(fitted){assert.ok(fitted.capacity_ok);assert.equal(fitted.boxes.length,long.length);assert.equal(fitted.fontSizePt,longBase.fontSizePt);}}
// A table may now retain artwork when every cell fits beside it. Verify the
// semantic and geometry contract rather than the former table-type exclusion.
const tableComponents = [{ type: 'table', content: { rows: [['a'], ['b']] } }];
const tableBefore = structuredClone(tableComponents);
const tableBase = fitComponents(tableComponents, project, 1);
const tableFit = mediaPreservingFit(project, 1, tableComponents, tableBase);
assert.ok(tableFit?.capacity_ok, 'a small complete table fits beside retained artwork');
assert.deepEqual(tableComponents, tableBefore, 'media adaptation preserves every table cell');
assert.equal(tableFit.fontSizePt, tableBase.fontSizePt, 'media adaptation preserves the font floor');
assert.equal(tableFit.boxes.length, tableComponents.length);
for (const b of tableFit.boxes) for (const node of project.templateFidelity.slides[1].nodes.filter(n => tableFit.keptMediaShapeIds.includes(n.nativeRef?.shapeId))) {
  const g = node.geometry;
  assert.ok(b.x >= g.x + g.width || b.x + b.width <= g.x || b.y >= g.y + g.height || b.y + b.height <= g.y, 'table cells never overlap retained artwork');
}

// MD-P1-4: card-set icons are re-anchored in a gutter left of the first boxes.
const iconPage = (() => { const page = cardPage(); page.nodes = page.nodes.filter(n => n.type !== 'image');
  for (const x of [1.99, 5.02, 8.04]) page.nodes.push(image(box(x, 4.21, .28, .28), 'template_icon')); return page; })();
const iconProject = { ...project, templateFidelity: { ...project.templateFidelity, slides: [cover, iconPage] } };
assert.equal(regionArtwork(iconProject, 1, fitComponents(short, iconProject, 1).canvas).icons.length, 3);
const iconFit = fitComponents(short, iconProject, 1), anchored = anchorCardIcons(iconProject, 1, short, iconFit, () => true);
assert.ok(anchored, 'icons fit in a gutter');
assert.equal(anchored.icons.length, 3);
for (const icon of anchored.icons) {
  const owner = anchored.fit.boxes.find(b => Math.abs(b.y - icon.geometry.y) < 10 && b.x > icon.geometry.x);
  assert.ok(owner && icon.geometry.x + icon.geometry.width <= owner.x, 'each icon sits left of its text box without overlap');
}

// MD-P0-3: low conservation blocks unless the user confirmed each removal.
const ledger = (kept, approved) => ({ status: 'profiled', buckets: { aid: { expected: 0, kept: 0, reasons: [] }, decoration: { expected: 10, kept, reasons: [] } },
  conservation: kept / 10, effectiveConservation: (kept + approved) / 10, retired: Array.from({ length: 10 - kept - approved }, (_, i) => ({ objectId: 'm' + i, page: i + 2 })), longestTextOnlyRun: 0, templateMediaShare: 1 });
assert.equal(inspectMediaLedger(ledger(4, 0)).find(i => i.code === 'media_conservation_blocked')?.severity, 'error');
assert.ok(!inspectMediaLedger(ledger(4, 3)).some(i => i.code === 'media_conservation_blocked'), 'approved exclusions resolve the gate');
assert.equal(inspectMediaLedger(ledger(6, 0)).find(i => i.code === 'media_conservation_blocked')?.severity, 'error');

// F-P0-2: a title-only cover gets a measured subtitle with the rest of the source title.
const slide = { id: 'slide_cover_000000000001', title: '因子挖掘', nodes: [{ id: 't', type: 'text', semanticRole: 'template-title', nativeRef: { shapeId: cover.slots[0].shapeId }, geometry: cover.nodes[1].geometry, content: { text: '因子挖掘' } }] };
bindDerivedCoverSubtitle(project, slide, cover);
const subtitle = slide.nodes.find(n => n.content?.derivedFrom === 'document-title');
assert.ok(subtitle, 'subtitle added');
assert.match(subtitle.content.text, /Alpha Mining: Formulaic Alphas/u);
assert.doesNotMatch(subtitle.content.text, /\p{Script=Han}/u, 'round 7 (B1): the cover subtitle uses the deck language only');
assert.ok(!subtitle.content.text.includes('因子挖掘：'), 'the title already shown is not repeated');
assert.equal(subtitle.style.color, '#6f7680');
assert.ok(subtitle.geometry.x >= cover.nodes[0].geometry.x + cover.nodes[0].geometry.width, 'subtitle stays beside the cover artwork');
const locked = { ...slide, nodes: slide.nodes.filter(n => n !== subtitle) };
bindDerivedCoverSubtitle({ ...project, deckTitle: { source: 'user' } }, locked, cover);
assert.ok(!locked.nodes.some(n => n.content?.derivedFrom), 'a user-locked title is not supplemented');
console.log('Round 5 template colour, media-preserving layout, icon anchoring, media gate and cover subtitle: passed');

{
 const {buildMediaLedger}=await import('./lib/ppt-media-ledger.mjs');
 const make=()=>({templateContentMode:'design_only',templateFidelity:{mode:'preserve',width:1200,height:700,slides:[{nodes:[]},{nodes:[]}]}});
 const slides=[{id:'cover',nodes:[]},{id:'body',nodes:[]}];
 const assets=Array.from({length:5},(_,i)=>({objectId:'old-report-'+i,slideId:'body',role:'old_template_content',status:'retired_by_adaptation',approvalBasis:'design_only_template',reason:'Design-only source isolation'}));
 const resolved=buildMediaLedger(make(),slides,{templateAssets:assets,objects:[]});
 assert.equal(resolved.policyRetirements,5);assert.equal(resolved.approvedExclusions,0,'design policy is never represented as individual user approval');assert.equal(resolved.effectiveConservation,1);assert.equal(resolved.retired.length,0);
 assert.ok(!inspectMediaLedger(resolved).some(i=>i.severity==='error'));
 for(const patch of [{role:'evidence'},{role:'brand'},{role:'template_artwork'},{approvalBasis:'unverified_request'},{status:'unresolved'}]){
  const unresolved=buildMediaLedger(make(),slides,{templateAssets:assets.map(a=>({...a,...patch})),objects:[]});assert.equal(unresolved.policyRetirements,0);assert.ok(inspectMediaLedger(unresolved).some(i=>i.severity==='error'),'evidence/brand/artwork and invalid adaptations remain governed by the existing gate');
 }
 const contentMode=make();contentMode.templateContentMode='preserve_content';assert.equal(buildMediaLedger(contentMode,slides,{templateAssets:assets,objects:[]}).policyRetirements,0);
 const source=buildMediaLedger(make(),slides,{templateAssets:assets,objects:[{objectId:'source-image',type:'SourceImage',status:'failed'}]});assert.equal(source.entries.find(e=>e.origin==='source').status,'failed','source evidence is not resolved by template-use policy');
 console.log('PASS media design policy: validated old-report retirement resolves the design-only gate; source/evidence/brand/artwork and unverified removals never inherit this exemption');
}
