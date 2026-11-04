import assert from 'node:assert/strict';
import {inspectContent} from './lib/ppt-content-qa.mjs';
const source='Geometry: full table from the original source. max(alpha + beta, gamma)';
const check=text=>inspectContent({source:{text:source},deck:{slides:[{id:'s',title:text,nodes:[{id:'t',type:'text',content:{text}}]}]}}).issues.filter(issue=>issue.code==='visible_formula_unverified');
for(const locator of ['Geometry (Rows 1-3)','Architecture (Pages 2–4)','Source Code (Lines 12—20)'])assert.equal(check(locator).length,0,locator);
assert.equal(check('max(alpha + beta, gamma)').length,0);
for(const changed of ['max(alpha - beta, gamma)','max (alpha - beta, gamma)','Geometry(Rows1-3 + offset)','Geometry (Rows + 1 - 3)'])assert.ok(check(changed).length>0,changed);
console.log('Editorial range locators do not bypass arithmetic source verification: OK');
assert.equal(check('Embargo must cover the longest lookback (63-day volatility: at least 63 days).').length,0,'prose units and a colon are not arithmetic');
assert.ok(check('adjusted_return (price-cost: net_return)').length,'spaced arithmetic subtraction remains checked');
assert.equal(check('Searching formulas creates a multiple-comparisons problem (look-elsewhere effect)').length,0,'a spaced aside of hyphenated words is prose');
assert.ok(check('adjusted_return (price-cost)').length,'a one-term aside stays checked');
assert.equal(check('About 3,700 trading days (15 years daily A-share) of history').length,0,'an aside of words and whole numbers is prose');
assert.equal(check('Rigorous corrections (deflated Sharpe ratio, PBO, White\'s Reality Check / SPA test) separate real alphas').length,0,'a named list in an aside is prose');
assert.equal(check('About 3,700 trading days (15 years A-share) of history').length,0,'numbers and hyphenated words count as words');
for(const formula of ['max (alpha - beta, gamma)','adjusted_return (price-cost: net_return)','ts_mean (close - 5) / volume'])assert.ok(check(formula).length,'single terms with operators stay checked: '+formula);
assert.ok(check('rank (close-open)').length&&check('ts_mean (close - 5)').length,'a single term or a spaced operator stays checked');
assert.ok(check('adjusted_return (63-day + cost: net_return)').length,'a duration next to actual arithmetic cannot waive source verification');
assert.equal(check('PERF cluster: profitability/momentum anomalies (distress, O-score, momentum, etc.)').length,0,'a list of single words in an aside is prose (live fz-r6)');
for(const formula of ['max (alpha, beta-gamma)','spread (x, y-z)','f (open, close-high)'])assert.ok(check(formula).length,'a list with one ordinary word or short symbols stays checked: '+formula);
// A formula in a spaced aside after a prose word is verified by its body
// (live mlq-r9 page 13): the word is not a function name.
{const barrier='- **Upper barrier** — a profit-take level, e.g. $+2\\sigma_i$ (a multiple of volatility).\n- **Vertical barrier** — a maximum holding period $t+h_{\\max}$ that forces a label.';
 const checkIn=text=>inspectContent({source:{text:barrier},deck:{slides:[{id:'s',title:'Triple barrier',nodes:[{id:'t',type:'text',content:{text}}]}]}}).issues.filter(issue=>issue.code==='visible_formula_unverified');
 assert.equal(checkIn('Vertical barrier (t+hmax) forces a label if neither horizontal barrier is touched first.').length,0,'the aside is the source formula');
 assert.equal(checkIn('Upper barrier (e.g. +2σi) scales to volatility.').length,0,'an "e.g." aside is the source formula');
 assert.ok(checkIn('Vertical barrier (t+hmin) forces a label.').length,'a changed formula in an aside stays flagged');
 assert.ok(checkIn('Upper barrier (e.g. +3σi) scales to volatility.').length,'a changed factor stays flagged');}
