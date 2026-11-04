/** Source-owned relations rendered as native cards and directed connections.
 * Geometry never creates an edge. Cycles retain the source table; a row range
 * of a larger graph is drawn as one part with continuation cards. */
import {digest} from './ppt/edit-context.mjs';
import {_internals as point} from './ppt/point-layout.mjs';
import {validGraphProjection} from './ppt-ascii-graph.mjs';
import {sourceRichText} from './ppt-source-text.mjs';

const INCH=914400;
export function relationalTableComponent(component){
 const d=component.content?.diagram;
 if(!d?.relational||!Array.isArray(d.headers)||!Array.isArray(d.sourceRows)||d.sourceRows.some(r=>!Array.isArray(r?.cells))||component.locked||component.userStyle||component.userGeometry)return null;
 const rawRows=[d.headers,...d.sourceRows.map(r=>r.cells)].map(row=>row.map(String)),cellRich=rawRows.map(row=>row.map(v=>sourceRichText(v,{inline:true})));
 return {...component,type:'table',content:{rows:cellRich.map(row=>row.map(c=>c.plainText)),rawRows,cellRich,displayTransformVersion:2}};
}
/** The data row that owns each graph node. Rows follow the node projection
 * order; a compact projection (Component / Next component) gives leaves no
 * row of their own, so a leaf belongs with its first parent's row. */
export function graphNodeRows(item){
 const graph=item?.diagramSource?.graph;if(!graph||!Array.isArray(item.rows))return null;
 const rowNodes=item.rows[0]?.length===2?graph.nodes.filter(n=>graph.edges.some(e=>e.from===n.id)):graph.nodes;
 if(rowNodes.length!==item.rows.length-1)return null;
 const rows=new Map(rowNodes.map((n,i)=>[n.id,i+1]));
 for(const n of graph.nodes)if(!rows.has(n.id)){const parents=graph.edges.filter(e=>e.to===n.id).map(e=>rows.get(e.from)).filter(Number.isInteger);rows.set(n.id,parents.length?Math.min(...parents):1);}
 return rows;
}
const graphNodeItem=n=>({sourceNodeId:n.id,heading:n.label,body:(n.body||[]).join('\n'),text:[n.label,...n.body||[]].join('\n')});
// A node owned by another part keeps its exact source label; the arrow says
// which way the relation continues (later part: "→ label", earlier: "label →").
const continuationItem=(n,direction)=>{const heading=direction==='next'?'→ '+n.label:n.label+' →';return {sourceNodeId:n.id,heading,body:'',text:heading,continuation:{version:1,direction}};};
export function relationalComponent(item,start=1,end=item.rows?.length){
 const graph=item.diagramSource?.presentation==='semantic_graph_rows'&&item.diagramSource.graph;
 if(!graph||!validGraphProjection(item)||!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<=start||end>item.rows.length)return null;
 if(item.diagramSource?.kind!=='prose'&&item.rows.some(row=>row.some(v=>sourceRichText(String(v),{inline:true}).runs.some(run=>run.kind==='math'))))return null;
 const index=new Map(graph.nodes.map((n,i)=>[n.id,i]));
 if(graph.edges.some(e=>!index.has(e.from)||!index.has(e.to)))return null;
 const kind=graph.layoutRelation==='overlap'?'overlap-windows':graph.layoutRelation==='cycle'?'cycle':graph.layoutRelation==='parallel'?'card-grid':graph.layoutRelation==='branch'?'decision':graph.nodes.some(n=>/^(?:yes|no|是|否)$/iu.test(n.label.trim()))?'decision':/directory|tree/u.test(item.diagramSource.originalRelation||'')||/[├└]/u.test(item.diagramSource.text)&&!/[↓→]/u.test(item.diagramSource.text)?'hierarchy':'dependency-graph';
 let nodes=graph.nodes,items=graph.nodes.map(graphNodeItem),part;
 if(start!==1||end!==item.rows.length){
  // Ring and overlap layouts need the complete node set.
  if(['cycle','overlap-windows'].includes(kind))return null;
  const rows=graphNodeRows(item);if(!rows)return null;
  const own=new Set(graph.nodes.filter(n=>rows.get(n.id)>=start&&rows.get(n.id)<end).map(n=>n.id));if(!own.size)return null;
  const linked=new Set(graph.edges.flatMap(e=>own.has(e.from)===own.has(e.to)?[]:[own.has(e.from)?e.to:e.from]));
  nodes=graph.nodes.filter(n=>own.has(n.id)||linked.has(n.id));
  items=nodes.map(n=>own.has(n.id)?graphNodeItem(n):continuationItem(n,rows.get(n.id)<start?'previous':'next'));
  part={version:1,rowStart:start,rowEnd:end,nodeIds:nodes.filter(n=>own.has(n.id)).map(n=>n.id),continuationNodeIds:nodes.filter(n=>linked.has(n.id)).map(n=>n.id)};
 }
 const local=new Map(nodes.map((n,i)=>[n.id,i]));
 const edges=graph.edges.flatMap((e,i)=>local.has(e.from)&&local.has(e.to)&&(!part||part.nodeIds.includes(e.from)||part.nodeIds.includes(e.to))?[{from:local.get(e.from),to:local.get(e.to),sourceEdgeId:'edge_'+i}]:[]);
 const content={items,diagram:{version:1,kind,sourceUnitId:item.id,rowStart:start,rowEnd:end,headers:item.rows[0],sourceRows:item.rows.slice(start,end).map((cells,i)=>({row:start+i,cells:cells.map(String)})),relational:{version:1,sourceGraphHash:digest(graph),nodeIds:nodes.map(n=>n.id),edges,...(part?{part}:{})}}};
 return relationalPlan(content,{width:12*INCH,height:6*INCH},18)?{type:'list',content}:null;
}

