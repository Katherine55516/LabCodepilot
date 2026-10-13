import { isSourceOwnedNode } from './ppt-source-artifacts.mjs';
import { templateDesignView, isOrdinalSequence } from './ppt-template-design.mjs';
import {prepareComponentGeometry} from './ppt/component-layout.mjs';
import { templateComponentProfile, bindMappedTemplateMedia } from './ppt-template-components.mjs';
import { adaptationDisposition } from './ppt-template-dispositions.mjs';
import { visibleSlideText } from './ppt-evidence.mjs';
import * as files from './files.mjs';
import { Readable } from 'node:stream';
/** Reuse an uploaded PPTX as native slide artwork with editable text slots.
 * The model fills slot IDs; deterministic variants change copied page artwork. */
import crypto from 'node:crypto';
import { importEditablePptx, renderImportedPptx } from './ppt/import-pptx.mjs';
import { stableId } from './ppt/ir.mjs';
import { planTemplateSlideMap, profileTemplateSlide, visualSimilarity, catalogTemplateLayouts, TEMPLATE_VARIANTS } from './ppt-template-scheduler.mjs';
import { semanticMediaForSlide } from './ppt-semantic-media.mjs';
import { visibleBodyTarget, templateVisualUnits } from './ppt-presentation-writing.mjs';
import {measureText, textContract, PT_EMU} from './ppt/render-contract.mjs';

