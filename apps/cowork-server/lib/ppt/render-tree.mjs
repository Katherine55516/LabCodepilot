import crypto from 'node:crypto';
import { applyLayoutRegistry, regionsFor, typographyFor } from '../ppt-layout.mjs';
import { ensureDeckV3, materializeLegacySlide, stableId } from './ir.mjs';
import { layoutPoints } from './point-layout.mjs';

export const EMU_PER_INCH = 914400;
export const SLIDE_SIZE = Object.freeze({ width: Math.round(13.333 * EMU_PER_INCH), height: Math.round(7.5 * EMU_PER_INCH) });

const emu = value => Math.round(Number(value || 0) * EMU_PER_INCH);
const bounds = region => ({ x: emu(region.x), y: emu(region.y), width: emu(region.w), height: emu(region.h) });

function regionMap(slide) { return Object.fromEntries(regionsFor(slide).map(region => [region.id, region])); }

function style(project, typography, role) {
  const fonts = project.templateSpec?.fonts || {};
  const palette = project.templateSpec?.palette || {};
  const tokens = project.deck?.themeTokens || {};
  const title = role === 'title';
  return {
    fontFamily: title ? fonts.title : fonts.body,
    eastAsiaFontFamily: title ? fonts.titleEastAsia : fonts.bodyEastAsia,
    eastAsiaFontFamilyHant: title ? (fonts.titleEastAsiaHant || fonts.titleEastAsia) : (fonts.bodyEastAsiaHant || fonts.bodyEastAsia),
    fontSizePt: title ? Math.round((typography.titlePt || 36) * (tokens.titleScale || 1) * 10) / 10
      : Math.round((typography.bodyPt || 18) * (tokens.bodyScale || 1) * 10) / 10,
    lineHeight: title ? 1.05 : (typography.lineHeight || 1.12) * (tokens.spacingScale || 1),
    paragraphSpacingEm: title ? 0 : (typography.paragraphSpacingEm ?? .5) * (tokens.spacingScale || 1),
    color: title ? palette.foreground : palette.muted,
    fontWeight: title ? 700 : 400,
  };
}

function splitBounds(region, count, index, axis = 'x') {
  if (count <= 1) return bounds(region);
  const gap = .18;
  if (axis === 'y') {
    const h = (region.h - gap * (count - 1)) / count;
    return bounds({ ...region, y: region.y + index * (h + gap), h });
  }
  const w = (region.w - gap * (count - 1)) / count;
  return bounds({ ...region, x: region.x + index * (w + gap), w });
}

function element(node, kind, region, content, nodeStyle, zIndex, extra = {}) {
  const geometry = node.geometry && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(node.geometry[key])) ? node.geometry : bounds(region);
  return { id: node.id, nodeId: node.id, kind, bounds: geometry, content, style: { ...(nodeStyle || {}), ...(node.style || {}) }, zIndex: Number(node.zIndex ?? zIndex), rotation: Number(node.rotation || 0), locked: Boolean(node.locked), groupId: node.groupId || null, ...extra };
}

function adaptiveList(node, region, slide, project) {
  const content = { ...(node.content || {}) };
  const plan = layoutPoints(content.items || [], region, {
    distributionType: slide.copy?.distributionType,
    density: slide.copy?.density,
    depth: slide.copy?.depth,
    bodyScale: project.deck?.themeTokens?.bodyScale || 1,
  });
  content.pointLayout = plan;
  return { content, fontSizePt: plan.fontSizePt };
}

function buildPreservedSlide(project, slide, index) {
  const source = project.templateFidelity.slides[slide.templateSlideIndex];
  const elements = slide.nodes.filter(node => node.nativeRef?.slideIndex === slide.templateSlideIndex).map(node => ({
    id: node.id, nodeId: node.id, kind: node.type === 'foreign' ? 'shape' : node.type,
    bounds: node.geometry, content: node.content || {},
    style: { fontFamily: project.templateSpec?.fonts?.body, eastAsiaFontFamily: project.templateSpec?.fonts?.bodyEastAsia,
      color: project.templateSpec?.palette?.foreground, ...(node.style || {}) },
    zIndex: Number(node.zIndex || 0), rotation: Number(node.rotation || 0), locked: Boolean(node.locked),
    semanticRole: node.semanticRole, nativeRef: node.nativeRef, nativeTextFrame: node.nativeTextFrame,
  })).sort((a, b) => a.zIndex - b.zIndex);
  return { id: slide.id, slideId: slide.id, index, layoutId: slide.layoutId,
    size: { width: project.templateFidelity.width, height: project.templateFidelity.height },
    background: source.background || project.templateSpec?.palette?.background, elements, templatePreserved: true };
}

