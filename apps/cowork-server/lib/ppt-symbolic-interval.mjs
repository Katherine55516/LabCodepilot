/** A literal interval drawing is data, not executable code. Keep its source
 * annotations and rules verbatim: positions do not invent dates or durations. */
export function symbolicIntervalRows(value, language = '') {
  if (!/^(?:|text|plaintext)$/iu.test(language)) return null;
  const text=String(value||''),lines=text.split('\n');
  if (/^\s*(?:def |class |import |from .* import |function |const |let |for .*:|return\b)/mu.test(text)) return null;
  const index=lines.findIndex(line=>/^\s*\|[-=]{2}/u.test(line)&&line.trim().endsWith('|'));
  if(index<0||!/(?:timeline|时间轴|時間軸|interval)/iu.test(lines.slice(0,index).join('\n')))return null;
  const segments=lines[index].trim().split('|').slice(1,-1).map(s=>s.replace(/^[-=\s]+|[-=\s]+$/gu,'').trim());
  if(segments.length<3||segments.length>12||segments.some(s=>!s||/[{};`]/u.test(s)))return null;
  const rest=lines.slice(index+1),boundary=rest.findIndex(line=>/^(?:purge|embargo|净化|禁运|淨化|禁運)[^:：]*[:：]/iu.test(line.trim()));
  const annotations=(boundary<0?rest:rest.slice(0,boundary)).join('\n').trim();
  if(!/\.\.|\[[^\]]+\]|t_[a-z]|τ|\btau\b/u.test(annotations))return null;
  const rules=boundary<0?'':rest.slice(boundary).join('\n').trim();
  const rows=[['Region','Source text'],...segments.map(label=>[label,'']),['Endpoint annotations',annotations],...(rules?[['Boundary rules',rules]]:[])];
  return {kind:'schema',relation:'symbolic-interval',rows,intervalCount:segments.length,
    structureBasis:'Literal source interval order; annotations/rules verbatim, no inferred duration or causal edges',
    text:rows.slice(1).map(row=>row.filter(Boolean).join(': ')).join('\n')};
}
