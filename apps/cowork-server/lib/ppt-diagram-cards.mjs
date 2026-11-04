/** Native diagram components built from recognised source tables (M1/M2 of
 * ppt-gamma-results-20261013/PPT_Media_Component_Diversity_Plan_20261019.md).
 *
 * A source table keeps every cell; only its representation changes:
 *   layer-stack — architecture layers as stacked full-width bands
 *   card-grid   — 2–3 column records as a grid of titled cards
 *   kpi         — metric/target records as large-number tiles
 *   donut       — a share column (sums to 1 or 100%) as a doughnut chart
 * (ordered steps already render as process cards; render-tree adds the flow
 * connectors). Every diagram carries `sourceRows`, the exact original cells it
 * displays, and `diagramCoverage` proves each of those cells is visible. The
 * renderers draw native PPTX shapes from the same card boxes as React/SVG. */
import {_internals as point} from './ppt/point-layout.mjs';
import {measureText,textContract,CARD_PADDING} from './ppt/render-contract.mjs';
import {sourceRichText} from './ppt-source-text.mjs';
import {relationalPlan,relationalCoverage,tableRelationKind,tableRelationComponent} from './ppt-relational-diagram.mjs';

const INCH=914400;
export const DIAGRAM_VERSION=1;
const plain=value=>sourceRichText(String(value??''),{inline:true}).plainText.replace(/\s+/gu,' ').trim();
const length=value=>[...plain(value)].length;
// Cell text as displayed: inline Markdown resolved, line breaks inside a cell kept.
const lines=value=>String(value??'').split(/\n/u).map(plain).filter(Boolean).join('\n');
const SHARE=value=>{const m=plain(value).match(/^([0-9]+(?:\.[0-9]+)?)\s*(%)?$/u);return m?{value:Number(m[1]),percent:Boolean(m[2])}:null;};
const METRIC=/\d/u;
// A measured cell: a number and at most a short unit, nothing else (Fable S3).
const MEASURE=/^([-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?)\s*(%|‰|ms|s|min|h|秒|分钟|小时|天|个|次|条|页|万|亿|元|美元|MB|GB|KB|TB|x|倍)?$/u;
const measure=cell=>{const m=plain(cell).match(MEASURE);return m?{value:Number(m[1].replace(/,/gu,'')),unit:m[2]||''}:null;};
const visualUnits=value=>[...plain(value)].reduce((n,ch)=>n+(/[\u2e80-\u9fff]/u.test(ch)?1:.55),0);
/** The numeric series of a table a column chart can show (Fable S3,
 * 2026-11-01): 3-8 named categories, 1-3 columns of measures in one shared
 * unit, short category names, no year columns; else null (it stays a table).
 * A headerless table has no names for its series, and unitless columns are
 * different measures unless there is only one (JEPA b_0023, 2026-11-01:
 * epochs and top-1 accuracy were drawn as one chart named "600" and "72.9"). */
export function chartSeries(item){
  const rows=Array.isArray(item?.rows)?item.rows:null;if(!rows||rows.length<4||rows.length>9||item.headerless===true)return null;
  const header=rows[0],data=rows.slice(1),cols=header.length;
  if(cols<2||cols>4||data.some(row=>row.length!==cols))return null;
  if(data.some(row=>!plain(row[0])||measure(row[0])||visualUnits(row[0])>8))return null;
  const columns=[];
  for(let c=1;c<cols;c++){const values=data.map(row=>measure(row[c]));if(values.some(value=>!value))return null;if(values.every(value=>!value.unit&&value.value>=1900&&value.value<=2100&&Number.isInteger(value.value)))return null;columns.push({column:c,values});}
  const units=new Set(columns.flatMap(entry=>entry.values.map(value=>value.unit)));
  if(units.size!==1||columns.length>3||(columns.length>1&&![...units][0]))return null;
  return {columns:columns.map(entry=>entry.column),unit:[...units][0],labels:data.map(row=>plain(row[0])),series:columns.map(entry=>({name:plain(header[entry.column]),values:entry.values.map(value=>value.value)}))};
}
const TARGET=/[≥≤<>]|%|％|秒|分钟|小时|天|周|月|年|页|条|个|例|次|万|ms|\bx\b|倍|元/u;

/** The representation for one TableBlock, or null to keep the table. */
export function chooseTableDiagram(item){
  // Every diagram names its parts from the header row: a headerless table stays a table.
  const rows=Array.isArray(item?.rows)?item.rows:null;if(!rows||rows.length<3||item.headerless===true)return null;
  const header=rows[0],data=rows.slice(1),cols=header.length;
  if(!cols||data.some(row=>row.length!==cols))return null;
  // Cards and chart labels are plain text: a table with inline mathematics
  // keeps its native cells (which preserve the formula runs).
  if(rows.some(row=>row.some(cell=>sourceRichText(String(cell??''),{inline:true}).runs?.some(run=>run.kind==='math'))))return null;
  const explicitRelation=tableRelationKind(item);if(explicitRelation)return explicitRelation;
  // A small source table (up to 4 columns, 8 data rows) is drawn as a table,
  // never as cards (Fable D1, 2026-11-01: World Models' temperature table showed
  // as 7 chips "VIRTUAL SCORE：2086 ± 140"); a share column may still be a donut.
  const small=item.type==='TableBlock'&&cols<=4&&data.length<=8;
  const relation=item.diagramSource?.relation;
  if(!small&&relation==='layer-stack'&&cols===2&&data.length<=8)return 'layer-stack';
  for(let c=1;c<cols;c++){
    const shares=data.map(row=>SHARE(row[c]));
    if(data.length>=2&&data.length<=8&&shares.every(Boolean)){
      const total=shares.reduce((sum,s)=>sum+s.value,0),percent=shares.every(s=>s.percent);
      if(percent?Math.abs(total-100)<=1:Math.abs(total-1)<=.011||Math.abs(total-100)<=1)return 'donut';
    }
  }
  // Measures in one unit are a column chart, small tables too (Fable S3).
  if(chartSeries(item))return 'column-chart';
  if(small)return null;
  const last=cols-1;
  if(cols>=2&&cols<=3&&data.length>=2&&data.length<=16&&data.every(row=>METRIC.test(plain(row[last]))&&TARGET.test(plain(row[last]))&&length(row[last])<=48))return 'kpi';
  if(['directory-tree','annotated-list','named-flows'].includes(relation)&&cols<=3)return 'card-grid';
  if(cols>=2&&cols<=3&&data.length>=2&&data.length<=8&&data.every(row=>length(row[0])<=24&&row.slice(1).every(cell=>length(cell)<=110)))return 'card-grid';
  return null;
}

function rowsFor(item,start,end){return item.rows.slice(start,end).map((cells,index)=>({row:start+index,cells:cells.map(String)}));}

/** The list/chart component for a table row range (start..end exclusive). */
export function tableDiagramComponent(item,kind,start=1,end=item.rows.length){
  if(['swimlane','timeline','symbolic-interval'].includes(kind))return tableRelationComponent(item,kind,start,end);
  const header=item.rows[0].map(String),sourceRows=rowsFor(item,start,end),cols=header.length;
  const diagram={version:DIAGRAM_VERSION,kind,sourceUnitId:item.id,rowStart:start,rowEnd:end,headers:header,sourceRows};
  if(kind==='donut'&&start===1&&end===item.rows.length){
    const shareCol=header.findIndex((_,c)=>c>0&&sourceRows.every(r=>SHARE(r.cells[c])));
    const labels=sourceRows.map(r=>r.cells.filter((_,c)=>c!==shareCol).map(plain).filter(Boolean).join(' · '));
    const values=sourceRows.map(r=>SHARE(r.cells[shareCol]).value);
    return {type:'chart',content:{chartType:'doughnut',labels,values,unit:plain(header[shareCol]),chartSource:'source_table_share',chartTitle:plain(header[shareCol]),diagram:{...diagram,shareColumn:shareCol}}};
  }
  if(kind==='column-chart'&&start===1&&end===item.rows.length){
    const found=chartSeries(item);
    if(found)return {type:'chart',content:{chartType:'bar',labels:found.labels,values:found.series[0].values,...(found.series.length>1?{series:found.series}:{}),unit:found.unit,chartTitle:found.series.length===1?[found.series[0].name,found.unit&&`（${found.unit}）`].filter(Boolean).join(''):found.unit,chartSource:'source_table_series',diagram:{...diagram,seriesColumns:found.columns,unit:found.unit}}};
  }
  const card=kind==='donut'||kind==='column-chart'?'card-grid':kind;
  // A blank leading cell continues the group label of the row above (merged
  // cells in Markdown); the label is repeated as context, cells stay exact.
  let group='';for(let r=1;r<start;r++)if(plain(item.rows[r][0]))group=plain(item.rows[r][0]);
  const items=sourceRows.map(({cells})=>{
    if(plain(cells[0]))group=plain(cells[0]);
    const lead=plain(cells[0])||group;
    let heading,body;
    if(card==='kpi'){heading=plain(cells[cols-1]);body=[lead,...cells.slice(1,cols-1).map(plain)].filter(Boolean).join(' · ');}
    else if(card==='layer-stack'){heading=lead;body=cells.slice(1).map(lines).join('\n');}
    else{heading=lead;body=cells.slice(1).map((cell,i)=>cols===2?lines(cell):`${plain(header[i+1])}：${lines(cell)}`).filter(text=>plain(text)&&!/：$/u.test(text)).join('\n');}
    return {heading,body,text:[heading,body].filter(Boolean).join('\n')};
  });
  return {type:'list',content:{items,diagram:{...diagram,kind:card}}};
}

/** Card geometry. KPI headings are 1.8× and accent-coloured; layer bands are
 * one full-width column; cards fill 1–4 columns. Fractions of the frame, as
 * point-layout and process cards use, so React/SVG/PPTX share the boxes. */
export const KPI_HEADING_SCALE=1.8;
function cardHeight(parts,widthIn,fontSizePt,headingScale,inline=false,lineHeight=1.18){
  if(inline)return point.requiredHeight({heading:'',body:[parts.heading,parts.body].filter(Boolean).join('\u3000')},widthIn,fontSizePt,lineHeight);
  if(headingScale===1)return point.requiredHeight(parts,widthIn,fontSizePt,lineHeight);
  const measure=(text,pt)=>{const e={kind:'text',bounds:{width:widthIn*INCH,height:1e12},content:{text},style:{fontSizePt:pt,lineHeight,paragraphSpacingEm:0}};return measureText(e,textContract(e,CARD_PADDING)).estimatedHeightPt;};
  return (measure(parts.heading||' ',Math.round(fontSizePt*headingScale*2)/2)+3+(parts.body?measure(parts.body,fontSizePt):0)+CARD_PADDING[1]+CARD_PADDING[3])/72;
}
export function diagramCardPlan(content,geometry,fontSizePt,{lineHeight=1.18,fixedFont=false}={}){
  if(content?.diagram?.relational)return relationalPlan(content,geometry,fontSizePt,{lineHeight});
  const diagram=content?.diagram;if(diagram?.version!==DIAGRAM_VERSION||!Array.isArray(content.items)||!content.items.length)return null;
  const items=content.items,width=geometry.width/INCH,height=geometry.height/INCH,gap=diagram.kind==='layer-stack'?.08:.16,badgeBand=Math.max(0,Number(content.badgeInsetPt)||0)/72;
  // A marker column (Fable M2): its text is measured beside the circle, never under it.
  const markers=Array.isArray(content.markers)&&content.markers.length===items.length?content.markers:null,markerIn=markers?MARKER_IN:0;
  // KPI numbers are large only when they are short; long target statements
  // stay readable at a modest scale. Layer bands put the layer name inline.
  const longest=Math.max(0,...items.map(item=>[...String(item.heading||'')].length));
  const headingScale=diagram.kind==='kpi'?(longest<=10?KPI_HEADING_SCALE:longest<=20?1.4:1.15):1;
  const inline=diagram.kind==='layer-stack';
  // Body-only marker cards are a grid, balanced (Fable P3, 2026-11-02, the hand
  // deck's cards; live Mood-Board p2 stacked five as one-line strips).
  const balanced=content.bodyOnly?[...new Set([items.length<=3?items.length:items.length===4?2:3,2,1])]:null;
  const options=diagram.kind==='layer-stack'?[1]:diagram.kind==='kpi'?[4,3,2,1]:balanced||[3,2,1];
  // Like semantic point cards, a diagram may step its type down to the 14pt
  // prose floor before it is reported as overflowing (and falls back to a table).
  for(let pt=fixedFont?fontSizePt:Math.floor(fontSizePt);pt>=(fixedFont?fontSizePt:DIAGRAM_FONT_FLOOR_PT);pt--){
    // A smaller step size is also taken to keep a Latin word whole (no "initiali|zed").
    const plan=planAt(pt);if(plan&&!plan.overflow&&(!plan.brokenWords||fixedFont||pt===DIAGRAM_FONT_FLOOR_PT))return plan;
    if(plan&&!plan.overflow&&plan.brokenWords){const smaller=planAt(pt-1);if(smaller&&!smaller.overflow&&smaller.brokenWords<plan.brokenWords)continue;return plan;}
    if(pt===DIAGRAM_FONT_FLOOR_PT||!plan)return plan;
  }
  return planAt(fontSizePt);
  function planAt(fontSizePt){
  const candidates=options.filter(n=>n<=items.length&&width/n>=1.6).map(columns=>{
    const rows=[];for(let i=0;i<items.length;i+=columns)rows.push(items.slice(i,i+columns));
    const cellWidth=(width-gap*(columns-1))/columns;
    // A row of cards with template icon badges keeps a band above them (Fable media decision S3).
    const needs=rows.map(row=>Math.max(...row.map(item=>cardHeight(point.pointParts(item),cellWidth-markerIn,fontSizePt,headingScale,inline,lineHeight)))+badgeBand);
    const neededHeight=needs.reduce((a,b)=>a+b,0)+gap*(rows.length-1);
    const brokenWords=items.reduce((n,item)=>n+[[item.heading,fontSizePt*headingScale],[item.body??item.text,fontSizePt]].reduce((m,[value,pt])=>{if(!value)return m;const element={kind:'text',bounds:{width:(cellWidth-markerIn)*INCH,height:1e12},content:{text:String(value)},style:{fontSizePt:pt,lineHeight}};return m+measureText(element,textContract(element,CARD_PADDING)).brokenWords;},0),0);
    // A tile's number is one line: a column too narrow for it is no candidate
    // (live Mood-Board: "4,348,547" broke into "4,348,5 / 47" in four columns).
    const numberBreaks=diagram.kind==='kpi'&&items.some(item=>{if(!item.heading)return false;const element={kind:'text',bounds:{width:(cellWidth-markerIn)*INCH,height:1e12},content:{text:String(item.heading)},style:{fontSizePt:Math.round(fontSizePt*headingScale*2)/2,lineHeight}};const fit=measureText(element,textContract(element,CARD_PADDING));return fit.widthOverflow||(Array.isArray(fit.lines)?fit.lines.length:Number(fit.lines))>1;});
    return {columns,rows,needs,neededHeight,brokenWords,overflow:neededHeight>height||numberBreaks};
  }).sort((a,b)=>Number(a.overflow)-Number(b.overflow)||a.brokenWords-b.brokenWords||(diagram.kind==='kpi'?b.columns-a.columns:balanced?balanced.indexOf(a.columns)-balanced.indexOf(b.columns):a.neededHeight-b.neededHeight)||a.columns-b.columns);
  const best=candidates[0];if(!best)return null;
  const frame=Math.max(.01,best.neededHeight),cellWidth=(width-gap*(best.columns-1))/best.columns,boxes=[];
  // A short last row of body-only cards is centred (Fable 2026-11-02: 3 + 2).
  let y=0;best.rows.forEach((row,r)=>{const shift=balanced?(best.columns-row.length)*(cellWidth+gap)/2:0;row.forEach((_,c)=>boxes.push({x:(shift+c*(cellWidth+gap))/width,y:(y+badgeBand)/frame,w:cellWidth/width,h:(best.needs[r]-badgeBand)/frame}));y+=best.needs[r]+gap;});
  return {version:DIAGRAM_VERSION,kind:diagram.kind,boxes,fontSizePt,lineHeight,...(markers?{markers,markerInches:MARKER_IN}:{}),...(badgeBand?{badgeInsetPt:Number(content.badgeInsetPt)}:{}),columns:best.columns,brokenWords:best.brokenWords,headingScale,...(headingScale!==1?{headingFontSizePt:Math.round(fontSizePt*headingScale*2)/2}:{}),inlineHeading:inline,overflow:best.overflow,requiredHeight:Math.ceil(best.neededHeight*INCH),
    suggestedSplitCount:best.overflow?Math.max(2,Math.ceil(best.neededHeight/Math.max(.1,height))):1};
  }
}
export const DIAGRAM_FONT_FLOOR_PT=14;
/** A card's marker circle and its gap to the text, inches. */
export const MARKER_IN=.34;

/** Ordered process cards are a flow: connect each card to the next. */
export function flowConnectors(boxes=[]){
  return boxes.slice(0,-1).map((box,i)=>{
    const next=boxes[i+1];if(Math.abs(box.y-next.y)<.005&&next.x>box.x)return {from:i,to:i+1};
    const x1=box.x+box.w/2,y1=box.y+box.h,x2=next.x+next.w/2,y2=next.y,mid=(y1+y2)/2;
    return {from:i,to:i+1,points:[{x:x1,y:y1},{x:x1,y:mid},{x:x2,y:mid},{x:x2,y:y2}]};
  });
}

/** Every displayed source cell must equal the original and be visible. */
export function diagramCoverage(item,node){
  const relational=relationalCoverage(item,node);if(relational)return relational;
  const diagram=node?.content?.diagram;
  if(diagram?.version!==DIAGRAM_VERSION||diagram.sourceUnitId!==item.id||!Array.isArray(diagram.sourceRows))return {complete:false,rows:[]};
  const visible=plain(node.type==='chart'?[...(node.content.labels||[]),...(node.content.values||[]).map(String),node.content.unit||''].join(' ␟ '):(node.content.items||[]).map(i=>(i.heading||i.body?[i.heading,i.body]:[i.text]).filter(Boolean).join('\n')).join(' ␟ ')).normalize('NFKC');
  const rows=[];
  for(const {row,cells} of diagram.sourceRows){
    const original=item.rows?.[row];
    if(!original||original.length!==cells.length||cells.some((cell,c)=>plain(cell)!==plain(original[c])))return {complete:false,rows:[]};
    const shown=cells.every((cell,c)=>{const text=plain(cell).normalize('NFKC');if(!text)return true;if(node.type==='chart'&&c===diagram.shareColumn)return node.content.values?.includes(SHARE(cell)?.value);
      // A chart shows a measure as its value in the series of its column, in the shared unit.
      if(node.type==='chart'&&diagram.seriesColumns?.includes(c)){const at=diagram.seriesColumns.indexOf(c),found=measure(cell),values=(node.content.series?.[at]||{values:node.content.values}).values;return Boolean(found)&&found.unit===diagram.unit&&values?.includes(found.value);}return text.split(/\s*\n\s*/u).every(line=>visible.includes(line));});
    if(!shown)return {complete:false,rows:[]};
    rows.push(row);
  }
  return {complete:true,rows};
}