const visualUnits = templateVisualUnits;
const numericLabel = value => /^\s*(?:\d{1,2}|[IVX]{1,4})\s*$/i.test(value || '');
const numericMetric = value => /^\s*[+-]?\d+(?:[.,]\d+)?\s*%\s*$/u.test(value || '');
const INCH = 914400;
const comparable = value => String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const formulaKey = value => String(value || '').replace(/[`\s]/g, '').toLocaleLowerCase();
const emuToPt = value => Number(value || 0) * 72 / INCH;
const FRAGMENT_END = /(?:\b(?:a|an|the|and|or|of|to|for|with|by|in|on|at|from|that|which|when|because|while|including|without|versus|then|about|during|into|under|before|after|through|is|are|was|were|has|have|per)|[&/,:;，、：；（(\-–—]|[，、；]\s*(?:與|与|和|或|把|将|將|对|對|在|由|从|從))\s*$/iu;
function incompletePhrase(value) {
  const text = String(value || '').trim().replace(/[.!?。！？]+$/u, '').trim();
  if (!text) return false;
  if (/(?:^|\s)[A-Z][A-Z0-9]*\/[A-Z][A-Z0-9]*$/u.test(text)) return false;
  return FRAGMENT_END.test(text) || (text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length ||
    (text.match(/（/g) || []).length > (text.match(/）/g) || []).length ||
    (text.split(/\s+/).length > 3 && /\b(?:one|two|three|four|five)\b$/iu.test(text));
}

function explanationRepeatsHeading(heading, description) {
  const title = comparable(heading);
  const body = comparable(description);
  if (!title || !body) return false;
  if (title === body) return true;
  // A short sentence that merely prefixes the heading with a generic verb
  // still adds no usable explanation. Allow a longer body that explains the
  // mechanism or result, including one which naturally restates its subject.
  return body.startsWith(title) && visualUnits(description) - visualUnits(heading) < 10;
}

function copyTokens(value) {
  const normalized = comparable(value);
  const tokens = String(value || '').toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}|\d+(?:\.\d+)?%?|[\u3400-\u9fff]{2,}/gu) || [];
  const units = [...new Set(tokens.flatMap(token => /[\u3400-\u9fff]/u.test(token)
    ? [...token].flatMap((_, index, chars) => index + 1 < chars.length ? [chars.slice(index, index + 2).join('')] : [])
    : [token]))];
  return units.length ? units : normalized ? [normalized] : [];
}

function copyCoverage(expected, visible) {
  const source = copyTokens(expected);
  const display = new Set(copyTokens(visible));
  return source.length ? source.filter(token => display.has(token)).length / source.length : 1;
}

function visibleSlotText(slide, slots) {
  return slots.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose)).map(slot => {
    const value = slide.templateSlotTexts?.[String(slot.shapeId)];
    return Array.isArray(value) ? value.map(item => `${item?.label || ''} ${item?.body || ''}`).join(' ') : String(value || '');
  }).join(' ');
}

function contentCoverageIssues(project, slide, slots, index) {
  const blocks = slide.copy?.blocks || [];
  const visible = slide.sourceArtifactNodes?.length ? visibleSlideText(slide) : visibleSlotText(slide, slots);
  const issues = blocks.flatMap((block, blockIndex) => {
    const body = String(block.body || '').trim();
    if (!body || copyCoverage(body, visible) >= .82) return [];
    return [{ code: 'template_content_unrendered', severity: 'error',
      message: `模板第 ${index + 1} 页第 ${blockIndex + 1} 个计划内容块没有完整进入可见文字`,
      repair: 'fill_template_slots', blockIndex, coverage: Number(copyCoverage(body, visible).toFixed(3)) }];
  });
  const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
  for (const [detailIndex, detail] of (contract?.requiredDetails || []).entries()) {
    const formula = /\b[A-Za-z_]\w*\s*=|\b[A-Za-z_]\w*\s*\([^\n]*[-+*/][^\n]*\)/u.test(detail);
    const coverage = formula ? Number(formulaKey(`${slide.title || ''} ${visible}`).includes(formulaKey(detail)))
      : copyCoverage(detail, `${slide.title || ''} ${visible}`);
    if (coverage < (formula ? 1 : .25)) issues.push({ code: 'template_required_detail_missing', severity: 'error',
      message: `模板第 ${index + 1} 页第 ${detailIndex + 1} 条必讲细节没有进入可见文字`,
      repair: 'fill_template_slots', detailIndex, coverage: Number(coverage.toFixed(3)) });
  }
  return issues;
}

function sourceImageSize(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (match[1] === 'png') return bytes.length >= 24 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function sourceMediaFor(project, index, use, frame) {
  const images = (project.source?.images || []).filter(image => /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(image?.dataUrl || ''));
  const focus = comparable(`${project.outline?.[index]?.title || ''} ${project.outline?.[index]?.focus || ''}`);
  const candidates = images.length <= 1 ? images : images.filter(image => {
    const label = comparable(image.caption);
    return label.length >= 3 && focus.includes(label);
  });
  const fitting = candidates.filter(image => {
    const size = sourceImageSize(image.dataUrl);
    if (!size) return false;
    const role=image.role||'source_content';
    if(['equation','icon','diagram'].includes(role))return false; // owned structures, not photo frames
    // Resolution is a quality warning, never grounds for silently dropping source media.
    const ratio = (size.width / size.height) / (frame.geometry.width / frame.geometry.height);
    return ratio >= .65 && ratio <= 1.55;
  });
  return fitting.length ? fitting[(use - 1) % fitting.length] : null;
}

function textOverlayCalloutPanel(frame, size, slide) {
  if (!frame || !size) return false;
  const { x, y, width, height } = frame.geometry;
  const textOverlay = (slide?.nodes || []).some(node => node !== frame && node.type === 'text' && node.content?.text?.trim() &&
    Math.max(0, Math.min(x + width, node.geometry.x + node.geometry.width) - Math.max(x, node.geometry.x)) *
      Math.max(0, Math.min(y + height, node.geometry.y + node.geometry.height) - Math.max(y, node.geometry.y)) >=
        node.geometry.width * node.geometry.height * .75);
  return frame.content?.dataUrl?.startsWith('data:image/png;base64,') && textOverlay &&
    width >= size.width * .78 && width / Math.max(1, height) >= 6 &&
    height >= size.height * .12 && height <= size.height * .24;
}

function safeDecorativeMedia(frame, size, slide) {
  if (!frame || !size) return false;
  const { x, y, width, height } = frame.geometry;
  const flushSide = x <= size.width * .035 || x + width >= size.width * .965;
  const sidePhoto = flushSide && y <= size.height * .035 && height >= size.height * .9 &&
    width >= size.width * .25 && width <= size.width * .55;
  const jpegPanelPhoto = frame.content?.dataUrl?.startsWith('data:image/jpeg;base64,') &&
    x >= size.width * .5 && y >= size.height * .36 && width >= size.width * .3 && width <= size.width * .48 &&
    height >= size.height * .3 && height <= size.height * .5 && width / height >= 1.5 && width / height <= 2;
  // Wide transparent PNG strips with an overlaid native text frame are
  // template callout backgrounds (e.g. quote banners), not source screenshots.
  // Preserve the original panel instead of placing a generated diagram under
  // its white text, which would erase the contrast the panel provides.
  const calloutPanel = textOverlayCalloutPanel(frame, size, slide);
  const standalone = !(slide?.nodes || []).some(node => node !== frame &&
    ['text', 'image', 'table'].includes(node.type) && overlaps(node.geometry, frame.geometry));
  return isFullBleed(frame, size) || calloutPanel || standalone && (sidePhoto || jpegPanelPhoto);
}

function contentMediaCandidates(spec, size) {
  const nodes = spec?.nodes || [];
  const slideArea = Number(size?.width || 0) * Number(size?.height || 0);
  if (!slideArea) return [];
  return nodes.filter(node => {
    if (node.type !== 'image' || isFullBleed(node, size) || safeDecorativeMedia(node, size, spec)) return false;
    const area = node.geometry.width * node.geometry.height / slideArea;
    if (area < .07 || area > .45 || node.geometry.height < size.height * .15) return false;
    // Numbered donuts and layered infographics are several coincident images;
    // a single plot/screenshot normally has no such native companion.
    return !nodes.some(other => other !== node && other.type === 'image' &&
      Math.abs(other.geometry.x - node.geometry.x) < size.width * .03 &&
      Math.abs(other.geometry.y - node.geometry.y) < size.height * .03 &&
      Math.abs(other.geometry.width - node.geometry.width) < size.width * .03 &&
      Math.abs(other.geometry.height - node.geometry.height) < size.height * .03);
  });
}

function templateSourceAffinity(project, spec) {
  const source = String(project.source?.text || '').toLocaleLowerCase();
  const original = (spec?.nodes || []).filter(node => node.type === 'text')
    .map(node => node.content?.text || '').join(' ').toLocaleLowerCase();
  const common = new Set(['about', 'after', 'analysis', 'based', 'data', 'example', 'from', 'into', 'other',
    'result', 'results', 'system', 'their', 'these', 'those', 'using', 'which', 'with']);
  const terms = [...new Set((original.match(/[a-z][a-z0-9_-]{4,}|[\u3400-\u9fff]{2,}/gu) || [])
    .filter(term => !common.has(term)))];
  return terms.length ? terms.filter(term => source.includes(term)).length / terms.length : 0;
}

function reclaimedMediaTextFrames(project, slide, size) {
  if (!project.source?.text || templateSourceAffinity(project, slide) >= .38) return new Map();
  const result = new Map();
  const slotById=new Map(slotsFor(slide).map(slot=>[slot.shapeId,slot]));
  for (const media of contentMediaCandidates(slide, size)) {
    const rightEdge = media.geometry.x + media.geometry.width;
    const neighbor = (slide.nodes || []).filter(node => node.type === 'text' && node.nativeTextFrame &&
      Number(node.style?.fontSizePt || 0) <= 18 && Number(node.style?.fontWeight || 400) < 600 &&
      visualUnits(node.content?.text) >= 24 && ['body','point-description'].includes(slotById.get(node.nativeRef.shapeId)?.purpose) && node.geometry.x >= rightEdge - size.width * .025 &&
      Math.abs(node.geometry.y - media.geometry.y) <= size.height * .08 &&
      node.geometry.y + node.geometry.height <= media.geometry.y + media.geometry.height + size.height * .08)
      .sort((a, b) => Math.abs(a.geometry.x - rightEdge) - Math.abs(b.geometry.x - rightEdge))[0];
    if (!neighbor) continue;
    const x = Math.min(media.geometry.x, neighbor.geometry.x);
    const y = Math.min(media.geometry.y, neighbor.geometry.y);
    const right = Math.min(size.width, Math.max(rightEdge, neighbor.geometry.x + neighbor.geometry.width));
    const bottom = Math.min(size.height, Math.max(media.geometry.y + media.geometry.height,
      neighbor.geometry.y + neighbor.geometry.height));
    const expanded={x,y,width:right-x,height:bottom-y};
    const intersection=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    // Existing intentional overlaps are not permission to increase them.
    if ((slide.nodes||[]).some(other=>other!==neighbor && other.type==='text' &&
      intersection(expanded,other.geometry)>intersection(neighbor.geometry,other.geometry)+INCH*INCH*.001)) continue;
    result.set(neighbor.nativeRef.shapeId, expanded);
  }
  return result;
}

/** Original content screenshots have no provenance in the new source. Remove
 * them when the original page clearly discusses another subject. This leaves
 * full-bleed photos, side photos, icons and layered artwork untouched. */
export function autoTemplateMediaOmissions(project, index, existing = []) {
  const spec = project.templateFidelity?.slides?.[index];
  if (!spec || project.templateContentMode!=='design_only' && (!project.source?.text || templateSourceAffinity(project, spec) >= .38)) return [];
  const already = new Set(existing.map(item => String(item.shapeId)));
  return (project.templateContentMode==='design_only' ? spec.nodes : contentMediaCandidates(spec, project.templateFidelity)).filter(node =>
    node.content?.mediaRole==='old_template_content' && !node.content?.mustPreserve &&
    !node.content?.mediaReplacement && !already.has(String(node.nativeRef?.shapeId)))
    .map(node => adaptationDisposition(project,node,'old_template_content',project.templateContentMode==='design_only'?'design_only_template':'deterministic_topic_mismatch',project.templateContentMode==='design_only'?'Design reuse retires original report foreground data; current source assets supply the new evidence.':'Explicit old sample media is retired after deterministic topic mismatch; no user approval or equivalent replacement is claimed.'));
}

export function templateMediaRole(node,spec,size){
  const declared=node.content?.mediaRole||node.content?.role;
  if(declared)return declared;
  if(safeDecorativeMedia(node,size,spec))return 'template_decoration';
  if(contentMediaCandidates(spec,size).some(n=>n.id===node.id))return 'unknown';
  const area=node.geometry?.width*node.geometry?.height/(size.width*size.height);
  return area<.02?'template_icon':'template_artwork';
}

function frameContract(node, fontSizePt) {
  const frame = node.nativeTextFrame;
  if (!frame) return null;
  const sourceParagraphs = (frame.paragraphs || []).filter(item => item.text?.trim());
  const [left, top, right, bottom] = frame.margins || [0, 0, 0, 0];
  const usableWidthPt = Math.max(1, emuToPt(node.geometry.width - left - right));
  const usableHeightPt = Math.max(1, emuToPt(node.geometry.height - top - bottom));
  const lineVisualUnits = Math.max(3, Math.floor(usableWidthPt / fontSizePt * .88));
  const maxLines = frame.wordWrap === false ? 1 : Math.max(1, Math.floor(usableHeightPt / (fontSizePt * 1.16) + .04));
  return { wordWrap: frame.wordWrap !== false, autoSize: frame.autoSize,
    paragraphCount: sourceParagraphs.length, maxLines, lineVisualUnits,
    paragraphs: sourceParagraphs.map((item, index) => ({ id: `${node.nativeRef.shapeId}:p${index}`, example: item.text.slice(0, 140),
      hasLabelRun: Boolean(item.runs?.[0]?.bold && item.runs?.slice(1).some(run => !run.bold && run.text?.trim())),
      fontSizePt: Number(item.runs?.find(run => run.fontSizePt)?.fontSizePt || fontSizePt) })) };
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) / Math.min(a.width, b.width);
}

function imageTextCoupled(slide, size) {
  const pictures = slide.nodes.filter(node => node.type === 'image' && !isFullBleed(node, size));
  // A native infographic may use text boxes beside an image, not only on top
  // of it. Mirroring every shape can change their reading order or put labels
  // across a picture even if the original rectangles did not intersect.
  // Preserve their relative geometry; repeated pages may still vary the crop
  // or replace a source-matched picture.
  const text = slide.nodes.filter(node => node.type === 'text' && node.content?.text?.trim() &&
    node.geometry.y + node.geometry.height / 2 >= size.height * .24);
  return pictures.length > 0 && text.length > 0;
}

function slotsFor(slide) {
  const text = slide.nodes.filter(node => node.type === 'text' && node.content?.text?.trim());
  const ordinals=isOrdinalSequence(slide.nodes);
  // Percent values are often sample metrics in template decks. Keep them
  // editable and prevent the largest percentage from being mistaken for the
  // page title (for example, a decorative "35%" callout).
  const candidates = text.filter(node => node.content?.mediaRole!=='brand' && !numericLabel(node.content.text) && !numericMetric(node.content.text));
  const title = [...candidates].sort((a, b) => {
    const score = node => Number(node.style?.fontSizePt || 14) * Math.min(2, node.geometry.width / 3_000_000);
    return score(b) - score(a);
  })[0];
  const section = [...candidates].filter(node => node.id !== title?.id && node.geometry.y < (title?.geometry.y ?? 0))
    .sort((a, b) => a.geometry.y - b.geometry.y)[0];
  const slots = text.map(node => {
    const original = node.content.text;
    const role = node.content?.mediaRole==='brand' || (numericLabel(original) && (!node.content?.templateDesignOnly || ordinals.has(node.id))) ? 'static' : node.id === title?.id ? 'title' : node.id === section?.id ? 'section' : 'content';
    const fontSizePt = Number(node.style?.fontSizePt || 14);
    const frame = frameContract(node, fontSizePt);
    return { nodeId: node.id, shapeId: node.nativeRef.shapeId, role,
      // Old template copy is an example, not a physical text limit. A short
      // placeholder can occupy a large native frame. Keep a geometry safety
      // margin so the writer can use that frame without asking PPT to shrink.
      example: original.slice(0, 180), capacity: Math.max(4, frame
        ? Math.min(frame.lineVisualUnits * frame.maxLines, Math.max(
          Math.ceil(visualUnits(original) * 1.2), Math.floor(frame.lineVisualUnits * frame.maxLines * .86)))
        : Math.ceil(visualUnits(original) * 1.2)),
      fontSizePt, ...(frame || {}) };
  });
  const content = slots.filter(slot => slot.role === 'content');
  const byId = new Map(text.map(node => [node.nativeRef.shapeId, node]));
  for (const slot of content) {
    const node = byId.get(slot.shapeId);
    // Two native paragraphs can be a wrapped card heading, not two facts.
    const wrappedHeading = slot.paragraphCount > 1 && slot.capacity < 35 &&
      visualUnits(node.content.text) < 24 && content.some(other => {
        const child = byId.get(other.shapeId)?.geometry;
        const gap = child && child.y - node.geometry.y - node.geometry.height;
        return other.shapeId !== slot.shapeId && other.fontSizePt <= slot.fontSizePt - 1.5 &&
          child && gap >= -.05 * INCH && gap <= .8 * INCH && horizontalOverlap(child, node.geometry) >= .65;
      });
    const groupHeading = slot.paragraphCount <= 1 && slot.capacity < 70 && slot.fontSizePt >= 16 &&
      node.geometry.width >= 5 * INCH && node.geometry.height <= .45 * INCH &&
      content.filter(other => {
        const child = byId.get(other.shapeId)?.geometry;
        const gap = child && child.y - node.geometry.y - node.geometry.height;
        return other.shapeId !== slot.shapeId && other.fontSizePt <= slot.fontSizePt - 1.5 && other.fontSizePt >= 12 &&
          child && child.width < 3 * INCH && gap >= .05 * INCH && gap <= 2 * INCH;
      }).length >= 2;
    slot.purpose = groupHeading ? 'group-heading' : wrappedHeading ? 'point-heading' : slot.paragraphCount > 1 ? 'list' : slot.fontSizePt <= 9.5 && node.geometry.width >= 2 * INCH && node.geometry.height <= .22 * INCH ? 'footnote'
      : slot.capacity < 10 || (Number(node.style?.fontWeight||400)>=600 && slot.maxLines<=1 && visualUnits(node.content.text)<24) || (node.geometry.width < 1.8 * INCH &&
        (slot.maxLines <= 1 || visualUnits(node.content.text) < 18)) ? 'label' : 'body';
    if (slot.purpose === 'list' || slot.purpose === 'footnote') continue;
    if (['label', 'point-heading', 'group-heading'].includes(slot.purpose)) continue;
    const candidates = content.filter(other => other.shapeId !== slot.shapeId && other.purpose !== 'group-heading' && other.fontSizePt >= slot.fontSizePt + 1.5)
      .map(other => ({ slot: other, node: byId.get(other.shapeId) }))
      .filter(({ node: parent }) => {
        const gap = node.geometry.y - parent.geometry.y - parent.geometry.height;
        return gap >= -0.05 * INCH && gap <= 0.75 * INCH && horizontalOverlap(node.geometry, parent.geometry) >= .65;
      })
      .sort((a, b) => (node.geometry.y - b.node.geometry.y) - (node.geometry.y - a.node.geometry.y));
    const parent = candidates[0]?.slot;
    if (!parent) continue;
    slot.purpose = 'point-description';
    slot.pairedWith = parent.shapeId;
    slot.minVisualUnits = Math.max(1, Math.min(Math.floor(slot.capacity * .76), 14,
      Math.max(8, Math.ceil(visualUnits(slot.example) * .65))));
    parent.purpose = 'point-heading';
  }
  // Inline status/caption text beside a heading belongs to the same card.
  for (const slot of content.filter(item => ['body','label'].includes(item.purpose) && item.capacity < 70 && !item.pairedWith)) {
    const child = byId.get(slot.shapeId)?.geometry;
    const parent = content.filter(item => item.purpose === 'point-heading' && item.fontSizePt >= slot.fontSizePt + 1.5)
      .map(item => ({slot:item, geometry:byId.get(item.shapeId)?.geometry}))
      .filter(({geometry}) => geometry && child && Math.abs(child.y - geometry.y) <= .12 * INCH &&
        child.x - geometry.x - geometry.width >= -.4 * INCH && child.x - geometry.x - geometry.width <= 1 * INCH)
      .sort((a,b) => Math.abs(child.x-a.geometry.x-a.geometry.width)-Math.abs(child.x-b.geometry.x-b.geometry.width))[0];
    if (parent) { slot.purpose = 'point-description'; slot.pairedWith = parent.slot.shapeId; }
  }
  // Card headings, lists and captions are one semantic unit even when they
  // occupy separate native text boxes. Expose that relationship to the model
  // and to the whole-deck reviewer so a heading cannot silently describe a
  // different fact from the list or caption beneath it.
  for (const slot of slots) {
    slot.groupId = slot.pairedWith || slot.shapeId;
    if (!['list', 'footnote'].includes(slot.purpose)) continue;
    const child = byId.get(slot.shapeId)?.geometry;
    const parent = content.filter(other => ['body', 'point-heading', 'label'].includes(other.purpose))
      .map(other => ({ slot: other, geometry: byId.get(other.shapeId)?.geometry }))
      .filter(({ geometry }) => geometry && child && horizontalOverlap(child, geometry) >= .4 &&
        child.y - geometry.y - geometry.height >= -0.05 * INCH &&
        child.y - geometry.y - geometry.height <= 0.8 * INCH)
      .sort((a, b) => (child.y - a.geometry.y - a.geometry.height) - (child.y - b.geometry.y - b.geometry.height))[0];
    if (parent) {
      slot.groupId = parent.slot.shapeId;
      if (parent.slot.purpose === 'label' || parent.slot.capacity < 70) parent.slot.purpose = 'point-heading';
    }
  }
  return slots;
}

// Projects created before semantic slot classification retain their native
// nodes, so the contract can be upgraded without changing persisted IR IDs.
function effectiveSlots(spec) {
  if (spec.slots.some(slot => slot.role === 'content' && (!slot.purpose || !slot.groupId ||
    (slot.purpose === 'label' && slot.maxLines > 1 && slot.capacity >= 10 && visualUnits(slot.example) >= 18))))
    return slotsFor({ nodes: spec.nodes });
  if (spec.slots.some(slot => slot.purpose === 'label' || slot.purpose === 'body' && slot.capacity < 70 || slot.purpose === 'list' && slot.capacity < 35)) {
    const upgraded = slotsFor({ nodes: spec.nodes });
    if (upgraded.some(slot => (slot.purpose === 'point-heading' &&
      ['label', 'list'].includes(spec.slots.find(old => old.shapeId === slot.shapeId)?.purpose)) || slot.purpose === 'point-description' && slot.pairedWith && !spec.slots.find(old => old.shapeId === slot.shapeId)?.pairedWith || slot.purpose === 'group-heading' && spec.slots.find(old => old.shapeId === slot.shapeId)?.purpose !== 'group-heading')) return upgraded;
  }
  return spec.slots;
}

function profileSourceSlide(slide, size, richSource = false) {
  const prepared = richSource ? { ...slide, nodes: structuredClone(slide.nodes || []) } : slide;
  if (richSource) expandSafeDescriptions(prepared.nodes, size);
  const profile = profileTemplateSlide(prepared, size);
  const slots = slotsFor(prepared);
  const content = slots.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose));
  const listItems = content.filter(slot => slot.purpose === 'list').reduce((sum, slot) => sum + slot.paragraphCount, 0);
  const independent = new Set(content.map(slot => slot.groupId || slot.pairedWith || slot.shapeId)).size;
  profile.semantic = { contentSlots: content.length, listItems,
    totalVisualCapacity: content.reduce((sum, slot) => sum + slot.capacity, 0),
    semanticUnitCapacity: Math.max(1, Math.min(10, independent)) };
  const ordinals = (prepared.nodes || []).filter(node => node.type === 'text' && /^0?[1-9]\d?$/.test(String(node.content?.text || '').trim()))
    .sort((a, b) => Math.abs(a.geometry.y - b.geometry.y) < size.height * .08
      ? a.geometry.x - b.geometry.x : a.geometry.y - b.geometry.y);
  profile.semantic.readingOrder = content.map(slot => ({ shapeId: slot.shapeId,
    x: prepared.nodes.find(node => node.nativeRef?.shapeId === slot.shapeId)?.geometry.x || 0,
    y: prepared.nodes.find(node => node.nativeRef?.shapeId === slot.shapeId)?.geometry.y || 0 }))
    .sort((a, b) => Math.abs(a.y - b.y) < size.height * .08 ? a.x - b.x : a.y - b.y)
    .map(item => item.shapeId);
  profile.semantic.ordinalSequence = ordinals.map(node => Number(node.content.text));
  const roles = new Map(slots.map(slot => [slot.shapeId, slot.role]));
  // Mirror transforms reverse the relative placement of native labels over an
  // infographic. Keep such compositions together and vary only their media.
  profile.safeGeometryModes = profile.directional || profile.objectTypes.table || profile.objectTypes.chart || imageTextCoupled(prepared, size) ? []
    : ['content-mirror', 'title-content-mirror'].filter(mode => {
      const projected = prepared.nodes.map(node => ({ ...node, geometry: variantGeometry(node, mode, roles.get(node.nativeRef?.shapeId), size) }));
      return projected.some((node, index) => node.geometry.x !== prepared.nodes[index].geometry.x) &&
        !introducesOverlap(prepared.nodes, projected, size);
    });
  if (!profile.directional && !profile.objectTypes.table && !profile.objectTypes.chart && panelSwapGeometry(prepared, size))
    profile.safeGeometryModes.push('panel-swap');
  return profile;
}

function isFullBleed(node, size) {
  return node.geometry.width * node.geometry.height >= size.width * size.height * .8;
}

function variantGeometry(node, mode, role, size) {
  if (mode === 'media-focus' || isFullBleed(node, size)) return node.geometry;
  const inContentBand = node.geometry.y + node.geometry.height / 2 >= size.height * .24;
  if (!inContentBand && !(mode === 'title-content-mirror' && role === 'title')) return node.geometry;
  return { ...node.geometry, x: size.width - node.geometry.x - node.geometry.width };
}

function overlaps(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height > Math.min(a.width * a.height, b.width * b.height) * .025;
}

function introducesOverlap(original, projected, size) {
  for (let left = 0; left < original.length; left++) {
    if (isFullBleed(original[left], size)) continue;
    for (let right = left + 1; right < original.length; right++) {
      if (isFullBleed(original[right], size)) continue;
      if (!overlaps(original[left].geometry, original[right].geometry) &&
          overlaps(projected[left].geometry, projected[right].geometry)) return true;
    }
  }
  return false;
}

function expandSafeDescriptions(nodes, size) {
  const slots = slotsFor({ nodes });
  for (const slot of slots.filter(item => item.purpose === 'point-description' && item.maxLines === 1 && item.wordWrap)) {
    const index = nodes.findIndex(node => node.nativeRef?.shapeId === slot.shapeId);
    const node = nodes[index];
    if (!node || node.geometry.height > size.height * .08) continue;
    const height = Math.min(Math.round(node.geometry.height * 2.05), Math.round(size.height * .13),
      Math.round(size.height * .96 - node.geometry.y));
    if (height <= node.geometry.height * 1.5) continue;
    const projected = nodes.map((item, itemIndex) => itemIndex === index
      ? { ...item, geometry: { ...item.geometry, height } } : item);
    if (introducesOverlap(nodes, projected, size)) continue;
    node.geometry = { ...node.geometry, height };
    node.content = { ...node.content, adaptiveTextExpansion: true };
  }
}

/** Swap two independent native media cards with their contained text. A card
 * must have similar dimensions to its partner; directional and chart slides
 * are excluded by the caller. Every object keeps its native shape ID. */
function panelSwapGeometry(slide, size) {
  const nodes = slide.nodes || [];
  const anchors = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.type === 'image' &&
    node.geometry.width * node.geometry.height >= size.width * size.height * .025 &&
    node.geometry.width * node.geometry.height < size.width * size.height * .4 &&
    node.geometry.x >= 0 && node.geometry.y >= 0 &&
    node.geometry.x + node.geometry.width <= size.width && node.geometry.y + node.geometry.height <= size.height);
  const centerInside = (inner, outer) => {
    const x = inner.x + inner.width / 2, y = inner.y + inner.height / 2;
    return x > outer.x && x < outer.x + outer.width && y > outer.y && y < outer.y + outer.height;
  };
  for (let left = 0; left < anchors.length; left++) for (let right = left + 1; right < anchors.length; right++) {
    const a = anchors[left].node.geometry, b = anchors[right].node.geometry;
    if (overlaps(a, b) || Math.abs(a.width - b.width) / Math.max(a.width, b.width) > .1 ||
        Math.abs(a.height - b.height) / Math.max(a.height, b.height) > .1) continue;
    const groups = [a, b].map(anchor => nodes.map((node, index) => centerInside(node.geometry, anchor) ? index : -1).filter(index => index >= 0));
    if (groups[0].some(index => groups[1].includes(index)) || groups.some(group => group.length < 2)) continue;
    const result = nodes.map(node => structuredClone(node.geometry));
    for (const index of groups[0]) result[index] = { ...result[index], x: result[index].x + b.x - a.x, y: result[index].y + b.y - a.y };
    for (const index of groups[1]) result[index] = { ...result[index], x: result[index].x + a.x - b.x, y: result[index].y + a.y - b.y };
    const projected = nodes.map((node, index) => ({ ...node, geometry: result[index] }));
    if (!introducesOverlap(nodes, projected, size)) return result;
  }
  return null;
}

function slotParagraphs(value) {
  if (!Array.isArray(value)) return null;
  return value.map(item => typeof item === 'string' ? { label: '', body: item.trim() } :
    item && typeof item === 'object' ? { label: String(item.label || '').trim(), body: String(item.body || '').trim() } : { label: '', body: '' });
}

function inspectListSlot(slot, value, index) {
  const paragraphs = slotParagraphs(value);
  const error = (code, message) => ({ code, severity: 'error', message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} ${message}`,
    repair: 'fill_template_slots', shapeId: slot.shapeId, requiredItems: slot.paragraphCount });
  if (!paragraphs || paragraphs.length !== slot.paragraphCount) return [error('template_point_count', `需要 ${slot.paragraphCount} 条不同的要点`)];
  const seen = new Set(); const seenLabels = new Set(); const seenBodies = new Set(); let lines = 0;
  for (const [itemIndex, item] of paragraphs.entries()) {
    const pattern = slot.paragraphs[itemIndex];
    if (!item.body || (pattern?.hasLabelRun && !item.label)) return [error('template_point_unfilled', `第 ${itemIndex + 1} 条缺少${pattern?.hasLabelRun ? '名称或说明' : '说明'}`)];
    if (incompletePhrase(item.label) || incompletePhrase(item.body)) return [error('template_text_fragment', `第 ${itemIndex + 1} 条停在句中，需改写为完整短句或短标签`)];
    const combined = `${item.label}${item.body}`; const normalized = comparable(combined);
    if (seen.has(normalized)) return [error('template_point_duplicate', '存在重复要点')];
    const labelKey = comparable(item.label), bodyKey = comparable(item.body);
    if ((labelKey.length >= 3 && seenLabels.has(labelKey)) || (bodyKey.length >= 6 && seenBodies.has(bodyKey)))
      return [error('template_point_duplicate', '列表名称或说明重复')];
    seen.add(normalized);
    seenLabels.add(labelKey); seenBodies.add(bodyKey);
    if (visualUnits(combined) < 6) return [error('template_point_too_short', `第 ${itemIndex + 1} 条说明过短`)];
    lines += Math.max(1, Math.ceil(visualUnits(combined) / Math.max(1, slot.lineVisualUnits)));
  }
  return lines > slot.maxLines ? [error('template_text_fit', `预计占 ${lines} 行，模板只容纳 ${slot.maxLines} 行；需改写为更短的要点`)] : [];
}

