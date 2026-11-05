import crypto from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { imageSize } from './export-pptx';
import { attr, ImportError, PartReader, relationships } from './import-pptx';
import { recognizeComponents, type ComponentImage, type RecognizedComponents } from './template-components';
import type { AccentPosition, DeckTheme } from './types';

/**
 * A .pptx / .potx as a template (server only): the look, not the words.
 *
 * - Colours come from what the slides actually paint, not the theme part
 *   (exports often leave the default Office scheme in theme1.xml): the
 *   background is the topmost full-slide fill drawn under the content
 *   (slide, then layout, then master), text is the run colour with the most
 *   characters that reads on that background, the accent is the most-used
 *   solid shape fill that contrasts with it.
 * - Fonts: the typeface with the most characters in title placeholders /
 *   large runs (heading) and in the rest (body), with web-safe fallbacks.
 * - Artwork: large raster pictures (≥ 4% of the slide) become decorative
 *   accent images; each slide's accent position (left / right / top /
 *   background / none) becomes the layout rhythm. Small pictures (icons),
 *   mostly-transparent PNG shapes, SVGs, and pictures linked to a web page
 *   (vendor badges such as "Made with …") are left out and listed in notes.
 *
 * Like the importer, the package is read as data with size caps; external
 * relationships are never followed.
 */

export interface TemplateImage { key: string; data: Buffer; mime: string; width?: number; height?: number; role: AccentPosition | 'tile' | 'bottom'; share: number; slide: number }
export type LogoSlot = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
/** A brand logo: a small picture repeated in the same corner on most slides. */
export interface TemplateLogo { data: Buffer; mime: string; width?: number; height?: number; slot: LogoSlot; slides: number }
export interface TemplateAssets {
  fileName: string; theme: DeckTheme; images: TemplateImage[]; rhythm: AccentPosition[]; notes: string[]; slides: number; logo?: TemplateLogo;
  /** Diagram components (layers reference `componentImages` by key until the deck hosts them). */
  components: RecognizedComponents['components'];
  componentImages: ComponentImage[];
}

const EMU_FALLBACK = { cx: 12192000, cy: 6858000 };
const MAX_SLIDES = 40;
const MAX_IMAGES = 16;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RASTER: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// ── Colour helpers ─────────────────────────────────────────────────────────

type RGB = [number, number, number];
const hexToRgb = (hex: string): RGB => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const rgbToHex = (c: RGB) => `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(hexToRgb(a.replace('#', ''))), lum(hexToRgb(b.replace('#', '')))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [hexToRgb(a.replace('#', '')), hexToRgb(b.replace('#', ''))];
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t) as RGB);
};
/** Moves a colour toward black or white until it reaches `min` contrast with `bg`. */
function ensureContrast(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color;
  const toward = lum(hexToRgb(bg.replace('#', ''))) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0.1; t <= 1; t += 0.1) { const c = mix(color, toward, t); if (contrast(c, bg) >= min) return c; }
  return toward;
}
const hueDistance = (a: string, b: string) => {
  const hue = (hex: string) => {
    const [r, g, bb] = hexToRgb(hex.replace('#', '')).map(v => v / 255);
    const max = Math.max(r, g, bb), min = Math.min(r, g, bb), d = max - min;
    if (d < 0.08) return -1; // greyish: no meaningful hue
    const h = max === r ? ((g - bb) / d) % 6 : max === g ? (bb - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const [x, y] = [hue(a), hue(b)];
  if (x < 0 || y < 0) return x === y ? 0 : 180;
  const d = Math.abs(x - y);
  return Math.min(d, 360 - d);
};

// ── Fonts ──────────────────────────────────────────────────────────────────

const SERIF_HINT = /serif|fraunces|playfair|georgia|times|garamond|merriweather|lora|baskerville|didot|bodoni|caslon|cormorant|libre caslon|crimson|spectral|source serif|noto serif|songti|mincho|宋/i;
export function fontStack(face: string): string {
  const family = face.replace(/\s+(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Semibold|Bold|ExtraBold|Black|Heavy)$/i, '').trim();
  const names = [...new Set([face, family])].map(n => `"${n.replace(/"/g, '')}"`);
  const serif = SERIF_HINT.test(face) && !/sans/i.test(face);
  return [...names, serif ? 'Georgia, "Songti SC", "Noto Serif CJK SC", serif' : 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'].join(', ');
}

