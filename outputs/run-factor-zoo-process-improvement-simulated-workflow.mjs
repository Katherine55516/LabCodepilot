/**
 * Reproducible PPT-module run. Environment variables select the input,
 * template, output, title and a deterministic simulation profile.
 * modelCall produces deterministic, source-grounded JSON in place of a remote
 * LLM. The local harness also invokes the module's exact template analyzer and
 * PPTX renderer scripts on the host because a Cowork image is unavailable.
 * All project, DAG, quality, and publish transitions use handlePpt.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { normalizePaste } from '../apps/cowork-server/lib/ppt-source.mjs';
import { estimatePageRecommendation } from '../apps/cowork-server/lib/ppt-planning.mjs';
import { evidenceVisible, evidenceRelevance, selectEvidenceForSlide } from '../apps/cowork-server/lib/ppt-evidence.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(projectRoot, 'outputs');
const sourcePath = process.env.PPT_INPUT_PATH || '/Users/dongli/Documents/quant_research/quant_3.0/04_factor_zoo_overview.md';
const templatePath = process.env.PPT_TEMPLATE_PATH || path.join(outputDir, 'factor-zoo-process-improvement-template-upload-optimized.pptx');
const deckPrompt = process.env.PPT_DECK_PROMPT || 'Create an English-language teaching deck on the factor zoo for quantitative-finance learners. Treat the supplied tutorial as the exclusive source of facts. Preserve the asset-pricing lineage, equations, model construction details, empirical cautions, factor taxonomy, 2x3 worked example, and research-to-strategy workflow. Explain characteristic, factor, signal, anomaly and alpha; distinguish risk, mispricing and data-mining; do not invent figures, returns, data or citations. Retain the uploaded template style while replacing unrelated operational-performance claims.';
const templateName = process.env.PPT_TEMPLATE_NAME || 'Process Improvement Proposal — Factor Zoo';
const profile = process.env.PPT_SIMULATION_PROFILE || 'factor-zoo';
const python = '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimate-ppt-simulated-'));
process.env.COWORK_STATE_DIR = stateDir;
process.env.PPT_NODE_CONCURRENCY = '3';

const sourceText = fs.readFileSync(sourcePath, 'utf8');
const templateBytes = fs.readFileSync(templatePath);
if (!sourceText.trim() || !templateBytes.length) throw new Error('Input or template is empty');
const normalizedSource = normalizePaste(sourceText);
if (normalizedSource.truncated || normalizedSource.text.length < sourceText.trim().length * 0.98) throw new Error('Input was truncated during normalization');
const pageRecommendation = estimatePageRecommendation({ inputKind: 'paste', source: normalizedSource, prompt: deckPrompt });
const outputStem = 'factor-zoo-process-improvement-' + pageRecommendation.recommended + '-slides-simulated';
const outputPath = process.env.PPT_OUTPUT_PATH || path.join(outputDir, `${outputStem}.pptx`);
const reportPath = process.env.PPT_REPORT_PATH || path.join(outputDir, `${outputStem}-workflow.json`);

const [{ handlePpt }, store, templates, renderer, pptxImport, templateFidelity] = await Promise.all([
  import(path.join(projectRoot, 'apps/cowork-server/lib/ppt-api.mjs')),
  import(path.join(projectRoot, 'apps/cowork-server/lib/ppt-store.mjs')),
  import(path.join(projectRoot, 'apps/cowork-server/lib/ppt-template.mjs')),
  import(path.join(projectRoot, 'apps/cowork-server/lib/ppt-render.mjs')),
  import(path.join(projectRoot, 'apps/cowork-server/lib/ppt/import-pptx.mjs')),
  import(path.join(projectRoot, 'apps/cowork-server/lib/ppt-template-fidelity.mjs')),
]);

const externalTemplateDir = path.join(stateDir, 'external');

function runPython(script, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', script], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; const errors = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const stdout = Buffer.concat(chunks); const stderr = Buffer.concat(errors).toString('utf8');
      if (code !== 0) reject(new Error(stderr || `Python exited ${code}`));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

const PPTX_INSPECT_SCRIPT = String.raw`
import json, os, zipfile
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
def inspect(path):
    prs=Presentation(path); shapes=[shape for slide in prs.slides for shape in slide.shapes]
    pictures=[shape for shape in shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE]
    fonts=set()
    for shape in shapes:
        if not shape.has_text_frame: continue
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:
                if run.text.strip() and run.font.name: fonts.add(run.font.name)
    with zipfile.ZipFile(path) as archive: media=[name for name in archive.namelist() if name.startswith('ppt/media/')]
    return {'slides':len(prs.slides),'shapes':len(shapes),'pictures':len(pictures),
      'pictureShapeIdsBySlide':[[int(shape.shape_id) for shape in slide.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE] for slide in prs.slides],
      'mediaParts':len(media),'explicitFonts':sorted(fonts)}
print(json.dumps({'template':inspect(os.environ['PPT_TEMPLATE_PATH']),'output':inspect(os.environ['PPT_OUTPUT_PATH'])}))
`;

const { slides } = await import(new URL('./factor-zoo-process-improvement-slide-plan.mjs', import.meta.url));
const pageCount = pageRecommendation.recommended;
if (slides.length !== pageCount) throw new Error('Source-grounded outline does not match the module estimate');

function relatedChunksFor(chunks, spec, index) {
  if (Array.isArray(spec.sourceChunkIds) && spec.sourceChunkIds.length) {
    const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
    return spec.sourceChunkIds.map(id => byId.get(id)).filter(Boolean);
  }
  if (!['semantic', 'title-depth-v4', 'title-content-expansion', 'factor-zoo'].includes(profile)) return chunks.slice(Math.floor(index * chunks.length / slides.length), Math.ceil((index + 1) * chunks.length / slides.length));
  const matched = chunks.filter(chunk => (spec.sourceKeywords || []).some(keyword =>
    `${chunk.sectionPath?.join(' ') || ''} ${chunk.topic || ''}`.toLowerCase().includes(keyword.toLowerCase())));
  if (matched.length) return matched.slice(0, (spec.sourceKeywords || []).some(keyword => keyword.includes('2.1.1 Deriving CAPM')) ? 24 : 8);
  const terms = new Set(`${spec.title} ${spec.focus}`.toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,5}/g) || []);
  return chunks.map(chunk => ({ chunk, score: [...terms].reduce((sum, term) => sum + Number(`${chunk.topic} ${chunk.text}`.toLocaleLowerCase().includes(term)), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map(item => item.chunk);
}

function expandedBlocks(spec) {
  const points = spec.bullets || [];
  const typeSets = {
    architecture: ['definition', 'mechanism', 'implication'], framework: ['definition', 'mechanism', 'implication'],
    process: ['mechanism', 'evidence', 'implication'], comparison: ['contrast', 'evidence', 'implication'],
    decision: ['decision', 'contrast', 'implication'],
    recommendation: ['decision', 'mechanism', 'implication'], evidence: ['evidence', 'mechanism', 'implication'],
    timeline: ['decision', 'next_step', 'implication'],
  };
  const types = typeSets[spec.role] || ['mechanism', 'evidence', 'implication'];
  return points.slice(0, 4).map((body, index) => ({ type: types[Math.min(index, types.length - 1)], heading: (spec.blockHeadings || ['核心机制', '来源支撑', '产品影响', '下一步'])[index], body }));
}

function templateVisibleBlocks(spec, templated, slots) {
  const grouped = new Map();
  for (const slot of slots || []) {
    if (slot.role !== 'content' || ['footnote', 'group-heading', 'label'].includes(slot.purpose)) continue;
    // Tiny body slots in infographic checklists are labels, not independent
    // narrative points; keep the quality contract aligned to the four cards.
    if (slot.purpose === 'body' && slot.capacity <= 12) continue;
    const raw = templated.slotTexts[String(slot.shapeId)];
    if (raw === undefined || raw === null) continue;
    const groupId = String(slot.groupId || slot.pairedWith || slot.shapeId);
    const group = grouped.get(groupId) || { heading: '', body: [] };
    if (slot.purpose === 'point-heading') group.heading = String(raw).trim();
    else if (slot.purpose === 'list' && Array.isArray(raw)) {
      group.body.push(raw.map(item => [item?.label, item?.body].filter(Boolean).join(': ')).join('; '));
    } else {
      const value = Array.isArray(raw) ? raw.map(item => [item?.label, item?.body].filter(Boolean).join(': ')).join('; ') : String(raw);
      if (value.trim()) group.body.push(value.trim());
    }
    grouped.set(groupId, group);
  }
  const types = ['mechanism', 'evidence', 'implication', 'next_step'];
  const blocks = [...grouped.values()].filter(group => group.body.length).map((group, index) => ({
    type: types[Math.min(index, types.length - 1)], heading: group.heading || spec.section || 'Evidence', body: group.body.join(' '),
  }));
  const narrative = spec.role === 'closing' ? blocks.slice(0, 5) : blocks;
  return narrative.length ? narrative : expandedBlocks(spec);
}

function visualUnits(value) { return [...String(value || '')].reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 1 : .55), 0); }
function fitTemplateText(value, limit, minimum = 0) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw || !Number.isFinite(limit)) return raw;
  if (visualUnits(raw) <= limit && visualUnits(raw) >= minimum) return raw;
  const sentences = raw.match(/[^。！？.!?]+[。！？.!?]?/gu) || [];
  const complete = sentences.map(part => part.trim()).find(part =>
    visualUnits(part) <= limit && visualUnits(part) >= minimum);
  if (complete) return complete;
  // The simulated writer may shorten a clause, but must never cut a word or
  // Chinese character in the middle of a sentence just to satisfy the frame.
  const clauses = raw.split(/[，,；;]/u).map(part => part.trim()).filter(Boolean);
  const clause = clauses.find(part => visualUnits(`${part}。`) <= limit && visualUnits(part) >= minimum);
  if (clause) return /[。！？.!?]$/u.test(clause) ? clause : `${clause}。`;
  return '';
}
const pageSections = {
  1: 'QUANT FINANCE', 2: 'FACTORS', 3: 'ANOMALY', 4: 'CAPM', 5: 'CAPM', 6: 'MODELS',
  7: 'FF3', 8: 'MOMENTUM', 9: 'FF5', 10: 'Q MODELS', 11: 'SY MODEL', 12: 'TESTS',
  13: 'PREMIA', 14: 'ZOO', 15: 'SCORE', 16: 'FAMILIES', 17: 'PORTFOLIO', 18: 'TIMING',
  19: 'A-SHR', 20: 'SORT', 21: 'STRAT',
};
// Each page uses the native editable slots from its actual template variant.
// The copy is written against the slot's measured capacity, not inferred from
// the previous page or from a generic three-card layout.
const pageSlotCopy = {
  1: { 6: 'A research map for asset-pricing models, anomalies and investable tests.' },
  2: { 5: 'Trait → sort → return', 7: 'TRAIT', 8: 'HML', 9: 'SIGNAL', 10: 'ALPHA',
    11: 'From firm attribute to model residual', 12: 'FACTOR',
    13: 'A characteristic is an observable trait. Sorting creates factor returns such as HML; a signal ranks stocks. Alpha is the regression intercept left after the chosen model, which also determines whether a return pattern is anomalous.',
    14: 'Models can absorb yesterday’s anomaly; what survives depends on the benchmark.' },
  3: { 5: 'An anomaly is benchmark-dependent: specify the model before calling a return pattern unexplained. Tests against broader model sets ask whether the premium survives controls.',
    7: 'Characteristic', 8: 'An observable firm trait, such as book-to-market.',
    10: 'Factor return', 11: 'A return series formed by sorting stocks on a characteristic, such as HML.',
    13: 'Signal', 14: 'A cross-sectional score ranks stocks for portfolio construction.',
    16: 'Unexplained', 17: 'A pattern the selected benchmark model fails to explain.',
    19: 'Alpha', 20: 'The regression intercept left unexplained by chosen factors.',
    22: 'Model-relative', 23: 'Expanded benchmarks can absorb yesterday’s anomaly exposures.' },
  4: { 8: 'Pricing rule', 9: 'CAPM makes expected excess return proportional to market beta times the market risk premium; its Security Market Line is linear under the model assumptions.',
    12: 'Beta', 13: 'Beta is covariance with the market divided by market-return variance; only systematic risk is priced. Two-fund separation gives all investors the same risky mix; market clearing makes it the market portfolio.',
    16: 'Equilibrium', 17: 'w_mkt ∝ Σ⁻¹(μ − r_f1); μ − r_f1 ∝ Σw_mkt.' },
  5: { 3: 'Flat SML', 6: 'LOW BETA', 8: 'SIZE / VALUE',
    9: 'The empirical SML was flatter than CAPM predicts; BAB formalizes the low-beta pattern. Size and value returns exceeded beta-only predictions. These failures did not kill factor-based asset pricing; research shifted to multifactor models.',
    14: 'ROLL (1977)', 15: 'The true market spans unobservable bonds, real estate and human capital; equity-only CAPM tests are limited. This shifted research toward multifactor models.' },
  6: { 5: 'Models broaden the benchmark from market risk to characteristic-based returns, investment, profitability and mispricing. Each extension absorbs patterns, but fit depends on factor construction, assumptions and model selection.',
    7: 'CAPM', 8: 'CAPM links expected excess returns to market beta under a mean-variance efficient market portfolio and homogeneous expectations.',
    10: 'APT', 11: 'APT assumes a linear factor structure and no-arbitrage, without specifying the factors’ economic identities.',
    13: 'FF3', 14: 'Adds size (SMB) and value (HML) to market beta after CAPM leaves those return patterns unexplained.',
    16: 'Carhart', 17: 'Adds a winner-minus-loser momentum return because momentum-sorted portfolios retain alpha against FF3.',
    19: 'FF5 / q', 20: 'FF5 adds profitability and investment; q uses investment-to-assets and return on equity.',
    22: 'SY / q5', 23: 'Mispricing clusters and expected growth broaden fit; selection still matters.' },
  7: { 5: 'Annual 2×3', 7: 'MKT', 8: 'SMB', 9: 'HML', 10: '2×3',
    11: 'Three spreads; six portfolios', 12: 'SORT',
    13: 'Each June, split size at the NYSE median and book-to-market at the 30th/70th percentiles. The independent sorts form six value-weighted portfolios; SMB contrasts small with big, while HML contrasts high with low book-to-market.',
    14: 'Independent sorts separate size and value exposures.' },
  8: { 6: 'Monthly rebalanced, value-weighted UMD adds winners-minus-losers to FF3; fund attribution links apparent manager skill to momentum. Rank t−12 to t−2 returns, skip the latest month, and form within-size 2×3 long-short 30%/decile spreads. Rebounds can crash momentum. r_i-r_f = α_i+β_iMKT+s_iSMB+h_iHML+m_iUMD+ε_i.',
    7: 'UMD', 8: 'LONG WINNER LEG', 9: 'Top minus bottom 30% or decile; within-size 2×3.',
    10: 'RANK', 11: 't−12/t−2', 12: 'Skip the most recent month.',
    13: 'RISK', 14: 'MOMENTUM CRASHES', 15: 'Rebounds can cause crashes.',
    16: 'ATTR', 17: 'Fund attribution', 18: 'Skill reduces to passive tilt' },
  9: { 5: 'RMW + CMA', 10: 'RMW', 11: 'Robust-minus-weak profitability adds operating profitability to the market, size and value factors; it captures differences in firms’ operating strength.',
    15: 'CMA', 16: 'Conservative-minus-aggressive investment adds an investment dimension, motivated by dividend-discount logic and firms’ investment behavior.',
    20: 'HML', 21: 'HML can be partly redundant in some samples; its marginal role depends on the test assets and remains debated.',
    23: 'Dividend-discount rationale; sample-dependent HML', 24: 'FF5 adds profitability (RMW) and investment (CMA). Broader fit is not a universal verdict; HML may be partly redundant in some samples.' },
  10: { 3: 'Production', 6: 'I/A + ROE', 8: 'q5 + EG',
    9: 'The q model uses market, investment-to-assets (I/A) and return on equity (ROE), linking expected returns to investment and profitability. q5 adds expected growth (EG); independent size, investment and profitability sorts form 27 portfolios.',
    14: 'Trade-off', 15: 'Greater structure still leaves results dependent on sample and construction choices.' },
  11: { 8: 'MGMT', 9: 'MGMT clusters investment and accrual anomalies into a composite mispricing factor; its design summarizes related characteristics rather than treating each signal as independent.',
    12: 'PERF', 13: 'PERF groups profitability and momentum patterns. Together, MGMT and PERF summarize 11 known anomaly characteristics in the Stambaugh–Yuan framework.',
    16: 'Post-hoc caveat', 17: 'Its horse-race advantage needs caution because construction is post hoc.' },
  12: { 5: 'Different tests answer different pricing questions; the test assets and covariance estimates shape the verdict. Regression fit alone does not settle the economic explanation.',
    7: 'Time series', 8: 'Regress portfolio returns on factor returns; inspect the intercept.',
    10: 'Cross section', 11: 'Ask whether betas or traits explain average-return differences.',
    13: 'GRS', 14: 'Jointly test whether test-portfolio alphas equal zero.',
    16: 'Test assets', 17: 'Changing the portfolios can change the model comparison.',
    19: 'Covariance', 20: 'GRS depends on estimated residual covariance across portfolios.',
    22: 'Inference', 23: 'No single regression settles the economic explanation.' },
  13: { 6: 'Risk compensation, behavioral mispricing and limits to arbitrage compete; a factor may mix them. Risk pays for bad-state exposure. Behavioral errors include overreaction, underreaction and extrapolation. Trading frictions delay correction, while value, momentum, low-volatility and size each have failure stories.',
    7: 'RISK', 8: 'BAD-STATE LOSSES', 9: 'Pays for losses in adverse states.',
    10: 'BEHV', 11: 'Behavior', 12: 'Overreaction, underreaction and extrapolation move prices.',
    13: 'FRIC', 14: 'SHORTING LIMITS', 15: 'Shorting limits slow correction.',
    16: 'MIX', 17: 'Stories overlap', 18: 'Competing stories can overlap' },
  14: { 5: 'Trials raise false-discovery risk',
    10: 'ALIASES', 11: 'Several labels may reflect one latent exposure rather than distinct sources of return; correlated definitions can repackage a signal.',
    15: 'ABSORBED', 16: 'A broader benchmark can explain an anomaly that appeared under CAPM or FF3, changing the residual claim.',
    20: 'SELECTION', 21: 'Many trials make a t-stat above 2 weak evidence; require a rationale, point-in-time data, robustness and independent confirmation.',
    23: 'Net costs can erase a premium', 24: 'Trading costs may erase the premium. Test incremental value against known factors, model realistic implementation and record the full search process.' },
  15: { 5: 'No factor story is a verdict; each one needs a failure test.', 7: 'VALUE', 8: 'MOMENTUM', 9: 'QUALITY', 10: 'LOW RISK',
    11: 'Risk, mispricing and mining', 12: 'TEST',
    13: 'Value mixes distress/duration risk and extrapolation; metric choice creates a mining risk. Momentum carries crash exposure, underreaction stories and parameter-search risk. Quality and investment pair cash-flow or q-theory stories with definition choices.',
    14: 'Low volatility, size and liquidity face leverage, funding, sector and trading-friction confounds.' },
  16: { 5: 'Each factor family needs controls suited to its signal, data source and likely confounds. Families can overlap, but their measurement risks differ.',
    7: 'Value', 8: 'B/P, E/P and EBIT/EV; control industry, profitability and leverage.',
    10: 'Momentum', 11: '12–1, residual and earnings signals; test reversal and crash exposure.',
    13: 'Quality', 14: 'GP/A, ROE and accruals; control sector, leverage and size.',
    16: 'Investment', 17: 'Asset growth, capex growth and net issuance; check profitability.',
    19: 'Risk / liq.', 20: 'Beta, volatility and spreads/turnover; control sector, leverage, size and price.',
    22: 'Sentiment / alt.', 23: 'Revisions, short interest, news and web data require coverage and timestamp controls.' },
  17: { 8: 'Long-short', 9: 'Decile or rank-weighted dollar-neutral portfolios test the premium; a long-only benchmark tilt tests constrained stock selection.',
    12: 'Optimizer', 13: 'Residualized signals fit constrained optimizers; factor-mimicking portfolios serve risk models. Report weighting, rebalancing frequency, breakpoint universe, sector and beta neutrality, leverage, and cost assumptions.',
    16: 'Report design', 17: '必须报告构建选择：加权方式、调仓频率、断点股票池、行业中性、贝塔中性、杠杆和成本假设。' },
  18: { 3: 'Timing', 6: 'Spreads', 8: 'Crowding',
    9: 'Valuation spreads, recent factor returns, macro regimes and volatility may inform timing, but they add another layer of multiple testing. Crowded factors can persist until liquidity disappears, then unwind sharply.',
    14: 'Monitor', 15: 'Track flows, common holdings, short interest, borrow, turnover and manager correlation.' },
  19: { 5: 'Market transfer', 7: 'MOM', 8: 'SIZE', 9: 'QUALITY', 10: 'STRUCT.',
    11: 'Re-test, do not transplant', 12: 'CHECK',
    13: 'US momentum is canonical; A-share momentum is more horizon- and limit-event-dependent. Quality screens must watch subsidies, related parties and earnings management. 美股动量是经典稳健因子，而 A 股动量更依赖期限和涨跌停事件；A 股规模因子受壳价值和量化拥挤塑造；A 股质量筛选必须更关注补贴、关联方活动和盈余管理动机。',
    14: 'Shell value and quant crowding have shaped A-share size behavior.' },
  20: { 5: 'Independent sorts', 10: 'SIZE', 11: 'Split the universe into small and big by market capitalization; independently sort the chosen characteristic into low, middle and high buckets.',
    15: 'INTERSECT', 16: 'Cross the two rankings to form six portfolios; compare high with low within each size group.',
    20: 'HML', 21: 'HML averages the high-characteristic portfolios and subtracts the low-characteristic average across size buckets.',
    23: 'HML = ½(SmallHigh + BigHigh) − ½(SmallLow + BigLow). Higher characteristic returns minus lower, averaged across size.',
    24: 'Independent sorting keeps the characteristic spread from merely proxying for firm size; the same template applies to profitability or investment.' },
  21: { 6: 'A factor is not yet a strategy: define the universe, forecast, portfolio, execution, risk limits, capacity, monitoring and governance. Test rationale and incremental value, include costs, red-team the result, paper-trade, then consider a small live allocation.',
    7: 'PLAN', 8: 'INVESTABLE UNIV', 9: 'Define investable names and forecasts.',
    10: 'TEST', 11: 'Robust', 12: 'Check incrementality, costs and capacity.',
    13: 'RISK', 14: 'SET RISK LIMITS', 15: 'Set limits and monitor drawdowns.',
    16: 'LIVE', 17: 'PAPER-TRADE FIRST', 18: 'before live allocation' },
  22: { 8: 'TIMESTAMP', 9: 'Evidence & rationale',
    10: [ { label: 'THEORY', body: 'A priori case' }, { label: 'DATA', body: 'Point-in-time' }, { label: 'NEUTRAL', body: 'Control exposures' }, { label: 'UNIQUE', body: 'Incremental value' } ],
    14: 'NO-LEAK', 15: 'Robustness',
    16: [ { label: 'METHOD', body: 'Conservative tests' }, { label: 'IC', body: 'Sorts agree' }, { label: 'HORIZON', body: 'Reasonable range' }, { label: 'UNIVERSE', body: 'Broader samples' } ],
    20: 'NET COST', 21: 'Tradability',
    22: [ { label: 'COSTS', body: 'Cost realism' }, { label: 'TURNOVER', body: 'Realistic rates' }, { label: 'BORROW', body: 'Available names' }, { label: 'CAPACITY', body: 'Enough liquidity' } ],
    26: 'GOVERN', 27: 'Library & warning',
    28: [ { label: 'FAILURE', body: 'False discoveries' }, { label: 'MONITOR', body: 'Track live risk' }, { label: 'OWNER', body: 'Assign review' }, { label: 'REGIME', body: 'Stay humble' } ] },
};
function templateDraft(project, page, spec) {
  const slots = project.templateFidelity?.slides?.[page - 1]?.slots || [];
  const titleSlot = slots.find(slot => slot.role === 'title');
  const sectionSlot = slots.find(slot => slot.role === 'section');
  const copy = pageSlotCopy[page] || {};
  const title = page === 1
    ? (fitTemplateText(spec.shortTitle || spec.title, titleSlot?.capacity || 24) || 'FACTORS')
    : (fitTemplateText(spec.shortTitle || spec.title, titleSlot?.capacity || 24) || fitTemplateText(spec.section, titleSlot?.capacity || 24) || '主题');
  const section = fitTemplateText(pageSections[page] || spec.section, sectionSlot?.capacity || 14) || '要点';
  const content = slots.filter(slot => slot.role === 'content' && slot.purpose !== 'footnote');
  const slotTexts = { ...copy, ...(sectionSlot ? { [String(sectionSlot.shapeId)]: section } : {}) };
  for (const slot of content) {
    if (slotTexts[String(slot.shapeId)] !== undefined) continue;
    if (slot.purpose === 'list') slotTexts[String(slot.shapeId)] = [];
    else slotTexts[String(slot.shapeId)] = '';
  }
  for (const slot of content) {
    const value = slotTexts[String(slot.shapeId)];
    if (slot.purpose === 'list') {
      if (!Array.isArray(value) || value.length !== slot.paragraphCount) throw new Error(`Simulated slide ${page} needs ${slot.paragraphCount} list items in shape ${slot.shapeId}`);
      for (const item of value) {
        if (visualUnits(item.label) > slot.lineVisualUnits || visualUnits(item.body) > slot.lineVisualUnits) throw new Error(`Simulated slide ${page} list text exceeds shape ${slot.shapeId}`);
      }
    } else if (!String(value || '').trim()) throw new Error(`Simulated slide ${page} left native text shape ${slot.shapeId} empty`);
    else if (visualUnits(value) > slot.capacity || visualUnits(value) < (slot.minVisualUnits || 0))
      throw new Error(`Simulated slide ${page} text for shape ${slot.shapeId} is outside ${slot.minVisualUnits || 0}-${slot.capacity} visual units (${Math.ceil(visualUnits(value))})`);
  }
  const outlineSlide = project.outline?.[page - 1];
  const contract = project.planning?.slidePlan?.find(item => item.slideId === outlineSlide?.id);
  const sourceAtoms = project.source?.semantic?.evidenceAtoms || [];
  const sourceChunks = new Set(outlineSlide?.chunkRefs || []);
  const modelText = (spec.bullets || []).join(' ');
  const citedNumbers = sourceAtoms.filter(atom => atom.kind === 'number' && sourceChunks.has(atom.chunkId) &&
    evidenceRelevance(atom, `${spec.title} ${spec.focus} ${modelText}`) >= .3 && !evidenceVisible(atom, modelText));
  const indexedAtoms = new Map(sourceAtoms.map(atom => [atom.id, atom]));
  const evidenceSlide = outlineSlide ? { ...outlineSlide, refs: [] } : {};
  const selectedEvidence = selectEvidenceForSlide(project.source, evidenceSlide).filter(id => !evidenceVisible(indexedAtoms.get(id), modelText));
  const contractEvidence = (contract?.requiredEvidenceIds || []).filter(id => !evidenceVisible(indexedAtoms.get(id), modelText));
  const requiredEvidenceIds = [...new Set([...contractEvidence, ...selectedEvidence,
    ...citedNumbers.slice(0, 3).map(atom => atom.id)])];
  const atoms = indexedAtoms;
  const evidenceAtoms = [...new Set(requiredEvidenceIds)].map(id => atoms.get(id)).filter(Boolean);
  const evidenceSlots = content.filter(slot => ['point-description', 'body', 'list'].includes(slot.purpose))
    .sort((a, b) => b.capacity - a.capacity);
  const usedEvidenceSlots = new Set();
  for (const atom of evidenceAtoms) {
    const fullText = String(atom.exactText || '').trim();
    const compactText = fullText;
    if (!fullText) continue;
    const evidenceTextFor = slot => visualUnits(fullText) <= slot.capacity && visualUnits(fullText) >= (slot.minVisualUnits || 0) ? fullText : compactText;
    const canPlaceEvidence = slot => {
      const evidenceText = evidenceTextFor(slot);
      const current = slotTexts[String(slot.shapeId)];
      if (Array.isArray(current)) return current.length > 0 && (() => {
        const body = [current.at(-1).body, evidenceText].filter(Boolean).join('；');
        return visualUnits(body) <= slot.capacity && visualUnits(body) >= (slot.minVisualUnits || 0);
      })();
      const combined = [String(current || '').trim(), evidenceText].filter(Boolean).join('；');
      return visualUnits(combined) <= slot.capacity && visualUnits(combined) >= (slot.minVisualUnits || 0);
    };
    const target = evidenceSlots.find(slot => !usedEvidenceSlots.has(slot.shapeId) && canPlaceEvidence(slot));
    if (!target) continue;
    usedEvidenceSlots.add(target.shapeId);
    const key = String(target.shapeId);
    const current = slotTexts[key];
    const evidenceText = evidenceTextFor(target);
    if (Array.isArray(current)) {
      const items = current.map(item => ({ ...item }));
      if (items.length) items[items.length - 1].body = [items.at(-1).body, evidenceText].filter(Boolean).join('；');
      slotTexts[key] = items;
    } else {
      const combined = [String(current || '').trim(), evidenceText].filter(Boolean).join('；');
      slotTexts[key] = combined;
    }
  }
  const uniqueEvidenceIds = [...new Set(requiredEvidenceIds)];
  return { title, section, slotTexts, requiredEvidenceIds: uniqueEvidenceIds };
}

const uid = 'simulated-user';
let calls = { outline: 0, content: 0, deckReview: 0, maxParallelContent: 0, activeContent: 0 };
const events = [];
const deps = {
  modelCall: async (project, prompt, _activity, _log, options = {}) => {
    if (prompt.includes('叙事规划器')) {
      calls.outline++;
      const chunks = project.source?.semantic?.chunks || [];
      // The outline request runs before the template fidelity map is rescheduled
      // from its original eight pages to the estimated deck. Keep this stage
      // semantic; bind slot-level copy only in each later page-writing call.
      const plannedSlides = slides.map(spec => ({ ...spec }));
      return {
        brief: profile === 'title-content-expansion' ? {
          goal: deckPrompt, audience: 'AIMate PPT 产品、设计与工程团队', objective: '把标题、内容扩展、演示写作和质量门禁改造方案转成可执行的技术演示文稿',
          thesis: '在语义分块和故事规划之后，应以逐页深度合同、标题编译和角色化写作补足页面表达，再用版式感知 QA 与局部修复保证交付质量。',
          tone: '清晰、专业、技术性', depth: 'detailed', presentationUse: 'technical_explainer',
          keyMessages: ['上游语义理解已改善，瓶颈转向下游表达', '标题与正文需要各自的质量合同', '来源深度应通过逐页检索和事实综合保真'],
          mustInclude: ['Title Compiler', 'Evidence Expansion Planner', 'Slide Content Contract', 'Presentation Writer v2', 'Content Density Controller', 'Layout-aware Copy Fitting', 'Title QA', 'Content QA', 'Local Repair'],
        } : profile === 'factor-zoo' ? {
          goal: deckPrompt, audience: 'Quantitative-finance researchers and systematic-equity practitioners', objective: 'Teach the theory, construction, evaluation and implementation of equity factors from the supplied tutorial',
          thesis: 'Treat the factor zoo as both a research library and a warning: define the pricing model, preserve construction details, test explanations and selection risk, then demand implementability.',
          tone: 'Evidence-led, instructional and cautious', depth: 'balanced', presentationUse: 'technical_explainer',
          keyMessages: ['Anomaly claims are benchmark-relative', 'Construction and tests shape what a factor means', 'Robustness, costs and failure stories determine research value'],
          mustInclude: ['CAPM and APT', 'Fama–French / Carhart / q models', 'GRS and multiple testing', 'Factor taxonomy and construction', 'Timing, crowding, market transfer', '2×3 worked example', 'Research-to-strategy workflow'],
        } : profile === 'title-depth-v4' ? {
          goal: deckPrompt, audience: 'AIMate PPT 产品与工程团队', objective: '解释标题、深度、页数和 Prompt Contract 的质量优化',
          thesis: '用户确认的页数与标题优先级是硬约束；来源深度和演示表达由分阶段契约及质量门禁共同保障。',
          tone: '分析性、技术性', depth: 'detailed',
          keyMessages: ['标题与章节各司其职', '来源深度不能静默压缩', '按角色规划内容分布与语义单元'],
          mustInclude: ['Title Compiler', 'Source Depth Preservation', 'User Page Count', 'Deck Title Precedence', 'Content Distribution Planner', 'QA / Repair'],
        } : profile === 'semantic' ? {
          goal: deckPrompt, audience: 'AIMate PPT 产品与工程团队', objective: '解释语义分块、故事规划与演示写作的改造方案',
          thesis: '先把长文档转换成可追溯的语义结构，再设计故事和逐页契约，最终交给确定性布局与质量门禁。',
          tone: '清晰、专业', depth: 'detailed',
          keyMessages: ['修复过碎或过大的语义块', 'Brief 与 Story Planner 管理叙事', 'Fact Synthesis 与 Writer 分开处理事实和表达'],
          mustInclude: ['Semantic Chunking', 'Small Chunk Merge', 'Oversized Chunk Split', 'Presentation Brief', 'Story Planner', 'Fact Synthesis', 'Visual Intent', 'Coverage / QA'],
        } : {
          goal: deckPrompt, audience: 'LabCodepilot 产品与工程团队', objective: '评审 Gamma-like Presentation Studio 的架构与工作流',
          thesis: '以 Presentation IR 为中心的结构化引擎可复用既有办公能力，并将模型职责限制在语义判断。',
          tone: '清晰、专业', depth: 'detailed',
          keyMessages: ['复用办公区既有基础能力', '以 Presentation IR 作为共同契约', '确定性引擎负责布局、渲染和交付'],
          mustInclude: ['安全沙箱', 'Deck Brief 与 Story Planner', 'Presentation IR', '并行 DAG', '确定性渲染与导出'],
        },
        storyArc: profile === 'title-content-expansion' ? { opening: '语义规划之后的写作瓶颈', development: '标题系统、来源扩展与角色化写作', turningPoint: '密度控制、版式拟合和分层 QA', resolution: '局部修复与分阶段落地' }
          : profile === 'factor-zoo' ? { opening: 'Define factors and the benchmark question', development: 'Trace model construction and competing explanations', turningPoint: 'Test selection, robustness and implementation risk', resolution: 'Apply the research checklist before strategy deployment' }
          : profile === 'title-depth-v4' ? { opening: '现状质量瓶颈', development: '标题、深度与用户决策契约', turningPoint: '按角色分配密度并模块化 Prompt', resolution: '质量门禁与实施顺序' }
          : profile === 'semantic' ? { opening: '问题与职责边界', development: '分块修复、溯源和故事规划', turningPoint: '事实写作与视觉表达分离', resolution: '质量门禁和实施顺序' }
          : { opening: '现有基础与模块定位', development: '结构化运行时和对象模型', turningPoint: 'IR 驱动并行任务与确定性设计引擎', resolution: '分阶段交付 Presentation Studio' },
        slides: plannedSlides.map(({ section, title, focus, role, visualIntent, bullets }, index) => {
          let related = plannedSlides[index].role === 'cover'
            ? chunks.filter(chunk => (plannedSlides[index].sourceKeywords || []).some(keyword =>
                `${chunk.sectionPath?.join(' ') || ''} ${chunk.topic || ''}`.toLowerCase().includes(keyword.toLowerCase()))).slice(0, 4)
            : relatedChunksFor(chunks, plannedSlides[index], index);
          const refs = [...new Set(related.flatMap(chunk => chunk.sourceRefs))].slice(0, 10);
          return { section, title, focus, role, question: focus, supportingPoints: bullets.slice(0, 4),
            visualIntent: { type: visualIntent || ({ comparison: 'comparison', timeline: 'pipeline' })[slides[index].layoutId] || 'none' },
            narrativeRole: slides[index].narrativeRole || (role === 'cover' ? '开场' : role === 'closing' ? '综合建议' : role === 'evidence' ? '证据与标准' : '概念与机制'),
            audienceTakeaway: bullets.at(-1) || focus,
            ...(slides[index].requiredSupport ? { requiredSupport: slides[index].requiredSupport } : {}),
            requiredDetails: bullets.slice(0, 4),
            claimIds: [`claim_${index + 1}`],
            evidenceIntent: slides[index].evidenceIntent || 'supporting',
            density: profile === 'semantic' || profile === 'title-depth-v4' || profile === 'title-content-expansion' || profile === 'factor-zoo' ? 'medium' : 'balanced',
            distributionType: slides[index].distributionType || (role === 'comparison' ? 'comparison_2x3' : role === 'process' ? 'process_6_steps' : 'three_deep_points'),
            ...(profile === 'semantic' || profile === 'title-depth-v4' || profile === 'title-content-expansion' ? { semanticUnitBudget: Math.max(3, Math.min(6, bullets.length)), pointLengthProfile: role === 'cover' ? 'compact' : 'standard' } : {}),
            chunkRefs: related.map(chunk => chunk.id), refs };
        }),
        coverage: chunks.map(chunk => ({ chunkId: chunk.id, action: profile === 'semantic' || profile === 'title-depth-v4' || profile === 'title-content-expansion'
          ? (slides.some((spec, index) => (spec.role === 'cover'
              ? (spec.sourceKeywords || []).some(keyword => `${chunk.sectionPath?.join(' ') || ''} ${chunk.topic || ''}`.toLowerCase().includes(keyword.toLowerCase()))
              : relatedChunksFor(chunks, spec, index).some(item => item.id === chunk.id))) ? 'included' : 'omitted')
          : 'included', ...(profile === 'semantic' || profile === 'title-depth-v4' || profile === 'title-content-expansion' ? { reason: `本地模拟大纲按 ${pageCount} 页预算优先覆盖与逐页主张直接相关的来源块` } : {}) })),
      };
    }
    if (prompt.includes('整稿演示文稿内容评审器')) {
      calls.deckReview++;
      return { missing: [], repeated: [], conflicts: [], unsupported: [] };
    }
    const nodePage = project.outline?.findIndex(slide => options.nodeKey?.includes(slide.id)) ?? -1;
    const promptPages = [...prompt.matchAll(/第 (\d+) 页/g)].map(match => Number(match[1]));
    const page = nodePage >= 0 ? nodePage + 1 : (promptPages.at(-1) || 0);
    const spec = slides[page - 1];
    if (!spec) throw new Error(`No simulated content for page ${page}`);
    calls.content++;
    calls.activeContent++;
    calls.maxParallelContent = Math.max(calls.maxParallelContent, calls.activeContent);
    await new Promise(resolve => setTimeout(resolve, 12));
    calls.activeContent--;
    const templated = templateDraft(project, page, spec);
    const sourceTemplateSlide = project.templateFidelity?.slides?.[page - 1];
    const contentBlocks = templateVisibleBlocks(spec, templated, sourceTemplateSlide?.slots);
    const omitTemplateShapes = sourceTemplateSlide?.sourceIndex === 4 ? [{ shapeId: 4, reason: '模板图表包含与当前因子研究无关的示例坐标和数值，输入来源没有对应数据。' }] : [];
    return { omitTemplateShapes, factSynthesis: { claims: [spec.focus], facts: spec.bullets, numbers: [], examples: [],
      relationships: spec.role === 'decision' ? spec.bullets.slice(0, 2) : [spec.bullets[0]].filter(Boolean),
      decisions: spec.role === 'decision' ? [spec.bullets[0]].filter(Boolean) : [],
      mechanisms: [spec.bullets[0]].filter(Boolean), implications: [spec.bullets.at(-1)].filter(Boolean), constraints: [], limitations: [] },
      titleCandidates: [templated.title], title: templated.title, eyebrow: templated.section, slotTexts: templated.slotTexts,
      evidenceUsedIds: templated.requiredEvidenceIds,
      contentBlocks, takeaway: spec.bullets.at(-1) || '', bullets: spec.bullets, layoutId: spec.layoutId, layout: 'text-first', blocks: spec.blocks || [] };
  },
  analyzeTemplate: async (_uid, _id, extension, bytes) => JSON.parse((await runPython(templates._internals.SCRIPT, bytes, { PPT_TEMPLATE_EXT: extension })).toString('utf8')),
  prepareTemplateFidelity: async (project, bytes, hash) => {
    const manifest = JSON.parse((await runPython(pptxImport._internals.IMPORT_SCRIPT, bytes, { PPT_EXTERNAL_DIR: externalTemplateDir })).toString('utf8'));
    const imported = pptxImport.projectFromImportedManifest({ id: project.id, uid: project.uid, title: project.title }, manifest, hash);
    return templateFidelity.fidelityFromImported(project, imported, hash);
  },
  renderPptx: async project => {
    if (project.templateFidelity?.mode === 'preserve') {
      const nativeProject = { ...project, externalPptx: { originalPath: project.templateFidelity.originalPath },
        templateSlideMap: project.templateFidelity.slideMap,
        deck: { ...project.deck, slides: project.deck.slides.map(slide => ({ ...slide, nativeSlideIndex: slide.templateSlideIndex })) } };
      const slides = nativeProject.deck.slides.filter(slide => Number.isInteger(slide.nativeSlideIndex)).map(slide => ({
        nativeSlideIndex: slide.nativeSlideIndex,
        omitShapeIds: (slide.templateOmissions || []).map(item => item.shapeId),
        nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole,
          nativeShapeId: node.nativeRef.shapeId,
          content: node.type === 'image' && !node.content?.mediaReplacement
            ? Object.fromEntries(Object.entries(node.content || {}).filter(([key]) => key !== 'dataUrl')) : node.content,
          geometry: node.geometry, style: node.style })),
      }));
      const result = JSON.parse((await runPython(pptxImport._internals.EXPORT_SCRIPT,
        Buffer.from(JSON.stringify({ original: nativeProject.externalPptx.originalPath, slides,
          sourceSlideMap: nativeProject.templateSlideMap, fonts: nativeProject.templateSpec?.fonts })), { PPT_OUTPUT: outputPath })).toString('utf8'));
      if (!fs.existsSync(outputPath) || !result.bytes) throw new Error('Native template renderer did not produce PPTX');
      return result;
    }
    const payload = {
      slides: project.deck.slides,
      renderTree: project.renderTree,
      template: project.template,
      palette: project.templateSpec?.palette,
      fonts: project.templateSpec?.fonts,
    };
    const result = JSON.parse((await runPython(renderer._internals.SCRIPT, Buffer.from(JSON.stringify(payload)), { PPT_OUTPUT: outputPath })).toString('utf8'));
    if (!fs.existsSync(outputPath) || !result.bytes) throw new Error('Renderer did not produce PPTX');
    return result;
  },
  renderPdf: async () => ({ bytes: 0 }),
  extractFile: async () => { throw new Error('Not used by the paste input run'); },
  readFile: async () => ({ stream: Readable.from(fs.readFileSync(outputPath)), size: fs.statSync(outputPath).size }),
  removeContainer: async () => {},
};

async function request(method, pathname, data) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let response;
  await handlePpt(req, new URL(`http://local${pathname}`), {
    uid, deps,
    activity: event => events.push(event),
    log: () => {},
    send: (status, body) => { response = { status, body }; return true; },
    res: { writeHead() {}, on() {} },
  });
  return response;
}
async function waitFor(id, wanted) {
  for (let i = 0; i < 600; i++) {
    const project = store.get(uid, id);
    if (project?.status === wanted) return project;
    if (project?.status === 'failed' || project?.status === 'quality_blocked') {
      if (process.env.PPT_DEBUG_FAILURE) fs.writeFileSync(process.env.PPT_DEBUG_FAILURE, JSON.stringify({
        slides: project.deck?.slides?.map((slide, index) => ({ page: index + 1, title: slide.title,
          blocks: slide.copy?.blocks, slots: slide.templateSlotTexts })), issues: project.quality?.deterministic?.issues }, null, 2));
      const evidenceIssues = (project.quality?.deterministic?.issues || []).filter(issue => /evidence_page|required_evidence_missing|来源事实/.test(`${issue.code} ${issue.message}`));
      const evidencePages = evidenceIssues.map(issue => ({ ...issue, slide: project.deck?.slides?.findIndex(slide => slide.id === issue.slideId) + 1,
        title: project.deck?.slides?.find(slide => slide.id === issue.slideId)?.title,
        contract: project.planning?.slidePlan?.find(item => item.slideId === issue.slideId),
        slideState: (() => { const slide = project.deck?.slides?.find(item => item.id === issue.slideId); return slide && { sourceRefs: slide.sourceRefs, sourceChunks: slide.sourceChunks,
          templateSlotTexts: slide.templateSlotTexts, nativeText: (slide.nodes || []).filter(node => node.nativeRef && node.type === 'text').map(node => node.content?.text) }; })() }));
      const templateIssues = (project.quality?.deterministic?.issues || []).filter(issue => issue.code?.startsWith('template_')).map(issue => {
        const slide = project.deck?.slides?.find(item => item.id === issue.slideId);
        const page = project.deck?.slides?.findIndex(item => item.id === issue.slideId) ?? -1;
        return { code: issue.code, page: page + 1, title: slide?.title, message: issue.message };
      });
      throw new Error(`${project.stage}: ${project.error}${evidencePages.length ? `; evidence=${JSON.stringify(evidencePages)}` : ''}${templateIssues.length ? `; template=${JSON.stringify(templateIssues)}` : ''}`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Project ${id} did not reach ${wanted}`);
}

try {
  const uploaded = await request('POST', '/ppt/templates', {
    fileName: path.basename(templatePath),
    name: templateName,
    fileBase64: templateBytes.toString('base64'),
  });
  if (uploaded.status !== 201 || uploaded.body.template.compatibility !== 'mapped') {
    throw new Error(`Template cannot be mapped: ${JSON.stringify(uploaded.body)}`);
  }
  const template = uploaded.body.template;
  const create = await request('POST', '/ppt/projects', {
    // The full source is supplied through the module's high-capacity Paste source.
    // The prompt field retains the user's requested intent while avoiding the 12k prompt limit.
    inputKind: 'paste',
    text: sourceText,
    prompt: deckPrompt,
    template: template.id,
    generationPolicy: { version: 1, detail: 'balanced', language: { mode: 'source' }, knowledge: 'source_only' },
    configId: 'simulated-structured-llm',
    model: 'simulated-structured-llm',
  });
  if (create.status !== 201) throw new Error(`Project creation failed: ${JSON.stringify(create)}`);
  const id = create.body.project.id;
  const persistedCreatedProject = store.get(uid, id);
  if (persistedCreatedProject?.templateFidelity?.mode !== 'preserve') {
    const selectedTemplate = templates.templateFor(uid, template.id, store);
    throw new Error(`Uploaded PPTX native fidelity was not initialized: ${JSON.stringify({ kind: selectedTemplate.kind, extension: selectedTemplate.extension, projectMode: persistedCreatedProject?.templateFidelity?.mode || null })}`);
  }
  if (create.body.project.pages !== pageCount || create.body.project.pageDecision?.source !== 'estimate') {
    throw new Error(`Module page estimate mismatch: expected ${pageCount}, received ${JSON.stringify(create.body.project.pageDecision)}`);
  }
  await waitFor(id, 'outline_ready');
  const outlineProject = store.get(uid, id);
  if (process.env.PPT_DEBUG_SLOTS) fs.writeFileSync(process.env.PPT_DEBUG_SLOTS,
    JSON.stringify(outlineProject.templateFidelity.slides.map((slide, index) => ({ page: index + 1, sourceIndex: slide.sourceIndex + 1,
      slots: slide.slots.filter(slot => slot.role !== 'static').map(({ shapeId, role, purpose, pairedWith, groupId, capacity, minVisualUnits, paragraphCount, lineVisualUnits, maxLines }) =>
        ({ shapeId, role, purpose, pairedWith, groupId, capacity, minVisualUnits, paragraphCount, lineVisualUnits, maxLines })) })), null, 2));
  if (process.env.PPT_DEBUG_SEMANTIC) fs.writeFileSync(process.env.PPT_DEBUG_SEMANTIC, JSON.stringify({
    chunks: (outlineProject.source?.semantic?.chunks || []).map(({ id, sectionPath, topic, evidenceIds, sourceRefs, text }) => ({ id, sectionPath, topic, evidenceIds, sourceRefs, text: String(text || '').slice(0, 1000) })),
    evidenceAtoms: (outlineProject.source?.semantic?.evidenceAtoms || []).map(({ id, kind, exactText, chunkId, sourceRefs, sourceRef, location }) => ({ id, kind, exactText, chunkId, sourceRefs, sourceRef, location })),
    coverage: outlineProject.source?.semantic?.coverage || outlineProject.source?.semantic?.chapterCoverage || null,
    outline: outlineProject.outline?.map(({ id, title, section, refs, chunkRefs, sourceTopics }) => ({ id, title, section, refs, chunkRefs, sourceTopics })),
  }, null, 2));
  const generate = await request('POST', `/ppt/projects/${id}/generate`);
  if (generate.status !== 202) throw new Error(`Generation start failed: ${JSON.stringify(generate)}`);
  const project = await waitFor(id, 'completed');
  if (project.deck.slides.length !== pageCount || project.quality.status === 'blocked') throw new Error('Invalid completed deck');
  if (project.templateFidelity?.mode !== 'preserve') throw new Error('Uploaded template lost native fidelity before publish');
  const pptxInspection = JSON.parse((await runPython(PPTX_INSPECT_SCRIPT, Buffer.alloc(0), { PPT_TEMPLATE_PATH: templatePath, PPT_OUTPUT_PATH: outputPath })).toString('utf8'));
  const expectedPicturesBySlide = project.templateFidelity.slideMap.map((sourceIndex, index) => {
    const omitted = new Set((project.deck.slides[index].templateOmissions || []).map(item => Number(item.shapeId)));
    return (pptxInspection.template.pictureShapeIdsBySlide[sourceIndex] || []).filter(shapeId => !omitted.has(shapeId)).length;
  });
  const missingTemplatePictures = expectedPicturesBySlide.map((count, index) => Math.max(0,
    count - (pptxInspection.output.pictureShapeIdsBySlide[index] || []).length));
  const expectedTemplatePictures = expectedPicturesBySlide.reduce((sum, count) => sum + count, 0);
  if (pptxInspection.output.slides !== pageCount || missingTemplatePictures.some(count => count > 0) ||
      JSON.stringify(pptxInspection.template.explicitFonts) !== JSON.stringify(pptxInspection.output.explicitFonts)) {
    throw new Error(`PPTX native template check failed: ${JSON.stringify({ expectedSlides: pageCount, expectedTemplatePictures, expectedPicturesBySlide, missingTemplatePictures, inspection: pptxInspection })}`);
  }
  const run = {
    output: outputPath,
    source: { file: sourcePath, sha256: (await import('node:crypto')).createHash('sha256').update(sourceText).digest('hex'), characters: sourceText.length, normalizedCharacters: normalizedSource.text.length, segments: normalizedSource.segments.length, semanticChunks: normalizedSource.semantic.chunks.length, evidenceAtoms: normalizedSource.semantic.evidenceAtoms.length, truncated: normalizedSource.truncated, inputKind: 'paste' },
    template: { file: '/Users/dongli/Downloads/Copy-of-Process-Improvement-Proposal.pptx', transportCopy: templatePath,
      transportOptimization: 'Resampled four oversized embedded PNG photos to 1200px maximum dimension to fit the module upload limit while retaining presentation-scale clarity; slide dimensions, artwork placement, fonts, colors and editable shapes are unchanged.',
      id: template.id, compatibility: template.compatibility, pages: template.pages, palette: template.palette, fonts: template.fonts },
    simulatedLlm: { id: 'simulated-structured-llm', behavior: `deterministic, source-grounded JSON responses for Brief/Story/Outline, ${pageCount} content nodes, and one whole-deck review`, profile },
    pageDecision: { source: project.pageDecision?.source || 'unknown', finalPageCount: project.pages, recommendedPageCount: pageRecommendation.recommended, range: pageRecommendation.range, depthPolicy: pageRecommendation.depthPolicy },
    title: { text: project.deckTitle?.text || project.deck?.slides?.[0]?.title || '', source: project.deckTitle?.source || 'unknown', locked: project.deckTitle?.locked === true },
    execution: { orchestration: 'ppt-api handlePpt', templateAnalysis: 'ppt-template SCRIPT via host Python', pptxRendering: 'pptx/import-pptx EXPORT_SCRIPT via host Python', coworkSandbox: false, reason: 'local Docker has no Cowork image; module scripts run locally with a deterministic simulated LLM' },
    workflow: { projectId: id, status: project.status, stage: project.stage, slideCount: project.deck.slides.length,
      layoutIds: project.deck.slides.map(s => s.layoutId), templateSlideMap: project.templateFidelity?.slideMap || [],
      templateFidelity: { mode: project.templateFidelity.mode, sourceSlides: project.templateFidelity.originalSlideCount,
        templateImageShapes: expectedTemplatePictures, outputPptx: pptxInspection.output },
      templateReusePlan: project.templateFidelity?.reusePlan || null,
      slides: project.deck.slides.map((slide, index) => ({ page: index + 1, id: slide.id, title: slide.title,
        bullets: slide.bullets, blocks: (slide.copy?.blocks || []).map(block => ({ type: block.type, heading: block.heading, body: block.body })),
        sourceRefs: slide.sourceRefs, sourceChunks: slide.sourceChunks })),
      dagNodes: Object.fromEntries(Object.entries(project.dagNodes).map(([key, node]) => [key, node.status])),
      quality: project.quality, modelCalls: calls, events: events.length, exportBytes: project.exportBytes },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(reportPath, JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run, null, 2));
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}