function compactSourceCatalog(sourceSlides, slideMap) {
  const mapped = new Set(slideMap);
  return sourceSlides.map((source, sourceIndex) => {
    const slide = structuredClone(source);
    if (mapped.has(sourceIndex)) for (const node of slide.nodes || []) {
      if (node.type === 'image' && node.content) delete node.content.dataUrl;
    }
    return slide;
  });
}

export function fidelityFromImported(project, imported, templateHash) {
  const originalCount = imported.deck.slides.length;
  if (originalCount < 2 && project.pages > originalCount) throw new Error('preserved template needs a content slide to reuse');
  if (imported.deck.slides.some(slide => !slotsFor(slide).some(slot => slot.role !== 'static'))) {
    throw new Error('preserved template has a slide without editable text slots');
  }
  const richSource = project.inputProfile?.level === 'rich' || String(project.source?.text || '').length >= 8000;
  const profiles = imported.deck.slides.map(slide => profileSourceSlide(slide, imported.externalPptx, richSource));
  const slideMap = planTemplateSlideMap(originalCount, project.pages, { profiles });
  return buildFidelity(project, imported.deck.slides, imported.externalPptx, templateHash, profiles, slideMap);
}

function buildFidelity(project, sourceSlides, externalPptx, templateHash, profiles, slideMap) {
  const originalCount = sourceSlides.length;
  const usage = Array(originalCount).fill(0);
  const catalog = catalogTemplateLayouts(profiles);
  const slides = slideMap.map((sourceIndex, index) => {
      const slide = sourceSlides[sourceIndex];
      const use = usage[sourceIndex]++;
      const repeated = use > 0;
      const profile = profiles[sourceIndex];
      const modes = profile.safeGeometryModes || [];
      const mode = !repeated ? 'original' : modes.length ? modes[(use - 1) % modes.length] : 'media-focus';
      const cropVariant = repeated ? TEMPLATE_VARIANTS[1 + Math.floor((use - 1) / Math.max(1, modes.length)) % (TEMPLATE_VARIANTS.length - 1)] : TEMPLATE_VARIANTS[0];
      if (repeated && mode === 'media-focus' && !slide.nodes.some(node => node.type === 'image'))
        throw new Error(`模板第 ${sourceIndex + 1} 页包含方向性图解或图表，且没有可安全变化的媒体，不能复用`);
      const roles = new Map(slotsFor(slide).map(slot => [slot.shapeId, slot.role]));
      const panelGeometry = mode === 'panel-swap' ? panelSwapGeometry(slide, externalPptx) : null;
      const reclaimedFrames = reclaimedMediaTextFrames(project, slide, externalPptx);
      if (mode === 'panel-swap' && !panelGeometry) throw new Error(`模板第 ${sourceIndex + 1} 页的卡片已不满足安全重排约束`);
      const mainImage = repeated ? slide.nodes.filter(node => node.type === 'image')
        .sort((a, b) => b.geometry.width * b.geometry.height - a.geometry.width * a.geometry.height)[0] : null;
      const media = mainImage && safeDecorativeMedia(mainImage, externalPptx, slide) && !textOverlayCalloutPanel(mainImage, externalPptx, slide)
        ? sourceMediaFor(project, index, use, mainImage) || semanticMediaForSlide(project, index, mainImage) : null;
      const mediaHash = media ? crypto.createHash('sha256').update(Buffer.from(media.dataUrl.split(',')[1], 'base64')).digest('hex') : null;
      const nodes = slide.nodes.map((base, nodeIndex) => {
        const node = { ...structuredClone(base), id: stableId('node', templateHash, index, base.nativeRef.shapeId),
          nativeRef: { ...base.nativeRef, slideIndex: index, sourceSlideIndex: sourceIndex } };
        if (repeated) node.geometry = panelGeometry?.[nodeIndex] || variantGeometry(node, mode, roles.get(base.nativeRef.shapeId), externalPptx);
        if (reclaimedFrames.has(base.nativeRef.shapeId)) {
          node.geometry = reclaimedFrames.get(base.nativeRef.shapeId);
          node.nativeTextFrame = { ...node.nativeTextFrame, wordWrap: true };
          node.content = { ...node.content, adaptiveMediaReclaim: true };
        }
        if (base.type === 'image' && repeated) {
          node.content = { ...node.content, crop: (base.content?.crop || [0, 0, 0, 0]).map((value, cropIndex) =>
            Math.min(.4, Math.max(0, Number(value || 0) + cropVariant.crop[cropIndex]))) };
          if (media && base.nativeRef.shapeId === mainImage.nativeRef.shapeId) node.content = {
            ...node.content, dataUrl: media.dataUrl, imageSha256: mediaHash, mediaReplacement: true,
            mediaSourceId: media.id || null, semanticVisual: media.kind || null, evidenceIds: media.evidenceIds || [], crop: [0, 0, 0, 0],
          };
        }
        return node;
      });
      if (project.inputProfile?.level === 'rich' || String(project.source?.text || '').length >= 8000)
        expandSafeDescriptions(nodes, externalPptx);
      const visualChanged = repeated && nodes.some((node, nodeIndex) => node.geometry.x !== slide.nodes[nodeIndex].geometry.x ||
        node.content?.imageSha256 !== slide.nodes[nodeIndex].content?.imageSha256 ||
        JSON.stringify(node.content?.crop) !== JSON.stringify(slide.nodes[nodeIndex].content?.crop));
      if (repeated && !visualChanged) throw new Error(`模板第 ${sourceIndex + 1} 页没有安全的媒体或布局变体`);
      return { index, sourceIndex, variantId: repeated ? `${mode}-${cropVariant.id}${media ? '-source-media' : ''}` : 'original',
        variant: { kind: mode, mediaShapeId: media ? mainImage.nativeRef.shapeId : null,
          mediaSourceId: media?.id || null, imageSha256: mediaHash },
        background: slide.nativeBackground, nodes, slots: slotsFor({ nodes }),
        shapeCount: nodes.length, imageCount: nodes.filter(node => node.type === 'image').length };
    });
  const finalProfiles = slides.map(slide => profileTemplateSlide(slide, externalPptx));
  const visualSimilarityPairs = finalProfiles.slice(1).map((profile, index) =>
    Number(visualSimilarity(finalProfiles[index], profile).toFixed(3)));
  return {
    componentProfile: templateComponentProfile(sourceSlides.map(slide=>({...slide,slots:slotsFor(slide)})), externalPptx, templateHash, templateMediaRole),
    mode: 'preserve', originalPath: externalPptx.originalPath, sha256: templateHash,
    width: externalPptx.width, height: externalPptx.height, originalSlideCount: originalCount, slideMap, layoutCatalog: catalog,
    ...(project.pages < originalCount || project.templateFidelity?.sourceCatalog
      ? { sourceCatalog: project.templateFidelity?.sourceCatalog || compactSourceCatalog(sourceSlides, slideMap) } : {}),
    reusePlan: { repeatedPages: Math.max(0, project.pages - originalCount), omittedSourcePages: Math.max(0, originalCount - new Set(slideMap).size),
      maxSourceUse: Math.max(...slideMap.map(source => slideMap.filter(value => value === source).length)),
      adjacentSameSource: 0, visualSimilarityPairs },
    slides,
  };
}

