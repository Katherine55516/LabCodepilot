/** Conservative numeric provenance. Template examples are never factual authority.
 * Checks values, signs, units and local attribution; ambiguous context is a
 * review warning, not a claim that lexical overlap proves semantic truth. */
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { effectiveKnowledge } from './ppt-generation-policy.mjs';

const NUMBER = /(?<![A-Za-z0-9_.])[-−+]?(?:\d+(?:[.,]\d+)*|\.\d+)(?:[eE][-+]?\d+)?(?![A-Za-z0-9_])/gu;
const STOP = new Set('a an the is are was were be of for at to in on by with from and or as has have it its this that about approximately roughly input output step steps phase page slide million billion thousand metric amount value 指标 数值 万 亿'.split(' '));
const norm = value => {
  let raw=value.replace(/−/gu,'-').replace(/,/gu,'').replace(/^\+/u,'');
  const sign=raw.startsWith('-')?'-':'';raw=raw.replace(/^-/u,'');
  if(/[eE]/u.test(raw))return sign+raw.toLowerCase();
  const [whole='0',fraction='']=raw.split('.');const decimal=fraction.replace(/0+$/u,'');
  const result=(whole||'0').replace(/^0+(?=\d)/u,'')+(decimal?'.'+decimal:'');return result==='0'?'0':sign+result;
};
const tokens = value => new Set((String(value).toLowerCase().match(/[a-z][a-z_-]+|[\p{Script=Han}]{2,}/gu) || []).filter(word => !STOP.has(word)));
const shared = (a,b) => [...a].filter(word=>b.has(word)).length;
function unitAfter(text, end) {
  const tail=text.slice(end).trimStart();
  const match=tail.match(/^(%|percent\b|percentage points?\b|bps?\b|basis points?\b|million\b|billion\b|thousand\b|万|亿|元|美元|年|天|倍)/iu);
  const unit=match?.[0]?.toLowerCase() || '';
  return /^(percent|%)$/u.test(unit)?'%':/^(bps?|basis points?)$/u.test(unit)?'bp':unit;
}
function labelAt(text, match, role) {
  const ordinal=/^\d+$/u.test(match[0])&&Number(match[0])>0;
  if (ordinal&&['page-number','slide-number','ordinal','step-number'].includes(role)&&text.trim()===match[0]) return true;
  if (/^0\d$/u.test(match[0]) && /(?:^|\n)\s*$/u.test(text.slice(0,match.index)) && /^\s*(?:\n|$)/u.test(text.slice(match.index+match[0].length))) return true;
  const before=text.slice(0,match.index), after=text.slice(match.index+match[0].length);
  return ordinal && (/(?:^|\n)\s*(?:#{1,6}\s*)?$/u.test(before) && /^[.)、]\s/u.test(after)
    || /(?:\b(?:step|phase|page|slide)|页面|頁面|页码|頁碼)\s*$/iu.test(before) && !/^\s*(?:%|percent|million|billion)/iu.test(after)
    || /(?:第)\s*$/u.test(before) && /^\s*(?:步|页|章|阶段)/u.test(after));
}
export function numericRecords(value, role) {
  const text=String(value||''), out=[];
  for(const match of text.matchAll(NUMBER)) {
    if(labelAt(text,match,role))continue;
    // Sentence boundaries excluding decimal points; then narrow long code/table lines.
    const start=Math.max(0,text.lastIndexOf('\n',match.index)+1,text.lastIndexOf('。',match.index)+1);
    let context=text.slice(start,Math.min(text.length,match.index+match[0].length+100));
    const sentences=context.split(/(?<=[.!?])\s+(?=[A-Z])/u);
    const offset=match.index-start;let n=0;
    for(const sentence of sentences){if(offset>=n&&offset<n+sentence.length){context=sentence;break;}n+=sentence.length+1;}
    out.push({value:norm(match[0]),raw:match[0],unit:unitAfter(text,match.index+match[0].length),context,tokens:tokens(context),offset:match.index});
  }
  return out;
}
function authorities(project) {
  return [project.source?.text,project.prompt,project.deckTitle?.raw,...(project.source?.segments||[]).map(x=>x.text)].filter(Boolean);
}
function tableRecords(rows) {
  return (rows||[]).slice(1).flatMap(row=>row.flatMap((cell,column)=>numericRecords(String(cell)).map(record=>({...record,tokens:tokens(`${rows[0]?.[column]||''} ${row[0]||''} ${cell}`),context:`${rows[0]?.[column]||''} / ${row[0]||''}: ${cell}`}))));
}
function sourceRecords(project) {
  const tables=(project.source?.semantic?.inventory?.items||[]).filter(x=>x.type==='TableBlock');
  const records=authorities(project).flatMap(value=>{let text=value;for(const table of tables)if(table.text)text=text.replaceAll(table.text,'');return numericRecords(text);});
  return [...records,...tables.flatMap(table=>tableRecords(table.rows))];
}
export function allowedNumbers(project) {return new Set(sourceRecords(project).map(x=>x.value));}
export function inspectSourceNumbers(project, slides=project.deck?.slides||[]) {
  if(!project.source?.text&&!project.source?.segments?.length)return [];
  const source=sourceRecords(project);
  const strict=effectiveKnowledge(project)==='source_only', issues=[];
  slides.forEach((slide,index)=>{
    const failures=[];
    for(const node of visibleNodes(slide))for(const record of (node.type==='table'?tableRecords(node.content?.rows):numericRecords(nodeContentText(node),node.semanticRole))) {
      const same=source.filter(x=>x.value===record.value);
      let reason=!same.length?'value_or_sign_not_in_input':null;
      const compatible=same.filter(x=>!record.unit||x.unit===record.unit);
      if(!reason&&record.unit&&!compatible.length)reason='unit_not_supported';
      // Distinct source statements that attach this value to another metric.
      // No context match remains uncertain; never let one unrelated source
      // number authorize a confidently attributed new statement.
      if(!reason&&record.tokens.size&&compatible.length&&compatible.every(x=>x.tokens.size&&shared(x.tokens,record.tokens)===0)) {
        const contradicted=source.some(x=>x.value!==record.value&&(!record.unit||x.unit===record.unit)&&shared(x.tokens,record.tokens)>0);
        reason=contradicted?'attribution_not_supported':'attribution_unverified';
      }
      if(reason)failures.push({...record,tokens:undefined,nodeId:node.id,reason});
    }
    if(failures.length)issues.push({code:'source_number_unsupported',severity:strict&&failures.some(x=>x.reason!=='attribution_unverified')?'error':'warning',slideId:slide.id,index,
      nodeIds:[...new Set(failures.map(x=>x.nodeId))],values:[...new Set(failures.map(x=>x.raw))].slice(0,12),numericFindings:failures.slice(0,24),repairable:true,
      message:`Numeric value, sign, unit or attribution is unsupported by the input: ${failures.slice(0,8).map(x=>`${x.raw}${x.unit} (${x.reason})`).join(', ')}. Template examples are not sources.`});
  });
  return issues;
}
