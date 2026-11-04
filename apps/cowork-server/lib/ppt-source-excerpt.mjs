/** A fallback source point must express a complete sentence, even when it
 * then needs a measured continuation. Character budgets never cut a decimal
 * ("0.3–0.") or a dangling lead ("The reason ... in"). */
export function completeSourceSentence(value){
 const text=String(value||'').replace(/\s+/gu,' ').trim();
 let math=false;
 for(let i=0;i<text.length;i++){
  if(text[i]==='$'&&text[i-1]!=='\\'){math=!math;continue;}
  if(math)continue;
  const c=text[i];
  if(/[。！？]/u.test(c))return text.slice(0,i+1);
  if(!/[.!?]/u.test(c)||i<text.length-1&&!/\s/u.test(text[i+1]))continue;
  if(c==='.'&&(/\d/u.test(text[i-1]||'')&&/\d/u.test(text[i+1]||'')||/\b(?:e\.g|i\.e|etc|vs)\.$/iu.test(text.slice(0,i+1))))continue;
  return text.slice(0,i+1);
 }
 return text;
}