/** Rebind only the native page assignment after the outline is known. The
 * existing outline/content DAG and original template remain unchanged. */
export function rescheduleTemplateFidelity(project) {
  const fidelity = project.templateFidelity;
  if (fidelity?.mode !== 'preserve') return project;
  const sourceSlides = fidelity.sourceCatalog ? structuredClone(fidelity.sourceCatalog) : Array.from({ length: fidelity.originalSlideCount }, (_, sourceIndex) => {
    const slide = fidelity.slides.find(item => item.sourceIndex === sourceIndex);
    if (!slide) throw new Error(`template source slide ${sourceIndex + 1} missing`);
    return { nodes: slide.nodes, nativeBackground: slide.background };
  });
  if (fidelity.sourceCatalog) {
    const imageData = new Map();
    for (const outputSlide of fidelity.slides || []) for (const node of outputSlide.nodes || []) {
      const dataUrl = node.type === 'image' && !node.content?.mediaReplacement ? node.content?.dataUrl : null;
      const sourceIndex = node.nativeRef?.sourceSlideIndex ?? outputSlide.sourceIndex;
      const key = `${sourceIndex}:${node.nativeRef?.shapeId}`;
      if (typeof dataUrl === 'string' && Number.isInteger(sourceIndex) && !imageData.has(key)) imageData.set(key, dataUrl);
    }
    for (const [sourceIndex, slide] of sourceSlides.entries()) for (const node of slide.nodes || []) {
      if (node.type === 'image' && !node.content?.dataUrl) {
        const dataUrl = imageData.get(`${sourceIndex}:${node.nativeRef?.shapeId}`);
        if (dataUrl) node.content = { ...node.content, dataUrl };
      }
    }
  }
  const externalPptx = { originalPath: fidelity.originalPath, width: fidelity.width, height: fidelity.height };
  const richSource = project.inputProfile?.level === 'rich' || String(project.source?.text || '').length >= 8000;
  const profiles = sourceSlides.map(slide => profileSourceSlide(slide, externalPptx, richSource));
  const slideMap = planTemplateSlideMap(sourceSlides.length, project.pages, { profiles, outline: project.outline });
  project.templateFidelity = buildFidelity(project, sourceSlides, externalPptx, fidelity.sha256, profiles, slideMap);
  return project;
}

