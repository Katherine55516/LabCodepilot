/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures intentionally exercise dynamic or malformed model/API payloads. */
import {it} from 'node:test';import assert from 'node:assert/strict';
it('negative finding recheck requires live evidence and preserves all structured audit verdicts',async()=>{
 const {confirmReviewFindings}=await import(process.cwd()+'/apps/cowork-server/lib/ppt/review-findings-confirmation.mjs');
 const p:any={prompt:'External ability may be needed for reliable parameters.',generationPolicy:{content:'overview',details:'notes',knowledge:'source_only'},outline:[{id:'s',sourceUnitIds:[]}],deck:{slides:[{id:'s',title:'External ability',nodes:[{id:'n',type:'text',semanticRole:'body',content:{text:'需要更可靠参数以提高成功率时，可使用外部能力。'}}]}]}};
 const review:any={evaluation:'evaluated',missing:[{slideIds:['s'],detail:'Reliable parameter condition absent'}],repeated:[],conflicts:[],unsupported:[],obligationAudit:{checks:[{status:'satisfied'}]},claimAudit:{checks:[{status:'unsupported'}]}};
 const answer=(status:string,proof:boolean)=>async(prompt:string)=>{const packet=prompt.match(/<finding_confirmation_packet>([\s\S]*?)<\/finding_confirmation_packet>/u);assert.ok(packet);const input=JSON.parse(packet[1]);return {version:1,checks:input.findings.map((f:any)=>({findingId:f.id,status,reason:'The quoted visible text includes the condition.',visibleEvidence:proof?[input.visible[0]]:[]}))};};
 await assert.rejects(confirmReviewFindings(p,review,answer('false_positive',false)),/requires actual/);
 const retained=await confirmReviewFindings(p,review,answer('confirmed',true));assert.equal(retained.missing.length,1);
 const uncertain=await confirmReviewFindings(p,review,answer('not_evaluated',false));assert.equal(uncertain.evaluation,'not_evaluated');assert.equal(uncertain.missing.length,1);
 const corrected=await confirmReviewFindings(p,review,answer('false_positive',true));assert.equal(corrected.missing.length,0);assert.deepEqual(corrected.obligationAudit,review.obligationAudit);assert.deepEqual(corrected.claimAudit,review.claimAudit);assert.equal(review.missing.length,1);assert.ok(corrected.findingConfirmation.checks[0].visibleEvidence[0].text.includes('更可靠参数'));
});
it('finding witness wire uses one authoritative quote identity and rejects crossed or stale bindings',async()=>{
 const {confirmReviewFindings,findingConfirmationResponseSchema}=await import(process.cwd()+'/apps/cowork-server/lib/ppt/review-findings-confirmation.mjs');
 const p:any={deck:{slides:[{id:'s1',nodes:[{id:'n1',type:'text',content:{text:'The original condition is visible.'}}]},{id:'s2',nodes:[{id:'n2',type:'text',content:{text:'A distinct second witness.'}}]}]}};
 const review:any={evaluation:'evaluated',missing:[{slideIds:['s1'],detail:'Condition missing'}],repeated:[],conflicts:[],unsupported:[]};
 let calls=0;
 const result=await confirmReviewFindings(p,review,async(prompt:string)=>{
  calls++;const packet=JSON.parse(prompt.match(/<finding_confirmation_packet>([\s\S]*?)<\/finding_confirmation_packet>/u)![1]);
  const schema:any=findingConfirmationResponseSchema(prompt),witness=schema.properties.checks.items.properties.visibleEvidence.items;
  assert.deepEqual(witness.required,['quoteId']);assert.deepEqual(Object.keys(witness.properties),['quoteId']);assert.equal(witness.additionalProperties,false);
  const q=packet.visible[0];assert.ok(witness.properties.quoteId.enum.includes(q.quoteId));
  return {version:1,checks:[{findingId:packet.findings[0].id,status:'false_positive',reason:'Current quote contains the condition.',visibleEvidence:[{quoteId:q.quoteId}]}]};
 });
 assert.equal(calls,1);assert.equal(result.missing.length,0);assert.equal(result.findingConfirmation.protocolVersion,5);
 assert.equal(result.findingConfirmation.checks[0].visibleEvidence[0].slideId,'s1');assert.equal(result.findingConfirmation.checks[0].visibleEvidence[0].nodeId,'n1');
 for(const crossed of [false,true])await assert.rejects(confirmReviewFindings(p,review,async(prompt:string)=>{
  const packet=JSON.parse(prompt.match(/<finding_confirmation_packet>([\s\S]*?)<\/finding_confirmation_packet>/u)![1]);
  return {version:1,checks:[{findingId:packet.findings[0].id,status:'false_positive',reason:'Untrusted binding',visibleEvidence:[crossed?{quoteId:packet.visible[0].quoteId,slideId:'s2',nodeId:'n2'}:{quoteId:'old-quote'}]}]};
 }),/stale or is not a current visible quote/);
});
