import {approvedFixedTemplateCopy} from './ppt-template-fixed-authority.mjs';
import {sectionReferenceRanges,sourceSectionReferenceIds} from './ppt-section-references.mjs';
import {supportsSourceLineRanges,sourceLineRange} from './ppt-source-line-ranges.mjs';
/** Conservative numeric provenance. Template examples are never factual authority.
 * Checks values, signs, units and local attribution; ambiguous context is a
 * review warning, not a claim that lexical overlap proves semantic truth. */
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { effectiveKnowledge } from './ppt-generation-policy.mjs';
import { sourceDisplayText } from './ppt-source-text.mjs';
import {cardPartRuns,withCardIds} from './ppt-continuation-marker.mjs';
import {orderedSourceSteps} from './ppt-source-boundaries.mjs';
import {projectedSourceHeading} from './ppt-topic-title-projection.mjs';
import {finalDeckNavigation,finalNavigationTargets,navigationCommentary,sourceExampleContent} from './ppt-deck-navigation.mjs';
import {slideSourceHeading,sharedSourceHeading,parseSourceHeading} from './ppt-section-eyebrow.mjs';
import {diagramCoverage} from './ppt-diagram-cards.mjs';

const NUMBER = /(?<![A-Za-z0-9_.])[-−+]?(?:\d+(?:[.,]\d+)*|\.\d+)(?:[eE][-+]?\d+)?(?![A-Za-z0-9_])/gu;
const STOP = new Set('a an the is are was were be of for at to in on by with from and or as has have it its this that about approximately roughly input output step steps phase page slide million billion thousand metric amount value 指标 数值 万 亿'.split(' '));
const norm = value => {
  let raw=value.replace(/−/gu,'-').replace(/,/gu,'').replace(/^\+/u,'');
  const sign=raw.startsWith('-')?'-':'';raw=raw.replace(/^-/u,'');
  if(/[eE]/u.test(raw))return sign+raw.toLowerCase();
  const [whole='0',fraction='']=raw.split('.');const decimal=fraction.replace(/0+$/u,'');
  const result=(whole||'0').replace(/^0+(?=\d)/u,'')+(decimal?'.'+decimal:'');return result==='0'?'0':sign+result;
};
// Metric names such as P99, P50 or Top5 are words for attribution, not numbers.
const tokens = value => new Set((sourceDisplayText(value).toLowerCase().match(/[a-z][a-z0-9_]+|[\p{Script=Greek}]+|[\p{Script=Han}]{2,}/gu) || []).flatMap(word=>
  /\p{Script=Han}/u.test(word)?[...word].slice(1).map((_,i)=>word.slice(i,i+2)):[word,word.length>4&&word.endsWith('s')?word.slice(0,-1):word]).filter(word => !STOP.has(word)));
