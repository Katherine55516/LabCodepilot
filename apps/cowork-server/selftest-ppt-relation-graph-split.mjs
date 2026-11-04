import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {normalizePaste} from './lib/ppt-source.mjs';
import {relationalComponent,relationalPlan,relationalCoverage,relationalTableComponent,graphNodeRows} from './lib/ppt-relational-diagram.mjs';
import {diagramCoverage} from './lib/ppt-diagram-cards.mjs';
import {contentCanvas} from './lib/ppt-density-capacity.mjs';
import {sourceMediaTasks,sourceMediaReceipts} from './lib/ppt-source-media-tasks.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {inspectFrozenOutlineSources} from './lib/ppt-outline-source-fit.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {proseMediaItem} from './lib/ppt-prose-media.mjs';
import {auditSourceGraphs} from './test/ppt-graph-audit-fixture.mjs';
import {renderPptx} from './lib/ppt-render.mjs';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';

// Two oversized source graphs shaped like gamma.md b_0017 (a 17-node layered
// architecture with forks and joins) and b_0061 (a compact chain that fans out
// to five leaves, which own no table row of their own).
const ARCHITECTURE="┌─────────────────────────────────────────────────────┐\n│                  USER EXPERIENCE                    │\n│ Prompt / Upload / Paste / Import / Template / Chat │\n└──────────────────────────┬──────────────────────────┘\n                           ↓\n┌─────────────────────────────────────────────────────┐\n│             1. INPUT NORMALIZATION LAYER            │\n│ prompt / files / URLs / connectors / existing deck │\n│                ↓ normalized context                 │\n└──────────────────────────┬──────────────────────────┘\n                           ↓\n┌─────────────────────────────────────────────────────┐\n│            2. INTENT / BRIEF AGENT                  │\n│ goal → audience → message → tone → format → style  │\n│                ↓ presentation brief                 │\n└──────────────────────────┬──────────────────────────┘\n                           ↓\n┌─────────────────────────────────────────────────────┐\n│             3. STORY PLANNING ENGINE                │\n│ outline / sections / slide roles / narrative arc   │\n│                ↓ semantic slide plan                │\n└──────────────────────────┬──────────────────────────┘\n                           ↓\n              ┌────────────┴────────────┐\n              ↓                         ↓\n┌────────────────────────┐ ┌──────────────────────────┐\n│ 4A. RESEARCH PIPELINE  │ │ 4B. CONTENT PIPELINE    │\n│ search / sources       │ │ writing / summarizing   │\n│ citations / retrieval  │ │ rewriting / expansion   │\n└────────────┬───────────┘ └────────────┬─────────────┘\n             └─────────────┬────────────┘\n                           ↓\n┌─────────────────────────────────────────────────────┐\n│          5. STRUCTURED CONTENT / CARD IR            │\n│ role / title / body / data / media / hierarchy     │\n│ layout constraints / semantic type                  │\n└──────────────────────────┬──────────────────────────┘\n                           ↓\n       ┌───────────────────┼─────────────────────┐\n       ↓                   ↓                     ↓\n Layout Engine       Theme Engine          Media Engine\n       ↓                   ↓                     ↓\n smart layout         typography          AI image\n responsive grid      colors              stock/web\n components           spacing             icons/media\n       └───────────────────┼─────────────────────┘\n                           ↓\n┌─────────────────────────────────────────────────────┐\n│          7. DETERMINISTIC DESIGN ENGINE             │\n│ components + constraints + responsive reflow       │\n│             NOT pixel-by-pixel LLM design          │\n└──────────────────────────┬──────────────────────────┘\n                           ↓\n┌─────────────────────────────────────────────────────┐\n│                8. WEB RENDERER                      │\n│ React / Next.js / Gamma-native document model      │\n└─────────────┬─────────────────┬─────────────────────┘\n              ↓                 ↓\n        Live Gamma          Export layer\n                            PPTX / PDF / PNG";
const WORKERS="Frontend\n   ↓\nGeneration API\n   ↓\nJob\n   ↓\nEvent / Queue Infrastructure\n   ↓\nWorkers\n ├─ content\n ├─ layout\n ├─ image\n ├─ export\n └─ analytics";
const graphOf=text=>{const source=normalizePaste('# Graph\n\n```text\n'+text+'\n```');return {source,item:source.semantic.inventory.items.find(i=>i.diagramSource?.graph)};};
const INCH=914400;

/** Every node is owned by exactly one part, every source edge is drawn in each
 * part that owns one of its ends, and continuation cards name the other end. */