export async function prepareTemplateFidelity(project, templateBytes, templateHash, template = null, io = { importPptx: importEditablePptx, writeFile: files.writeFile }) {
  const templateStore = await import('./ppt-store.mjs');
  const owner = template?.kind === 'managed' ? 'managed' : project.uid;
  const cached = template && templateStore.readTemplateIR(owner, template.id, templateHash);
  if (cached?.parserVersion==='pptx-ir-4') {
    // Copy the opaque package for native export, never parse it again at runtime.
    const originalPath = await io.writeFile(project.id, 'template-original.pptx', Readable.from([templateBytes]), templateBytes.length, project.uid);
    if (typeof originalPath !== 'string' || !originalPath.startsWith('/')) throw new Error('template copy did not return a sandbox path');
    let imported = { ...cached.imported, externalPptx: { ...cached.imported.externalPptx, originalPath } };
    if(project.templateContentMode==='design_only') imported=templateDesignView(imported,new Set(imported.deck.slides.flatMap(slide=>contentMediaCandidates(slide,imported.externalPptx).map(node=>node.id))));
    project.templateCacheHit = true;
    return project.templateMode === 'mapped' ? {mode:'mapped',sha256:templateHash,componentProfile:templateComponentProfile(imported.deck.slides.map(slide=>({...slide,slots:slotsFor(slide)})),imported.externalPptx,templateHash,templateMediaRole)} : fidelityFromImported(project, imported, templateHash);
  }
  project.templateCacheHit = false;
  let imported = await io.importPptx({ id: project.id, uid: project.uid, title: project.title }, templateBytes, templateHash);
  if (template) templateStore.writeTemplateIR(owner, template.id, { schemaVersion: 1, parserVersion: 'pptx-ir-4', sha256: templateHash, imported });
  if(project.templateContentMode==='design_only') imported=templateDesignView(imported,new Set(imported.deck.slides.flatMap(slide=>contentMediaCandidates(slide,imported.externalPptx).map(node=>node.id))));
  return project.templateMode === 'mapped' ? {mode:'mapped',sha256:templateHash,componentProfile:templateComponentProfile(imported.deck.slides.map(slide=>({...slide,slots:slotsFor(slide)})),imported.externalPptx,templateHash,templateMediaRole)} : fidelityFromImported(project, imported, templateHash);
}