const shared = (a,b) => [...a].filter(word=>b.has(word)).length;
// "降低 67%" / "reduced by 67%" restates a source -67% as a magnitude; "降至" (to) does not.
const DECREASE_BEFORE=/(?:降低|下降|减少|减低|缩减|缩短|下滑|回落|reduced by|decreased by|cut by|dropped by|fell by|declined by|down by)\s*(?:了|约|大约|近)?\s*$/iu;
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
  // Plurals and the later numbers of a range or pair of steps or phases
  // ("steps 2–3", "steps 2 and 3", "第 2–3 步") are step references too (3143,
  // 2b9803a2 page 9). A page or slide range stays checked: it is navigation
  // that must point at real pages.
  return ordinal && (/(?:^|\n)\s*(?:#{1,6}\s*)?$/u.test(before) && /^[.)、]\s/u.test(after)
    || /(?:\b(?:step|phase|page|slide|part|chapter|section)|\b(?:steps?|phases?)(?:\s+\d{1,2}\s*(?:[–-]|,|\band\b|与|和))?|页面|頁面|页码|頁碼)\s*$/iu.test(before) && !/^\s*(?:%|percent|million|billion)/iu.test(after)
    || /(?:第)\s*$/u.test(before) && /^\s*(?:(?:[–-]\s*\d{1,2}\s*)?(?:步|阶段)|页|章|节|部分)/u.test(after)
    || /(?:第)\s*\d{1,2}\s*[–-]\s*$/u.test(before) && /^\s*(?:步|阶段)/u.test(after));
}
export function numericRecords(value, role) {
  const text=sourceDisplayText(value), out=[],references=sectionReferenceRanges(text);
  for(const match of text.matchAll(NUMBER)) {
    if(labelAt(text,match,role))continue;
    // Sentence boundaries excluding decimal points; then narrow long code/table lines.
    const start=Math.max(0,text.lastIndexOf('\n',match.index)+1,text.lastIndexOf('。',match.index)+1);
    let context=text.slice(start,Math.min(text.length,match.index+match[0].length+100));
    const sentences=context.split(/(?<=[.!?])\s+(?=[A-Z])/u);
    const offset=match.index-start;let n=0;
    for(const sentence of sentences){if(offset>=n&&offset<n+sentence.length){context=sentence;break;}n+=sentence.length+1;}
    const reference=references.find(r=>r.start===match.index&&r.id===match[0]);
    out.push({value:norm(match[0]),raw:match[0],unit:unitAfter(text,match.index+match[0].length),context,tokens:tokens(context),offset:match.index,...(reference?{referenceId:reference.id}:{})});
  }
  return out;
}
function authorities(project) {
  // The document's own title and subject (its metadata) are input too: a cover
  // label read from them ("… Machine Learning 2018") is no invented number.
  return [project.source?.text,project.prompt,project.deckTitle?.raw,project.source?.documentSubject,project.source?.documentTitle,...(project.source?.segments||[]).map(x=>x.text)].filter(Boolean);
}
// An ordered multiplication chain is not a collection of independent values
// or a speedup unit. Preserve every factor and its sign.
const dimensions=value=>[...sourceDisplayText(value).matchAll(/(?<![A-Za-z0-9_.])[-−+]?\d+(?:\.\d+)?(?:\s*\\?×\s*[-−+]?\d+(?:\.\d+)?)+/gu)]
  .map(match=>({raw:match[0],value:match[0].replace(/[\s\\]/gu,'').split('×').map(norm).join('×')}));
