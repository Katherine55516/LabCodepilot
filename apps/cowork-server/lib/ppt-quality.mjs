import {claimSemanticsChecklist,claimAuditRegistry,normalizeClaimAudit,claimAuditFailures,inspectCodeClaimScopes} from './ppt-claim-semantics.mjs';
import {inspectSourceArithmetic} from './ppt-source-arithmetic.mjs';
import crypto from 'node:crypto';
import {reviewBatches,composeReviews} from './ppt-review-batches.mjs';
import { userRequirements } from './ppt-outline-protocol.mjs';
import { inspectEditorial } from './ppt-editorial-review.mjs';
import { inspectRelationFidelity } from './ppt-semantic-relations.mjs';
import { inspectPageContracts } from './ppt-page-contract.mjs';
import { inspectSourceNumbers,verifiedHeadingPrefix } from './ppt-source-numbers.mjs';
import { inspectDeckCoherence } from './ppt-deck-coherence.mjs';
import { buildMediaLedger, inspectMediaLedger } from './ppt-media-ledger.mjs';
import { annotateIssues, routeIssue, themeBound, validateRepairCandidate } from './ppt-repair-routing.mjs';
import { obligationRegistry, normalizeObligationAudit, obligationFailures, obligationEvidenceDiagnostics, visibleEvidenceQuoteId, resolveObligationQuoteReferences, mainDeckBriefRequirements } from './ppt-obligations.mjs';
import { inputFramework, normalizeScopeAudit } from './ppt-input-scope.mjs';
import { buildRenderTree } from './ppt/render-tree.mjs';
import { renderIssues } from './ppt/render-audit.mjs';
import {visibleNodes,nodeContentText} from './ppt-visible-content.mjs';
import { densityPrompt } from './ppt-density-profile.mjs';
import { inspectVisibleCopy, normalizeSlideCopy } from './ppt-copy-integrity.mjs';
import { inspectObjectIntegrity } from './ppt-object-integrity.mjs';
import { applyLayoutRegistry, chooseLayout, layoutFor, regionsFor, typographyFor } from './ppt-layout.mjs';
import { inspectContent } from './ppt-content-qa.mjs';
import { inspectTemplateFidelity } from './ppt-template-fidelity.mjs';
import { inspectReportReadiness } from './ppt-report-qa.mjs';
import { compileTitle, inspectSlideCopy, titleFidelityValue, visualUnits } from './ppt-presentation-writing.mjs';
import { estimateTypographyFit } from './ppt-content-depth.mjs';
import { promptPolicy, sourcePacket } from './ppt-prompt-contracts.mjs';

const CJK = /[\u2e80-\u9fff\uf900-\ufaff]/;
const BROKEN_UNICODE = /\ufffd/;

function collectText(value, key = '') {
  if (typeof value === 'string') return key === 'dataUrl' ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(item => collectText(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, child]) => collectText(child, childKey));
}

