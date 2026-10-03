import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePaste, _internals as sourceInternals } from './lib/ppt-source.mjs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { withSemanticIndex } from './lib/ppt-semantic.mjs';
import { SEMANTIC_LIMITS } from './lib/ppt-semantic.mjs';
import { buildPlanning, estimatePageRecommendation, inspectLongDeckOutline, refreshPlanning, retrieveSlideSources, sourcePlanningContext } from './lib/ppt-planning.mjs';
import { inspectContent } from './lib/ppt-content-qa.mjs';
import { evidenceVisible } from './lib/ppt-evidence.mjs';
import { _internals as api } from './lib/ppt-api.mjs';
import { compileSectionLabel, compileTitle, formatUserDeckTitle, inspectSlideCopy, materializeCopy, normalizeHeadline, normalizeTypography, titleFidelityValue, visualUnits } from './lib/ppt-presentation-writing.mjs';

const markdown = `# Presentation Brief

goal:
Explain the architecture

audience:
Enterprise team

## Pipeline

The architecture uses a semantic IR.

\`\`\`text
Input

→ Story
→ Render
\`\`\`

| Stage | Owner |
| --- | --- |
| Story | LLM |

## Long analysis

${'Gamma 使用结构化输入和确定性渲染。'.repeat(300)}`;
const source = normalizePaste(markdown);
assert.equal(source.truncated, false);
assert.equal(source.segments[0].id, '1');
assert.ok(source.segments.length > 1);
assert.ok(source.semantic.blocks.some(block => block.type === 'code' && block.text.includes('→ Story')));
assert.ok(source.semantic.blocks.some(block => block.type === 'table'));
assert.ok(source.semantic.chunks.some(chunk => chunk.sourceRefs.length > 1), 'small adjacent fragments should merge');
assert.equal(source.semantic.stats.orphanHeadingCount, 0);
assert.equal(source.semantic.stats.oversizedChunkCount, 0);
assert.ok(source.semantic.chunks.every(chunk => chunk.tokenCount <= SEMANTIC_LIMITS.HARD_TOKENS));
assert.ok(source.semantic.chunks.some(chunk => chunk.sectionPath.includes('Long analysis')));

const manyShortParagraphs = Array.from({ length: 1100 }, (_, index) => `第 ${index + 1} 段：保留原始内容与来源位置。`).join('\n\n');
const manyShortSource = normalizePaste(manyShortParagraphs);
assert.equal(manyShortSource.truncated, false, 'short paragraphs must be coalesced instead of truncating after a fixed segment count');
assert.ok(manyShortSource.segments.length < 30, 'paste should pack short paragraphs into bounded source segments');
assert.ok(manyShortSource.text.includes('第 1100 段：保留原始内容与来源位置。'), 'the final paragraph must survive paste normalization');

const htmlFixture = Buffer.from('<html><body><h1>Compression</h1><h2>Concept</h2><p>Pruning removes complete structures from a model so the resulting dense model can run faster.</p><h2>Worked example</h2><p>A four-billion-parameter student is trained after pruning.</p><svg><text>Unrelated decorative label</text></svg></body></html>');
const extractedHtml = spawnSync(process.env.PPT_TEST_PYTHON || 'python3', ['-c', sourceInternals.SCRIPT], {
  input: htmlFixture, env: { ...process.env, PPT_SOURCE_NAME: 'semantic-fixture.html',
    PPT_SOURCE_DIR: path.join(os.tmpdir(), 'ppt-semantic-fixture') }, maxBuffer: 5_000_000,
});
assert.equal(extractedHtml.status, 0, extractedHtml.stderr.toString());
const htmlSource = withSemanticIndex(JSON.parse(extractedHtml.stdout));
assert.ok(htmlSource.semantic.chunks.some(chunk => chunk.sectionPath.includes('Concept') && chunk.contentKind === 'concept'));
assert.ok(htmlSource.semantic.chunks.some(chunk => chunk.sectionPath.includes('Worked example') && chunk.contentKind === 'example'));
assert.ok(!htmlSource.text.includes('Unrelated decorative label'));
assert.ok(htmlSource.semantic.chunks.every(chunk => !(chunk.text.includes('Pruning removes') && chunk.text.includes('four-billion'))),
  'HTML heading boundaries must keep concepts and worked examples separate');

