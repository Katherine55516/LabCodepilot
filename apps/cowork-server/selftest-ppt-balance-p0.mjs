import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePaste } from './lib/ppt-source.mjs';
import { splitTableRow, markdownRows, normalizeTableRows, coverageMapV2 } from './lib/ppt-content-inventory.mjs';
import { estimatePageRecommendation } from './lib/ppt-planning.mjs';
import { sourceDensityPlan } from './lib/ppt-density-packing.mjs';
import { codePresentation, applyPresentationPolicy, syncPresentationPolicy, planningAssumptions, codeDiagram, isAsciiDiagram } from './lib/ppt-presentation-policy.mjs';
import { promptPolicy, sourceObjects } from './lib/ppt-prompt-contracts.mjs';
import { normalizeGenerationPolicy, PPT_PROMPT_CONTRACT_VERSION } from './lib/ppt-generation-policy.mjs';
import { inspectObjectIntegrity } from './lib/ppt-object-integrity.mjs';

const policy = code => ({ version: 1, detail: 'balanced', language: { mode: 'source' }, knowledge: 'source_only', ...(code ? { code: { presentation: code } } : {}) });

// 1. Table cells: math/code pipes are content; currency and escapes still behave.
assert.deepEqual(splitTableRow('| Horizon | $|\\overline{IC}|$ | Meaning |'), ['Horizon', '$|\\overline{IC}|$', 'Meaning']);
assert.deepEqual(splitTableRow('| Cost | $5 | $10 |'), ['Cost', '$5', '$10'], 'currency is not inline math');
assert.deepEqual(splitTableRow('| Op | `a|b` | x \\| y |'), ['Op', '`a|b`', 'x | y']);
assert.deepEqual(splitTableRow('| f | \\(|x|\\) | ok |'), ['f', '\\(|x|\\)', 'ok']);
assert.deepEqual(markdownRows('| a | b |\n|---|---|\n| $|x|$ | 2 |').map(row => row.length), [2, 2]);
const ragged = normalizeTableRows([['A', 'B', 'C'], ['1', '2'], ['1', '2', '3', '4']]);
assert.deepEqual(ragged.rows, [['A', 'B', 'C'], ['1', '2', ''], ['1', '2', '3 | 4']]);
assert.equal(ragged.warning.code, 'source_table_ragged_rows');
assert.equal(normalizeTableRows([['A'], ['1']]).warning, null);

// 2. A malformed table never fails the estimate: it is normalised and disclosed.
const raggedSource = normalizePaste('# T\n\n## Data\n\n| A | B |\n|---|---|\n| 1 | 2 | 3 |\n\nThe table lists values.\n\n## Notes\n\n' + 'A longer paragraph about the data. '.repeat(40));
const raggedItem = raggedSource.semantic.inventory.items.find(item => item.type === 'TableBlock');
assert.equal(raggedItem.rows[1].length, 2); assert.equal(raggedItem.tableGeometryWarning.code, 'source_table_ragged_rows');
const raggedEstimate = estimatePageRecommendation({ inputKind: 'paste', source: raggedSource, prompt: '', generationPolicy: policy() });
assert.ok(raggedEstimate.recommended >= 3);
assert.ok(raggedEstimate.assumptions.some(item => item.topic === 'table'));
const broken = structuredClone(raggedSource); broken.semantic.inventory.items.find(item => item.type === 'TableBlock').rows = [['A', 'B'], ['1']];
const degraded = estimatePageRecommendation({ inputKind: 'paste', source: broken, prompt: '', generationPolicy: policy() });
assert.ok(degraded.warnings.some(item => item.code === 'capacity_estimate_failed'), 'capacity failure degrades to a warning');
assert.ok(degraded.recommended >= 3);

