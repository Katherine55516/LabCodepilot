import assert from 'node:assert/strict';
import {buildRenderTree,buildSlideRenderTree} from './lib/ppt/render-tree.mjs';
import {updateSlidePreview} from './lib/ppt/runtime.mjs';
import {deterministicReview} from './lib/ppt-quality.mjs';
import {snapshotTemplate,BUILT_INS} from './lib/ppt-template.mjs';
const slides=Array.from({length:8},(_,i)=>({id:'scope'+i,title:'Topic '+i,bullets:['Supported content'],layoutId:i?'summary':'cover'}));
const project={id:'preview-test',uid:'preview-user',deck:{slides},outline:slides.map(slide=>({id:slide.id,title:slide.title,sourceUnitIds:[]})),templateSpec:snapshotTemplate(BUILT_INS[0]),nodes:Object.fromEntries(slides.map(slide=>[slide.id,{slide,status:'done'}]))};
const before=JSON.stringify(project);const full=buildRenderTree(project),one=buildSlideRenderTree(project,'scope5');assert.deepEqual(one,full.slides[5]);assert.equal(one.index,5);assert.equal(JSON.stringify(project),before);assert.equal(buildSlideRenderTree(project,'unknown'),null);
const preview=updateSlidePreview(project,'scope5');assert.equal(preview.id,'scope5');assert.equal(project.runtime.slides.scope5.quality.scope,'page_preview');assert.equal(project.runtime.slides.scope5.quality.pendingDeckReview,true);assert.equal(Object.keys(project.runtime.slides).length,1);
project.deck.slides[6].bullets=['Corrupt text \ufffd'];assert.ok(deterministicReview(project).issues.some(issue=>issue.code==='font_invalid_character'),'whole-deck final quality still rejects errors outside the page preview');
console.log('PASS: targeted page tree exactly matches full tree at actual index, does not mutate source, preview remains explicitly pending whole-deck review and final global gates still catch other-page corruption');

const inferred={...project,deck:{slides:slides.map(({layoutId,...slide})=>({...slide,bullets:['Supported content']}))}};
const inferredFull=buildRenderTree(inferred);for(const index of [0,4,7])assert.deepEqual(buildSlideRenderTree(inferred,slides[index].id),inferredFull.slides[index]);
console.log('PASS: pages without explicit layouts infer cover/content/conclusion using actual full-deck positions');
