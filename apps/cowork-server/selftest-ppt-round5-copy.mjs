// Round 5 Alpha Mining F-P1 copy rules: eyebrow normalization (F-P1-11).
// Synthetic template IR and inventory; no Alpha Mining branches.
import assert from 'node:assert/strict';
import { sourceHeadingTerms, terminologyLockPrompt, withHeadingTerms } from './lib/ppt-terminology-lock.mjs';
import { criticRewriteTargets, outlineContentContract } from './lib/ppt-prompt-contracts.mjs';
import { codeHangingIndent, textParagraphs, textContract, measureText } from './lib/ppt/render-contract.mjs';
import { inspectCodeWrap } from './lib/ppt-deck-coherence.mjs';
import { parseSourceHeading, eyebrowCandidates, slideSourceHeading, normalizeDeckEyebrows, bilingualTitleRule } from './lib/ppt-section-eyebrow.mjs';
import { inspectTitleLanguage } from './lib/ppt-deck-coherence.mjs';

assert.deepEqual(parseSourceHeading('### 1.3 The central tension: mining power vs. overfitting | 核心张力：挖掘能力与过拟合'),
  { number: '1.3', names: ['The central tension: mining power vs. overfitting', '核心张力：挖掘能力与过拟合'] });
assert.deepEqual(parseSourceHeading('## 2. The Operator Algebra | 算子代数'), { number: '2', names: ['The Operator Algebra', '算子代数'] });
const zh = eyebrowCandidates('1.3 The central tension: mining power vs. overfitting | 核心张力：挖掘能力与过拟合', { locale: 'zh', bilingual: true });
assert.equal(zh.bilingual, '1.3 核心张力 · The central tension');
assert.equal(zh.primary, '1.3 核心张力');
assert.equal(eyebrowCandidates('2. The Operator Algebra | 算子代数', { locale: 'en', bilingual: false }).bilingual, null);
assert.equal(eyebrowCandidates('2. The Operator Algebra | 算子代数', { locale: 'en', bilingual: false }).primary, '2 The Operator Algebra');
assert.equal(eyebrowCandidates('2. Operator Algebra | 算子代数', { locale: 'zh-HK', bilingual: false }, '算子代數').primary, '2 算子代數', 'zh-HK keeps the localized label behind the source number');

const H1 = 'Tutorial 10 — Topic | 主题';
const item = (id, path) => ({ id, sectionPath: [H1, ...path], text: id });
const items = [item('a', ['1. What It Is | 是什么', '1.1 Two paradigms | 两种范式']), item('b', ['1. What It Is | 是什么', '1.3 The central tension: power vs. overfitting | 核心张力：能力与过拟合']),
  item('c', ['1. What It Is | 是什么', '1.3 The central tension: power vs. overfitting | 核心张力：能力与过拟合']), item('d', ['2. The Operator Algebra | 算子代数'])];
const project0 = { source: { semantic: { inventory: { items } } } };
assert.equal(slideSourceHeading(project0, { sourceUnitIds: ['a', 'b', 'c'] }), '1.3 The central tension: power vs. overfitting | 核心张力：能力与过拟合', 'majority heading');
assert.equal(slideSourceHeading(project0, { sourceUnitIds: [] }), null);

// Deck-wide tier: one wide unwrapped slot and one boxed-in slot.
const E = 914400, g = (x, y, w, h) => ({ x: x * E, y: y * E, width: w * E, height: h * E });
const page = (sectionWidth, blocker) => ({ slots: [{ shapeId: 1, role: 'section', capacity: 6, fontSizePt: 11.5 }, { shapeId: 2, role: 'title', capacity: 30 }],
  nodes: [{ nativeRef: { shapeId: 1 }, type: 'text', geometry: g(.7, .6, sectionWidth, .2), nativeTextFrame: { wordWrap: false }, style: { fontSizePt: 11.5 } },
    { nativeRef: { shapeId: 2 }, type: 'text', geometry: g(.7, 1, 11.9, .6) }, ...(blocker ? [{ nativeRef: { shapeId: 3 }, type: 'image', geometry: g(blocker, .4, 1, 1) }] : [])] });