// 3. Fenced diagrams are processes, not code; an equivalent second flow is merged.
const ascii = '┌────────┐\n│ Load   │  read files\n└──┬─────┘\n   ▼\n┌────────┐\n│ Check  │  validate → report\n└──┬─────┘\n   ▼\n┌────────┐\n│ Score  │  rank items\n│ items  │\n└──┬─────┘\n   ▼\n  Publish';
assert.ok(isAsciiDiagram(ascii)); assert.ok(!isAsciiDiagram('def f(x):\n    # │ not a box\n    return x'));
assert.equal(codeDiagram(ascii).text, '1. Load: read files\n2. Check: validate ⇒ report\n3. Score items: rank items\n4. Publish');
const flows = normalizePaste(['# Guide', '', '## 1. Pipeline', '', 'Every job follows the same stages.', '',
  '```', ascii, '```', '', '```mermaid', 'flowchart TD', '  A[Load] --> B[Check: validate]', '  B --> S[Score items]', '  S --> C{Passes?}', '  C -- Yes --> D[Publish]', '  C -- No --> E[Reject]', '```', '',
  '## 2. Code', '', 'The loader is short.', '', '```python', 'def load(path):', '    return open(path).read()', '```', ''].join('\n'));
const flowItems = flows.semantic.inventory.items;
const processes = flowItems.filter(item => item.type === 'ProcessBlock');
assert.equal(processes.length, 2); assert.ok(processes.every(item => item.diagramSource));
assert.match(processes[1].text, /Passes\?: Yes: Publish; No: Reject/);
assert.equal(processes[1].presentation, 'merged_equivalent'); assert.equal(processes[1].equivalentTo, processes[0].id);
assert.equal(processes[1].must_preserve_structure, false);
assert.equal(flowItems.filter(item => item.type === 'CodeBlock').length, 1, 'real code stays CodeBlock');

// 4. Code presentation policy (decision 2026-10-08).
assert.deepEqual(codePresentation({}), { mode: 'omit_with_disclosure', basis: 'default_non_code_template' });
assert.equal(codePresentation({ inputKind: 'paste', prompt: '请保留完整代码示例' }).mode, 'keep');
assert.equal(codePresentation({ inputKind: 'paste', prompt: 'Please include the code snippets' }).mode, 'keep');
assert.equal(codePresentation({ inputKind: 'paste', prompt: '不要放代码' }).basis, 'user_intent');
assert.equal(codePresentation({ templateSpec: { fonts: { body: 'Inter', code: 'JetBrains Mono' } } }).basis, 'template_code_component');
assert.equal(codePresentation({ generationPolicy: policy('keep') }).basis, 'user_choice');
const omitted = applyPresentationPolicy(flows, { generationPolicy: policy() });
const code = omitted.semantic.inventory.items.find(item => item.type === 'CodeBlock');
assert.equal(code.presentation, 'omitted_by_policy'); assert.equal(code.must_preserve_structure, false);
assert.ok(!omitted.semantic.inventory.must_cover_topics.includes(code.id));
const restored = applyPresentationPolicy(omitted, { generationPolicy: policy('keep') }).semantic.inventory.items.find(item => item.type === 'CodeBlock');
assert.equal(restored.presentation, undefined); assert.equal(restored.must_preserve_structure, true, 'keep restores the required object');
assert.deepEqual(applyPresentationPolicy(omitted, { generationPolicy: policy() }).semantic.inventory.items, omitted.semantic.inventory.items, 'idempotent');
assert.equal(flows.semantic.inventory.items.find(item => item.type === 'CodeBlock').presentation, undefined, 'stored source not mutated');
const assumptions = planningAssumptions({ generationPolicy: policy() }, omitted);
assert.deepEqual(assumptions.map(item => item.topic), ['code', 'diagram', 'merge']);
assert.ok(assumptions[0].reversible && assumptions[0].affectedSourceIds.includes(code.id));
const project = syncPresentationPolicy({ id: 'p', inputKind: 'paste', prompt: '', source: flows, generationPolicy: policy() });
const integrity = inspectObjectIntegrity(project, [{ id: 's1', nodes: [] }]);
assert.ok(!integrity.ledger.objects.some(object => object.objectId === code.id), 'omitted code is not a required object');
assert.ok(!integrity.ledger.objects.some(object => object.objectId === processes[1].id), 'merged flow is not a second required object');
const detail = coverageMapV2(project.source, [{ id: 's1', chunkRefs: [] }]).detail;
assert.equal(detail.find(item => item.sourceUnitId === code.id).representation, 'omitted_by_policy');
assert.match(detail.find(item => item.sourceUnitId === code.id).reason, /default_non_code_template/);
const policyText = promptPolicy(project);
assert.match(policyText, new RegExp(`contract_version=${PPT_PROMPT_CONTRACT_VERSION}`)); assert.ok(PPT_PROMPT_CONTRACT_VERSION >= 9);
assert.match(policyText, new RegExp(`code_presentation=omit_with_disclosure.*${code.id}`));
assert.match(policyText, new RegExp(`${processes[1].id}=${processes[0].id}`));
assert.ok(!sourceObjects(project.source).some(object => object.id === code.id));
const kept = syncPresentationPolicy({ ...project, generationPolicy: policy('keep') });
assert.match(promptPolicy(kept), /code_presentation=keep \(user_choice\)/);
assert.ok(inspectObjectIntegrity(kept, [{ id: 's1', nodes: [] }]).issues.some(issue => issue.sourceUnitId === code.id && issue.code === 'required_source_object_missing'));

