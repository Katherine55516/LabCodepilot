import assert from 'node:assert/strict';
import {normalizePaste} from './lib/ppt-source.mjs';
import {validateUnderstanding,understandingIdentity,inputReadManifest,prepareInputUnderstanding} from './lib/ppt-input-understanding.mjs';
import {globalOutlinePlan} from './lib/ppt-global-outline-plan.mjs';
import {normalizePageContract,pageContractFor,inspectPageContracts} from './lib/ppt-page-contract.mjs';
import {relationalComponent,relationalPlan,relationalCoverage,tableRelationKind,tableRelationComponent} from './lib/ppt-relational-diagram.mjs';
import {sourceComponent,fitComponents,contentCanvas} from './lib/ppt-density-capacity.mjs';
import {diagramCoverage} from './lib/ppt-diagram-cards.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';
import {slideSvg} from './lib/ppt/exporters/preview.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {auditSourceGraphs} from './test/ppt-graph-audit-fixture.mjs';

const input='# Full reading\n\n'+('A complete paragraph with its condition.\n\n'.repeat(1700))+'## Final constraint\n\nNever remove the final branch.';
const p={pages:6,generationPolicy:{version:2,content:'overview',language:{mode:'source'}},source:normalizePaste(input)};
const ids=p.source.semantic.inventory.items.map(i=>i.id),raw={version:1,subject:'Complete reading',primaryLanguage:'en',groups:[{question:'Which constraints apply?',coreMessage:'The final constraint remains part of the reading.',sourceUnitIds:ids,relations:['condition']}],recommended:6,min:5,max:8,reason:'One complete reading, not a character count.'};
let delivered;
await prepareInputUnderstanding(p,async prompt=>{delivered=JSON.parse(prompt.match(/<input>(.*?)<\/input>/su)[1]);assert.equal(delivered.completeInput,input,'actual reader packet includes the final source constraint');return raw;});
const read=p.inputUnderstanding,m=read.readManifest;
assert.throws(()=>inputReadManifest(p,read,{completeInput:input.slice(0,100),sourceUnitIds:ids}),/Reader delivery omitted/);
assert.equal(m.inputCharacters,input.length);assert.deepEqual(m.passes[0].characterRange,{start:0,end:input.length});assert.deepEqual(m.unresolvedUnitIds,[]);assert.deepEqual(m.acknowledgedUnitIds,ids);
const old=understandingIdentity(p),changed=structuredClone(p);changed.source.semantic.inventory.items[0].text+=' Changed structure.';assert.notEqual(understandingIdentity(changed),old,'parsed source changes invalidate the read cache');
const missing=structuredClone(raw);missing.groups[0].sourceUnitIds.pop();assert.throws(()=>validateUnderstanding(p,missing),/unread source units/);
assert.equal(globalOutlinePlan(p).bodyPageEstimate,6,'no unplanned two-page reservation');
assert.equal(globalOutlinePlan({...p,inputUnderstanding:read}).version,2,'validated reader groups bypass character-weight fallback');
assert.equal(globalOutlinePlan({...p,outline:[{role:'cover',sourceUnitIds:[]},{role:'closing',sourceUnitIds:[ids[0]]}]}).bodyPageEstimate,5,'a substantive closing still owns content');

const inventory={items:[{id:'a',type:'MechanismBlock',text:'A condition applies.'}],relationships:Array.from({length:15},(_,i)=>({id:'r'+i,type:'support',unitIds:['a']}))};
const source={semantic:{inventory}},contract=normalizePageContract({requiredRelations:inventory.relationships.map(r=>r.id)},source);assert.equal(contract.requiredRelations.length,15);
assert.equal(normalizePageContract({adjacencyPairs:'invalid'},source).invalidReferences[0].field,'adjacencyPairs');
const bad=pageContractFor({sourceUnitIds:['a'],pageContract:{requiredRelations:['missing']}},source,'mechanism');
assert.ok(bad.invalidReferences.length);assert.ok(inspectPageContracts({source,planning:{slidePlan:[{slideId:'s',pageContract:bad}]}},[{id:'s',nodes:[]}]).some(i=>i.code==='page_contract_reference_invalid'));

