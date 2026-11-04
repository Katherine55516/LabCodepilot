// Fixes ported from the run17 report branch after report-freeze-20261026
// (942eb90b, a4507131), classified for option D with Fable on 2026-10-26.
import assert from 'node:assert/strict';
import {parseOutlineJson,foreignTitleWords,applyOutlineMetadataRepair} from './lib/ppt-outline-protocol.mjs';
import {_internals as fidelity} from './lib/ppt-template-fidelity.mjs';
import {equationDimensions} from './lib/ppt-math.mjs';
import {measureComponent} from './lib/ppt-density-capacity.mjs';
import {wrapBareMath,writerLocalRepairScope} from './lib/ppt-writer-local-repair.mjs';
import {fitSlotText} from './lib/ppt-outline-cards.mjs';

// 1. TeX that JSON turned into control characters is restored inside $…$ only (3143 g2t page 5).
assert.equal(parseOutlineJson('{"t":"$\\bar{v}_t$ and \\b"}').t,'$\\bar{v}_t$ and \b');

// 3. The number-word rule is gone: whole titles end on one ("seq-to-one", "Map many inputs to one"),
// a capital variant letter is a label ("view A"); a word cut still never stops on "so one".
for(const title of ['LSTM, GRU and seq-to-one','Map many inputs to one','Weak alpha view A'])assert.equal(fidelity.incompletePhrase(title),false,title);
assert.equal(fidelity.incompletePhrase('Keep a history for'),true);
assert.ok(!/\bone$/u.test(fitSlotText('Practical combination shrinks weights toward equal weight penalizes turnover and correlation caps so one recent winner cannot dominate.',58)));

// 4. Bare TeX is wrapped in $…$ by code; what wrapping cannot fix goes to the model.
{const bare={sourceCommentary:[{type:'mechanism',text:'Each row x_{i,t} over all N_t stocks; $a + b_1$ stays, fixed_bps too.'}]};
 assert.equal(wrapBareMath(bare,writerLocalRepairScope(bare,new Error('writer_math_invalid'))).value.sourceCommentary[0].text,'Each row $x_{i,t}$ over all $N_t$ stocks; $a + b_1$ stays, fixed_bps too.');}

// 11. A shortened title keeps whole page words: no "arch", no invented word.
assert.deepEqual(foreignTitleWords('Data shapes and arch',{title:'Data representations that determine architecture choice'}),['shapes','arch']);
assert.deepEqual(foreignTitleWords('Data representations for architectures',{title:'Data representations that determine architecture choice'}),[]);
{const raw={version:2,slides:[{id:'c',title:'Cover'},{id:'p',title:'Data representations that determine architecture choice',keyPoints:[],sourceUnitIds:[]}]};
 const conflict={pageIndex:1,field:'title',maxLength:160,reason:'native_title_capacity'};
 assert.throws(()=>applyOutlineMetadataRepair(raw,{details:{metadataConflicts:[conflict]}},{version:2,updates:[{pageIndex:1,field:'title',text:'Data shapes and arch'}]},{project:{}}),/title_word_not_from_page/);}

// 13. Spaces, relations and \qquad count toward an equation's width (3143 g2s page 9: clipped formulas).
{const bare={mathMl:'<math><mrow><mi>a</mi><mi>b</mi></mrow></math>'},spaced={mathMl:'<math><mrow><mi>a</mi><mo>=</mo><mi>b</mi><mspace width="2em"/><mi>c</mi></mrow></math>'};
 assert.ok(equationDimensions(spaced,14).widthPt-equationDimensions(bare,14).widthPt>=(2+.56+.56+.56)*14*.95);}

// 14. "Data/problem" wraps as one word, so its column is sized for it (3143 g2v page 13).
{const table={type:'table',content:{rows:[['Data/problem','First model to try'],['Monthly tabular factors','Linear/LightGBM']]}};
 const narrow=measureComponent(table,{x:0,y:0,width:914400*2.2,height:914400*3},14);
 assert.ok(narrow.columnWeights[0]*14/.88>0);}
// 19. An addendum after the closing section that explains an earlier heading's subject is
// listed, never moved (Fable, 2026-10-26; 3143 g2x: ALSTM attention under the decision table).
{const {misplacedAddenda}=await import('./lib/ppt-outline-first.mjs');
 const items=[{id:'u1',type:'TextBlock',text:'Gates',sectionPath:['4.7 Attention-augmented LSTM (ALSTM)']},{id:'u2',type:'TableBlock',text:'ALSTM baseline',sectionPath:['12. Decision table']},{id:'u3',type:'MechanismBlock',text:'ALSTM computes an attention-weighted combination',sectionPath:['12. Decision table']}];
 const p={source:{semantic:{inventory:{items}}}},cards=[{title:'Cover',sourceUnitIds:[]},{title:'RNNs',sourceUnitIds:['u1']},{title:'Decision table',sourceUnitIds:['u2','u3']}];
 assert.deepEqual(misplacedAddenda(p,cards).map(item=>item.sourceUnitId),['u3'],'the table naming ALSTM is not flagged');}
console.log('PPT run17 port (post-freeze fixes on option D): OK');