function buildSlide(project, input, index, total) {
  if (project.templateFidelity?.mode === 'preserve' && Number.isInteger(input.templateSlideIndex)) return buildPreservedSlide(project, input, index);
  const slide = materializeLegacySlide(input);
  const regions = regionMap(slide);
  const typography = typographyFor(slide);
  const elements = [];
  const titleNode = slide.nodes.find(node => node.semanticRole === 'title');
  const bodyNode = slide.nodes.find(node => node.semanticRole === 'body');
  const eyebrowNode = slide.nodes.find(node => node.semanticRole === 'eyebrow');
  const subtitleNode = slide.nodes.find(node => node.semanticRole === 'subtitle');
  const takeawayNode = slide.nodes.find(node => node.semanticRole === 'takeaway');
  const nativeTextNodes = slide.nodes.filter(node => node.type === 'text' && !['title', 'body', 'eyebrow', 'subtitle', 'takeaway'].includes(node.semanticRole));
  const visualNodes = slide.nodes.filter(node => ['image', 'chart', 'table', 'shape', 'foreign'].includes(node.type));
  const layout = slide.layoutId;
  if (titleNode && regions.title) elements.push(element(titleNode, 'text', regions.title, titleNode.content, style(project, typography, 'title'), 10, { semanticRole: 'title' }));
  if (eyebrowNode?.content?.text && regions.eyebrow) elements.push(element(eyebrowNode, 'text', regions.eyebrow, eyebrowNode.content,
    { ...style(project, { bodyPt: 11 }, 'body'), fontSizePt: 11, fontWeight: 700, color: project.templateSpec?.palette?.accent, textAlign: 'left' }, 11, { semanticRole: 'eyebrow' }));
  if (subtitleNode?.content?.text && regions.subtitle) elements.push(element(subtitleNode, 'text', regions.subtitle, subtitleNode.content,
    { ...style(project, { bodyPt: 14 }, 'body'), fontSizePt: 14, textAlign: 'left' }, 12, { semanticRole: 'subtitle' }));
  if (takeawayNode?.content?.text && regions.takeaway) elements.push(element(takeawayNode, 'text', regions.takeaway, takeawayNode.content,
    { ...style(project, { bodyPt: 12 }, 'body'), fontSizePt: 12, fontWeight: 700, color: project.templateSpec?.palette?.foreground, textAlign: 'left' }, 25, { semanticRole: 'takeaway' }));
  for (const node of nativeTextNodes) elements.push(element(node, 'text', regions.body || regions.title, node.content, style(project, typography, 'body'), Number(node.zIndex || 15), { semanticRole: node.semanticRole }));

  if (bodyNode) {
    let bodyRegion = regions.body || regions.timeline || regions.left || regions.primary;
    if (layout === 'comparison' && !visualNodes.length) bodyRegion = { x: 1.0, y: 2.26, w: 11.23, h: 4.31 };
    if (visualNodes.length && layout === 'comparison') bodyRegion = { x: 1.0, y: 5.95, w: 11.23, h: .65 };
    if (visualNodes.length && layout === 'timeline') bodyRegion = { x: 1.0, y: 2.25, w: 11.25, h: 3.05 };
    if (visualNodes.length && ['summary', 'editorial', 'conclusion'].includes(layout)) bodyRegion = { ...bodyRegion, w: 7.35 };
    if (layout === 'big-number') {
      const items = bodyNode.content?.items || [];
      const primaryRegion = visualNodes.length ? { x: 1.0, y: 2.15, w: 7.25, h: 2.15 } : regions.primary;
      const metric = element({ ...bodyNode, id: `${bodyNode.id}_metric` }, 'metric', primaryRegion, { items: items.slice(0, 1) }, style(project, typography, 'body'), 20, { sourceNodeId: bodyNode.id });
      metric.nodeId = bodyNode.id; elements.push(metric);
      if (items.length > 1) {
        const remainder = element({ ...bodyNode, id: `${bodyNode.id}_detail` }, 'list', regions.body, { items: items.slice(1) }, style(project, typography, 'body'), 20, { sourceNodeId: bodyNode.id });
        remainder.nodeId = bodyNode.id; elements.push(remainder);
      }
      bodyRegion = null;
    }
    if (bodyRegion) {
      const kind = layout === 'timeline' ? 'timeline' : 'list';
      const adaptive = kind === 'list' && bodyRegion.h >= 2 ? adaptiveList(bodyNode, bodyRegion, slide, project) : null;
      elements.push(element(bodyNode, kind, bodyRegion, adaptive?.content || bodyNode.content,
        { ...style(project, typography, 'body'), ...(adaptive ? { fontSizePt: adaptive.fontSizePt } : {}) }, 20));
    }
  }

  let visualRegion = regions.visual || regions.primary || regions.left || regions.body;
  if (visualNodes.length && layout === 'big-number') visualRegion = { x: 8.6, y: 2.35, w: 3.2, h: 1.75 };
  if (visualNodes.length && ['summary', 'editorial', 'conclusion'].includes(layout)) visualRegion = { x: 8.7, y: 2.15, w: 3.55, h: 4.55 };
  if (visualNodes.length && layout === 'timeline') visualRegion = { x: 1.0, y: 5.55, w: 11.25, h: .8 };
  visualNodes.forEach((node, visualIndex) => {
    const region = layout === 'comparison'
      ? (() => { const base = visualIndex ? regions.right : regions.left; return { ...base, h: 3.65 }; })()
      : visualRegion;
    if (!region) return;
    const geometry = node.geometry && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(node.geometry[key]))
      ? node.geometry
      : splitBounds(region, visualNodes.length, visualIndex);
    elements.push({
      id: node.id, nodeId: node.id, kind: node.type, bounds: geometry,
      content: node.content || {}, style: node.style || {}, zIndex: Number(node.zIndex || 30 + visualIndex), rotation: Number(node.rotation || 0), locked: Boolean(node.locked), groupId: node.groupId || null,
    });
  });

  elements.push({
    id: stableId('decor', slide.id, 'top-band'), nodeId: null, kind: 'shape',
    bounds: { x: 0, y: 0, width: SLIDE_SIZE.width, height: emu(.13) },
    content: { shape: 'rect' }, style: { fill: project.templateSpec?.palette?.accent }, zIndex: 0, locked: true,
  });
  if (regions.footer) elements.push({
    id: stableId('decor', slide.id, 'footer'), nodeId: null, kind: 'text', bounds: bounds(regions.footer),
    content: { text: String(index + 1) }, style: { ...style(project, { bodyPt: 11 }, 'body'), fontSizePt: 11, textAlign: 'right' }, zIndex: 100, locked: true,
  });
  elements.sort((a, b) => a.zIndex - b.zIndex);
  return { id: slide.id, slideId: slide.id, index, layoutId: slide.layoutId, size: SLIDE_SIZE, background: project.templateSpec?.palette?.background, elements };
}