assert.equal(check('Summary (2 / 5)').length,0,'a row page counter is navigation');assert.ok(check('ratio (2 / 5 + x)').length,'arithmetic in a spaced aside stays checked');
assert.equal(check('Candidates are ranked by fitness (IC/ICIR); stories come after').length,0,'acronym alternatives are prose');
// Numbers compared in an aside are no formula; the number check verifies each
// value (Fable 2026-10-26, live mlq-i2 p14 blocked on "+80% vs +15%").
{const {inspectSourceNumbers}=await import('./lib/ppt-source-numbers.mjs');
 const robust='Rank-transforming the label is a cheap form of outlier robustness: a +80% earnings-driven outlier and a +15% quarter become adjacent ranks. Pool variance is $\\sigma^2[\\rho+(1-\\rho)/N]$.';
 const formula=text=>inspectContent({source:{text:robust},deck:{slides:[{id:'s',title:'Labels',nodes:[{id:'t',type:'text',content:{text}}]}]}}).issues.filter(issue=>issue.code==='visible_formula_unverified');
 const numbers=text=>inspectSourceNumbers({source:{text:robust},generationPolicy:{knowledge:'source_only'},deck:{slides:[{id:'s',title:'Labels',nodes:[{id:'t',type:'text',content:{text}}]}]}}).filter(issue=>issue.severity==='error');
 const same='Rank-transforming is cheap outlier robustness (e.g., +80% vs +15%).',changed='Rank-transforming is cheap outlier robustness (e.g., +80% vs +16%).';
 assert.equal(formula(same).length+numbers(same).length,0,'a comparison of source numbers passes');
 assert.equal(formula(changed).length,0,'a comparison is not checked as a formula');
 assert.ok(numbers(changed).some(issue=>/\+16%/u.test(issue.message)),'its unsupported number blocks');
 for(const word of ['to','and','对','与'])assert.equal(formula(`Labels (e.g., +80% ${word} +15%) rank`).length,0,'comparison word '+word);
 assert.ok(formula('Pool variance (σ² = v²[ρ+(1−ρ)/N]) falls').length,'a recombined formula is still a formula');
 assert.ok(formula('Labels (+80% + 15%) rank').length,'an operator between numbers is arithmetic');}
for(const formula of ['sharpe_ratio (ret/vol)','fitness_score (IC/vol)','fitness_score(IC/ICIR)'])assert.ok(check(formula).length,'a division of terms stays checked: '+formula);
assert.equal(check('Deflated corrections (PBO/DSR) separate real alphas').length,0,'acronym alternatives are prose');
for(const formula of ['information_ratio (IC/2)','fitness_score (A/B + CD)'])assert.ok(check(formula).length,'a number or another operator stays checked: '+formula);
// A spaced aside of signed values with labels is a list of numbers (3143 g1j);
// a value combined with an operator stays checked.
assert.equal(check('Up-limit buys (+10%, +20% ChiNext/STAR, +5% ST) never fill').length,0,'signed value list');
assert.ok(check('net_return (+10% - cost)').length,'arithmetic between values stays checked');
console.log('A formula in a spaced aside is verified by its body; signed value lists are numbers: OK');
// A docx equation's displayed fraction and a card's slash spelling are one formula;
// a dropped index is not (Fable Q1, 2026-11-03, live c63642ba).
{
 const docx='代价 $C_{i} = 1.5{u}_{i} − min(8, \\frac{{capacity}_{i}}{100})$ (7)';
 const checkDocx=(text,cardPage)=>inspectContent({source:{text:docx},deck:{slides:[{id:'s',title:'代价',...(cardPage?{cardPage:true}:{}),nodes:[{id:'t',type:'text',content:{text}}]}]}}).issues.filter(issue=>issue.code==='visible_formula_unverified');
 for(const text of ['min(8, capacityᵢ/100)','min(8, capacity_i/100)'])assert.equal(checkDocx(text).length,0,text);
 assert.ok(checkDocx('min(8, capacity/100)').length&&!checkDocx('min(8, capacity/100)')[0].sentBack,'a dropped index stays unverified');
 assert.equal(checkDocx('min(8, capacity/100)',true)[0].sentBack,true,'on a card page it was sent back once and is flagged');
 const {unverifiedFormulas}=await import('./lib/ppt-content-qa.mjs');
 assert.deepEqual(unverifiedFormulas(docx,'减 min(8, capacity/100)'),['min(8, capacity/100)']);
 assert.deepEqual(unverifiedFormulas(docx,'减 min(8, capacityᵢ/100)'),[]);
 console.log('Docx fractions match by spelling; a sent-back card formula is flagged on its page: OK');
}
