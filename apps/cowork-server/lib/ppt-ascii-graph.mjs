import {validProseProjection}from'./ppt-prose-media.mjs';
import crypto from 'node:crypto';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Conservative, source-positioned ASCII projection. Unsupported geometry stays literal.
const decor=/[┌┐└┘├┤┬┴┼│─═║╔╗╚╝╦╩╠╣╬↓↑→←⇒▼▲↙↘]/u;
function labelContact(lines,n,q){
 const ports={top:/[│║└┘├┤┴┼╚╝╠╣╩╬↓↑▼▲↙↘]/u,bottom:/[│║┌┐├┤┬┼╔╗╠╣╦╬↓↑▼▲↙↘]/u,left:/[─═┐┘┤┬┴┼╗╝╣╦╩╬→←⇒]/u,right:/[─═┌└├┬┴┼╔╚╠╦╩╬→←⇒]/u};
 const horizontal=(a,b)=>/^\s*$/u.test(lines[q.y].slice(a,b));
 const vertical=(a,b)=>lines.slice(a,b).every(line=>!line[q.x]||/\s/u.test(line[q.x]));
 if(q.y>=n.y&&q.y<=n.bottom){
  if(q.x<n.x&&n.x-q.x<=3&&ports.right.test(q.c)&&horizontal(q.x+1,n.x))return 'left';
  if(q.x>n.right&&q.x-n.right<=3&&ports.left.test(q.c)&&horizontal(n.right+1,q.x))return 'right';
 }
 if(q.x>=n.x-(n.boxed?0:1)&&q.x<=n.right+(n.boxed?0:1)){
  if(q.y<n.y&&n.y-q.y<=2&&ports.bottom.test(q.c)&&vertical(q.y+1,n.y))return 'top';
  if(q.y>n.bottom&&q.y-n.bottom<=2&&ports.top.test(q.c)&&vertical(n.bottom+1,q.y))return 'bottom';
 }
 return null;
}
export function parseBoxGraph(raw,{parserVersion=2}={}){
 if(String(raw).length>30000)return {supported:false,reason:'graph exceeds parser budget'};
 const lines=String(raw).split('\n'),nodes=[],mask=new Set(),key=(x,y)=>x+','+y;
 for(let y=0;y<lines.length;y++)for(const top of lines[y].matchAll(/[┌╔][─═┬┴┼╦╩]+[┐╗]/gu)){
  const x=top.index,right=x+top[0].length-1;let bottom=-1;
  for(let yy=y+1;yy<lines.length;yy++){const tail=lines[yy].slice(x).match(/^[└╚][─═┬┴┼╦╩]+[┘╝]/u);if(tail){bottom=yy;break;}if(lines[yy][x]==='┌')break;}
  if(bottom<0)continue;
  const parts=[],spans=[];
  for(let yy=y+1;yy<bottom;yy++){const cells=[...lines[yy].matchAll(/[│║]([^│║]*)[│║]/gu)],cell=cells.find(c=>Math.abs(c.index-x)<=1);if(cell&&cell[1].trim()){parts.push(cell[1].trim());spans.push({line:yy,start:cell.index+1,end:cell.index+cell[0].length-1});}}
  if(!parts.length)continue;
  const node={id:'g'+nodes.length,x,y,right,bottom,label:parts[0],body:parts.slice(1),sourceSpans:spans,boxed:true};nodes.push(node);
  for(let yy=y;yy<=bottom;yy++)for(let xx=x;xx<=right;xx++)mask.add(key(xx,yy));
 }
 let zone=0,lastBox=false;const free=[];
 for(let y=0;y<lines.length;y++){
  const hasBox=nodes.some(n=>n.boxed&&n.y<=y&&n.bottom>=y);if(hasBox&&!lastBox)zone++;if(!hasBox&&lastBox)zone++;lastBox=hasBox;
  let line=[...lines[y]].map((c,x)=>mask.has(key(x,y))||parserVersion>=2&&decor.test(c)?' ':c).join('');
  for(const m of line.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/gu)){
   if(!/[\p{L}\p{N}]/u.test(m[0]))continue;
   if(parserVersion<2&&/[├┤]/u.test(m[0]))return {supported:false,reason:'free branch labels require an explicit tree parser'};
   let n=free.find(n=>n.zone===zone&&Math.abs(n.anchor-m.index)<=8&&y-n.bottom<=4&&(parserVersion<2||!decor.test(lines[y])&&!lines.slice(n.bottom+1,y).some(line=>decor.test(line))));
   if(!n){n={id:'g'+(nodes.length+free.length),x:m.index,y,right:m.index+m[0].length-1,bottom:y,anchor:m.index,label:m[0],body:[],sourceSpans:[],zone,boxed:false};free.push(n);}else{n.body.push(m[0]);n.x=Math.min(n.x,m.index);n.right=Math.max(n.right,m.index+m[0].length-1);n.bottom=y;}
   n.sourceSpans.push({line:y,start:m.index,end:m.index+m[0].length});
  }
 }
 nodes.push(...free);
 for(const n of free)for(let y=n.y;y<=n.bottom;y++)for(let x=n.x;x<=n.right;x++)mask.add(key(x,y));
 const points=new Map();for(let y=0;y<lines.length;y++)for(let x=0;x<lines[y].length;x++)if(!mask.has(key(x,y))&&decor.test(lines[y][x]))points.set(key(x,y),{x,y,c:lines[y][x]});
 const seen=new Set(),components=[],edges=[],unresolved=[];
 for(const [k,p]of points){if(seen.has(k))continue;const queue=[p],group=[];seen.add(k);
  for(let at=0;at<queue.length;at++){let q=queue[at];group.push(q);for(let [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){let kk=key(q.x+dx,q.y+dy);if(points.has(kk)&&!seen.has(kk)){seen.add(kk);queue.push(points.get(kk));}}}
  const contacts=[];for(const n of nodes)for(const q of group){let side=parserVersion>=2?labelContact(lines,n,q):q.y===n.y-1&&q.x>=n.x&&q.x<=n.right?'top':q.y===n.bottom+1&&q.x>=n.x&&q.x<=n.right?'bottom':q.x===n.x-1&&q.y>=n.y&&q.y<=n.bottom?'left':q.x===n.right+1&&q.y>=n.y&&q.y<=n.bottom?'right':null;if(side&&!contacts.some(c=>c.id===n.id&&c.side===side))contacts.push({id:n.id,side});}
  // An isolated downward arrow may point at a single following level even
  // when the source's text was not exactly centred under its arrow column.
  // Competing labels never receive this fallback; semantics is audited later.
  if(parserVersion>=2&&group.length===1&&/[↓↙↘]/u.test(group[0].c)&&!contacts.some(c=>c.side==='top')){
   const q=group[0],below=nodes.filter(n=>!n.boxed&&n.y>q.y&&n.y-q.y<=2),level=Math.min(Infinity,...below.map(n=>n.y)),targets=below.filter(n=>n.y===level);
   if(targets.length===1)contacts.push({id:targets[0].id,side:'top'});
  }
  const from=contacts.filter(c=>['bottom','right'].includes(c.side)),to=contacts.filter(c=>['top','left'].includes(c.side));
  const record={points:group,contacts};components.push(record);
  const tree=parserVersion>=2&&group.some(p=>/[├└╠╚]/u.test(p.c))&&from.every(c=>c.side==='bottom')&&to.every(c=>c.side==='left');
  const vertical=parserVersion>=2&&group.every(p=>/[│║]/u.test(p.c))&&from.length===1&&to.length===1&&from[0].side==='bottom'&&to[0].side==='top';
  if(!from.length||!to.length||!group.some(p=>/[↓→⇒▼↙↘]/u.test(p.c))&&!tree&&!vertical||group.some(p=>/[↑←▲]/u.test(p.c))||group.some(p=>/[→⇒]/u.test(p.c))&&(!from.some(c=>c.side==='right')||!to.some(c=>c.side==='left'))){unresolved.push({contacts,points:group});continue;}
  for(const a of from)for(const b of to)if(a.id!==b.id)edges.push({from:a.id,to:b.id,sourceConnectorIndex:components.length-1});
 }
 const original=lines.join('\n').replace(/[\s┌┐└┘├┤┬┴┼│─═║╔╗╚╝╦╩╠╣╬↓↑→←⇒▼▲↙↘]/gu,'');
 const accounted=nodes.flatMap(n=>n.sourceSpans.map(s=>({s,text:lines[s.line].slice(s.start,s.end)}))).sort((a,b)=>a.s.line-b.s.line||a.s.start-b.s.start).map(x=>x.text).join('').replace(/[\s┌┐└┘├┤┬┴┼│─═║╔╗╚╝╦╩╠╣╬↓↑→←⇒▼▲↙↘]/gu,'');
 return {supported:nodes.length<=64&&original===accounted&&!unresolved.length&&edges.length>0&&new Set(edges.map(e=>e.from+':'+e.to)).size===edges.length&&nodes.every(n=>edges.some(e=>e.from===n.id||e.to===n.id)),labelsComplete:original===accounted,nodes,edges,unresolved,componentCount:components.length};
}

