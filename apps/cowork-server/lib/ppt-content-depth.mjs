/** Deterministic planning and typography policy inside the existing PPT DAG. */
const TOPIC_WORDS = /[a-z][a-z0-9-]*|[\u3400-\u9fff]{2,}/giu;
const HANT = /[紹關臺與為後學實體廣應當復雜雙發變們產計劃風險證據機運評範價現問組點決說適資數]/u;
const QUESTION_BANK = Object.freeze([
  ['problem', '要解决什么问题？', '要解決什麼問題？', 'What problem needs solving?'],
  ['definition', '核心概念与边界是什么？', '核心概念與邊界是什麼？', 'What is the concept and its scope?'],
  ['mechanism', '关键机制如何运作？', '關鍵機制如何運作？', 'How does the mechanism work?'],
  ['architecture', '主要组成部分如何协作？', '主要組成部分如何協作？', 'How do the components work together?'],
  ['application', '有哪些适用场景或示意案例？', '有哪些適用場景或示意案例？', 'Where could it be applied?'],
  ['evaluation', '应如何评估效果与证据？', '應如何評估效果與證據？', 'How should outcomes and evidence be evaluated?'],
  ['constraint', '有哪些限制和风险？', '有哪些限制和風險？', 'What are the limits and risks?'],
  ['implementation', '实施步骤与前置条件是什么？', '實施步驟與前置條件是什麼？', 'What are the implementation steps and prerequisites?'],
  ['decision', '接下来需要作出什么决定？', '接下來需要作出什麼決定？', 'What decision comes next?'],
]);