function assertParts(item,ranges){
 const graph=item.diagramSource.graph,owners=new Map(),drawn=new Map(),rows=graphNodeRows(item);
 const parts=ranges.map(([start,end])=>{
  const component=relationalComponent(item,start,end);assert.ok(component,`rows ${start}-${end} form a part`);
  const {items,diagram}=component.content,r=diagram.relational;
  assert.equal(component.type,'list');assert.ok(r.part,'a row range is a relation-diagram part, not a table');
  assert.deepEqual([diagram.rowStart,diagram.rowEnd],[start,end]);
  for(const id of r.part.nodeIds){assert.ok(!owners.has(id),'node '+id+' has one owner');owners.set(id,start);}
  for(const e of r.edges)drawn.set(e.sourceEdgeId,(drawn.get(e.sourceEdgeId)||0)+1);
  for(const card of items.filter(i=>i.continuation)){
   const node=graph.nodes.find(n=>n.id===card.sourceNodeId);assert.ok(node&&!r.part.nodeIds.includes(node.id));
   assert.equal(card.heading,card.continuation.direction==='next'?'→ '+node.label:node.label+' →','continuation card keeps the exact source label');
   assert.equal(card.continuation.direction,rows.get(node.id)<start?'previous':'next');
  }
  assert.equal(diagramCoverage(item,{content:component.content}).complete,true,'part matches its source rows, nodes and edges');
  return component;
 });
 assert.equal(owners.size,graph.nodes.length,'all nodes visible once as owned nodes');
 graph.edges.forEach((e,i)=>{const crossing=owners.get(e.from)!==owners.get(e.to);assert.equal(drawn.get('edge_'+i),crossing?2:1,`edge ${e.from}->${e.to} shown ${crossing?'on both parts':'once'}`);});
 const covered=parts.flatMap(p=>diagramCoverage(item,{content:p.content}).rows);
 assert.deepEqual(covered,Array.from({length:item.rows.length-1},(_,i)=>i+1),'parts cover every data row once, in order');
 return parts;
}

const arch=graphOf(ARCHITECTURE),workers=graphOf(WORKERS);
assert.equal(arch.item.diagramSource.graph.nodes.length,17);assert.equal(workers.item.diagramSource.graph.nodes.length,10);
assert.equal(workers.item.rows[0].length,2,'compact projection: leaves own no row');
assert.deepEqual([...new Set([...graphNodeRows(workers.item)].filter(([id])=>/^g[5-9]$/u.test(id)).map(([,row])=>row))],[5],'leaves follow their parent row');
const archParts=assertParts(arch.item,[[1,5],[5,7],[7,11],[11,14],[14,18]]);
assertParts(workers.item,[[1,5],[5,6]]);
assertParts(workers.item,[[1,2],[2,4],[4,6]]);
assert.equal(relationalComponent(arch.item).content.diagram.relational.part,undefined,'the complete graph is unchanged');

// Tampered parts are rejected.
for(const mutate of [c=>c.content.items.pop(),c=>c.content.items[0].heading='Invented',c=>c.content.diagram.relational.edges.pop(),c=>{c.content.diagram.relational.part.rowEnd++;},c=>c.content.items.splice(c.content.items.findIndex(i=>i.continuation),1)]){
 const broken=structuredClone(archParts[1]);mutate(broken);assert.equal(relationalCoverage(arch.item,broken).complete,false,'changed part is incomplete');
}
// Ring layouts need every node: a partial cycle keeps its table (and the gate).
const text='Train on the past. Validate parameters. Test on a forward window. Then advance the clock and repeat for out-of-sample predictions.',evidence={start:0,end:text.length,quote:text};
const ring=proseMediaItem({id:'p',type:'ProcessBlock',text,sectionPath:['Method']},{kind:'cycle',nodes:[{id:'train',label:'Train',body:'Train on the past.',evidence},{id:'validate',label:'Validate',body:'Validate parameters.',evidence},{id:'test',label:'Test',body:'Test on a forward window.',evidence},{id:'repeat',label:'advance the clock',body:'Then advance the clock and repeat for out-of-sample predictions.',evidence}],edges:[{from:'train',to:'validate',evidence},{from:'validate',to:'test',evidence},{from:'test',to:'repeat',evidence},{from:'repeat',to:'train',evidence}]},'cycle');
assert.equal(relationalComponent(ring).content.diagram.kind,'cycle');assert.equal(relationalComponent(ring,1,3),null,'a partial ring keeps its table, so the gate still blocks it');

