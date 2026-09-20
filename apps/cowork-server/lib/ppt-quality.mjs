import { applyLayoutRegistry, chooseLayout, layoutFor, regionsFor, typographyFor } from './ppt-layout.mjs';

const CJK = /[\u2e80-\u9fff\uf900-\ufaff]/;

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
  const issues = [];
  if (dimensions.width < 640 || dimensions.height < 360) {
    issues.push(issue('image_resolution', 'warning', `图片分辨率 ${dimensions.width}×${dimensions.height}，低于建议的 640×360`, slideId, false, { blockId: block.id, dimensions }));
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
  for (const outlineSlide of project.outline || []) issues.push(...inspectSourceForSlide(project, outlineSlide));
  const fonts = project.templateSpec?.fonts;
  const allText = deck.slides.flatMap(slide => [slide.title, ...(slide.bullets || []), ...(slide.blocks || []).flatMap(block => {
    if (block.type === 'table') return block.rows.flat();
    if (block.type === 'chart') return [...(block.labels || []), block.unit];
    return [block.text, block.caption];
  })]).filter(Boolean).join(' ');
  if (!fonts?.title || !fonts?.body) issues.push(issue('font_template', 'error', '模板缺少可验证的标题或正文字体 token'));
  if (CJK.test(allText) && (!fonts?.titleEastAsia || !fonts?.bodyEastAsia || fonts.cjkExplicit === false)) {
    issues.push(issue('font_cjk_coverage', 'error', '模板没有明确的东亚字体，无法保证中文严格沿用模板字体'));
  }
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
    if (index > 0 && !(slide.bullets || []).length && !(slide.blocks || []).length) {
      issues.push(issue('content_empty', 'error', '内容页没有正文或视觉元素', slide.id));
    }
    if (!layout) issues.push(issue('layout_unknown', 'error', `未知版式 ${slide.layoutId}`, slide.id, true));
    else {
      if (layout.requiredBlockType && !(slide.blocks || []).some(block => block.type === layout.requiredBlockType)) {
        issues.push(issue('layout_required_block', 'error', `${layout.label}版式缺少 ${layout.requiredBlockType} 视觉元素`, slide.id, true));
      }
      if ((slide.bullets || []).length > layout.maxBullets) issues.push(issue('layout_density', 'error', `${layout.label}版式最多允许 ${layout.maxBullets} 条要点`, slide.id, true));
      const disallowed = (slide.blocks || []).filter(block => !layout.allowedBlocks.includes(block.type));
      if (disallowed.length && !['summary', 'conclusion'].includes(slide.layoutId)) issues.push(issue('layout_block', 'error', `${layout.label}版式不接受 ${disallowed.map(block => block.type).join(', ')}`, slide.id, true));
      const typography = typographyFor(slide);
      if (typography.titlePt < layout.minTitlePt || typography.bodyPt < layout.minBodyPt) issues.push(issue('minimum_font_size', 'error', '确定性字号低于版式下限', slide.id, true, { typography }));
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
      if (key.length >= 12 && seenBullets.has(key)) issues.push(issue('duplicate_bullet', 'warning', `要点与第 ${seenBullets.get(key) + 1} 页重复`, slide.id, true, { bullet }));
      else seenBullets.set(key, index);
    }
    for (const block of slide.blocks || []) issues.push(...inspectMedia(block, slide.id));
    if (project.source?.segments?.length && index > 0 && (slide.bullets || []).some(bullet => /\d/.test(bullet)) && !(slide.sourceRefs || []).length) {
      issues.push(issue('numeric_source', 'error', '包含数字的内容页缺少来源引用', slide.id, false));
    }
  });
  return { version: 1, checkedAt: new Date().toISOString(), issues, hardErrors: issues.filter(item => item.severity === 'error').length };
}