// 5. Generation policy accepts the explicit code choice only.
assert.deepEqual(normalizeGenerationPolicy(policy('omit')).code, { presentation: 'omit' });
assert.equal(normalizeGenerationPolicy(policy('auto')).code, undefined);
assert.throws(() => normalizeGenerationPolicy(policy('maybe')), /invalid generation policy/);

// 6. Parallel bilingual paragraphs: one claim, both languages keep display cost.
const bilingual = normalizePaste(['# Costs', '', '## Turnover', '',
  'If a factor earns 4% gross alpha with 800% annual turnover, it tolerates only about 50 bps one-way cost.', '',
  '若因子产生 4% 总 alpha，但年化换手 800%，则大约只能承受 50 bps 的单边等效成本。', '',
  'Correlation with existing signals is checked first, then a spanning regression is run.', '',
  '先检查与已有信号的相关性，再做一次覆盖回归，最后检验组合中的增量贡献是否显著存在。', '',
  'Daily IC above 0.05 is rare.', '', '月频 IC 超过 0.10 通常需要先排查未来函数。', ''].join('\n'));
const pairs = bilingual.semantic.inventory.items.filter(item => item.languagePairId);
assert.equal(new Set(pairs.map(item => item.languagePairId)).size, 1, 'only the pair with shared anchors is confirmed; plain adjacency stays a candidate');
assert.ok(pairs.every(item => ['primary', 'translation'].includes(item.languageRole)));
const plan = sourceDensityPlan(bilingual, { generationPolicy: policy() });
assert.equal(plan.languagePairs, 1);
assert.equal(bilingual.semantic.inventory.items.filter(item=>item.languagePairCandidate).length,2);
assert.ok(plan.groups.some(group => group.relations.includes('translation_pair')));
const bilingualEstimate = estimatePageRecommendation({ inputKind: 'paste', source: bilingual, prompt: '', generationPolicy: policy() });
assert.ok(bilingualEstimate.assumptions.some(item => item.topic === 'language' && /输出语言与输入一致/.test(item.reason)));

// 7. Optional real fixture: the 09 tutorial estimate no longer throws and,
// with code omitted and both languages kept, lands in the planned range.
const fixture = path.join(process.env.PPT_EVAL_INPUT_DIR || '/Users/dongli/Documents/quant_research/quant_3.0', '09_factor_testing.md');
if (fs.existsSync(fixture)) {
  const source = normalizePaste(fs.readFileSync(fixture, 'utf8'));
  const estimate = estimatePageRecommendation({ inputKind: 'paste', source, prompt: '', generationPolicy: policy() });
  assert.ok(estimate.recommended >= 26 && estimate.recommended <= 34, `09 estimate ${estimate.recommended}`);
  const keep = estimatePageRecommendation({ inputKind: 'paste', source, prompt: '', generationPolicy: policy('keep') });
  assert.ok(keep.recommended > estimate.recommended, 'keeping code raises the estimate');
  console.log(`09 fixture: ${estimate.recommended} pages with code omitted, ${keep.recommended} with code kept`);
} else console.log('09 fixture not present; skipped real-input range check');

console.log('PPT balance P0: math-aware tables, non-throwing estimate, diagram steps/merge, code policy, bilingual pairs, prompt policy: OK');