export function templateSlotPrompt(project, index) {
  const spec = project.templateFidelity?.slides?.[index];
  if (!spec) return '';
  const positions = new Map((spec.nodes || []).map(node => [node.nativeRef.shapeId, node.geometry]));
  const readingOrder = effectiveSlots(spec).filter(slot => slot.role !== 'static').sort((left, right) => {
    const a = positions.get(left.shapeId), b = positions.get(right.shapeId);
    return (a?.y || 0) - (b?.y || 0) || (a?.x || 0) - (b?.x || 0);
  });
  const media = contentMediaCandidates(spec, project.templateFidelity).map(node => ({ shapeId: node.nativeRef.shapeId,
    kind: 'source-content-image', widthRatio: Number((node.geometry.width / project.templateFidelity.width).toFixed(2)),
    heightRatio: Number((node.geometry.height / project.templateFidelity.height).toFixed(2)) }));
  const plan = project.planning?.slidePlan?.[index];
  return `\n模板第 ${index + 1} 页：独立内容组容量 ${plan?.templatePointCapacity || new Set(readingOrder.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose)).map(slot => slot.groupId)).size}，本页计划至少 ${plan?.templatePointTarget || '按来源可支撑的数量'} 组；内容型原图 ${JSON.stringify(media)}。文本槽位：${JSON.stringify(readingOrder.map((slot, order) => ({ id: String(slot.shapeId), readingOrder: order + 1, role: slot.role, purpose: slot.purpose, pairedWith: slot.pairedWith,
    groupId: slot.groupId,
    example: project.templateContentMode==='design_only' ? undefined : slot.example, minVisualUnits: slot.minVisualUnits, maxVisualUnits: slot.capacity,
    requiredItems: slot.purpose === 'list' ? slot.paragraphCount : undefined, maxLines: slot.maxLines, lineVisualUnits: slot.lineVisualUnits, wordWrap: slot.wordWrap,
    paragraphPatterns: slot.purpose === 'list' ? slot.paragraphs.map(item => ({ hasLabelRun: item.hasLabelRun, example: project.templateContentMode==='design_only' ? undefined : item.example })) : undefined })))}。` +
    '请在 JSON 中返回 slotTexts 对象，key 为上述槽位 id，value 为替换文字。标题与 title 字段一致，section 使用短标签。优先填入互不重复、由来源支持的独立事实；原模板槽位与本页主题不符或来源事实不足时，在 omitTemplateShapes 中列出该内容槽位、不适配图片、图表或表格的 shapeId 和至少八字的具体 reason，并省略其 slotTexts。配对的标题与说明须同时保留或同时省略。承载证据、品牌、流程关系或角色不明的媒体必须保留；不能因主题不同或与新文字相交而删掉。旧样例媒体只有明确角色与系统处置证据才可退役；普通文字和source ID不能证明等价。omission reason仅为请求，不能写批准记录。背景照片、图标及纯装饰可保留。不要以章节名、标题、focus 或首条要点循环填满所有槽位；不需要的媒体及其旧图解标签应一起省略。' +
    'purpose=group-heading 是一组卡片的导航标题，不是独立事实；写简短分组标签，不消耗本页独立要点。' +
    'purpose=list 的 value 必须是恰好 requiredItems 个对象的数组，每项为 {"label":"加粗短名称","body":"常规字重的来源支持说明"}；hasLabelRun 为 true 时两部分都要有内容。每条必须不同，合计行数不得超过 maxLines，每行不超过 lineVisualUnits。' +
    `富来源正文的可见目标为约 ${Math.ceil(visibleBodyTarget(readingOrder.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose)).reduce((sum, slot) => sum + slot.capacity, 0), project.planning?.slidePlan?.[index]?.depth))} visual units（封面、分节页除外）。不足时补充本页来源支持的解释，不能以重复、空话、删正文区域凑数。` +
    'wordWrap 禁止的单行槽位只能写一行；其他槽位也要按给定 maxLines 和 lineVisualUnits 控制长度。若存在 maxVisualUnits≥70 的正文槽位，优先用于来源中的完整机制、算例、适用条件和限制；不要只填一句概括，却把大量依据留在不可见的 factSynthesis。补充说明 footnote 用简短说明，不承担正文要点。' +
    '标题若承诺N类/种/方法，需在本页或同一来源表格的相关页面保留所有行名称；同语言使用来源规范名称，不能只呈现部分行却沿用完整数量。' +
    '先把本页来源整理成独立的事实单元，再把同一事实单元的短标题与说明填入配对槽位；相同 groupId 的卡片标题、列表或脚注必须共同解释一个小主题，列表中的每个名称和说明也必须对应同一事实。概念/机制与案例/演示步骤应分开展示并标注，不要把相邻章节的句子混入本页。不得用 Point A 等占位标签，不得按字符裁切原句；容量不足时改写成完整短句。' +
    '原生槽位模式下，slotTexts 是唯一槽位正文，代码由配对槽位和列表派生兼容内容块。来源结构替换模式下，sourceArtifacts 与 sourceCommentary 是可见正文，代码会省略被替换的content槽位；不要重复填入这些将被省略的正文槽位，标题及未替换的导航按slotTexts合同处理。上述槽位条目数与可见目标仅约束仍使用的槽位，不要求两套正文同时输出。若模板只容纳一到两条独立要点，将必要关系合并为简洁完整的解释，不能输出一份不可见长正文冒充已完成。无法容纳的必要细节交给审查并建议调整版式或页数。' +
    'point-heading 是短要点标题；与之配对的 point-description 必须用一到两句来源支持的完整说明解释该要点是什么、如何起作用或带来什么结果，不能只重复标题或填几个词；配对标题与正文应表达同一事实。label 是图示短标签，不强制扩写。' +
    '同一页如果既有列表又有卡片，列表只概括判断或步骤，卡片补充机制、例子或影响；不要把同一句完整说明复制到两处。每个 list 要有不同的信息职责，跨列表也不能循环相同的条目；同页不同槽位的短标签和完整解释不得重复。' +
    '中文、繁体中文或英文沿用本页所需语言，不编造来源缺失的事实。不要返回坐标、字号、图片或旧文稿中的无关事实。minVisualUnits 是解释目标，不用空话填补；每个槽位必须满足 maxVisualUnits，保持模板原字号。';
}

export function templateOutlinePrompt(project) {
  const slides = project.templateFidelity?.slides;
  if (!slides) return '';
  const selected = slides.length > 30 ? [...slides.slice(0, 12), ...slides.slice(-3)] : slides;
  const contracts = selected.map((slide) => ({ page: slide.index + 1,
    titleExample: slide.slots.find(slot => slot.role === 'title')?.example || '',
    pointGroups: new Set(effectiveSlots(slide).filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose))
      .map(slot => String(slot.groupId || slot.shapeId))).size,
    textSlots: effectiveSlots(slide).filter(slot => slot.role === 'content').map(slot => ({ purpose: slot.purpose,
      requiredItems: slot.purpose === 'list' ? slot.paragraphCount : undefined,
      maxLines: slot.maxLines, lineVisualUnits: slot.lineVisualUnits, maxVisualUnits: slot.capacity,
      example: project.templateContentMode==='design_only' ? undefined : slot.example.slice(0, 65) })),
    pictures: slide.imageCount, contentMediaShapeIds: contentMediaCandidates(slide, project.templateFidelity)
      .map(node => node.nativeRef.shapeId) }));
  const catalog = project.templateFidelity.layoutCatalog || [];
  return `\n模板保真约束：必须按已确认的 ${project.pages} 页及页面顺序安排内容。额外页面复用原生模板页；原图解与新主题无关且无法安全替换时，可在逐页写作阶段明确省略该媒体及关联旧标签。规划时参考每页独立内容组数、每组长度与示例语义，为有来源支撑的组安排不同机制、例子或条件；如果来源不足，换更适合的主题或明确标注缺口，不能用同义句凑满。内容型原图是待核对的旧主题证据，不能把它当作当前来源的图表。模板版式目录：${JSON.stringify(catalog)}。代表性页面结构：${JSON.stringify(contracts)}。原稿示例只说明槽位功能，不是本次来源事实。`;
}