// ── Parsing ────────────────────────────────────────────────────────────────

interface Layer { xml: string; rels: { id: string; type: string; target: string }[]; dir: string }
interface Pic { key: string; target: string; x: number; y: number; cx: number; cy: number; linked: boolean; layer: 'slide' | 'layout' | 'master' }

const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);
function xfrmOf(body: string) {
  const off = /<a:off\b[^>]*>/.exec(body)?.[0] || '';
  const ext = /<a:ext\b[^>]*>/.exec(body)?.[0] || '';
  return { x: num(attr(off, 'x')), y: num(attr(off, 'y')), cx: num(attr(ext, 'cx')), cy: num(attr(ext, 'cy')) };
}
/** The Office default palette: a template that still carries it did not choose it. */
const OFFICE_DEFAULT = new Set(['4472c4', 'ed7d31', 'a5a5a5', 'ffc000', '5b9bd5', '70ad47', '44546a', 'e7e6e6', '0563c1', '954f72']);
const chroma = (hex: string) => { const c = hexToRgb(hex.replace('#', '')); return (Math.max(...c) - Math.min(...c)) / 255; };
/** Average colour of a gradient fill's stops. */
function gradientColor(body: string, colorOf: (f: { kind: string; val: string } | null) => string | null): string | null {
  const g = /<a:gradFill\b[\s\S]*?<\/a:gradFill>/.exec(body)?.[0];
  if (!g) return null;
  const stops = [...g.matchAll(/<a:gs\b[^>]*>\s*<a:(srgbClr|schemeClr)\s+val="([^"]+)"/g)].map(m => colorOf({ kind: m[1], val: m[2] })).filter((c): c is string => Boolean(c));
  if (!stops.length) return null;
  const sum = stops.map(c => hexToRgb(c.replace('#', ''))).reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]] as RGB, [0, 0, 0] as RGB);
  return rgbToHex(sum.map(v => v / stops.length) as RGB);
}
type Paint = { type: 'color'; color: string } | { type: 'image'; target: string; scrim?: { color: string; alpha: number } };

const solidFill = (body: string) => {
  const m = /<a:solidFill>\s*<a:(srgbClr|schemeClr)\s+val="([^"]+)"\s*(\/>|>([\s\S]*?)<\/a:\1>)/.exec(body);
  if (!m) return null;
  const alpha = m[4] ? /<a:alpha\s+val="(\d+)"/.exec(m[4])?.[1] : undefined;
  return { kind: m[1], val: m[2], alpha: alpha ? Number(alpha) / 100000 : 1 };
};