export function profilePptInput(project = {}) {
  const source = project.source || {};
  const text = String(source.text || project.prompt || '').trim();
  const tokens = text.match(TOPIC_WORDS) || [];
  const paragraphs = text.split(/\n\s*\n/).filter(item => item.trim()).length;
  const headings = (text.match(/^\s*(?:#{1,6}\s+|\d+[.)、]\s+).+$/gm) || []).length;
  const numbers = (text.match(/\b\d+(?:[.,]\d+)?%?\b/g) || []).length;
  const examples = (text.match(/例如|举例|案例|比如|example|case study/gi) || []).length;
  const mechanisms = (text.match(/机制|原理|架构|流程|因果|mechanism|architecture|workflow/gi) || []).length;
  const constraints = (text.match(/约束|限制|风险|前提|constraint|limitation|risk/gi) || []).length;
  const claims = (text.match(/[。.!?！？]/g) || []).length;
  const semanticUnits = source.semantic?.chunks?.length || 0;
  const richnessScore = tokens.length + headings * 18 + paragraphs * 7 + semanticUnits * 20
    + Math.min(20, numbers * 2 + examples * 4 + mechanisms * 3 + constraints * 3);
  const level = richnessScore < 85 && semanticUnits < 3 ? 'sparse' : richnessScore < 360 && semanticUnits < 12 ? 'medium' : 'rich';
  return { level, tokenCount: tokens.length, paragraphCount: paragraphs, headingCount: headings,
    numberCount: numbers, exampleCount: examples, mechanismCount: mechanisms, constraintCount: constraints,
    claimCount: claims, semanticUnitCount: semanticUnits, richnessScore };
}

export function planSparseInput(project = {}, profile = profilePptInput(project)) {
  // A short but factual pasted/file source must remain source-grounded. The
  // generic question inventory is only for a prompt without source material.
  if (project.source?.segments?.length || project.source?.kind === 'file') return null;
  if (profile.level !== 'sparse' || project.source?.semantic?.chunks?.length >= 3) return null;
  const topic = String(project.prompt || project.source?.text || '').trim().slice(0, 240);
  const chinese = /[\u3400-\u9fff]/u.test(topic);
  const traditional = chinese && HANT.test(topic);
  const requested = /决策|決策|管理层|管理層|汇报|匯報|report|decision|executive/iu.test(topic);
  const intent = /培训|培訓|课程|課程|教学|教學|tutorial|course|training/iu.test(topic) ? 'learning'
    : /计划|計劃|路线图|路線圖|发布|發佈|roadmap|launch|product plan/iu.test(topic) ? 'planning'
      : /比较|比較|对比|對比|评估方案|評估方案|compare|versus/iu.test(topic) ? 'comparison'
        : /架构|架構|平台|平臺|系统|系統|agent|architecture|platform|runtime/iu.test(topic) ? 'technical' : 'overview';
  const selectedRoles = {
    learning: ['definition', 'mechanism', 'application', 'evaluation', 'constraint', 'implementation'],
    planning: ['problem', 'definition', 'application', 'evaluation', 'constraint', 'implementation', 'decision'],
    comparison: ['problem', 'definition', 'mechanism', 'application', 'evaluation', 'constraint', 'decision'],
    technical: ['problem', 'definition', 'mechanism', 'architecture', 'application', 'evaluation', 'constraint', 'implementation'],
    overview: ['problem', 'definition', 'mechanism', 'application', 'evaluation', 'constraint', 'implementation'],
  }[intent];
  const domains = QUESTION_BANK.filter(([role]) => selectedRoles.includes(role) || requested && role === 'decision');
  const semanticUnits = domains.map(([role, zh, hant, en], index) => ({
    id: `planned_${String(index + 1).padStart(2, '0')}`, role,
    question: chinese ? traditional ? hant : zh : en,
    provenance: 'inference', confidence: .45,
    evidenceStatus: 'unverified',
    pointProfile: ['mechanism', 'architecture'].includes(role) ? 'deep' : 'standard',
  }));
  return { version: 1, topic, topicProvenance: 'user', intent,
    goal: requested ? 'decision_support' : 'explain', depthTarget: 'balanced',
    coreQuestions: semanticUnits.map(unit => unit.question), semanticUnits,
    storySkeleton: ['problem', 'definition', 'mechanism', 'application', 'evaluation', 'constraint', 'implementation'],
    evidenceGaps: semanticUnits.filter(unit => ['application', 'evaluation', 'decision'].includes(unit.role)).map(unit => ({
      question: unit.question, status: 'needs_source',
    })),
    evidencePolicy: 'General concepts and questions are permitted; do not invent organization-specific facts, figures, customers, projects or results.',
  };
}

export function sparsePageEstimate(plan, detail = 'balanced') {
  if (!plan?.semanticUnits?.length) return null;
  const cost = plan.semanticUnits.reduce((sum, unit) => sum +
    (['architecture', 'mechanism'].includes(unit.role) ? .72 : ['implementation', 'evaluation'].includes(unit.role) ? .55 : .42), 0);
  const recommended = Math.max(5, Math.min(100, Math.ceil(cost / (detail === 'detailed' ? .54 : .68)) + 2));
  const spread = Math.max(2, Math.ceil(recommended * .18));
  return { recommended, range: [Math.max(3, recommended - spread), Math.min(100, recommended + spread)],
    semanticUnits: plan.semanticUnits.length, contentCost: Math.round(cost * 100) / 100 };
}

const PROFILE_BUDGETS = Object.freeze({
  compact: { min: 15, target: 30, max: 55 },
  standard: { min: 30, target: 65, max: 110 },
  deep: { min: 55, target: 115, max: 220 },
  very_deep: { min: 75, target: 170, max: 330 },
  mixed: { min: 20, target: 110, max: 330 },
});

export function pointBudgetFor(profile = 'standard', role = 'evidence', density = 'medium', distribution = '') {
  const budget = PROFILE_BUDGETS[profile] || PROFILE_BUDGETS.standard;
  const shortForm = /process|timeline|roadmap|workflow|steps|architecture_nodes/u.test(`${role} ${distribution}`);
  const deepForm = /mechanism|single_deep|three_deep/u.test(`${role} ${distribution}`);
  const selected = shortForm && density === 'high' ? PROFILE_BUDGETS.compact
    : deepForm && profile === 'standard' ? PROFILE_BUDGETS.deep : budget;
  const count = deepForm ? [2, 4] : shortForm ? [4, 8] : density === 'low' ? [2, 3] : [3, 5];
  return { ...selected, preferredCount: count, unit: 'CJK-equivalent visual characters',
    guidance: profile === 'mixed' ? 'Use one substantial explanation with shorter supporting points; avoid equal-length filler.' : '' };
}

export function typographyPolicy(slide = {}, overrides = {}) {
  const density = slide.copy?.density || slide.density || 'medium';
  const role = slide.copy?.role || slide.role || 'evidence';
  const distribution = slide.copy?.distributionType || '';
  const dense = density === 'high' || /cards|process|steps|timeline/u.test(distribution);
  const userLineHeight = Number(overrides.lineHeight);
  const locked = overrides.lineHeight !== undefined && Number.isFinite(userLineHeight) && userLineHeight > 0;
  const lineHeight = locked ? userLineHeight : role === 'cover' ? 1.05 : dense ? 1.08 : role === 'mechanism' ? 1.16 : 1.12;
  return { lineHeight, paragraphSpacingEm: dense ? .35 : .5, source: locked ? 'user' : 'adaptive',
    comfort: lineHeight < .95 ? 'too_compact' : lineHeight < 1.03 ? 'tight' : 'comfortable' };
}

export function estimateTypographyFit(items, { widthPt, heightPt, fontSizePt, lineHeight = 1.12, paragraphSpacingEm = 0 }, measure) {
  const linesPerRow = Math.max(4, Number(widthPt || 0) / Math.max(1, Number(fontSizePt || 18)) * .88);
  const textItems = (Array.isArray(items) ? items : []).map(item => String(item || ''));
  const lines = textItems.reduce((sum, item) => sum + item.split('\n').reduce((count, part) =>
    count + Math.max(1, Math.ceil(measure(part) / linesPerRow)), 0), 0);
  const estimatedHeightPt = lines * fontSizePt * lineHeight
    + Math.max(0, textItems.length - 1) * fontSizePt * paragraphSpacingEm;
  return { lines, estimatedHeightPt: Math.round(estimatedHeightPt), availableHeightPt: Math.round(heightPt),
    comfortScore: Math.max(0, Math.min(1, .55 * Math.min(1, lineHeight / 1.12)
      + .45 * Math.min(1, heightPt / Math.max(1, estimatedHeightPt)))) };
}