// Actual binding, outline gates, receipts, render tree and object integrity.
function project(graph,ranges,{order}={}){
 const pages=ranges.map(([start,end],k)=>({id:'part'+k,title:'Part '+(k+1),ref:{sourceUnitId:graph.item.id,...(start===1&&end===graph.item.rows.length?{}:{rowStart:start,rowEnd:end})}}));
 const body=order?order.map(k=>pages[k]):pages,outline=[{id:'cover',title:'Graph'},...body.map(({id,title})=>({id,title,sourceUnitIds:[graph.item.id]})),{id:'end',title:'Summary'}];
 const p={id:'graph-split',pages:outline.length,source:graph.source,template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),generationPolicy:{version:2,content:'overview',knowledge:'source_only',sourceTypography:'bounded',language:{mode:'source',body:'both'}},outline,deck:{slides:outline.map(s=>({id:s.id,title:s.title,nodes:[]}))},revision:1};
 p.planning={slidePlan:outline.map(s=>{const page=body.find(b=>b.id===s.id),plan={slideId:s.id,sourceArtifacts:page?[page.ref]:[]};return {...plan,mediaTasks:sourceMediaTasks(p.source,plan)};})};
 return p;
}
const canvas=contentCanvas(project(arch,[[1,18]]),1);
assert.equal(relationalPlan(relationalComponent(arch.item).content,canvas.geometry,14).overflow,true,'the complete architecture cannot fit one light page even at 14pt');
const whole=inspectFrozenOutlineSources(project(arch,[[1,18]]));
assert.ok(whole.some(i=>i.pageIndex===1&&['planned_frozen_source_capacity','planned_source_media_layout'].includes(i.code)),'whole oversized graph still blocks');
const split=project(arch,[[1,5],[5,7],[7,11],[11,14],[14,18]]);
// The controlled architecture fixture keeps every box, fork and join.
auditSourceGraphs(split);
assert.deepEqual(inspectFrozenOutlineSources(split),[],'consecutive necessary parts pass the frozen-source gate');
split.deck.slides.slice(1,-1).forEach((slide,k)=>{bindSourceArtifacts(split,slide,split.planning.slidePlan[k+1].sourceArtifacts,k+1);
 assert.ok(slide.mediaTasks.length&&slide.mediaTasks.every(t=>t.required&&t.representationFulfilled),'each part fulfils the required relation media');});
assert.deepEqual(inspectObjectIntegrity(split).issues,[],'parts together carry every source row once');
const scene=buildRenderTree(split);
split.deck.slides.slice(1,-1).forEach((_,k)=>{const element=scene.slides[k+1].elements.find(e=>e.content?.diagram?.relational?.part);assert.ok(element,'part '+k+' renders as a relation diagram');assert.equal(element.content.pointLayout.connectors.length,element.content.diagram.relational.edges.length,'every part edge has a routed connector');assert.equal(element.content.pointLayout.overflow,false);});
// Native export: the verifier accepts every part's relation segments and routes.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-graph-split-'));
try{
 split.pageDecision={mode:'explicit',finalPageCount:split.pages};
 const result=await renderPptx({...split,renderTree:scene},localPptRuntime(root).io);assert.equal(result.exportVerification.status,'passed','native export verification accepts the parts');
 const probe=JSON.parse(execFileSync(process.env.PPT_TEST_PYTHON||'python3',['-I','-c',`import sys,json
from pptx import Presentation
p=Presentation(sys.argv[1]);flows=[];text=[]
for s in p.slides:
 for sh in s.shapes:
  if sh.name.startswith('AIMate decor:flow:'):flows.append(':'.join(sh.name.split(':')[2:-1]))
  if sh.has_text_frame:text.append(sh.text)
print(json.dumps({'flows':sorted(set(flows)),'text':'\\n'.join(text)}))`,path.join(root,split.id,'presentation.pptx')],{encoding:'utf8'}));
 const partEdges=scene.slides.flatMap(slide=>slide.elements.filter(e=>e.content?.diagram?.relational?.part).flatMap(e=>e.content.diagram.relational.edges.map(edge=>e.id+':'+edge.sourceEdgeId)));
 assert.equal(probe.flows.length,partEdges.length,'every part edge is a native connector');
 for(const n of arch.item.diagramSource.graph.nodes)assert.ok(probe.text.includes(n.label),'native label '+n.label);
}finally{fs.rmSync(root,{recursive:true,force:true});}
const shuffled=inspectFrozenOutlineSources(project(arch,[[1,5],[5,7],[7,11],[11,14],[14,18]],{order:[0,2,1,3,4]}));
assert.ok(shuffled.some(i=>i.code==='planned_source_graph_split_order'),'parts out of row order are blocked');
const small=graphOf('Plan\n   ↓\nWrite\n   ↓\nReview\n ├─ Accept\n └─ Revise');assert.ok(small.item&&small.item.rows.length>=3);
const unneeded=inspectFrozenOutlineSources(project(small,[[1,2],[2,small.item.rows.length]]));
assert.ok(unneeded.some(i=>i.code==='planned_source_graph_split_unneeded'),'a graph that fits one page stays whole');
// The table fallback still does not fulfil a required relation diagram.
const tableOnly=split.deck.slides[1].sourceArtifactNodes.map(n=>relationalTableComponent(n)||n);
const receipts=sourceMediaReceipts(split,{...split.deck.slides[1],sourceArtifactNodes:tableOnly});
assert.ok(receipts.length&&receipts.every(t=>t.representationFulfilled===false),'a part rendered as a table does not fulfil the relation media');
console.log('PASS oversized relation graphs split into consecutive relation-diagram parts: every node owned once, every edge visible, continuation cards exact, gates and integrity hold');