const longEnglish = `# Detail\n\n${'architecture preserves evidence and source context. '.repeat(300)}`;
const englishSource = normalizePaste(longEnglish);
const englishBlocks = englishSource.semantic.blocks.filter(block => block.type === 'paragraph');
assert.ok(englishBlocks.length > 1);
assert.equal((englishBlocks.map(block => block.text).join(' ').match(/architecture preserves evidence and source context/g) || []).length, 300,
  'splitting must retain English word boundaries and all repeated content');
const longTable = `# Data\n\n| Key | Value |\n| --- | --- |\n${Array.from({ length: 150 }, (_, index) => `| row_${index} | value_${index} |`).join('\n')}`;
const tableSource = normalizePaste(longTable);
assert.equal((tableSource.semantic.blocks.map(block => block.text).join('\n').match(/\| row_\d+ \| value_\d+ \|/g) || []).length, 150,
  'all table rows must survive oversized splitting');

const gammaPath = new URL('../../../gamma.md', import.meta.url);
const longDocument = fs.existsSync(gammaPath)
  ? fs.readFileSync(gammaPath, 'utf8')
  : Array.from({ length: 30 }, (_, index) => `## Topic ${index + 1}\n\nThe architecture connects the input, planning, content, and rendering stages. ${'Each stage preserves source evidence. '.repeat(20)}`).join('\n\n');
const gamma = normalizePaste(longDocument);
assert.ok(gamma.semantic.chunks.length > 10, 'semantic indexing may split a packed source segment into multiple bounded chunks');
assert.equal(gamma.semantic.stats.orphanHeadingCount, 0);
assert.equal(gamma.semantic.stats.oversizedChunkCount, 0);
const planningInput = sourcePlanningContext(gamma);
assert.ok(planningInput.includes(gamma.semantic.chunks[0].id));
assert.ok(planningInput.includes(gamma.semantic.chunks.at(-1).id));
assert.ok(planningInput.length <= 28000);

const project = { prompt: 'Explain Gamma', pages: 3, source: gamma };
const first = gamma.semantic.chunks[0];
const second = gamma.semantic.chunks[1];
const outline = [
  { id: 's1', title: 'Cover', focus: 'Gamma architecture', section: 'Start', refs: first.sourceRefs, chunkRefs: [first.id], role: 'cover' },
  { id: 's2', title: 'Structured content accelerates delivery', focus: 'IR is reusable', section: 'Mechanism', refs: second.sourceRefs, chunkRefs: [second.id], role: 'architecture', visualIntent: { type: 'architecture' } },
  { id: 's3', title: 'Conclusion', focus: 'Adopt semantic IR', section: 'End', refs: [], role: 'closing' },
];
const planning = buildPlanning(project, { brief: { audience: 'Engineering', depth: 'detailed', thesis: 'A reusable IR drives generation' }, storyArc: { opening: 'Question', resolution: 'Action' } }, outline);
const longOutline = Array.from({ length: 14 }, (_, index) => ({ id: `long_${index}`, role: index === 0 ? 'cover' : index === 13 ? 'closing' : 'evidence',
  focus: index === 2 || index === 9 ? '同一核心主张' : `独立主张 ${index}`, refs: index === 3 ? [] : ['1'] }));
const longIssues = inspectLongDeckOutline({ source: { segments: [{ id: '1', text: '事实' }] } }, longOutline);
assert.ok(longIssues.some(item => item.code === 'outline_repeated_claim'));
assert.ok(longIssues.some(item => item.code === 'outline_ungrounded_page'));
assert.equal(planning.brief.audience, 'Engineering');
assert.equal(planning.version, 6);
assert.equal(planning.slidePlan[1].role, 'architecture');
assert.equal(planning.slidePlan[1].sourceChunks[0], second.id);
assert.equal(planning.slidePlan[1].depth, 'detailed');
assert.ok(planning.slidePlan[1].requiredSupport.includes('mechanism'));
assert.equal(planning.slidePlan[1].density, 'high');
assert.ok(planning.slidePlan[1].semanticUnitBudget >= 4);
assert.ok(planning.pageRecommendation.userConfirmed);
assert.ok(planning.terminology.protectedPhrases.includes('Story Planner'));
assert.equal(planning.coverage.find(item => item.chunkId === second.id).action, 'included');
const refreshed = refreshPlanning({ ...project, planning, outline: outline.map((slide, index) => index === 1 ? { ...slide, chunkRefs: [] } : slide) });
assert.equal(refreshed.coverage.find(item => item.chunkId === second.id).action, 'included', 'legacy segment refs remain a fallback');