function tableRecords(rows) {
  // The first row is input too: a table read without its header puts a data
  // row there (JEPA PDF, 2026-10-31: "ViT-B/16 | 600 | 72.9" removed from the
  // prose with the table and then skipped as a header, so 72.9 blocked the deck).
  const header=rows?.[0]||[],headerRecords=header.flatMap(cell=>numericRecords(String(cell)).map(record=>({...record,tokens:tokens(header.join(' ')),context:header.join(' / ')})));
  return [...headerRecords,...(rows||[]).slice(1).flatMap(row=>row.flatMap((cell,column)=>numericRecords(String(cell)).map(record=>({...record,
    ...(!record.unit&&/\byear\b|年份/iu.test(rows[0]?.[column]||'')&&/^\d{4}$/u.test(record.raw)?{unit:'年'}:{}),
    tokens:tokens(`${rows[0]?.[column]||''} ${row[0]||''} ${cell}`),context:`${rows[0]?.[column]||''} / ${row[0]||''}: ${cell}`}))))];
}
// A table selected as a summary is a SummaryTableBlock; its rows (and the
// original table's) carry each cell's row and column labels. Parsed as prose,
// a cell took its context from the following row (real run: -49% P50 latency
// read as belonging to monthly GPU cost).
const TABLE_TYPES=new Set(['TableBlock','SummaryTableBlock']);
const recordsCache=new WeakMap(),recordsByIdentity=new Map();
function sourceRecords(project) {
  // Read once per source (the outline checks each card point against it).
  const key=project.source&&typeof project.source==='object'?project.source:null,signature=`${project.prompt||''}\u0000${project.deckTitle?.raw||''}\u0000${project.originalSourceInventory?.items?.length||0}`;
  const cached=key&&recordsCache.get(key);if(cached?.signature===signature)return cached.records;
  // Every page check reads the project afresh, so the object key above never
  // hits during generation: the same source was parsed again for each page
  // (docx 2026-10-31: ~30 s of a 48-page run). Its content identity is stable.
  const source=project.source||{},identity=source.sha256?[source.sha256,project.sourceRevision??'',String(source.text||'').length,source.segments?.length||0,source.semantic?.inventory?.items?.length||0,source.documentTitle||'',source.documentSubject||'',signature].join('\u0000'):null;
  const known=identity&&recordsByIdentity.get(identity);
  if(known){if(key)recordsCache.set(key,{signature,records:known});return known;}
  const tables=[...(project.originalSourceInventory?.items||[]),...(project.source?.semantic?.inventory?.items||[])].filter(x=>TABLE_TYPES.has(x.type)&&Array.isArray(x.rows));
  const records=authorities(project).flatMap(value=>{let text=value;for(const table of tables)if(table.text)text=text.replaceAll(table.text,'');return numericRecords(text);});
  const all=[...records,...tables.flatMap(table=>tableRecords(table.rows))].filter(r=>!r.referenceId);
  if(key)recordsCache.set(key,{signature,records:all});
  if(identity){recordsByIdentity.set(identity,all);if(recordsByIdentity.size>16)recordsByIdentity.delete(recordsByIdentity.keys().next().value);}
  return all;
}
/** A number written after a decrease verb ("降低 48%", "fell by 3") stands for
 * the source's negative value in the same unit; an unrelated positive value
 * (e.g. "48 ms" for "降低 48%") must not shadow it (real run, p0 numeric QA). */
function signedRecord(record,source,text){
  if(record.value.startsWith('-')||!DECREASE_BEFORE.test(text.slice(0,record.offset)))return record;
  const same=source.filter(x=>x.value===record.value),negated=source.filter(x=>x.value==='-'+record.value);
  return !same.length||negated.some(x=>!record.unit||x.unit===record.unit)?{...record,value:'-'+record.value}:record;
}
/** Why a visible number is not supported by the source records, or null:
 * its value, then its unit, then a source statement that attaches it to
 * another metric. No context match remains uncertain; never let one
 * unrelated source number authorize a confidently attributed new statement. */
function recordFailure(record,source){
  const same=source.filter(x=>x.value===record.value);
  if(!same.length)return 'value_or_sign_not_in_input';
  const compatible=same.filter(x=>!record.unit||x.unit===record.unit);
  if(record.unit&&!compatible.length)return 'unit_not_supported';
  if(record.tokens.size&&compatible.every(x=>x.tokens.size&&shared(x.tokens,record.tokens)===0))
    return source.some(x=>x.value!==record.value&&(!record.unit||x.unit===record.unit)&&shared(x.tokens,record.tokens)>0)?'attribution_not_supported':'attribution_unverified';
  return null;
}
/** The publish gate's verdict (inspectSourceNumbers) on the numbers of one
 * reader text, such as a card point before it is placed: the failures that
 * block publication (attribution_unverified is only a warning there). */