/** Explicitly named table lanes/dates can become a diagram without inventing
 * dependency or duration. Lane records remain independent; ISO dates retain
 * their actual spacing and fall back to a table when close labels overlap. */
export function tableRelationKind(item){
 const rows=item?.rows;if(!rows||rows.length<3)return null;
 if(item.diagramSource?.relation==='symbolic-interval'&&Number.isInteger(item.diagramSource.intervalCount))return 'symbolic-interval';
 const header=rows[0].map(v=>String(v).trim());
 if(header.length===3&&/^(?:lane|actor|role|泳道|角色)$/iu.test(header[0])&&/^(?:step|stage|步骤|阶段)$/iu.test(header[1]))return 'swimlane';
 if(header.length===2&&/^(?:date|time|日期|时间)$/iu.test(header[0])){
  const labels=rows.slice(1).map(r=>String(r[0])),dates=labels.map(v=>/^\d{4}-\d{2}(?:-\d{2})?$/u.test(v)?Date.parse(v):NaN);
  if(dates.every((d,i)=>Number.isFinite(d)&&new Date(d).toISOString().startsWith(labels[i]))&&dates.every((d,i)=>!i||d>dates[i-1]))return 'timeline';
 }
 return null;
}
export function tableRelationComponent(item,kind,start,end){
 const sourceRows=item.rows.slice(start,end).map((cells,i)=>({row:start+i,cells:cells.map(String)}));
 const lanes=kind==='swimlane'?[...new Set(sourceRows.map(r=>r.cells[0]))]:[];
 const stages=kind==='swimlane'?[...new Set(sourceRows.map(r=>r.cells[1]))]:[];
 const items=sourceRows.map(({cells,row})=>({sourceNodeId:'row_'+row,heading:kind==='swimlane'?cells[0]+' · '+cells[1]:cells[0],body:cells.at(-1),text:cells.join('\n'),...(kind==='swimlane'?{lane:lanes.indexOf(cells[0]),stage:stages.indexOf(cells[1])}:{})}));
 const endpointBindings=[];
 if(kind==='symbolic-interval'&&start===1&&item.diagramSource.intervalCount===5&&items.length>=6){
  const annotations=items[5].body||'',ranges=annotations.match(/[^\s]+\.\.[^\s]+/gu)||[];
  // Only the explicit purge/validation/embargo sequence licenses this map.
  // Keep the original annotation/rules rows visible as well as each local label.
  if(ranges.length===3&&/purge|净化|淨化/iu.test(items[1].heading)&&/validation|验证|驗證/iu.test(items[2].heading)&&/embargo|禁运|禁運/iu.test(items[3].heading)){
   ranges.forEach((range,i)=>{items[i+1].body=range;items[i+1].text+='\n'+range;endpointBindings.push({nodeId:items[i+1].sourceNodeId,range,annotationRow:6});});
  }
 }
 const edges=kind==='timeline'?items.slice(1).map((_,i)=>({from:i,to:i+1,sourceEdgeId:'row_order_'+i})):[];
 return {type:'list',content:{items,diagram:{version:1,kind,sourceUnitId:item.id,rowStart:start,rowEnd:end,headers:item.rows[0],sourceRows,relational:{version:1,nodeIds:items.map(i=>i.sourceNodeId),edges,...(kind==='symbolic-interval'?{intervalCount:item.diagramSource.intervalCount,endpointBindings,proportions:'schematic',axis:'source order; not causal or measured duration'}:{}),...(kind==='timeline'?{timestamps:sourceRows.map(r=>Date.parse(r.cells[0]))}:{}),...(lanes.length?{lanes,stages}:{})}}}};
}

