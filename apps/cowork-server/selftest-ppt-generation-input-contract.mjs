/** Entire application generation service with real ingestion/binding/export.
 * Only model responses and sandbox transport are deterministic adapters. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { localPptRuntime } from './test/ppt-local-runtime.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-generation-input-'));
process.env.COWORK_STATE_DIR=root;process.env.PPT_NODE_CONCURRENCY='1';
const [api,store,source,renderer,{scopeReview,cardDeckReply,cardWriterReply}]=await Promise.all([import('./lib/ppt-api.mjs'),import('./lib/ppt-store.mjs'),import('./lib/ppt-source.mjs'),import('./lib/ppt-render.mjs'),import('./ppt-scope-test-helpers.mjs')]);
const uid='generation-input',python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',runtime=localPptRuntime(root,python);
const image={id:'source_figure',fileName:'figure.png',caption:'Supplied comparison figure',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVKHmEEYCvluBm4PGgNZZ19N8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPr/wBoUlll4sAAAAASUVORK5CYII='};
const text='# Measurements\n\n| Method | Count |\n|---|---|\n| A | 4 |\n| B | 7 |\n\n# Figure\n\nSupplied comparison figure\n\n# Release rule\n\nRecords are validated before release; validation preserves the stated measurement counts.\n';
const snapshots=[];let releaseSecond;
const gate=new Promise(resolve=>{releaseSecond=resolve;});
const deps={...api._internals.defaultDeps,
 extractFile:(p,name,bytes)=>source.extractFile(p,name,bytes,runtime.io),readFile:async(p,value)=>runtime.readFile(p.id,value),removeContainer:async()=>{},
 renderPptx:p=>renderer.renderPptx(p,runtime.io),
 modelCall:async(p,prompt,_activity,_log,meta={})=>{
  if(meta.nodeKey?.startsWith('vision:')){assert.equal(meta.images[0].dataUrl,p.source.images[0].dataUrl);return {description:'Supplied comparison figure; the original is preserved.',uncertain:false};}
  if(prompt.includes('整稿演示文稿内容评审器'))return scopeReview(p);
  if(prompt.includes('叙事规划器')){
   const table=p.source.semantic.inventory.items.find(item=>item.type==='TableBlock');
   if(!table)return {slides:[{title:'Visual overview',focus:'Supplied visual',refs:[]},{title:'Supplied visual',focus:p.source.images[0].caption,refs:p.source.images[0].sourceRefs||[],sourceImageIds:p.source.images.map(image=>image.id)},{title:'Image reference',focus:p.source.images[0].caption,refs:p.source.images[0].sourceRefs||[]}]};
   return {slides:[
    {title:'Measurement records',focus:'Overview of supplied measurement records',role:'cover',refs:[]},
    {title:'Measurement counts',focus:'The complete count table',role:'evidence',refs:table.source_ref,sourceUnitIds:[table.id],sourceArtifactRanges:[{sourceUnitId:table.id,rowStart:1,rowEnd:table.rows.length}]},
    {title:'Comparison figure',focus:'Supplied comparison figure',role:'application',refs:p.source.images[0].sourceRefs||[],sourceImageIds:[p.source.images[0].id]},
    {title:'Release rule',focus:'Validate records before release',role:'conclusion',refs:[p.source.segments.at(-1).id]},
   ]};
  }
  const outlineReply=cardDeckReply(p,prompt,meta);if(outlineReply)return outlineReply;
  const index=p.outline.findIndex(slide=>meta.nodeKey===`content:${slide.id}`);
  if(index<0)throw new Error('unexpected model stage '+meta.nodeKey+' '+prompt.slice(0,60));
  // The cover is the one page the writer is called for (object cards since
  // Fable plan T6 and point cards since 2026-11-01 are placed by code): while it
  // is written, no later page has committed a preview (reading order).
  if(index===0&&!snapshots.length){snapshots.push({index});await gate;}
  // Card decks (2026-10-23): a card page is written as its points and planned source objects.
  const card=cardWriterReply(p,prompt,meta);if(card)return card;
  const planned=p.planning.slidePlan.find(plan=>plan.slideId===p.outline[index].id);
  const imageOnly=!p.source.semantic.inventory.items.some(item=>item.type==='TableBlock');
  const body=imageOnly ? index===p.outline.length-1 ? `Source: ${p.source.name}. ${p.source.images[0].caption || ''}` : [] : index===3?'Records are validated before release; validation preserves the stated measurement counts.':index===2?'Supplied comparison figure':[];
  return {title:p.outline[index].title,section:'Measurements',layoutId:index===0?'cover':index===p.outline.length-1?'conclusion':imageOnly?'image-text':index===1?'table':'image-text',
    bullets:typeof body==='string'?[body]:body,sourceArtifacts:planned.sourceArtifacts||[],sourceCommentary:[],
    copy:{eyebrow:'Measurements',subtitle:'',takeaway:'',blocks:typeof body==='string'?[{type:'support',heading:'',body}]:[],distributionType:'single_deep',depth:'balanced',density:'medium'}};
 }
};
async function call(method,route,data){const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;let result;await api.handlePpt(req,new URL('http://test'+route),{uid,deps,activity:()=>{},log:message=>console.error(message),send:(status,body)=>{result={status,body};return true;},res:{writeHead(){},on(){},destroy(){}}});return result;}
async function wait(id,predicate){for(let i=0;i<6000;i++){const p=store.get(uid,id);if(predicate(p))return p;if(['failed','quality_blocked'].includes(p?.status))throw new Error(p.status+' '+p.error+' '+JSON.stringify(p.quality?.deterministic?.issues));await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('timed out '+JSON.stringify({status:store.get(uid,id)?.status,stage:store.get(uid,id)?.stage}));}
try{
 const created=await call('POST','/ppt/projects',{inputKind:'file',fileName:'measurements.md',fileBase64:Buffer.from(text).toString('base64'),images:[image],template:'light',templateContentMode:'design_only',pages:4,configId:'fixture',readOnlyInput:false});
 assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.project.id;
 assert.equal(created.body.project.templateContentMode,'design_only','real create endpoint persists design-only');
 let p=await wait(id,p=>p.status==='outline_ready');assert.equal(p.source.images.length,1);assert.equal(p.source.images[0].dataUrl,image.dataUrl);
 assert.ok(p.outline.some(slide=>slide.sourceImageIds?.includes(image.id)),'the supplied figure is on a card');assert.ok(p.outline.some(slide=>slide.cardObjects?.length),'the table is on a card');
 assert.equal((await call('PATCH',`/ppt/projects/${id}/outline`,{slides:p.outline,finalPageCount:p.outline.length})).status,200);
 assert.equal((await call('POST',`/ppt/projects/${id}/generate`)).status,202);
 await wait(id,()=>snapshots.length>0);await new Promise(resolve=>setTimeout(resolve,100));assert.ok(!store.get(uid,id).runtime?.slides?.[store.get(uid,id).outline[1].id]?.preview,'no later filled template preview while the cover is written');releaseSecond();
 p=await wait(id,p=>p.status==='completed');
 // The source table is shown complete on its card: as a table or, when the
 // source parser reads it as parallel items, as a card grid of the same rows.
 const tableUnit=p.source.semantic.inventory.items.find(item=>item.type==='TableBlock');
 const tableIndex=p.deck.slides.findIndex(slide=>slide.nodes.some(node=>node.sourceArtifact?.sourceUnitId===tableUnit.id));assert.ok(tableIndex>0,'the table is on a page');
 const tableText=p.renderTree.slides[tableIndex].elements.map(e=>JSON.stringify(e.content||{})).join(' ');
 for(const row of tableUnit.rows.slice(1))for(const cell of row)assert.ok(tableText.includes(String(cell)),'every table value is shown: '+cell);
 assert.ok(p.renderTree.slides.some(slide=>slide.elements.some(e=>e.kind==='image'&&e.content.dataUrl===image.dataUrl)),'the supplied figure is drawn');
 assert.ok(!p.outline.some(slide=>slide.cardFrame==='takeaway'),'a card deck has no takeaway page (the user, 2026-10-31)');assert.equal(p.outline.at(-1).role,'closing','it ends with its closing page');assert.ok(!p.renderTree.slides.flatMap(s=>s.elements).some(e=>/完整来源细节见本页备注|完整表见备注/.test(e.content?.text||'')));
 const target=runtime.host(p,p.publishedArtifactPath||p.renderOutput||'/workspace/presentation.pptx');
 const audit=spawnSync(python,['-c',String.raw`
from pptx import Presentation
from zipfile import ZipFile
import sys,hashlib,json
p=Presentation(sys.argv[1]);text='\n'.join(s.text for slide in p.slides for s in slide.shapes if s.has_text_frame)
assert all(value in text or any(s.has_table and value in [c.text for r in s.table.rows for c in r.cells] for slide in p.slides for s in slide.shapes) for value in ['A','B','4','7'])
with ZipFile(sys.argv[1]) as z:media=[hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('ppt/media/')]
assert sys.argv[2] in media
print(json.dumps({'slides':len(p.slides),'originalFigureHashPreserved':True,'completeTable':True}))
`,target,source.sha256(Buffer.from(image.dataUrl.split(',')[1],'base64'))],{encoding:'utf8'});assert.equal(audit.status,0,audit.stderr);
 const out=process.env.PPT_TEST_OUTPUT;if(out){fs.mkdirSync(out,{recursive:true});fs.copyFileSync(target,path.join(out,'generation-input-contract.pptx'));fs.writeFileSync(path.join(out,'generation-input-contract.json'),JSON.stringify({snapshots:snapshots.map(s=>({firstPopulated:!!s.first,secondAbsent:!s.second,futureAbsent:!s.future})),audit:JSON.parse(audit.stdout),tableBounds:p.renderTree.slides[tableIndex].elements.find(e=>e.nodeId===p.deck.slides[tableIndex].nodes.find(node=>node.sourceArtifact?.sourceUnitId===tableUnit.id).id)?.bounds,slideSize:p.renderTree.slides[tableIndex].size},null,2));}
 const largeFile=path.join(root,'large-source.png');const large=spawnSync(python,['-c',"from PIL import Image;import random,sys;Image.frombytes('RGB',(1024,512),random.Random(42).randbytes(1024*512*3)).save(sys.argv[1])",largeFile],{encoding:'utf8'});assert.equal(large.status,0,large.stderr);
 const largeBytes=fs.readFileSync(largeFile);assert.ok(largeBytes.length>512*1024);
 // Source images are not described by a model: a vision route is refused, the image is placed by code.
 const refused=await call('POST','/ppt/projects',{inputKind:'file',fileName:'large-source.png',fileBase64:largeBytes.toString('base64'),executionPolicy:{version:1,qualityLevel:'balanced',roleRoutes:{vision_reader:{primary:{configId:'fixture',model:'vision-fixture',vision:true},fallbacks:[]}}},template:'light',pages:3,configId:'fixture'});assert.equal(refused.status,400);assert.match(JSON.stringify(refused.body),/Image understanding is not available/);
 const direct=await call('POST','/ppt/projects',{inputKind:'file',fileName:'large-source.png',fileBase64:largeBytes.toString('base64'),template:'light',pages:3,configId:'fixture',readOnlyInput:false});assert.equal(direct.status,201,JSON.stringify(direct.body));
 let visual=await wait(direct.body.project.id,p=>p.status==='outline_ready');assert.deepEqual(visual.source.mediaWarnings,[],'the default file name is not a missing supplemental image');assert.equal(visual.source.images.length,1);
 assert.equal((await call('PATCH',`/ppt/projects/${visual.id}/outline`,{slides:visual.outline,finalPageCount:visual.outline.length})).status,200);
 assert.equal((await call('POST',`/ppt/projects/${visual.id}/generate`)).status,202);visual=await wait(visual.id,p=>p.status==='completed');assert.ok(visual.renderTree.slides.some(slide=>slide.elements.some(element=>element.kind==='image'&&element.content.dataUrl===visual.source.images[0].dataUrl)));
 const largeExport=runtime.host(visual,visual.publishedArtifactPath);
 const largeAudit=spawnSync(python,['-c',String.raw`
from zipfile import ZipFile
import sys,hashlib
with ZipFile(sys.argv[1]) as z:
 assert sys.argv[2] in [hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('ppt/media/')]
`,largeExport,source.sha256(largeBytes)],{encoding:'utf8'});assert.equal(largeAudit.status,0,largeAudit.stderr);
 if(out)fs.copyFileSync(largeExport,path.join(out,'large-source-image-contract.pptx'));
 console.log('Direct PNG file over 512 KB: real creation/ingestion/generation/export retains the source asset, no false file-name warning: OK');
 console.log('Full generation API (card deck): imported source + supplemental PNG → card outline with the table and the figure on cards → sequential page previews → table in its canvas, source image → real PPTX media hash/table/takeaway: OK');
}finally{releaseSecond();fs.rmSync(root,{recursive:true,force:true});}