function accessibleText(background) { return contrastRatio('#ffffff', background) >= 4.5 ? '#ffffff' : '#111827'; }
function mutedText(background) { return contrastRatio('#cbd5e1', background) >= 3 ? '#cbd5e1' : '#374151'; }

export function repairProject(project, initialReview) {
  const updated = structuredClone(project);
  updated.deck = applyLayoutRegistry(updated.deck);
  const repairs = [];
  const seen = new Set();
  for (const [index, slide] of updated.deck.slides.entries()) {
    const declaredLayout = layoutFor(slide.layoutId);
    if (declaredLayout?.requiredBlockType && !(slide.blocks || []).some(block => block.type === declaredLayout.requiredBlockType)) {
      const previous = slide.layoutId;
      slide.layoutId = chooseLayout({ ...slide, layoutId: undefined }, index, updated.deck.slides.length);
      repairs.push({ code: 'layout_required_block', slideId: slide.id, action: `${previous} changed to ${slide.layoutId}` });
    }
    const before = slide.bullets || [];
    const removed = [];
    const filtered = before.filter(bullet => {
      const key = bullet.replace(/\s+/g, '').toLocaleLowerCase();
      if (key.length < 12 || !seen.has(key)) { seen.add(key); return true; }
      removed.push(bullet);
      return false;
    });
    // Never turn a text page into an empty page. A repeated claim is a warning
    // for the editor; an empty published slide is a harder failure.
    slide.bullets = filtered.length || (slide.blocks || []).length ? filtered : before.slice(0, 1);
    if (filtered.length || (slide.blocks || []).length) {
      for (const _bullet of removed) repairs.push({ code: 'duplicate_bullet', slideId: slide.id, action: 'removed exact duplicate bullet' });
    }
    const layout = layoutFor(slide.layoutId);
    if (layout && slide.bullets.length > layout.maxBullets) {
      slide.bullets = slide.bullets.slice(0, layout.maxBullets);
      repairs.push({ code: 'layout_density', slideId: slide.id, action: `kept first ${layout.maxBullets} bullets` });
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
  const slides = project.deck.slides.map((slide, index) => ({
    slideId: slide.id, page: index + 1, title: slide.title, bullets: slide.bullets,
    sourceRefs: slide.sourceRefs || [], layoutId: slide.layoutId,
  }));
  const sources = (project.source?.segments || []).slice(0, 120).map(segment => ({ id: segment.id, location: segment.location, text: segment.text.slice(0, 500) }));
  return `你是整稿演示文稿内容评审器。只评审内容，不调用工具，不搜索，不改写页面，不提供字体、坐标、布局或 PPTX 代码。\n主题：${project.prompt}\n页面：${JSON.stringify(slides)}\n来源：${JSON.stringify(sources)}\n仅输出一个 JSON 对象：{"missing":[{"slideIds":["1"],"detail":"缺少的必要内容"}],"repeated":[{"slideIds":["2","4"],"detail":"重复点"}],"conflicts":[{"slideIds":["3","5"],"detail":"冲突事实"}],"unsupported":[{"slideIds":["6"],"bulletIndexes":[0],"detail":"证据不足"}]}。四个数组都必须存在；没有发现时返回空数组。slideIds 只能使用给定页面 ID，bulletIndexes 从 0 开始。不要输出建议、修订文本或其他字段。`;
}

export function normalizeModelReview(value, slideIds) {
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
    ...modelReview.conflicts.map(item => ({ code: 'model_conflict', severity: 'warning', ...item })),
    ...modelReview.unsupported.map(item => ({ code: 'model_unsupported', severity: 'warning', ...item })),
  ];
  return {
    version: 1,
    status: deterministic.hardErrors ? 'blocked' : (modelIssues.length || deterministic.issues.some(item => item.severity === 'warning')) ? 'passed_with_warnings' : 'passed',
    checkedAt: new Date().toISOString(),
    deterministic,
    modelReview,
    modelIssues,
    repairs,
    timings,
  };
}