function intervalPlan(content,geometry,fontSizePt,lineHeight=1.18){
 const {items,diagram}=content,count=diagram.relational.intervalCount;
 if(!Number.isInteger(count)||count<3||count>=items.length||diagram.rowStart!==1)return null;
 const width=geometry.width/INCH,height=geometry.height/INCH,gap=.16,boxes=[];
 // Schematic regions need room for their actual labels and endpoint tokens;
 // equal widths split VALIDATION and tau suffixes while wasting train space.
 // Width encodes text needs only, never source durations.
 const weights=items.slice(0,count).map(item=>Math.max(1,...[item.heading,item.body].flatMap(v=>String(v||'').split(/\s+/u)).map(word=>[...sourceRichText(word,{inline:true}).plainText].length)));
 const usable=width-gap*count,sum=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>usable*w/sum);
 const barHeight=Math.max(...items.slice(0,count).map((item,i)=>point.requiredHeight(item,Math.max(.01,widths[i]),fontSizePt,lineHeight)))+gap;
 let x=gap/2;for(let i=0;i<count;i++){boxes.push({x:x/width,y:gap/2/height,w:widths[i]/width,h:(barHeight-gap)/height});x+=widths[i]+gap;}
 let y=barHeight;
 for(const item of items.slice(count)){
  const h=point.requiredHeight(item,Math.max(.01,width-gap),fontSizePt,lineHeight)+gap;
  boxes.push({x:gap/2/width,y:(y+gap/2)/height,w:(width-gap)/width,h:(h-gap)/height});y+=h;
 }
 return {version:1,kind:'symbolic-interval',boxes,connectors:[],fontSizePt,lineHeight,headingScale:1,columns:count,inlineHeading:false,
  overflow:widths.some(w=>w<.6)||y>height,requiredHeight:Math.ceil(y*INCH),suggestedSplitCount:y>height?Math.ceil(y/height):1};
}

/** Two overlapping source windows and their shared-information explanation.
 * Offsets communicate overlap only; no dates, prices or durations are inferred. */
