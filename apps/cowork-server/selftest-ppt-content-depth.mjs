import assert from 'node:assert/strict';
import { estimateTypographyFit, planSparseInput, pointBudgetFor, profilePptInput, typographyPolicy } from './lib/ppt-content-depth.mjs';
import { estimatePageRecommendation } from './lib/ppt-planning.mjs';
import { inspectSlideCopy } from './lib/ppt-presentation-writing.mjs';
import { buildRenderTree } from './lib/ppt/render-tree.mjs';
import { slideSvg } from './lib/ppt/exporters/preview.mjs';

const brief = { inputKind: 'prompt', prompt: '介绍公司的 AI Agent 平台' };
const profile = profilePptInput(brief);
assert.equal(profile.level, 'sparse');
const plan = planSparseInput(brief, profile);
assert.ok(plan.semanticUnits.length >= 7 && plan.semanticUnits.every(unit => unit.provenance === 'inference'));
assert.ok(plan.evidenceGaps.length > 0 && plan.semanticUnits.every(unit => unit.evidenceStatus === 'unverified'));
assert.match(planSparseInput({ prompt: '介紹公司的 AI Agent 平臺' }).coreQuestions[0], /解決/);
assert.match(planSparseInput({ prompt: 'Explain an AI agent platform' }).coreQuestions[0], /What problem/);
const estimate = estimatePageRecommendation({ ...brief, inputProfile: profile, contentPlan: plan });
assert.equal(estimate.estimationBasis, 'planned_semantic_units');
assert.ok(estimate.recommended >= 7, 'a short prompt should receive a planned multi-page recommendation');
assert.equal(estimatePageRecommendation({ ...brief, pages: 5 }).selected, 5, 'user page count wins');
assert.equal(planSparseInput({ source: { kind: 'file', text: '' }, prompt: 'Report' }), null,
  'file inputs should wait for ingestion instead of being mistaken for sparse prompts');
assert.equal(planSparseInput({ source: { kind: 'paste', text: '收入增长 10%', segments: [{ id: '1', text: '收入增长 10%' }] }, prompt: '汇报' }), null,
  'short factual sources must remain evidence-grounded instead of expanding generic topics');

const workflow = pointBudgetFor('standard', 'process', 'high', 'process_6_steps');
const mechanism = pointBudgetFor('standard', 'mechanism', 'medium', 'three_deep_points');
assert.ok(workflow.preferredCount[1] > mechanism.preferredCount[1]);
assert.ok(workflow.max < mechanism.max);
const balanced = { depth: 'balanced', role: 'evidence', pointLengthProfile: 'standard', density: 'medium', semanticUnitBudget: 4 };
const longPoint = inspectSlideCopy({ title: 'A', bullets: [], copy: { blocks: [{ type: 'evidence', heading: 'Evidence', body: '详细解释。'.repeat(30) }] } }, balanced, 1, 3);
assert.ok(longPoint.some(issue => issue.code === 'point_too_long'), 'point-length QA must run on balanced pages too');

assert.ok(typographyPolicy({ role: 'mechanism' }).lineHeight >= 1.1);
assert.equal(typographyPolicy({}, { lineHeight: .9 }).lineHeight, .9, 'explicit user spacing has precedence');
const fit = estimateTypographyFit(['详细说明'.repeat(20)], { widthPt: 120, heightPt: 70, fontSizePt: 18,
  lineHeight: 1.12, paragraphSpacingEm: .5 }, value => [...value].length);
assert.ok(fit.estimatedHeightPt > fit.availableHeightPt && fit.comfortScore < 1,
  'capacity must include real line spacing and flag unreadable fitting');
const project = { templateSpec: { palette: { background: '#171b31', foreground: '#ffffff', muted: '#d0d0d0', accent: '#967fff' },
  fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' } },
  deck: { slides: [{ id: 's1', title: '机制', role: 'mechanism', layoutId: 'summary', bullets: ['机制通过状态和事件恢复任务。'] }] } };
const rendered = buildRenderTree(project).slides[0];
const body = rendered.elements.find(item => item.kind === 'list');
assert.ok(body.style.lineHeight >= 1.1 && body.style.paragraphSpacingEm > 0);
assert.ok(slideSvg(rendered).includes(`line-height:${body.style.lineHeight}`), 'SVG uses the measured body line height, including the point-layout contract');

console.log('PPT sparse planning, point budgets and readable shared typography: OK');
