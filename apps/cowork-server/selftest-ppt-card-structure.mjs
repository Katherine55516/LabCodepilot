import assert from 'node:assert/strict';
import {cardStructureCommands,explicitStructureTargets} from './lib/ppt/card-structure.mjs';
import {bindThemeCardPage} from './lib/ppt-card-pages.mjs';
import {typedCommands,materializeTypedCandidate} from './lib/ppt/typed-proposal.mjs';
import {routeMutation} from './lib/ppt/mutation-router.mjs';
const IN=914400;
function fixture(){
 const outline=[{id:'cover',title:'Deck'},...['First','Second'].map((title,k)=>({id:'p'+k,title,section:'Findings',cardObjects:[],sourceUnitIds:[],keyPoints:[{text:'The source supports this useful finding.',refs:[],sourceUnitIds:[]}]})),{id:'close',title:'Closing'}];
 const p={id:'fixture',pages:4,revision:0,planningContract:{version:3,flow:'cards'},outline,source:{text:'The source supports this useful finding.',segments:[],semantic:{inventory:{items:[],relationships:[]}}},generationPolicy:{language:{mode:'output',locale:'en'}},templateSpec:{fonts:{body:'Arial'},palette:{foreground:'#111111'}},templateFidelity:{mode:'preserve',width:12*IN,height:6.75*IN,slides:[{},{},{},{}],slideMap:[0,1,2,3]},planning:{slidePlan:[]},deck:{schemaVersion:3,slides:outline.map(page=>({...page,nodes:[],nodeOrder:[]}))}};
 for(let k=1;k<3;k++)bindThemeCardPage(p,p.deck.slides[k],k,p.outline[k]);
 return p;
}
const p=fixture(),data={slideId:'p0',mergeSlideId:'p1',instruction:'把页面2和页面3的内容合并到一个页面中',type:'structure'};
assert.deepEqual(explicitStructureTargets(p,data.instruction),{slideId:'p0',mergeSlideId:'p1'});
assert.equal(routeMutation(p,data.instruction).type,'structure');
const cmds=await typedCommands(p,data,{modelCall:()=>{throw Error('must not call writing model');}});
const merged=materializeTypedCandidate(p,{commands:cmds,type:'structure',slideId:'p0'});
assert.equal(p.pages,4,'proposal is non-mutating');assert.equal(merged.pages,3);
assert.equal(merged.outline[1].keyPoints.length,2);assert.equal(merged.templateFidelity.slides.length,3);
assert.equal(merged.deck.slides[1].sourceArtifactNodes.length,2,'each original point is visible');
assert.deepEqual(merged.templateFidelity.slideMap,[0,1,3],'unrelated frames are preserved');
const dense=fixture();dense.outline[2].keyPoints=Array.from({length:6},()=>({text:'A long source condition must be retained without removing its full explanation. '.repeat(25),sourceUnitIds:[],refs:[]}));
// Rebuild a dense-but-invalid source page only for a measured merge refusal.
assert.throws(()=>cardStructureCommands(dense,data),/card_page_capacity|measured template capacity/);
const native=fixture();native.deck.slides[1].cardPage.mode='native';assert.throws(()=>cardStructureCommands(native,data),/ppt_structure_native_bound/);
const locked=fixture();locked.deck.slides[2].nodes[0].locked=true;assert.throws(()=>cardStructureCommands(locked,data),/unlock/);
const edited=fixture();edited.deck.slides[2].nodes[0].content.text='A later manual edit must survive.';assert.throws(()=>cardStructureCommands(edited,data),/newer than its outline/);
const divider=fixture();divider.outline[1].cardFrame='divider';divider.outline[1].title='Chapter A';divider.outline[2].section='';
const removed=materializeTypedCandidate(divider,{commands:cardStructureCommands(divider,data)});
assert.equal(removed.pages,3);assert.equal(removed.deck.slides[1].id,'p1');assert.equal(removed.outline[1].section,'Chapter A');
assert.equal(removed.deck.slides[1].sourceArtifactNodes.length,1,'divider removal keeps the next card body unchanged');
console.log('PASS deterministic card structure: measured merge, frame preservation, divider proposal, native/locked/stale-edit refusal');
// Figure + figure keeps both exact images and full captions in the candidate.
{const p=fixture();p.source.images=['image1','image2'].map(id=>({id,width:600,height:300,required:true,caption:'Figure '+id+'. Complete source caption.',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII='}));
 const {bindSourceMedia}=await import('./lib/ppt-source-artifacts.mjs');
 for(let k=1;k<3;k++){p.outline[k]={...p.outline[k],figurePage:true,keyPoints:[],sourceImageIds:['image'+k]};p.deck.slides[k].nodes=[];p.deck.slides[k].sourceArtifactNodes=[];p.deck.slides[k].copy={blocks:[]};bindSourceMedia(p,p.deck.slides[k],['image'+k],k);}
 const next=materializeTypedCandidate(p,{commands:cardStructureCommands(p,data)});
 assert.deepEqual(next.outline[1].sourceImageIds,['image1','image2']);
 assert.equal(next.deck.slides[1].nodes.filter(n=>n.type==='image').length,2);
 assert.equal(next.deck.slides[1].nodes.filter(n=>n.content?.sourceImageCaptionId).length,2);
}
