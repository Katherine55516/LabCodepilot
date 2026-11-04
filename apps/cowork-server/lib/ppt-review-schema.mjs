/** Schema restricts identity/evidence bindings, never the semantic verdict. */
export function reviewResponseSchema(prompt){
 const identityTag='<review_scope_identity_repair>',identityAt=prompt.indexOf(identityTag);
 if(identityAt>=0){try{const identity=JSON.parse(prompt.slice(identityAt+identityTag.length,prompt.indexOf('</review_scope_identity_repair>',identityAt)));if(/^[a-f0-9]{64}$/u.test(identity.frameworkHash))return {type:'object',additionalProperties:false,required:['frameworkHash'],properties:{frameworkHash:{type:'string',const:identity.frameworkHash}}};}catch{}return;}
 const tag='\n<claim_entailment_audit>',start=prompt.indexOf(tag);if(start<0)return;
 const end=prompt.indexOf('</claim_entailment_audit>',start);if(end<0)return;
 let registry;try{registry=JSON.parse(prompt.slice(start+tag.length,end));}catch{return;}
 if(registry.version!==2||!Array.isArray(registry.entries))return;
 // Keep the provider schema flat. The live compatible gateway returned objects without identity fields
 // for nested anyOf intersections. The production normalizer still
 // requires exact claim/hash pairs, every identity once, and owned literal
 // evidence for each positive verdict; no semantic gate is changed here.
 const quotes=registry.sourceQuotes||[],claimIds=registry.entries.map(e=>e.id),hashes=[...new Set(registry.entries.map(e=>e.textHash))];
 const evidence={type:'array',items:{type:'object',additionalProperties:false,required:['sourceUnitId','quoteId'],properties:{
  sourceUnitId:{type:'string',...(quotes.length?{enum:[...new Set(quotes.map(q=>q.sourceUnitId))]}:{})},
  quoteId:{type:'string',...(quotes.length?{enum:quotes.map(q=>q.quoteId)}:{})},
 }},...(!quotes.length?{maxItems:0}:{})};
 const check={type:'object',additionalProperties:false,required:['claimId','textHash','status','reason','sourceEvidence'],properties:{
  claimId:{type:'string',...(claimIds.length?{enum:claimIds}:{})},textHash:{type:'string',...(hashes.length?{enum:hashes}:{})},
  status:{type:'string',enum:['entailed','unsupported','contradicted','redundant','not_evaluated']},reason:{type:'string',minLength:1},sourceEvidence:evidence,
 }};
 const checks=registry.entries;
 const ids=registry.slideIds||[...new Set(registry.entries.map(e=>e.slideId))];
 const finding={type:'object',additionalProperties:true,required:['slideIds','detail'],properties:{slideIds:{type:'array',minItems:1,items:{type:'string',enum:ids}},detail:{type:'string',minLength:1,maxLength:4000},code:{type:'string'},reason:{type:'string'},suggestedFix:{type:'string',maxLength:4000},bulletIndexes:{type:'array',items:{type:'integer'}}}};
 const result={type:'object',additionalProperties:true,required:['conflicts','missing','repeated','unsupported','claimAudit'],properties:Object.fromEntries([...['conflicts','missing','repeated','unsupported'].map(k=>[k,{type:'array',items:finding}]),['claimAudit',{type:'object',additionalProperties:false,required:['version','registryHash','status','checks'],properties:{version:{type:'integer',const:2},registryHash:{type:'string',const:registry.registryHash},status:{type:'string',enum:['complete','not_evaluated']},checks:{type:'array',minItems:checks.length,maxItems:checks.length,...(checks.length?{items:check}:{items:{type:'object'}})}}}]])};
 const readTag=name=>{const a=prompt.indexOf('<'+name+'>'),b=prompt.indexOf('</'+name+'>',a);try{return a>=0&&b>=0?JSON.parse(prompt.slice(a+name.length+2,b)):null;}catch{return null;}};
 const required=readTag('required_audit_checklist'),visible=readTag('visible_quote_registry');
 if(required?.requiredEntries&&visible?.quotes){
  const evidence={type:'array',items:visible.quotes.length?{type:'object',additionalProperties:false,required:['slideId','nodeId','quoteId'],properties:Object.fromEntries(['slideId','nodeId','quoteId'].map(key=>[key,{type:'string',enum:[...new Set(visible.quotes.map(q=>q[key]))]}]))}:{type:'object'},...(!visible.quotes.length?{maxItems:0}:{})};
  const count=required.requiredEntries.length;
  const check={type:'object',additionalProperties:false,required:['obligationId','status','evidence'],properties:{obligationId:{type:'string',enum:required.requiredEntries.map(e=>e.obligationId)},status:{type:'string',enum:['satisfied','missing','altered','not_evaluated']},evidence,reason:{type:'string'}}};
  result.required.push('obligationAudit','scopeAudit');
  result.properties.obligationAudit={type:'object',additionalProperties:false,required:['registryHash','status','checks'],properties:{registryHash:{type:'string',const:required.registryHash},status:{type:'string',enum:['complete','not_evaluated']},checks:{type:'array',minItems:count,maxItems:count,items:count?check:{type:'object'}}}};
  result.properties.scopeAudit={type:'object',additionalProperties:false,required:['frameworkHash','checkedSlideIds','status'],properties:{frameworkHash:{type:'string',const:visible.frameworkHash},checkedSlideIds:{type:'array',minItems:visible.slideIds.length,maxItems:visible.slideIds.length,items:{type:'string',enum:visible.slideIds}},status:{type:'string',enum:['complete','not_evaluated']}}};
 }
 return result;
}
