/** Only unambiguous integer product + directly named resulting portfolio/bucket
 * count is checked. Never correct the immutable source or infer missing units. */
export function inspectSourceArithmetic(project){
 const segments=project.source?.segments?.length?project.source.segments:[{id:'prompt',text:project.prompt||''}],issues=[];
 const pattern=/(\d+(?:\s*(?:×|\\times)\s*\d+)+)\$?\s*(?:[^.。\n]{0,100}?)?[（(]\s*(\d+)\s*(?:portfolios?|buckets?|个组合|個組合|个分组|個分組)\s*[）)]/giu;
 for(const segment of segments)for(const match of segment.text.matchAll(pattern)){
  const numbers=match[1].split(/\s*(?:×|\\times)\s*/u).map(Number),actual=numbers.reduce((a,b)=>a*b,1),claimed=Number(match[2]);
  if(!Number.isSafeInteger(actual)||actual===claimed)continue;
  issues.push({code:'source_arithmetic_conflict',severity:'error',repairable:false,sourceRef:segment.id,message:'The original source has an inconsistent product/count; obtain an authoritative correction rather than silently changing its facts.',details:{expression:match[1],calculated:actual,claimed,excerpt:match[0],location:segment.location}});
 }
 return issues;
}