export async function parseTemplate(bytes: Buffer, fileName: string): Promise<TemplateAssets> {
  if (bytes.length < 4 || bytes.readUInt32BE(0) !== 0x504b0304) throw new ImportError(400, 'This file is not a valid PowerPoint package.', 'template_unreadable');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new ImportError(400, 'The template could not be opened.', 'template_unreadable'); }
  const reader = new PartReader(zip);
  const notes: string[] = [];

  const presXml = await reader.read('ppt/presentation.xml');
  if (!presXml) throw new ImportError(400, 'This file has no presentation part.', 'template_unreadable');
  const sz = /<p:sldSz\b[^>]*>/.exec(presXml)?.[0] || '';
  const W = num(attr(sz, 'cx')) || EMU_FALLBACK.cx, H = num(attr(sz, 'cy')) || EMU_FALLBACK.cy;
  const presRels = relationships((await reader.read('ppt/_rels/presentation.xml.rels')) || '', 'ppt');
  const slideIds = [...presXml.matchAll(/<p:sldId\b[^>]*>/g)].map(m => attr(m[0], 'r:id')).filter(Boolean) as string[];
  const slidePaths = slideIds.map(id => presRels.find(r => r.id === id)?.target).filter((t): t is string => Boolean(t && /slides\/slide\d+\.xml$/.test(t))).slice(0, MAX_SLIDES);

  // Theme scheme (for schemeClr) and fonts (fallback).
  const themeRel = presRels.find(r => /theme\/theme\d+\.xml$/.test(r.target));
  const themeXml = themeRel ? (await reader.read(themeRel.target)) || '' : '';
  const scheme: Record<string, string> = {};
  for (const m of themeXml.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink)>\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"/g)) scheme[m[1]] = m[2];
  const officeDefault = ['accent1', 'accent2', 'accent3'].every(k => OFFICE_DEFAULT.has((scheme[k] || '').toLowerCase()));
  const clrMap: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  const colorOf = (f: { kind: string; val: string } | null) => {
    if (!f) return null;
    if (f.kind === 'srgbClr') return `#${f.val.toLowerCase()}`;
    const key = clrMap[f.val] || f.val;
    return scheme[key] ? `#${scheme[key].toLowerCase()}` : null;
  };
  const fontPart = (tag: string) => new RegExp(`<a:${tag}>([\\s\\S]*?)<\\/a:${tag}>`).exec(themeXml)?.[1] || '';
  const themeFace = (tag: 'majorFont' | 'minorFont', script: 'latin' | 'ea') => {
    const part = fontPart(tag);
    const direct = new RegExp(`<a:${script} typeface="([^"]*)"`).exec(part)?.[1] || '';
    return direct || (script === 'ea' ? /<a:font script="Hans" typeface="([^"]*)"/.exec(part)?.[1] || '' : '');
  };
  const majorFont = themeFace('majorFont', 'latin');
  const minorFont = themeFace('minorFont', 'latin');
  /** "+mj-ea" → the theme's heading East Asian font, etc. */
  const resolveFace = (face: string | undefined, title: boolean, cjk: boolean): string => {
    if (face && !face.startsWith('+')) return face;
    const major = face ? face.startsWith('+mj') : title;
    const script = face ? (face.endsWith('-ea') ? 'ea' : 'latin') : cjk ? 'ea' : 'latin';
    return themeFace(major ? 'majorFont' : 'minorFont', script) || themeFace(major ? 'majorFont' : 'minorFont', 'latin');
  };

  const readLayer = async (target: string): Promise<Layer | null> => {
    const xml = await reader.read(target);
    if (!xml) return null;
    const dir = path.posix.dirname(target);
    const rels = relationships((await reader.read(`${dir}/_rels/${path.posix.basename(target)}.rels`)) || '', dir);
    return { xml, rels, dir };
  };
  const layerCache = new Map<string, Layer | null>();
  const layerAt = async (target: string) => { if (!layerCache.has(target)) layerCache.set(target, await readLayer(target)); return layerCache.get(target)!; };

  const textChars = new Map<string, number>();
  const runColors = new Map<string, number>();
  const logoSeen: { target: string; slide: number; slot: LogoSlot }[] = [];
  const slidePaints: (Paint | null)[] = [];
  const headingFaces = new Map<string, number>();
  const bodyFaces = new Map<string, number>();
  const shapeFills = new Map<string, number>();
  const backgrounds = new Map<string, number>();
  const pics: (Pic & { slide: number })[] = [];
  const slideParts: { index: number; xml: string; rels: { id: string; target: string }[] }[] = [];
  const rhythm: AccentPosition[] = [];
  let skippedSvg = 0, skippedSmall = 0, skippedLinked = 0, roundShapes = 0, squareShapes = 0;
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) || 0) + n);

  for (let si = 0; si < slidePaths.length; si++) {
    const slide = await layerAt(slidePaths[si]);
    if (!slide) continue;
    slideParts.push({ index: si + 1, xml: slide.xml, rels: slide.rels });
    const layoutTarget = slide.rels.find(r => /slideLayouts\/slideLayout\d+\.xml$/.test(r.target))?.target;
    const layout = layoutTarget ? await layerAt(layoutTarget) : null;
    const masterTarget = layout?.rels.find(r => /slideMasters\/slideMaster\d+\.xml$/.test(r.target))?.target;
    const master = masterTarget ? await layerAt(masterTarget) : null;
    const stack: [Layer | null, Pic['layer']][] = [[master, 'master'], [layout, 'layout'], [slide, 'slide']];

    // Background: walk layers bottom → top; the last full-slide paint before content wins.
    let paint: Paint | null = null;
    for (const [layer, name] of stack) {
      if (!layer) continue;
      const bgPart = /<p:bg>[\s\S]*?<\/p:bg>/.exec(layer.xml)?.[0] || '';
      const bgEmbed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(bgPart)?.[1];
      const bgImage = bgEmbed ? layer.rels.find(r => r.id === bgEmbed)?.target : undefined;
      const bgColor = colorOf(solidFill(bgPart)) || gradientColor(bgPart, colorOf);
      if (bgImage) paint = { type: 'image', target: bgImage };
      else if (bgColor) paint = { type: 'color', color: bgColor };
      for (const m of layer.xml.matchAll(/<p:(sp|pic)>([\s\S]*?)<\/p:\1>/g)) {
        const x = xfrmOf(m[2]);
        const full = x.cx * x.cy >= W * H * 0.95;
        if (!full) { if (name === 'slide') break; continue; }
        if (m[1] === 'sp') {
          const spPr = /<p:spPr>[\s\S]*?<\/p:spPr>/.exec(m[2])?.[0] || '';
          const f = solidFill(spPr);
          const c = colorOf(f) || gradientColor(spPr, colorOf);
          // A translucent full-slide fill over a picture is a scrim: the picture still shows (dimmed).
          if (c && ((f?.alpha ?? 1) >= 0.97 || paint?.type !== 'image')) paint = { type: 'color', color: c };
          else if (c && paint?.type === 'image') paint = { ...paint, scrim: { color: c, alpha: f?.alpha ?? 1 } };
        } else {
          const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(m[2])?.[1];
          const target = embed ? layer.rels.find(r => r.id === embed)?.target : undefined;
          if (target) paint = { type: 'image', target };
        }
      }
    }
    slidePaints.push(paint);
    if (paint?.type === 'color') add(backgrounds, paint.color, 1);

    // Runs: colour and typeface by characters; titles (placeholders or large runs) count as heading faces.
    for (const sp of slide.xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
      const body = sp[1];
      const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(body);
      const spPr = /<p:spPr>[\s\S]*?<\/p:spPr>/.exec(body)?.[0] || '';
      const fill = solidFill(spPr);
      const x = xfrmOf(body);
      const share = (x.cx * x.cy) / (W * H);
      const fillColor = colorOf(fill) || gradientColor(spPr, colorOf);
      if (fillColor && (fill?.alpha ?? 1) > 0.8 && share > 0.004 && share < 0.9) add(shapeFills, fillColor, share);
      if (/prstGeom prst="(roundRect|ellipse|flowChartAlternateProcess)"/.test(body)) roundShapes++; else if (/prstGeom prst="rect"/.test(body)) squareShapes++;
      const onFill = Boolean(fillColor && (fill?.alpha ?? 1) > 0.8);
      for (const r of body.matchAll(/<a:r>\s*(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))?\s*<a:t>([^<]*)<\/a:t>/g)) {
        const rPr = r[1] || '';
        const n = r[2].trim().length;
        if (!n) continue;
        const size = num(attr(/<a:rPr\b[^>]*>/.exec(rPr)?.[0] || '', 'sz')) / 100;
        const color = colorOf(solidFill(rPr));
        if (color && !onFill) add(textChars, color, n);
        if (color) add(runColors, color, n);
        const cjk = /[\u3000-\u9fff\uff00-\uffef]/.test(r[2]);
        const declared = (cjk ? /<a:ea typeface="([^"]+)"/.exec(rPr)?.[1] : undefined) || /<a:latin typeface="([^"]+)"/.exec(rPr)?.[1];
        const heading = isTitle || size >= 24;
        const face = resolveFace(declared, heading, cjk);
        if (face) add(heading ? headingFaces : bodyFaces, face, n);
      }
    }

    // Pictures from all three layers (layout/master art shows on every slide that uses them).
    let slideAccent: AccentPosition = 'none';
    for (const [layer, name] of stack) {
      if (!layer) continue;
      for (const m of layer.xml.matchAll(/<p:pic>([\s\S]*?)<\/p:pic>/g)) {
        const body = m[1];
        const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(body)?.[1];
        const target = embed ? layer.rels.find(r => r.id === embed)?.target : undefined;
        if (!target) continue;
        const x = xfrmOf(body);
        const linked = /<a:hlinkClick\b/.test(/<p:nvPicPr>[\s\S]*?<\/p:nvPicPr>/.exec(body)?.[0] || '');
        pics.push({ key: `${name}:${target}`, target, ...x, linked, layer: name, slide: si + 1 });
        const share0 = (x.cx * x.cy) / (W * H);
        const corner = (x.x + x.cx / 2 < W * 0.3 || x.x + x.cx / 2 > W * 0.7) && (x.y + x.cy / 2 < H * 0.2 || x.y + x.cy / 2 > H * 0.8);
        if (!linked && corner && share0 >= 0.001 && share0 < 0.05) {
          const slot: LogoSlot = `${x.y + x.cy / 2 < H / 2 ? 'top' : 'bottom'}${x.x + x.cx / 2 < W / 2 ? 'Left' : 'Right'}` as LogoSlot;
          logoSeen.push({ target, slide: si, slot });
        }
        if (name !== 'slide' && x.cx * x.cy >= W * H * 0.95) continue; // a full-slide layout picture is a background, handled below
        if (name === 'slide') {
          const share = (x.cx * x.cy) / (W * H);
          const role = roleOf(x, W, H);
          if (share >= 0.04 && slideAccent === 'none' && role !== 'tile' && role !== 'bottom') slideAccent = role;
        }
      }
    }
    rhythm.push(slideAccent);
  }
  if (!slidePaths.length) throw new ImportError(422, 'This template has no slides.', 'template_empty');

  // ── Background pictures: a few slides → cover photos (accent 'background'); most slides → a texture (its average colour). ──
  const imagePaints = new Map<string, number[]>();
  const scrims = new Map<string, { color: string; alpha: number }>();
  slidePaints.forEach((p, i) => {
    if (p?.type !== 'image') return;
    imagePaints.set(p.target, [...(imagePaints.get(p.target) || []), i]);
    if (p.scrim) scrims.set(p.target, p.scrim);
  });
  const coverTargets = new Set<string>();
  for (const [target, slides] of imagePaints) {
    if (slides.length <= Math.max(1, slidePaths.length * 0.5)) {
      coverTargets.add(target);
      for (const i of slides) if (rhythm[i] === 'none') rhythm[i] = 'background';
    } else {
      const data = await reader.readBinary(target);
      const avg = data && data.length <= MAX_IMAGE_BYTES ? await averageColor(data) : null;
      const scrim = scrims.get(target);
      // What the eye sees: the texture's average under its scrim.
      const seen = avg && scrim ? mix(avg, scrim.color, scrim.alpha) : avg || scrim?.color;
      if (seen) add(backgrounds, seen, slides.length);
    }
  }
  for (const target of coverTargets) {
    const first = imagePaints.get(target)![0];
    pics.push({ key: `background:${target}`, target, x: 0, y: 0, cx: W, cy: H, linked: false, layer: 'slide', slide: first + 1 });
  }

  // ── Theme ──
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const background = top(backgrounds)[0] || (scheme.lt1 ? `#${scheme.lt1.toLowerCase()}` : '#ffffff');
  const dark = lum(hexToRgb(background.replace('#', ''))) < 0.3;
  // Body text is usually neutral; coloured runs are usually emphasis. Prefer a neutral colour with a fair share of the text.
  const readable = top(textChars).filter(c => contrast(c, background) >= 4.5);
  const topChars = textChars.get(readable[0]) || 0;
  const neutral = readable.find(c => chroma(c) < 0.2 && (textChars.get(c) || 0) >= topChars * 0.25);
  const text = ensureContrast(neutral || readable[0] || top(textChars)[0] || (dark ? '#f5f5f5' : '#1f1f1f'), background, 4.5);
  const fills = top(shapeFills).filter(c => contrast(c, background) >= 3);
  // Accent: a saturated colour the template actually uses (shape fills count by area, coloured text by characters); else the top fill.
  const saturated = new Map<string, number>();
  for (const [c, area] of shapeFills) if (chroma(c) >= 0.15 && contrast(c, background) >= 2.2) add(saturated, c, area * 100);
  for (const [c, n] of runColors) if (c !== text && chroma(c) >= 0.15 && contrast(c, background) >= 2.2) add(saturated, c, n / 40);
  const schemeAccent = !officeDefault && scheme.accent1 ? `#${scheme.accent1.toLowerCase()}` : undefined;
  const accent = ensureContrast(top(saturated)[0] || fills[0] || schemeAccent || text, background, 3);
  const schemeColors = officeDefault ? [] : ['accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'accent1'].map(k => scheme[k] && `#${scheme[k].toLowerCase()}`).filter(Boolean) as string[];
  const candidates2 = [...top(saturated).slice(1), ...fills.filter(c => c !== accent), ...top(runColors).filter(c => c !== text && c !== accent && chroma(c) >= 0.15), ...schemeColors];
  // Surface: the card colour, a fill that sits close to the background; else a tint of it.
  const surfaceFill = top(shapeFills).find(c => { const k = contrast(c, background); return k > 1.05 && k < 1.8 && contrast(c, text) >= 4.5 && (chroma(c) < 0.05 || hueDistance(c, accent) < 40 || (chroma(background) >= 0.05 && hueDistance(c, background) < 30)); });

  // ── Artwork pool ──
  const images: TemplateImage[] = [];
  const seen = new Set<string>();
  let skippedTransparent = 0, skippedHidden = 0, skippedStrips = 0, skippedFlat = 0;
  const ordered = [...pics].sort((a, b) => b.cx * b.cy - a.cx * a.cy);
  for (const p of ordered) {
    if (seen.has(p.target)) continue;
    seen.add(p.target);
    const ext = path.posix.extname(p.target).toLowerCase();
    const share = (p.cx * p.cy) / (W * H);
    if (ext === '.svg' || ext === '.emf' || ext === '.wmf') { skippedSvg++; continue; }
    if (p.linked) { skippedLinked++; continue; }
    if (share < 0.04) { skippedSmall++; continue; }
    // Very long strips in the middle of a slide are shape graphics (arrows, dividers), not artwork.
    const aspect = p.cx / Math.max(1, p.cy);
    if (roleOf(p, W, H) === 'tile' && (aspect > 4 || aspect < 0.25)) { skippedStrips++; continue; }
    // Full-slide art under a full-slide fill (a texture the template paints over) never shows.
    if (p.layer !== 'slide' && share >= 0.95) { skippedHidden++; continue; }
    const mime = RASTER[ext];
    if (!mime || images.length >= MAX_IMAGES) continue;
    const data = await reader.readBinary(p.target);
    if (!data || data.length > MAX_IMAGE_BYTES) continue;
    if (mime === 'image/png' && opaqueShare(data) < 0.6) { skippedTransparent++; continue; }
    // A near-flat picture (a solid colour block exported as an image) is a shape, not artwork.
    if (await isFlat(data)) { skippedFlat++; continue; }
    const size = imageSize(data, mime);
    images.push({ key: p.key, data, mime, ...(size ? { width: size.w, height: size.h } : {}), role: roleOf(p, W, H), share: Math.round(share * 1000) / 1000, slide: p.slide });
  }

  // ── Logo: the same small picture in the same corner on most slides (compared by content, not file name). ──
  let logo: TemplateLogo | undefined;
  {
    const byHash = new Map<string, { target: string; slides: Set<number>; slots: Map<LogoSlot, number> }>();
    const hashOf = new Map<string, string>();
    for (const seen of logoSeen) {
      if (!hashOf.has(seen.target)) {
        const data = await reader.readBinary(seen.target);
        hashOf.set(seen.target, data ? crypto.createHash('sha1').update(data).digest('hex') : seen.target);
      }
      const h = hashOf.get(seen.target)!;
      const entry = byHash.get(h) || { target: seen.target, slides: new Set<number>(), slots: new Map<LogoSlot, number>() };
      entry.slides.add(seen.slide);
      entry.slots.set(seen.slot, (entry.slots.get(seen.slot) || 0) + 1);
      byHash.set(h, entry);
    }
    const best = [...byHash.values()].sort((a, b) => b.slides.size - a.slides.size)[0];
    if (best && best.slides.size >= Math.max(2, Math.ceil(slidePaths.length * 0.4))) {
      const ext = path.posix.extname(best.target).toLowerCase();
      const mime = RASTER[ext];
      const data = mime ? await reader.readBinary(best.target) : null;
      if (mime && data && data.length <= MAX_IMAGE_BYTES) {
        const size = imageSize(data, mime);
        const slot = [...best.slots.entries()].sort((a, b) => b[1] - a[1])[0][0];
        logo = { data, mime, ...(size ? { width: size.w, height: size.h } : {}), slot, slides: best.slides.size };
      } else if (ext === '.svg' || ext === '.emf' || ext === '.wmf') notes.push('A logo was found but it is a vector file (SVG/EMF); add a PNG logo in Header & footer.');
    }
  }

  // accent2: a second colour with a different hue; else the artwork's average colour.
  let accent2 = candidates2.find(c => hueDistance(c, accent) > 25 && contrast(c, background) >= 2.2);
  if (!accent2 && images.length) {
    const avg = await averageColor(images[0].data);
    if (avg) accent2 = avg;
  }
  accent2 = ensureContrast(accent2 || mix(accent, background, 0.35), background, 2.6);

  const headingFace = top(headingFaces)[0] || majorFont || 'Inter';
  const bodyFace = top(bodyFaces)[0] || minorFont || headingFace;
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 10);
  const baseName = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim() || 'Template';
  const theme: DeckTheme = {
    id: `tpl_${hash}`,
    name: baseName.slice(0, 60),
    colorKeywords: [], toneKeywords: ['template'],
    dark,
    colors: {
      background, text, accent, accent2,
      surface: surfaceFill || (dark ? mix(background, '#ffffff', 0.07) : mix(background, '#ffffff', 0.55)),
      muted: ensureContrast(mix(text, background, 0.4), background, 3.2),
      border: mix(text, background, 0.82),
    },
    fonts: { heading: fontStack(headingFace), body: fontStack(bodyFace) },
    radius: roundShapes > squareShapes ? 16 : 8,
    accentStyle: 'paper',
  };

  notes.push(`Read ${slidePaths.length} slide${slidePaths.length > 1 ? 's' : ''}: background ${background}, text ${text}, accent ${accent}, second accent ${accent2}.`);
  notes.push(`Fonts: ${headingFace} for headings, ${bodyFace} for body (embedded font files are not copied; the names are used with fallbacks).`);
  notes.push(`${images.length} decorative image${images.length === 1 ? '' : 's'} kept for accents; layout rhythm ${rhythm.join(' → ')}.`);
  if (logo) notes.push(`Logo found on ${logo.slides} of ${slidePaths.length} slides (${logo.slot}); it goes into the header/footer.`);
  const skipped = [
    skippedLinked ? `${skippedLinked} picture${skippedLinked > 1 ? 's' : ''} linking to a web page (e.g. a vendor badge)` : '',
    skippedSmall ? `${skippedSmall} small icon${skippedSmall > 1 ? 's' : ''}` : '',
    skippedSvg ? `${skippedSvg} vector image${skippedSvg > 1 ? 's' : ''} (SVG/EMF)` : '',
    skippedTransparent ? `${skippedTransparent} transparent shape graphic${skippedTransparent > 1 ? 's' : ''}` : '',
    skippedHidden ? `${skippedHidden} hidden background texture${skippedHidden > 1 ? 's' : ''}` : '',
    skippedStrips ? `${skippedStrips} strip-shaped graphic${skippedStrips > 1 ? 's' : ''}` : '',
    skippedFlat ? `${skippedFlat} flat colour block${skippedFlat > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  if (skipped.length) notes.push(`Left out: ${skipped.join('; ')}.`);
  // ── Diagram components (template-components.ts) ──
  const componentColor = (body: string) => {
    const f = solidFill(body);
    const c = colorOf(f) || gradientColor(body, colorOf);
    return c ? { color: c, alpha: f?.alpha ?? 1 } : null;
  };
  const recognized = await recognizeComponents(reader, slideParts, { W, H }, componentColor);
  if (recognized.components.length) notes.push(`${recognized.components.length} diagram component${recognized.components.length > 1 ? 's' : ''}: ${recognized.components.map(c => `${c.id} ${c.kind}×${c.units}${c.numbered ? ' numbered' : ''} (slide ${c.slide})`).join(', ')}.`);
  return { fileName, theme, images, rhythm, notes, slides: slidePaths.length, ...(logo ? { logo } : {}), components: recognized.components, componentImages: recognized.images };
}

function roleOf(p: { x: number; y: number; cx: number; cy: number }, W: number, H: number): AccentPosition | 'tile' | 'bottom' {
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  if (p.cx >= W * 0.9 && p.cy >= H * 0.9) return 'background';
  if (near(p.y, 0, H * 0.03) && p.cx >= W * 0.85) return 'top';
  if (near(p.y + p.cy, H, H * 0.03) && p.cx >= W * 0.85 && p.cy <= H * 0.5) return 'bottom';
  if (near(p.x, 0, W * 0.03) && p.cy >= H * 0.85) return 'left';
  if (near(p.x + p.cx, W, W * 0.03) && p.cy >= H * 0.85) return 'right';
  return 'tile';
}

/** Share of (sampled) pixels that are mostly opaque. */
function opaqueShare(data: Buffer): number {
  try {
    const png = PNG.sync.read(data);
    let opaque = 0, total = 0;
    const step = Math.max(1, Math.floor((png.width * png.height) / 20000));
    for (let i = 0; i < png.width * png.height; i += step) { total++; if (png.data[i * 4 + 3] > 200) opaque++; }
    return total ? opaque / total : 1;
  } catch { return 1; }
}

/** Average colour of an image via the optional Node canvas (pdfjs's); null when unavailable. */
async function averageColor(data: Buffer): Promise<string | null> {
  try {
    const canvasMod = await import('@napi-rs/canvas');
    const img = await canvasMod.loadImage(data);
    const canvas = canvasMod.createCanvas(32, 32);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    const sum: RGB = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) { sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; }
    const n = px.length / 4;
    return rgbToHex([sum[0] / n, sum[1] / n, sum[2] / n]);
  } catch { return null; }
}

/** True when a picture is (nearly) one colour: few distinct colours in a 24×24 sample. */
async function isFlat(data: Buffer): Promise<boolean> {
  try {
    const canvasMod = await import('@napi-rs/canvas');
    const img = await canvasMod.loadImage(data);
    const canvas = canvasMod.createCanvas(24, 24);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    const palette = new Set<number>();
    for (let i = 0; i < px.length; i += 4) palette.add(((px[i] >> 5) << 6) | ((px[i + 1] >> 5) << 3) | (px[i + 2] >> 5));
    return palette.size <= 3;
  } catch { return false; }
}
