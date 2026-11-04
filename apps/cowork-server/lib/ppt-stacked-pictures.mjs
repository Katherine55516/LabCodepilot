/** Template pictures stacked edge to edge, three or more overlapping across,
 * are one drawing (a funnel, a staircase of pictures): Capabilities t9's four
 * trapezoids. They are retired or kept together, never one piece alone
 * (Codex 2026-11-03, live 0b5a7f1b p2 and 640e0f98 p7). */
const IN = 914400;
export function stackedPictureSets(spec) {
  const big = (spec?.nodes || []).filter(node => node.type === 'image' && node.geometry && node.nativeRef?.shapeId !== undefined
    && node.geometry.width >= IN * .5 && node.geometry.height >= IN * .3).sort((a, b) => a.geometry.y - b.geometry.y);
  const across = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) >= .5 * Math.min(a.width, b.width);
  const sets = [];
  for (const node of big) {
    const set = sets.find(group => { const last = group.at(-1).geometry, g = node.geometry; return across(last, g) && Math.abs(g.y - (last.y + last.height)) <= IN * .12; });
    if (set) set.push(node); else sets.push([node]);
  }
  return sets.filter(group => group.length >= 3);
}
/** The shape ids of every piece of a stacked drawing on this template page. */
export const stackedPictureIds = spec => new Set(stackedPictureSets(spec).flat().map(node => String(node.nativeRef.shapeId)));
