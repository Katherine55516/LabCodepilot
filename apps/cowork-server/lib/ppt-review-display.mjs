import {nodeContentText}from './ppt-visible-content.mjs';
/** Preserve math structure alongside exact visible quote text. Flattened 10⁶
 * can read as 106 without its superscript; the quote protocol stays unchanged. */
export function reviewMathFormatting(content={}) {
  const fields=[['text',content.richText],...(content.items||[]).map((item,i)=>['item:'+i,item.richText]),...(content.cellRich||[]).flatMap((row,r)=>row.map((cell,c)=>['cell:'+r+':'+c,cell]))];
  return fields.flatMap(([field,rich])=>(rich?.runs||[]).filter(run=>run.kind==='math').map(run=>({field,tex:run.tex,status:run.status,mathMl:run.mathMl,fallbackRuns:run.fallbackRuns})));
}
/** The quote projection stays literal; a separate typed display view prevents
 * native superscripts (10^6) from being interpreted as the integer 106.
 * Never infer math from plain digits or rewrite a source/code token. */
export function reviewDisplayText(node) {
 const content=node.content||{},plain=nodeContentText(node);
 if(content.codeBlock)return plain;
 const rich=(value,fallback)=>Array.isArray(value?.runs)&&value.runs.length?value.runs.map(run=>run.kind==='math'&&typeof run.tex==='string'?`\\(${run.tex}\\)`:String(run.text||'')).join(''):String(fallback??'');
 if(node.type==='table')return (content.rows||[]).map((row,r)=>row.map((cell,c)=>rich(content.cellRich?.[r]?.[c],cell)).join(' ')).join('\n');
 if(content.items?.length)return content.items.map(item=>rich(item.richText,item.text||item.body||'')).join('\n');
 return rich(content.richText,plain);
}

export function reviewDisplayRows(content={}){return (content.rows||[]).map((row,r)=>row.map((cell,c)=>reviewDisplayText({type:'text',content:{text:String(cell),richText:content.cellRich?.[r]?.[c]}})));}