function overlapPlan(content,geometry,fontSizePt,lineHeight=1.18){
 const width=geometry.width/INCH,height=geometry.height/INCH,gap=.16,items=content.items;
 if(items.length!==3)return null;
 const widths=[width*.75,width*.75,width],needs=items.map((item,i)=>point.requiredHeight(item,Math.max(.01,widths[i]),fontSizePt,lineHeight));
 const tops=[0,needs[0]+gap,needs[0]+needs[1]+gap*2];
 const boxes=items.map((_,i)=>({x:i===1?.25:0,y:tops[i]/height,w:widths[i]/width,h:needs[i]/height}));
 const required= tops[2]+needs[2];
 const connectors=content.diagram.relational.edges.map(e=>{const a=boxes[e.from],b=boxes[e.to];const x=e.from===0?.1:.9;return {...e,points:[{x,y:a.y+a.h},{x,y:b.y}]};});
 return {version:1,kind:'overlap-windows',boxes,connectors,fontSizePt,lineHeight,columns:1,headingScale:1,inlineHeading:false,proportions:'schematic',overflow:width*.75<1.3||required>height,requiredHeight:Math.ceil(required*INCH)};
}
function cyclePlan(content,geometry,fontSizePt,lineHeight=1.18){
 const width=geometry.width/INCH,height=geometry.height/INCH,gap=.23,items=content.items;
 const cardWidth=width-gap*.8,needs=items.map(i=>point.requiredHeight(i,Math.max(.01,cardWidth),fontSizePt,lineHeight));
 let top=0;const boxes=needs.map(need=>{const box={x:0,y:top/height,w:cardWidth/width,h:need/height};top+=need+gap;return box;});
 const connectors=content.diagram.relational.edges.map(e=>{const a=boxes[e.from],b=boxes[e.to];return {...e,points:e.to===0?[{x:a.x+a.w,y:a.y+a.h/2},{x:1,y:a.y+a.h/2},{x:1,y:b.y+b.h/2},{x:b.x+b.w,y:b.y+b.h/2}]:[{x:.48,y:a.y+a.h},{x:.48,y:b.y}]};});
 return {version:1,kind:'cycle',boxes,connectors,fontSizePt,lineHeight,columns:1,headingScale:1,inlineHeading:false,overflow:cardWidth<1.3||top-gap>height,requiredHeight:Math.ceil((top-gap)*INCH)};
}

function parallelPlan(content,geometry,fontSizePt,lineHeight=1.18){
 const width=geometry.width/INCH,height=geometry.height/INCH,gap=.16,items=content.items;
 const attempts=[1,2,3].filter(columns=>columns<=items.length&&width/columns>=1.3).map(columns=>{
  const boxes=[];let y=0;
  for(let at=0;at<items.length;at+=columns){
   const row=items.slice(at,at+columns),cell=(width-gap*(row.length-1))/row.length;
   const need=Math.max(...row.map(item=>point.requiredHeight(item,cell,fontSizePt,lineHeight)));
   row.forEach((_,i)=>boxes.push({x:i*(cell+gap)/width,y:y/height,w:cell/width,h:need/height}));
   y+=need+(at+columns<items.length?gap:0);
  }
  return {version:1,kind:'card-grid',boxes,connectors:[],fontSizePt,lineHeight,columns,headingScale:1,inlineHeading:false,overflow:y>height,requiredHeight:Math.ceil(y*INCH),suggestedSplitCount:y>height?Math.ceil(y/height):1};
 });
 return attempts.sort((a,b)=>Number(a.overflow)-Number(b.overflow)||a.requiredHeight-b.requiredHeight)[0]||null;
}

function swimlaneGrid(items,relation,width,height,fontSizePt,horizontal,lineHeight){
 const lanes=relation.lanes,stages=relation.stages,gap=.28;
 if(!Array.isArray(lanes)||!lanes.length||!Array.isArray(stages)||!stages.length)return null;
 const cells=new Map();
 for(const [i,item]of items.entries()){
  if(!Number.isInteger(item.lane)||item.lane<0||item.lane>=lanes.length||!Number.isInteger(item.stage)||item.stage<0||item.stage>=stages.length)return null;
  const key=item.lane+':'+item.stage;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);
 }
 const columns=horizontal?lanes.length:stages.length,rows=horizontal?stages.length:lanes.length,boxes=Array(items.length);
 let requiredHeight=0,overflow=false;
 // Empty lane/stage intersections stay empty. Multiple source actions in one
 // intersection share that cell without inventing a causal order or message.
 for(let row=0;row<rows;row++){
  let rowNeed=0;
  for(let col=0;col<columns;col++){
   const indices=cells.get((horizontal?col:row)+':'+(horizontal?row:col))||[];
   const w=width/columns-gap,h=height/rows/Math.max(1,indices.length)-gap;
   let cellNeed=0;
   for(const [slot,i]of indices.entries()){
    const need=point.requiredHeight({heading:items[i].heading||'',body:items[i].body||''},Math.max(.01,w),fontSizePt,lineHeight);
    if(w<1.15||h<need)overflow=true;cellNeed=Math.max(cellNeed,need);
    boxes[i]={x:(col*width/columns+gap/2)/width,y:(row*height/rows+slot*height/rows/indices.length+gap/2)/height,w:w/width,h:h/height};
   }
   rowNeed=Math.max(rowNeed,indices.length*(cellNeed+gap));
  }
  requiredHeight=Math.max(requiredHeight,rows*rowNeed);
 }
 return {boxes,columns,overflow,requiredHeight};
}