export function inspectTemplateSlotDraft(project, index, slide) {
  const spec = project.templateFidelity?.slides?.[index];
  if (!spec) return [];
  const slots = effectiveSlots(spec);
  const omitted = new Set((slide.templateOmissions || []).map(item => String(item.shapeId)));
  const invalidOmissions = [...omitted].filter(id => !spec.nodes.some(node => String(node.nativeRef?.shapeId) === id &&
    (['image', 'chart', 'table'].includes(node.type) || (node.type === 'text' && slots.some(slot => String(slot.shapeId) === id && slot.role === 'content')) ||
      (node.content?.templateSample && project.templateContentMode==='design_only') ||
      (slide.sourceArtifactNodes?.length && slide.templateOmissions.some(o=>String(o.shapeId)===id && o.automatic && o.approvalBasis==='source_region_replacement')))));
  const omissionIssues = invalidOmissions.map(id => ({ code: 'template_omission_invalid', severity: 'error',
    message: `模板第 ${index + 1} 页组件 ${id} 不是可省略的内容或媒体`, repair: 'fill_template_slots', shapeId: Number(id) }));
  const issues = slots.filter(slot => slot.role !== 'static' && !omitted.has(String(slot.shapeId))).flatMap(slot => {
    const value = slot.role === 'title' ? slide.title : slot.role === 'section'
      ? (slide.section || slide.templateSlotTexts?.[String(slot.shapeId)]) : slide.templateSlotTexts?.[String(slot.shapeId)];
    if (slot.purpose === 'list') return inspectListSlot(slot, value, index);
    const used = visualUnits(value);
    if (incompletePhrase(value)) return [{ code: 'template_text_fragment', severity: 'error',
      message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} 停在句中，需写完整短句或短标签`, repair: 'fill_template_slots', shapeId: slot.shapeId }];
    const heading = slot.pairedWith ? slide.templateSlotTexts?.[String(slot.pairedWith)] : '';
    if (slot.pairedWith && explanationRepeatsHeading(heading, value)) return [{ code: 'template_description_repeats_heading', severity: 'error',
      message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} 重复要点标题，应补充解释`, repair: 'fill_template_slots', shapeId: slot.shapeId }];
    if (used > 0 && used <= slot.capacity && (!slot.minVisualUnits || used >= slot.minVisualUnits)) return [];
    const code = !used ? 'template_slot_unfilled' : used > slot.capacity ? 'template_slot_overflow' : 'template_description_too_short';
    return [{ code, severity: 'error',
      message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} ${!used ? '必须填写' : used > slot.capacity ? `需要缩短至 ${slot.capacity} visual units` : `说明应达到至少 ${slot.minVisualUnits} visual units，并解释对应要点`}`,
      repair: 'fill_template_slots', shapeId: slot.shapeId, slotRole: slot.role, capacity: slot.capacity, minVisualUnits: slot.minVisualUnits }];
  });
  issues.push(...omissionIssues);
  if(index===0&&!slots.some(slot=>slot.role==='content'&&slot.purpose!=='footnote')&&
    slide.sourceArtifactNodes?.some(node=>node.semanticRole==='source-explanation')&&
    !slide.sourceArtifactNodes.some(node=>node.sourceArtifact))issues.push({code:'template_cover_body',severity:'error',repair:'fill_template_slots',
      message:'原生封面只有标题/导航槽位，未规划正文区域；不能用来源解释覆盖封面装饰与标题。保留主题标题，移除重复背景说明；不得删除任何锁定来源结构。'});
  // Body slots have been explicitly replaced and checked by source-owned layout.
  // Title, section, retained slots and omission authorization still apply.
  if (slide.sourceArtifactNodes?.length) return issues;
  const groups = new Map();
  for (const slot of slots.filter(item => item.role === 'content' && !['footnote', 'group-heading'].includes(item.purpose))) {
    const id = String(slot.groupId || slot.pairedWith || slot.shapeId);
    groups.set(id, [...(groups.get(id) || []), slot]);
  }
  let activeGroups = 0;
  for (const group of groups.values()) {
    const retained = group.filter(slot => !omitted.has(String(slot.shapeId)));
    if (retained.length) activeGroups++;
    if (retained.length && retained.length !== group.length) issues.push({ code: 'template_point_group_partial', severity: 'error',
      message: `模板第 ${index + 1} 页同一要点的标题和说明只保留了一部分`, repair: 'fill_template_slots',
      shapeIds: group.map(slot => slot.shapeId) });
  }
  const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
  const richSource = project.inputProfile?.level === 'rich' || String(project.source?.text || '').length >= 8000;
  if (richSource && contract?.role !== 'section' && index > 0 && index < (project.pages || project.outline?.length || Infinity) - 1) {
    const activeContentSlots = slots.filter(item => item.role === 'content' && !['footnote', 'group-heading'].includes(item.purpose) && !omitted.has(String(item.shapeId)));
    // Omitting body slots cannot lower the page's planned information target.
    const available = slots.filter(item => item.role === 'content' && !['footnote', 'group-heading'].includes(item.purpose))
      .reduce((sum, item) => sum + Number(item.capacity || 0), 0);
    const visible = visualUnits(visibleSlotText(slide, activeContentSlots));
    const target = visibleBodyTarget(available, contract?.depth);
    const sourceBoundMedia = spec.nodes.some(node => node.content?.mediaReplacement);
    if (!sourceBoundMedia && available >= 130 && visible < target) issues.push({
      code: 'template_copy_sparse', severity: 'error',
      message: `模板第 ${index + 1} 页可见正文约 ${Math.ceil(visible)} visual units，低于富来源页面的有效信息目标；使用可用正文空间补充不同的机制、条件或例子`,
      repair: 'fill_template_slots', visibleUnits: visible, availableUnits: available, minVisualUnits: Math.ceil(target) });
    for (const slot of slots.filter(item => item.role === 'content' && item.purpose === 'body' && item.capacity >= 70 && !omitted.has(String(item.shapeId)))) {
      const used = visualUnits(slide.templateSlotTexts?.[String(slot.shapeId)]);
      const minimum = Math.min(110, Math.ceil(slot.capacity * .4));
      if (used > 0 && used < minimum) issues.push({ code: 'template_body_underused', severity: 'error',
        message: `模板第 ${index + 1} 页正文槽位 ${slot.shapeId} 可容纳约 ${slot.capacity} visual units，仅使用 ${Math.ceil(used)}；请从本页来源补充机制、条件或例子，或将该区域明确省略`,
        repair: 'fill_template_slots', shapeId: slot.shapeId, capacity: slot.capacity, minVisualUnits: minimum });
    }
  }
  const target = Math.min(groups.size, Number(contract?.templatePointTarget || 0));
  if (target && activeGroups < target) issues.push({ code: 'template_point_coverage', severity: 'error',
    message: `模板第 ${index + 1} 页计划 ${target} 组独立内容，目前只有 ${activeGroups} 组；应补足来源支持的要点或调整规划`,
    repair: 'fill_template_slots', expectedGroups: target, activeGroups });
  const seen = new Map();
  for (const slot of slots.filter(item => ['title', 'section'].includes(item.role))) {
    const value = slot.role === 'title' ? slide.title : slide.section || slide.templateSlotTexts?.[String(slot.shapeId)];
    const key = comparable(value);
    if (key.length < 4) continue;
    const prior = seen.get(key);
    if (prior) issues.push({ code: 'template_slot_duplicate', severity: 'error',
      message: `模板第 ${index + 1} 页标题、章节标签或内容槽位重复，应分别表达不同信息`,
      repair: 'fill_template_slots', shapeId: slot.shapeId, duplicateOf: prior.shapeId });
    else seen.set(key, slot);
  }
  for (const slot of slots) {
    if (['static', 'title', 'section'].includes(slot.role) || omitted.has(String(slot.shapeId))) continue;
    const raw = slide.templateSlotTexts?.[String(slot.shapeId)];
    const values = slot.purpose === 'list' ? (slotParagraphs(raw) || []).flatMap(item => [item.label, item.body]) : [raw];
    for (const value of values) {
      const key = comparable(value);
      if (key.length < 2) continue;
      const prior = seen.get(key);
      if (prior && prior.shapeId !== slot.shapeId) issues.push({ code: 'template_slot_duplicate', severity: 'error',
        message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} 与 ${prior.shapeId} 重复相同可见内容，应分别表达不同事实或省略多余槽位`,
        repair: 'fill_template_slots', shapeId: slot.shapeId, duplicateOf: prior.shapeId });
      else seen.set(key, slot);
    }
  }
  issues.push(...contentCoverageIssues(project, slide, slots.filter(slot => !omitted.has(String(slot.shapeId))), index));
  return issues;
}

function ordinalReadingOrder(nodes, size) {
  const numbered = nodes.filter(node => node.type === 'text' && /^0?[1-9]\d?$/.test(String(node.content?.text || '').trim()));
  const values = numbered.map(node => Number(node.content.text));
  if (numbered.length < 3 || new Set(values).size !== numbered.length ||
      !values.every(value => value >= 1 && value <= numbered.length)) return new Map();
  numbered.sort((a, b) => Math.abs(a.geometry.y - b.geometry.y) < size.height * .08
    ? a.geometry.x - b.geometry.x : a.geometry.y - b.geometry.y);
  return new Map(numbered.map((node, index) => [node.nativeRef.shapeId,
    /^0\d/.test(String(node.content.text).trim()) ? String(index + 1).padStart(2, '0') : String(index + 1)]));
}

export function bindTemplateFidelity(project) {
  if (project.templateFidelity?.mode !== 'preserve') {
    bindMappedTemplateMedia(project);
    for(const slide of project.deck?.slides||[]) {
      const contract=project.planning?.slidePlan?.find(x=>x.slideId===slide.id)?.pageContract;
      if(!slide.componentPrepared&&!slide.locked&&contract?.compositionCandidates?.includes('formula-variables')&&slide.nodes.filter(x=>x.sourceArtifact).length===1&&slide.nodes.some(x=>x.content?.mathMl||x.content?.latex))slide.layoutId=slide.layoutRef='formula-variables';
      if(!slide.componentPrepared&&!slide.locked&&contract?.compositionCandidates?.includes('two-panel')&&slide.nodes?.filter(x=>x.sourceArtifact).length===2)slide.layoutId=slide.layoutRef='two-panel';
      prepareComponentGeometry(project,slide);
    }
    return project;
  }
  if (project.deck?.slides?.length !== project.templateFidelity.slides.length) throw new Error('template slide count mismatch');
  project.deck.slides.forEach((slide, index) => {
    const source = project.templateFidelity.slides[index];
    const ordinals = ordinalReadingOrder(source.nodes, project.templateFidelity);
    const slotById = new Map(effectiveSlots(source).map(slot => [String(slot.shapeId), slot]));
    const provided = slide.templateSlotTexts || {};
    slide.templateOmissions=[...(slide.templateOmissions || []),...autoTemplateMediaOmissions(project,index,slide.templateOmissions || [])];
    const omitted = new Set((slide.templateOmissions || []).map(item => String(item.shapeId)));
    const priorNodes=new Map((slide.nodes || []).filter(node=>node.nativeRef).map(node=>[node.id,node]));
    const native = source.nodes.filter(base => !omitted.has(String(base.nativeRef?.shapeId))).map(base => {
      const node = structuredClone(base);
      if (ordinals.has(node.nativeRef?.shapeId)) node.content = { ...node.content, text: ordinals.get(node.nativeRef.shapeId) };
      const slot = slotById.get(String(node.nativeRef?.shapeId));
      if (slot && slot.role !== 'static') {
        let text = provided[String(slot.shapeId)];
        if (slot.role === 'title') text = slide.title;
        if (slot.role === 'section') text = slide.section || text;
        const paragraphs = slot.purpose === 'list' ? slotParagraphs(text) : null;
        node.content = { ...node.content, text: paragraphs ? paragraphs.map(item => [item.label, item.body].filter(Boolean).join('：')).join('\n') : typeof text === 'string' ? text.trim() : '',
          templateFit: Boolean(node.nativeTextFrame), ...(paragraphs ? { paragraphs } : {}) };
        if (node.nativeTextFrame?.paragraphs) for (const paragraph of node.nativeTextFrame.paragraphs) {
          if (Number(paragraph.lineSpacing) > 0 && Number(paragraph.lineSpacing) < 1.15) paragraph.lineSpacing = 1.15;
        }
        node.semanticRole = slot.role === 'title' ? 'template-title' : 'template-text';
        node.locked = false;
        node.templateSlot = { role: slot.role, purpose: slot.purpose, pairedWith: slot.pairedWith, groupId: slot.groupId,
          minVisualUnits: slot.minVisualUnits, capacity: slot.capacity,
          mapped: paragraphs ? paragraphs.length === slot.paragraphCount && paragraphs.every(item => item.body) : typeof text === 'string' && Boolean(text.trim()) };
        if(node.content.text && node.geometry){
          const element={...node,kind:'text',bounds:node.geometry};
          const contract=textContract(element), measured=measureText(element,contract);
          const height=Math.ceil((measured.estimatedHeightPt*1.2+contract.margins[1]+contract.margins[3])*PT_EMU);
          // PowerPoint often lets glyphs overflow a short template shape; the
          // browser clips to the shape. Give generated copy its actual line box.
          if(height>node.geometry.height && node.geometry.y+height<=project.templateFidelity.height)
            node.geometry={...node.geometry,height};
        }
      }
      const prior=priorNodes.get(node.id);
      if(prior?.userStyle){node.style=structuredClone(prior.style);node.textStyleOverrides=prior.textStyleOverrides;node.userStyle=true;}
      if(prior?.userGeometry){node.geometry=structuredClone(prior.geometry);node.userGeometry=true;}
      if(prior?.locked && node.type==='text')node.locked=true;
      return node;
    });
    slide.templateSlideIndex = index;
    slide.templateShapeCount = source.shapeCount - omitted.size;
    slide.templateImageCount = source.imageCount - source.nodes.filter(node => omitted.has(String(node.nativeRef?.shapeId)) && node.type === 'image').length;
    slide.nodes = slide.nodes.filter(node => !node.nativeRef).map(node => isSourceOwnedNode(node) ? node : {...node,hidden:true});
    slide.nodes.push(...native);
    slide.nodeOrder = slide.nodes.map(node => node.id);
  });
  return project;
}

