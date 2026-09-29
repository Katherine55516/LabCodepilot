import { applyLayoutRegistry, chooseLayout, layoutFor, regionsFor, typographyFor } from './ppt-layout.mjs';
import { inspectContent } from './ppt-content-qa.mjs';
import { inspectTemplateFidelity } from './ppt-template-fidelity.mjs';
import { inspectReportReadiness } from './ppt-report-qa.mjs';
import { compileTitle, inspectSlideCopy, titleFidelityValue, visualUnits } from './ppt-presentation-writing.mjs';
import { estimateTypographyFit } from './ppt-content-depth.mjs';

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
  issues.push(...inspectTemplateFidelity({ ...project, deck }));
  for (const outlineSlide of project.outline || []) issues.push(...inspectSourceForSlide(project, outlineSlide));
  const fonts = project.templateSpec?.fonts;
  // Inspect the full object-level IR. Imported PPTX text lives in native nodes
  // rather than only in the legacy title/bullets/blocks projection.
  const allText = collectText(deck.slides).filter(Boolean).join(' ');
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
    if (index > 0 && !slide.manualBlank && !(slide.bullets || []).length && !(slide.blocks || []).length) {
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
  const content = inspectContent(project, deck);
  issues.push(...content.issues);
  const report = inspectReportReadiness(project, deck);
  issues.push(...report.issues);
  return { version: 1, checkedAt: new Date().toISOString(), issues, hardErrors: issues.filter(item => item.severity === 'error').length,
    contentMetrics: content.metrics, report };
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
    // Fact synthesis may already contain an implication. Surface it as a
    // compact takeaway instead of inventing extra prose during repair.
    if (contract.depth === 'detailed' && !slide.copy?.takeaway && slide.factSynthesis?.implications?.[0]) {
      slide.copy ||= {}; slide.copy.takeaway = slide.factSynthesis.implications[0].slice(0, 180);
      const node = slide.nodes?.find(item => item.semanticRole === 'takeaway');
      if (node) node.content = { ...(node.content || {}), text: slide.copy.takeaway };
      else if (slide.nodes) slide.nodes.push({ id: `takeaway_${slide.id}`, type: 'text', semanticRole: 'takeaway', slotId: 'takeaway', styleRef: 'typography.takeaway', content: { text: slide.copy.takeaway } });
      repairs.push({ code: 'under_expanded', slideId: slide.id, action: 'materialized source-grounded takeaway' });
    }
  }
  const palette = updated.templateSpec?.palette;
  if (palette && initialReview.issues.some(item => item.code === 'contrast_foreground')) {
    palette.foreground = accessibleText(palette.background);
    repairs.push({ code: 'contrast_foreground', action: `foreground changed to ${palette.foreground}` });
  }
  if (palette && initialReview.issues.some(item => item.code === 'contrast_muted')) {
    palette.muted = mutedText(palette.background);
    repairs.push({ code: 'contrast_muted', action: `muted changed to ${palette.muted}` });
  }
  const review = deterministicReview(updated, updated.deck);
  return { project: updated, repairs, review };
}