export function relationalPlan(content,geometry,fontSizePt,{lineHeight=1.18}={}){
 const relation=content?.diagram?.relational;if(relation?.version!==1)return null;
 const items=content.items||[],count=items.length,edges=relation.edges||[];
 if(!Array.isArray(items)||!Array.isArray(edges)||!Array.isArray(relation.nodeIds))return null;
 if(!count||count>64||relation.nodeIds?.length!==count||new Set(relation.nodeIds).size!==count)return null;
 if(content.diagram.kind==='overlap-windows')return overlapPlan(content,geometry,fontSizePt,lineHeight);
 if(content.diagram.kind==='cycle')return cyclePlan(content,geometry,fontSizePt,lineHeight);
 if(content.diagram.kind==='card-grid')return edges.length?null:parallelPlan(content,geometry,fontSizePt,lineHeight);
 if(content.diagram.kind==='symbolic-interval')return edges.length?null:intervalPlan(content,geometry,fontSizePt,lineHeight);
 if(edges.some(e=>!Number.isInteger(e.from)||!Number.isInteger(e.to)||e.from<0||e.to<0||e.from>=count||e.to>=count||e.from===e.to)||new Set(edges.map(e=>e.from+':'+e.to)).size!==edges.length)return null;
 const incoming=Array(count).fill(0),ranks=Array(count).fill(0),queue=[];
 for(const e of edges)incoming[e.to]++;
 incoming.forEach((n,i)=>{if(!n)queue.push(i);});
 for(let at=0;at<queue.length;at++)for(const e of edges.filter(e=>e.from===queue[at])){ranks[e.to]=Math.max(ranks[e.to],ranks[e.from]+1);if(--incoming[e.to]===0)queue.push(e.to);}
 if(queue.length!==count)return null;
 const width=geometry.width/INCH,height=geometry.height/INCH,gap=Math.max(.2,fontSizePt/72);
 if(!(width>0&&height>0))return null;
 const attempts=[];
 for(const horizontal of [true,false]){
  const levels=[];
  if(content.diagram.kind==='swimlane'){
   for(let i=0;i<count;i++){const lane=items[i].lane;if(!Number.isInteger(lane)||lane<0||lane>=count)return null;(levels[lane]||=[]).push(i);}
  }else for(let i=0;i<count;i++)(levels[ranks[i]]||=[]).push(i);
  if(levels.some(l=>!l?.length))return null;
  const boxes=Array(count),step=(horizontal?width:height)/levels.length;
  let requiredHeight=0,maxNeed=0,overflow=false;
  const laneGrid=content.diagram.kind==='swimlane'?swimlaneGrid(items,relation,width,height,fontSizePt,horizontal,lineHeight):null;
  if(content.diagram.kind==='swimlane'&&!laneGrid)return null;
  if(laneGrid){boxes.splice(0,boxes.length,...laneGrid.boxes);requiredHeight=laneGrid.requiredHeight;overflow=laneGrid.overflow;}
  let levelTop=0;
  for(const [level,indices]of laneGrid?[]:levels.entries()){
   const cross=(horizontal?height:width)/indices.length;
   const verticalNeed=!horizontal&&content.diagram.kind!=='timeline'?Math.max(...indices.map(i=>point.requiredHeight(items[i],Math.max(.01,width/indices.length-gap),fontSizePt,lineHeight))):null;
   let levelNeed=0;
   for(const [order,i]of indices.entries()){
    const w=(horizontal?step:cross)-gap,h=verticalNeed??((horizontal?cross:step)-gap);
    const need=point.requiredHeight({heading:items[i].heading||'',body:items[i].body||''},Math.max(.01,w),fontSizePt,lineHeight);
    if(w<1.15||h<need)overflow=true;
    levelNeed=Math.max(levelNeed,need);maxNeed=Math.max(maxNeed,need);
    boxes[i]={x:((horizontal?level*step:order*cross)+gap/2)/width,y:((horizontal?order*cross:verticalNeed!==null?levelTop:level*step)+gap/2)/height,w:w/width,h:h/height};
   }
   if(horizontal)requiredHeight=Math.max(requiredHeight,indices.length*(levelNeed+gap));
   else if(verticalNeed!==null){levelTop+=verticalNeed+gap;requiredHeight=levelTop;if(levelTop>height)overflow=true;}
  }
  if(!horizontal&&!laneGrid&&content.diagram.kind==='timeline')requiredHeight=levels.length*(maxNeed+gap);
  if(content.diagram.kind==='timeline'){
   const times=relation.timestamps;if(!Array.isArray(times)||times.length!==count||!times.every(Number.isFinite)||!(times.at(-1)>times[0]))return null;
   for(let i=0;i<count;i++){
    const fraction=(times[i]-times[0])/(times.at(-1)-times[0]),box=boxes[i];
    if(horizontal)box.x=(1-box.w)*fraction;else box.y=(1-box.h)*fraction;
   }
   for(let i=1;i<count;i++)if(horizontal?boxes[i-1].x+boxes[i-1].w+gap/width>boxes[i].x:boxes[i-1].y+boxes[i-1].h+gap/height>boxes[i].y)overflow=true;
  }
  // Orthogonal routes join real boundaries and include row changes. Parallel
  // nodes share a rank instead of becoming an invented sequential chain.
  const connectors=edges.map(e=>{
   const a=boxes[e.from],b=boxes[e.to];let points;
   if(horizontal){const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2,mid=(x1+x2)/2;points=[{x:x1,y:y1},{x:mid,y:y1},{x:mid,y:y2},{x:x2,y:y2}];}
   else{const x1=a.x+a.w/2,y1=a.y+a.h,x2=b.x+b.w/2,y2=b.y,mid=(y1+y2)/2;points=[{x:x1,y:y1},{x:x1,y:mid},{x:x2,y:mid},{x:x2,y:y2}];}
   return {...e,points};
  });
  for(const edge of connectors)for(let at=1;at<edge.points.length;at++){
   const a=edge.points[at-1],b=edge.points[at];
   if(boxes.some((box,i)=>i!==edge.from&&i!==edge.to&&(a.x===b.x?a.x>box.x+1e-6&&a.x<box.x+box.w-1e-6&&Math.min(a.y,b.y)<box.y+box.h-1e-6&&Math.max(a.y,b.y)>box.y+1e-6:a.y>box.y+1e-6&&a.y<box.y+box.h-1e-6&&Math.min(a.x,b.x)<box.x+box.w-1e-6&&Math.max(a.x,b.x)>box.x+1e-6)))overflow=true;
  }
  attempts.push({version:1,kind:content.diagram.kind,boxes,connectors,fontSizePt,lineHeight,columns:laneGrid?.columns||(horizontal?levels.length:Math.max(...levels.map(l=>l.length))),headingScale:1,inlineHeading:false,overflow,requiredHeight:Math.ceil(requiredHeight*INCH),suggestedSplitCount:overflow?Math.max(2,Math.ceil(requiredHeight/height)):1});
 }
 return attempts.sort((a,b)=>Number(a.overflow)-Number(b.overflow)||a.requiredHeight-b.requiredHeight)[0];
}

