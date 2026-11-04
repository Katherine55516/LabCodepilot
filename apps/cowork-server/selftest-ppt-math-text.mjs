// Mathematics on cards (Fable, 2026-11-01; the user: "W_c" on World Models
// slides, raw "\lfloor" on the CodePilot docs):
// M1 a card formula is matched to the source after LaTeX spelling is normalised;
// M2 one that matches nothing shows as text with real sub/superscript runs;
// M3 mathematics written without $...$ is wrapped first;
// M4 titles never carry a formula.
import assert from 'node:assert/strict';
import {formulaKey,wrapBareMath,titleWithoutMath} from './lib/ppt-outline-cards.mjs';
import {plainMath,plainFormula,sourceRichText} from './lib/ppt-rich-text.mjs';

// M1: "W_{c}" in the PDF is "W_c" on the card; a different formula still differs.
const source=formulaKey('4. Define Controller (C) as a_{t} = W_{c} [z_{t} h_{t}] + b_{c}. P(z_{t+1} \\mid a_{t}, z_{t}, h_{t})');
for(const tex of ['W_c','b_c','a_t = W_c [z_t h_t] + b_c','P(z_{t+1} | a_t, z_t, h_t)','\\left[z_t h_t\\right]'])assert.ok(source.includes(formulaKey(tex)),tex);
assert.ok(!source.includes(formulaKey('a_t = W_c z_t')),'a formula the source does not write is not matched');
assert.ok(!source.includes(formulaKey('z_{t+2}')),'a multi-token script keeps its braces');
// A docx equation's fraction and a card's slash or Unicode subscript are one spelling (live c63642ba).
const docx=formulaKey('Ci = 1.5{u}_{i} − min(8, \\frac{{capacity}_{i}}{100})   (7)');
for(const tex of ['min(8, capacityᵢ/100)','min(8, capacity_i/100)','min(8, \\frac{capacity_i}{100})','1.5u_i'])assert.ok(docx.includes(formulaKey(tex)),tex);
assert.ok(!docx.includes(formulaKey('min(8, capacity/100)')),'a dropped index is not a spelling');
assert.equal(formulaKey('\\frac{a+b}{2}'),formulaKey('(a+b)/2'));

// M2: scripts are runs, never "_(c)"; commands are symbols.
assert.equal(plainFormula('W_c',{markup:true}),'W~c~');
assert.equal(plainFormula('f_{declared}',{markup:true}),'f~declared~');
assert.equal(plainMath('cap(P) = max(2, \\lfloor P / 5 \\rfloor)',{markup:true}),'cap(P) = max(2, ⌊ P / 5 ⌋)');
assert.equal(plainFormula('T_skill = Σ T_LLM_i',{markup:true}),'T~skill~ = Σ T~LLM~~i~','a word subscript is one run; a formula that does not typeset shows as text');
const rich=sourceRichText('solve for W~c~ in R^32^ at z~t+1~');
assert.deepEqual(rich.runs.filter(run=>run.baseline).map(run=>[run.text,run.baseline]),[['c',-25000],['32',30000],['t+1',-25000]]);
assert.equal(rich.plainText,'solve for Wc in R32 at zt+1');
assert.deepEqual(rich.diagnostics,[]);
assert.equal(sourceRichText('about ~5 min ~ 10, 2^10 and a~b').runs.length,1,'ordinary tildes and carets stay text');

// M3: bare runs are wrapped; words, identifiers and figures stay outside.
assert.equal(wrapBareMath('Use CMA-ES to solve for W_c and b_c that maximize reward.'),'Use CMA-ES to solve for $W_c$ and $b_c$ that maximize reward.');
assert.equal(wrapBareMath('原生卡片复用上限 cap(P) = max(2, \\lfloor P / 5 \\rfloor)，P 取整'),'原生卡片复用上限 $cap(P) = max(2, \\lfloor P / 5 \\rfloor)$，P 取整');
assert.equal(wrapBareMath('字号 f = max(f_{role}, f_{declared})，仅显式'),'字号 $f = max(f_{role}, f_{declared})$，仅显式');
assert.equal(wrapBareMath('encode frames into z ∈ R^{32}, 10,000 rollouts'),'encode frames into $z ∈ R^{32}$, 10,000 rollouts');
assert.equal(wrapBareMath('keep $x_1$ and node_id, true_overflow stays'),'keep $x_1$ and node_id, true_overflow stays');

// M4: a title shows symbols, not formulas.
assert.equal(titleWithoutMath('CMA-ES Solves for W_c and b_c'),'CMA-ES Solves for Wc and bc');
assert.equal(titleWithoutMath('The Model Predicts $z_{t+1}$'),'The Model Predicts zₜ₊₁');
assert.equal(titleWithoutMath('Plain Title'),'Plain Title');
console.log('PASS math text: normalised source match, script runs, wrapped bare math, formula-free titles');
