import {retireUnboundContainers} from './ppt-component-regions.mjs';
import {pictureCertificate} from './ppt-template-picture-read.mjs';
import {layoutPictureCatalog,layoutPictureFor,layoutPictureActions,applyLayoutPicture} from './ppt-layout-pictures.mjs';
import {applyContentSlotPictures} from './ppt-content-slot-pictures.mjs';
import {applyFillPictures} from './ppt-template-fill-bind.mjs';
import {assemblyParts} from './ppt-template-assemblies.mjs';
import {applyChromeFallback} from './ppt-chrome-slots.mjs';
import {applyUsedTemplatePalette} from './ppt-template-palette.mjs';
import {layoutReuseCap} from './ppt-deck-media-metrics.mjs';
import {templateLeak} from './ppt-template-leak.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {bindTitleHierarchy,bindCardLead} from './ppt-title-hierarchy.mjs';
import {closingTemplateOmissions} from './ppt-closing-page.mjs';
import {classifyTemplatePage,headerFrameReason} from './ppt-template-roles.mjs';
import {inspectOutlineTopicLanguages,topicRangeConstraint,topicLanguageMismatch}from './ppt-topic-title-validation.mjs';
import {PPTX_IR_VERSION} from './ppt-native-shape-ids.mjs';
import {deckLanguage,deckLanguageName,pageTopicLanguage} from './ppt-presentation-contract.mjs';
import { isSourceOwnedNode } from './ppt-source-artifacts.mjs';
import { templateDesignView, isOrdinalSequence } from './ppt-template-design.mjs';
import {fitNativeTitleFrames,fitNativeTextFrames} from './ppt-native-text-fit.mjs';
import {bindNotesDisclosures}from './ppt-notes-disclosure.mjs';
import {regionArtwork} from './ppt-media-preserving-layout.mjs';
import {contentCanvas,measureComponent} from './ppt-density-capacity.mjs';
import {displayedDocumentTitle,inspectCoverTitle} from './ppt-deck-coherence.mjs';
import {nativeCoverTitleHierarchy} from './ppt-cover-title-contract.mjs';
import {measureText} from './ppt/render-contract.mjs';
import {sectionFitsFrame,fitHeaderPills} from './ppt-header-pills.mjs';
import {readableWrittenText} from './ppt-text-contrast.mjs';
import {templateTextColor} from './ppt-template-colors.mjs';
import {normalizeDeckEyebrows} from './ppt-section-eyebrow.mjs';
import {ensureRichContent,sourceRichText,richTextContent} from './ppt-source-text.mjs';
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
import { stableId, removeNativeTitleAlias } from './ppt/ir.mjs';
import { planTemplateSlideMap, profileTemplateSlide, visualSimilarity, catalogTemplateLayouts, TEMPLATE_VARIANTS } from './ppt-template-scheduler.mjs';
import { semanticMediaForSlide } from './ppt-semantic-media.mjs';
import { visibleBodyTarget, templateVisualUnits, normalizeTypography } from './ppt-presentation-writing.mjs';

// Native nodes are JSON records. Copy every mutable container while retaining
// immutable string leaves (notably multi-megabyte template images). structuredClone
// recopied those bytes for every layout candidate and monopolized the event loop.
function cloneTemplateValue(value) {
  if (Array.isArray(value)) return value.map(cloneTemplateValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneTemplateValue(child)]));
  return value;
}
const visualUnits = templateVisualUnits;
const numericLabel = value => /^\s*(?:\d{1,2}|[IVX]{1,4})\s*$/i.test(value || '');
const numericMetric = value => /^\s*[+-]?\d+(?:[.,]\d+)?\s*%\s*$/u.test(value || '');
const INCH = 914400;
const comparable = value => String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const formulaKey = value => String(value || '').replace(/[`\s]/g, '').toLocaleLowerCase();
const emuToPt = value => Number(value || 0) * 72 / INCH;
const FRAGMENT_END = /(?:\b(?:a|an|the|and|or|of|to|for|with|by|in|on|at|from|that|which|when|because|while|including|without|versus|then|about|during|into|under|before|after|through|is|are|was|were|has|have|per)|[&/,:;，、：；（(\-–—]|[，、；]\s*(?:與|与|和|或|把|将|將|对|對|在|由|从|從))\s*$/iu;
export function incompletePhrase(value) {
  const text = String(value || '').trim().replace(/[.!?。！？]+$/u, '').trim();
  if (!text) return false;
  if (/(?:^|\s)[A-Z][A-Z0-9]*\/[A-Z][A-Z0-9]*$/u.test(text)) return false;
  // A capital letter naming a variant ("Plan A", "view A") is a label, not the article.
  if (/\s[A-Z]$/u.test(text)) return false;
  // Relative-clause headings may legitimately strand a preposition:
  // "Costs you're signing up for" / "Risks we are exposed to".
  // This does not exempt incomplete body phrases such as "Keep history for".
  if (/^.+\s(?:you|we|they|he|she|it|I)(?:['’](?:re|ve|d|ll)|\s+(?:are|is|have|will|were))\b.+\b(?:for|with|on|at|of|to)$/iu.test(text)) return false;
  // A complete sentence may end with a phrasal verb's particle, in any verb
  // form: "... it smuggles in." (3143, 8f49c688) or "... does it smuggle in?"
  // (7611ae64). An unpunctuated or short phrase such as "Keep history for"
  // remains a fragment, and the particle must follow a word.
  if (/[.!?。！？]\s*$/u.test(String(value).trim()) && text.split(/\s+/).length >= 5 && /\b[a-z]{3,}\s+(?:in|on|through|about)$/iu.test(text)) return false;
  return FRAGMENT_END.test(text) || (text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length ||
    (text.match(/（/g) || []).length > (text.match(/）/g) || []).length;
}

const lockedOutlineTitle = (project, index, slot, value) => slot.role === 'title' && String(value || '').trim() === String(project.outline?.[index]?.title || '').trim();

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

function detailEvidenceText(project,slide,visible){
  const outline=project.outline?.find(item=>item.id===slide.id);
  const base=title=>String(title||'').replace(/[（(]续\s*\d+[）)]$/u,'').trim();
  if(!outline?.groupId)return `${slide.title||''} ${visible}`;
  const siblings=new Set(project.outline.filter(item=>item.groupId===outline.groupId&&base(item.title)===base(outline.title)).map(item=>item.id));
  return (project.deck?.slides||[]).filter(item=>siblings.has(item.id)).map(item=>`${item.title||''} ${visibleSlideText(item)}`).join(' ')||`${slide.title||''} ${visible}`;
}
function boundBilingualListPresent(project,slide,detail){
  const match=String(detail).match(/^(\d+)条清单完整呈现，保留中英双语$/u);if(!match)return false;
  const count=Number(match[1]),inventory=project.source?.semantic?.inventory?.items||[];
  const lists=(slide.nodes||[]).filter(node=>node.type==='list'&&node.sourceArtifact?.sourceUnitId&&node.content?.items?.length===count&&
    inventory.some(item=>item.id===node.sourceArtifact.sourceUnitId&&(item.items?.length||String(item.text||'').split('\n').filter(line=>/^\s*[-*]\s+/u.test(line)).length)===count));
  return lists.some(node=>node.content.items.every(item=>/[A-Za-z]/u.test(item.text)))&&lists.some(node=>node.content.items.every(item=>/[\u3400-\u9fff]/u.test(item.text)));
}
function contentCoverageIssues(project, slide, slots, index) {
  // A planned card page (no objects) shows its card points, shortened into the
  // slots by plan; the card-point check covers it, not the writer's own blocks
  // (3143, d27276ed: every block failed the 82% overlap on shortened slots).
  const page = project.outline?.[index];
  if (cardsFlow(project) && Array.isArray(page?.cardObjects) && !page.cardObjects.length && page.keyPoints?.length) return [];
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
    // A metadata sentence may describe several equations, definitions and
    // conditions. Only a standalone equation has a verbatim equation contract;
    // source-object integrity and the semantic obligation audit still validate
    // all formulas and conditions in a compound prose requirement.
    const formula = !/[\u3400-\u9fff；;。]/u.test(detail)&&/^\s*[A-Za-z_][^=]*=[^=]+$/u.test(detail);
    const evidence=detailEvidenceText(project,slide,visible);
    const coverage = boundBilingualListPresent(project,slide,detail)?1:formula ? Number(formulaKey(evidence).includes(formulaKey(detail)))
      : copyCoverage(detail, evidence);
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

// The full-string check runs once per image, not once per page per schedule:
// it was half of the outline's CPU time and blocked the server for ~25 s on
// World Models (2026-10-31, 29 figures × 25 pages × each reschedule).
const placeableImages = new WeakMap();
function placeableImage(image) {
  const dataUrl = image?.dataUrl || '', known = image && typeof image === 'object' ? placeableImages.get(image) : undefined;
  if (known?.dataUrl === dataUrl) return known.ok;
  const ok = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl);
  if (image && typeof image === 'object') placeableImages.set(image, { dataUrl, ok });
  return ok;
}

function sourceMediaFor(project, index, use, frame) {
  const images = (project.source?.images || []).filter(placeableImage);
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

// The lowered source and each template slide's affinity are computed once
// per source text (live mlq-r36: recomputed per page per schedule, 52 s).
let loweredSource = { text: null, lower: '' };
const affinityCache = new WeakMap();
function templateSourceAffinity(project, spec) {
  const text = String(project.source?.text || '');
  const cached = spec && affinityCache.get(spec);
  if (cached?.text === text) return cached.value;
  if (loweredSource.text !== text) loweredSource = { text, lower: text.toLocaleLowerCase() };
  const value = sourceAffinity(loweredSource.lower, spec);
  if (spec) affinityCache.set(spec, { text, value });
  return value;
}
function sourceAffinity(source, spec) {
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
  const designReuse=['design_only','keep_fixed'].includes(project.templateContentMode);
  if (!spec || !designReuse && (!project.source?.text || templateSourceAffinity(project, spec) >= .38)) return [];
  const already = new Set([...existing.map(item => String(item.shapeId)), ...(keptAssembly?.(project, index) || [])]);
  return (designReuse ? spec.nodes : contentMediaCandidates(spec, project.templateFidelity)).filter(node =>
    node.content?.mediaRole==='old_template_content' && !node.content?.mustPreserve &&
    !node.content?.mediaReplacement && !already.has(String(node.nativeRef?.shapeId)))
    .map(node => adaptationDisposition(project,node,'old_template_content',designReuse?'design_only_template':'deterministic_topic_mismatch',designReuse?'Design reuse retires unselected original report media; explicitly selected fixed objects and current source evidence are preserved.':'Explicit old sample media is retired after deterministic topic mismatch; no user approval or equivalent replacement is claimed.'));
}

export function templateMediaRole(node,spec,size){
  const declared=node.content?.mediaRole||node.content?.role;
  if(declared)return declared;
  // A content-bearing caption is not decoration. Unknown assets must survive
  // unless an explicit user decision or verified equivalent accounts for them.
  if(node.content?.caption?.trim()||node.content?.altText?.trim())return 'unknown';
  // A photo or painting the readers certified free of text, charts and UI is
  // the template's style, kept as decoration (2026-11-02; was retired as old
  // content whenever no OCR program was installed).
  if(pictureCertificate(node.content))return 'template_decoration';
  // Pixel verification proves this asset has no internal diagram/text. Native
  // content frames prove its purpose is a card background. Geometry alone or
  // an empty colour sample is never enough to retire an arbitrary image.
  if(node.content?.monochromePanel === true && !node.content?.mustPreserve && size){
    const g=node.geometry,area=g.width*g.height/(size.width*size.height);
    const labels=(spec?.nodes||[]).filter(n=>n.type==='text'&&n.content?.text?.trim()&&n.geometry.x>=g.x&&n.geometry.y>=g.y&&n.geometry.x+n.geometry.width<=g.x+g.width&&n.geometry.y+n.geometry.height<=g.y+g.height);
    if(area>=.015&&area<=.2&&(labels.length>=2||node.content.panelColor&&labels.length>=1))return 'template_decoration';
  }
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

export function slotsFor(slide) {
  const text = slide.nodes.filter(node => node.type === 'text' && node.content?.text?.trim());
  const ordinalIds=isOrdinalSequence(slide.nodes);
  // Percent values are often sample metrics in template decks. Keep them
  // editable and prevent the largest percentage from being mistaken for the
  // page title (for example, a decorative "35%" callout).
  // Text the user keeps as fixed template content (brand) is never a slot (main 9e0351cd).
  const candidates = text.filter(node => node.content?.mediaRole!=='brand' && !numericLabel(node.content.text) && !numericMetric(node.content.text));
  const title = candidates.find(node=>node.semanticRole==='title') || [...candidates].sort((a, b) => {
    const score = node => Number(node.style?.fontSizePt || 14) * Math.min(2, node.geometry.width / 3_000_000);
    return score(b) - score(a);
  })[0];
  const section = [...candidates].filter(node => node.id !== title?.id && node.geometry.y < (title?.geometry.y ?? 0))
    .sort((a, b) => a.geometry.y - b.geometry.y)[0];
  const slots = text.map(node => {
    const original = node.content.text;
    const role = node.content?.mediaRole==='brand' || numericLabel(original)&&ordinalIds.has(node.id) ? 'static' : node.id === title?.id ? 'title' : node.id === section?.id ? 'section' : 'content';
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
  profile.semantic = { pageRole:classifyTemplatePage({...prepared,slots},size),contentSlots: content.length, listItems,
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
  // 'original' (every repeat under generation policy v2) keeps the layout as
  // designed. It used to fall through to the mirror without the overlap check:
  // 3143, 0395f2aa page 10 put a tall side image under the unmoved title.
  if (mode === 'original' || mode === 'media-focus' || mode==='fixed-content-preserved' || isFullBleed(node, size)) return node.geometry;
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

function inspectListSlot(slot, value, index, {balanced=false}={}) {
  const paragraphs = slotParagraphs(value);
  const error = (code, message) => ({ code, severity: 'error', message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} ${message}`,
    repair: 'fill_template_slots', shapeId: slot.shapeId, requiredItems: slot.paragraphCount });
  // A balanced list may hold fewer items than its sample paragraphs; the export removes the rest (Fable D2).
  if (!paragraphs || !paragraphs.length || paragraphs.length > slot.paragraphCount || !balanced && paragraphs.length !== slot.paragraphCount) return [error('template_point_count', `需要 ${slot.paragraphCount} 条不同的要点`)];
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