export function relationalCoverage(item,node){
 const d=node.content?.diagram,r=d?.relational;
 if(!r)return null;
 if(d.sourceUnitId!==item.id||!Array.isArray(d.sourceRows)||!d.sourceRows.length||!Array.isArray(r.edges)||!Array.isArray(r.nodeIds)||!Array.isArray(node.content?.items))return {complete:false,rows:[]};
 const items=node.content.items||[],graph=item.diagramSource?.graph;
 if(items.some(i=>!i||typeof i!=='object'))return {complete:false,rows:[]};
 if(graph){
  if(items.some(i=>i.headingRich&&sourceRichText(String(i.heading||''),{inline:true}).plainText!==i.headingRich.plainText||i.bodyRich&&sourceRichText(String(i.body||''),{inline:true}).plainText!==i.bodyRich.plainText))return {complete:false,rows:[]};
  const projected=(id,label,body)=>{const heading=sourceRichText(String(label||''),{inline:true}),explanation=sourceRichText(String(body||''),{inline:true});return {id,label:heading.plainText,body:explanation.plainText.split('\n').filter(Boolean),math:[...heading.runs,...explanation.runs].filter(run=>run.kind==='math').map(run=>run.mathKey)};};
  const shown=items.map(i=>projected(i.sourceNodeId,i.headingRich?.source??i.heading,i.bodyRich?.source??i.body));
  if(!validGraphProjection(item)||r.sourceGraphHash!==digest(graph))return {complete:false,rows:[]};
  if(r.part||d.rowStart!==1||d.rowEnd!==item.rows?.length){
   // A part must equal the part rebuilt from the source: its own nodes, one
   // continuation card per linked node, every edge touching its own nodes.
   const expected=relationalComponent(item,d.rowStart,d.rowEnd)?.content,x=expected?.diagram.relational,pairs=(edges,ids)=>edges.map(e=>[ids[e.from],ids[e.to],e.sourceEdgeId]).sort();
   if(!x?.part||digest(shown)!==digest(expected.items.map(i=>projected(i.sourceNodeId,i.heading,i.body)))||digest(r.nodeIds)!==digest(x.nodeIds)||digest(pairs(r.edges,r.nodeIds))!==digest(pairs(x.edges,x.nodeIds))||digest(r.part)!==digest(x.part)||digest(d.sourceRows.map(s=>s.row))!==digest(expected.diagram.sourceRows.map(s=>s.row)))return {complete:false,rows:[]};
  }else{
   if(digest(shown)!==digest(graph.nodes.map(n=>projected(n.id,n.label,(n.body||[]).join('\n')))))return {complete:false,rows:[]};
   const ids=graph.nodes.map(n=>n.id),expected=graph.edges.map(e=>[e.from,e.to]).sort(),actual=r.edges.map(e=>[ids[e.from],ids[e.to]]).sort();
   if(digest(expected)!==digest(actual)||digest(r.nodeIds)!==digest(ids))return {complete:false,rows:[]};
  }
 }
 const rows=d.sourceRows;
 if(rows.some(({row,cells})=>digest(cells)!==digest(item.rows?.[row])))return {complete:false,rows:[]};
 if(!graph){
  if(tableRelationKind(item)!==d.kind)return {complete:false,rows:[]};
  const expected=tableRelationComponent(item,d.kind,d.rowStart,d.rowEnd).content;
  const display=list=>list.map(i=>({sourceNodeId:i.sourceNodeId,heading:sourceRichText(String(i.heading||'')).plainText,body:sourceRichText(String(i.body||'')).plainText,text:sourceRichText(String(i.text||'')).plainText,...(i.lane===undefined?{}:{lane:i.lane,stage:i.stage})}));
  if(digest(display(items))!==digest(display(expected.items))||digest(r)!==digest(expected.diagram.relational))return {complete:false,rows:[]};
 }
 return {complete:true,rows:rows.map(r=>r.row),relationIds:r.edges.map(e=>e.sourceEdgeId)};
}
