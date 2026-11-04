/** A template page's assembly: two or more same-size pictures, each with a
 * label slot beside it (Mood-Board's four mood photos with their captions).
 * assemblyPlan fills one with a card's labelled points; the writer is told
 * which part counts the template offers (Fable P6, 2026-11-02: no card of the
 * World Models run used one, since none had as many short labelled parts). */
import { templateMediaRole } from './ppt-template-fidelity.mjs';

export function assemblyParts(spec, size) {
  if (!spec) return null;
  const images = (spec.nodes || []).filter(node => node.type === 'image' && node.geometry && templateMediaRole(node, spec, size) === 'old_template_content');
  const same = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= Math.max(a.width, a.height) * .03);
  const group = images.map(node => images.filter(other => same(other.geometry, node.geometry))).filter(found => found.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!group) return null;
  const box = group[0].geometry, inBox = g => g.x >= box.x - 1 && g.y >= box.y - 1 && g.x + g.width <= box.x + box.width + 1 && g.y + g.height <= box.y + box.height + 1;
  const pieces = [...new Set([...group, ...images.filter(node => inBox(node.geometry) && node.geometry.width * node.geometry.height <= box.width * box.height * .05)].map(node => String(node.nativeRef?.shapeId)))];
  const slots = spec.slots || [], nodeOf = slot => spec.nodes.find(node => node.type === 'text' && String(node.nativeRef?.shapeId) === String(slot.shapeId));
  const near = g => Math.max(box.x - g.x - g.width, g.x - box.x - box.width, box.y - g.y - g.height, g.y - box.y - box.height) <= Math.max(box.width, box.height) * .6;
  const labels = slots.filter(slot => slot.role === 'content' && ['label', 'point-heading'].includes(slot.purpose) && nodeOf(slot)?.geometry && near(nodeOf(slot).geometry) && !inBox(nodeOf(slot).geometry));
  return { group, box, inBox, pieces, slots, nodeOf, labels };
}

/** The part counts the template's assemblies offer, with their sample label
 * length (a part's text must be about as short to fit the template's box). */
export function templateAssemblyHints(size) {
  const found = new Map();
  for (const spec of size?.slides || []) {
    const parts = assemblyParts(spec, size);
    if (!parts || parts.labels.length !== parts.group.length) continue;
    const chars = Math.max(...parts.labels.map(slot => [...String(parts.nodeOf(slot)?.content?.text || '')].length));
    const known = found.get(parts.group.length);
    if (!known || chars > known.chars) found.set(parts.group.length, { parts: parts.group.length, chars });
  }
  return [...found.values()].sort((a, b) => a.parts - b.parts);
}