const normalized = api.normalizeOutline({ slides: outline.map(slide => ({ ...slide, supportingPoints: ['mechanism'], question: 'Why?' })) }, 3, gamma);
assert.equal(normalized[1].chunkRefs[0], second.id);
assert.equal(normalized[1].role, 'architecture');
assert.match(api.outlinePrompt({ ...project, title: 'Gamma' }), /Presentation Brief/);
assert.match(api.contentPrompt({ ...project, title: 'Gamma', outline: normalized, planning }, normalized[1], 1), /bullets 由代码派生/);
assert.match(api.contentPrompt({ ...project, title: 'Gamma', outline: normalized, planning }, normalized[1], 1), /<source_packet>/);

const retrieval = retrieveSlideSources({ ...project, planning }, normalized[1], planning.slidePlan[1]);
assert.ok(retrieval.chunkIds.includes(second.id), 'explicit chunk reference must win page-level retrieval');
assert.ok(retrieval.sourceRefs.length);
const compiledTitle = compileTitle({
  title: 'Deck Brief 与 Story Planner 先固定演示目标和叙事结构',
  candidates: ['先定目标，再定叙事'], message: 'Deck Brief stabilizes requirements before generation',
  registry: planning.terminology, previousTitles: [], budget: planning.slidePlan[1].copyBudget,
});
assert.equal(compiledTitle.title, 'Deck Brief 与 Story Planner 先固定演示目标和叙事结构', 'a fitting source-supported title preserves protected terminology');
assert.ok(compiledTitle.fits && compiledTitle.estimatedLines <= 2 && visualUnits(compiledTitle.title) <= compiledTitle.maxVisualUnits);
assert.equal(normalizeHeadline('## **Presentation   Studio**：  标题\n'), 'Presentation Studio：标题');
assert.equal(normalizeTypography('Presentation首个 +User /Data'), 'Presentation 首个 + User / Data');
assert.equal(compileSectionLabel('PPT Agent 与 Knowledge Base 联动并实现企业内部证据可追溯'), 'PPT Agent 与 Knowledge Base 联动并实现企业内部证据可追溯'.split('并')[0]);
const lockedTitle = '2026 AI Lab 产品能力与企业级智能 Agent 平台完整实施路线';
const userDeckTitle = formatUserDeckTitle(lockedTitle);
assert.equal(titleFidelityValue(userDeckTitle.title), titleFidelityValue(lockedTitle));
assert.equal(userDeckTitle.source, 'user');
assert.ok(userDeckTitle.title.includes('\n'));
const coverOutline = { id: 'cover', title: '封面', focus: '封面主张', section: '封面', refs: [], chunkRefs: [] };
const coverSlide = api.normalizeSlide({ title: '封面', bullets: [] }, coverOutline,
  { outline: [coverOutline], deckTitle: null, source: { segments: [{ id: '1', text: 'Executive summary evidence should not be cited on a title cover.' }], semantic: { chunks: [], evidenceAtoms: [] } }, planning: {} });
