import assert from 'node:assert/strict';
import { inspectReportOutline, inspectReportReadiness } from './lib/ppt-report-qa.mjs';
import { finalQualityReport } from './lib/ppt-quality.mjs';
import { _internals as pptInternals } from './lib/ppt-api.mjs';
import { normalizeBrief } from './lib/ppt-planning.mjs';

const slides = Array.from({ length: 20 }, (_, index) => ({ id: `slide_${index}`, title: `主题 ${index}`,
  sourceRefs: [], factSynthesis: index ? { claims: ['重复主张'] } : { claims: [] } }));
const report = { prompt: '向管理层汇报 MCP 流程并支持决策', source: { text: '流程。'.repeat(400), segments: [{ id: '1', text: '流程' }], semantic: { chunks: [{ id: 'c1' }] } },
  outline: slides.map((slide, index) => ({ id: slide.id, focus: index === 0 ? '封面' : '相同判断', refs: [] })),
  planning: { brief: { reportMode: 'decision', decisionQuestion: '' }, slidePlan: slides.map((slide, index) => ({ slideId: slide.id,
    role: index === 0 ? 'cover' : index === 19 ? 'closing' : 'evidence' })) },
  templateFidelity: { slides: slides.map((_, index) => ({ index, slots: [{ purpose: 'body', fontSizePt: 12 }] })) },
  deck: { slides } };
const checked = inspectReportReadiness(report);
assert.ok(inspectReportOutline(report, report.outline, report.planning.brief).length >= 3);
assert.equal(checked.status, 'needs_review');
for (const code of ['report_summary_late', 'report_source_thin', 'report_core_flow_late', 'report_decision_unclear',
  'report_recommendation_missing', 'report_repeated_claim', 'report_claim_without_source', 'report_small_text'])
  assert.ok(checked.issues.some(item => item.code === code), code);
const quality = finalQualityReport({ issues: checked.issues, hardErrors: 0, report: checked }, [],
  { missing: [], repeated: [], conflicts: [], unsupported: [] });
assert.equal(quality.report.status, 'needs_review');
assert.equal(quality.status, 'passed_with_warnings');

const good = structuredClone(report);
good.deck.slides = good.deck.slides.slice(0, 8).map((slide, index) => ({ ...slide, sourceRefs: ['1'], factSynthesis: { claims: [`事实 ${index}`] } }));
good.outline = good.outline.slice(0, 8).map((slide, index) => ({ ...slide, focus: `判断 ${index}`, refs: ['1'] }));
good.planning.brief.decisionQuestion = '应选择哪条调用路径？';
good.planning.slidePlan = good.planning.slidePlan.slice(0, 8);
good.planning.slidePlan[1].role = 'summary';
good.planning.slidePlan[2].role = 'process';
good.planning.slidePlan[6].role = 'recommendation';
good.outline[1].role = 'summary';
good.outline[2].role = 'process';
good.outline[6].role = 'recommendation';
good.templateFidelity.slides = good.templateFidelity.slides.slice(0, 8).map(spec => ({ ...spec, slots: [{ purpose: 'body', fontSizePt: 18 }] }));
assert.equal(inspectReportOutline(good, good.outline, good.planning.brief).length, 0);
assert.equal(inspectReportReadiness(good).status, 'ready');
good.planning.brief.reportMode = 'presentation';
assert.equal(inspectReportReadiness(good).status, 'not_applicable');
assert.equal(normalizeBrief({ reportMode: 'presentation' }, { prompt: '向管理层做决策汇报', pages: 8, source: {} }).reportMode, 'decision');
const writingProject = { ...good, planning: { ...good.planning, brief: { ...good.planning.brief,
  reportMode: 'decision', decisionQuestion: '选择哪条调用路径？', sourceScope: '仅依据用户提供的图' }, storyArc: {}, slidePlan: [
  { slideId: 'slide_0', role: 'cover' }, { slideId: 'slide_1', role: 'summary', message: '选路总览' },
] }, source: { ...good.source, semantic: { chunks: [{ id: 'c1', topic: '调用路径', text: '调用路径', sourceRefs: ['1'],
  semanticType: 'process', discourseRole: 'evidence', visualCandidates: [], priority: 'high' }] } },
prompt: 'MCP 汇报', pages: 8, deckTitle: { source: 'agent' } };
const reportPrompt = pptInternals.contentPrompt(writingProject, writingProject.outline[1], 1);
assert.match(reportPrompt, /选择哪条调用路径/);
assert.match(reportPrompt, /每个要点＝短名称＋完整解释/);
assert.match(reportPrompt, /数据限制和不确定性必须可见/);
console.log('PPT report readiness, evidence, distribution and copy checks: OK');
