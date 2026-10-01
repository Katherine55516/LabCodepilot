/** Deterministic content diagnostics within the existing quality node. */
import { evidenceMeasurements, evidenceVisible, missingRequiredEvidence, visibleSlideText } from './ppt-evidence.mjs';
import { visualUnits } from './ppt-presentation-writing.mjs';
function normalized(value) { return String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); }
const formulaKey = value => String(value || '').replace(/[`\s]/g, '').toLocaleLowerCase();
function formulaCalls(value) {
  const text = String(value || '');
  const calls = [];
  for (const match of text.matchAll(/\b[A-Za-z_]\w*\s*\(/g)) {
    let depth = 0; let end = -1;
    for (let index = text.indexOf('(', match.index); index < text.length; index++) {
      if (text[index] === '(') depth++;
      else if (text[index] === ')' && --depth === 0) { end = index + 1; break; }
    }
    if (end < 0) continue;
    const expression = text.slice(match.index, end);
    if (expression.length >= 15 && /[+*/-]/u.test(expression)) calls.push({ start: match.index, end, expression });
  }
  return calls.filter(call => !calls.some(other => other !== call && other.start < call.start && other.end >= call.end));
}
function words(value) { return new Set((String(value || '').toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,4}/g) || [])); }
function similarity(a, b) {
  const left = words(a); const right = words(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter(word => right.has(word)).length;
  return common / (left.size + right.size - common);
}

function significantNumbers(value) {
  return [...String(value || '').matchAll(/(?<![a-zA-Z_])(?:\d+(?:[.,]\d+)?\s*(?:%|％|万|亿|元|美元|秒|分钟|ms)|\d{2,}(?:[.,]\d+)?)(?![a-zA-Z_])/g)]
    .map(match => match[0].replace(/\s/g, '').replace(/％/g, '%').replace(/,(?=\d{3}(?:\D|$))/g, ''))
    .map(value => value.replace(/^\d+(?:\.\d+)?/, numeric => {
      const [whole, fractional = ''] = numeric.split('.');
      const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
      const normalizedFraction = fractional.replace(/0+$/, '');
      return normalizedWhole + (normalizedFraction ? `.${normalizedFraction}` : '');
    }));
}

export function inspectContent(project, deck = project.deck) {
  const issues = [];
  const metrics = { coverageRatio: null, highPriorityCoverageRatio: null, copyLikeness: 0, adjacentRedundancy: 0, unsupportedNumberCount: 0,
    semanticUnitsPerSlide: [], requiredDetailCoverage: null, densityDistributionMatch: null, pageCountCompliant: true,
    unsupportedContentPages: 0, repeatedClaimsAcrossDeck: 0, sourceDensityRatio: null,
    plannedChunkCoverageRatio: null, evidenceCoverageRatio: null, requiredEvidenceCount: 0, renderedEvidenceCount: 0,
    visibleContentUnitsPerSlide: [], templateCapacityWarnings: 0, chapterCoverageRatio: null };
  const slides = deck?.slides || [];
  const segments = project.source?.segments || [];
  const coverage = project.planning?.coverage || [];
  if (project.pages && slides.length !== project.pages) {
    metrics.pageCountCompliant = false;
    issues.push({ code: 'page_count_compliance', severity: 'error', message: `输出 ${slides.length} 页，与用户确认的 ${project.pages} 页不一致`, slideId: null, repairable: false });
  }
  if (coverage.length) {
    const included = coverage.filter(item => item.action === 'included').length;
    const important = coverage.filter(item => item.priority === 'high');
    metrics.plannedChunkCoverageRatio = included / coverage.length;
    for (const item of important.filter(item => item.action === 'unmapped').slice(0, 12)) {
      issues.push({ code: 'source_coverage', severity: 'warning', message: `高优先级主题未映射到页面：${item.topic}`, slideId: null, repairable: false, chunkId: item.chunkId });
    }
  }
  const chapters = project.planning?.sourceCapacity?.sections || [];
  if (chapters.length && coverage.length) {
    let mapped = 0;
    for (const chapter of chapters) {
      const decisions = coverage.filter(item => chapter.chunkIds?.includes(item.chunkId));
      const included = decisions.some(item => item.action === 'included');
      const explained = decisions.length && decisions.every(item => item.action === 'omitted' && item.reason);
      if (included) mapped++;
      else if (!explained && chapter.sourceTokens >= 200) issues.push({
        code: 'source_chapter_unmapped', severity: 'warning', slideId: null, repairable: false,
        message: `来源章节未映射且未说明取舍：${chapter.title}`,
      });
    }
    metrics.chapterCoverageRatio = mapped / chapters.length;
  }
  const chunks = project.source?.semantic?.chunks || [];
  const atoms = project.source?.semantic?.evidenceAtoms || [];
  const atomById = new Map(atoms.map(atom => [atom.id, atom]));
  const visibleBySlide = new Map(slides.map(slide => [slide.id, visibleSlideText(slide)]));
  const evidenceChunks = coverage.filter(item => chunks.some(chunk => chunk.id === item.chunkId && chunk.evidenceIds?.length));
  const chunkVisible = item => {
    const chunk = chunks.find(value => value.id === item.chunkId);
    return (chunk?.evidenceIds || []).some(id => item.slideIds.some(slideId => evidenceVisible(atomById.get(id), visibleBySlide.get(slideId))));
  };
  if (evidenceChunks.length) {
    metrics.coverageRatio = evidenceChunks.filter(chunkVisible).length / evidenceChunks.length;
    const important = evidenceChunks.filter(item => item.priority === 'high');
    metrics.highPriorityCoverageRatio = important.length ? important.filter(chunkVisible).length / important.length : null;
    for (const item of important.filter(item => item.action === 'included' && !chunkVisible(item)).slice(0, 12))
      issues.push({ code: 'source_evidence_unrendered', severity: 'warning', message: `来源主题已映射但没有可见证据：${item.topic}`,
        slideId: item.slideIds[0] || null, repairable: false, chunkId: item.chunkId });
  }
  const sourceText = String(project.source?.text || (segments || []).map(segment => segment.text || '').join(' '));
  const contentPages = Math.max(0, slides.length - 2);
  if (contentPages >= 10 && segments.length) {
    metrics.sourceDensityRatio = chunks.length / contentPages;
    if (chunks.length < Math.ceil(contentPages / 3) && sourceText.length < contentPages * 100)
      issues.push({ code: 'long_deck_source_thin', severity: 'warning',
        message: `已确认 ${slides.length} 页，但来源只有 ${chunks.length} 个语义单元、约 ${sourceText.length} 字；请审查每页是否有独立事实与证据`,
        slideId: null, repairable: false });
  }
  const outlineClaims = new Map();
  const claimPages = new Map();
  const previousPageCopy = [];
  let copied = 0; let checked = 0; let redundant = 0; let requiredDetails = 0; let coveredDetails = 0; let densityChecks = 0; let densityMatches = 0;
  slides.forEach((slide, index) => {
    if (index > 0 && index < slides.length - 1) {
      const focus = normalized(project.outline?.[index]?.focus || project.planning?.slidePlan?.[index]?.message);
      if (focus.length >= 6 && outlineClaims.has(focus)) {
        metrics.repeatedClaimsAcrossDeck++;
        issues.push({ code: 'repeated_claim_across_deck', severity: 'warning',
          message: `本页核心主张与第 ${outlineClaims.get(focus) + 1} 页重复`, slideId: slide.id, repairable: false });
      } else if (focus) outlineClaims.set(focus, index);
      if (slides.length >= 12 && segments.length && !(slide.sourceRefs?.length || project.outline?.[index]?.refs?.length || project.outline?.[index]?.chunkRefs?.length)) {
        metrics.unsupportedContentPages++;
        issues.push({ code: 'ungrounded_content_page', severity: 'warning',
          message: '内容页没有对应的用户来源；请补充真实引用或明确标记为结构页', slideId: slide.id, repairable: false });
      }
    }
    const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
    const visibleText = visibleBySlide.get(slide.id) || '';
    const templateSlots = project.templateFidelity?.mode === 'preserve' ? project.templateFidelity.slides?.[index]?.slots || [] : [];
    const contentSlots = templateSlots.filter(slot => slot.role === 'content' && slot.purpose !== 'footnote' &&
      !(slide.templateOmissions || []).some(item => String(item.shapeId) === String(slot.shapeId)));
    const contentText = contentSlots.length ? contentSlots.flatMap(slot => {
      const value = slide.templateSlotTexts?.[String(slot.shapeId)];
      return Array.isArray(value) ? value.map(item => `${item.label || ''} ${item.body || ''}`) : [String(value || '')];
    }).join(' ') : (slide.copy?.blocks || []).map(block => `${block.heading || ''} ${block.body || ''}`).join(' ') ||
      (slide.bullets || []).join(' ');
    const contentUnits = visualUnits(contentText);
    const templateCapacity = contentSlots.reduce((sum, slot) => sum + Number(slot.capacity || 0), 0);
    metrics.visibleContentUnitsPerSlide.push({ slideId: slide.id, units: contentUnits, templateCapacity });
    if (index > 0 && index < slides.length - 1 && contract.role !== 'section' &&
      (project.inputProfile?.level === 'rich' || sourceText.length >= 8000)) {
      const target = contract.depth === 'detailed' ? 160 : 130;
      if (templateCapacity > 0 && templateCapacity < target) {
        metrics.templateCapacityWarnings++;
        issues.push({ code: 'template_depth_capacity', severity: 'warning',
          message: `本页原生模板正文容量约 ${templateCapacity} visual units，低于富来源内容页约 ${target} 的目标；应在版式调度时选更大正文区域，或明确压缩本页内容范围`,
          slideId: slide.id, repairable: false });
      } else if (contentUnits < target * .8) {
        issues.push({ code: 'visible_content_sparse', severity: 'warning',
          message: `本页有来源内容且可见正文仅约 ${Math.ceil(contentUnits)} visual units；请补充来源支持的机制、条件、例子或判断，不要靠重复填字`,
          slideId: slide.id, repairable: true });
      }
    }
    if (project.source?.text) for (const { expression } of formulaCalls(visibleText)) {
      if (!formulaKey(project.source.text).includes(formulaKey(expression)))
        issues.push({ code: 'visible_formula_unverified', severity: 'error',
          message: `可见公式与输入来源不一致：${expression.slice(0, 100)}`, slideId: slide.id, repairable: false });
    }
    if (/[\ufffd\u25a1]/u.test(visibleText) || /[\u2002\u2003\u2007]{2,}/u.test(visibleText))
      issues.push({ code: 'formula_or_glyph_placeholder', severity: 'error',
        message: '可见文字包含缺字方框、替换字符或连续数学空位；请改为可见的公式文本或可靠的原生公式',
        slideId: slide.id, repairable: false });
    const requiredAtoms = (contract.requiredEvidenceIds || []).map(id => atomById.get(id)).filter(Boolean);
    metrics.requiredEvidenceCount += requiredAtoms.length;
    metrics.renderedEvidenceCount += requiredAtoms.filter(atom => evidenceVisible(atom, visibleText)).length;
    for (const atom of missingRequiredEvidence(project, slide, contract))
      issues.push({ code: 'required_evidence_missing', severity: 'error', message: `锁定来源证据未出现在可见页面：${atom.id}`,
        slideId: slide.id, repairable: false, evidenceId: atom.id });
    const evidenceTitle = /\b(?:evidence|results?|benchmark)\b|证据|实测结果|基准结果/iu.test(slide.title || '');
    const sourcesTitle = /\b(?:sources?|references?|citations?)\b|来源|参考文献|引用/iu.test(slide.title || '');
    if (sourcesTitle && project.source?.kind === 'file' && project.source.name &&
      !normalized(visibleText).includes(normalized(project.source.name)))
      issues.push({ code: 'source_page_without_citation', severity: 'error',
        message: `来源页没有在可见文字中列出输入文件 ${project.source.name}`, slideId: slide.id, repairable: false });
    const citedAtoms = atoms.filter(atom => (slide.sourceRefs || []).some(ref => atom.sourceRefs.includes(ref)) ||
      (slide.sourceChunks || []).includes(atom.chunkId));
    if (evidenceTitle && citedAtoms.length && !citedAtoms.some(atom => evidenceVisible(atom, visibleText)))
      issues.push({ code: 'evidence_page_without_evidence', severity: 'error', message: '标题承诺证据或结果，但可见页面没有对应来源事实',
        slideId: slide.id, repairable: false });
    if (evidenceTitle && !citedAtoms.length && segments.length)
      issues.push({ code: 'evidence_page_source_absent', severity: 'error', message: '标题承诺证据或结果，但本页来源没有可核对的证据原子；应补充来源或改为评估方法页',
        slideId: slide.id, repairable: false });
    const citedMeasurements = citedAtoms.flatMap(atom => atom.measurements || []);
    for (const measurement of evidenceMeasurements(visibleText)) {
      const sourceMatch = citedMeasurements.some(item => item.value === measurement.value && item.unit === measurement.unit);
      if (!sourceMatch && segments.length) {
        metrics.unsupportedNumberCount++;
        issues.push({ code: 'visible_numeric_fidelity', severity: 'error', message: `可见文字中的数值 ${measurement.raw} 没有对应的本页来源及单位`,
          slideId: slide.id, repairable: false });
      }
    }
    if (/\bfor comparison\s*[.!?](?=\s|$)/iu.test(visibleText) || /\b(?:a|an)\s+single\s+large\s*[.!?]/iu.test(visibleText))
      issues.push({ code: 'copy_filler_or_fragment', severity: 'error', message: '可见文案包含凑长度尾语或残句', slideId: slide.id, repairable: false });
    for (const claimId of contract.claimIds || []) {
      const previous = claimPages.get(claimId);
      if (previous && previous.narrativeRole === contract.narrativeRole)
        issues.push({ code: 'repeated_claim_graph', severity: 'warning', message: `相同主张与叙事作用已在另一页出现：${claimId}`,
          slideId: slide.id, repairable: false });
      else claimPages.set(claimId, { slideId: slide.id, narrativeRole: contract.narrativeRole });
    }
    const semanticUnits = (slide.copy?.blocks || []).length || (slide.bullets || []).length;
    metrics.semanticUnitsPerSlide.push({ slideId: slide.id, units: semanticUnits, density: contract.density || 'medium' });
    const plannedBudget = Number(contract.semanticUnitBudget || 0);
    if (plannedBudget) {
      densityChecks++;
      const tolerance = contract.density === 'high' ? 3 : 2;
      if (Math.abs(semanticUnits - plannedBudget) <= tolerance) densityMatches++;
      else if (contract.density === 'low' && semanticUnits > plannedBudget + 2) {
        issues.push({ code: 'artificial_density', severity: 'warning', message: '低密度页面包含过多语义单元，与整稿密度节奏不符', slideId: slide.id, repairable: false });
      }
    }
    const slideText = normalized(visibleText);
    const comparisonText = `${slide.title} ${(slide.bullets || []).join(' ')} ${(slide.copy?.blocks || []).map(block => `${block.heading} ${block.body}`).join(' ')}`;
    if (slides.length >= 6 && index > 1 && index < slides.length - 1 && comparisonText.length >= 90) {
      const previous = previousPageCopy.find(item => index - item.index > 1 && item.text.length >= 90 &&
        similarity(comparisonText, item.text) >= .82);
      if (previous) issues.push({ code: 'nonadjacent_redundancy', severity: 'warning',
        message: `本页与第 ${previous.index + 1} 页的论证内容高度重复，请确认是否有新的机制、证据或结论`, slideId: slide.id, repairable: false });
    }
    previousPageCopy.push({ index, text: comparisonText });
    for (const detail of contract.requiredDetails || []) {
      requiredDetails++;
      const tokens = [...words(detail)];
      const expression = /\b[A-Za-z_]\w*\s*=|\b[A-Za-z_]\w*\s*\([^\n]*[-+*/][^\n]*\)/u.test(detail);
      const present = expression ? formulaKey(visibleText).includes(formulaKey(detail))
        : normalized(detail).length >= 4 && (slideText.includes(normalized(detail)) ||
          tokens.length >= 2 && tokens.filter(token => slideText.includes(normalized(token))).length / tokens.length >= .6);
      if (present) coveredDetails++;
      else issues.push({ code: 'required_detail_not_visible', severity: 'warning',
        message: `规划要求的来源细节没有完整出现在可见页面：${String(detail).slice(0, 100)}`,
        slideId: slide.id, repairable: true });
    }
    const cited = segments.filter(segment => (slide.sourceRefs || []).includes(segment.id));
    const citedSourceText = cited.map(segment => segment.text).join(' ');
    const sourceNumbers = new Set(significantNumbers(citedSourceText));
    for (const bullet of slide.bullets || []) {
      const value = normalized(bullet);
      if (value.length >= 24 && cited.length) {
        checked++;
        if (normalized(citedSourceText).includes(value)) {
          copied++;
          issues.push({ code: 'copy_likeness', severity: 'warning', message: '要点与来源原句高度一致，建议改写成演示文稿语言', slideId: slide.id, repairable: false });
        }
      }
      for (const number of significantNumbers(bullet)) {
        if (cited.length && !sourceNumbers.has(number)) {
          metrics.unsupportedNumberCount++;
          issues.push({ code: 'numeric_fidelity', severity: 'error', message: `要点中的数值 ${number} 未出现在本页引用的来源中`, slideId: slide.id, repairable: false });
        }
      }
    }
    if (index > 0) {
      const previous = slides[index - 1];
      const score = similarity(`${previous.title} ${(previous.bullets || []).join(' ')}`, `${slide.title} ${(slide.bullets || []).join(' ')}`);
      const enoughText = normalized(`${previous.title} ${(previous.bullets || []).join(' ')}`).length >= 40 && normalized(`${slide.title} ${(slide.bullets || []).join(' ')}`).length >= 40;
      if (enoughText && score >= .78) {
        redundant++;
        issues.push({ code: 'adjacent_redundancy', severity: 'warning', message: `本页与前一页内容高度相似`, slideId: slide.id, repairable: false });
      }
    }
    if (project.planning?.brief?.depth === 'detailed' && index > 0 && index < slides.length - 1 && (slide.bullets || []).length === 1 && !slide.blocks?.length) {
      issues.push({ code: 'content_depth', severity: 'warning', message: '内容页只有一条要点，可检查是否缺少机制、证据或启示', slideId: slide.id, repairable: false });
    }
  });
  metrics.copyLikeness = checked ? copied / checked : 0;
  metrics.adjacentRedundancy = slides.length > 1 ? redundant / (slides.length - 1) : 0;
  metrics.requiredDetailCoverage = requiredDetails ? coveredDetails / requiredDetails : 1;
  metrics.evidenceCoverageRatio = metrics.requiredEvidenceCount ? metrics.renderedEvidenceCount / metrics.requiredEvidenceCount : null;
  metrics.densityDistributionMatch = densityChecks ? densityMatches / densityChecks : 1;
  const similar = (project.templateFidelity?.reusePlan?.visualSimilarityPairs || []).filter(value => value >= .96).length;
  if (slides.length >= 12 && similar > Math.max(2, Math.floor((slides.length - 1) * .15))) issues.push({
    code: 'template_visual_repetition', severity: 'warning',
    message: `${similar} 组相邻页面视觉相似度过高；应检查版式或媒体变体是否足够`, slideId: null, repairable: false });
  metrics.highSimilarityAdjacentPages = similar;
  return { issues, metrics };
}
