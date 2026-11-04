// Regressions from the Alpha Mining (module 21 pages) vs Gamma (8 pages)
// comparison, 2026-10-10. Each case is a generic rule, not an Alpha Mining branch.
import assert from 'node:assert/strict';
import { sourceRichText, mathArityValid } from './lib/ppt-rich-text.mjs';
import { mathFallbackRuns, equationContent, mathVariantText } from './lib/ppt-math.mjs';
import { fitComponents, sourceComponent, INCH } from './lib/ppt-density-capacity.mjs';
import { readingUnits } from './lib/ppt-semantic-relations.mjs';
import { markLanguagePairs } from './lib/ppt-presentation-policy.mjs';
import { inspectRelationGroups, inspectReadingOrder, inspectCoverTitle, inspectTerminology, inspectTitleLanguage, inspectCodeWrap, sourceDocumentTitle } from './lib/ppt-deck-coherence.mjs';
import { routeIssue } from './lib/ppt-repair-routing.mjs';

// 1. Math: \mathcal/\mathbb keep their alphabet; identifiers italic; scripts are
// baseline runs at the base size (renderers shrink them; pre-scaling made
// LibreOffice draw f₁ at ~38%).
{
  const rich = sourceRichText('a field library $\\mathcal{F} = \\{f_1, \\dots, f_m\\}$ and $\\mathbb{E}[r]$ over $10^6$');
  assert.match(rich.plainText, /ℱ=\{f1,…,fm\}/u);
  assert.match(rich.plainText, /𝔼\[r\]/u);
  const runs = rich.runs.filter(r => r.kind === 'math').flatMap(r => r.fallbackRuns);
  assert.ok(runs.every(r => r.scale === 1), 'fallback scripts must not be pre-scaled');
  assert.ok(runs.some(r => r.text === '1' && r.baseline === -25000) && runs.some(r => r.text === '6' && r.baseline === 30000));
  assert.ok(runs.some(r => r.text === 'f' && r.italic) && runs.some(r => r.text === 'r' && r.italic));
  assert.ok(!runs.some(r => r.text === '=' && r.italic) && !runs.some(r => r.text === '10' && r.italic));
  assert.equal(mathVariantText('RZ', 'double-struck'), 'ℝℤ');
  assert.equal(mathVariantText('O', 'script'), '𝒪');
  assert.equal(mathVariantText('x', 'bold'), 'x');
  const bold = mathFallbackRuns(equationContent('\\boldsymbol{\\beta}^\\top x').mathMl);
  assert.ok(bold.some(r => r.text === 'β' && r.bold && r.italic) && bold.some(r => r.text === '⊤' && r.baseline === 30000 && !r.italic));
  // KaTeX puts U+2061 beside a function name used as a script: x_{\min}^{2} must keep its superscript.
  const scripts = mathFallbackRuns(equationContent('x_{\\min}^{2}', { displayMode: false }).mathMl).map(r => [r.text, Math.sign(r.baseline)]);
  assert.deepEqual(scripts, [['x', 0], ['min', -1], ['2', 1]]);
  // The review-time diagnostic applies the exporter's arity rules.
  assert.equal(mathArityValid('<math><msub><mi>h</mi><mi>max</mi><mo>\u2061</mo></msub></math>'), true);
  assert.equal(mathArityValid('<math><msub><mi>h</mi></msub></math>'), false);
  assert.equal(mathArityValid('<math><mfrac><mn>1</mn><mn>2</mn><mn>3</mn></mfrac></math>'), false);
  // CJK labels inside a formula stay upright.
  assert.ok(!sourceRichText('$\\frac{净利润}{总资产}$').runs[0].fallbackRuns.some(r => r.italic));
}

