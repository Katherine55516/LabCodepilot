// Plan ppt-pipeline-unblocked phase 4: actual model replies that once cost a
// repair round or failed a whole run (test/fixtures/ppt-vector-search-real-replies.json)
// are replayed through the production compile steps and validators against the
// real source. Every entry must pass without a repair round. When a new slip is
// fixed, add its reply here; a new deterministic gate must pass the whole corpus.
import assert from 'node:assert/strict';import fs from 'node:fs';
import {normalizePaste} from './lib/ppt-source.mjs';
import {defaultGenerationPolicy} from './lib/ppt-generation-policy.mjs';
import {normalizeReply} from './lib/ppt-reply-normalize.mjs';
import {evidenceMeasurements} from './lib/ppt-evidence.mjs';
import {finalQualityReport} from './lib/ppt-quality.mjs';
import {withClaimAuditFindings} from './lib/ppt-claim-semantics.mjs';

// The schema of the outline coverage verdict these replies answered (that review
// was removed with option D; the transport rule does not depend on it).
const coverageVerdictSchema=reviewable=>({type:'object',additionalProperties:false,required:['sufficient','missingSourceUnitIds','reason'],properties:{sufficient:{type:'boolean'},missingSourceUnitIds:{type:'array',items:{type:'string',enum:reviewable}},reason:{type:'string',minLength:1,maxLength:2000}}});
const fx=JSON.parse(fs.readFileSync(new URL('./test/fixtures/ppt-vector-search-real-replies.json',import.meta.url)));
const source=normalizePaste(fx.source),items=source.semantic.inventory.items,ids=items.map(i=>i.id),byId=new Map(items.map(i=>[i.id,i]));
const replies=slip=>fx.replies.filter(r=>r.slip===slip);
const project={generationPolicy:defaultGenerationPolicy(),source,inputUnderstanding:{readManifest:{status:'complete_delivery'},primaryLanguage:'zh',subject:'向量检索服务性能优化复盘'}};
let replayed=0;

// 1. A repeated ID in a coverage verdict (missingSourceUnitIds [b_0020, b_0020])
// failed the verdict contract twice and with it the whole outline.
for(const reply of replies('duplicate_ids')){
 const schema=coverageVerdictSchema(ids);
 assert.ok(reply.result.missingSourceUnitIds.length>new Set(reply.result.missingSourceUnitIds).size,'the corpus entry still carries its slip: '+reply.stage);
 const {value,notes}=normalizeReply(structuredClone(reply.result),schema);
 assert.deepEqual(notes.map(n=>n.code),['duplicate_ids_removed'],reply.stage);
 assert.deepEqual(value.missingSourceUnitIds,[...new Set(reply.result.missingSourceUnitIds)],'settled at the transport boundary: '+reply.stage);
 replayed++;
}

// (Semantic self-dependencies and summary-graph salvage were replayed here; both
// paths were removed with option D, and their corpus entries with them.)

// 4. The numeric check read the model's 从9.6万元 as 6万 (a number glued to a
// CJK character) and blocked publication with visible_numeric_fidelity. A
// measurement must be a whole number of its text, and every number in a real
// summary must match a source measurement with its unit.
const tokens=text=>new Set([...String(text).matchAll(/\d+(?:[.,]\d+)*/gu)].map(m=>m[0].replace(/,/gu,'')));
const wholeMeasurements=(text,where)=>{const whole=tokens(text),found=evidenceMeasurements(text);for(const m of found)for(const part of m.value.split('–'))assert.ok(whole.has(part),`measurement ${m.raw} in ${where} is a whole number of its text`);return found;};
const sourceMeasurements=items.flatMap(item=>wholeMeasurements(item.text,item.id));
let measured=sourceMeasurements.length;
for(const reply of replies('number_after_cjk')){
 const summaries=reply.result.selection.map(e=>e.summaryText).filter(text=>typeof text==='string');
 assert.ok(summaries.some(text=>/[\p{Script=Han}]\d/u.test(text)),'the corpus entry still carries its slip: '+reply.stage);
 for(const text of summaries)for(const m of wholeMeasurements(text,reply.stage)){
  assert.ok(sourceMeasurements.some(s=>s.value===m.value&&s.unit===m.unit),`visible ${m.raw} matches a source measurement (${reply.stage})`);measured++;
 }
 replayed++;
}
assert.ok(measured>=30,'the real texts exercise the numeric check: '+measured);

// 5. Verification run 3: the independent claim confirmation overturned a
// contradicted verdict (entailed: the text matches b_0009), but its mirror in
// the review's unsupported list stayed and blocked publication.
for(const reply of replies('stale_claim_mirror')){
 const review=structuredClone(reply.result);
 assert.ok(review.unsupported.some(item=>/^claim_entailment_/u.test(item.code))&&review.claimAudit.checks.every(check=>check.status==='entailed'),'the corpus entry still carries its slip');
 const rebuilt=withClaimAuditFindings(review,review.claimAudit);
 assert.ok(!rebuilt.unsupported.some(item=>/^claim_entailment_/u.test(item.code)),'an overturned verdict leaves no finding');
 for(const settled of [review,rebuilt]){
  const report=finalQualityReport({hardErrors:0,issues:[],strictCoverage:true},[],settled,{},{judgedAdvisory:true});
  assert.equal(report.publishEligible,true,JSON.stringify(report.modelIssues.map(i=>[i.code,i.severity])));
  assert.deepEqual(report.modelIssues.map(i=>[i.code,i.severity,Boolean(i.advisory)]),[['model_conflict','warning',true]],'the reviewer\'s own wording finding is listed for review');
 }
 replayed++;
}
console.log(`PASS real reply corpus: ${replayed} replies replayed through production compile and validators without a repair round; ${measured} measurements are whole numbers that match the source`);