function compactSourceCatalog(sourceSlides) {
  // Storage already deduplicates data URLs by hash. Removing the only catalog
  // copy loses media when a capacity schedule temporarily omits that source.
  // Shares the immutable image strings (live mlq-r36: structuredClone of the
  // catalog took 70 of a 175 s reschedule on a 44-page photo template).
  return cloneTemplateValue(sourceSlides);
}

export function fidelityFromImported(project, imported, templateHash) {
  // Code-drawn components take the colours the template's slides use (Fable M1).
  applyUsedTemplatePalette(project, imported.deck.slides, imported.externalPptx);
  const originalCount = imported.deck.slides.length;
  if (originalCount < 2 && project.pages > originalCount) throw new Error('preserved template needs a content slide to reuse');
  if (imported.deck.slides.some(slide => !slotsFor(slide).some(slot => slot.role !== 'static'))) {
    throw new Error('preserved template has a slide without editable text slots');
  }
  const richSource = project.inputProfile?.level === 'rich' || String(project.source?.text || '').length >= 8000;
  const profiles = imported.deck.slides.map(slide => profileSourceSlide(slide, imported.externalPptx, richSource));
  const slideMap = planTemplateSlideMap(originalCount, project.pages, { profiles,reusePolicy:project.generationPolicy?.version===2?'role_based':'all_pages' });
  return buildFidelity(project, imported.deck.slides, imported.externalPptx, templateHash, profiles, slideMap);
}

/** Built pages of one reschedule. A page's build depends only on its index, its
 * template page and that page's use number, so a trial that moves one page
 * rebuilds only the pages whose (template page, use) change (Fable D3a; live
 * mlq-r36: 12 of a 19 s reschedule rebuilt all 44 pages for every trial). */
export function fidelityMemo() { return { slides: new Map(), profiles: new WeakMap(), shared: null }; }
/** A layout-only page (Fable G5, 2026-11-02): the frame's layout (its
 * background and promoted layout picture), the template's own title and
 * eyebrow and the user's brand marks; every other shape of the cloned frame is
 * left out, and the page is frame "layout" for the reuse cap. It is the
 * tie-break when every fitting frame is at the cap or on the previous page. */
/** A text card may become a layout-only page; a figure, table or object page never. */
const layoutOnlyCandidate = page => Boolean(page) && page.cardFrame !== 'divider' && page.role !== 'closing' && !page.figurePage && !page.cardFigureLayout
  && !(page.cardObjects || []).length && !(page.sourceImageIds || []).length && (page.keyPoints || []).length > 0;
function layoutOnlySlide(value, slide) {
  const keep = new Set((value.slots || []).filter(slot => ['title', 'section'].includes(slot.role)).map(slot => String(slot.shapeId)));
  const kept = value.nodes.filter(node => keep.has(String(node.nativeRef?.shapeId)) || node.content?.mediaRole === 'brand');
  const omitted = value.nodes.filter(node => !kept.includes(node)).map(node => node.nativeRef?.shapeId).filter(id => id !== undefined);
  return { ...value, variantId: 'layout-only', variant: { kind: 'layout-only', mediaShapeId: null, mediaSourceId: null, imageSha256: null }, layoutOnly: true,
    nodes: kept, slots: (value.slots || []).filter(slot => keep.has(String(slot.shapeId))), layoutOnlyOmitted: omitted,
    shapeCount: kept.length, imageCount: kept.filter(node => node.type === 'image').length };
}
/** The layout-only pages of the current outline: kept by page id, since a
 * split or merged card shifts every later index (live Capabilities: the
 * closing page inherited a text card's layout-only flag). */