// 1b. Markdown emphasis next to fullwidth punctuation (corpus cases from
// 07_quality_factors.md and 13_dl_quant.md) becomes typed runs, never "**".
{
  const runs = text => sourceRichText(text).runs.map(r => (r.bold ? 'B' : '') + (r.italic ? 'I' : '') + (r.code ? 'C' : '') + ':' + r.text);
  assert.deepEqual(runs('**Novy-Marx（2013）**主张'), ['B:Novy-Marx（2013）', ':主张']);
  assert.deepEqual(runs('***更难被发现*的过拟合风险**——深层'), ['BI:更难被发现', 'B:的过拟合风险', ':——深层']);
  assert.deepEqual(runs('需要的是**弱、便宜，并且与资金池中已有的因子*不同***。').slice(-2), ['BI:不同', ':。']);
  assert.deepEqual(runs('2 ** 3 = 8 和 4 ** 2'), [':2 ** 3 = 8 和 4 ** 2']);
  assert.deepEqual(runs('代码 `a ** b` 与 **粗体**'), [':代码 ', 'C:a ** b', ': 与 ', 'B:粗体']);
}

// 2. Translation pairs and lead-ins are reading units.
{
  const items = [
    { id: 'a', type: 'ProcessBlock', sectionPath: ['11'], text: 'The loop is: generate candidate -> apply data masks -> neutralize -> compute IC and spread -> decide accept/reject. The decision should be recorded even for rejected candidates.' },
    { id: 'b', type: 'ProcessBlock', sectionPath: ['11'], text: '流程是：生成候选 -> 应用数据掩码 -> 中性化 -> 计算 IC 和价差 -> 决定接受/拒绝。即使拒绝候选也应记录。' },
  ];
  markLanguagePairs(items);
  assert.ok(items[0].languagePairId && items[0].languagePairId === items[1].languagePairId, 'process paragraphs in two languages pair');
  const units = readingUnits([
    { id: 'p', text: 'Hypothesis', languagePairId: 'x' }, { id: 'q', text: '假设', languagePairId: 'x' },
    { id: 'l1', text: 'Alpha mining inverts this. You define:' }, { id: 'l2', text: '因子挖掘则反过来。你需要定义：' },
    { id: 'list', text: '- a field library\n- 一个字段库' }, { id: 'z', text: 'then generate' }], ['p', 'q', 'l1', 'l2', 'list', 'z']);
  assert.deepEqual(units, [['p', 'q'], ['l1', 'l2', 'list'], ['z']]);
}

// 3. Layout: translation pairs share a row; text flows in reading order; an
// unrelated commentary is never paired; code prefers a non-wrapping frame.
{
  const project = { templateSpec: { width: 13.33 * INCH, height: 7.5 * INCH } };
  const text = (value, pairId) => ({ type: 'text', content: { text: value }, ...(pairId ? { pairId } : {}) });
  const paired = fitComponents([text('The pool-correlation test is crucial. A mined alpha with mediocre standalone statistics may be more valuable than a high-IC clone.', 'p1'),
    text('因子池相关性检验至关重要。一个单独统计一般但与现有因子低相关的挖掘 alpha，可能比高 IC 克隆更有价值。', 'p1'), text('解释：低相关因子的收益流更可能分散已有风险。')], project, 1);
  assert.equal(paired.layoutId, 'bilingual-rows-source');
  assert.equal(paired.boxes[0].y, paired.boxes[1].y, 'a translation pair shares one row');
  assert.ok(paired.boxes[0].x < paired.boxes[1].x && paired.boxes[2].width > paired.boxes[0].width);
  const unrelated = fitComponents([text('Every alpha should have lineage: who generated it, with what data, when.'), text('The pool-correlation test is crucial for mined alphas.'),
    text('角色分离使试验次数、审批与淘汰规则能落实到具体责任人；谱系把这些治理信息绑定到单个 alpha，让计数与审批可审计。')], project, 1);
  assert.notEqual(unrelated.layoutId, 'bilingual-rows-source', 'generated commentary is not a translation');
  assert.ok(unrelated.readingOrder);
  const many = Array.from({ length: 6 }, (_, i) => text(`Paragraph ${i + 1}: `.padEnd(70 + (i % 3) * 30, 'source sentence ')));
  const flow = fitComponents(many, project, 1);
  assert.ok(flow.capacity_ok && flow.readingOrder, 'a fitting reading-order layout wins over shortest-column packing');
  const code = { type: 'text', content: { text: 'def f(df):\n    ret5 = df.groupby("ticker")["close"].pct_change(5)\n    return ret5', codeBlock: { language: 'python' } } };
  const withCode = fitComponents([code, text('Short note.')], project, 1);
  assert.equal(withCode.codeWraps, 0, 'a fitting full-width frame avoids wrapping code');
}