export function textNumberFailures(project,text){
  if(!project.source?.text&&!project.source?.segments?.length)return [];
  const source=sourceRecords(project),sourceDimensions=new Set(authorities(project).flatMap(dimensions).map(record=>record.value));
  return [...dimensions(text).filter(record=>!sourceDimensions.has(record.value)).map(record=>({...record,reason:'dimension_not_supported',unit:'ordered_multiplication'})),
    ...numericRecords(text).filter(record=>!record.referenceId).map(record=>({...record,tokens:undefined,reason:recordFailure(signedRecord(record,source,sourceDisplayText(text)),source)})).filter(record=>record.reason&&record.reason!=='attribution_unverified')];
}
export function allowedNumbers(project) {return new Set(sourceRecords(project).map(x=>x.value));}
function verifiedStepCounts(project,slide){
  const inventory=project.source?.semantic?.inventory?.items||[],counts=new Set();
  for(const node of visibleNodes(slide)){
    const item=inventory.find(item=>item.id===node.sourceArtifact?.sourceUnitId&&item.type==='ProcessBlock');
    if(!item||node.type!=='timeline')continue;
    const expected=orderedSourceSteps(item.text).map(text=>sourceDisplayText(text).trim());
    const actual=(node.content?.items||[]).map(item=>sourceDisplayText(item.text||'').trim());
    if(expected.length>1&&JSON.stringify(expected)===JSON.stringify(actual))counts.add(String(expected.length));
  }
  return counts;
}
export function verifiedHeadingPrefix(project,node) {
  if (!['section','template-text','eyebrow'].includes(node.semanticRole)) return 0;
  const text=sourceDisplayText(nodeContentText(node)).trim();
  const heading=text.match(/^(\d+(?:\.\d+)*)(?:[.)、])?\s+(.+)$/u);
  if(!heading||text.length>100||heading[2].length<3)return 0;
  const compact=value=>sourceDisplayText(value).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  // Bilingual navigation may display the verified language pair in the other
  // order. Match every displayed label to a source label under the same exact
  // section number; a numeric-looking role alone never authorizes a claim.
  const labels=value=>value.split(/[|·]/u).map(compact).filter(Boolean);
  const sourceHeadings=authorities(project).flatMap(value=>value.split('\n').filter(line=>/^\s*#{1,6}\s+/u.test(line)));
  // Only the ordinal is exempt: a server-derived translated/shortened label
  // can name the same owned source chapter without repeating its exact words.
  // Any numbers inside that label remain subject to factual provenance.
  const owner=project.deck?.slides?.find(slide=>visibleNodes(slide).some(n=>n.id===node.id&&nodeContentText(n)===nodeContentText(node)));
  const outline=project.outline?.find(slide=>slide.id===owner?.id);
  const ownedHeading=outline&&sharedSourceHeading(project,outline,slideSourceHeading(project,outline));
  if(owner?.sectionLabel?.basis==='source-heading'&&owner.sectionLabel.heading===ownedHeading&&
    (node.templateSlot?.role==='section'||node.content?.derivedFrom==='source-navigation')&&
    parseSourceHeading(ownedHeading).number===heading[1]&&
    sourceHeadings.some(line=>line.replace(/^\s*#{1,6}\s+/u,'').trim()===ownedHeading))return heading[1].length;
  return sourceHeadings.some(line=>{
    const original=line.replace(/^\s*#{1,6}\s+/u,'').match(/^(\d+(?:\.\d+)*)(?:[.)、])?\s+(.+)$/u);
    const projected=projectedSourceHeading(project,line),translated=projected?.match(/^(\d+(?:\.\d+)*)(?:[.)、])?\s+(.+)$/u);
    return original&&original[1]===heading[1]&&labels(heading[2]).every(label=>[...labels(original[2]),...(translated&&translated[1]===original[1]?labels(translated[2]):[])].some(source=>source.includes(label)));
  })?heading[1].length:0;
}
// A merged title may contain several original section labels. Only the
// exact ordinal plus its original heading is navigation; nearby claims remain
// subject to numeric provenance (including source-looking financial numbers).
function verifiedTitleHeadingOrdinals(project,node){
 if(!['title','template-title'].includes(node.semanticRole))return [];
 const text=sourceDisplayText(nodeContentText(node));
 const ranges=[];
 for(const original of authorities(project).flatMap(value=>value.split('\n'))){
  const heading=original.match(/^\s*#{1,6}\s+(\d+(?:\.\d+)*[.)、]?)\s+(.+?)\s*$/u);
  if(!heading)continue;
  const label=heading[2].trim();if(label.length<3)continue;
  const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  const expression=new RegExp('(?<![A-Za-z0-9_.])'+escaped(heading[1])+'\\s*'+escaped(label)+'(?=$|[\\s:：、；;与&])','gu');
  for(const match of text.matchAll(expression))ranges.push({start:match.index,end:match.index+heading[1].length});
 }
 return ranges;
}
/** A range "a–b" in a title or section label that names the sub-sections a..b
 * of one parent heading the page's cited units sit under ("Biases 1–3" over
 * units from 3.1, 3.2 and 3.3): navigation, not a fact (Fable, 2026-10-25;
 * 3143 g1i). Every number in the range must be such a sub-section. */
export function verifiedSubsectionRanges(project,slide,node){
 if(!['title','template-title','section','eyebrow'].includes(node.semanticRole))return [];
 const page=project.outline?.find(item=>item.id===slide.id),items=new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const subs=new Map();
 for(const id of page?.sourceUnitIds||[])for(const heading of items.get(id)?.sectionPath||[]){
  const match=String(heading).match(/^\s*#*\s*(\d+)\.(\d+)(?:[.\s]|$)/u);if(!match)continue;
  subs.set(match[1],new Set([...(subs.get(match[1])||[]),Number(match[2])]));
 }
 if(!subs.size)return [];
 const text=sourceDisplayText(nodeContentText(node)),ranges=[];
 for(const match of text.matchAll(/(?<![\d.])(\d{1,2})\s*[–—-]\s*(\d{1,2})(?![\d.%])/gu)){
  const a=Number(match[1]),b=Number(match[2]);if(!(a<b))continue;
  if([...subs.values()].some(set=>Array.from({length:b-a+1},(_,k)=>a+k).every(k=>set.has(k))))ranges.push({start:match.index,end:match.index+match[0].length});
 }
 return ranges;
}
export function verifiedFragmentRange(project,slide,node){
  const scope=node.content?.fragmentScope;
  if(scope&&node.content?.derivedFrom==='source-navigation'){
    const item=project.source?.semantic?.inventory?.items?.find(item=>item.id===scope.sourceUnitId);
    const {rowStart:start,rowEnd:end,totalRows:total}=scope;
    const text=sourceDisplayText(nodeContentText(node));
    const literal=text===`Rows ${start}–${end-1} of ${total}`||text===`第 ${start}–${end-1} 行，共 ${total} 行`;
    const bound=item?.rows&&start>=1&&end>start&&end<=item.rows.length&&total===item.rows.length-1&&visibleNodes(slide).some(table=>{
      const ref=table.sourceArtifact,rows=table.content?.rows;
      return table.type==='table'&&ref?.sourceUnitId===item.id&&ref.rowStart===start&&ref.rowEnd===end&&rows?.length===end-start+1&&[item.rows[0],...item.rows.slice(start,end)].every((row,r)=>row.every((cell,c)=>sourceDisplayText(rows[r]?.[c]).includes(sourceDisplayText(cell))));
    });
    if(literal&&bound)return {start:0,end:text.length};
  }
  if(!['title','template-title'].includes(node.semanticRole)||nodeContentText(node).replace(/\s+/gu,'')!==String(slide.title).replace(/\s+/gu,''))return null;
  const literal=String(slide.title).match(/\((?:lines |第 )(\d+)\s*[–-]\s*(\d+)(?: 行)?\)$/u);
  if(literal){
    const refs=slide.sourceArtifactRanges||project.outline?.find(s=>s.id===slide.id)?.sourceArtifactRanges||[];
    const items=project.source?.semantic?.inventory?.items||[];
    const valid=visibleNodes(slide).some(source=>{
      const a=source.sourceArtifact,item=items.find(item=>item.id===a?.sourceUnitId);
      if(!item||!supportsSourceLineRanges(item)||!refs.some(ref=>ref.sourceUnitId===item.id&&ref.lineStart===a.lineStart&&ref.lineEnd===a.lineEnd))return false;
      try{const range=sourceLineRange(item,a);return range.lineStart===Number(literal[1])-1&&range.lineEnd===Number(literal[2])&&String(source.content?.text??source.content?.processSource??'')===String(item.text).split('\n').slice(range.lineStart,range.lineEnd).join('\n');}catch{return false;}
    });
    if(valid)return {start:literal.index,end:literal.index+literal[0].length};
  }
  const title=String(slide.title),range=title.match(/[（(](?:selected\s+)?rows?\s+(\d+)\s*[-–—]\s*(\d+)[）)]/iu)||title.match(/(?:[（(])?(?:(?:selected\s+)?rows?\s+)?(\d+)\s*[-–—]\s*(\d+)(?:[）)])?$/iu);
  const single=title.match(/[（(](?:rows?\s+(\d+)|第\s*(\d+)\s*行)[）)]$/iu);
  if(!range&&!single)return null;
  const start=Number(range?.[1]??single[1]??single[2]),end=Number(range?.[2]??start),locator=range||single;
  const refs=slide.sourceArtifactRanges||project.outline?.find(s=>s.id===slide.id)?.sourceArtifactRanges||[];
  const items=project.source?.semantic?.inventory?.items||[];
  const bound=visibleNodes(slide).some(table=>{
    const a=table.sourceArtifact,item=items.find(item=>item.id===a?.sourceUnitId);
    const rowStart=a?.rowStart??1,rowEnd=a?.rowEnd??item?.rows?.length;
    return table.type==='table'&&item?.rows&&rowStart===start&&rowEnd===end+1&&(!refs.some(ref=>ref.sourceUnitId===item.id)||refs.some(ref=>ref.sourceUnitId===item.id&&ref.rowStart===rowStart&&ref.rowEnd===rowEnd))&&
      JSON.stringify(table.content?.rows?.[0]?.map(sourceDisplayText))===JSON.stringify(item.rows[0].map(sourceDisplayText))&&
      JSON.stringify(table.content?.rows?.slice(1).map(row=>row.map(sourceDisplayText)))===JSON.stringify(item.rows.slice(rowStart,rowEnd).map(row=>row.map(sourceDisplayText)));
  });
  return bound?{start:locator.index,end:locator.index+locator[0].length}:null;
}
function verifiedPageCounter(node,index,total){
  if(!['eyebrow','page-number','slide-number'].includes(node.semanticRole))return false;
  const text=sourceDisplayText(nodeContentText(node)).trim();
  // A card deck's footer number is the page's own position, digits only.
  if(node.semanticRole==='page-number'&&/^\d{1,3}$/u.test(text))return Number(text)===index+1;
  const match=text.match(/^(?:第\s*(\d+)\s*[頁页]\s*[，,]\s*共\s*(\d+)\s*[頁页]|page\s+(\d+)\s+of\s+(\d+))$/iu);
  return Boolean(match&&Number(match[1]||match[3])===index+1&&Number(match[2]||match[4])===total);
}
/** A numbered marker in place of a template sample icon (Fable 2026-11-02,
 * N1) is navigation: its slide's markers read exactly 1..n. */
export function verifiedSampleMarker(slide,node){
  if(node.semanticRole!=='template-marker'||node.content?.derivedFrom!=='sample-icon-marker')return false;
  const numbers=(slide.nodes||[]).filter(other=>other.semanticRole==='template-marker'&&other.content?.derivedFrom==='sample-icon-marker').map(other=>String(other.content?.text||'').trim());
  return numbers.every(text=>/^\d{1,2}$/u.test(text))&&[...numbers].map(Number).sort((a,b)=>a-b).every((n,k)=>n===k+1);
}
export function verifiedNavigationRanges(project,slide,node){
 const text=sourceDisplayText(nodeContentText(node));
 if(node.content?.derivedFrom==='source-example-navigation'){
  const expected=sourceExampleContent(project,slide.id,nodeContentText(node));
  if(!expected||JSON.stringify(node.content.navigationTargets)!==JSON.stringify(expected.navigationTargets))return [];
  const live=expected.navigationTargets.every(target=>{
   const companion=project.deck?.slides?.[target.page-1];if(companion?.id!==target.slideId)return false;
   return target.sourceUnitIds.every(id=>visibleNodes(companion).some(table=>table.type==='table'&&table.sourceArtifact?.sourceUnitId===id&&companion.sourceArtifactNodes?.some(cached=>cached.id===table.id&&JSON.stringify(cached.content?.rows)===JSON.stringify(table.content?.rows))));
  });
  if(!live)return [];
 }else{
  if(node.content?.derivedFrom!=='final-deck-navigation'||project.outline?.find(s=>s.id===slide.id)?.role!=='navigation')return [];
  const navigation=finalDeckNavigation(project),targets=finalNavigationTargets(navigation);
  if(JSON.stringify(node.content.navigationTargets)!==JSON.stringify(targets))return [];
  if(!navigationCommentary(project,navigation).map(c=>sourceDisplayText(c.text)).includes(text))return [];
 }
 return [...text.matchAll(/(?:第\s*\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*\d+(?:\s*[–-]\s*\d+)?)*\s*页|p\.\s*\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*\d+(?:\s*[–-]\s*\d+)?)*)/gu)].map(m=>({start:m.index,end:m.index+m[0].length}));
}
/** A figure page's "k/n" title marker is navigation, verified against the
 * outline: n is the card's number of figure pages and k is in range. */
export function verifiedFigurePageMarker(project,slide,node){
 const page=project.outline?.find(item=>item.id===slide.id);
 if(!page?.figurePage||!['title','template-title'].includes(node.semanticRole))return null;
 const text=sourceDisplayText(nodeContentText(node));
 // A repeat's " · k" that code gave a figure page (N6), recorded on its outline page.
 const repeat=text.match(/\s·\s(\d+)\s*$/u);
 if(repeat&&page.titleRepeat&&Number(repeat[1])===page.titleRepeat)return {start:repeat.index};
 const match=text.match(/(\d+)\/(\d+)\s*$/u);if(!match)return null;
 const siblings=(project.outline||[]).filter(item=>item.figurePage&&item.restoredFrom===page.restoredFrom).length,k=Number(match[1]),n=Number(match[2]);
 return n===siblings&&k>=1&&k<=n?{start:match.index}:null;
}
/** A split card's " · k/n" title counter is navigation, verified against the
 * outline (Fable 2026-10-27): the page is part k of a numbered run of n pages
 * sharing one base (cardPartRuns). */
export function verifiedPartCounter(project,slide,node){
 if(!['title','template-title','title-translation'].includes(node.semanticRole))return null;
 const outline=project.outline||[],index=outline.findIndex(item=>item.id===slide.id);if(index<1)return null;
 const match=sourceDisplayText(nodeContentText(node)).match(/\s·\s(\d+)\s*\/\s*(\d+)\s*$/u);if(!match)return null;
 const run=cardPartRuns(withCardIds(project,outline)).find(item=>item.pages.includes(index)),k=Number(match[1]),n=Number(match[2]);
 return run&&n===run.n&&k===run.pages.indexOf(index)+1?{start:match.index}:null;
}
export function inspectSourceNumbers(project, slides=project.deck?.slides||[]) {
  if(!project.source?.text&&!project.source?.segments?.length)return [];
  const source=sourceRecords(project);
  const referenceIds=sourceSectionReferenceIds(authorities(project));
  const sourceDimensions=new Set(authorities(project).flatMap(dimensions).map(record=>record.value));
  const strict=effectiveKnowledge(project)==='source_only', issues=[];
  const nodeRecords=node=>{
    if(node.type==='table')return tableRecords(node.content?.rows);
    const actual=numericRecords(nodeContentText(node),node.semanticRole);
    const item=project.source?.semantic?.inventory?.items?.find(item=>item.id===node.sourceArtifact?.sourceUnitId&&TABLE_TYPES.has(item.type));
    if(!item||!node.content?.diagram)return actual;
    const proof=diagramCoverage(item,node);if(!proof.complete)return actual;
    // Table-derived editable cards still own row/column attribution. A flat
    // text scan took a VAE count's context from the following MDN-RNN row.
    // Check every actually visible number; only verified source values gain
    // their original cell context, so added/mutated quantities still fail.
    const bound=tableRecords([item.rows[0],...proof.rows.map(row=>item.rows[row])]);
    return actual.map(record=>{const cell=bound.find(cell=>cell.value===record.value&&cell.unit===record.unit);return cell?{...record,tokens:cell.tokens,context:cell.context}:record;});
  };
  slides.forEach((slide,index)=>{
    const failures=[],stepCounts=verifiedStepCounts(project,slide);
    for(const node of visibleNodes(slide).filter(node=>!approvedFixedTemplateCopy(project,node)))for(const record of dimensions(nodeContentText(node)))if(!sourceDimensions.has(record.value))
      failures.push({...record,nodeId:node.id,reason:'dimension_not_supported',unit:'ordered_multiplication'});
    for(const node of visibleNodes(slide))for(const record of nodeRecords(node)) {
      if(approvedFixedTemplateCopy(project,node))continue;
      if(record.referenceId){if(!referenceIds.has(record.referenceId))failures.push({...record,tokens:undefined,nodeId:node.id,reason:'section_reference_not_in_input'});continue;}
      if(verifiedPageCounter(node,index,slides.length)||verifiedSampleMarker(slide,node))continue;
      {const marker=verifiedFigurePageMarker(project,slide,node)||verifiedPartCounter(project,slide,node);if(marker&&record.offset>=marker.start)continue;}
      if(verifiedNavigationRanges(project,slide,node).some(range=>record.offset>=range.start&&record.offset<range.end))continue;
      // Only a verified source chapter prefix or exact source-owned row range
      // is presentation navigation. A numeric-looking role never exempts facts.
      if(record.offset<verifiedHeadingPrefix(project,node))continue;
      if(verifiedTitleHeadingOrdinals(project,node).some(range=>record.offset>=range.start&&record.offset<range.end))continue;
      if(verifiedSubsectionRanges(project,slide,node).some(range=>record.offset>=range.start&&record.offset<range.end))continue;
      const fragment=verifiedFragmentRange(project,slide,node);
      if(fragment&&record.offset>=fragment.start&&record.offset<fragment.end)continue;
      // A visible count of steps is derived only from an exactly preserved
      // source-owned process on this page, never from model-written prose.
      const tail=sourceDisplayText(nodeContentText(node)).slice(record.offset+record.raw.length);
      if(!record.unit&&stepCounts.has(record.value)&&/^\s*(?:[-–]\s*)?(?:步|steps?\b)/iu.test(tail))continue;
      const reason=recordFailure(signedRecord(record,source,sourceDisplayText(nodeContentText(node))),source);
      if(reason)failures.push({...record,tokens:undefined,nodeId:node.id,reason});
    }
    if(failures.length)issues.push({code:'source_number_unsupported',severity:strict&&failures.some(x=>x.reason!=='attribution_unverified')?'error':'warning',slideId:slide.id,index,
      nodeIds:[...new Set(failures.map(x=>x.nodeId))],values:[...new Set(failures.map(x=>x.raw))].slice(0,12),numericFindings:failures.slice(0,24),repairable:true,
      message:`Numeric value, sign, unit or attribution is unsupported by the input: ${failures.slice(0,8).map(x=>`${x.raw}${x.unit} (${x.reason})`).join(', ')}. Template examples are not sources.`});
  });
  return issues;
}