const deck = blocker => ({ generationPolicy: { language: { mode: 'source' } }, source: project0.source,
  outline: [{ id: 's0' }, { id: 's1', sourceUnitIds: ['a'] }, { id: 's2', sourceUnitIds: ['b', 'c'] }, { id: 's3', sourceUnitIds: ['d'] }],
  deck: { slides: [{ id: 's0', title: '主题' }, { id: 's1', title: '两种研究范式', section: '研究范式' }, { id: 's2', title: '核心张力', section: '1.3 The central tension' }, { id: 's3', title: '算子代数', section: '算子' }] },
  templateFidelity: { mode: 'preserve', width: 13.33 * E, height: 7.5 * E, slides: [{ slots: [], nodes: [] }, page(1.2), page(1.7), page(1.2, blocker)] } });
const wide = deck(null), result = normalizeDeckEyebrows(wide);
assert.equal(result.tier, 'bilingual');
assert.deepEqual(wide.deck.slides.slice(1).map(s => s.section), ['1.1 两种范式 · Two paradigms', '1.3 核心张力 · The central tension', '2 算子代数 · The Operator Algebra']);
assert.ok(wide.deck.slides[1].sectionLabel.width > 1.2 * E, 'the unwrapped label is measured to the title edge');
assert.deepEqual(wide.titlePolicy, { version: 1, primary: 'zh', otherLanguage: 'eyebrow' }, 'F-P1-5: bilingual eyebrows record the title policy');
const narrow = deck(2.2), tight = normalizeDeckEyebrows(narrow);
assert.equal(narrow.titlePolicy, undefined, 'no bilingual eyebrow, no single-language title policy');
assert.equal(tight.tier, 'primary', 'an object beside one label drops the whole deck to the same shorter format');
assert.deepEqual(narrow.deck.slides.slice(1).map(s => s.section), ['1.1 两种范式', '1.3 核心张力', '2 算子代数']);
const locked = deck(null); locked.deck.slides[2].sectionLabel = { basis: 'user' }; normalizeDeckEyebrows(locked);
assert.equal(locked.deck.slides[2].section, '1.3 The central tension', 'a user-edited label is kept');

// F-P1-6: terminology lock from bilingual headings; drift triggers a local rewrite.
const termSource = { text: '# T | 主题\n\n## 5. Genetic Programming for Alpha Mining | 遗传编程与因子挖掘\n\nBody.\n\n## 7. The Alpha Evaluation Gauntlet | 因子评估关卡\n',
  semantic: { inventory: { items: [item('g', ['5. Genetic Programming for Alpha Mining | 遗传编程与因子挖掘']), item('h', ['7. The Alpha Evaluation Gauntlet | 因子评估关卡'])] } } };
const terms = sourceHeadingTerms(termSource);
assert.deepEqual(terms[0], { number: '5', en: 'Genetic Programming for Alpha Mining', zh: '遗传编程与因子挖掘', terms: ['遗传编程', '因子挖掘'] });
assert.deepEqual(terms[1].terms, ['因子评估关卡']);
assert.deepEqual(sourceHeadingTerms({ text: '## 1. Intro\n' }).map(t => t.terms.length), [0], 'monolingual headings carry no Han terms');
assert.match(terminologyLockPrompt(termSource), /locked_terms[\s\S]*遗传编程与因子挖掘[\s\S]*不得换成近义词/u);
assert.equal(terminologyLockPrompt({ text: 'plain text' }), '');
assert.deepEqual(withHeadingTerms({ version: 1 }, termSource).headingTerms.length, 2);
const driftProject = { generationPolicy: { version: 1, detail: 'balanced', language: { mode: 'source' }, content: 'full_source', details: 'slides', knowledge: 'source_plus_explanation' },
  source: termSource, outline: [], runtime: {}, deck: { slides: [{ id: 'c', nodes: [] }, { id: 'x', title: '遗传规划：用公式树演化候选因子', nodes: [] }] } };