export function buildRenderTree(project, deckInput = project.deck) {
  const deck = ensureDeckV3(applyLayoutRegistry(deckInput));
  const slides = deck.slides.map((slide, index) => buildSlide(project, slide, index, deck.slides.length));
  const scene = { schemaVersion: 1, units: 'emu', deckId: deck.deckId, size: SLIDE_SIZE, layoutVersion: deck.layoutVersion || 1, slides };
  scene.hash = crypto.createHash('sha256').update(JSON.stringify(scene)).digest('hex');
  return scene;
}

export function rebuildRenderTree(project, previous, affectedSlideIds = []) {
  if (!previous || !affectedSlideIds.length) return buildRenderTree(project);
  const deck = ensureDeckV3(applyLayoutRegistry(project.deck));
  const affected = new Set(affectedSlideIds);
  const old = new Map(previous.slides?.map(slide => [slide.id, slide]) || []);
  const slides = deck.slides.map((slide, index) => affected.has(slide.id) || !old.has(slide.id)
    ? buildSlide(project, slide, index, deck.slides.length)
    : { ...old.get(slide.id), index });
  const scene = { schemaVersion: 1, units: 'emu', deckId: deck.deckId, size: SLIDE_SIZE, layoutVersion: deck.layoutVersion || 1, slides };
  scene.hash = crypto.createHash('sha256').update(JSON.stringify(scene)).digest('hex');
  return scene;
}

export function buildSlideRenderTree(project, slideId) {
  const tree = buildRenderTree(project);
  return tree.slides.find(slide => slide.id === slideId) || null;
}

export function boundsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export const _internals = { emu, bounds, splitBounds, buildSlide };
