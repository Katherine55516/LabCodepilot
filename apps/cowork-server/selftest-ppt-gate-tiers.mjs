// Card-deck gate tiers (F8; integration plan step 4, Fable 2026-10-26, from
// report 297d4c1d and 52c7696e): integrity defects block, everything else is a
// review note; the model review never blocks, and a contradiction it confirmed
// is a highlighted note listed first. Text below 2:1 contrast blocks where the
// deck rebuilt the text, and is a note on a native or cover page.
import assert from 'node:assert/strict';
import {tierCardDeckIssues,tierCardDeckModelIssues,isBlocking} from './lib/ppt-gate-tiers.mjs';
import {REVIEW_CONTRACT_REPAIRABLE} from './lib/ppt-quality.mjs';
import {templateDesignView} from './lib/ppt-template-design.mjs';
const tier=issue=>tierCardDeckIssues([{severity:'error',...issue}])[0].severity;
// Newly blocking integrity codes (lost required media, a formula the export cannot write, old template text; 4b).
for(const code of ['media_required_missing','math_export_unsupported','template_content_leak'])assert.equal(tier({code}),'error',code);
// Option A codes and math style codes are not listed.
for(const code of ['render_invalid','card_point_overflow','template_point_coverage','math_parse_unsupported','math_source_text_fallback'])assert.ok(!isBlocking(code),code);
// Contrast: blocks on rebuilt pages, a note on native and cover pages.
assert.deepEqual(['theme','objects','native','cover',undefined].map(pageMode=>tier({code:'text_contrast_insufficient',...(pageMode?{pageMode}:{})})),['error','error','warning','warning','warning']);
// The model review: notes only; confirmed contradictions are marked and come first.
const notes=tierCardDeckModelIssues([{code:'model_repeated',severity:'error'},{code:'model_conflict',severity:'error'},{code:'model_conflict',severity:'error',confirmed:true},{code:'claim_entailment_contradicted',severity:'error'}]);
assert.ok(notes.every(issue=>issue.severity==='warning'&&issue.reviewNote),'never a gate');
assert.deepEqual(notes.map(issue=>[issue.code,Boolean(issue.confirmed)]),[['model_conflict',true],['claim_entailment_contradicted',true],['model_repeated',false],['model_conflict',false]]);
// A reviewer's satisfied obligation without evidence, or unparseable JSON, is repaired, not fatal (3143 g1f, g2g).
for(const message of ['ppt_invalid_json','satisfied obligation requires visible instance evidence','obligation evidence excerpt must occur in the current visible instance'])assert.ok(REVIEW_CONTRACT_REPAIRABLE.test(message),message);
assert.ok(!REVIEW_CONTRACT_REPAIRABLE.test('HTTP 429 upstream rate limit'),'transport errors are not contract repairs');
// An unread wide picture on the cover (a "COMPANY NAME" pill) is retired; a read
// one without text, and the same picture on a content page, stay (3143 g5b/g5c).
{const pill=(id,ocr)=>({id,type:'image',geometry:{x:6000000,y:2700000,width:1000000,height:350000},content:{dataUrl:'data:image/png;base64,AA==',imageSha256:id,mediaRole:'template_icon',...(ocr?{ocr}:{})}});
 const deck={deck:{slides:[{nodes:[{id:'t',type:'text',geometry:{x:400000,y:1800000,width:6000000,height:900000},style:{fontSizePt:44},content:{text:'Professional Portfolio'}},pill('unread'),pill('read',{status:'ok',words:0})]},
   {nodes:[{id:'c',type:'text',geometry:{x:400000,y:3000000,width:9000000,height:1500000},style:{fontSizePt:14},content:{text:'A longer body paragraph that makes this a content page with real text in it.'}},pill('content')]}]},externalPptx:{width:12192000,height:6858000}};
 const roles=Object.fromEntries(templateDesignView(deck,new Set(),new Set(),{preserveClassifiedDesign:true}).deck.slides.flatMap(slide=>slide.nodes).map(node=>[node.id,node.content.mediaRole]));
 assert.deepEqual([roles.unread,roles.read,roles.content],['old_template_content','template_icon','template_icon'],JSON.stringify(roles));}
console.log('PASS gate tiers: integrity blocks, contrast by page mode, model review as notes with confirmed contradictions first, review repairs, unread cover pills retired');