// 4. Deck coherence checks (warnings with an owner layer).
{
  const items = [
    { id: 'e1', text: 'Search is cheap.', languagePairId: 'lp1' }, { id: 'z1', text: '搜索很廉价。', languagePairId: 'lp1' },
    { id: 'lead', text: 'You define:' }, { id: 'list', text: '- a field library' },
  ];
  const node = (id, extra = {}) => ({ id: 'n_' + id, type: 'text', semanticRole: 'source-structure', sourceArtifact: { sourceUnitId: id }, content: { text: id }, ...extra });
  const project = { source: { text: '# Tutorial 10 — Alpha Mining: Formulaic Alphas | 因子挖掘：公式化因子\n\n## 5. Genetic Programming | 遗传编程与因子挖掘\n遗传编程把公式表示为树。', semantic: { inventory: { items } } }, deckTitle: { source: 'agent' } };
  const slides = [
    { id: 's0', title: '因子挖掘', nodes: [{ id: 'cover', type: 'text', semanticRole: 'title', content: { text: '因子挖掘' } }] },
    { id: 's1', title: '原则', nodes: [node('e1'), node('lead')] },
    { id: 's2', title: '原则（续）', nodes: [node('z1'), node('list')] },
  ];
  const relation = inspectRelationGroups(project, slides);
  assert.deepEqual(relation.map(i => i.code).sort(), ['relation_leadin_split', 'relation_pair_split']);
  assert.ok(relation.every(i => i.severity === 'warning' && routeIssue(i.code).ownerLayer === 'semantic'));
  assert.deepEqual(sourceDocumentTitle(project).variants.map(v => [v.main, v.subtitle]), [['Alpha Mining', 'Formulaic Alphas'], ['因子挖掘', '公式化因子']]);
  const cover = inspectCoverTitle(project, slides);
  assert.equal(cover[0]?.code, 'cover_source_title_incomplete');
  // Round 7 (B1): the cover topic uses the deck language only (English here by
  // visible width), so only the English title parts are required.
  assert.deepEqual(cover[0].missing, ['Alpha Mining', 'Formulaic Alphas']);
  assert.equal(inspectCoverTitle({ ...project, deckTitle: { source: 'user' } }, slides).length, 0, 'a user title is not second-guessed');
  const overviewTitle={...project,generationPolicy:{content:'overview',details:'notes',language:{mode:'output',locale:'zh'}}};
  const sourceCover={id:'source-cover',title:'因子挖掘：公式化因子',nodes:[{id:'title',type:'text',semanticRole:'title',content:{text:'因子挖掘：公式化因子'}}]};
  assert.equal(inspectCoverTitle(overviewTitle,[sourceCover]).length,0,'single-language overview does not force the other original cover title onto slides');
  assert.equal(inspectCoverTitle({...overviewTitle,generationPolicy:{...overviewTitle.generationPolicy,content:'full_source',details:'slides'}},[sourceCover]).length,0,'an explicit output language also governs full-source cover titles');
  assert.ok(inspectCoverTitle({...overviewTitle,generationPolicy:{...overviewTitle.generationPolicy,content:'full_source',details:'slides',language:{mode:'source',body:'both'}}},[sourceCover]).length,'source-language full-source cover identity remains bilingual');

  // A generated title that renames the heading term of its own section.
  project.source.semantic.inventory.items.push({ id: 'gp', text: '遗传编程把公式表示为树。', sectionPath: ['5. Genetic Programming | 遗传编程与因子挖掘'] });
  const gpSlide = { id: 's3', title: '遗传规划：用公式树演化候选因子', nodes: [node('gp'), { id: 'x', type: 'text', semanticRole: 'source-explanation', content: { text: '遗传规划将候选公式编码为树。' } }] };
  const drift = inspectTerminology(project, [gpSlide]);
  assert.equal(drift.length, 1); assert.equal(drift[0].used, '遗传规划'); assert.equal(drift[0].sourceTerm, '遗传编程');
  assert.equal(inspectTerminology(project, [{ ...gpSlide, title: '遗传编程：用公式树演化候选因子', nodes: [node('gp')] }]).length, 0);
  // zh-HK: the same rule over Traditional characters and the 與 connector.
  const hk = { source: { text: '## 5. Genetic Programming | 遺傳編程與因子挖掘\n遺傳編程把公式表示為樹。', semantic: { inventory: { items: [{ id: 'hk', text: '遺傳編程把公式表示為樹。', sectionPath: ['5. Genetic Programming | 遺傳編程與因子挖掘'] }] } } } };
  assert.deepEqual(inspectTerminology(hk, [{ id: 'h', title: '遺傳規劃：用公式樹演化候選因子', nodes: [node('hk')] }]).map(i => [i.used, i.sourceTerm]), [['遺傳規劃', '遺傳編程']]);
  // Reading order and wrapped code from the measured fit.
  const shuffled = { id: 'r', sourceArtifactFit: { layoutId: 'parallel-source', boxes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }] } };
  assert.equal(inspectReadingOrder([shuffled])[0]?.code, 'layout_reading_order_broken');
  assert.equal(inspectReadingOrder([{ ...shuffled, sourceArtifactFit: { ...shuffled.sourceArtifactFit, readingOrder: true } }]).length, 0);
  assert.equal(inspectCodeWrap([{ id: 'c', sourceArtifactFit: { layoutId: 'parallel-source', codeWraps: 5 } }])[0]?.code, 'code_line_wrapped');
  // Round 7 (B1): bilingual body, titles in the deck language only.
  const pairs = Array.from({ length: 6 }, (_, i) => [{ id: 'a' + i, languagePairId: 'p' + i }, { id: 'b' + i, languagePairId: 'p' + i }]).flat();
  const titled = ['因子挖掘', '两种研究范式对比', '算子代数', '遗传编程', '因子组合'].map((title, i) => ({ id: 't' + i, title }));
  const chineseSource = { text: '因子挖掘教程以中文为主，包含少量 English。', semantic: { inventory: { items: pairs } } };
  assert.equal(inspectTitleLanguage({ source: chineseSource, generationPolicy: { language: { mode: 'source' } } }, titled).length, 0, 'Chinese deck, Chinese titles');
  assert.equal(inspectTitleLanguage({ source: chineseSource, generationPolicy: { language: { mode: 'output', locale: 'en' } } }, titled)[0]?.code, 'title_language_inconsistent', 'English output, Chinese titles');
}

// 5. Source components carry their translation-pair identity for layout.
assert.equal(sourceComponent({ id: 'x', type: 'MechanismBlock', text: 'Hello world', languagePairId: 'lp_x' }).pairId, 'lp_x');
// 6. A binomial's text fallback has one pair of parentheses (live mlq-r37 p31: "((N choose k))").
assert.equal(mathFallbackRuns(equationContent('\\binom{N}{k}', { displayMode: false }).mathMl).map(r => r.text).join('').replace(/\s+/gu, ' ').trim(), '(N choose k)');
assert.equal(mathFallbackRuns(equationContent('\\frac{a}{b}', { displayMode: false }).mathMl).map(r => r.text).join(''), '(a)/(b)');
console.log('Alpha Mining gap regressions (math variants, reading units, layout order, deck coherence): passed');