assert.match(outlineContentContract({ ...driftProject, pages: 8 }), /<locked_terms>/u, 'the planner prompt carries the locked terms');
const targets = criticRewriteTargets(driftProject, {}, { issues: [{ code: 'terminology_drift', severity: 'warning', slideId: 'x', used: '遗传规划', sourceTerm: '遗传编程' }] });
assert.ok(JSON.stringify(targets).includes('"x"'), 'a terminology drift warning schedules a local rewrite');

// F-P1-9: code keeps its text; a wrapped line continues under its own indentation.
assert.deepEqual(codeHangingIndent('    ret5 = df.pct_change(5)', 10), { marginLeftPt: 36, indentPt: -36 });
assert.deepEqual(codeHangingIndent('\tx', 10), { marginLeftPt: 36, indentPt: -36 }, 'a tab is four columns');
assert.deepEqual(codeHangingIndent('def f():', 10), { marginLeftPt: 12, indentPt: -12 });
const codeText = 'def f(df):\n    ret5 = df.groupby("ticker")["close"].pct_change(5).rolling(20).mean().rank(pct=True)\n    return ret5';
const codeEl = { kind: 'text', content: { text: codeText, codeBlock: { language: 'python' } }, style: { fontSizePt: 10 }, bounds: { width: 3 * 914400, height: 3 * 914400 } };
const paragraphs = textParagraphs(codeEl);
assert.equal(paragraphs.map(p => p.text).join('\n'), codeText, 'code text, including leading spaces, is unchanged');
assert.deepEqual(paragraphs.map(p => p.marginLeftPt), [12, 36, 36]);
const measured = measureText(codeEl, textContract(codeEl)), flat = measureText({ ...codeEl, content: { text: codeText } }, { ...textContract(codeEl), paragraphs: paragraphs.map(({ marginLeftPt, indentPt, ...rest }) => rest) });
assert.ok(measured.lines > 3 && measured.lines >= flat.lines, 'continuation lines are measured at the narrower indented width');
assert.equal(inspectCodeWrap([{ id: 'a', sourceArtifactFit: { codeWraps: 2, layoutId: 'x', codeHangingIndent: true } }]).length, 0);
assert.equal(inspectCodeWrap([{ id: 'b', sourceArtifactFit: { codeWraps: 2, layoutId: 'x' } }])[0].code, 'code_line_wrapped', 'fits without the hanging indent are still reported');

// F-P1-5: titles in one language are fine under the recorded policy; an off-language title is reported.
const pairedItems = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, languagePairId: 'lp' + (i >> 1), text: 'x' }));
const bilingualDeck = { generationPolicy: { language: { mode: 'source' } }, source: { semantic: { inventory: { items: pairedItems } } } };
const titled = list => [{ id: 'c', title: '封面' }, ...list.map((title, i) => ({ id: 't' + i, title }))];
assert.equal(inspectTitleLanguage(bilingualDeck, titled(['两种研究范式', '核心张力', '算子代数', '因子组合']))[0].code, 'title_language_inconsistent', 'without a policy, single-language titles are reported');
const withPolicy = { ...bilingualDeck, titlePolicy: { version: 1, primary: 'zh', otherLanguage: 'eyebrow' } };
assert.deepEqual(inspectTitleLanguage(withPolicy, titled(['两种研究范式', '核心张力', '算子代数', '因子组合'])), []);
assert.deepEqual(inspectTitleLanguage(withPolicy, titled(['两种研究范式', 'Core tension', '算子代数', '因子组合']))[0].off, ['t1']);
assert.match(bilingualTitleRule({ ...bilingualDeck, outline: [{ title: '封面' }, { title: '核心张力' }] }), /统一使用中文/u);
assert.equal(bilingualTitleRule({ ...bilingualDeck, generationPolicy: { language: { mode: 'output', locale: 'en' } } }), '');
console.log('Round 5 copy rules: eyebrow normalization, bilingual title policy, terminology lock and code hanging indent: passed');
