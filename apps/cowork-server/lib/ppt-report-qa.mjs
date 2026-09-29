/** Editorial readiness is separate from the deterministic PPTX safety gate.
 * A deck may be exportable while still requiring report review. */
const normalize = value => String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const issue = (code, message, slideId = null) => ({ code, severity: 'warning', message, slideId, repairable: false });

/** Structure-only feedback for one bounded retry inside the existing outline node. */
export function inspectReportOutline(project, outline, brief) {
  if (!['decision', 'informational'].includes(brief?.reportMode) || !Array.isArray(outline) || outline.length < 6) return [];
  const role = index => outline[index]?.role || '';
  const problems = [];
  if (!outline.slice(1, 4).some(item => ['summary', 'thesis', 'decision', 'recommendation'].includes(item.role)))
    problems.push(issue('report_summary_late', '前 3 页应有摘要、主要结论或决策问题'));
  const sourceText = String(project.source?.text || '');
  if (outline.length >= 8 && /流程|链路|时序|workflow|pipeline|mcp/i.test(`${project.prompt || ''} ${sourceText.slice(0, 2000)}`) &&
      !outline.slice(1, 6).some(item => ['process', 'architecture', 'framework'].includes(item.role)))
    problems.push(issue('report_core_flow_late', '前 5 页应有流程或架构总览'));
  if (brief.reportMode === 'decision' && !outline.slice(Math.max(1, outline.length - 4), -1).some(item => ['decision', 'recommendation'].includes(item.role)))
    problems.push(issue('report_recommendation_missing', '结尾前应有来源支持的建议或决策规则'));
  const seen = new Set();
  for (const item of outline.slice(1, -1)) {
    const focus = normalize(item.focus);
    if (focus.length >= 4 && seen.has(focus)) { problems.push(issue('report_repeated_claim', '大纲重复同一核心主张')); break; }
    if (focus) seen.add(focus);
  }
  return problems;
}

export function inspectReportReadiness(project, deck = project.deck) {
  const brief = project.planning?.brief || {};
  const mode = brief.reportMode || 'presentation';
  if (mode === 'presentation') return { mode, status: 'not_applicable', issues: [], metrics: {} };
  const slides = deck?.slides || [];
  const outline = project.outline || [];
  const plan = project.planning?.slidePlan || [];
  const role = index => plan[index]?.role || outline[index]?.role || '';
  const issues = [];
  const main = slides.map((slide, index) => ({ slide, index })).filter(({ index }) => index > 0 && index < slides.length - 1 && role(index) !== 'appendix');
  const summaryIndex = slides.slice(1, Math.min(4, slides.length)).findIndex((_, offset) =>
    ['summary', 'thesis', 'decision', 'recommendation'].includes(role(offset + 1)));
  if (slides.length >= 6 && summaryIndex < 0) issues.push(issue('report_summary_late', '前 3 页缺少面向读者的摘要、核心结论或待决策问题', slides[1]?.id));

  const sourceText = String(project.source?.text || (project.source?.segments || []).map(item => item.text).join('\n'));
  const chunks = project.source?.semantic?.chunks || [];
  if (slides.length > 12 && sourceText.length < slides.length * 120 && chunks.length < Math.ceil(slides.length / 2))
    issues.push(issue('report_source_thin', `来源约 ${sourceText.length} 字、${chunks.length} 个语义单元，难以支撑 ${slides.length} 页互不重复的职场汇报`));

  if (/流程|链路|时序|workflow|pipeline|mcp/i.test(`${project.prompt || ''} ${sourceText.slice(0, 2000)}`) && slides.length >= 8 &&
      !slides.slice(1, Math.min(6, slides.length)).some((_, offset) => ['process', 'architecture', 'framework'].includes(role(offset + 1))))
    issues.push(issue('report_core_flow_late', '前 5 页没有完整流程、链路或架构总览', slides[1]?.id));

  if (mode === 'decision') {
    if (!brief.decisionQuestion) issues.push(issue('report_decision_unclear', 'Brief 未说明本次汇报需要回答的决策问题'));
    if (!slides.slice(Math.max(1, slides.length - 4), -1).some((_, offset) =>
      ['decision', 'recommendation'].includes(role(Math.max(1, slides.length - 4) + offset))))
      issues.push(issue('report_recommendation_missing', '主文结尾缺少来源支持的条件性建议或决策规则', slides.at(-2)?.id));
  }

  const seen = new Map();
  for (const { slide, index } of main) {
    const focus = normalize(outline[index]?.focus || plan[index]?.message);
    if (focus.length >= 4 && seen.has(focus)) issues.push(issue('report_repeated_claim', `本页核心主张与第 ${seen.get(focus) + 1} 页重复`, slide.id));
    else if (focus) seen.set(focus, index);
    if (project.source?.segments?.length && ((slide.factSynthesis?.claims || []).length || (slide.factSynthesis?.numbers || []).length) &&
        !(slide.sourceRefs?.length || outline[index]?.refs?.length))
      issues.push(issue('report_claim_without_source', '本页事实主张缺少可追溯的来源编号', slide.id));
  }

  const unmapped = (project.planning?.coverage || []).filter(item => item.priority === 'high' && item.action === 'unmapped');
  if (unmapped.length) issues.push(issue('report_topic_uncovered', `${unmapped.length} 个高优先级来源主题未进入正文，也未说明取舍`));
  const smallTextPages = new Set((project.templateFidelity?.slides || []).filter(spec => spec.slots?.some(slot =>
    ['body', 'list', 'point-description'].includes(slot.purpose) && Number(slot.fontSizePt || 0) < 18)).map(spec => spec.index + 1));
  if (smallTextPages.size) issues.push(issue('report_small_text', `${smallTextPages.size} 页模板正文槽位低于 18 pt；投影汇报应改用更疏的版式或转为附录`));

  return { mode, status: issues.length ? 'needs_review' : 'ready', issues,
    metrics: { pages: slides.length, mainPages: main.length, appendixPages: slides.length - main.length - Math.min(2, slides.length),
      sourceChars: sourceText.length, semanticChunks: chunks.length, repeatedClaims: issues.filter(item => item.code === 'report_repeated_claim').length,
      smallTextPages: smallTextPages.size } };
}
