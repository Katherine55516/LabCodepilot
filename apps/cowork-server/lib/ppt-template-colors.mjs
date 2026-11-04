/** Text colour contract: source-owned text takes the colour the template uses
 * for the same role on the same kind of backdrop (body grey, navy point
 * headings, white text on dark cards). It never falls back to a hard-coded
 * black. Plan: docs/exec-plans/active/ppt-alpha-mining-round5-priorities.md (T). */

const hex = value => /^#?[0-9a-f]{6}$/iu.test(String(value || '')) ? '#' + String(value).replace('#', '').toLowerCase() : null;
export function relativeLuminance(color) {
  const value = hex(color); if (!value) return null;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
export function contrastRatio(a, b) {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

const PURPOSE_ROLE = { 'point-description': 'body', list: 'body', body: 'body', 'point-heading': 'label', subtitle: 'body' };
/** Role of a template text node from its native slot. */
export function templateTextRole(spec, node) {
  const slot = spec?.slots?.find(s => s.shapeId === node.nativeRef?.shapeId);
  if (!slot) return null;
  if (slot.role === 'title') return 'title';
  if (slot.role === 'section') return 'caption';
  if (slot.role === 'content') return PURPOSE_ROLE[slot.purpose] || 'body';
  return null;
}
/** What is drawn under a node's centre: a filled shape colour, 'image', or the
 * slide background. Earlier nodes in the shape tree are below later ones. */
export function templateBackdrop(spec, node, background, slideArea = 0) {
  const g = node.geometry; if (!g) return background;
  const cx = g.x + g.width / 2, cy = g.y + g.height / 2;
  let backdrop = background;
  for (const other of spec?.nodes || []) {
    if (other === node) break;
    const o = other.geometry;
    if (!o || !['image', 'shape'].includes(other.type) || o.width * o.height <= g.width * g.height) continue;
    if (cx < o.x || cx > o.x + o.width || cy < o.y || cy > o.y + o.height) continue;
    // A full-bleed picture is the page background artwork, not a card.
    if (other.type === 'image' && slideArea && o.width * o.height >= slideArea * .85) continue;
    backdrop = other.type === 'shape' ? hex(other.style?.fill || other.content?.fill) || background : 'image';
  }
  return backdrop;
}
const sameBackdrop = (a, b) => a === b || (hex(a) && hex(b) && (contrastRatio(a, b) ?? 99) < 1.15);

/** Colour for source-owned text of `role` on `backdrop` (default: the page
 * background). Returns {color, basis}; basis records which rule chose it. */
export function templateTextColor(project, index, role = 'body', backdrop = null) {
  const slides = project.templateFidelity?.slides || [], spec = slides[index];
  const slideArea = Number(project.templateFidelity?.width || 0) * Number(project.templateFidelity?.height || 0);
  const pageBackground = hex(spec?.background) || hex(project.templateSpec?.palette?.background) || '#ffffff';
  const target = backdrop || pageBackground;
  const readable = color => {
    if (target === 'image') return true;
    const ratio = contrastRatio(color, target);
    return ratio === null || ratio >= 3;
  };
  const tally = (specs, wantedRole) => {
    const counts = new Map();
    for (const candidate of specs) {
      const background = hex(candidate?.background) || pageBackground;
      for (const node of candidate?.nodes || []) {
        if (node.type !== 'text' || templateTextRole(candidate, node) !== wantedRole) continue;
        const color = hex(node.style?.color);
        if (!color || !sameBackdrop(templateBackdrop(candidate, node, background, slideArea), target === pageBackground ? background : target)) continue;
        counts.set(color, (counts.get(color) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  };
  const fallbacks = { body: ['body', 'label'], label: ['label', 'body'], caption: ['caption', 'body'], title: ['title', 'label'] }[role] || [role, 'body'];
  for (const wanted of fallbacks) {
    for (const [scope, specs] of [['slide', spec ? [spec] : []], ['template', slides]]) {
      const color = tally(specs, wanted).find(readable);
      if (color) return { color, basis: `template_${scope}_${wanted}` };
    }
  }
  const palette = project.templateSpec?.palette || {};
  for (const [key, value] of (role === 'caption' ? [['muted', palette.muted], ['foreground', palette.foreground]] : [['foreground', palette.foreground], ['muted', palette.muted]])) {
    if (hex(value) && readable(value)) return { color: hex(value), basis: `palette_${key}` };
  }
  // Last resort keeps contrast against the actual backdrop; it is recorded as such.
  return { color: (relativeLuminance(target === 'image' ? '#000000' : target) ?? 1) < .179 ? '#ffffff' : '#1f2328', basis: 'contrast_fallback' };
}
