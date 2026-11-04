import {requireSoffice} from './test/ppt-tool-requirements.mjs';requireSoffice('selftest-ppt-process-cards');
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {processCardPlan,processCardItems} from './lib/ppt-process-cards.mjs';
import{richTextContent}from'./lib/ppt-source-text.mjs';
import {normalizePaste} from './lib/ppt-source.mjs';
import {_internals as api} from './lib/ppt-api.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {defaultGenerationPolicy} from './lib/ppt-generation-policy.mjs';
import {ensureDeckV3} from './lib/ppt/ir.mjs';
import {applyLayoutRegistry} from './lib/ppt-layout.mjs';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';
import {renderPptx} from './lib/ppt-render.mjs';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
const steps=['Prompt','Clarification Questions','Brief / Plan','User Approval','Research','Writing','Design','Images','Document'];
const content={processSource:steps.map((s,i)=>(i+1)+'. '+s).join('\n'),items:steps.map(text=>({text}))};
const plan=processCardPlan(content,{width:8*914400,height:4.5*914400},14.5);
assert.equal(plan.overflow,false);assert.ok(plan.columns>1);assert.equal(plan.fontSizePt,14.5);assert.deepEqual(plan.items.map(i=>i.text),steps);assert.equal(plan.numberPlacement,'inline');assert.deepEqual(plan.items.map(i=>i.body),steps.map((s,i)=>(i+1)+'. '+s));
assert.deepEqual(processCardItems(content).map(i=>i.heading),steps.map((_,i)=>String(i+1)),'the explicit stacked variant remains available');
const richStep=richTextContent('Only when $x>0$, proceed.'),mathContent={processSource:'Only when x>0, proceed. Then stop.',items:[richStep,richTextContent('Then stop.')]},mathBefore=JSON.stringify(mathContent),inlineItems=processCardItems(mathContent,{numberPlacement:'inline'});assert.equal(inlineItems[0].body,'1. '+richStep.richText.source);assert.deepEqual(inlineItems[0].bodyRich.runs.slice(1),richStep.richText.runs);assert.equal(JSON.stringify(mathContent),mathBefore,'ordinal placement preserves original math runs, conditions and source');assert.deepEqual(processCardItems({...mathContent,items:inlineItems},{numberPlacement:'inline'}),inlineItems,'render remeasurement cannot duplicate ordinals');
plan.boxes[0].x=.99;
const independent=processCardPlan({...content,items:content.items.map(i=>({...i,id:'other-source'}))},{width:8*914400,height:4.5*914400},14.5);
assert.equal(independent.items[0].id,'other-source');assert.equal(independent.boxes[0].x,0,'measurement cache never shares mutable boxes or source ownership');
assert.equal(processCardPlan(content,{width:2*914400,height:.5*914400},14.5).overflow,true,'impossible frame never drops steps or shrinks text');
// Up to six steps of a template with a dark panel stand on a rail (Fable M2,
// 2026-11-02): one column beside the rail, no arrows; seven or more keep the arrows.
{const four=['Collect rollouts','Train V','Train M','Evolve C'],railed={processSource:four.map((s,i)=>(i+1)+'. '+s).join('\n'),items:four.map(text=>({text})),rail:true};
 const railPlan=processCardPlan(railed,{width:8*914400,height:4.5*914400},14.5);
 assert.equal(railPlan.columns,1);assert.ok(railPlan.requiredHeight>0,'the measurement reads its height');assert.ok(railPlan.rail&&railPlan.rail.x>0,'a rail left of the cards');assert.ok(railPlan.boxes.every(box=>box.x>railPlan.rail.x),'cards right of the rail');
 assert.equal(processCardPlan({...railed,items:steps.slice(0,7).map(text=>({text})),processSource:steps.slice(0,7).join('\n')},{width:8*914400,height:4.5*914400},14.5).rail,undefined,'seven steps keep the arrows');
}
const source=normalizePaste('# Workflow\n\n'+content.processSource),item=source.semantic.inventory.items.find(i=>i.type==='ProcessBlock');assert.ok(item);
const body={id:'body',title:'Workflow',focus:'Complete ordered stages',role:'workflow',sourceUnitIds:[item.id],planningProtocolVersion:2};
const p={id:'process_cards',uid:'test',title:'Workflow',source,pages:3,template:'light',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='light')),generationPolicy:{...defaultGenerationPolicy(),content:'full_source'},outline:[{id:'cover',title:'Workflow',role:'cover',sourceUnitIds:[]},body,{id:'close',title:'Thanks',role:'closing',sourceUnitIds:[]}],planning:{slidePlan:[{slideId:'body',sourceArtifacts:[{sourceUnitId:item.id}]}]}};
const before=JSON.stringify(source);const actual=api.normalizeSlide({title:'Workflow',contentBlocks:[],blocks:[],sourceArtifacts:[{sourceUnitId:item.id}],sourceCommentary:[],sourceEvidenceIds:[]},body,p);
const node=actual.sourceArtifactNodes.find(n=>n.content.processCards);assert.ok(node);assert.equal(node.content.pointLayout.boxes.length,9);assert.equal(node.content.pointLayout.fontSizePt,node.style.fontSizePt);assert.equal(JSON.stringify(source),before);
p.deck=ensureDeckV3(applyLayoutRegistry({slides:[{id:'cover',title:'Workflow',copy:{role:'cover'},nodes:[]},actual,{id:'close',title:'Thanks for watching!',copy:{role:'closing'},nodes:[]}]}));
const tree=buildRenderTree(p),rendered=tree.slides[1].elements.find(e=>e.content.processCards);assert.equal(rendered.kind,'list');assert.equal(rendered.content.pointLayout.overflow,false);
const resized=structuredClone(p);resized.deck.slides[1].nodes.find(n=>n.content.processCards).geometry.height=91440;
assert.equal(buildRenderTree(resized).slides[1].elements.find(e=>e.content.processCards).content.pointLayout.overflow,true,'resize remeasures cards instead of trusting a stale fit flag');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-process-cards-'));
try{const output=await renderPptx(p,localPptRuntime(temp).io);assert.equal(output.exportVerification.status,'passed');assert.equal(output.exportVerification.renderedVisibility.status,'passed');console.log('Complete source process renders as measured native editable cards; unchanged font, order, preview geometry and actual PPTX/PDF glyph verification pass');}finally{fs.rmSync(temp,{recursive:true,force:true});}