export function deckReviewPrompt(project) {
  const pageCount = project.deck.slides.length;
  const longDeck = pageCount >= 25;
  const pageTextBudget = longDeck ? Math.max(900, Math.floor(65_000 / pageCount)) : 4_000;
  const slides = project.deck.slides.map((slide, index) => {
    const native = (slide.nodes || []).filter(node => node.nativeRef);
    const byShape = new Map(native.map(node => [node.nativeRef.shapeId, node]));
    const visiblePoints = (longDeck ? [] : native.filter(node => node.templateSlot?.purpose === 'point-description'))
      .map(node => ({ heading: byShape.get(node.templateSlot.pairedWith)?.content?.text || '', description: node.content?.text || '' }));
    let remaining = pageTextBudget;
    const visibleSlots = native.filter(node => node.templateSlot?.mapped && node.templateSlot?.role !== 'section')
      .slice(0, longDeck ? 24 : 30).map(node => ({ purpose: node.templateSlot.purpose || node.templateSlot.role,
        groupId: node.templateSlot.groupId,
        text: String(node.content?.text || '').slice(0, 180) })).filter(slot => {
          const cost = slot.text.length + 40;
          if (remaining < cost) return false;
          remaining -= cost;
          return true;
        });
    const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
    const evidenceById = new Map((project.source?.semantic?.evidenceAtoms || []).map(atom => [atom.id, atom]));
    const evidence = (contract?.requiredEvidenceIds || []).map(id => evidenceById.get(id)).filter(Boolean)
      .map(atom => ({ id: atom.id, kind: atom.kind, sourceRef: atom.sourceRef, location: atom.location,
        excerpt: atom.exactText.slice(0, 330) }));
    return { slideId: slide.id, page: index + 1, title: slide.title, bullets: slide.bullets,
      ...(visiblePoints.length ? { visiblePoints } : {}), ...(visibleSlots.length ? { visibleSlots } : {}),
      ...(evidence.length ? { requiredEvidence: evidence } : {}),
      sourceKinds: (slide.sourceChunks || []).map(id => project.source?.semantic?.chunks?.find(chunk => chunk.id === id)?.contentKind).filter(Boolean),
      sourceRefs: slide.sourceRefs || [], layoutId: slide.layoutId };
  });
  const cited = new Set(slides.flatMap(slide => slide.requiredEvidence?.length ? slide.requiredEvidence.map(atom => atom.sourceRef)
    : (slide.sourceRefs || []).slice(0, 1)));
  const sources = (project.source?.segments || []).filter(segment => cited.has(segment.id)).slice(0, longDeck ? 80 : 120)
    .map(segment => ({ id: segment.id, location: segment.location, text: segment.text.slice(0, longDeck ? 240 : 500) }));
  const brief = project.planning?.brief;
  const coverage = (project.planning?.coverage || []).filter(item => item.priority === 'high').slice(0, 60)
    .map(item => ({ topic: item.topic, action: item.action, slideIds: item.slideIds }));
  return `你是整稿演示文稿内容评审器。只评审内容，不调用工具，不搜索，不改写页面，不提供字体、坐标、布局或 PPTX 代码。visibleSlots 和 visiblePoints 是观众实际看到的模板文字。逐页核对标题、子标题、卡片及图解标签是否属于同一来源事实，说明是否完整，概念是否与样例混淆；把错配或自相矛盾记入 conflicts，把截断、空泛或缺失记入 missing，把无来源支撑的描述记入 unsupported。若是职场汇报，还要在同样四类中检查决策问题、前置摘要、主文信息分布和来源支撑，不增加输出类别。\n主题：${project.prompt}\n演示目标与必讲内容：${JSON.stringify(brief ? { objective: brief.objective, thesis: brief.thesis, mustInclude: brief.mustInclude, reportMode: brief.reportMode, decisionQuestion: brief.decisionQuestion, sourceScope: brief.sourceScope } : {})}\n高优先级主题映射：${JSON.stringify(coverage)}\n页面：${JSON.stringify(slides)}\n来源：${JSON.stringify(sources)}\n仅输出一个 JSON 对象：{"missing":[{"slideIds":["1"],"detail":"缺少的必要内容"}],"repeated":[{"slideIds":["2","4"],"detail":"重复点"}],"conflicts":[{"slideIds":["3","5"],"detail":"冲突事实"}],"unsupported":[{"slideIds":["6"],"bulletIndexes":[0],"detail":"证据不足"}]}。四个数组都必须存在；没有发现时返回空数组。slideIds 只能使用给定页面 ID，bulletIndexes 仅在报告 bullets 时填写，从 0 开始。不要输出建议、修订文本或其他字段。`;
}

export function normalizeModelReview(value, slideIds) {
  if (!value || typeof value !== 'object' || !['missing', 'repeated', 'conflicts', 'unsupported'].every(key => Array.isArray(value[key])))
    throw new Error('whole-deck model review must return all four finding arrays');
  const valid = new Set(slideIds);
  const normalize = (items, allowBullets = false) => !Array.isArray(items) ? [] : items.slice(0, 20).map(item => {
    if (!item || typeof item !== 'object') return null;
    const ids = Array.isArray(item.slideIds) ? [...new Set(item.slideIds.map(String))].filter(id => valid.has(id)).slice(0, 8) : [];
    const detail = typeof item.detail === 'string' ? item.detail.trim().slice(0, 300) : '';
    if (!ids.length || !detail) return null;
    return { slideIds: ids, detail, ...(allowBullets && Array.isArray(item.bulletIndexes) ? { bulletIndexes: [...new Set(item.bulletIndexes.map(Number).filter(Number.isInteger))].filter(index => index >= 0 && index < 6).slice(0, 6) } : {}) };
  }).filter(Boolean);
  return {
    missing: normalize(value?.missing),
    repeated: normalize(value?.repeated),
    conflicts: normalize(value?.conflicts),
    unsupported: normalize(value?.unsupported, true),
  };
}

export function finalQualityReport(deterministic, repairs, modelReview, timings = {}) {
  const modelIssues = [
    ...modelReview.missing.map(item => ({ code: 'model_missing', severity: 'warning', ...item })),
    ...modelReview.repeated.map(item => ({ code: 'model_repeated', severity: 'warning', ...item })),
    ...modelReview.conflicts.map(item => ({ code: 'model_conflict', severity: 'error', ...item })),
    ...modelReview.unsupported.map(item => ({ code: 'model_unsupported', severity: 'error', ...item })),
  ];
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
    version: 1,
    status: blocked ? 'blocked' : (modelIssues.length || deterministic.issues.some(item => item.severity === 'warning')) ? 'passed_with_warnings' : 'passed',
    publishEligible: !blocked, editorialReady: report.status === 'ready' || report.status === 'not_applicable',
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
