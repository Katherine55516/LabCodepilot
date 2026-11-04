import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {Readable} from 'node:stream';import {performance} from 'node:perf_hooks';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-registry-'));process.env.COWORK_STATE_DIR=root;
const [store,templates,imports,fidelity,registry,api]=await Promise.all([import('./lib/ppt-store.mjs'),import('./lib/ppt-template.mjs'),import('./lib/ppt/import-pptx.mjs'),import('./lib/ppt-template-fidelity.mjs'),import('./scripts/register-ppt-template.mjs'),import('./lib/ppt-api.mjs')]);
const python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
function run(script,input,env={}){const result=spawnSync(python,['-c',script],{input,env:{...process.env,...env},maxBuffer:50_000_000});assert.equal(result.status,0,result.stderr.toString());return result.stdout;}
const file=path.join(root,'template.pptx');run(`from pptx import Presentation\nfrom pptx.util import Inches,Pt\np=Presentation()\np.slide_width=Inches(13.333);p.slide_height=Inches(7.5)\nfor i in range(3):\n s=p.slides.add_slide(p.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=__import__('pptx').dml.color.RGBColor(250,250,250)\n rect=s.shapes.add_shape(1,0,0,Inches(13.333),Inches(.13));rect.fill.solid();rect.fill.fore_color.rgb=__import__('pptx').dml.color.RGBColor(55,120,200)\n for label,y,size in [('Template title',.5,32),('A complete source-grounded explanation that preserves context and constraints.',2,18)]:\n  box=s.shapes.add_textbox(Inches(1),Inches(y),Inches(10),Inches(2));box.text=label\n  for r in box.text_frame.paragraphs[0].runs:r.font.name='Arial';r.font.size=Pt(size);r.font.color.rgb=__import__('pptx').dml.color.RGBColor(55,120,200) if size==32 else __import__('pptx').dml.color.RGBColor(20,20,40)\np.save(${JSON.stringify(file)})`,Buffer.alloc(0));
let parsed=0,analyses=0,copies=0;
const deps={analyzeTemplate:async(_uid,_id,_ext,bytes)=>{analyses++;return JSON.parse(run(templates._internals.SCRIPT,bytes,{PPT_TEMPLATE_EXT:'pptx'}))},importEditablePptx:async(project,bytes,hash)=>{parsed++;const manifest=JSON.parse(run(imports._internals.IMPORT_SCRIPT,bytes,{PPT_EXTERNAL_DIR:path.join(root,'original')}));return imports.projectFromImportedManifest(project,manifest,hash)},removeContainer:async()=>{}};
const timings=[];
try {
 const t=performance.now();const result=await registry.registerManagedTemplate(file,{name:'Managed teaching'},deps);timings.push({stage:'managed_offline_ingest',seconds:(performance.now()-t)/1000});
 assert.equal(result.template.kind,'managed');assert.equal(parsed,1);assert.equal(analyses,1);
 assert.match(store.readTemplateCover('managed',result.template.id),/<svg/);
 assert.equal((await registry.registerManagedTemplate(file,{},deps)).cacheHit,true);assert.equal(parsed,1);
 const bytes=fs.readFileSync(file),item=result.template;
 for(let iteration=0;iteration<3;iteration++){
  const t=performance.now();const project={uid:'alice',id:store.newId(),pages:3,title:'A tutorial',template:item.id};
  const prepared=await fidelity.prepareTemplateFidelity(project,bytes,item.sha256,item,{importPptx:deps.importEditablePptx,writeFile:async(_id,name,source,length,uid)=>{assert.equal(name,'template-original.pptx');assert.equal(uid,'alice');const chunks=[];for await(const chunk of source)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(length,bytes.length);copies++;return '/workspace/template-original.pptx';}});
  assert.equal(prepared.originalPath,'/workspace/template-original.pptx');
  assert.equal(project.templateCacheHit,true);assert.equal(prepared.slides.length,3);timings.push({stage:'managed_runtime_warm',iteration:iteration+1,seconds:(performance.now()-t)/1000});
 }
 assert.equal(parsed,1,'runtime must not parse registry binary');assert.equal(copies,3);
 let response;const req=Readable.from([bytes]);req.method='POST';req.headers={'content-type':'application/octet-stream'};
 await api.handlePpt(req,new URL('http://test/ppt/templates?fileName=template.pptx'),{uid:'alice',deps:{...deps,importTemplateIR:deps.importEditablePptx},send:(status,body)=>{response={status,body};return true},res:{}});
 assert.equal(response.status,201);assert.ok(store.readTemplateIR('alice',response.body.template.id,item.sha256));
 const count=parsed;const duplicate=Readable.from([bytes]);duplicate.method='POST';duplicate.headers=req.headers;
 await api.handlePpt(duplicate,new URL('http://test/ppt/templates?fileName=template.pptx'),{uid:'alice',deps:{...deps,importTemplateIR:deps.importEditablePptx},send:(status,body)=>{response={status,body};return true},res:{}});
 assert.equal(response.status,200);assert.equal(response.body.cacheHit,true);assert.equal(parsed,count);
 assert.equal(store.readTemplateIR('bob',item.id,item.sha256),null,'account isolation');assert.equal(store.readTemplateIR('managed',item.id,'invalid'),null,'checksum invalidation');
 assert.equal(templates.templateFor('bob',item.id,store).kind,'managed');
 const reserved=Readable.from([]);reserved.method='GET';
 await api.handlePpt(reserved,new URL('http://test/ppt/templates'),{uid:'managed',send:(status,body)=>{response={status,body};return true},res:{}});
 assert.equal(response.status,403,'HTTP accounts cannot claim the operator namespace');
 console.log(JSON.stringify({timings,parsed,analyses,copies}));console.log('PPT managed/uploaded shared IR, raw upload, duplicate cache, version/hash/owner and warm parsing: OK');
}finally{fs.rmSync(root,{recursive:true,force:true});}