export async function renderTemplatePptx(project,io={}) {
  if (project.templateFidelity?.mode !== 'preserve') throw new Error('template fidelity is unavailable');
  const copy = { ...project, externalPptx: { originalPath: project.templateFidelity.originalPath },
    templateSlideMap: project.templateFidelity.slideMap,
    deck: { ...project.deck, slides: project.deck.slides.map(slide => ({ ...slide, nativeSlideIndex: slide.templateSlideIndex })) } };
  return renderImportedPptx(copy,io);
}

export function inspectTemplateFidelity(project) {
  if (project.templateFidelity?.mode !== 'preserve') return [];
  const issues = [];
  const variantKeys = new Set();
  const dominantMediaPages = new Map();
  project.deck?.slides?.forEach((slide, index) => {
    const source = project.templateFidelity.slides[index];
    const native = slide.nodes.filter(node => node.nativeRef?.slideIndex === index);
    const omitted = new Set((slide.templateOmissions || []).map(item => String(item.shapeId)));
    const omittedImages = source?.nodes?.filter(node => omitted.has(String(node.nativeRef?.shapeId)) && node.type === 'image').length || 0;
    if (!source || native.length + omitted.size !== source.shapeCount || native.filter(node => node.type === 'image').length + omittedImages !== source.imageCount ||
      [...omitted].some(id => !source.nodes.some(node => String(node.nativeRef?.shapeId) === id))) {
      issues.push({ code: 'template_asset_loss', severity: 'error', message: '模板图片或组件丢失', slideId: slide.id, repairable: false });
      return;
    }
    const dominant = native.filter(node => node.type === 'image').sort((a, b) =>
      b.geometry.width * b.geometry.height - a.geometry.width * a.geometry.height)[0];
    const dominantArea = dominant ? dominant.geometry.width * dominant.geometry.height /
      (project.templateFidelity.width * project.templateFidelity.height) : 0;
    const layeredDiagram = dominant && native.filter(node => node.type === 'image' &&
      Math.abs(node.geometry.width - dominant.geometry.width) < .03 * project.templateFidelity.width &&
      Math.abs(node.geometry.height - dominant.geometry.height) < .03 * project.templateFidelity.height &&
      Math.abs(node.geometry.x - dominant.geometry.x) < .03 * project.templateFidelity.width &&
      Math.abs(node.geometry.y - dominant.geometry.y) < .03 * project.templateFidelity.height).length >= 3 &&
      native.filter(node => node.type === 'text' && node.templateSlot?.mapped && node.templateSlot.role === 'content').length >= 3;
    if (dominantArea >= .25 && dominant?.content?.imageSha256 && !layeredDiagram &&
        !safeDecorativeMedia(dominant, project.templateFidelity, { nodes: native })) {
      const imageHash = dominant.content.imageSha256;
      dominantMediaPages.set(imageHash, [...(dominantMediaPages.get(imageHash) || []), index + 1]);
      const visual = project.outline?.[index]?.visualIntent?.type || project.outline?.[index]?.visual_intent?.type || '';
      if (['metric', 'chart', 'table', 'pipeline', 'process'].includes(visual) && !dominant.content.mediaReplacement)
        issues.push({ code: 'template_semantic_media_mismatch', severity: 'warning',
          message: `第 ${index + 1} 页需要 ${visual} 图解，但大面积原模板媒体未能安全替换；建议改用匹配版式或提供来源图`,
          slideId: slide.id, repairable: false });
    }
    if (source.variant && source.variant.kind !== 'original') {
      const variantKey = `${source.sourceIndex}:${source.variantId}`;
      if (variantKeys.has(variantKey)) issues.push({ code: 'template_variant_duplicate', severity: 'error',
        message: `模板第 ${index + 1} 页重复使用同一原生版式和媒体变体`, slideId: slide.id, repairable: false });
      variantKeys.add(variantKey);
      const original = project.templateFidelity.slides.find((item, originalIndex) => originalIndex < index && item.sourceIndex === source.sourceIndex);
      const originalShapes = new Map((original?.nodes || []).map(node => [node.nativeRef.shapeId, node]));
      const retainedShapes = new Set(native.map(node => node.nativeRef.shapeId));
      const removedComponent = [...originalShapes.keys()].some(shapeId => !retainedShapes.has(shapeId) &&
        (slide.templateOmissions || []).some(item => String(item.shapeId) === String(shapeId)));
      const visualChanged = removedComponent || native.some(node => {
        const base = originalShapes.get(node.nativeRef.shapeId);
        return base && (node.geometry.x !== base.geometry.x || node.geometry.y !== base.geometry.y ||
          node.geometry.width !== base.geometry.width || node.geometry.height !== base.geometry.height ||
          node.content?.imageSha256 !== base.content?.imageSha256 ||
          JSON.stringify(node.content?.crop) !== JSON.stringify(base.content?.crop));
      });
      if (!original || !visualChanged) issues.push({ code: 'template_variant_unchanged', severity: 'error',
        message: `模板第 ${index + 1} 页复用了原版式，但媒体与布局均未改变`, slideId: slide.id, repairable: false });
      if (source.variant.mediaShapeId) {
        const mediaNode = native.find(node => node.nativeRef.shapeId === source.variant.mediaShapeId);
        if (!mediaNode?.content?.mediaReplacement || mediaNode.content.imageSha256 !== source.variant.imageSha256)
          issues.push({ code: 'template_variant_media', severity: 'error', message: `模板第 ${index + 1} 页替换媒体与变体记录不符`, slideId: slide.id, repairable: false });
      }
    }
    for (const slot of effectiveSlots(source).filter(item => item.role !== 'static' && !omitted.has(String(item.shapeId)))) {
      const node = native.find(item => item.nativeRef.shapeId === slot.shapeId);
      if (slot.purpose === 'list') {
        issues.push(...inspectListSlot(slot, node?.content?.paragraphs, index).map(item => ({ ...item, slideId: slide.id, repairable: false })));
        continue;
      }
      if (!node?.templateSlot?.mapped || !String(node.content?.text || '').trim()) issues.push({ code: 'template_slot_unfilled', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 未填写`, slideId: slide.id, repairable: false });
      else if (incompletePhrase(node.content.text)) issues.push({ code: 'template_text_fragment', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 停在句中`, slideId: slide.id, repairable: false });
      else if (visualUnits(node.content.text) > slot.capacity) issues.push({ code: 'template_slot_overflow', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 超过容量`, slideId: slide.id, repairable: false });
      else if (slot.minVisualUnits && visualUnits(node.content.text) < slot.minVisualUnits) issues.push({ code: 'template_description_too_short', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 的要点说明过短`, slideId: slide.id, repairable: false });
      else if (slot.pairedWith && explanationRepeatsHeading(native.find(item => item.nativeRef.shapeId === slot.pairedWith)?.content?.text, node.content.text)) issues.push({ code: 'template_description_repeats_heading', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 重复要点标题`, slideId: slide.id, repairable: false });
    }
    issues.push(...contentCoverageIssues(project, slide, effectiveSlots(source).filter(slot => !omitted.has(String(slot.shapeId))), index).map(item => ({ ...item, slideId: slide.id, repairable: false })));
    issues.push(...inspectTemplateSlotDraft(project, index, slide).filter(item => ['template_slot_duplicate', 'template_omission_invalid', 'template_body_underused', 'template_copy_sparse'].includes(item.code))
      .map(item => ({ ...item, slideId: slide.id, repairable: false })));
  });
  for (const pages of dominantMediaPages.values()) if (pages.length > 3)
    issues.push({ code: 'template_dominant_media_reuse', severity: 'warning',
      message: `同一张大面积模板媒体出现在 ${pages.length} 页（${pages.join('、')}）；模板保真优先时请审查视觉重复`,
      slideId: null, repairable: false, pages });
  return issues;
}

export const _internals = { slotsFor, visualUnits, profileSourceSlide, panelSwapGeometry, ordinalReadingOrder, expandSafeDescriptions, reclaimedMediaTextFrames, safeDecorativeMedia, textOverlayCalloutPanel };