/** Relation records are native editable table cells, not raw drawing lines.
 * Every source label and directed branch is preserved; IDs never reach slides. */
export function asciiGraphProjection(raw,{parserVersion=2}={}){
 const parsed=parseBoxGraph(raw,{parserVersion});if(!parsed.supported)return null;
 const names=new Map();for(const node of parsed.nodes){const key=node.label.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ');names.set(key,[...(names.get(key)||[]),node]);}
 const context=new Set();
 for(const duplicates of names.values())if(duplicates.length>1){
  if(parserVersion<2)return null;
  const signature=n=>digest({parents:parsed.edges.filter(e=>e.to===n.id).map(e=>e.from).sort(),body:n.body});
  if(duplicates.some(n=>parsed.edges.some(e=>e.from===n.id))||new Set(duplicates.map(signature)).size!==1)duplicates.forEach(n=>context.add(n.id));
 }
 const display=new Map(),nodeById=new Map(parsed.nodes.map(n=>[n.id,n]));
 function label(n,seen=new Set()){
  if(display.has(n.id))return display.get(n.id);if(seen.has(n.id))return null;
  seen=new Set([...seen,n.id]);
  const parents=context.has(n.id)?parsed.edges.filter(e=>e.to===n.id).map(e=>label(nodeById.get(e.from),seen)):[];
  if(context.has(n.id)&&(!parents.length||parents.some(p=>!p)))return null;
  const value=parents.length?[...new Set(parents)].join(' + ')+' / '+n.label:n.label;display.set(n.id,value);return value;
 }
 if(parsed.nodes.some(n=>!label(n)))return null;
 for(const duplicates of names.values())if(duplicates.some(n=>context.has(n.id))&&new Set(duplicates.map(n=>display.get(n.id))).size!==duplicates.length)return null;
 const nodes=[...parsed.nodes].sort((a,b)=>a.y-b.y||a.x-b.x),byId=new Map(nodes.map(n=>[n.id,n]));
 const compact=parserVersion>=2&&nodes.every(n=>!n.body.length);
 const rows=[compact?['Component','Next component']:['Component','Responsibility / output','Next component'],...(compact?nodes.filter(n=>parsed.edges.some(e=>e.from===n.id)):nodes).map(n=>[display.get(n.id),...(compact?[]:[n.body.join('\n')]),parsed.edges.filter(e=>e.from===n.id).map(e=>'→ '+display.get(e.to)).join(compact?'; ':'\n')])];
 const graph={version:1,...(parserVersion>=2?{parserVersion}:{}),basis:parserVersion>=2?'source-positioned-labels-and-connectors':'source-positioned-boxes-and-arrow-components',sourceHash:digest(String(raw)),nodes:nodes.map(({id,label,body,sourceSpans})=>({id,label,body,sourceSpans})),edges:parsed.edges.map(({from,to,sourceConnectorIndex})=>({from,to,sourceConnectorIndex})),labelsComplete:true,unresolvedConnectors:0,rowsHash:digest(rows)};
 return {rows,graph};
}
export function graphProjectionIdentity(item){return digest({source:item.diagramSource?.text,graph:item.diagramSource?.graph,rows:item.rows});}
const validationCache=new Map();
export function validGraphProjection(item){
 if(item.diagramSource?.presentation!=='semantic_graph_rows')return true;
 if(item.diagramSource.kind==='prose')return validProseProjection(item);
 const identity=graphProjectionIdentity(item);if(validationCache.has(identity))return validationCache.get(identity);
 const expected=asciiGraphProjection(item.diagramSource.text,{parserVersion:item.diagramSource.graph?.parserVersion||1});
 const valid=Boolean(expected&&digest(expected.graph)===digest(item.diagramSource.graph)&&digest(expected.rows)===digest(item.rows));
 if(validationCache.size>=24)validationCache.delete(validationCache.keys().next().value);validationCache.set(identity,valid);return valid;
}
export function diagramTopicLabel(item,value){
 const text=String(value||'');return item?.diagramSource?text.replace(/[┌┐└┘├┤┬┴┼│─═║╔╗╚╝╦╩╠╣╬]/gu,'').trim():text;
}