assert.equal(coverSlide.retrieval, undefined, 'cover slides should not retrieve source evidence or acquire false citations');
assert.deepEqual(coverSlide.sourceRefs, []);
const titleLockedOutline = api.normalizeOutline({ slides: outline }, 3, gamma, null, { ...userDeckTitle, text: userDeckTitle.title, raw: lockedTitle });
assert.equal(titleFidelityValue(titleLockedOutline[0].title), titleFidelityValue(lockedTitle));
assert.equal(titleLockedOutline[0].titleLocked, true);
const recommendation = estimatePageRecommendation({ ...project, inputKind: 'paste', pages: 3 });
assert.equal(recommendation.selected, 3);
assert.equal(recommendation.depthPolicy, 'strict');
const expandedCopy = materializeCopy({
  title: 'Deck Brief 与 Story Planner 先固定演示目标和叙事结构', titleCandidates: ['先定目标，再定叙事'],
  eyebrow: 'PLANNING', subtitle: 'Brief 固定约束，Story Planner 决定页面角色。', takeaway: '规划成为持久状态。',
  contentBlocks: [
    { type: 'definition', heading: 'Deck Brief', body: '持久化演示目标、受众、页数、来源边界和质量约束，形成后续节点共享的输入契约；用户调整页数时重新分配信息，每页生成仍依据同一份约束检查来源覆盖。' },
    { type: 'mechanism', heading: 'Story Planner', body: '把 Brief 与原始语义单元转换成页面角色、核心消息、内容密度和逐页证据映射。' },
    { type: 'evidence', heading: '覆盖映射', body: '每个高优先级语义主题都要映射到页面，未采用的内容必须记录明确原因。' },
    { type: 'implication', heading: '结果', body: '规划成为可验证、可恢复的持久状态，内容节点无需重新猜测整稿意图。' },
  ],
}, normalized[1], planning);
assert.equal(expandedCopy.bullets.length, 4);
const deduplicated = materializeCopy({ title: '稳定规划', contentBlocks: [{ type: 'mechanism', heading: '结论', body: '规划成为持久状态。' }], takeaway: '规划成为持久状态。' }, normalized[1], planning);
assert.equal(deduplicated.copy.takeaway, '', 'takeaway near-duplicates must be removed deterministically');
const copyIssues = inspectSlideCopy({ id: 's2', title: expandedCopy.title.title, titleQuality: expandedCopy.title, bullets: expandedCopy.bullets,
  copy: expandedCopy.copy, factSynthesis: { mechanisms: ['Brief'], implications: ['Persistent planning'] } }, planning.slidePlan[1], 1, 3);
assert.equal(copyIssues.length, 0, JSON.stringify(copyIssues));

const quality = inspectContent({ source: { segments: [{ id: '1', text: 'Revenue was 31 million.' }] }, planning: { coverage: [] } }, { slides: [
  { id: 's1', title: 'Cover', bullets: [], sourceRefs: [] },
  { id: 's2', title: 'Revenue grew to 42 million', bullets: ['Revenue reached 42 million.'], sourceRefs: ['1'] },
  { id: 's3', title: 'Conclusion', bullets: [], sourceRefs: [] },
] });
assert.ok(quality.issues.some(issue => issue.code === 'numeric_fidelity' && issue.severity === 'error'));
const equivalentNumber = inspectContent({ source: { segments: [{ id: '1', text: 'Revenue grew 1,000 万 and margin reached 80％; conversion was 12.50%.' }] } },
  { slides: [{ id: 's1', title: 'Summary', bullets: ['Revenue grew 1000 万, margin reached 80%, and conversion was 12.5%.'], sourceRefs: ['1'] }] });
assert.ok(!equivalentNumber.issues.some(issue => issue.code === 'numeric_fidelity'), 'equivalent separators and percent glyphs must pass fidelity QA');
assert.ok(evidenceVisible({ kind: 'example', exactText: 'CJK char        = 1.00' }, 'CJK char = 1.00，Uppercase Latin = 0.72。'),
  'short source examples with numeric values must count as visible evidence');
assert.ok(!evidenceVisible({ kind: 'example', exactText: 'CJK char        = 1.00' }, 'Uppercase Latin = 0.72。'),
  'different examples must not satisfy each other by broad token overlap');
const longQuality = inspectContent({ pages: 14, source: { text: '少量来源', segments: [{ id: '1', text: '少量来源' }],
  semantic: { chunks: [{ id: 'c1' }] } }, outline: longOutline,
  templateFidelity: { reusePlan: { visualSimilarityPairs: Array(13).fill(.99) } } },
{ slides: longOutline.map((item, index) => ({ id: item.id, title: item.focus, bullets: [], sourceRefs: index === 3 ? [] : ['1'] })) });
for (const code of ['long_deck_source_thin', 'repeated_claim_across_deck', 'ungrounded_content_page', 'template_visual_repetition'])
  assert.ok(longQuality.issues.some(item => item.code === code), code);
console.log('PPT semantic chunking, planning contracts and content QA: OK');
