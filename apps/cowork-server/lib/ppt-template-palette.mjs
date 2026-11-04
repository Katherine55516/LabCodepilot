/** An uploaded template's colours from what its slides use (Fable M1,
 * 2026-11-02, the hand-made world_models × Mood-Board deck as the standard).
 * The analysis took the theme's accent1 when no slide colour was chromatic,
 * and Gamma leaves Office's default blue there (#4472c4), which no slide of
 * Mood-Board uses; code-drawn tiles, arrows and table headers were blue.
 *
 * - panel: the dark fill with the largest total shape area (luminance ≤ .35),
 *   when it is part of the design: at least 1% of all slide area (Mood-Board
 *   8.5%, Portfolio 7.4%, Capabilities 2.1%; Deal-Review's near-black 0.11% is
 *   a detail, and light templates keep light cards in their own accent);
 * - onPanel: the template's light background, else its light text colour,
 *   else white, the first that reads at 4.5:1 on the panel; no panel when none does;
 * - foreground: the dominant text colour;
 * - accent: the analysis accent only when the slides use it (a shape fill or
 *   line, or ≥5% of text characters), else the panel, else the foreground.
 * Built-in templates keep their palettes as defined (Fable (b)). */
import { contrastRatio } from './ppt-template-colors.mjs';

const hex = value => /^#[0-9a-f]{6}$/iu.test(String(value || '')) ? String(value).toLowerCase() : null;
const luminance = value => { const [r, g, b] = [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16) / 255); return .2126 * r + .7152 * g + .0722 * b; };
const add = (map, key, weight) => { if (key) map.set(key, (map.get(key) || 0) + weight); };
const top = map => [...map].sort((a, b) => b[1] - a[1]).map(([key]) => key);

const PANEL_SHARE = .01;
export function usedTemplatePalette(slides = [], palette = {}, size = {}) {
  const fills = new Map(), lines = new Set(), texts = new Map();
  let characters = 0;
  for (const slide of slides) for (const node of slide?.nodes || []) {
    const g = node.geometry || {};
    if (node.type === 'shape') { add(fills, hex(node.style?.fill || node.style?.backgroundColor), (Number(g.width) || 0) * (Number(g.height) || 0)); const line = hex(node.style?.stroke || node.style?.lineColor); if (line) lines.add(line); }
    if (node.type === 'text') { const length = String(node.content?.text || '').length; characters += length; add(texts, hex(node.style?.color), length); }
  }
  const slideArea = (Number(size.width) || 12192000) * (Number(size.height) || 6858000) * Math.max(1, slides.length);
  const panel = top(fills).find(color => luminance(color) <= .35 && fills.get(color) >= slideArea * PANEL_SHARE) || null;
  const foreground = top(texts)[0] || hex(palette.foreground);
  const onPanel = panel ? [hex(palette.background), ...top(texts).filter(color => luminance(color) > .6), '#ffffff'].filter(Boolean).find(color => contrastRatio(color, panel) >= 4.5) || null : null;
  const accent = hex(palette.accent), used = accent && (fills.has(accent) || lines.has(accent) || (texts.get(accent) || 0) >= characters * .05);
  return { ...palette, ...(foreground ? { foreground } : {}), accent: used ? accent : panel || foreground || accent,
    ...(panel && onPanel ? { panel, onPanel } : {}), derivedFrom: 'template-slides' };
}

/** Apply it to an uploaded template's project palette (never a built-in one). */
export function applyUsedTemplatePalette(project, slides, size) {
  const spec = project?.templateSpec;
  if (!spec || spec.kind === 'builtin' || !['uploaded', 'managed'].includes(spec.kind) && !spec.sha256) return;
  if (spec.palette?.derivedFrom === 'template-slides') return;
  project.templateSpec = { ...spec, palette: usedTemplatePalette(slides, spec.palette || {}, size) };
}

/** The surface of a code-drawn component (markers, pills, equation cards):
 * the template's dark panel with its light text, else its accent with white
 * or near-black, whichever reads at 4.5:1 (the user's review, 2026-11-02:
 * the content chooses the component, the template only its look). */
export function componentSurface(palette = {}) {
  if (hex(palette.panel) && hex(palette.onPanel)) return { fill: hex(palette.panel), text: hex(palette.onPanel) };
  const fill = hex(palette.accent) || hex(palette.foreground) || '#333333';
  return { fill, text: contrastRatio('#ffffff', fill) >= 4.5 ? '#ffffff' : '#111111' };
}

/** A chart's series colours from the template (the user's review, 2026-11-02:
 * a column chart on Mood-Board took the theme's Office blue): its accent when
 * it reads at 3:1 on the page, else its text colour; further series take the
 * text and muted colours. */
export function chartSeriesColors(palette = {}, background = palette.background) {
  const behind = hex(background) || '#ffffff', candidates = [hex(palette.accent), hex(palette.foreground), hex(palette.muted)].filter(Boolean);
  const first = candidates.find(color => contrastRatio(color, behind) >= 3) || (contrastRatio('#ffffff', behind) >= 3 ? '#ffffff' : '#111111');
  return [first, ...candidates.filter(color => color !== first && contrastRatio(color, behind) >= 3)];
}