function layoutOnlyIndices(project, fidelity = project.templateFidelity) {
  const ids = fidelity?.layoutOnlyPageIds;
  if (!Array.isArray(ids)) return fidelity?.layoutOnlyPages || [];
  const wanted = new Set(ids);
  return (project.outline || []).flatMap((page, index) => page && wanted.has(page.id) ? [index] : []);
}
function buildFidelity(project, sourceSlides, externalPptx, templateHash, profiles, slideMap, memo = null, layoutOnly = layoutOnlyIndices(project)) {
  const layoutPages = new Set(layoutOnly.filter(index => index > 0 && index < slideMap.length && layoutOnlyCandidate(project.outline?.[index])));
  const originalCount = sourceSlides.length;
  const usage = Array(originalCount).fill(0);
  const catalog = catalogTemplateLayouts(profiles);
  // Layout pictures are read once from the imported template; a reschedule
  // keeps them (its source catalog has no layouts).
  const imported = Array.isArray(externalPptx?.inherited), layoutPictures = imported ? layoutPictureCatalog(externalPptx) : {};
  // A stored picture without its stack (no tints list) predates the stack check and is dropped.
  const verified = Object.fromEntries(Object.entries(project.templateFidelity?.layoutPictures || {}).filter(([, picture]) => Array.isArray(picture.tints)));
  const pictureBySource = imported ? sourceSlides.map(slide => layoutPictureFor(layoutPictures, slide.nativeLayout)?.key || null) : (project.templateFidelity?.layoutPictureBySource || []).map(key => key && verified[key] ? key : null);
  const pictureByKey = imported ? Object.fromEntries(Object.values(layoutPictures).map(picture => [picture.key, picture])) : verified;
  const buildSlide = (index, sourceIndex, use) => {
      const slide = sourceSlides[sourceIndex];
      const repeated = use > 0;
      const profile = profiles[sourceIndex];
      const modes = profile.safeGeometryModes || [];
      const preserveFixedLayout=repeated&&project.templateContentMode==='keep_fixed'&&slide.nodes.some(node=>node.content?.mustPreserve&&project.templateFixedObjectIds?.includes(node.id));
      const mode = project.generationPolicy?.version===2?'original':preserveFixedLayout?'fixed-content-preserved':!repeated ? 'original' : modes.length ? modes[(use - 1) % modes.length] : 'media-focus';
      const cropVariant = repeated&&project.generationPolicy?.version!==2 ? TEMPLATE_VARIANTS[1 + Math.floor((use - 1) / Math.max(1, modes.length)) % (TEMPLATE_VARIANTS.length - 1)] : TEMPLATE_VARIANTS[0];
      if (project.generationPolicy?.version!==2 && repeated && mode === 'media-focus' && !slide.nodes.some(node => node.type === 'image'))
        throw new Error(`模板第 ${sourceIndex + 1} 页包含方向性图解或图表，且没有可安全变化的媒体，不能复用`);
      const roles = new Map(slotsFor(slide).map(slot => [slot.shapeId, slot.role]));
      const panelGeometry = mode === 'panel-swap' ? panelSwapGeometry(slide, externalPptx) : null;
      const reclaimedFrames = reclaimedMediaTextFrames(project, slide, externalPptx);
      if (mode === 'panel-swap' && !panelGeometry) throw new Error(`模板第 ${sourceIndex + 1} 页的卡片已不满足安全重排约束`);
      const mainImage = repeated ? slide.nodes.filter(node => node.type === 'image'&&!node.content?.mustPreserve)
        .sort((a, b) => b.geometry.width * b.geometry.height - a.geometry.width * a.geometry.height)[0] : null;
      const media = !preserveFixedLayout&&mainImage && safeDecorativeMedia(mainImage, externalPptx, slide) && !textOverlayCalloutPanel(mainImage, externalPptx, slide)
        ? sourceMediaFor(project, index, use, mainImage) || semanticMediaForSlide(project, index, mainImage) : null;
      const mediaHash = media ? crypto.createHash('sha256').update(Buffer.from(media.dataUrl.split(',')[1], 'base64')).digest('hex') : null;
      // A static ordinal badge sequence ("1", "2", "3") is navigation, not a
      // source fact: the number check exempts the 'ordinal' role (3143,
      // 0395f2aa pages 2 and 10: a template "3" was reported as unsupported).
      const ordinalIds = isOrdinalSequence(slide.nodes);
      // A repeat keeps its geometry (policy v2) but rotates the layout's own
      // template icons by use, so consecutive repeats do not look identical
      // (3143, 367a72d8 pages 3-6). Only distinct PNG/JPEG icons are rotated.
      const icons = repeated && !preserveFixedLayout ? slide.nodes.filter(base => base.type === 'image' && !base.content?.mustPreserve &&
        templateMediaRole(base, slide, externalPptx) === 'template_icon' && !(media && base.nativeRef.shapeId === mainImage?.nativeRef.shapeId)) : [];
      const rotatable = icons.length > 1 && new Set(icons.map(base => base.content?.imageSha256)).size > 1 &&
        icons.every(base => /^data:image\/(?:png|jpe?g);base64,/u.test(base.content?.dataUrl || ''));
      const iconSource = new Map(rotatable ? icons.map((base, k) => [base.nativeRef.shapeId, icons[(k + use) % icons.length]]) : []);
      const nodes = slide.nodes.map((base, nodeIndex) => {
        const node = { ...cloneTemplateValue(base), id: stableId('node', templateHash, index, base.nativeRef.shapeId),
          nativeRef: { ...base.nativeRef, slideIndex: index, sourceSlideIndex: sourceIndex } };
        if (ordinalIds.has(base.id) && roles.get(base.nativeRef.shapeId) === 'static') node.semanticRole = 'ordinal';
        if (repeated&&!base.content?.mustPreserve) node.geometry = panelGeometry?.[nodeIndex] || variantGeometry(node, mode, roles.get(base.nativeRef.shapeId), externalPptx);
        if (reclaimedFrames.has(base.nativeRef.shapeId)) {
          node.geometry = reclaimedFrames.get(base.nativeRef.shapeId);
          node.nativeTextFrame = { ...node.nativeTextFrame, wordWrap: true };
          node.content = { ...node.content, adaptiveMediaReclaim: true };
        }
        const icon = iconSource.get(base.nativeRef.shapeId);
        // A rotated template icon is still the template's sample icon (isSampleIcon).
        if (icon && icon !== base) node.content = { ...node.content, dataUrl: icon.content.dataUrl, imageSha256: icon.content.imageSha256, mediaReplacement: true, iconRotation: true, crop: [0, 0, 0, 0] };
        if (base.type === 'image' && repeated&&!preserveFixedLayout&&!base.content?.mustPreserve) {
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
      const fixedReuse=repeated&&!visualChanged&&project.templateContentMode==='keep_fixed'&&slide.nodes.some(node=>node.content?.mustPreserve&&project.templateFixedObjectIds?.includes(node.id));
      // Under policy v2 a repeat keeps the original layout; its content differs,
      // so an unchanged repeat is allowed rather than a variant being forced.
      if (repeated && !visualChanged&&!fixedReuse&&mode!=='original') throw new Error(`模板第 ${sourceIndex + 1} 页没有安全的媒体或布局变体`);
      // A text frame we fill stays on the slide (Fable 2026-10-26, GPH tpl8:
      // its title frame ran 0.29 in past the right edge); fits, canvases and
      // the export all use the clamped frame, and the cut is recorded.
      const slots = slotsFor({ nodes }),W=Number(externalPptx.width),H=Number(externalPptx.height);
      if(W>0&&H>0)for(const slot of slots.filter(item=>item.role!=='static')){
        const node=nodes.find(item=>String(item.nativeRef?.shapeId)===String(slot.shapeId)),g=node?.geometry;if(!g||node.content?.mustPreserve)continue;
        const x=Math.max(0,g.x),y=Math.max(0,g.y),width=Math.min(g.x+g.width,W)-x,height=Math.min(g.y+g.height,H)-y;
        if(width>0&&height>0&&(x!==g.x||y!==g.y||width!==g.width||height!==g.height)){
          node.frameClamped={left:x-g.x,top:y-g.y,right:g.x+g.width-(x+width),bottom:g.y+g.height-(y+height)};
          node.geometry={...g,x,y,width,height};
        }
      }
      return { index, sourceIndex, variantId: fixedReuse?'fixed-content-preserved':repeated ? `${mode}-${cropVariant.id}${media ? '-source-media' : ''}` : 'original',
        variant: { kind: fixedReuse?'fixed-content-preserved':mode, mediaShapeId: media ? mainImage.nativeRef.shapeId : null,
          mediaSourceId: media?.id || null, imageSha256: mediaHash },
        background: slide.nativeBackground, nodes, slots,
        // The layout's own picture (the cover photo on Portfolio), drawn as a node (Fable G1).
        ...(pictureBySource[sourceIndex] ? { layoutPicture: pictureBySource[sourceIndex] } : {}),
        shapeCount: nodes.length, imageCount: nodes.filter(node => node.type === 'image').length };
    };
  const slides = slideMap.map((sourceIndex, index) => {
    // A layout-only page reuses no template page's own design (no use counted).
    const only = layoutPages.has(index), use = only ? 0 : usage[sourceIndex]++, key = `${index}:${sourceIndex}:${use}${only ? ':layout' : ''}`, known = memo?.slides.get(key);
    if (known) { if (known.error) throw known.error; return known.value; }
    try { const built = buildSlide(index, sourceIndex, use), value = only ? layoutOnlySlide(built, sourceSlides[sourceIndex]) : built; memo?.slides.set(key, { value }); return value; }
    catch (error) { memo?.slides.set(key, { error }); throw error; }
  });
  const profileOf = slide => { if (!memo) return profileTemplateSlide(slide, externalPptx); if (!memo.profiles.has(slide)) memo.profiles.set(slide, profileTemplateSlide(slide, externalPptx)); return memo.profiles.get(slide); };
  const finalProfiles = slides.map(profileOf);
  const shared = memo?.shared || { componentProfile: templateComponentProfile(sourceSlides.map(slide=>({...slide,slots:slotsFor(slide)})), externalPptx, templateHash, templateMediaRole), sourceCatalog: compactSourceCatalog(sourceSlides) };
  if (memo) memo.shared = shared;
  const visualSimilarityPairs = finalProfiles.slice(1).map((profile, index) =>
    Number(visualSimilarity(finalProfiles[index], profile).toFixed(3)));
  return {
    componentProfile: shared.componentProfile,
    mode: 'preserve', originalPath: externalPptx.originalPath, nativeIdNormalization:externalPptx.nativeIdNormalization||project.templateFidelity?.nativeIdNormalization, sha256: templateHash,
    width: externalPptx.width, height: externalPptx.height, originalSlideCount: originalCount, slideMap, layoutCatalog: catalog,
    // Master/layout decisions of a design-only reuse survive every reschedule (report 84f9e527).
    inheritedActions: [...new Map([...(externalPptx.inheritedActions||project.templateFidelity?.inheritedActions||[]).filter(action=>!action.promoted),...layoutPictureActions(pictureByKey)].map(action=>[action.key,action])).values()],
    ...(Object.keys(pictureByKey).length?{layoutPictures:pictureByKey,layoutPictureBySource:pictureBySource}:{}),
    ...(layoutPages.size?{layoutOnlyPages:[...layoutPages].sort((a,b)=>a-b),layoutOnlyPageIds:[...layoutPages].sort((a,b)=>a-b).map(index=>project.outline?.[index]?.id).filter(Boolean)}:{}),
    imageTextUnchecked: externalPptx.imageTextUnchecked??project.templateFidelity?.imageTextUnchecked??0,
    imageTextReader: externalPptx.imageTextReader??project.templateFidelity?.imageTextReader,
    linkedPicturesRetired: externalPptx.linkedPicturesRetired??project.templateFidelity?.linkedPicturesRetired??[],
    // Compressed embedded fonts and the face measured in their place (ppt-fonts.mjs).
    fontSubstitutions: externalPptx.fontSubstitutions??project.templateFidelity?.fontSubstitutions??[],
    // Even N >= originalCount can omit a source layout after capacity/role
    // selection. Preserve the full original catalog for later rescheduling;
    // mapped media is compacted and rehydrated from the output asset ledger.
    // Reparse/mode/fixed-selection changes own a freshly processed view. A
    // previous design-only catalog cannot override newly selected fixed copy.
    // sourceSlides includes every original layout and its media bytes.
    sourceCatalog: shared.sourceCatalog,
    reusePlan: { repeatedPages: Math.max(0, project.pages - originalCount), omittedSourcePages: Math.max(0, originalCount - new Set(slideMap).size),
      maxSourceUse: Math.max(...slideMap.map(source => slideMap.filter(value => value === source).length)),
      adjacentSameSource: 0, visualSimilarityPairs },
    slides,
  };
}

export function restoreNativeTemplateCoverage(project,scoreSlide,{allowOverflowCandidate=false}={}){
 const fidelity=project.templateFidelity;
 if(fidelity?.mode!=='preserve')return project;
 const allOriginal=project.generationPolicy?.version!==2&&project.pages>=fidelity.originalSlideCount;
 const fixedIds=new Set(project.templateContentMode==='keep_fixed'?project.templateFixedObjectIds||[]:[]);
 const fixedPages=(fidelity.sourceCatalog||[]).flatMap((slide,index)=>slide.nodes?.some(node=>fixedIds.has(node.id))?[index]:[]);
 const required=[...new Set([...(allOriginal?Array.from({length:fidelity.originalSlideCount},(_,index)=>index):[]),...fixedPages])];
 delete project.nativeCoverageWarnings;
 if(!required.length)return project;
 const sourceSlides=cloneTemplateValue(fidelity.sourceCatalog),external={originalPath:fidelity.originalPath,width:fidelity.width,height:fidelity.height};
 const rich=project.inputProfile?.level==='rich'||String(project.source?.text||'').length>=8000;
 const profiles=sourceSlides.map(slide=>profileSourceSlide(slide,external,rich));
 const missing=required.filter(i=>!project.templateFidelity.slideMap.includes(i));
 for(const sourceIndex of missing){
  const prior=project.templateFidelity,map=prior.slideMap;let chosen=null,leastOverflow=null,leastScore=Infinity,leastIndex=null;
  for(let index=1;index<project.pages-1;index++){
   if(required.includes(map[index])&&map.filter(i=>i===map[index]).length<=1||profiles[sourceIndex].directional||map[index-1]===sourceIndex||map[index+1]===sourceIndex)continue;
   const trial=[...map];trial[index]=sourceIndex;
   try{project.templateFidelity=buildFidelity(project,sourceSlides,external,fidelity.sha256,profiles,trial);const score=scoreSlide(project,index);if(score<=0){chosen=project.templateFidelity;break;}if(Number.isFinite(score)&&score<leastScore){leastOverflow=project.templateFidelity;leastScore=score;leastIndex=index;}}catch{}
  }
  // An automatic, unconfirmed outline must reach the normal measured
  // condensation/partition pipeline. Keep the required original media in the
  // least-overflow candidate; revalidateOutlineFits still records its actual
  // overflow and final confirmation cannot accept an unfitted page.
  if(!chosen&&allowOverflowCandidate&&!project.confirmedOutline&&leastOverflow&&fixedPages.includes(sourceIndex)){
   chosen=leastOverflow;
   chosen.reusePlan.coverageCapacityCandidates=[...(prior.reusePlan?.coverageCapacityCandidates||[]),{sourceIndex,pageIndex:leastIndex,predictedOverflow:leastScore,basis:'unaccepted candidate; full capacity repair and final gates still required'}];
  }
  project.templateFidelity=chosen||prior;
  if(chosen)continue;
  const message='native_template_coverage_capacity: no readable unaccepted page can preserve '+(fixedPages.includes(sourceIndex)?'selected fixed objects on template page ':'original template page ')+(sourceIndex+1)+' at the current font/page budget.';
  // Using every original layout is a visual-variety goal, not a content
  // contract: leave this layout unused and list it instead of failing a valid
  // outline. User-selected fixed objects remain a hard requirement.
  if(!fixedPages.includes(sourceIndex)){(project.nativeCoverageWarnings||=[]).push({templatePage:sourceIndex+1,message});continue;}
  const error=new Error(message+' Increase the page budget or revise the fixed-object selection before confirming; the original template remains unchanged.');error.code='capacity_invalid';error.outlineContract=true;error.fixedTemplateCoverage=true;throw error;
 }
 return project;
}

/** Rebind only the native page assignment after the outline is known. The
 * existing outline/content DAG and original template remain unchanged. */
/** The template pages a theme content page may use (Fable 2026-10-26): every
 * content or unknown page that is no header frame (headerFrameReason), and the
 * count left out by role and by title geometry. With fewer than two frames
 * left, every page stays a frame (fallback). */
const frameEligibilityMemo=new WeakMap();
export function themeFrameEligibility(fidelity){
 const catalog=fidelity?.sourceCatalog;if(!Array.isArray(catalog))return null;
 if(frameEligibilityMemo.has(catalog))return frameEligibilityMemo.get(catalog);
 const size={width:fidelity.width,height:fidelity.height},excluded={role:0,geometry:0},eligible=[],pages=[];
 catalog.forEach((slide,index)=>{
  const reason=headerFrameReason({...slide,slots:slide.slots||slotsFor(slide)},size);
  if(reason){excluded[reason]++;pages.push({templatePage:index+1,reason});}
  else if(['content','unknown'].includes(classifyTemplatePage(slide,size).role))eligible.push(index);
 });
 const result={eligible,excluded,pages,fallback:eligible.length<2};
 frameEligibilityMemo.set(catalog,result);return result;
}
export function rescheduleTemplateFidelity(project,{scoreSlide,allowOverflowCandidate=false}={}) {
  const fidelity = project.templateFidelity;
  if (fidelity?.mode !== 'preserve') return project;
  const sourceSlides = fidelity.sourceCatalog ? cloneTemplateValue(fidelity.sourceCatalog) : Array.from({ length: fidelity.originalSlideCount }, (_, sourceIndex) => {
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
  const slideMap = planTemplateSlideMap(sourceSlides.length, project.pages, { profiles, outline: project.outline,reusePolicy:project.generationPolicy?.version===2?'role_based':'all_pages' });
  const memo = fidelityMemo();
  project.templateFidelity = buildFidelity(project, sourceSlides, externalPptx, fidelity.sha256, profiles, slideMap, memo);
  const capacityAssignments=[];
  // A card deck's last card is content and is fitted like the others.
  // A card deck's closing is scheduled too: it takes a frame with a template
  // photo (Fable C2, 2026-11-01), from any template page but the cover.
  const cardClosing=cardsFlow(project)&&project.outline?.at(-1)?.role==='closing';
  const lastFitted=cardsFlow(project)?project.pages:project.pages-1;
  // A split table's range page may always take the frame its rows were
  // planned on, even the template's last page (Fable 2026-11-02: a range page
  // is never placed on a frame shorter than its plan; live CodePilot PDF on
  // Professional-Portfolio: ranges 2/5 and 3/5 failed on frames 2 and 3).
  const plannedSource=index=>{const page=project.outline?.[index];if(!(page?.sourceArtifactRanges||[]).some(ref=>ref.rowStart!==undefined))return null;
    for(const id of page.cardObjects||[]){const source=Number(String(project.tableTypography?.[id]?.frameKey||'').split(':')[0]);if(Number.isInteger(source)&&source>0&&source<sourceSlides.length)return source;}return null;};
  // The reuse cap is a rule (the user, 2026-10-25; hard since Fable
  // 2026-11-02): a frame used max(2, floor(N/5)) times by earlier pages takes
  // a page only when no frame under the cap fits it; such a page is listed.
  const cap=cardsFlow(project)&&cardFrameFits?layoutReuseCap(project.pages):Infinity,capFallbacks=[];
  // The frames a page may take: the closing any frame but the cover; a split
  // table's range page also its planned frame, even the template's last page.
  const eligible=(index,sourceIndex)=>{const closing=cardClosing&&index===project.pages-1,planned=plannedSource(index);
    return closing||sourceIndex===planned||!(sourceIndex===sourceSlides.length-1||profiles[sourceIndex].directional&&project.generationPolicy?.version!==2||project.generationPolicy?.version===2&&!['content','unknown'].includes(profiles[sourceIndex].semantic?.pageRole?.role));};
  const trialFidelity=map=>{try{return buildFidelity(project,sourceSlides,externalPptx,fidelity.sha256,profiles,map,memo);}catch{return null;}};
  // A frame fits a page when its body fits at body size, its title fits and it
  // is no header frame; a header frame or an unfitting title (1e10 and more)
  // never counts as a fit (2026-11-03).
  const fitsNow=(index,score)=>cap!==Infinity&&score<SEVERE_SCORE&&Boolean(cardFrameFits?.(project,index));
  const sticky=index=>{const page=project.outline?.[index];return page?.templateFill?.status==='filled'&&page.templateFill.sticky===true&&!(Number(page.templateFill.citedFigures)>Number(page.templateFill.figures||0));};
  if(scoreSlide)for(let index=1;index<lastFitted;index++){
    const currentMap=project.templateFidelity.slideMap,prior=project.templateFidelity;
    // Layout-only pages count toward no frame; the previous page's frame is
    // never taken again (Fable G5, 2026-11-02: hard, both rules).
    const layoutSet=new Set(layoutOnlyIndices(project,prior));
    const uses=(map,source,skip=-1)=>map.slice(1,index).filter((value,k)=>value===source&&!layoutSet.has(k+1)&&k+1!==skip).length;
    const over=source=>uses(currentMap,source)>=cap;
    const adjacent=source=>cap!==Infinity&&index>1&&currentMap[index-1]===source&&!layoutSet.has(index-1);
    // A filled page is placed by its fill, never rescheduled here.
    if(sticky(index))continue;
    // A layout-only page stays one, listed again (reschedules rebuild the ledger).
    if(layoutSet.has(index)){capFallbacks.push({page:index+1,templatePage:currentMap[index]+1,frame:'layout'});continue;}
    const before=scoreSlide(project,index);if(!(before>0)&&!over(currentMap[index])&&!adjacent(currentMap[index]))continue;
    const candidates=[{fidelity:prior,source:currentMap[index],score:before,fits:fitsNow(index,before)}];
    let best=candidates[0];
    for(let sourceIndex=1;sourceIndex<sourceSlides.length;sourceIndex++){
      // This pass runs only for a physical overflow, a cap breach or a repeat
      // of the previous page's frame.
      if(sourceIndex===currentMap[index]||!eligible(index,sourceIndex))continue;
      const trial=[...currentMap];trial[index]=sourceIndex;
      const candidate=trialFidelity(trial);if(!candidate)continue;/* A native variation rejected by the fidelity contract is not a candidate. */
      project.templateFidelity=candidate;
      const score=scoreSlide(project,index),entry={fidelity:candidate,source:sourceIndex,score,fits:fitsNow(index,score)};
      candidates.push(entry);if(score<best.score)best=entry;
    }
    project.templateFidelity=prior;
    const pick=list=>[...list].sort((a,b)=>a.score-b.score)[0]||null;
    // Order of choice: a frame that fits, is under the cap and is not the
    // previous page's; a page that fits nowhere keeps its best frame when that
    // breaks neither rule.
    const good=candidates.filter(item=>item.fits&&!over(item.source)&&!adjacent(item.source));
    let chosen=pick(good)||(!candidates.some(item=>item.fits)&&!over(best.source)&&!adjacent(best.source)?best:null);
    // A frame at the cap is freed for this page when an earlier page on it also
    // fits an under-cap frame (the user, 2026-11-03): that page moves, this one
    // takes the frame. Bounded; the first pair that keeps both pages fitting wins.
    if(!chosen&&cap!==Infinity&&!(cardClosing&&index===project.pages-1)){
      const swap=freeFullFrame(index,currentMap,candidates.filter(item=>item.fits&&over(item.source)&&!adjacent(item.source)).sort((a,b)=>a.score-b.score),uses);
      if(swap){chosen={fidelity:swap.fidelity,source:swap.fidelity.slideMap[index],score:swap.score};capacityAssignments.push({page:swap.moved+1,fromSource:currentMap[swap.moved],toSource:swap.fidelity.slideMap[swap.moved],basis:'moved to an under-cap frame to free its frame for page '+(index+1)});}
    }
    if(!chosen){
      // Figure, table and object pages keep a template frame over the cap,
      // listed (Fable 2026-11-02): a layout-only page is for text cards only.
      // The least-used fitting frame other than the previous page's takes it, so
      // the excess spreads; one that fits nowhere takes an under-cap frame other
      // than the previous page's within 10% of the best overflow (2026-11-03).
      if(!layoutOnlyCandidate(project.outline?.[index])){
        const full=candidates.filter(item=>item.fits&&!adjacent(item.source)).sort((a,b)=>uses(currentMap,a.source)-uses(currentMap,b.source)||a.score-b.score);
        const near=candidates.some(item=>item.fits)?null:pick(candidates.filter(item=>!over(item.source)&&!adjacent(item.source)&&item.score<SEVERE_SCORE&&item.score<=best.score*NEAR_SCORE));
        chosen=full[0]||near||pick(candidates.filter(item=>item.fits&&!over(item.source)))||best;
        if(over(chosen.source)||adjacent(chosen.source))capFallbacks.push({page:index+1,templatePage:chosen.source+1});
      }else{
        // Every fitting frame is at the cap or on the previous page: a
        // layout-only page on the plainest content frame, uncapped and ledgered.
        const middle=[...Array(sourceSlides.length).keys()].filter(k=>k>0&&k<sourceSlides.length-1),contentFrames=middle.filter(k=>['content','unknown'].includes(profiles[k].semantic?.pageRole?.role||'content'));
        const plain=(contentFrames.length?contentFrames:middle).sort((a,b)=>(sourceSlides[a].nodes||[]).length-(sourceSlides[b].nodes||[]).length);
        let placed=null;
        for(const sourceIndex of plain){const trial=[...currentMap];trial[index]=sourceIndex;
          try{const built=buildFidelity(project,sourceSlides,externalPptx,fidelity.sha256,profiles,trial,memo,[...layoutSet,index]);project.templateFidelity=built;const score=scoreSlide(project,index);
            if(!placed||score<placed.score)placed={fidelity:built,score};if(!(score>0))break;}catch{/* not a candidate */}}
        if(placed){chosen={fidelity:placed.fidelity,source:placed.fidelity.slideMap[index],score:placed.score};capFallbacks.push({page:index+1,templatePage:chosen.source+1,frame:'layout'});}
        else{chosen=best;capFallbacks.push({page:index+1,templatePage:best.source+1});}
      }
    }
    project.templateFidelity=chosen.fidelity;
    if(chosen.fidelity!==prior)capacityAssignments.push({page:index+1,fromSource:prior.slideMap[index],toSource:chosen.source,beforeOverflowEMU:before,afterOverflowEMU:chosen.score,adjacentSourceReuse:chosen.source===chosen.fidelity.slideMap[index-1]||chosen.source===chosen.fidelity.slideMap[index+1],basis:'measured native body at unchanged font; physical fit before layout variety'});
  }
  function freeFullFrame(index,currentMap,frames,uses){
    let trials=0;
    for(const {source:frame,score:own} of frames){
      for(let moved=1;moved<index;moved++){
        if(currentMap[moved]!==frame||plannedSource(moved)!==null||sticky(moved))continue;
        for(let target=1;target<sourceSlides.length;target++){
          if(target===frame||!eligible(moved,target)||uses(currentMap,target,moved)>=cap||target===currentMap[moved-1]||target===currentMap[moved+1])continue;
          if(++trials>SWAP_TRIALS)return null;
          const trial=[...currentMap];trial[moved]=target;trial[index]=frame;
          const candidate=trialFidelity(trial);if(!candidate)continue;
          project.templateFidelity=candidate;
          if(cardFrameFits(project,moved)&&scoreSlide(project,moved)<CARD_OVERFLOW_SCORE&&fitsNow(index,scoreSlide(project,index)))return {fidelity:candidate,score:scoreSlide(project,index)??own,moved};
        }
      }
    }
    return null;
  }
  if(scoreSlide)preferAssemblies(project,{sourceSlides,externalPptx,sha256:fidelity.sha256,profiles,memo,scoreSlide});
  if(scoreSlide)restoreNativeTemplateCoverage(project,scoreSlide,{allowOverflowCandidate});
  if(scoreSlide)balanceTemplateMedia(project,scoreSlide,{sourceSlides,profiles,externalPptx,sha256:fidelity.sha256,capacityAssignments,memo});
  if(scoreSlide)restoreNativeTemplateCoverage(project,scoreSlide,{allowOverflowCandidate});
  // A filled page keeps its template page through every pass above (fill-
  // template-first, Fable: filled pages are sticky; the cap is a preference).
  {const pins=(project.outline||[]).map((page,index)=>page?.templateFill?.status==='filled'&&page.templateFill.sticky===true&&!(Number(page.templateFill.citedFigures)>Number(page.templateFill.figures||0))&&index>0&&Number.isInteger(page.templateFill.page)&&page.templateFill.page>0&&page.templateFill.page<sourceSlides.length?[index,page.templateFill.page]:null).filter(Boolean);
   if(pins.some(([index,source])=>project.templateFidelity.slideMap[index]!==source)){const map=[...project.templateFidelity.slideMap];for(const [index,source] of pins)map[index]=source;
    try{project.templateFidelity=buildFidelity(project,sourceSlides,externalPptx,fidelity.sha256,profiles,map,memo,layoutOnlyIndices(project,project.templateFidelity).filter(index=>!pins.some(([pinned])=>pinned===index)));}catch{/* the contract refused the pinned map: the pages fall back to theme pages */}}}
  if(capacityAssignments.length)project.templateFidelity.capacityAssignments=capacityAssignments;
  if(capFallbacks.length)project.templateFidelity.reuseCapFallbacks=capFallbacks;
  if(cardsFlow(project)){const frames=themeFrameEligibility(project.templateFidelity);if(frames)project.templateFidelity.themeFrames={excluded:frames.excluded,pages:frames.pages,fallback:frames.fallback};}
  return project;
}

// A card deck's page shows template pictures its theme fit keeps beside the
// points; ppt-card-pages registers how they are counted (Fable media decision R0).
let cardPageVisuals=null;
const CARD_OVERFLOW_SCORE=1000;
// The trials one page may spend to free a full frame; how much more an
// unfitting page may overflow to keep the cap and differ from its previous
// page; and the score from which a frame never counts as a fit (2026-11-03).
const SWAP_TRIALS=48,NEAR_SCORE=1.1,SEVERE_SCORE=1e9;
export function setCardPageVisuals(count){cardPageVisuals=count;}
// The pieces of a numbered assembly a card page keeps (ppt-card-pages registers it).
let keptAssembly=null;
export function setKeptAssembly(test){keptAssembly=test;}
// Whether a card page fits its trial frame (ppt-card-pages registers it).
let cardFrameFits=null;
export function setCardFrameFits(test){cardFrameFits=test;}
// Whether a page fills its frame's label component natively (card pages, P-A).
let assemblyFills=null;
export function setAssemblyFills(test){assemblyFills=test;}
/** A card whose points match a template component's parts takes that frame
 * when the component fills (Fable 2026-11-02, P-C/P-D: the hand deck's clover
 * for its agenda and discussion; live Mood used the clover frame twice and
 * retired the clover both times). Under the reuse cap and never on the
 * previous page's frame; a mismatched count never takes a component. */
function preferAssemblies(project,{sourceSlides,externalPptx,sha256,profiles,memo,scoreSlide}){
  const fidelity=project.templateFidelity,size=fidelity;if(!assemblyFills||!cardsFlow(project))return;
  const parts=sourceSlides.map(slide=>{const found=assemblyParts({...slide,slots:slide.slots||slotsFor(slide)},size);return found&&found.labels.length===found.group.length?found.group.length:0;});
  if(!parts.some(Boolean))return;
  const cap=layoutReuseCap(project.pages);
  for(let index=1;index<project.outline.length-1;index++){
    const page=project.outline[index],count=(page?.keyPoints||[]).length,current=project.templateFidelity,map=current.slideMap,layoutSet=new Set(layoutOnlyIndices(project,current));
    if(!page||page.figurePage||(page.cardObjects||[]).length||(page.sourceImageIds||[]).length||!count||assemblyFills(project,index))continue;
    for(let sourceIndex=1;sourceIndex<sourceSlides.length-1;sourceIndex++){
      if(parts[sourceIndex]!==count||sourceIndex===map[index])continue;
      const uses=map.filter((value,k)=>k>0&&k!==index&&value===sourceIndex&&!layoutSet.has(k)).length;
      if(uses>=cap||map[index-1]===sourceIndex||map[index+1]===sourceIndex)continue;
      const trial=[...map];trial[index]=sourceIndex;
      try{project.templateFidelity=buildFidelity(project,sourceSlides,externalPptx,sha256,profiles,trial,memo,[...layoutSet].filter(k=>k!==index));
        if(assemblyFills(project,index)&&!(scoreSlide(project,index)>0))break;}catch{/* not a candidate */}
      project.templateFidelity=current;
    }
  }
}
/** Media budget (MD-P0-2): capacity alone picks the image-free layout again
 * and again. Break runs of text-only pages by moving a page to a template page
 * with media when the measured body still fits, no neighbour repeats the same
 * template page and every original template page stays in use. */
function pageMedia(project,index){
  const spec=project.templateFidelity?.slides?.[index];if(!spec)return 0;
  if(cardsFlow(project)&&cardPageVisuals)return cardPageVisuals(project,index);
  const {artwork,icons}=regionArtwork(project,index,contentCanvas(project,index).geometry);
  const inRegion=new Set([...artwork,...icons].map(node=>node.nativeRef?.shapeId));
  // Only media outside the rebuilt source region is certain to survive; region
  // artwork survives only if the text fits beside it, decided at binding time.
  return (spec.nodes||[]).filter(node=>node.type==='image'&&!inRegion.has(node.nativeRef?.shapeId)).length;
}
export function balanceTemplateMedia(project,scoreSlide,{sourceSlides,profiles,externalPptx,sha256,capacityAssignments=[],memo=null}){
  const pages=project.pages,original=sourceSlides.length;
  const textOnlyRun=()=>{let run=[];for(let index=1;index<pages-1;index++){if(pageMedia(project,index)===0)run.push(index);else{if(run.length>=2)return run;run=[];}}return run.length>=2?run:null;};
  for(let attempt=0;attempt<pages;attempt++){
    const run=textOnlyRun();if(!run)break;
    let improved=false;
    for(const index of [run[Math.floor(run.length/2)],...run.filter(i=>i!==run[Math.floor(run.length/2)])]){
      const prior=project.templateFidelity,map=prior.slideMap;let best=null,bestMedia=0;
      // A card page's score already weighs its media (PHOTO_REUSE_COST, spacing,
      // photo share in ppt-card-pages mediaCost): a move must lower that whole
      // score, or a later change of those constants silently lets this pass put
      // a photo on its fifth and sixth page again (live fz-r32).
      const current=cardsFlow(project)?scoreSlide(project,index):null;
      for(let sourceIndex=1;sourceIndex<original-1;sourceIndex++){
        if(project.generationPolicy?.version===2&&!['content','unknown'].includes(profiles[sourceIndex].semantic?.pageRole?.role)||sourceIndex===map[index]||sourceIndex===map[index-1]||sourceIndex===map[index+1]||profiles[sourceIndex]?.directional)continue;
        const trial=[...map];trial[index]=sourceIndex;
        // Never past the reuse cap for media (Fable 2026-11-02).
        if(cardsFlow(project)&&trial.slice(1).filter(value=>value===sourceIndex).length>layoutReuseCap(pages))continue;
        if(project.generationPolicy?.version!==2&&pages>=original&&Array.from({length:original},(_,i)=>i).some(i=>!trial.includes(i)))continue;
        try{
          project.templateFidelity=buildFidelity(project,sourceSlides,externalPptx,sha256,profiles,trial,memo);
          const media=pageMedia(project,index);
          // A card deck's theme page always costs its theme base; it may take
          // the media frame unless it overflows there (Fable media decision R0).
          if(media>bestMedia&&(cardsFlow(project)?(()=>{const score=scoreSlide(project,index);return score<CARD_OVERFLOW_SCORE&&score<current;})():scoreSlide(project,index)<=0)){best=project.templateFidelity;bestMedia=media;}
        }catch{/* rejected by the fidelity contract */}
        project.templateFidelity=prior;
      }
      if(best){project.templateFidelity=best;capacityAssignments.push({page:index+1,fromSource:prior.slideMap[index],toSource:best.slideMap[index],basis:'media budget: break text-only run at unchanged font'});improved=true;break;}
    }
    if(!improved)break;
  }
  return project;
}

export async function prepareTemplateFidelity(project, templateBytes, templateHash, template = null, io = { importPptx: importEditablePptx, writeFile: files.writeFile }) {
  const templateStore = await import('./ppt-store.mjs');
  const owner = template?.kind === 'managed' ? 'managed' : project.uid;
  const cached = template && templateStore.readTemplateIR(owner, template.id, templateHash);
  if (cached?.parserVersion===PPTX_IR_VERSION) {
    // Copy the opaque package for native export, never parse it again at runtime.
    const originalPath = await io.writeFile(project.id, 'template-original.pptx', Readable.from([templateBytes]), templateBytes.length, project.uid);
    if (typeof originalPath !== 'string' || !originalPath.startsWith('/')) throw new Error('template copy did not return a sandbox path');
    let imported = { ...cached.imported, externalPptx: { ...cached.imported.externalPptx, originalPath } };
    if(['design_only','keep_fixed'].includes(project.templateContentMode)) imported=templateDesignView(imported,new Set(imported.deck.slides.flatMap(slide=>contentMediaCandidates(slide,imported.externalPptx).map(node=>node.id))),new Set(project.templateContentMode==='keep_fixed'?project.templateFixedObjectIds||[]:[]),{preserveClassifiedDesign:project.generationPolicy?.version===2,roleFor:templateMediaRole});
    project.templateCacheHit = true;
    return project.templateMode === 'mapped' ? {mode:'mapped',sha256:templateHash,componentProfile:templateComponentProfile(imported.deck.slides.map(slide=>({...slide,slots:slotsFor(slide)})),imported.externalPptx,templateHash,templateMediaRole)} : fidelityFromImported(project, imported, templateHash);
  }
  project.templateCacheHit = false;
  let imported = await io.importPptx({ id: project.id, uid: project.uid, title: project.title }, templateBytes, templateHash);
  if (template) templateStore.writeTemplateIR(owner, template.id, { schemaVersion: 1, parserVersion: PPTX_IR_VERSION, sha256: templateHash, imported });
  if(['design_only','keep_fixed'].includes(project.templateContentMode)) imported=templateDesignView(imported,new Set(imported.deck.slides.flatMap(slide=>contentMediaCandidates(slide,imported.externalPptx).map(node=>node.id))),new Set(project.templateContentMode==='keep_fixed'?project.templateFixedObjectIds||[]:[]),{preserveClassifiedDesign:project.generationPolicy?.version===2,roleFor:templateMediaRole});
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
  const headerLanguage=pageTopicLanguage(project,project.outline?.[index]||{});
  return `${project.generationPolicy?.version===2?'\n本页主语言='+headerLanguage+'；自动section/eyebrow短标签也使用该语言。只有已规划的真实双语辅助题名或实际源标题可保留另一语言；纯中文页不要生成Core Goal或Design Rules等英文装饰标签。':''}\n模板第 ${index + 1} 页：独立内容组容量 ${plan?.templatePointCapacity || new Set(readingOrder.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose)).map(slot => slot.groupId)).size}，本页计划至少 ${plan?.templatePointTarget || '按来源可支撑的数量'} 组；内容型原图 ${JSON.stringify(media)}。文本槽位：${JSON.stringify(readingOrder.map((slot, order) => ({ id: String(slot.shapeId), readingOrder: order + 1, role: slot.role, purpose: slot.purpose, pairedWith: slot.pairedWith,
    groupId: slot.groupId,
    example: ['design_only','keep_fixed'].includes(project.templateContentMode) ? undefined : slot.example, minVisualUnits: slot.minVisualUnits, maxVisualUnits: slot.capacity,
    requiredItems: slot.purpose === 'list' ? slot.paragraphCount : undefined, maxLines: slot.maxLines, lineVisualUnits: slot.lineVisualUnits, wordWrap: slot.wordWrap,
    paragraphPatterns: slot.purpose === 'list' ? slot.paragraphs.map(item => ({ hasLabelRun: item.hasLabelRun, example: ['design_only','keep_fixed'].includes(project.templateContentMode) ? undefined : item.example })) : undefined })))}。` +
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


// F-P1-11: a normalized section label measured to the title edge (one line, no wrap).
const slotCapacity = (slot, slide) => slot.role === 'section' && slide.sectionLabel?.shapeId === slot.shapeId && slide.sectionLabel.capacity
  ? Math.max(slot.capacity, slide.sectionLabel.capacity) : slot.capacity;
/** Slot character budgets are conservative planning guidance. A title that
 * exceeds that coarse budget can still fit the immutable native frame. Reuse
 * the final renderer's width/height and native line contract instead of
 * renaming a locked title or shrinking its font. Export checks remain final. */
export function nativeTitleFitsFrame(spec,slot,text,actualNode=null,{rendered=false}={}){
 const translation=slot.role==='section'&&actualNode?.semanticRole==='title-translation'&&actualNode.content?.derivedFrom==='title-hierarchy'&&actualNode.titlePair?.secondary===text;
 if(slot.role!=='title'&&!translation||!String(text||'').trim())return false;
 const node=actualNode||spec.nodes?.find(node=>node.nativeRef?.shapeId===slot.shapeId);
 if(!node?.nativeTextFrame||!node.nativeRef||!node.geometry?.width||!node.geometry?.height)return false;
 // Measure the title as it renders (live mlq-r33 p10: "Sector/beta-neutral …"
 // fit, the rendered "Sector / beta-neutral …" wrapped past the slot).
 const shown=normalizeTypography(text,Infinity);
 const element={...node,semanticRole:translation?'title-translation':'template-title',kind:'text',bounds:node.geometry,
  content:node.content?.text===shown?node.content:{text:shown},
  // A frame code grows is measured at the line spacing it renders with: the
  // renderer lifts template spacing below 1.15 (live JEPA cover, 2026-11-01:
  // grown at 1.04 to fit four lines, rendered at 1.15 past the frame).
  ...(rendered&&node.nativeTextFrame?.paragraphs?{nativeTextFrame:{...node.nativeTextFrame,paragraphs:node.nativeTextFrame.paragraphs.map(p=>Number(p.lineSpacing)>0&&Number(p.lineSpacing)<1.15?{...p,lineSpacing:1.15}:p)}}:{})};
 const fit=measureText(element);
 return !fit.overflow&&fit.lines<=Math.max(1,translation?2:slot.maxLines||1);
}
/** The cover title's sizes (Fable 2026-11-01, replacing the 70% floor of
 * 2026-10-26): the slot's own size, then 36, 32 and 28 pt. */
export const COVER_TITLE_STEPS=Object.freeze([36,32,28]);
export function coverTitleSizes(node){
 const slotPt=Number(node?.style?.fontSizePt)||0;if(!slotPt)return [];
 return [slotPt,...COVER_TITLE_STEPS.filter(pt=>pt<slotPt)];
}
/** A cover title is never shortened (Fable 2026-11-01: "客户支持知识库试点方案"
 * became "知识库试点" on Copy-of-Deal-Review): it may wrap to as many lines as
 * its frame's height holds (measured, not the slot's declared line count) at a
 * size from the slot's own down to 28 pt. */
export const coverTitleSlot=slot=>slot&&{...slot,maxLines:99};
export function coverTitleFitsFrame(spec,slot,text,size=null,free=new Set()){
 const node=spec?.nodes?.find(item=>item.nativeRef?.shapeId===slot?.shapeId);
 if(!node)return nativeTitleFitsFrame(spec,slot,text);
 return coverTitleSizes(node).some(pt=>nativeTitleFitsFrame(spec,coverTitleSlot(slot),text,{...node,style:{...node.style,fontSizePt:pt}}))||Boolean(size&&coverTitleGrowth(spec,slot,text,size,free));
}
/** A cover title that does not fit its frame even at 28 pt grows the frame
 * downward into free cover space (Fable 2026-11-01, option P: the JEPA paper's
 * title needs two lines where Mood-Board's frame holds one): the smallest
 * height, in 0.05 in steps, at which it fits at 28 pt, while the grown frame
 * stays inside the slide's bottom margin and overlaps no template object it
 * did not already overlap. Returns {geometry, fontSizePt} or null. */
export function coverTitleGrowth(spec,slot,text,size,free=new Set()){
 const node=spec?.nodes?.find(item=>item.nativeRef?.shapeId===slot?.shapeId),g=node?.geometry;
 if(!g||!size?.height)return null;
 const pt=coverTitleSizes(node).at(-1),step=Math.round(.05*914400),limit=size.height-Math.round(.25*914400);
 const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
 const background=item=>item.geometry.width>=.9*size.width&&item.geometry.height>=.9*size.height;
 // A slot the cover leaves empty (free) is space the title may take.
 const others=(spec.nodes||[]).filter(item=>item!==node&&item.geometry&&!item.hidden&&!background(item)&&!free.has(String(item.nativeRef?.shapeId)));
 for(let height=g.height+step;g.y+height<=limit;height+=step){
  const grown={...g,height};
  if(others.some(item=>overlaps(grown,item.geometry)&&!overlaps(g,item.geometry)))return null;
  if(nativeTitleFitsFrame(spec,coverTitleSlot(slot),text,{...node,geometry:grown,style:{...node.style,fontSizePt:pt}},{rendered:true}))return{geometry:grown,fontSizePt:pt};
 }
 return null;
}
/** The same native title budget is checked before confirmation and by every
 * writer. A body fit cannot authorize an oversized frozen title. */
export function inspectNativeOutlineTitles(project, outline = project.outline || []) {
  if (project.templateFidelity?.mode !== 'preserve') return [];
  const conflicts = outline.flatMap((slide, pageIndex) => {
    const source=project.templateFidelity.slides[pageIndex] || { nodes: [] };
    return effectiveSlots({...source,nodes:source.nodes||[],slots:source.slots||slotsFor(source)})
    .filter(slot => slot.role === 'title' && visualUnits(slide.title) > slotCapacity(slot, slide) && !(pageIndex===0?coverTitleFitsFrame(source,slot,slide.title,project.templateFidelity):nativeTitleFitsFrame(source,slot,slide.title)))
    .map(slot => ({ code: 'planned_native_title_overflow', severity: 'error', pageIndex, field: 'title',
      maxLength: 160, reason: 'native_title_capacity', capacityVisualUnits: slotCapacity(slot, slide),
      requiredLanguages: [deckLanguageName(project)],...topicRangeConstraint(slide),...(!project.confirmedOutline?{topicLanguage:deckLanguage(project)}:{}),
      ...(pageIndex===0&&nativeCoverTitleHierarchy(project)?{titleHierarchy:'short headline + complete deck-language source subject in a measured subtitle; use its audited topic-title projection when present; all original title languages remain in source/notes, not parallel topic labels'}:{}),
      usedVisualUnits: visualUnits(slide.title), shapeId: slot.shapeId, fontSizePt: slot.fontSizePt,
      message: (cardsFlow(project)?(pageIndex===0?`Cover headline: at most ${Math.floor(slotCapacity(slot, slide)/.55)} characters (${slotCapacity(slot, slide)} for Chinese) of the title's own words; the full title is printed beneath. Edit the cover title.`:`Page ${pageIndex + 1}: the title is longer than its slot holds (at most about ${Math.floor(slotCapacity(slot, slide)/.55)} characters, ${slotCapacity(slot, slide)} for Chinese). Shorten it in the outline.`):`Page ${pageIndex + 1} title exceeds its unchanged native ${slot.fontSizePt}pt slot (${slotCapacity(slot, slide)} visual units). Shorten the topic label BEFORE confirmation; preserve the complete deck-language source subject in the measured cover subtitle and the original heading/facts in source/notes.`) }));
  });
  // Resume the already confirmed plan verbatim. A new identity rule cannot
  // retroactively invalidate its metadata or force a second confirmation.
  // Physical title capacity checks above still apply on resume.
  if (project.confirmedOutline) return conflicts;
  // Merge topic language and physical capacity into one delta per field.
  // Native title repair batches cannot contain two updates for one title.
  for(const languageIssue of inspectOutlineTopicLanguages(project,outline)){
    const existing=conflicts.find(issue=>issue.pageIndex===languageIssue.pageIndex&&issue.field===languageIssue.field);
    if(existing)Object.assign(existing,{topicLanguage:languageIssue.topicLanguage,requiredTopicRange:languageIssue.requiredTopicRange,topicRangeKind:languageIssue.topicRangeKind,requiredLanguages:languageIssue.requiredLanguages,message:existing.message+' '+languageIssue.message});
    else conflicts.push(languageIssue);
  }
  // Capacity partitions need distinct visible identities too. Do this before
  // confirmation; writers must never rename a frozen, user-approved outline.
  // A user-locked title is intentional and stays unchanged.
  const seen = new Map();
  outline.forEach((slide, pageIndex) => {
    if (!pageIndex || ['cover', 'navigation', 'section'].includes(slide.role)) return;
    const key = String(slide.title || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
    if (!key) return;
    const prior = seen.get(key);
    if (prior === undefined) { seen.set(key, pageIndex); return; }
    if (slide.titleLocked || slide.title_locked) return;
    const message = `Page ${pageIndex + 1} repeats the visible title of page ${prior + 1}. Name its own source-supported incremental message, or an explicit table continuation with its actual row labels. Use only the deck topic language; do not invent facts or change source owners, page count or selection.`;
    const existing = conflicts.find(c => c.pageIndex === pageIndex && c.field === 'title');
    // Fable (2026-10-23): on a card deck a repeated title is a review note; nothing downstream needs unique titles.
    if (cardsFlow(project)) { if (!existing) conflicts.push({ code: 'planned_title_identity_duplicate', severity: 'warning', reviewNote: true, originalSeverity: 'error', pageIndex, field: 'title', maxLength: 160,
      reason: 'duplicate_visible_title', duplicatesPageIndex: prior, message: `Page ${pageIndex + 1} shows the same title as page ${prior + 1}; give one a more specific title, or keep it for a continuation.` }); return; }
    if (existing) { existing.message += ' ' + message; existing.duplicatesPageIndex = prior; }
    else conflicts.push({ code: 'planned_title_identity_duplicate', severity: 'error', pageIndex, field: 'title', maxLength: 160,
      reason: 'duplicate_visible_title_before_confirmation', duplicatesPageIndex: prior, message,...topicRangeConstraint(slide),topicLanguage:deckLanguage(project),
      requiredLanguages: [deckLanguageName(project)] });
  });
  return conflicts;
}
export function inspectNativeCoverTitle(project,outline=project.outline||[]) {
  if(!nativeCoverTitleHierarchy(project)||!outline.length)return [];
  const probe={...project,outline,deck:{slides:outline.map(s=>({id:s.id,title:s.title,section:s.section,nodes:[]}))}};
  bindTemplateFidelity(probe,{slideIds:[outline[0].id]});
  const cover=probe.deck.slides[0],issues=inspectCoverTitle(probe,[cover]);
  for(const node of cover.nodes.filter(n=>n.type==='text'&&(n.semanticRole==='template-title'||n.content?.derivedFrom==='document-title'))){
    const fit=measureText({...node,kind:'text',bounds:node.geometry});
    if(fit.overflow)issues.push({code:'planned_native_cover_title_overflow',severity:'error',message:'The unchanged-font cover headline/full-source subtitle does not fit its actual frame.',details:{nodeId:node.id,fit}});
  }
  const headline=cover.nodes.find(n=>n.semanticRole==='template-title'),subtitle=cover.nodes.find(n=>n.content?.derivedFrom==='document-title');
  if(headline&&subtitle&&headline.geometry.y+headline.geometry.height>subtitle.geometry.y)
    issues.push({code:'planned_native_cover_title_overlap',severity:'error',message:'The cover headline overlaps its complete source-title subtitle.'});
  return issues;
}
export function inspectTemplateSlotDraft(project, index, slide) {
  const spec = project.templateFidelity?.slides?.[index];
  if (!spec) return [];
  const slots = effectiveSlots(spec);
  const omitted = new Set((slide.templateOmissions || []).map(item => String(item.shapeId)));
  const emptyClosingIds=new Set(closingTemplateOmissions(project,slide,index,{validate:true}).map(o=>String(o.shapeId)));
  const invalidOmissions = [...omitted].filter(id => !spec.nodes.some(node => String(node.nativeRef?.shapeId) === id &&
    (['image', 'chart', 'table'].includes(node.type) || (node.type === 'text' && slots.some(slot => String(slot.shapeId) === id && (slot.role === 'content' ||
      // A card cover with no label of its own leaves its section slot out (deterministicCoverDraft).
      slot.role === 'section' && index === 0 && slide.cardPage?.mode === 'cover' ||
      // A section label its header pill cannot hold on one line (Fable D4).
      slot.role === 'section' && slide.templateOmissions.some(o=>String(o.shapeId)===id && o.automatic && o.approvalBasis==='header_pill_fit')))) ||
      // The pill of that label, or a frame of template text the page leaves out (Fable D4).
      (node.type === 'shape' && slide.templateOmissions.some(o=>String(o.shapeId)===id && o.automatic && o.approvalBasis==='header_pill_fit')) ||
      (node.content?.templateSample && ['design_only','keep_fixed'].includes(project.templateContentMode)) ||
      emptyClosingIds.has(id) || slide.templateOmissions.some(o=>String(o.shapeId)===id && o.version===1 && o.approvalBasis==='user_editor_delete') ||
      // A card page drops a left-out group's decorations with it (3143, 367a72d8).
      ((node.type === 'shape' || node.type === 'foreign' && slide.fillLeadAsSubtitle || node.type === 'text' && node.semanticRole === 'ordinal') && slide.templateOmissions.some(o=>String(o.shapeId)===id && o.automatic && ['card_group_omitted','title_hierarchy_carrier'].includes(o.approvalBasis))) || // ...and a title-only closing its content region (the user, 2026-10-31: "感谢观看" only).
      ((slide.sourceArtifactNodes?.length || slide.cardPage?.mode==='theme' && slide.cardPage?.shape==='closing') && slide.templateOmissions.some(o=>String(o.shapeId)===id && o.automatic && o.approvalBasis==='source_region_replacement')))));
  const omissionIssues = invalidOmissions.map(id => ({ code: 'template_omission_invalid', severity: 'error',
    message: `模板第 ${index + 1} 页组件 ${id} 不是可省略的内容或媒体`, repair: 'fill_template_slots', shapeId: Number(id) }));
  const issues = slots.filter(slot => slot.role !== 'static' && !omitted.has(String(slot.shapeId))).flatMap(slot => {
    const value = slot.role === 'title' ? slide.title : slot.role === 'section'
      ? (slide.section || slide.templateSlotTexts?.[String(slot.shapeId)]) : slide.templateSlotTexts?.[String(slot.shapeId)];
    if(project.generationPolicy?.version===2&&slot.role==='section'&&typeof value==='string'){
      const outline=project.outline?.[index]||slide,language=pageTopicLanguage(project,outline),pair=outline.titlePair;
      const translated=project.generationPolicy.language?.mode==='source'&&pair?.secondary===value;
      const headingName=text=>String(text).replace(/^\d+(?:\.\d+)*[.\s]+/u,'').trim();
      const exactSourceHeading=(project.source?.semantic?.inventory?.items||[]).filter(i=>outline.sourceUnitIds?.includes(i.id)).some(i=>(i.sectionPath||[]).some(h=>headingName(h)===headingName(value)));
      if(!translated&&!exactSourceHeading&&topicLanguageMismatch(value,language))return [{code:'template_slot_language_mismatch',severity:'error',message:`Page ${index+1} section slot ${slot.shapeId} must use ${language}; translate only this automatic label, preserving source, body and font.`,repair:'fill_template_slots',shapeId:slot.shapeId,slotRole:'section',expectedLanguage:language,capacity:slot.capacity}];
    }
    // Sibling list slots share a page's points round-robin (Fable D2): one may hold fewer items.
    if (slot.purpose === 'list') return inspectListSlot(slot, value, index, {balanced:slots.filter(item=>item.purpose==='list'&&item.role==='content'&&!omitted.has(String(item.shapeId))).length>1});
    const used = visualUnits(value);
    // A page title is the outline's: the outline checks it with this same
    // predicate (cardTopicProblems) and the writer cannot change it, so it
    // never fails the writer (Fable, 2026-10-26; 3143 g2u page 9).
    if (incompletePhrase(value) && !lockedOutlineTitle(project, index, slot, value)) return [{ code: 'template_text_fragment', severity: 'error',
      message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} 停在句中，需写完整短句或短标签`, repair: 'fill_template_slots', shapeId: slot.shapeId }];
    const heading = slot.pairedWith ? slide.templateSlotTexts?.[String(slot.pairedWith)] : '';
    if (slot.pairedWith && explanationRepeatsHeading(heading, value)) return [{ code: 'template_description_repeats_heading', severity: 'error',
      message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} 重复要点标题，应补充解释`, repair: 'fill_template_slots', shapeId: slot.shapeId }];
    if (used > 0 && (used <= slotCapacity(slot, slide) || nativeTitleFitsFrame(spec,slot,value)) && (!slot.minVisualUnits || used >= slot.minVisualUnits)) return [];
    const code = !used ? 'template_slot_unfilled' : used > slotCapacity(slot, slide) ? 'template_slot_overflow' : 'template_description_too_short';
    return [{ code, severity: 'error',
      message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} ${!used ? '必须填写' : used > slotCapacity(slot, slide) ? `需要缩短至 ${slotCapacity(slot, slide)} visual units` : `说明应达到至少 ${slot.minVisualUnits} visual units，并解释对应要点`}`,
      repair: 'fill_template_slots', shapeId: slot.shapeId, slotRole: slot.role, capacity: slot.capacity, minVisualUnits: slot.minVisualUnits }];
  });
  issues.push(...omissionIssues);
  // Old template text left in a slot is caught before the deck gate, so the
  // writer gets a repair round (report 84f9e527, gap 5).
  for (const slot of slots.filter(item => item.role !== 'static' && !omitted.has(String(item.shapeId)))) {
    const raw = slot.role === 'title' ? slide.title : slide.templateSlotTexts?.[String(slot.shapeId)];
    const values = Array.isArray(raw) ? raw.flatMap(item => [item?.label, item?.body]) : [raw];
    const leak = values.map(value => templateLeak(project, value)).find(Boolean);
    if (leak) issues.push({ code: 'template_content_leak', severity: 'error', repair: 'fill_template_slots', shapeId: slot.shapeId,
      message: `模板第 ${index + 1} 页槽位 ${slot.shapeId} 仍是模板原有内容（"${leak.slice(0, 60)}"）；请改写为本页内容或省略该槽位` });
  }
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
  // A card page shows its card's points: its density was chosen in the outline,
  // so the layout's fill targets do not apply (found on 3143, 1a1631c4 page 7).
  const card = cardsFlow(project);
  if (!card && richSource && contract?.role !== 'section' && index > 0 && index < (project.pages || project.outline?.length || Infinity) - 1) {
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
  if (!card && target && activeGroups < target) issues.push({ code: 'template_point_coverage', severity: 'error',
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

export {fitNativeTitleFrames} from './ppt-native-text-fit.mjs';

/** A title never breaks inside a word (Fable 2026-11-02, N7: "CodePilot PPT 模
 * / 块"): a title with Chinese that needs more than one line is broken at
 * whole chunks (spaces, punctuation, a change between Latin and Chinese),
 * a too-long Chinese run at its word boundaries, as explicit line breaks
 * measured on the title's own frame. Unchanged when it fits on one line or
 * the breaks would need more lines than the frame holds. */
const TITLE_CJK=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export function wordSafeTitle(node,title,maxLines=2){
  const text=String(title??'');
  // A navigation number (a row range, a part counter) is verified at its offset in the title: never re-broken.
  if(!TITLE_CJK.test(text)||text.includes('\n')||!node?.geometry?.width||/[（(][^)）]*\d[^)）]*[)）]\s*$|·\s*\d+\s*\/\s*\d+\s*$/u.test(text))return text;
  const shown=normalizeTypography(text,Infinity),element=line=>({...node,semanticRole:'template-title',kind:'text',bounds:{...node.geometry,height:node.geometry.height*20},content:{text:line}});
  const lines=line=>measureText(element(line)).lines;
  if(lines(shown)<=1)return text;
  const measured=new Map(),fit=line=>{if(!measured.has(line))measured.set(line,lines(line)<=1);return measured.get(line);};
  const breaks=titleBreaks(shown),max=Math.max(2,Number(maxLines)||2);
  // Only word breaks first (rank 1 or better), then any word boundary; within
  // that, the fewest lines that fit, then the most even lines.
  const found=[];
  for(let count=2;count<=max;count++){
    let best=null;
    const visit=(start,from,chosen)=>{
      if(chosen.length===count-1){
        const cuts=[0,...chosen.map(b=>b.at),shown.length],parts=cuts.slice(1).map((end,k)=>shown.slice(cuts[k],end).trim());
        if(parts.some(part=>!part||!fit(part)))return;
        const sizes=parts.map(part=>visualUnits(part)),score=[Math.max(...chosen.map(b=>b.rank)),Math.max(...sizes)-Math.min(...sizes)];
        if(!best||score[0]<best.score[0]||score[0]===best.score[0]&&score[1]<best.score[1])best={score,text:parts.join('\n')};
        return;
      }
      for(let k=from;k<breaks.length;k++){const part=shown.slice(start,breaks[k].at).trim();if(part&&!fit(part))break;visit(breaks[k].at,k+1,[...chosen,breaks[k]]);}
    };
    visit(0,0,[]);
    if(best)found.push(best);
  }
  return (found.find(entry=>entry.score[0]<=1)||[...found].sort((a,b)=>a.score[0]-b.score[0])[0])?.text??text;
}
const OPENING=/[（(「『《【\[“‘]/u,CLOSING=/[，。：；、）)」』》】\]！？,.:;!?”’]/u;
/** Where a title may break, ranked: 0 at a space, after closing or before
 * opening punctuation, or between Latin and Han; 1 between two words of two or
 * more characters; 2 after a run of lone characters, before a word ("点|方案");
 * 3 before a lone character, which ICU leaves when its dictionary misses a
 * compound ("知识|库|试|点", "链|路|图"). Never before
 * closing or after opening punctuation, nor inside a Latin word. */
function titleBreaks(text){
  const segments=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(text)],out=[];
  for(let k=1;k<segments.length;k++){
    const at=segments[k].index,before=text[at-1],after=text[at],left=segments[k-1].segment,right=segments[k].segment;
    if(CLOSING.test(after)||OPENING.test(before))continue;
    const han=char=>/\p{Script=Han}/u.test(char);
    const rank=/\s/u.test(before)||/\s/u.test(after)||CLOSING.test(before)||OPENING.test(after)||han(before)!==han(after)&&/[\p{L}\p{N}]/u.test(before)&&/[\p{L}\p{N}]/u.test(after)?0:
      !han(before)&&!han(after)?4:[...left.trim()].length>1&&[...right.trim()].length>1?1:
      // Lone characters are words the dictionary missed ("知识|库", "链|路|图"):
      // they stay with what precedes them; a break where the next word starts is safer.
      [...right.trim()].length>1?2:3;
    if(rank<4)out.push({at,rank});
  }
  return out;
}

/** A template sample icon on a card content page (Fable 2026-11-02, N1): a
 * small template_icon picture below the title band; never on the cover, a
 * frame page or a figure page, never a protected or replaced picture. */
export function isSampleIcon(project,spec,node){
  const size=project.templateFidelity||{};
  // The repeat layouts' icon rotation swaps one sample icon for another; it is
  // no replacement by the user or the writer (live Portfolio, 2026-11-02: a
  // heart and a star beside parameter counts).
  return node.type==='image'&&node.geometry&&!node.content?.mustPreserve&&(!node.content?.mediaReplacement||node.content?.iconRotation===true)&&!node.content?.mediaSourceId&&
    templateMediaRole(node,spec,size)==='template_icon'&&node.geometry.y>=(size.height||6858000)*.18&&
    // An icon is roughly square and big enough to hold a digit; a hairline is not one.
    Math.min(node.geometry.width,node.geometry.height)>=109728&&node.geometry.width<=2*node.geometry.height&&node.geometry.height<=2*node.geometry.width;
}
function sampleIconNodes(project,index,spec,slide){
  const page=project.outline?.[index];
  if(!cardsFlow(project)||!slide.cardPage||index===0||!page||page.cardFrame||page.figurePage||slide.locked)return [];
  const omissions=new Map((slide.templateOmissions||[]).map(item=>[String(item.shapeId),item]));
  // An icon the card-group step left out still marks its row when the row's text is shown (live 3197, MCP xlsx p2: rows 1-2 numbered, row 3 not).
  const shownText=(spec.nodes||[]).filter(node=>node.type==='text'&&node.geometry&&!omissions.has(String(node.nativeRef?.shapeId)));
  const rowShown=icon=>shownText.some(node=>{const c=node.geometry.y+node.geometry.height/2;return node.geometry.x>icon.geometry.x&&c>=icon.geometry.y&&c<=icon.geometry.y+icon.geometry.height;});
  return (spec.nodes||[]).filter(node=>{if(!isSampleIcon(project,spec,node))return false;const record=omissions.get(String(node.nativeRef?.shapeId));return !record||record.approvalBasis==='sample_icon_marker'||record.approvalBasis==='card_group_omitted'&&rowShown(node);});
}
/** One numbered marker per replaced icon, in reading order, centred where the
 * icon was, readable on the shape it sits on (a chevron, a circle). */
export function numberedMarkers(project,index,spec,slide,icons,live=spec.nodes||[]){
  const size=project.templateFidelity||{},rowBand=(size.height||6858000)*.06;
  const ordered=[...icons].sort((a,b)=>Math.abs(a.geometry.y-b.geometry.y)<rowBand?a.geometry.x-b.geometry.x:a.geometry.y-b.geometry.y);
  const centre=g=>({x:g.x+g.width/2,y:g.y+g.height/2});
  const carrier=g=>{const c=centre(g);return live.find(node=>node.type==='shape'&&node.geometry&&node.geometry.x<=c.x&&c.x<=node.geometry.x+node.geometry.width&&node.geometry.y<=c.y&&c.y<=node.geometry.y+node.geometry.height&&(node.style?.fill||node.content?.fill));};
  return ordered.map((icon,k)=>{
    const g=icon.geometry,fill=carrier(g)?.style?.fill||carrier(g)?.content?.fill;
    const color=templateTextColor(project,index,'body',typeof fill==='string'?fill:undefined);
    return{id:stableId('node',slide.id,'template-marker',k),type:'text',semanticRole:'template-marker',slotId:'absolute',geometry:{...g},
      content:{text:String(k+1),derivedFrom:'sample-icon-marker',markerFor:String(icon.nativeRef?.shapeId)},
      style:{fontSizePt:Math.max(10,Math.min(28,Math.round(g.height/12700*.55))),fontWeight:700,align:'center',verticalAlign:'middle',
        fontFamily:project.templateSpec?.fonts?.heading||project.templateSpec?.fonts?.body,color:color.color,colorBasis:color.basis},zIndex:502};
  });
}

export function bindTemplateFidelity(project,{slideIds=null}={}) {
  normalizeDeckEyebrows(project);
  if (project.templateFidelity?.mode !== 'preserve') {
    bindMappedTemplateMedia(project);
    for(const slide of project.deck?.slides||[]) {
      const contract=project.planning?.slidePlan?.find(x=>x.slideId===slide.id)?.pageContract;
      if(!slide.componentPrepared&&!slide.locked&&contract?.compositionCandidates?.includes('formula-variables')&&slide.nodes.filter(x=>x.sourceArtifact).length===1&&slide.nodes.some(x=>x.content?.mathMl||x.content?.latex))slide.layoutId=slide.layoutRef='formula-variables';
      if(!slide.componentPrepared&&!slide.locked&&contract?.compositionCandidates?.includes('two-panel')&&slide.nodes?.filter(x=>x.sourceArtifact).length===2)slide.layoutId=slide.layoutRef='two-panel';
      prepareComponentGeometry(project,slide);
      bindTitleHierarchy(project,slide,project.deck.slides.indexOf(slide));bindCardLead(project,slide,project.deck.slides.indexOf(slide));
    }
    return bindNotesDisclosures(project);
  }
  if (project.deck?.slides?.length !== project.templateFidelity.slides.length) throw new Error('template slide count mismatch');
  project.deck.slides.forEach((slide, index) => {
    if(slideIds&&!slideIds.includes(slide.id))return;
    const source = project.templateFidelity.slides[index];
    const ordinals = ordinalReadingOrder(source.nodes, project.templateFidelity);
    const slotById = new Map(effectiveSlots(source).map(slot => [String(slot.shapeId), slot]));
    const provided = slide.templateSlotTexts || {};
    // Plain model omission requests cannot authorize loss of unclassified or
    // protected media. Keep the exact native asset in its reserved region.
    const rejected=(slide.templateOmissions||[]).filter(record=>record.version===undefined&&source.nodes.some(node=>
      String(node.nativeRef?.shapeId)===String(record.shapeId)&&['image','chart','table'].includes(node.type)&&
      !['template_decoration','template_icon','template_artwork'].includes(templateMediaRole(node,source,project.templateFidelity))));
    if(rejected.length){slide.templateRejectedOmissions=[...(slide.templateRejectedOmissions||[]),...rejected];slide.templateOmissions=slide.templateOmissions.filter(record=>!rejected.includes(record));}
    slide.templateOmissions=[...(slide.templateOmissions||[]),...autoTemplateMediaOmissions(project,index,slide.templateOmissions||[])];
    slide.templateOmissions=[...new Map([...slide.templateOmissions,...closingTemplateOmissions(project,slide,index)].map(o=>[String(o.shapeId),o])).values()];
    // A card page shows numbered markers, never the template's sample icons
    // (Fable 2026-11-02, N1: a heart and a star beside points about a knowledge base).
    const sampleIcons=sampleIconNodes(project,index,source,slide);
    for(const node of sampleIcons)if(!slide.templateOmissions.some(item=>String(item.shapeId)===String(node.nativeRef?.shapeId)))
      slide.templateOmissions.push(adaptationDisposition(project,node,'template_icon','sample_icon_marker','A template sample icon is shown as a numbered marker.'));
    // A layout-only page declares every shape of its cloned frame it leaves out (Fable G5).
    if(source.layoutOnly){const original=project.templateFidelity.sourceCatalog?.[source.sourceIndex]||{nodes:[]};
      for(const id of source.layoutOnlyOmitted||[]){if(slide.templateOmissions.some(item=>String(item.shapeId)===String(id)))continue;const base=(original.nodes||[]).find(node=>String(node.nativeRef?.shapeId)===String(id));
        if(base)slide.templateOmissions.push(adaptationDisposition(project,base,templateMediaRole(base,original,project.templateFidelity),'layout_only_page','A layout-only page shows the frame layout with its title and eyebrow; the frame\'s own shapes are left out.'));}}
    const omitted = new Set((slide.templateOmissions || []).map(item => String(item.shapeId)));
    const priorNodes=new Map((slide.nodes||[]).filter(node=>node.nativeRef).map(node=>[node.id,node]));
    const clamped=[];
    const native = source.nodes.filter(base => !omitted.has(String(base.nativeRef?.shapeId))).map(base => {
      // A native template is the initial frame, not permission to overwrite a
      // user's locked object on resume, preview or a later copy-repair bind.
      // It belongs to the page now at this index (a template picture is locked
      // by default; live fz-r29 p21 kept index 19 after a continuation moved it).
      const retained=slide.nodes?.find(node=>node.id===base.id&&node.locked);
      if(retained){const kept=structuredClone(retained);if(kept.nativeRef&&Number.isInteger(base.nativeRef?.slideIndex)&&kept.nativeRef.slideIndex!==base.nativeRef.slideIndex)kept.nativeRef={...kept.nativeRef,slideIndex:base.nativeRef.slideIndex};return kept;}
      const node = structuredClone(base);
      if(node.nativeTextFrame)node.nativeTextFrame={...node.nativeTextFrame,originalHeight:node.nativeTextFrame.originalHeight||base.geometry?.height};
      if (ordinals.has(node.nativeRef?.shapeId)) node.content = { ...node.content, text: ordinals.get(node.nativeRef.shapeId) };
      const slot = slotById.get(String(node.nativeRef?.shapeId));
      if (slot && slot.role !== 'static') {
        let text = provided[String(slot.shapeId)];
        // A card page's slot size (cardSlotFont); the export writes it as a run override.
        if (Number(slide.templateSlotFonts?.[String(slot.shapeId)]) > 0) node.style = { ...node.style, fontSizePt: Number(slide.templateSlotFonts[String(slot.shapeId)]) };
        if (slide.templateSlotPlain?.includes(String(slot.shapeId))) node.content = { ...node.content, plainBody: true };
        if (slot.role === 'title') text = wordSafeTitle(node, slide.title, slot.maxLines);
        if (slot.role === 'section') text = slide.section || text;
        // F-P1-11: an unwrapped section label measured past its example width
        // runs toward the title's right edge, never over another object.
        if (slot.role === 'section' && slide.sectionLabel?.width > node.geometry.width && slide.sectionLabel.shapeId === slot.shapeId) node.geometry = { ...node.geometry, width: slide.sectionLabel.width };
        if (slot.role === 'section' && slide.sectionLabel?.height > node.geometry.height && slide.sectionLabel.shapeId === slot.shapeId) node.geometry = { ...node.geometry, height: slide.sectionLabel.height };
        const paragraphs = slot.purpose === 'list' ? slotParagraphs(text) : null;
        node.content = { ...node.content, text: paragraphs ? paragraphs.map(item => [item.label, item.body].filter(Boolean).join('：')).join('\n') : typeof text === 'string' ? text.trim() : '',
          templateFit: Boolean(node.nativeTextFrame), ...(paragraphs ? { paragraphs } : {}) };
        if (node.nativeTextFrame?.paragraphs) for (const paragraph of node.nativeTextFrame.paragraphs) {
          if (Number(paragraph.lineSpacing) > 0 && Number(paragraph.lineSpacing) < 1.15) paragraph.lineSpacing = 1.15;
        }
        if(paragraphs)node.content=ensureRichContent(node.content);
        if(!paragraphs&&typeof text==='string'){const rich=sourceRichText(text);if(rich.runs.some(r=>r.kind==='math'||r.bold||r.italic||r.code)||rich.diagnostics.length)node.content={...node.content,...richTextContent(text)};}
        // A title broken at word boundaries keeps one paragraph: its breaks are line breaks (N7).
        if(slot.role==='title'&&typeof text==='string'&&text.includes('\n'))node.content={...node.content,...richTextContent(text)};
        node.semanticRole = slot.role === 'title' ? 'template-title' : 'template-text';
        node.locked = false;
        node.templateSlot = { role: slot.role, purpose: slot.purpose, pairedWith: slot.pairedWith, groupId: slot.groupId,
          minVisualUnits: slot.minVisualUnits, capacity: slot.capacity,
          mapped: paragraphs ? paragraphs.length === slot.paragraphCount && paragraphs.every(item => item.body) : typeof text === 'string' && Boolean(text.trim()) };
        if(node.frameClamped)clamped.push({shapeId:slot.shapeId,byEmu:node.frameClamped});
      }
      const prior=priorNodes.get(node.id);
      if(prior?.userStyle){node.style=structuredClone(prior.style);node.textStyleOverrides=prior.textStyleOverrides;node.userStyle=true;}
      if(prior?.userGeometry){node.geometry=structuredClone(prior.geometry);node.userGeometry=true;}
      return node;
    });
    if(clamped.length)slide.frameClamped=clamped;else delete slide.frameClamped;
    slide.templateSlideIndex = index;
    slide.templateShapeCount = source.shapeCount - omitted.size;
    slide.templateImageCount = source.imageCount - source.nodes.filter(node => omitted.has(String(node.nativeRef?.shapeId)) && node.type === 'image').length;
    // Re-apply measured adaptations (re-anchored card icons) made when source
    // structures were bound; rebuilding from the IR must not undo them.
    for (const adaptation of slide.templateAdaptations || []) {
      const node = native.find(item => String(item.nativeRef?.shapeId) === String(adaptation.shapeId));
      if (node && adaptation.geometry) {node.geometry = { ...adaptation.geometry };if(adaptation.componentBinding)node.templateComponentBinding=adaptation.componentBinding;if(adaptation.style)node.style={...node.style,...adaptation.style};}
    }
    // Component clones belong to the page now at this index (live mlq-r31 p40: badge
    // clones kept index 36 after continuations moved the page to 39; no render mapping).
    if (slide.templateComponentClones?.length) slide.templateComponentClones = slide.templateComponentClones.map(node => node.nativeRef && node.nativeRef.slideIndex !== index ? { ...node, nativeRef: { ...node.nativeRef, slideIndex: index } } : node);
    // Badge clones are the template's icons too: they become markers as well (N1).
    const iconClones=sampleIcons.length||slide.cardPage?(slide.templateComponentClones||[]).filter(node=>node.type==='image'&&isSampleIcon(project,source,node)):[];
    // They stay in the clone list (a second bind marks them again) and are left out of the page.
    slide.nodes = removeNativeTitleAlias(slide.id, [...slide.nodes.filter(node => !node.nativeRef&&node.semanticRole!=='template-marker'), ...native, ...(slide.templateComponentClones||[]).filter(node=>!iconClones.includes(node)),
      // A template icon re-anchored above its card (a badge) is marked where it now
      // is, on the shape it now sits on (live Deal-Review p9: digits stayed in the
      // template's old row, one on another badge's fill at 1:1).
      ...numberedMarkers(project,index,source,slide,[...sampleIcons.map(icon=>{const moved=(slide.templateAdaptations||[]).find(item=>String(item.shapeId)===String(icon.nativeRef?.shapeId)&&item.geometry);return moved?{...icon,geometry:{...moved.geometry}}:icon;}),...iconClones],[...native,...(slide.templateComponentClones||[])])]);
    // Native card nodes do not exist at normalizeSlide's earlier cleanup.
    // Retire certified unbound frames only after the final native bind too.
    if(cardsFlow(project)&&slide.cardPage){
      retireUnboundContainers(project,slide,index);
      // A chrome painting shown on a nearby page becomes a flat panel (2026-11-02).
      applyChromeFallback(project,slide,index);
      const finalOmitted=new Set((slide.templateOmissions||[]).map(item=>String(item.shapeId)));
      slide.templateShapeCount=source.shapeCount-finalOmitted.size;
      slide.templateImageCount=source.imageCount-source.nodes.filter(node=>finalOmitted.has(String(node.nativeRef?.shapeId))&&node.type==='image').length;
    }
    if (index === 0) bindDerivedCoverSubtitle(project, slide, source);
    // The header pill and readable written text (Fable D3/D4) once the slot texts are written.
    if (cardsFlow(project)) { fitHeaderPills(project, slide, index); readableWrittenText(project, slide, index); }
    fitNativeTextFrames(project, slide);
    bindTitleHierarchy(project,slide,index);bindCardLead(project,slide,index);
    // The layout's picture (Portfolio's cover photo) as a pinned node behind everything (Fable G1).
    applyLayoutPicture(project, slide, index);
    // A content slot whose own picture is used shows a borrowed one (Fable G2).
    applyContentSlotPictures(project, slide, index);
    // A filled page's figures in its own figure slots (fill-template-first).
    applyFillPictures(project, slide, index, project.outline?.[index]);
    slide.nodeOrder = slide.nodes.map(node => node.id);
  });
  return bindNotesDisclosures(project);
}

/** F-P0-2: a template cover with only a title slot cannot show the source's
 * subtitle or second-language title. Add one measured text box under the title
 * (template body size and colour), only when it fits beside the artwork. */
export function bindDerivedCoverSubtitle(project, slide, source) {
  slide.nodes = (slide.nodes || []).filter(node => node.content?.derivedFrom !== 'document-title');
  if (project.deckTitle?.source === 'user') return;
  const title = displayedDocumentTitle(project);
  const titleNode = slide.nodes.find(node => node.semanticRole === 'template-title');
  if (!title || !titleNode?.geometry) return;
  if ((source.slots || []).some(slot => slot.role === 'content' || slot.purpose === 'subtitle')) return;
  const shown = String(slide.title || titleNode.content?.text || '').replace(/\s+/gu, '');
  const lines = title.variants.map(variant => shown.includes(variant.main.replace(/\s+/gu, '')) ? variant.subtitle : variant.text).filter(Boolean);
  if (!lines.length) return;
  const size = project.templateFidelity, g = titleNode.geometry, gap = 91440 * 1.5;
  const box = { x: g.x, y: g.y + g.height + gap, width: g.width, height: Math.max(0, size.height - (g.y + g.height + gap) - 457200) };
  const bodyPt = contentCanvas(project, 1).fontSizePt || 14;
  const blocked = (source.nodes || []).some(node => node.type === 'image' && node.geometry && node.geometry.width < size.width * .85 &&
    node.geometry.x < box.x + box.width && node.geometry.x + node.geometry.width > box.x && node.geometry.y < box.y + box.height && node.geometry.y + node.geometry.height > box.y);
  if (blocked || box.height < 91440 * 4) return;
  for (const candidate of [lines, title.variants.map(variant => variant.subtitle).filter(Boolean)]) {
    if (!candidate.length) continue;
    const content = richTextContent(candidate.join('\n'));
    const measured = measureComponent({ type: 'text', content }, box, bodyPt);
    if (measured.height > box.height || measured.width && measured.width > box.width) continue;
    const chosen = templateTextColor(project, 0, 'body');
    slide.nodes.push({ id: 'node_cover_subtitle_' + slide.id.slice(-12), type: 'text', semanticRole: 'source-explanation', slotId: 'absolute',
      geometry: { ...box, height: measured.height }, content: { ...content, derivedFrom: 'document-title', pointType: 'support' }, sourceRefs: [],
      style: { fontSizePt: bodyPt, fontFamily: project.templateSpec?.fonts?.body, eastAsiaFontFamily: project.templateSpec?.fonts?.bodyEastAsia, lineHeight: 1.18, paragraphSpacingEm: 0,
        color: chosen.color, colorBasis: chosen.basis, fill: source.background || project.templateSpec?.palette?.background || '#ffffff' }, zIndex: 500 });
    return;
  }
}

export async function renderTemplatePptx(project,io={}) {
  if (project.templateFidelity?.mode !== 'preserve') throw new Error('template fidelity is unavailable');
  if(project.templateContentMode==='keep_fixed'){
    const selected=new Set(project.templateFixedObjectIds||[]),catalog=project.templateFidelity.sourceCatalog||[];
    const missing=catalog.flatMap((slide,index)=>slide.nodes?.some(node=>selected.has(node.id))&&!project.templateFidelity.slideMap.includes(index)?[index+1]:[]);
    if(missing.length)throw new Error('template_fixed_objects_unmapped: selected fixed objects belong to unused template pages '+missing.join(', ')+'. Include those layouts or revise the fixed-object selection before exporting.');
  }
  const copy = { ...project, externalPptx: { originalPath: project.templateFidelity.originalPath, nativeIdNormalization:project.templateFidelity.nativeIdNormalization, inheritedActions:project.templateFidelity.inheritedActions||[] },
    templateSlideMap: project.templateFidelity.slideMap,
    deck: { ...project.deck, slides: project.deck.slides.map(slide => ({ ...slide, nativeSlideIndex: slide.templateSlideIndex })) } };
  return renderImportedPptx(copy,io);
}

export function inspectTemplateFidelity(project) {
  if (project.templateFidelity?.mode !== 'preserve') return [];
  const issues = [];
  // Kept template pictures whose text could not be read (no OCR in this
  // runtime) may still show old content: a review warning, never silent (report 84f9e527).
  if (project.templateFidelity.imageTextUnchecked > 0) issues.push({ code: 'template_image_text_unchecked', severity: 'warning', repairable: false,
    message: `${project.templateFidelity.imageTextUnchecked} kept template picture(s) could not be read for old text${project.templateFidelity.imageTextReader==='tesseract_missing'?' (tesseract is not installed)':''}; they are kept: review them in the preview.` });
  // A picture that links out was the old deck's: it is left out, and listed (report a8725ccd).
  // Companion of template_content_leak: old content we removed by position (nothing leaked).
  const byPosition = (project.deck?.slides || []).flatMap((slide, page) => (slide.templateOmissions || []).filter(item => item.approvalBasis === 'old_content_by_position').map(item => `page ${page + 1} shape ${item.shapeId}`));
  if (byPosition.length) issues.push({ code: 'template_old_content_removed', severity: 'warning', repairable: false,
    message: `Template pictures in the content area of pages filled with new content were left out as the old deck's content (no reader could check them for old text): ${byPosition.join(', ')}.` });
  const substituted = project.templateFidelity.fontSubstitutions || [];
  if (substituted.length) issues.push({ code: 'template_font_compressed', severity: 'warning', repairable: false, fontSubstitutions: substituted,
    message: `The template embeds compressed fonts (${substituted.map(item => item.family).join(', ')}). The exported .pptx keeps them for PowerPoint and Keynote; this preview, the PDF and every text measurement used ${[...new Set(substituted.map(item => item.usedFamily))].join(', ')} instead, so text may wrap a little differently in PowerPoint.` });
  const linkedRetired = project.templateFidelity.linkedPicturesRetired || [];
  if (linkedRetired.length) issues.push({ code: 'template_linked_picture_retired', severity: 'warning', repairable: false,
    message: `${linkedRetired.length} template picture(s) linking to ${[...new Set(linkedRetired.map(item => { try { return new URL(item.href).hostname; } catch { return String(item.href).slice(0, 60); } }))].join(', ')} were left out as the old deck's attribution or brand; keep one in the fixed objects if it belongs to this deck.` });
  const variantKeys = new Set();
  const dominantMediaPages = new Map();
  project.deck?.slides?.forEach((slide, index) => {
    const source = project.templateFidelity.slides[index];
    for (const node of slide.nodes || []) if (node.templateTitleFrameAdaptation?.status === 'blocked') issues.push({ code: 'template_cjk_title_frame_capacity', severity: 'error', slideId: slide.id, nodeId: node.id, repairable: true, message: '原生标题的字形高度无法在相邻对象之间容纳；不能缩字或覆盖其他对象' });
    for(const node of slide.nodes||[])if(node.sectionDecorationFrameAdaptation?.status==='blocked')issues.push({code:'template_section_decoration_capacity',severity:'error',slideId:slide.id,nodeId:node.id,repairable:true,message:'The section label cannot fit its enclosing decoration without crossing a neighboring object; shorten the automatic label or adjust the layout.'});
    const native = slide.nodes.filter(node => node.nativeRef?.slideIndex === index);
    const originals=native.filter(node=>node.nativeRef.cloneFromShapeId===undefined),clones=native.filter(node=>node.nativeRef.cloneFromShapeId!==undefined);
    const omitted = new Set((slide.templateOmissions || []).map(item => String(item.shapeId)));
    const omittedImages = source?.nodes?.filter(node => omitted.has(String(node.nativeRef?.shapeId)) && node.type === 'image').length || 0;
    if (!source || !Array.isArray(source.nodes) || originals.length + omitted.size !== source.shapeCount || originals.filter(node => node.type === 'image').length + omittedImages !== source.imageCount ||
      new Set(originals.map(n=>n.nativeRef.shapeId)).size!==originals.length||source.nodes.some(n=>!originals.some(actual=>actual.nativeRef.shapeId===n.nativeRef.shapeId)&&!omitted.has(String(n.nativeRef.shapeId)))||
      [...omitted].some(id => !source.nodes.some(node => String(node.nativeRef?.shapeId) === id))) {
      issues.push({ code: 'template_asset_loss', severity: 'error', message: '模板图片或组件丢失', slideId: slide.id, repairable: false });
      return;
    }
    if(new Set(native.map(n=>n.nativeRef.shapeId)).size!==native.length||clones.some(n=>!(['image','shape'].includes(n.type) || n.type==='text'&&n.templateComponentBinding?.origin==='user')||!source.nodes.some(base=>base.type===n.type&&base.nativeRef.shapeId===n.nativeRef.cloneFromShapeId)||!n.templateComponentBinding?.componentSpecId||!Number.isInteger(n.templateComponentBinding.unitIndex)))issues.push({code:'template_component_clone_invalid',severity:'error',slideId:slide.id,message:'Native component clone has a duplicate identity, unsupported member or missing source/component binding.'});
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
      const catalog=project.templateFidelity.sourceCatalog?.[source.sourceIndex];
      const preserved=native.filter(node=>node.content?.mustPreserve);
      const fixedReuse=source.variant.kind==='fixed-content-preserved'&&project.templateContentMode==='keep_fixed'&&preserved.length>0&&preserved.every(node=>{
        const base=catalog?.nodes?.find(original=>original.nativeRef?.shapeId===node.nativeRef.shapeId);
        return base&&project.templateFixedObjectIds?.includes(base.id)&&base.content?.mustPreserve&&
          (node.userGeometry||JSON.stringify(node.geometry)===JSON.stringify(base.geometry))&&JSON.stringify(node.content?.crop)===JSON.stringify(base.content?.crop);
      });
      const variantKey = `${source.sourceIndex}:${source.variantId}`;
      if (variantKeys.has(variantKey)&&!fixedReuse) issues.push({ code: 'template_variant_duplicate', severity: 'error',
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
      if (!original || !visualChanged&&!fixedReuse) issues.push({ code: 'template_variant_unchanged', severity: 'error',
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
        issues.push(...inspectListSlot(slot, node?.content?.paragraphs, index, {balanced:effectiveSlots(source).filter(item=>item.purpose==='list'&&item.role==='content'&&!omitted.has(String(item.shapeId))).length>1}).map(item => ({ ...item, slideId: slide.id, repairable: false })));
        continue;
      }
      if (!node?.templateSlot?.mapped || !String(node.content?.text || '').trim()) issues.push({ code: 'template_slot_unfilled', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 未填写`, slideId: slide.id, repairable: false });
      else if (incompletePhrase(node.content.text) && !lockedOutlineTitle(project, index, slot, node.content.text)) issues.push({ code: 'template_text_fragment', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 停在句中`, slideId: slide.id, repairable: false });
      else if (visualUnits(node.content.text) > slotCapacity(slot, slide) && !nativeTitleFitsFrame(source,slot,node.content.text,node) && !(slot.role==='section'&&sectionFitsFrame(node))) issues.push({ code: 'template_slot_overflow', severity: 'error', message: `模板文字槽位 ${slot.shapeId} 超过容量`, slideId: slide.id, repairable: false });
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

export const _internals = { contentMediaCandidates, sourceMediaFor, cloneTemplateValue, slotsFor, visualUnits, incompletePhrase, buildFidelity, variantGeometry, profileSourceSlide, panelSwapGeometry, ordinalReadingOrder, expandSafeDescriptions, reclaimedMediaTextFrames, safeDecorativeMedia, textOverlayCalloutPanel, contentCoverageIssues, detailEvidenceText };

/** A card page that overflows its frame during generation moves to another
 * content frame that holds it whole and offers more room, rather than
 * continuing on a new page (Fable D6; live mlq-r38: "(3/5)" kept one point on
 * a small frame while another template page held the whole row). Only this
 * page's frame changes; the caller checks that finished pages keep theirs. */
export function moveCardPageFrame(project,index,scorePage,areaOf,{roles=['content','unknown']}={}){
 const prior=project.templateFidelity,slide=project.outline?.[index];
 if(prior?.mode!=='preserve'||!prior.sourceCatalog||!slide||index===0||project.runtime?.slides?.[slide.id]?.accepted||slide.titleLocked)return null;
 const sources=cloneTemplateValue(prior.sourceCatalog),external={originalPath:prior.originalPath,width:prior.width,height:prior.height},rich=project.inputProfile?.level==='rich'||String(project.source?.text||'').length>=8000,profiles=sources.map(s=>profileSourceSlide(s,external,rich));
 const baseArea=areaOf(project,index),memo=fidelityMemo();let best=null;
 for(let origin=1;origin<sources.length;origin++){
  if(origin===prior.slideMap[index]||!roles.includes(profiles[origin].semantic?.pageRole?.role))continue;
  const map=[...prior.slideMap];map[index]=origin;
  try{project.templateFidelity=buildFidelity(project,sources,external,prior.sha256,profiles,map,memo);const score=scorePage(project,index),area=areaOf(project,index);if(score<CARD_OVERFLOW_SCORE&&area>baseArea&&(!best||score<best.score))best={score,origin,fidelity:project.templateFidelity};}catch{}
  finally{project.templateFidelity=prior;}
 }
 if(!best)return null;
 const record={page:index+1,slideId:slide.id,fromSource:prior.slideMap[index],toSource:best.origin,basis:'card page moved to a template page that holds it whole instead of continuing (Fable D6)'};
 best.fidelity.capacityAssignments=[...(prior.capacityAssignments||[]),record];project.templateFidelity=best.fidelity;project.templateSlideMap=[...best.fidelity.slideMap];return record;
}

/** Repair only an unwritten native page. Completed/user-accepted pages retain
 * their original assignment; no missing template origin or font shrink allowed. */
export function repairNativePageAssignment(project,index,scorePage,{derivedNavigation=false}={}){
 const prior=project.templateFidelity,slide=project.outline?.[index];
 if(prior?.mode!=='preserve'||!prior.sourceCatalog||!slide||index===0||index===project.pages-1||project.nodes?.[slide.id]?.status==='done'&&!(derivedNavigation&&slide.role==='navigation')||project.runtime?.slides?.[slide.id]?.accepted||slide.titleLocked)return null;
 const baseline=scorePage(project,index);if(baseline.capacity_ok)return null;
 const sources=cloneTemplateValue(prior.sourceCatalog),external={originalPath:prior.originalPath,width:prior.width,height:prior.height},rich=project.inputProfile?.level==='rich'||String(project.source?.text||'').length>=8000,profiles=sources.map(s=>profileSourceSlide(s,external,rich));
 let best=null;const memo=fidelityMemo();
 for(let origin=1;origin<sources.length-1;origin++){
  const map=[...prior.slideMap];if(project.generationPolicy?.version===2&&!['content','unknown'].includes(profiles[origin].semantic?.pageRole?.role))continue;if(origin===map[index]||project.generationPolicy?.version!==2&&(origin===map[index-1]||origin===map[index+1]||profiles[origin].directional))continue;map[index]=origin;
  if(project.generationPolicy?.version!==2&&project.pages>=sources.length&&Array.from({length:sources.length},(_,i)=>i).some(i=>!map.includes(i)))continue;
  try{project.templateFidelity=buildFidelity(project,sources,external,prior.sha256,profiles,map,memo);const fit=scorePage(project,index);if(fit.capacity_ok&&fit.fontSizePt>=baseline.fontSizePt){best=project.templateFidelity;break;}}catch{}
  finally{project.templateFidelity=prior;}
 }
 if(!best)return null;
 const record={page:index+1,slideId:slide.id,fromSource:prior.slideMap[index],toSource:best.slideMap[index],fontFloor:baseline.fontSizePt,basis:derivedNavigation?'derived navigation layout only; original template coverage and every factual page assignment unchanged':'unwritten page only; shared atomic source measurement; original template coverage and completed page assignments unchanged'};
 best.capacityAssignments=[...(prior.capacityAssignments||[]),record];project.templateFidelity=best;project.templateSlideMap=[...best.slideMap];return record;
}