const tree='Card\n ├─ Header\n ├─ Text\n ├─ Columns\n │   ├─ Block\n │   └─ Detail\n ├─ Image\n └─ Footer';
const graphSource=normalizePaste('# Card structure\n\n```text\n'+tree+'\n```'),item=graphSource.semantic.inventory.items.find(i=>i.diagramSource?.graph);
assert.ok(item);const component=sourceComponent(item);assert.ok(component.content.diagram.relational);assert.equal(component.type,'list');
const frame={x:914400,y:1600000,width:10500000,height:4400000},plan=relationalPlan(component.content,frame,18);
assert.equal(plan.overflow,false);assert.equal(plan.connectors.length,item.diagramSource.graph.edges.length);assert.ok(plan.connectors.every(c=>c.points.length===4));
const node={...component,geometry:frame,content:{...component.content,pointLayout:plan}};assert.equal(diagramCoverage(item,node).complete,true);
for(const mutate of [n=>n.content.items.pop(),n=>n.content.items[1].heading='Invented',n=>n.content.diagram.relational.edges.pop(),n=>n.content.diagram.relational.edges[0].to=0]){
 const broken=structuredClone(node);mutate(broken);assert.equal(relationalCoverage(item,broken).complete,false,'missing/changed source labels or edges are rejected');
}
const graphPart=relationalComponent(item,1,2);assert.ok(graphPart.content.diagram.relational.part,'a row range is drawn as a relation-diagram part (see selftest-ppt-relation-graph-split)');assert.equal(diagramCoverage(item,{content:graphPart.content}).complete,true);
const cycle=structuredClone(component.content);cycle.diagram.relational.edges.push({from:1,to:0});assert.equal(relationalPlan(cycle,frame,18),null,'cycles are not invented DAGs');
const lanes={id:'lanes',rows:[['Role','Stage','Action'],['Research','1','Collect evidence'],['Writing','1','Explain evidence'],['Research','2','Check sources']]};
assert.equal(tableRelationKind(lanes),'swimlane');const lane=tableRelationComponent(lanes,'swimlane',1,4);assert.equal(lane.content.diagram.relational.edges.length,0,'lane membership never invents cross-role dependencies');assert.equal(diagramCoverage(lanes,{...lane}).complete,true);
const lanePlan=relationalPlan(lane.content,frame,18),[first,peer,nextStage]=lanePlan.boxes;
assert.equal(lanePlan.overflow,false);
assert.ok(Math.abs(first.y-peer.y)<1e-8&&Math.abs(first.x-nextStage.x)<1e-8||Math.abs(first.x-peer.x)<1e-8&&Math.abs(first.y-nextStage.y)<1e-8,'the same stage aligns across lanes and each lane retains its axis');
assert.equal(first.h,peer.h,'a shorter lane is not stretched across later source stages');
const wrongLane=structuredClone(lane);wrongLane.content.items[1].stage=1;assert.equal(diagramCoverage(lanes,wrongLane).complete,false,'a changed role/stage binding is rejected');
const timeline={id:'time',rows:[['Date','Event'],['2025-01-01','Read'],['2025-02-01','Review']]};assert.equal(tableRelationKind(timeline),'timeline');assert.equal(tableRelationKind({...timeline,rows:[timeline.rows[0],...timeline.rows.slice(1).reverse()]}),null);
assert.equal(relationalPlan(tableRelationComponent(timeline,'timeline',1,3).content,frame,18).overflow,false);
assert.equal(tableRelationKind({rows:[['Time','Event'],['1','Read'],['2','Write']]}),null,'numeric step labels are not silently parsed as dates');
const decisionSource=normalizePaste('# Decision\n\n```text\nAllowed?\n ├─ Yes\n └─ No\n```'),decision=decisionSource.semantic.inventory.items.find(i=>i.diagramSource?.graph),decisionComponent=relationalComponent(decision);
assert.equal(decisionComponent.content.diagram.kind,'decision');assert.equal(decisionComponent.content.diagram.relational.edges.length,2);

const project={id:'relations',pages:3,source:graphSource,template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),generationPolicy:{version:2,content:'overview',knowledge:'source_only',language:{mode:'source',body:'both'}},outline:[{id:'cover',title:'Card structure'},{id:'graph',title:'Cards retain their hierarchy',sourceUnitIds:[item.id]},{id:'end',title:'Summary'}],deck:{slides:[{id:'cover',title:'Card structure',nodes:[]},{id:'graph',title:'Cards retain their hierarchy',nodes:[]},{id:'end',title:'Summary',nodes:[]}]}};
project.planning={slidePlan:project.outline.map(s=>({slideId:s.id,sourceArtifacts:s.sourceUnitIds?.map(id=>({sourceUnitId:id}))||[]}))};
project.pageDecision={mode:'explicit',finalPageCount:3};project.revision=1;
auditSourceGraphs(project,{equivalent:true});
bindSourceArtifacts(project,project.deck.slides[1],[{sourceUnitId:item.id}],1);
assert.deepEqual(inspectObjectIntegrity(project).issues,[]);
const canvas=contentCanvas(project,1).geometry;let finalFits=0,finalBlocked=0;
for(const width of [.35,.6,1])for(const height of [.25,.6,1]){
 const fit=fitComponents([component],project,1,{canvas:{...canvas,width:Math.floor(canvas.width*width),height:Math.floor(canvas.height*height)},relationalFallback:false});
 if(fit.capacity_ok){finalFits++;assert.equal(relationalPlan(component.content,fit.boxes[0],fit.fontSizePt).overflow,false,'accepted packed frames must fit without relying on the original full canvas');}else finalBlocked++;
}
assert.ok(finalFits&&finalBlocked,'both feasible and blocked actual final frames are exercised');
const scene=buildRenderTree(project),element=scene.slides[1].elements.find(e=>e.content?.diagram?.relational);assert.ok(element);
assert.equal(element.content.pointLayout.connectors.length,item.diagramSource.graph.edges.length);
assert.ok(slideSvg(scene.slides[1]).includes('<polyline'),'server SVG consumes the same routes');
const broadSource=normalizePaste('# Broad tree\n\n```text\nRoot\n'+Array.from({length:20},(_,i)=>(i===19?' └─ ':' ├─ ')+'Child '+i).join('\n')+'\n```'),broadItem=broadSource.semantic.inventory.items.find(i=>i.diagramSource?.graph);
const broadFit=fitComponents([sourceComponent(broadItem)],{source:broadSource,templateSpec:project.templateSpec},1);
assert.equal(broadFit.capacity_ok,true);assert.equal(broadFit.componentFallbacks[0].component.type,'table','planning uses the same complete-table fallback as actual source binding');
console.log('PASS complete-input delivery/cache, role budgets, untruncated contract relations, source tree/DAG negative proofs, lanes/time, actual binding/scene/SVG');
export {project,scene};