function rgb(value) {
  const match = typeof value === 'string' && value.match(/^#([0-9a-f]{6})$/i);
  return match ? [0, 2, 4].map(index => parseInt(match[1].slice(index, index + 2), 16)) : null;
}
function luminance(color) {
  const channels = color.map(value => {
    const v = value / 255;
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
export function contrastRatio(a, b) {
  const one = rgb(a); const two = rgb(b);
  if (!one || !two) return 0;
  const [high, low] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function imageDimensions(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (match[1] === 'png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (match[1] !== 'jpeg' || bytes.length < 4) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function issue(code, severity, message, slideId = null, repairable = false, details = {}) {
  return { code, severity, message, slideId, repairable, ...details };
}

export function inspectMedia(block, slideId) {
  if (block?.type !== 'image') return [];
  const dimensions = imageDimensions(block.dataUrl);
  if (!dimensions) return [issue('image_decode', 'error', '图片尺寸无法读取', slideId, false, { blockId: block.id })];
  // Native template graphics are intentionally reused at their original
  // dimensions. Flat card fills and icons should not be judged by the photo
  // resolution threshold unless the media was newly replaced.
  if (block.nativeRef && !block.content?.mediaReplacement) return [];
  const issues = [];
  const displayInches = block?.geometry && Number(block.geometry.width) > 0 && Number(block.geometry.height) > 0
    ? { width: Number(block.geometry.width) / 914400, height: Number(block.geometry.height) / 914400 } : null;
  const required = displayInches ? { width: Math.ceil(displayInches.width * 100), height: Math.ceil(displayInches.height * 100) }
    : { width: 640, height: 360 };
  const smallDecoration = displayInches && displayInches.width * displayInches.height < 1;
  if (!smallDecoration && (dimensions.width < required.width || dimensions.height < required.height)) {
    issues.push(issue('image_resolution', 'warning', `图片分辨率 ${dimensions.width}×${dimensions.height}，显示尺寸建议至少 ${required.width}×${required.height}`, slideId, false, { blockId: block.id, dimensions, required }));
  }
  return issues;
}

export function inspectSourceForSlide(project, outlineSlide) {
  const issues = [];
  if (!project.source?.segments?.length || !outlineSlide) return issues;
  const valid = new Set(project.source.segments.map(segment => segment.id));
  const invalid = (outlineSlide.refs || []).filter(ref => !valid.has(ref));
  if (invalid.length) issues.push(issue('source_reference', 'error', `来源编号不存在：${invalid.join(', ')}`, outlineSlide.id));
  if (outlineSlide.id !== project.outline?.[0]?.id && !(outlineSlide.refs || []).length && outlineSlide.change !== 'keep') {
    issues.push(issue('source_missing', 'warning', '内容页没有来源引用', outlineSlide.id));
  }
  return issues;
}

export function deterministicReview(project, deckInput = project.deck) {
  const deck = applyLayoutRegistry(deckInput);
  const issues = [];
  issues.push(...(project.notesDisclosureIssues||[]));
  if(project.generationPolicy?.details==='notes'&&!project.contentSelection&&project.source?.semantic?.inventory?.items?.some(i=>i.presentation==='omitted_by_policy'))issues.push({code:'notes_disposition_ledger_missing',severity:'error',message:'Omitted source details require a complete explicit notes/summary disposition ledger before publication; replan with the current content contract.'});
  issues.push(...inspectVisibleCopy(deck.slides),...inspectEditorial(project,deck.slides));
  const integrity=inspectObjectIntegrity(project,deck.slides);
  issues.push(...integrity.issues,...inspectCodeClaimScopes({...project,deck}));
  const mediaLedger=buildMediaLedger(project,deck.slides,integrity.ledger);
  issues.push(...inspectMediaLedger(mediaLedger));
  for(const slide of deck.slides)for(const node of visibleNodes(slide))if(node.content?.mathStatus==='source_text_fallback')
    issues.push(issue('math_source_text_fallback','warning','公式暂用完整来源文本显示，数学排版需检查：'+(node.content.mathWarning||''),slide.id));
  issues.push(...inspectTemplateFidelity({ ...project, deck }));
  issues.push(...inspectSourceArithmetic(project));
  issues.push(...inspectRelationFidelity(project, deck.slides), ...inspectPageContracts(project, deck.slides), ...inspectSourceNumbers(project, deck.slides), ...inspectDeckCoherence(project, deck.slides));
  for (const outlineSlide of project.outline || []) issues.push(...inspectSourceForSlide(project, outlineSlide));
  const fonts = project.templateSpec?.fonts;
  // Inspect the full object-level IR. Imported PPTX text lives in native nodes
  // rather than only in the legacy title/bullets/blocks projection.
  const allText = deck.slides.flatMap(slide=>slide.nodes?.length ? visibleNodes(slide).map(nodeContentText) : collectText(slide)).filter(Boolean).join(' ');
  if (!fonts?.title || !fonts?.body) issues.push(issue('font_template', 'error', '模板缺少可验证的标题或正文字体 token'));
  if (CJK.test(allText) && (!fonts?.titleEastAsia || !fonts?.bodyEastAsia || fonts.cjkExplicit === false)) {
    issues.push(issue('font_cjk_coverage', 'error', '模板没有明确的东亚字体，无法保证中文严格沿用模板字体'));
  }
  if (BROKEN_UNICODE.test(allText)) issues.push(issue('font_invalid_character', 'error', '内容包含 Unicode 替换字符，可能发生了编码损坏'));
  const palette = project.templateSpec?.palette;
  if (!palette) issues.push(issue('theme_palette', 'error', '模板缺少可验证的颜色 token'));
  else {
    if (contrastRatio(palette.foreground, palette.background) < 4.5) issues.push(issue('contrast_foreground', 'error', '标题文字与背景对比度不足', null, true));
    if (contrastRatio(palette.muted, palette.background) < 3) issues.push(issue('contrast_muted', 'error', '正文文字与背景对比度不足', null, true));
  }

  const seenTitles = new Map();
  const seenBullets = new Map();
  deck.slides.forEach((slide, index) => {
    const layout = layoutFor(slide.layoutId);
    const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
    if (index > 0 && !slide.manualBlank && !(slide.bullets || []).length && !(slide.blocks || []).length && !visibleNodes(slide).some(node => !['title','template-title','section','page-number','footnote'].includes(node.semanticRole) && (node.content?.text || node.content?.items?.length || node.content?.rows?.length || node.type==='image' || node.type==='chart'))) {
      issues.push(issue('content_empty', 'error', '内容页没有正文或视觉元素', slide.id));
    }
    if (!layout) issues.push(issue('layout_unknown', 'error', `未知版式 ${slide.layoutId}`, slide.id, true));
    else {
      if (layout.requiredBlockType && !(slide.blocks || []).some(block => block.type === layout.requiredBlockType)) {
        issues.push(issue('layout_required_block', 'error', `${layout.label}版式缺少 ${layout.requiredBlockType} 视觉元素`, slide.id, true));
      }
      if ((slide.bullets || []).length > layout.maxBullets) issues.push(issue('layout_density', 'error', `${layout.label}版式最多允许 ${layout.maxBullets} 条要点`, slide.id, true));
      const nativeBlockIds = project.templateFidelity?.mode === 'preserve'
        ? new Set((slide.nodes || []).filter(node => node.nativeRef).map(node => node.id)) : new Set();
      const disallowed = (slide.blocks || []).filter(block => !layout.allowedBlocks.includes(block.type) && !nativeBlockIds.has(block.id));
      if (disallowed.length && !['summary', 'conclusion'].includes(slide.layoutId)) issues.push(issue('layout_block', 'error', `${layout.label}版式不接受 ${disallowed.map(block => block.type).join(', ')}`, slide.id, true));
      const typography = typographyFor(slide);
      if (typography.titlePt < layout.minTitlePt || typography.bodyPt < layout.minBodyPt) issues.push(issue('minimum_font_size', 'error', '确定性字号低于版式下限', slide.id, true, { typography }));
      if (typography.lineHeight < .95) issues.push(issue('typography_too_compact', 'error', '自动行距低于可读性下限 0.95', slide.id, true));
      if (project.templateFidelity?.mode !== 'preserve') for (const node of slide.nodes || []) {
        if (['text', 'list'].includes(node.type) && Number(node.style?.lineHeight) > 0 && Number(node.style.lineHeight) < .95)
          issues.push(issue('typography_too_compact', 'warning', '用户设置的行距低于 0.95，建议检查可读性', slide.id, false,
            { nodeId: node.id, lineHeight: Number(node.style.lineHeight) }));
      }
      if (project.templateFidelity?.mode !== 'preserve' && (slide.bullets || []).length) {
        const bodyRegion = regionsFor(slide).find(region => region.id === 'body');
        // Tall body lists use the point-level capacity gate in the render
        // tree. Estimating them again as one unbroken text frame creates false
        // warnings after a valid multi-column reflow.
        if (bodyRegion && bodyRegion.h < 2) {
          const fit = estimateTypographyFit(slide.bullets,
            { widthPt: bodyRegion.w * 72, heightPt: bodyRegion.h * 72, fontSizePt: typography.bodyPt,
              lineHeight: typography.lineHeight, paragraphSpacingEm: typography.paragraphSpacingEm }, visualUnits);
          if (fit.lines > 1 && fit.estimatedHeightPt > fit.availableHeightPt * 1.2)
            issues.push(issue('typography_capacity', 'warning', '正文估计超过文本框容量，应先调整分布或版式', slide.id, true, { fit }));
        }
      }
      const titleQuality = slide.titleQuality || { visualUnits: visualUnits(slide.title), maxVisualUnits: layout.copy?.titleHardUnits || 46,
        estimatedLines: Math.max(1, Math.ceil(visualUnits(slide.title) / (layout.copy?.titlePreferredUnits || 24))) };
      if (titleQuality.visualUnits > titleQuality.maxVisualUnits || titleQuality.estimatedLines > (layout.copy?.titleMaxLines || 2) || titleQuality.fits === false) {
        issues.push(issue('title_overflow', 'error', slide.titleLocked ? '用户锁定标题超过模板两行容量，请调整标题或模板' : '标题超过两行或版式宽度上限，必须改写而非缩小字体', slide.id, !slide.titleLocked, { titleQuality }));
      }
    }
    if (index === 0 && project.deckTitle?.source === 'user' && titleFidelityValue(slide.title) !== titleFidelityValue(project.deckTitle.raw)) {
      issues.push(issue('user_title_fidelity', 'error', '封面标题未逐字保留用户设置的 Deck Title', slide.id, true));
    }
    if (project.templateFidelity?.mode === 'preserve' && (slide.nodes || []).some(node =>
      node.nativeTextFrame?.paragraphs?.some(paragraph => Number(paragraph.lineSpacing) > 0 && Number(paragraph.lineSpacing) < .95))) {
      issues.push(issue('typography_template_tight', 'warning', '原生模板包含低于 0.95 的行距；已保留模板样式，请检查阅读舒适度', slide.id, false));
    }
    for (const copyIssue of inspectSlideCopy(slide, contract, index, deck.slides.length,
      { templatePreserved: project.templateFidelity?.mode === 'preserve' })) {
      issues.push(issue(copyIssue.code, copyIssue.severity, copyIssue.message, slide.id, copyIssue.repair === 'rewrite_title', copyIssue));
    }
    const regions = regionsFor(slide);
    for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) {
      if (intersects(regions[a], regions[b])) issues.push(issue('layout_overlap', 'error', `${regions[a].id} 与 ${regions[b].id} 区域重叠`, slide.id, true));
    }
    const titleKey = slide.title.trim().toLocaleLowerCase();
    if (titleKey && seenTitles.has(titleKey)) issues.push(issue('duplicate_title', 'warning', `标题与第 ${seenTitles.get(titleKey) + 1} 页重复`, slide.id, true));
    else seenTitles.set(titleKey, index);
    for (const bullet of slide.bullets || []) {
      const key = bullet.replace(/\s+/g, '').toLocaleLowerCase();
      if (key.length >= 12 && seenBullets.has(key)) issues.push(issue('duplicate_bullet', seenBullets.get(key) === index ? 'error' : 'warning', `要点与第 ${seenBullets.get(key) + 1} 页重复`, slide.id, true, { bullet }));
      else seenBullets.set(key, index);
    }
    for (const block of slide.blocks || []) {
      const native = project.templateFidelity?.mode === 'preserve' && (slide.nodes || []).find(node => node.id === block.id && node.nativeRef);
      if (native && !native.content?.mediaReplacement) continue;
      issues.push(...inspectMedia(native?.geometry && !block.geometry ? { ...block, geometry: native.geometry } : block, slide.id));
    }
    if (project.source?.segments?.length && index > 0 && (slide.bullets || []).some(bullet => /\d/.test(bullet)) && !(slide.sourceRefs || []).length) {
      issues.push(issue('numeric_source', 'error', '包含数字的内容页缺少来源引用', slide.id, false));
    }
  });
  issues.push(...renderIssues(buildRenderTree({...project,deck})));
  const content = inspectContent(project, deck);
  issues.push(...content.issues);
  const report = inspectReportReadiness(project, deck);
  issues.push(...report.issues);
  // Every issue names its owning layer and the operations allowed there.
  const routed = annotateIssues(issues);
  return { version: 1, checkedAt: new Date().toISOString(), issues: routed, hardErrors: routed.filter(item => item.severity === 'error').length,
    strictCoverage: project.planning?.brief?.depthPolicy === 'strict' && !project.compressionApproved,
    contentMetrics: content.metrics, objectLedger:integrity.ledger, mediaLedger, report };
}

function accessibleText(background) { return contrastRatio('#ffffff', background) >= 4.5 ? '#ffffff' : '#111827'; }
function mutedText(background) { return contrastRatio('#cbd5e1', background) >= 3 ? '#cbd5e1' : '#374151'; }

export function repairProject(project, initialReview) {
  const updated = structuredClone(project);
  updated.deck = applyLayoutRegistry(updated.deck);
  const repairs = [];
  for (const [index, slide] of updated.deck.slides.entries()) {
    // Exact repeats within one page are safe to remove. Across pages the same
    // wording may be a deliberate recap, so keep it visible for review.
    if (slide.locked || updated.runtime?.slides?.[slide.id]?.accepted || (slide.nodes || []).some(node=>node.locked) || updated.constraints?.entries?.some(entry=>entry.active&&(entry.slideId===slide.id||entry.slideIds?.includes(slide.id)))) continue;
    for (const change of normalizeSlideCopy(slide)) repairs.push({code:change.code,slideId:slide.id,action:'normalized exact redundant visible copy'});
    const seen = new Set();
    const contract = updated.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
    const titleIssue = initialReview.issues.find(item => item.slideId === slide.id && item.code === 'title_overflow');
    if (titleIssue && !slide.titleLocked) {
      const layout = layoutFor(slide.layoutId);
      const title = compileTitle({ title: slide.title, candidates: [
        ...(slide.titleQuality?.candidates || []).map(item => item.value), contract.message, contract.headlineIntent,
      ], message: contract.message || slide.title, registry: updated.planning?.terminology, previousTitles: updated.deck.slides.slice(0, index).map(item => item.title),
      budget: contract.copyBudget || layout?.copy });
      if (title.title && title.title !== slide.title) {
        slide.title = title.title; slide.titleQuality = title;
        const titleNode = slide.nodes?.find(node => node.semanticRole === 'title');
        if (titleNode) titleNode.content = { ...(titleNode.content || {}), text: title.title };
        const templateTitle = slide.nodes?.find(node => node.semanticRole === 'template-title');
        if (templateTitle) templateTitle.content = { ...(templateTitle.content || {}), text: title.title };
        repairs.push({ code: 'title_overflow', slideId: slide.id, action: 'selected a shorter title candidate' });
      }
    }
    const declaredLayout = layoutFor(slide.layoutId);
    if (declaredLayout?.requiredBlockType && !(slide.blocks || []).some(block => block.type === declaredLayout.requiredBlockType)) {
      const previous = slide.layoutId;
      slide.layoutId = chooseLayout({ ...slide, layoutId: undefined }, index, updated.deck.slides.length);
      slide.layoutRef = slide.layoutId;
      repairs.push({ code: 'layout_required_block', slideId: slide.id, action: `${previous} changed to ${slide.layoutId}` });
    }
    const before = slide.bullets || [];
    const removed = [];
    const keptIndexes = before.flatMap((bullet, bulletIndex) => {
      const key = bullet.replace(/\s+/g, '').toLocaleLowerCase();
      if (key.length < 12 || !seen.has(key)) { seen.add(key); return [bulletIndex]; }
      removed.push(bullet);
      return [];
    });
    const filtered = keptIndexes.map(index => before[index]);
    // Never turn a text page into an empty page. A repeated claim is a warning
    // for the editor; an empty published slide is a harder failure.
    slide.bullets = filtered.length || (slide.blocks || []).length ? filtered : before.slice(0, 1);
    const bodyNode = slide.nodes?.find(node => node.semanticRole === 'body' && node.type === 'list');
    if (bodyNode && filtered.length) bodyNode.content.items = keptIndexes.map(index => bodyNode.content.items[index]).filter(Boolean);
    if (slide.copy?.blocks?.length === before.length && filtered.length) slide.copy.blocks = keptIndexes.map(index => slide.copy.blocks[index]);
    if (filtered.length || (slide.blocks || []).length) {
      for (const _bullet of removed) repairs.push({ code: 'duplicate_bullet', slideId: slide.id, action: 'removed exact duplicate bullet' });
    }
    const layout = layoutFor(slide.layoutId);
    if (layout && slide.bullets.length > layout.maxBullets) {
      const alternative = chooseLayout({ ...slide, layoutId: undefined }, index, updated.deck.slides.length);
      if (alternative !== slide.layoutId && layoutFor(alternative)?.maxBullets >= slide.bullets.length) {
        slide.layoutId = alternative;
        slide.layoutRef = alternative;
        repairs.push({ code: 'layout_density', slideId: slide.id, action: `changed layout to ${alternative} without dropping content` });
      }
    }
    // A missing optional takeaway is intentional. Only the writer can supply
    // a distinct implication; legacy synthesis is never copied back to fill space.
  }
  const palette = updated.templateSpec?.palette;
  // A bound theme token is never changed silently: the conflict is reported.
  const bound = themeBound(updated);
  for (const [code, token, value] of [['contrast_foreground', 'foreground', () => accessibleText(palette.background)], ['contrast_muted', 'muted', () => mutedText(palette.background)]]) {
    if (!palette || !initialReview.issues.some(item => item.code === code)) continue;
    if (bound) { repairs.push({ code, action: `theme token ${token} is bound; contrast conflict reported instead of changing it`, operation: 'report_binding_conflict' }); continue; }
    palette[token] = value();
    repairs.push({ code, action: `${token} changed to ${palette[token]}`, operation: 'adjust_unbound_token' });
  }
  const review = deterministicReview(updated, updated.deck);
  const routedRepairs = repairs.map(item => ({ ...routeIssue(item.code), ...item, operation: item.operation || (/duplicate|redundant|repeat/.test(item.code)?'remove_duplicate':item.code==='title_overflow'?'select_title_candidate':'reflow') }));
  // A repair that introduces a new hard error is rolled back as a whole.
  const regressions = [...validateRepairCandidate(project, updated, {scopeSlideIds: repairs.map(x=>x.slideId).filter(Boolean), beforeReview: initialReview, afterReview: review}), ...routedRepairs.filter(item=>!item.allowedOperations.includes(item.operation)).map(item=>({code:'repair_operation_not_allowed',slideId:item.slideId,operation:item.operation}))];
  if (regressions.length) return { project, review: initialReview,
    repairs: [...routedRepairs.map(item => ({ ...item, rolledBack: true })), { code: 'repair_rolled_back', ownerLayer: 'review', action: 'repair candidate introduced new hard errors and was discarded',
      introduced: regressions.slice(0, 8).map(item => ({ code: item.code, slideId: item.slideId || null })) }] };
  return { project: updated, repairs: routedRepairs, review };
}

/** Preserve math structure alongside exact visible quote text. Flattened 10⁶
 * can read as 106 without its superscript; the quote protocol stays unchanged. */
export function reviewMathFormatting(content={}) {
  const fields=[['text',content.richText],...(content.items||[]).map((item,i)=>['item:'+i,item.richText]),...(content.cellRich||[]).flatMap((row,r)=>row.map((cell,c)=>['cell:'+r+':'+c,cell]))];
  return fields.flatMap(([field,rich])=>(rich?.runs||[]).filter(run=>run.kind==='math').map(run=>({field,tex:run.tex,status:run.status,mathMl:run.mathMl,fallbackRuns:run.fallbackRuns})));
}
export function reviewHyperlinks(content={}){
 const fields=[['text',content.richText],...(content.items||[]).flatMap((item,i)=>[['item:'+i,item.richText],['item-heading:'+i,item.headingRich],['item-body:'+i,item.bodyRich]]),...(content.cellRich||[]).flatMap((row,r)=>row.map((cell,c)=>['cell:'+r+':'+c,cell]))];
 const links=fields.flatMap(([field,rich])=>(rich?.runs||[]).filter(run=>typeof run.href==='string'&&run.href).map(run=>({field,label:run.text,href:run.href})));
 return [...new Map(links.map(link=>[JSON.stringify(link),link])).values()];
}

export function deckReviewPrompt(project) {
  const pageCount = project.deck.slides.length;
  const longDeck = pageCount >= 25;
  const compactReview=Boolean(project.reviewScope)||longDeck&&project.outline?.some(slide=>slide.planningProtocolVersion===2);
  const slides = project.deck.slides.map((slide, index) => {
    const native = visibleNodes(slide).filter(node => node.nativeRef);
    const byShape = new Map(native.map(node => [node.nativeRef.shapeId, node]));
    const visiblePoints = (longDeck ? [] : native.filter(node => node.templateSlot?.purpose === 'point-description'))
      .map(node => ({ heading: byShape.get(node.templateSlot.pairedWith)?.content?.text || '', description: node.content?.text || '' }));
    const visibleSlots = native.filter(node => nodeContentText(node))
      .map(node => ({ purpose: node.templateSlot?.purpose || node.templateSlot?.role || node.semanticRole,
        groupId: node.templateSlot?.groupId,
        nodeId: node.id, quoteId:visibleEvidenceQuoteId(slide.id,node), text: nodeContentText(node) }));
    const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
    const evidenceById = new Map((project.source?.semantic?.evidenceAtoms || []).map(atom => [atom.id, atom]));
    const evidence = (contract?.requiredEvidenceIds || []).map(id => evidenceById.get(id)).filter(Boolean)
      .map(atom => ({ id: atom.id, kind: atom.kind, sourceRef: atom.sourceRef, sourceRefs: atom.sourceRefs || [], location: atom.location,
        excerpt: atom.exactText }));
    // Canonical components can carry facts absent from legacy bullets. Never send
    // image base64 or geometry to the text critic; retain chart values and units.
    const semanticComponents = visibleNodes(slide).filter(node => !(compactReview && !project.importedInputScope && project.templateFidelity?.mode==='preserve' && node.nativeRef && node.type==='image' && !node.sourceArtifact && !nodeContentText(node) && !node.content?.caption && !node.content?.alt)).filter(node => compactReview || !node.nativeRef || ['table', 'chart', 'image'].includes(node.type)).map(node => {
      const content = node.content || {};
      const formatting=reviewMathFormatting(content);
      const links=reviewHyperlinks(content);
      const mathFormatting={...(formatting.length?{mathFormatting:formatting}:{}),...(links.length?{hyperlinks:links}:{})};
      if(compactReview){
        // Each visible node appears once, with unchanged quote identity.
        // Raw source stays in the immutable framework; geometry has its own gate.
        const identity={...mathFormatting,nodeId:node.id,quoteId:visibleEvidenceQuoteId(slide.id,node),type:node.type,semanticRole:node.semanticRole,sourceArtifact:node.sourceArtifact,sourceRefs:node.sourceRefs||slide.sourceRefs||[]};
        if(node.type==='table'){const {rawRows,cellRich,rawText,richText,nativeMathStructures,...displayContent}=content;return {...identity,content:displayContent,textEncoding:'quoteId resolves to the complete current visible rows; no cells omitted'};}
        if(node.type==='chart')return {...identity,content,text:nodeContentText(node)};
        return {...identity,text:nodeContentText(node),...(node.type==='image'?{caption:content.caption||content.alt||''}:{})};
      }
      if (node.type === 'chart') return { ...mathFormatting,nodeId: node.id, quoteId:visibleEvidenceQuoteId(slide.id,node), type: node.type, sourceArtifact:node.sourceArtifact, text: nodeContentText(node), content, sourceRefs: node.sourceRefs || slide.sourceRefs || [] };
      if (node.type === 'table') return { ...mathFormatting,nodeId: node.id, quoteId:visibleEvidenceQuoteId(slide.id,node), type: node.type, sourceArtifact:node.sourceArtifact, text: nodeContentText(node), content:{rows:content.rows,columnWeights:content.columnWeights}, sourceRefs: node.sourceRefs || slide.sourceRefs || [] };
      return { ...mathFormatting,nodeId: node.id, quoteId:visibleEvidenceQuoteId(slide.id,node), type: node.type, semanticRole: node.semanticRole, sourceArtifact:node.sourceArtifact,
        text: nodeContentText(node),
        ...(node.type === 'image' ? { caption: content.caption || content.alt || '' } : {}),
        ...(content.items ? { points: content.items.map(item => ({ label: item.label, text: String(item.text || item.body || '') })) } : {}) };
    });
    if(project.reviewScope?.mode==='global')return {slideId:slide.id,page:index+1,title:slide.title,semanticComponents:semanticComponents.map(n=>({nodeId:n.nodeId,quoteId:n.quoteId,type:n.type,mathFormatting:n.mathFormatting,hyperlinks:n.hyperlinks,sourceArtifact:n.sourceArtifact,...(n.content?.rows?{text:n.text,rows:n.content.rows}:{text:n.text})}))};
    return { slideId: slide.id, page: Math.max(0,(project.outline||[]).findIndex(item=>item.id===slide.id)) + 1, title: visibleNodes(slide).find(node => ['title', 'template-title'].includes(node.semanticRole))?.content?.text || ((slide.nodes || []).some(node => ['title', 'template-title'].includes(node.semanticRole)) ? '' : slide.title),
      ...(!slide.nodes?.length ? { bullets: slide.bullets } : {}),
      ...(semanticComponents.length ? { semanticComponents } : {}),
      ...(visiblePoints.length ? { visiblePoints } : {}), ...(!compactReview&&visibleSlots.length ? { visibleSlots } : {}),
      ...(evidence.length ? { requiredEvidence: evidence } : {}),
      ...(!compactReview?{densityFit:contract?.densityFit}:{}), densityMeasurement: project.quality?.deterministic?.contentMetrics?.visibleDensityPerSlide?.find(m => m.slideId === slide.id),
      requiredDetails: contract?.requiredDetails || [],
      ownedPoints: contract?.keyPoints || [], depth: contract?.depth, role: contract?.role,
      sourceKinds: (slide.sourceChunks || []).map(id => project.source?.semantic?.chunks?.find(chunk => chunk.id === id)?.contentKind).filter(Boolean),
      sourceRefs: slide.sourceRefs || [], layoutId: slide.layoutId };
  });
  const cited = new Set(slides.flatMap(slide => [...(slide.requiredEvidence || []).flatMap(atom => [atom.sourceRef, ...(atom.sourceRefs || [])].filter(Boolean)),
    ...(slide.sourceRefs || []).slice(0, longDeck ? 4 : 12)]));
  const requiredIds = [...new Set((project.planning?.slidePlan || []).flatMap(item => item.requiredEvidenceIds || []))];
  const sources = compactReview?{contextScope:'reference view only; complete source remains in INPUT_FRAMEWORK, not replaced or truncated',segmentRefs:[...cited],requiredEvidenceIds:requiredIds}:sourcePacket({ segments: (project.source?.segments || []).filter(segment => cited.has(segment.id)),
    chunks: (project.source?.semantic?.chunks || []).filter(chunk => chunk.sourceRefs?.some(ref => cited.has(ref))),
    evidenceAtoms: (project.source?.semantic?.evidenceAtoms || []).filter(atom => requiredIds.includes(atom.id)), requiredEvidenceIds: requiredIds }, 45000);
  const brief = project.planning?.brief?{...project.planning.brief,mustInclude:mainDeckBriefRequirements(project)}:undefined;
  const reviewTopic=compactReview?(userRequirements(project)||project.deckTitle?.text||brief?.goal||project.source?.name||''):project.prompt;
  const coverage = (project.planning?.coverage || []).filter(item => item.priority === 'high').slice(0, 60)
    .map(item => ({ topic: item.topic, action: item.action, slideIds: item.slideIds }));
  const prompt = `${densityPrompt(project)}
你是整稿演示文稿内容评审器。${promptPolicy(project,{includeObligations:!compactReview})}<rubric>先独立对照 INPUT_FRAMEWORK 检查每页标题、正文、表/图/代码/流程与媒体说明的主题和事实边界；模型 brief/sourceScope/ownedPoints/引用 ID 不能证明支撑。无数字的越界话题、额外议程、无依据建议及未经标注的假设同样记入 unsupported，reason="out_of_scope" 或 "unsupported_fact"。框架内必要解释不因没有逐字来源而误判；但新增事实前提必须有输入依据。然后逐项检查 ownedPoints、requiredDetails、表格类别及关系是否在可见文案展开。规划中的完整表格/全部行保留要求，默认指整稿中同一 sourceUnitId 所有可见分片的行列总和，不是每页或某个单页都要复制整张表。除非 INPUT_FRAMEWORK 明确要求该表不得跨页，否则不得仅因完整表分散在多页而报 missing/altered。先按 source_object_coverage 核对所有分片的真实单元格，再独立核对关系与解释。重复表头和一致的续页结构用于阅读，不是内容重复；只有相同的事实或说明被无必要地主讲多次才报 repeated。分片上实际缺行/改列/改值仍须报错。计划摘要是意图，封面不承载摘要正文不等于整稿缺失；正文的具体引导内容仍须在整稿真实可见节点核对。missing 包括必要解释缺失或浅薄：标签代替解释、未讲机制/条件、通用口号、断句；浅薄项加 reason="shallow"。短图示 label、封面或过渡不因字少被判浅薄；具体信息与关系比字数重要。每项给 suggestedFix，指出哪一项来源关系/条件需补入哪个点；不能给未核实数字。必要的回顾或简短引用不判重复；同页名词标签与其解释相配不判重复。仅 language.mode=source 时，原文与翻译语言对按双语保留，不因对应含义相同而判重复。language.mode=output 时只需目标语言忠实表达，不要求另一语言或逐字原句；同一事实翻译成目标语言后重复出现仍应报 repeated。来源内部冲突要报告 conflicts，不能自行发明校正值。上下文预算漏掉的来源不能据此判 unsupported；只报告可核对的事实。纯 prompt 仅允许其主题内必要的通用解释，不能扩出新主题。完整可见文本和原始输入必须全部审查；如未能完成，scopeAudit.status="not_evaluated"，不能返回一个暗示通过的空报告。</rubric>四类问题数组只能放真正未解决的问题；“不构成缺失/问题”“已包含，不再报”“属满足，此处无需报”等正面结论不要放入问题数组。只评审内容，不调用工具，不搜索，不改写页面，不提供字体、坐标、布局或 PPTX 代码。visibleSlots 和 visiblePoints 是观众实际看到的模板文字。逐页核对标题、子标题、卡片及图解标签是否属于同一来源事实，说明是否完整，概念是否与样例混淆；把错配或自相矛盾记入 conflicts，把截断、空泛或缺失记入 missing，把无来源支撑的描述记入 unsupported。缺少解释记 missing；只有两个实际可见陈述在同一适用条件下互相矛盾才记 conflicts，不能把单纯缺句当成事实冲突。若是职场汇报，还要在同样四类中检查决策问题、前置摘要、主文信息分布和来源支撑，不增加输出类别。\n主题：${reviewTopic}\n当前语义修改约束：${JSON.stringify(project.constraints?.entries?.filter(entry => entry.active && ['content','title','data','structure'].includes(entry.type)) || [])}\n演示目标与必讲内容：${JSON.stringify(brief ? { objective: brief.objective, thesis: brief.thesis, mustInclude: brief.mustInclude, reportMode: brief.reportMode, decisionQuestion: brief.decisionQuestion, sourceScope: brief.sourceScope } : {})}\n高优先级主题映射：${JSON.stringify(coverage)}\n页面：${JSON.stringify(slides)}\n来源：${JSON.stringify(sources)}\n仅输出一个 JSON 对象：{"missing":[{"slideIds":["1"],"detail":"缺少的必要内容"}],"repeated":[{"slideIds":["2","4"],"detail":"重复点"}],"conflicts":[{"slideIds":["3","5"],"detail":"冲突事实"}],"unsupported":[{"slideIds":["6"],"bulletIndexes":[0],"detail":"证据不足"}]}。四个数组都必须存在；没有发现时返回空数组。必须逐项返回 obligationAudit={registryHash:MANDATORY_OBLIGATIONS.registryHash,status:"complete|not_evaluated",checks:[{obligationId:"真实义务ID",status:"satisfied|missing|altered|not_evaluated",evidence:[{slideId:"当前页ID",nodeId:"当前可见实例ID",excerpt:"承载完整关系的逐字可见原文"}]}]}。每个义务恰好一次；satisfied须绑定实际承载完整内容的实例，包括父条件、否定、例外及单位，每个证据 excerpt 必须逐字来自该 slideId/nodeId 实例的 text（含表/图的展平 text）或 visibleSlots.text；不能添加表格竖线、改标点、缩写、拼接其他节点或用来源包原文冒充可见文字。跨节点或跨表分片承载的义务须分别引用各实际实例，合起来保留完整关系。不能用关键词覆盖率或引用ID代替判断。允许正确同义表达；可选浅薄仍在missing。未查完须not_evaluated。必须另返回 scopeAudit=${JSON.stringify({frameworkHash:inputFramework(project).frameworkHash,checkedSlideIds:slides.map(slide=>slide.slideId),status:"complete"})}；仅实际完成全部页面的输入框架与事实审查时使用 complete，否则 not_evaluated。slideIds 只能使用给定页面 ID，bulletIndexes 仅在报告 bullets 时填写，从 0 开始。每项可增加 reason="shallow" 和 suggestedFix；不要输出整页修订文本或坐标。`;
  // Explicit capacity failure, never a truncated authoritative source. The
  // selected model must also return not_evaluated if its own window is smaller.
  const integrity=inspectObjectIntegrity(project),inventory=project.source?.semantic?.inventory?.items||[];
  const objectCoverage=(project.reviewScope?.fullObjectCoverage||integrity.ledger.objects).map(object=>({...object,
    languagePairId:inventory.find(item=>item.id===object.objectId)?.languagePairId,languageRole:inventory.find(item=>item.id===object.objectId)?.languageRole,
    originalDataRows:inventory.find(item=>item.id===object.objectId)?.rows?.length-1||undefined,
    instances:project.reviewScope?.fullSourceInstances?project.reviewScope.fullSourceInstances.filter(n=>n.sourceUnitId===object.objectId):project.deck.slides.flatMap((slide,index)=>visibleNodes(slide).filter(node=>node.sourceArtifact?.sourceUnitId===object.objectId).map(node=>({slideId:slide.id,page:index+1,nodeId:node.id,quoteId:visibleEvidenceQuoteId(slide.id,node),...node.sourceArtifact,
      ...(node.type==='table'?{displayedDataRowCount:Math.max(0,(node.content.rows?.length||0)-1),firstDisplayedRowLabel:node.content.rows?.[1]?.[0],lastDisplayedRowLabel:node.content.rows?.at(-1)?.[0]}:{})}))) }));
  const dispositionContext={contract:project.generationPolicy,sourceHash:project.contentSelection?.sourceHash,entries:(project.contentSelection?.entries||[]).map(({sourceUnitId,destination,rowIndices,sentenceIndices,visibleEquivalentSourceUnitId})=>({sourceUnitId,destination,rowIndices,sentenceIndices,visibleEquivalentSourceUnitId,owningSlideIds:(project.outline||[]).filter(s=>s.sourceUnitIds?.includes(sourceUnitId)).map(s=>s.id)}))};
  const dispositionRules='\n<presentation_disposition_review>'+JSON.stringify(dispositionContext)+'</presentation_disposition_review> The original input is factual authority; this validated ledger defines the selected main-deck scope. An allowed notes-only unit is not a slide omission: review complete notes separately and keep every mandatory main-deck obligation. A summary table selects ORIGINAL rowIndices; actual summary rowStart/rowEnd index its selected rows, with rowEnd EXCLUSIVE. Never infer an extra required row from a printed range. Check original-to-visible sourceCellMap and all fragments before alleging a missing selected row. Source-language slides/summary members must each have a genuine visible witness; a claim ID or the translation alone is insufficient. Notes-only parallel pairs are not required on slides. These scope rules do not excuse lost selected text, selected table cells, conditions, wrong translations or unsupported additions.';
  const completePrompt=prompt+dispositionRules+'\n<source_object_coverage>'+JSON.stringify(objectCoverage)+'</source_object_coverage>\n<source_partition_rules>This ledger checks CURRENT visible source cells and content, not semantic adequacy. Table fragments sharing sourceUnitId jointly preserve the SAME original table. rowStart is inclusive, rowEnd exclusive, and repeated headers count once. Check the union of all original rows/columns across instances; do not require every fragment to duplicate the complete table. Separately enforce any explicit user request for a single-page table. Only status=rendered with no missingRows proves structural retention; failed objects and real omissions remain issues. Independently inspect explanations, relations, conditions and factual scope: structural completeness cannot make all obligations satisfied. Only source-language policy requires bilingual retention of primary/translation pairs. Explicit output-language policy requires faithful target-language content once, without restoring the other language or exact original phrasing. Judge equivalence using every member, condition and relation; duplicated target-language statements still need repetition review. Cite all necessary instances for a complete-table obligation, instead of assigning whole-table missing rows to every valid fragment.</source_partition_rules>\n<evidence_quote_protocol>数学显示协议：text 是用于精确引用的展平字符，可能将上标/下标连接（例如 10 的上标 6 展平为 106）；必须同时查看该节点 mathFormatting 的真实 MathML/TeX 与 fallbackRuns 的 baseline。若结构实际是 10^6，不能仅因展平 text 为 106 报数值冲突。结构与来源仍须独立逐项核对，真正改符号/变量/指数仍报错。优先使用精确引用协议：evidence条目输出 {slideId,nodeId,quoteId}，quoteId只能逐字选取该当前节点提供的值，无须重复输出excerpt。服务器将验证三个ID与当前文本哈希一致，并取该实例的完整逐字文字，再执行原来的证据与义务校验。这不是对错误摘录的自动修复。必须先独立核对被选文字确实承载整项关系；若由多个节点/表格分片承载，分别引用各实例，不能只选标题或空文本。未知、过期、错配的quoteId会失败。兼容原来的literal excerpt协议，但错误摘录仍会被拒绝。四类findings仅列实际问题，正面的“已经包含”“与来源一致”“无需修改”等结论不能放入问题数组。只有确认完整义务成立才能satisfied，真实缺失必须保留。</evidence_quote_protocol>';
  if(Buffer.byteLength(completePrompt,'utf8')>1024*1024)throw Object.assign(new Error('content_review_capacity: complete input/obligations exceed the review transport budget; split the input without losing conditions'),{code:'content_review_capacity'});
  const registry=obligationRegistry(project);
  const auditChecklist={registryHash:registry.registryHash,expectedCheckCount:registry.entries.length,
    requiredEntries:registry.entries.map((entry,index)=>({index:index+1,obligationId:entry.id,basis:entry.basis,text:entry.text,slideIds:entry.slideIds}))};
  const auditScopeNote=project.reviewScope?.mode==='global'?'\n<partitioned_claim_audit>'+project.reviewScope.claimBasis+' Do not duplicate page-batch claimAudit records. Return cross-page findings against the complete visible deck and the listed global obligations.</partitioned_claim_audit>':'';
  const auditedPrompt=completePrompt+auditScopeNote+'\n<claim_entailment_audit>'+JSON.stringify(claimAuditRegistry(project))+'</claim_entailment_audit>必须返回 claimAudit={version:2,registryHash:claim_entailment_audit.registryHash,status:"complete|not_evaluated",checks:[{claimId:"真实claim ID",textHash:"当前textHash",status:"entailed|unsupported|contradicted|redundant|not_evaluated",reason:"具体量词/条件/运算范围的蕴含判断",sourceEvidence:[{sourceUnitId:"所属来源ID",quoteId:"sourceQuotes中对应quoteId"}]}]}。sourceQuotes 的 quoteId 引用该来源单元完整原文，代码只恢复精确原文，不修正错误引用。优先用 sourceUnitId+quoteId，不复制公式/Markdown后再改成Unicode。使用quoteId不能替代蕴含判断；证据仅凭关键词或ID存在不得标entailed。claimId必须逐字使用claim_entailment_audit.entries[].id（该表claimId与id相同）；不得使用writerClaimId或semanticComponents中的旧claimId。每条新增解释恰好一次；sourceEvidence只引用该entry.permittedEvidenceSourceUnitIds对应的sourceQuotes，不引用其他页的来源。unsupported/contradicted/not_evaluated可返回sourceEvidence=[]，不得为错误主张伪造或借用证据；entailed必须有真实primary或已验证同chunk备注来源。不能用来源对象完整或关键词重合证明蕴含；unsupported/contradicted须同时进入四类 findings。未完成时不得输出entailed。纯prompt无来源对象时引用user_prompt。逐一审核每个新增解释的主张、量词、条件和代码 AST 运算范围；逐字来源结构完整不能代替解释正确。代码 AST unavailable 时明确未核验，不得推定按日期 rank。错误定义/权限排他/无来源的顺序或独立性假设须进入 conflicts/unsupported，给出来源 span 与可见 nodeId。'+'\n<incremental_explanation_review>每条新增解释必须有独立用途。若只复述本页已经可见的完整来源内容（包括原句、表格/清单单元），没有补充原文拥有、尚未由当前可见对象讲清的必要关系/机制/条件，该条 claimAudit.checks[].status=redundant，并引用真实owned原文证据，写具体重复关系，加入repeated。不能因解释更长、措辞不同就假装有增量；不能把完整原文保留本身或本来要求的双语对应标成冗余，只审新增解释。必要框架内关系仍可entailed，真实新事实仍unsupported/contradicted。semanticSummary是overview授权摘要，保留核心原文主张是其职责，不因为它忠实原文就标redundant。</incremental_explanation_review>\n<visible_review_scope>评审对象只能是当前页的真实可见节点。INPUT_FRAMEWORK、source_packet、requiredEvidence、ownedPoints 是对照材料，不是已显示在每页的正文；不能把这些对照材料在各页重复出现误报为可见内容重复。full_source 合同要求保留原文单元：如果不同的原始来源单元本身回顾同一主题，正确逐字绑定这些不同单元不是writer重复；不得建议删除必保来源来修复它。仍须检查来源自身冲突，以及writer新增解释是否无必要重复。unsupported 应指出新增的事实前提、建议、条件变化或越界主张，不能仅以不是原文字面句式为依据。逐一核对否定、限定、因果、排名/分组范围与代码运算；等价转述和标明的框架内必要解释不因措辞变化变成新事实。对确实改变条件或新增事实的解释仍须报错，不可因sourceArtifact结构完整而免检。</visible_review_scope>\n<required_audit_checklist>'+JSON.stringify(auditChecklist)+'</required_audit_checklist>\n'+
    '最后核对输出数量：requiredEntries 中每个 obligationId 都必须独立返回一次，包括 source_condition、source_detail、planned_detail 和 brief_requirement；不能只返回页面计划条目。按上面清单顺序审阅，返回前数清 checks 数量与 expectedCheckCount 相等，registryHash 必须逐字一致。清单不是已满足的结论；每项必须根据当前可见实例独立判断，未核实用 not_evaluated，实际缺失用 missing/altered，不可为补齐数量声称 satisfied。优先逐字选择当前提供的 quoteId，避免复制长摘录造成引用错误。';
  if(Buffer.byteLength(auditedPrompt,'utf8')>1024*1024)throw new Error('content_review_capacity: complete audit checklist exceeds the review transport budget');
  const visibleQuotes={frameworkHash:inputFramework(project).frameworkHash,slideIds:slides.map(slide=>slide.slideId),quotes:project.deck.slides.flatMap(slide=>visibleNodes(slide).filter(n=>nodeContentText(n)).map(n=>({slideId:slide.id,nodeId:n.id,quoteId:visibleEvidenceQuoteId(slide.id,n)})))};
  const navigationContext={policy:project.generationPolicy,finalPageRegistry:(project.outline||[]).map((slide,index)=>({slideId:slide.id,page:index+1,title:slide.title})),navigation:project.navigation,visibleDerivedNodes:project.deck.slides.flatMap(slide=>visibleNodes(slide).filter(n=>n.content?.derivedFrom==='final-deck-navigation').map(n=>({slideId:slide.id,nodeId:n.id,text:nodeContentText(n),targets:n.content.navigationTargets})))};
  const finalPrompt=auditedPrompt+'\n<visible_quote_registry>'+JSON.stringify(visibleQuotes)+'</visible_quote_registry>\n<derived_navigation_audit>'+JSON.stringify(navigationContext)+'</derived_navigation_audit> Page ranges in these explicitly marked navigation nodes are generated from the final stable slide registry, not claims about the external source. Verify every target ID/page/range against that registry and report any mismatch. Correct deck page references do not require a matching page number in the source Markdown. This exemption applies only to those marked navigation nodes; factual numbers elsewhere still require source support. In overview/explicit-output-language policy, require semantic preservation of every mandatory condition, not verbatim source wording. A quote must be literal CURRENT VISIBLE text as evidence; that does not require the visible wording to be identical to source text.';
  if(Buffer.byteLength(finalPrompt,'utf8')>1024*1024)throw new Error('content_review_capacity: complete visible quote registry exceeds the review transport budget');
  const chapterHeadings=project.deck.slides.flatMap(slide=>visibleNodes(slide).filter(n=>verifiedHeadingPrefix(project,n)).map(n=>({slideId:slide.id,nodeId:n.id,text:nodeContentText(n),meaning:'Original source chapter identifier; leading ordinal is not a count of body entries'})));
  const exampleReferences=project.deck.slides.flatMap(slide=>visibleNodes(slide).filter(n=>n.content?.derivedFrom==='source-example-navigation').map(n=>({slideId:slide.id,nodeId:n.id,text:nodeContentText(n),targets:n.content.navigationTargets})));
  const scopedPrompt=finalPrompt+'\n<continuation_companion_view>'+JSON.stringify(project.reviewScope?.companionInstances||[])+'</continuation_companion_view> These are actual visible same-chunk continuation nodes outside this page batch, not source authority or preapproved claims. Check them before alleging that a necessary explanation is absent from EVERY visible node. Their generated explanations are independently audited in their own batch; do not add their IDs to this batch scopeAudit or obligation evidence. '+
    '<support_evidence_scope>ownedSourceUnitIds remains primary coverage ownership. supportSourceUnitIds lists only complete prose retained in notes under the validated SAME semantic chunk/input hash. permittedEvidenceSourceUnitIds (or ownedSourceUnitIds when absent) is the exact evidence allowlist for each claim; it includes primary and those bounded supporting spans. Use their current sourceQuotes and actually prove entailment. Supporting notes do not count as visible source coverage, do not acquire primary ownership, and never authorize other-page primary sources, unrelated chapters, added facts or changed conditions.</support_evidence_scope> '+
    '\n<source_example_navigation>'+JSON.stringify(exampleReferences)+'</source_example_navigation> These visible handoff labels point to actual following schema-example pages. Verify the target instances and the complete fields across fragments; do not require one page to repeat a following example. '+
    '<hyperlink_display_contract>hyperlinks carries the actual current rich-text link label and href. A labeled clickable link preserves its URL target without printing the raw URL as body text. Verify label and href against source; truly absent/wrong href still fails. Require literal URL text only when explicitly requested by the input contract.</hyperlink_display_contract> '+
    '\n<source_chapter_headings>'+JSON.stringify(chapterHeadings)+'</source_chapter_headings> Chapter 16 may contain 12 reference links; compare the actual labels and source heading, not a guessed count. '+
    '<cross_page_source_witnesses>source_object_coverage.instances includes complete CURRENT source text/cells from all pages, including companions outside this page batch. Use the actual union to check structural completeness; a definition and its concrete example may occupy adjacent pages. Outside-batch instances are read-only context: do not add their slide IDs to this batch scopeAudit, claimAudit or obligation evidence. Cross-page obligations/narrative are checked again in the complete global view. A truly missing or altered member still fails.</cross_page_source_witnesses> '+
    '<conflict_relation_test>Report a conflict only when two actual propositions oppose each other under the same condition. A subsystem router and a task/model router can describe different levels of one system; their coexistence or an unpublished relationship is not itself a contradiction unless the source claims exclusive ownership. Preserve explicit uncertainty and genuine incompatible propositions; do not invent private implementation details to resolve them.</conflict_relation_test>';
  if(Buffer.byteLength(scopedPrompt,'utf8')>1024*1024)throw new Error('content_review_capacity: complete source witnesses exceed the review transport budget');
  return scopedPrompt;
}

export function normalizeModelReview(value, slideIds, project = null) {
  if (!value || typeof value !== 'object' || !['missing', 'repeated', 'conflicts', 'unsupported'].every(key => Array.isArray(value[key])))
    throw new Error('whole-deck model review must return all four finding arrays');
  if (value.evaluation !== undefined && !['evaluated', 'not_evaluated'].includes(value.evaluation))
    throw new Error('invalid whole-deck review evaluation');
  const valid = new Set(slideIds);
  const normalize = (items, allowBullets = false) => items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('invalid whole-deck review finding');
    const ids = Array.isArray(item.slideIds) ? [...new Set(item.slideIds.map(String))] : [];
    const fullDetail = typeof item.detail === 'string' ? item.detail.trim() : '';
    const detail = fullDetail.slice(0,300);
    if (!ids.length || !detail || ids.some(id=>!valid.has(id))) throw new Error('whole-deck review finding requires valid slideIds and detail');
    if(/(?:\u6b64|\u8fd9|\u8be5)(?:\u9879)?(?:\u975e|\u4e0d\u662f|\u5e76\u975e)(?:\u51b2\u7a81|\u7f3a\u5931|\u95ee\u9898)|\u65e0\u9700\u4fee\u6539|\u65e0\u987b\u4fee\u6539|\u6ca1\u6709\u5b9e\u9645(?:\u51b2\u7a81|\u7f3a\u5931|\u95ee\u9898)|不构成(?:缺失|问题|冲突)|不再报|此处无需报/u.test(fullDetail))throw new Error('whole-deck review finding explicitly denies its own problem; return actual issues in the appropriate finding array');
    return { slideIds: ids, detail,
      ...(typeof item.code==='string'&&routeIssue(item.code).ownerLayer!=='review'?{code:item.code}:{}),
      ...(['shallow', 'out_of_scope', 'unsupported_fact'].includes(item.reason) ? { reason: item.reason } : {}),
      ...(typeof item.suggestedFix === 'string' && item.suggestedFix.trim() ? { suggestedFix: item.suggestedFix.trim().slice(0, 700) } : {}),
      ...(allowBullets && Array.isArray(item.bulletIndexes) ? { bulletIndexes: [...new Set(item.bulletIndexes.map(Number).filter(Number.isInteger))].filter(index => index >= 0 && index < 10).slice(0, 10) } : {}) };
  });
  const obligationAudit = project ? normalizeObligationAudit(resolveObligationQuoteReferences(value.obligationAudit,project), project) : undefined;
  const claimAudit = project ? normalizeClaimAudit(value.claimAudit,project) : undefined;
  const scopeAudit = project ? normalizeScopeAudit(value.scopeAudit, project, slideIds) : undefined;
  return {
    ...(scopeAudit ? { scopeAudit } : {}), ...(claimAudit?{claimAudit}:{}), ...(obligationAudit ? { obligationAudit } : {}),
    evaluation: value.evaluation === 'not_evaluated' || scopeAudit?.status === 'not_evaluated' || obligationAudit?.status === 'not_evaluated' || claimAudit?.status==='not_evaluated' || claimAudit?.checks.some(c=>c.status==='not_evaluated') ? 'not_evaluated' : 'evaluated',
    missing: normalize(value?.missing),
    repeated: [...normalize(value?.repeated),...claimAuditFailures(claimAudit).filter(f=>f.code==='claim_redundant')],
    conflicts: normalize(value?.conflicts),
    unsupported: [...normalize(value?.unsupported,true),...claimAuditFailures(claimAudit).filter(f=>f.code!=='claim_redundant').map(f=>({...f,reason:'unsupported_fact'}))],
  };
}

/** Correct only malformed review JSON/evidence bindings, with all original
 * source and audit gates retained. Semantic writer rounds are independent. */
export function claimContractRepair(project, raw) {
  const registry=claimAuditRegistry(project), audit=raw?.claimAudit;
  if(audit?.registryHash!==registry.registryHash||!Array.isArray(audit.checks)||audit.checks.length!==registry.entries.length||new Set(audit.checks.map(c=>c.claimId)).size!==registry.entries.length||audit.checks.some(c=>!registry.entries.some(e=>e.id===c.claimId)))return null;
  const invalid=audit.checks.filter(check=>{
    const scoped={...project,reviewScope:{...project.reviewScope,claimIds:[check.claimId]}}, single=claimAuditRegistry(scoped);
    try{normalizeClaimAudit({...audit,registryHash:single.registryHash,checks:[check]},scoped);return false;}catch{return true;}
  });
  if(!invalid.length)return null;
  const claimIds=invalid.map(c=>c.claimId),scoped={...project,reviewScope:{...project.reviewScope,claimIds}}, narrow=claimAuditRegistry(scoped);
  const owned=new Set(narrow.entries.flatMap(e=>e.permittedEvidenceSourceUnitIds||e.ownedSourceUnitIds)), pages=new Set(narrow.entries.map(e=>e.slideId));
  const source=(project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).filter(i=>owned.has(i.id)).map(i=>({id:i.id,text:i.text}));
  const visible=project.deck.slides.filter(s=>pages.has(s.id)).map(s=>({slideId:s.id,nodes:visibleNodes(s).map(n=>({nodeId:n.id,text:nodeContentText(n)}))}));
  const prompt='Repair only the listed invalid claim audit records. All other review records and findings are frozen. Re-evaluate entailment using the complete owned source below; do not change a verdict merely to pass validation. Use only each entry.permittedEvidenceSourceUnitIds (or ownedSourceUnitIds when absent) and its exact sourceUnitId+quoteId pair. Unsupported or contradicted claims may have empty evidence; entailed/redundant requires real owned evidence. Preserve negation, conditions and scope. Return claimAudit for exactly these entries plus four finding arrays.\n'+JSON.stringify({generationPolicy:project.generationPolicy,source,userPrompt:source.length?undefined:userRequirements(project),visible,previousChecks:invalid})+'\n<claim_entailment_audit>'+JSON.stringify(narrow)+'</claim_entailment_audit>';
  return {prompt,project:scoped,base:raw,claimIds};
}

export async function reviewWithContractRepair(project, call, {nodeKey='review:deck',maxRepairs=2,partition=true,checkpoint}={}) {
  const batches=partition?reviewBatches(project):[];
  if(batches.length){
    const results=[];
    // Independent page audits retain individual checkpoints. Bound concurrency
    // to two so long decks do not serialize every complete-source review.
    for(let start=0;start<batches.length;start+=2){
      const settled=await Promise.allSettled(batches.slice(start,start+2).map(batch=>reviewWithContractRepair(batch.project,call,{nodeKey:`${nodeKey}:batch:${batch.index}`,maxRepairs,partition:false,checkpoint})));
      const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
      results.push(...settled.map(result=>result.value));
    }
    return composeReviews(project,batches,results,normalizeModelReview);
  }
  if(!Number.isInteger(maxRepairs)||maxRepairs<0||maxRepairs>2)throw new Error('invalid review correction bound');
  const original=deckReviewPrompt(project), ids=project.deck.slides.map(s=>s.id);
  const checkpointKey=crypto.createHash('sha256').update(JSON.stringify([project.configId,project.model,original])).digest('hex');
  const cached=checkpoint?.load(checkpointKey);if(cached)return normalizeModelReview(cached,ids,project);
  let prompt=original, patch=null;
  for(let attempt=0;;attempt++) {
    let raw;
    try {
      const response=await call(prompt,attempt?`${nodeKey}:contract:${attempt}`:nodeKey);
      if(patch){
        raw=patch.base;
        const corrected=normalizeClaimAudit(response?.claimAudit,patch.project);
        raw={...raw,claimAudit:{...raw.claimAudit,checks:raw.claimAudit.checks.map(check=>corrected.checks.find(c=>c.claimId===check.claimId)||check)}};
      }else raw=response;
      const reviewed=normalizeModelReview(raw,ids,project);await checkpoint?.save(checkpointKey,reviewed);return reviewed;
    }
    catch(error) {
      if(attempt>=maxRepairs||!/模型未返回有效的结构化内容|whole-deck.*review|whole-deck.*finding|mandatory obligation|obligation evidence|invalid mandatory obligation|input scope audit|claim audit/iu.test(String(error.message)))throw error;
      patch=claimContractRepair(project,raw);
      if(patch){prompt=patch.prompt;continue;}
      const registry=obligationRegistry(project),requiredIds=registry.entries.map(entry=>entry.id),checks=raw?.obligationAudit?.checks||[];
      const suppliedIds=Array.isArray(checks)?checks.map(check=>check?.obligationId):[];
      const claimRegistry=claimAuditRegistry(project),claimSupplied=(raw?.claimAudit?.checks||[]).map(c=>c.claimId);
      const claimCompleteness={expectedRegistryHash:claimRegistry.registryHash,missingClaimIds:claimRegistry.entries.filter(e=>!claimSupplied.includes(e.id)).map(e=>e.id),unknownClaimIds:claimSupplied.filter(id=>!claimRegistry.entries.some(e=>e.id===id))};
      const completeness={expectedRegistryHash:registry.registryHash,receivedRegistryHash:raw?.obligationAudit?.registryHash||null,
        expectedCheckCount:requiredIds.length,receivedCheckCount:suppliedIds.length,
        missingObligationIds:requiredIds.filter(id=>!suppliedIds.includes(id)),unknownObligationIds:suppliedIds.filter(id=>!requiredIds.includes(id)),
        duplicateObligationIds:[...new Set(suppliedIds.filter((id,index)=>suppliedIds.indexOf(id)!==index))]};
      const issues=/current registry and every obligation exactly once/u.test(String(error.message))?[]:obligationEvidenceDiagnostics(raw?.obligationAudit,project);
      prompt=original+'\n<review_contract_repair>'+JSON.stringify({error:String(error.message),completeness,claimCompleteness,issues,previousReview:raw??null})+'</review_contract_repair>\n'+
        '上次审查 JSON 或证据引用未通过校验。重新输出完整四类 findings、全部 obligationAudit、claimAudit checks 与 scopeAudit；claimAudit证据优先使用提供的sourceUnitId+quoteId以精确引用原文，不把源TeX转成Unicode后作逐字excerpt；不能删除义务或为了通过清空问题。每条 excerpt 必须逐字来自其 slideId/nodeId 对应的 text/visibleSlots.text，包括表格提供的展平 text；不能拼接多个节点、添加表格竖线、改标点、缩写或从来源包代替可见节点摘录。若完整义务由多个实例承载，分别引用这些实例。保持来源与事实边界，真实缺失仍标 missing/altered/not_evaluated；只有实际核对了完整关系才能 satisfied。';
      if(Buffer.byteLength(prompt,'utf8')>1024*1024)throw new Error('content_review_capacity: complete review correction exceeds the review transport budget');
    }
  }
}

export function finalQualityReport(deterministic, repairs, modelReview, timings = {}) {
  const modelIssues = [
    ...obligationFailures(modelReview.obligationAudit),
    ...claimAuditFailures(modelReview.claimAudit),
    ...modelReview.missing.map(item => ({ code: 'model_missing', severity: deterministic.strictCoverage ? 'error' : 'warning', ...item })),
    ...modelReview.repeated.map(item => ({ code: 'model_repeated', severity: 'error', ...item })),
    ...modelReview.conflicts.map(item => ({ code: 'model_conflict', severity: 'error', ...item })),
    ...modelReview.unsupported.map(item => ({ code: 'model_unsupported', severity: 'error', ...item })),
  ];
  modelIssues.splice(0, modelIssues.length, ...annotateIssues(modelIssues));
  const blocked = Boolean(deterministic.hardErrors || modelIssues.some(item => item.severity === 'error'));
  const issueGroups = { factsAndEvidence: [], narrative: [], layout: [], media: [] };
  for (const item of [...(deterministic.issues || []), ...modelIssues]) {
    const code = item.code || '';
    const group = /source|evidence|numeric|citation|model_conflict|model_unsupported/iu.test(code) ? 'factsAndEvidence'
      : /repeat|redundan|copy_|filler|content_depth|model_missing|artificial_density/iu.test(code) ? 'narrative'
        : /image|media|asset/iu.test(code) ? 'media' : 'layout';
    issueGroups[group].push(item);
  }
  const report = { ...(deterministic.report || { mode: 'presentation', status: 'not_applicable', issues: [], metrics: {} }),
    ...(deterministic.report?.mode !== 'presentation' && modelIssues.length ? { status: 'needs_review' } : {}) };
  return {
    version: 2, policyVersion: 2,
    status: blocked || modelReview.evaluation === 'not_evaluated' ? 'blocked' : (modelIssues.length || deterministic.issues.some(item => item.severity === 'warning')) ? 'passed_with_warnings' : 'passed',
    publishEligible: !blocked && modelReview.evaluation !== 'not_evaluated', editorialReady: !blocked && modelReview.evaluation !== 'not_evaluated' && (report.status === 'ready' || report.status === 'not_applicable'),
    contentReady: !blocked && modelReview.evaluation !== 'not_evaluated', exportable: false, visualVerified: false,
    objectLedger: deterministic.objectLedger, mediaLedger: deterministic.mediaLedger,
    acceptanceAxes: {
      sourceCompleteness: {status:(deterministic.issues||[]).some(item=>item.severity==='error'&&/source|object|evidence|relation/iu.test(item.code))?'blocked':'automated_checked'},
      semanticEditorial: {status:[...(deterministic.issues||[]),...modelIssues].some(item=>/editorial|fragment_title|workflow_sentence|raw_table|visible_source_markup/iu.test(item.code))?'needs_review':'automated_checked'},
      physicalLayout: {status:(deterministic.issues||[]).some(item=>item.severity==='error'&&/overflow|bounds|fit|geometry/iu.test(item.code))?'blocked':'automated_checked'},
      nativeExport: {status:'pending_export'}, humanVisualReview: {status:'not_verified'},
    },
    checkedAt: new Date().toISOString(),
    deterministic,
    modelReview,
    modelIssues,
    issueGroups,
    report,
    repairs,
    timings,
  };
}
