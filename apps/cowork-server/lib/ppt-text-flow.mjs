/** A deliberately small source grammar: a standalone display consisting only
 * of literal \\text{labels} joined by right arrows. Real mathematics is never
 * rewritten by this recognizer. Original TeX remains in diagramSource. */
export function literalTextFlow(value){
 const raw=String(value||'').trim();
 const fenced=raw.startsWith('$$')&&raw.endsWith('$$')?raw.slice(2,-2):raw.startsWith('\\[')&&raw.endsWith('\\]')?raw.slice(2,-2):null;
 if(fenced===null)return null;
 let rest=fenced.trim();const labels=[];
 const spacing=()=>{rest=rest.replace(/^(?:\s|\\(?:[,;! ]|quad\b|qquad\b|enspace\b))+/u,'');};
 spacing();
 while(rest){
  const label=rest.match(/^\\text\{([^{}\\$<>\r\n]+)\}/u);
  if(!label||!label[1].trim())return null;
  labels.push(label[1].trim());rest=rest.slice(label[0].length);spacing();
  if(!rest)break;
  const arrow=rest.match(/^\\(?:to|rightarrow)\b/u);if(!arrow)return null;
  rest=rest.slice(arrow[0].length);spacing();if(!rest)return null;
 }
 if(labels.length<2||labels.length>24)return null;
 return {kind:'text-flow',relation:'ordered',text:labels.join('\n'),labels};
}
