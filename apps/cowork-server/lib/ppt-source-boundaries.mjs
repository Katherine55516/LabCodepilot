/** Share sentence/step boundaries between source indexing and visible structures. */
export function orderedSourceSteps(text) {
  const raw=String(text||'').trim(),prefix=raw.match(/^(?:(?:the\s+)?workflow\s*(?:is\b\s*:?|(?:should|must)\s+be\b\s*:?|:)|(?:流程|步骤|步驟)(?:(?:应|應|必须|必須)?[为為是]\s*[:：]?|[:：]))\s*/iu)?.[0];
  const explicit=Boolean(prefix),value=explicit?raw.slice(prefix.length).replace(/[.。]$/u,''):raw;
  const withScope=parts=>prefix&&/\b(?:should|must)\b|应|應|必须|必須/iu.test(prefix)?[prefix+parts[0],...parts.slice(1)]:parts;
  const numbered=value.split(/\n(?=\s*\d+[.)]\s)/u).filter(Boolean);
  if(numbered.length>1)return withScope(numbered);
  // An inline model chain inside a sentence or parenthesis is not a workflow.
  if(/[()（）。!?！？\n]/u.test(value))return [raw];
  const parts=value.split(/\s*(?:->|→)\s*/u).filter(Boolean);
  if(parts.length<2||!parts.every(part=>part.length<=120&&!/[.;；]/u.test(part)))return [raw];
  // A prescription qualifies the whole flow; keep it visibly attached to its
  // first stage, never invent a tenth stage just to display "should/must".
  return withScope(parts);
}
export function sourceSentences(text) {
  // Keep decimals, abbreviations and balanced parentheses inside their sentence.
  const value=String(text||'');const result=[];let begin=0,depth=0;
  // A source sentence must remain a complete renderable span. Breaking at
  // punctuation inside **a label.** leaves dangling delimiters in separate
  // inventory objects. Keep code, math and emphasis spans intact; no original
  // character or factual text is normalized or discarded here.
  const spans=[];
  for(const pattern of [/(`+)[\s\S]*?\1/gu,/\*\*(?=\S)[\s\S]*?\S\*\*/gu,/__(?=\S)[\s\S]*?\S__/gu,/(?<!\*)\*(?!\*|\s)[^*]+?\S\*(?!\*)/gu,/\$\$[\s\S]*?\$\$|\$(?!\s)[^$\n]+?\S\$/gu,/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gu])
    for(const match of value.matchAll(pattern))spans.push([match.index,match.index+match[0].length]);
  const protectedAt=index=>spans.some(([start,end])=>index>=start&&index<end);
  for(let i=0;i<value.length;i++){
    const ch=value[i];if(protectedAt(i))continue;if('（([{'.includes(ch))depth++;else if('）)]}'.includes(ch))depth=Math.max(0,depth-1);
    const period=ch==='.'&&!/\d/u.test(value[i-1]||'')&&!/\b(?:e\.g|i\.e|Mr|Ms|Dr|Prof|vs)$/iu.test(value.slice(begin,i))&&/^\s+[A-Z\u3400-\u9fff]/u.test(value.slice(i+1));
    if(!depth&&(/[。！？!?；;\n]/u.test(ch)||period)){result.push(value.slice(begin,i+1));begin=i+1;}
  }
  if(begin<value.length)result.push(value.slice(begin));return result.filter(Boolean);
}
