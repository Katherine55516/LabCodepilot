// Plan ppt-pipeline-unblocked phase 3: on an outline-first deck, findings that
// rest on the reviewer model's own judgement (missing, repeated, conflict,
// unsupported, redundant claim) are listed for review instead of blocking
// publication. Claim entailment, mandatory obligations, deterministic errors
// and an unevaluated review still block; legacy decks keep blocking.
import assert from 'node:assert/strict';
import {finalQualityReport,JUDGED_REVIEW_CODES} from './lib/ppt-quality.mjs';

const clean={hardErrors:0,issues:[],strictCoverage:true};
const review=(extra={})=>({missing:[],repeated:[],conflicts:[],unsupported:[],...extra});
const judged=review({
 missing:[{slideIds:['s2'],detail:'The validation condition is not visible.'}],
 repeated:[{slideIds:['s2','s3'],detail:'The method limits are stated twice.'}],
 conflicts:[{slideIds:['s3'],detail:'Page 2 gives limit 4 for A; page 3 gives 7 for A.'}],
 unsupported:[{slideIds:['s4'],detail:'"Approved by the board" is not in the source.'}],
 claimAudit:{checks:[{status:'redundant',slideId:'s3',nodeId:'n1',reason:'Repeats the s2 claim.'}]},
});
const codes=report=>report.modelIssues.map(item=>item.code).sort();

// Legacy: every judged finding is an error and the deck is blocked.
const legacy=finalQualityReport(clean,[],judged);
assert.deepEqual(codes(legacy),[...JUDGED_REVIEW_CODES].sort());
assert.ok(legacy.modelIssues.every(item=>item.severity==='error'&&!item.advisory));
assert.equal(legacy.status,'blocked');assert.equal(legacy.publishEligible,false);assert.equal(legacy.reviewAdvisories,0);

// Outline-first: the same findings are advisories; the deck is publishable.
const advised=finalQualityReport(clean,[],judged,{},{judgedAdvisory:true});
assert.deepEqual(codes(advised),[...JUDGED_REVIEW_CODES].sort());
assert.ok(advised.modelIssues.every(item=>item.severity==='warning'&&item.advisory&&item.requiresReview),JSON.stringify(advised.modelIssues));
assert.equal(advised.status,'passed_with_warnings');assert.equal(advised.publishEligible,true);assert.equal(advised.reviewAdvisories,5);
assert.equal(advised.modelIssues.find(item=>item.code==='model_unsupported').detail,judged.unsupported[0].detail,'the finding keeps its detail for the reader');

// Outline-first still blocks on what the advisory tier does not cover.
const entailment=finalQualityReport(clean,[],review({claimAudit:{checks:[{status:'unsupported',slideId:'s2',nodeId:'n2',reason:'The number 9 is not in the cited span.'}]}}),{},{judgedAdvisory:true});
assert.equal(entailment.status,'blocked','claim entailment against the cited span is not a judged-only finding');
assert.equal(entailment.modelIssues[0].code,'claim_entailment_unsupported');assert.equal(entailment.modelIssues[0].severity,'error');
const obligation=finalQualityReport(clean,[],review({obligationAudit:{checks:[{obligationId:'o1',status:'missing',evidence:[{slideId:'s2'}]}]}}),{},{judgedAdvisory:true});
assert.equal(obligation.status,'blocked','a mandatory source condition stays a gate');
const hard=finalQualityReport({...clean,hardErrors:1,issues:[{code:'text_overflow',severity:'error',slideId:'s2'}]},[],judged,{},{judgedAdvisory:true});
assert.equal(hard.status,'blocked','deterministic errors stay gates');assert.equal(hard.reviewAdvisories,5);
const unevaluated=finalQualityReport(clean,[],{...review(),evaluation:'not_evaluated'},{},{judgedAdvisory:true});
assert.equal(unevaluated.status,'blocked','a review that did not run is never treated as passed');

// A non-strict missing finding was already a warning; it is not relabelled.
const lenient=finalQualityReport({...clean,strictCoverage:false},[],review({missing:judged.missing}),{},{judgedAdvisory:true});
assert.equal(lenient.modelIssues[0].severity,'warning');assert.equal(lenient.modelIssues[0].advisory,undefined);assert.equal(lenient.reviewAdvisories,0);
console.log('PASS judged advisory: outline-first lists judged findings; entailment, obligations, deterministic and unevaluated reviews still block; legacy unchanged');
