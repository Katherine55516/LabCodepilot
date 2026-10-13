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
process.env.COWORK_STATE_DIR=root;
const [api,store,source,renderer,{scopeReview}]=await Promise.all([import('./lib/ppt-api.mjs'),import('./lib/ppt-store.mjs'),import('./lib/ppt-source.mjs'),import('./lib/ppt-render.mjs'),import('./ppt-scope-test-helpers.mjs')]);
const uid='generation-input',python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',runtime=localPptRuntime(root,python);
const image={id:'source_figure',fileName:'figure.png',caption:'Supplied comparison figure',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVKHmEEYCvluBm4PGgNZZ19N8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPr/wBoUlll4sAAAAASUVORK5CYII='};
const text='# Measurements\n\n| Method | Count |\n|---|---|\n| A | 4 |\n| B | 7 |\n\n# Figure\n\nSupplied comparison figure\n\n# Release rule\n\nRecords are validated before release; validation preserves the stated measurement counts.\n';
const snapshots=[];let releaseSecond;
const gate=new Promise(resolve=>{releaseSecond=resolve;});
const deps={...api._internals.defaultDeps,
 extractFile:(p,name,bytes)=>source.extractFile(p,name,bytes,runtime.io),readFile:async(p,value)=>runtime.readFile(p.id,value),removeContainer:async()=>{},
 renderPptx:p=>renderer.renderPptx(p,runtime.io),
 modelCall:async(p,prompt,_activity,_log,meta={})=>{
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
  const index=p.outline.findIndex(slide=>meta.nodeKey===`content:${slide.id}`);
  if(index<0)throw new Error('unexpected model stage '+meta.nodeKey+' '+prompt.slice(0,60));
  if(index===1){const current=store.get(uid,p.id);snapshots.push({first:current.runtime.slides[p.outline[0].id]?.preview,second:current.runtime.slides[p.outline[1].id]?.preview,future:current.runtime.slides[p.outline[2].id]?.preview});await gate;}
  const planned=p.planning.slidePlan.find(plan=>plan.slideId===p.outline[index].id);
  const imageOnly=!p.source.semantic.inventory.items.some(item=>item.type==='TableBlock');
  const body=imageOnly ? index===p.outline.length-1 ? `Source: ${p.source.name}. ${p.source.images[0].caption || ''}` : [] : index===3?'Records are validated before release; validation preserves the stated measurement counts.':index===2?'Supplied comparison figure':[];
  return {title:p.outline[index].title,section:'Measurements',layoutId:index===0?'cover':index===p.outline.length-1?'conclusion':imageOnly?'image-text':index===1?'table':'image-text',
    bullets:typeof body==='string'?[body]:body,sourceArtifacts:planned.sourceArtifacts||[],sourceCommentary:[],
    copy:{eyebrow:'Measurements',subtitle:'',takeaway:'',blocks:typeof body==='string'?[{type:'support',heading:'',body}]:[],distributionType:'single_deep',depth:'balanced',density:'medium'}};
 }
};
async function call(method,route,data){const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;let result;await api.handlePpt(req,new URL('http://test'+route),{uid,deps,activity:()=>{},log:()=>{},send:(status,body)=>{result={status,body};return true;},res:{writeHead(){},on(){},destroy(){}}});return result;}
async function wait(id,predicate){for(let i=0;i<600;i++){const p=store.get(uid,id);if(predicate(p))return p;if(['failed','quality_blocked'].includes(p?.status))throw new Error(p.status+' '+p.error+' '+JSON.stringify(p.quality?.deterministic?.issues));await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('timed out '+JSON.stringify(store.get(uid,id)?.status));}
try{
 const created=await call('POST','/ppt/projects',{inputKind:'file',fileName:'measurements.md',fileBase64:Buffer.from(text).toString('base64'),images:[image],template:'light',templateContentMode:'design_only',pages:4,configId:'fixture',generationPolicy:{version:1,detail:'balanced',language:{mode:'source'},knowledge:'source_only'}});
 assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.project.id;
 assert.equal(created.body.project.templateContentMode,'design_only','real create endpoint persists design-only');
 let p=await wait(id,p=>p.status==='outline_ready');assert.equal(p.source.images.length,1);assert.equal(p.source.images[0].dataUrl,image.dataUrl);
 assert.equal((await call('POST',`/ppt/projects/${id}/generate`)).status,202);
 await wait(id,()=>snapshots.length>0);assert.ok(snapshots[0].first?.elements.some(e=>e.kind==='text'&&e.content?.text),'first page is populated before writing the next page');assert.ok(!snapshots[0].second&&!snapshots[0].future,'no later filled template previews');releaseSecond();
 p=await wait(id,p=>p.status==='completed');
 const table=p.renderTree.slides[1].elements.find(e=>e.kind==='table'),title=p.renderTree.slides[1].elements.find(e=>e.semanticRole==='title');assert.ok(table&&title);
 const canvas=p.deck.slides[1].sourceArtifactFit.canvas;assert.ok(Math.abs(table.bounds.x+table.bounds.width/2-(canvas.x+canvas.width/2))<1);assert.ok(Math.abs(table.bounds.y+table.bounds.height/2-(canvas.y+canvas.height/2))<1);
 assert.ok(p.renderTree.slides[2].elements.some(e=>e.kind==='image'&&e.content.dataUrl===image.dataUrl));
 assert.equal(p.deck.slides.at(-1).title,'Thanks for watching!');assert.ok(!p.renderTree.slides.flatMap(s=>s.elements).some(e=>/完整来源细节见本页备注|完整表见备注/.test(e.content?.text||'')));
 const target=runtime.host(p,p.publishedArtifactPath||p.renderOutput||'/workspace/presentation.pptx');
 const audit=spawnSync(python,['-c',String.raw`
from pptx import Presentation
from zipfile import ZipFile
import sys,hashlib,json
p=Presentation(sys.argv[1]);text='\n'.join(s.text for slide in p.slides for s in slide.shapes if s.has_text_frame)
assert 'Thanks for watching!' in text
assert any(s.has_table and s.table.cell(2,1).text=='7' for slide in p.slides for s in slide.shapes)
with ZipFile(sys.argv[1]) as z:media=[hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('ppt/media/')]
assert sys.argv[2] in media
print(json.dumps({'slides':len(p.slides),'originalFigureHashPreserved':True,'completeTable':True,'closing':True}))
`,target,source.sha256(Buffer.from(image.dataUrl.split(',')[1],'base64'))],{encoding:'utf8'});assert.equal(audit.status,0,audit.stderr);
 const out=process.env.PPT_TEST_OUTPUT;if(out){fs.mkdirSync(out,{recursive:true});fs.copyFileSync(target,path.join(out,'generation-input-contract.pptx'));fs.writeFileSync(path.join(out,'generation-input-contract.json'),JSON.stringify({snapshots:snapshots.map(s=>({firstPopulated:!!s.first,secondAbsent:!s.second,futureAbsent:!s.future})),audit:JSON.parse(audit.stdout),tableBounds:table.bounds,canvas},null,2));}
 const largeFile=path.join(root,'large-source.png');const large=spawnSync(python,['-c',"from PIL import Image;import random,sys;Image.frombytes('RGB',(1024,512),random.Random(42).randbytes(1024*512*3)).save(sys.argv[1])",largeFile],{encoding:'utf8'});assert.equal(large.status,0,large.stderr);
 const largeBytes=fs.readFileSync(largeFile);assert.ok(largeBytes.length>512*1024);
 const direct=await call('POST','/ppt/projects',{inputKind:'file',fileName:'large-source.png',fileBase64:largeBytes.toString('base64'),template:'light',pages:3,configId:'fixture',generationPolicy:{version:1,detail:'balanced',language:{mode:'source'},knowledge:'source_only'}});assert.equal(direct.status,201,JSON.stringify(direct.body));
 let visual=await wait(direct.body.project.id,p=>p.status==='outline_ready');assert.deepEqual(visual.source.mediaWarnings,[],'the default file name is not a missing supplemental image');assert.equal(visual.source.images.length,1);
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
 console.log('Full generation API: imported source + supplemental PNG → planner → sequential page previews → centered complete table/source image → real PPTX media hash/table/closing/visible contract: OK');
}finally{releaseSecond();fs.rmSync(root,{recursive:true,force:true});}
