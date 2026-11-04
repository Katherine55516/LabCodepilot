// User decision 2026-10-31 (D2, like Gamma): on a card deck, errors local to
// a page no longer block publication; they are flagged on their page. Facts
// the model wrote that the source does not support, and errors that name no
// page, still block. A page the rendered export flags is marked the same way.
import assert from 'node:assert/strict';
import {flagPageIssues,pageFlaggable} from './lib/ppt-gate-tiers.mjs';
import {finalQualityReport} from './lib/ppt-quality.mjs';
import {pageFlagEditRequest} from './lib/ppt/review-advisories.mjs';

const issue=(code,extra={})=>({code,severity:'error',message:code,...extra});
const deterministic={cardOutline:true,hardErrors:4,issues:[
 issue('rendered_title_capacity',{slideId:'p3',slideIds:['p3']}),
 issue('template_slot_overflow',{slideId:'p5'}),
 issue('source_number_unsupported',{slideId:'p7',numericFindings:[{raw:'2,000,000',reason:'attribution_not_supported'},{raw:'7',reason:'value_or_sign_not_in_input'}]}),
 issue('user_title_fidelity',{slideId:'p8'}),
 issue('export_integrity_failed'),
]};
assert.equal(pageFlaggable(deterministic.issues[0]),true,'a title that does not fit its page is page-local');
// A number never blocks a card deck; its page is flagged (Fable F4, 2026-11-01). Other facts still block.
assert.equal(pageFlaggable(deterministic.issues[2]),true,'an unsupported number flags its page');
assert.equal(pageFlaggable(deterministic.issues[3]),false,'another fact the model wrote still blocks');
assert.equal(pageFlaggable(deterministic.issues[4]),false,'an error that names no page is deck-level');
const flagged=flagPageIssues(deterministic);
assert.deepEqual(flagged.issues.filter(i=>i.pageFlag).map(i=>i.code),['rendered_title_capacity','template_slot_overflow','source_number_unsupported']);
assert.deepEqual(flagged.flaggedPages,['p3','p5','p7']);
assert.equal(flagged.hardErrors,2,'the title fact and the deck-level error still count');
assert.equal(flagged.issues.find(i=>i.code==='source_number_unsupported').message,'Not found in the source: 7. In the source, but not with this unit or meaning: 2,000,000. Check these numbers on this page.','the flag names each number and why');
assert.ok(flagged.issues.filter(i=>i.pageFlag).every(i=>i.severity==='warning'&&i.originalSeverity==='error'));
assert.equal(flagPageIssues({...deterministic,cardOutline:false}).hardErrors,4,'decks of the older flows keep their gates');

const review={evaluation:'evaluated',missing:[],repeated:[],conflicts:[],unsupported:[]};
const onlyPages=finalQualityReport({...deterministic,issues:deterministic.issues.slice(0,2),hardErrors:2,report:{status:'ready'}},[],review,{},{judgedAdvisory:true});
assert.equal(onlyPages.publishEligible,true,'a deck with only page-local errors publishes');
assert.equal(onlyPages.reviewAdvisories,2,'its flagged pages are counted for the editor');
const withFact=finalQualityReport({...deterministic,report:{status:'ready'}},[],review,{},{judgedAdvisory:true});
assert.equal(withFact.publishEligible,false,'an unsupported number still blocks');
// "AI fix this page": the stored flag, not the client, writes the instruction.
{const project={quality:{deterministic:{issues:[{code:'rendered_title_capacity',severity:'warning',pageFlag:true,slideId:'p3',slideIds:['p3'],message:'title too long'},{code:'image_decode',severity:'warning',pageFlag:true,slideId:'p4',message:'broken image'}]}}};
 const request=pageFlagEditRequest(project,{pageFlagCode:'rendered_title_capacity',slideId:'p3',baseRevision:7,preview:true});
 assert.equal(request.scope,'slide');assert.equal(request.slideId,'p3');assert.equal(request.baseRevision,7);assert.match(request.instruction,/Shorten this page's title/);assert.match(request.instruction,/title too long/);
 assert.throws(()=>pageFlagEditRequest(project,{pageFlagCode:'image_decode',slideId:'p4'}),/cannot be fixed by an AI edit/,'a broken image is not an AI text edit');
 assert.throws(()=>pageFlagEditRequest(project,{pageFlagCode:'rendered_title_capacity',slideId:'p4'}),/no such flagged problem/,'the flag must be on that page');}
console.log('PASS page flags: page-local errors publish flagged; facts and deck-level errors still block');
