/** A topic's segments by the structure of its source units, before it is
 * written (fill-template-first MVP, the user 2026-11-03; Fable P2 (a)+(b)):
 * procedures, lists and tables keep their source N and take a template page
 * of that kind; the rest is prose, whose page the writer picks. Code reads the
 * text's own structure, not the inventory's block type (world_models: its
 * "TaxonomyBlock" is a numbered procedure and a "ComparisonBlock" is code).
 * A leaf module: the outline plan matches segments to the fill profiles. */

export const FILL_KINDS=Object.freeze(['title-body','cards','steps','compare','text-figure']);
const STEPS_MAX=8,COMPARE_ROWS_MAX=4;
const NUMBERED=/^\s*(?:\(?(\d{1,2})[.)、．]|[①-⑳]|(?:step|步骤|第)\s*\d+)\s*\S/iu;
const BULLET=/^\s*[-*•·▪]\s+\S/u;
const TABLE_ROW=/^\s*\|.*\|\s*$/u;
const RULE_ROW=/^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/u;

/** Items of the longest list run in a text: numbered lines in ascending order,
 * or bullet lines. A line that matches neither continues the item above it. */
function listRun(text,pattern,ordered){
 let best=0,run=0,last=0;
 for(const line of String(text||'').split('\n')){
  if(!line.trim())continue;
  const match=line.match(pattern);
  if(match){const number=ordered&&match[1]?Number(match[1]):null;
   if(ordered&&number!==null&&run&&number!==last+1){best=Math.max(best,run);run=0;}
   run++;last=number??last+1;continue;}
  if(!run)continue;
 }
 return Math.max(best,run);
}
/** A markdown table's data rows and columns, or null. */
function tableShape(text){
 const rows=String(text||'').split('\n').filter(line=>TABLE_ROW.test(line)&&!RULE_ROW.test(line));
 if(rows.length<2)return null;
 const cells=row=>row.trim().replace(/^\||\|$/gu,'').split('|').map(cell=>cell.trim());
 return{rows:rows.length-1,cols:cells(rows[0]).length,header:cells(rows[0])};
}
/** Source figures a topic's own text names ("Figure 4", "图 4"), as the cited-figure rule counts them. */
export function figuresNamed(p,ids){
 const units=new Map((p?.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const text=ids.map(id=>String(units.get(id)?.text||'')).join('\n');
 return (p?.source?.images||[]).filter(image=>{
  const number=String(image.caption||'').match(/^\s*(?:fig(?:ure)?\.?|图|圖)\s*(\d+)/iu)?.[1];
  return number&&new RegExp(`(?:fig(?:ure)?\\.?\\s*${number}\\b|[图圖]\\s*${number}(?!\\d))`,'iu').test(text);
 }).map(image=>image.id);
}
/** A topic cut into segments by structure (Fable 2026-11-03, P2 (a)+(b)):
 * a procedure (numbered list), a list (bullets) or a table of at least three
 * items is its own segment and keeps its source N exactly (a table: at most
 * four comparison cards, the whole table in the notes); everything else in the
 * topic is one prose segment, whose page the writer picks from the free
 * template pages. Each segment: {kind, N, citedUnits, figures, compare?};
 * prose has no source N (null). In source order. */
const STRUCTURED_MIN=3;
export function topicSegments(p,card){
 const units=new Map((p?.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item])),ids=(card?.sourceUnitIds||[]).filter(id=>units.has(id));
 const segments=[],prose=[];
 for(const id of ids){
  const text=String(units.get(id).text||''),table=tableShape(text),steps=listRun(text,NUMBERED,true),bullets=listRun(text,BULLET,false);
  if(table&&table.rows>=STRUCTURED_MIN)segments.push({kind:'table',N:Math.min(table.rows,COMPARE_ROWS_MAX),rows:table.rows,citedUnits:[id],...(table.cols===3?{compare:true}:{})});
  else if(steps>=STRUCTURED_MIN&&steps<=STEPS_MAX)segments.push({kind:'procedure',N:steps,citedUnits:[id]});
  else if(bullets>=STRUCTURED_MIN&&bullets<=STEPS_MAX)segments.push({kind:'list',N:bullets,citedUnits:[id]});
  else prose.push(id);
 }
 if(prose.length){const first=ids.indexOf(prose[0]),at=segments.findIndex(segment=>ids.indexOf(segment.citedUnits[0])>first);segments.splice(at<0?segments.length:at,0,{kind:'prose',N:null,citedUnits:prose});}
 return segments.map(segment=>({...segment,figures:figuresNamed(p,segment.citedUnits)}));
}
