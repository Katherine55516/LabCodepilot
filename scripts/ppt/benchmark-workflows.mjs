/** Actual API/DAG/native renderer benchmark, with deterministic model responses.
 * No sleep-as-latency, mock exporter or forced successful status. Production LLM
 * and Docker transport are intentionally excluded and explicitly reported. */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Readable } from 'node:stream'; import { spawnSync } from 'node:child_process'; import { performance } from 'node:perf_hooks';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-benchmark-')); process.env.COWORK_STATE_DIR=root;
const moduleRoot=path.resolve(process.env.PPT_MODULE_ROOT || 'apps/cowork-server');
const [{handlePpt},store,render,source]=await Promise.all(['ppt-api','ppt-store','ppt-render','ppt-source'].map(name=>import(path.join(moduleRoot,'lib',name+'.mjs'))));
const python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const output=path.resolve(process.argv[2]||'outputs/ppt-next-round/workflow-benchmark.json'); fs.mkdirSync(path.dirname(output),{recursive:true});
const run=(script,input,env={})=>{const r=spawnSync(python,['-c',script],{input,env:{...process.env,...env},maxBuffer:20_000_000});if(r.status!==0)throw Error(r.stderr.toString());return JSON.parse(r.stdout)};
const points=[['Ownership','Assign a responsible owner before the review so that decisions and unresolved dependencies can be tracked.'],['Validation','Check the evidence against the original record before approving the change; a review documents both the result and the remaining limitation.'],['Delivery','Use an incremental rollout and a rollback plan so that a small failure can be corrected before expanding the deployment.'],['Monitoring','Monitor the agreed signals after release and review unexpected results with the owner before changing the operating assumptions.']];
const text=points.map(([title,body])=>`## ${title}\n\n${body}`).join('\n\n');
const rich=text+'\n\n'+Array.from({length:20},(_,i)=>`### Review dimension ${i+1}\n\n`+points[i%4][1]).join('\n\n');
const records=[];
const targetPages=Number(process.env.PPT_BENCH_PAGES||6);
if(!Number.isInteger(targetPages)||targetPages<6||targetPages>12)throw Error('PPT_BENCH_PAGES must be 6–12');
const deps={
 modelCall:async(project,prompt)=>{
  if(prompt.includes('整稿演示文稿内容评审器'))return{missing:[],repeated:[],conflicts:[],unsupported:[]};
  if(prompt.includes('叙事规划器')||prompt.includes('版本更新规划器'))return{brief:{depth:'balanced'},slides:Array.from({length:project.pages},(_,i)=>({title:i===0?'Operating Review':i===project.pages-1?'Decisions and next steps':points[(i-1)%4][0]+' guides the review',focus:points[(i-1+4)%4][1],refs:project.source?.segments?.map(x=>x.id)||[],chunkRefs:project.source?.semantic?.chunks?.filter((_,n)=>n%Math.max(1,project.pages-2)===(i-1+project.pages)%Math.max(1,project.pages-2)).map(x=>x.id)||[],...(project.update?{change:'add'}:{})}))};
  const page=Number(prompt.match(/当前任务只写第 (\d+) 页/)?.[1]||1)-1;
  return{title:project.outline[page]?.title||'Operating Review',contentBlocks:page===0?[]:points.slice(0,3).map(([heading,body])=>({type:'mechanism',heading,body})),takeaway:page===0?'':points[3][1],blocks:[]};
 },
 renderPptx:async(project)=>run(render._internals.SCRIPT,JSON.stringify({slides:project.deck.slides,renderTree:project.renderTree,palette:project.templateSpec.palette,fonts:project.templateSpec.fonts}),{PPT_OUTPUT:path.join(root,project.id+'.pptx')}),
 extractFile:async(_p,name,bytes)=>run(source._internals.SCRIPT,bytes,{PPT_SOURCE_NAME:name,PPT_SOURCE_DIR:path.join(root,'source')}),
 removeContainer:async()=>{},readFile:async()=>({stream:Readable.from([]),size:0})
};
async function request(uid,method,url,data){const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;let r;await handlePpt(req,new URL('http://test'+url),{uid,deps,activity:()=>{},log:()=>{},send:(status,body)=>{r={status,body};return true},res:{writeHead(){},on(){}}});if(r?.status>=400)throw Error(JSON.stringify(r));return r;}
async function settle(uid,id,status){for(let n=0;n<500;n++){let p=store.get(uid,id);if(p?.status===status)return p;if(['failed','quality_blocked'].includes(p?.status))throw Error(p.error);await new Promise(r=>setTimeout(r,5));}throw Error('timeout '+status);}
const baseBytes=run(`import io,json,base64\nfrom pptx import Presentation\nfrom pptx.util import Inches\np=Presentation()\ns=p.slides.add_slide(p.slide_layouts[6]);s.shapes.add_textbox(Inches(1),Inches(1),Inches(8),Inches(4)).text=${JSON.stringify(text)}\nb=io.BytesIO();p.save(b);print(json.dumps({'base64':base64.b64encode(b.getvalue()).decode()}))`,Buffer.alloc(0)).base64;
const allScenarios=['Short Prompt','Medium Rich Prompt','Paste','Markdown Import','PPTX Import','Template-first','Version Update'];
const scenarios=process.env.PPT_SCENARIOS?process.env.PPT_SCENARIOS.split('|'):allScenarios;
try{
for(const scenario of scenarios)for(const cache of ['cold','warm'])for(let iteration=0;iteration<3;iteration++){
 const uid=cache==='cold'?`cold-${scenarios.indexOf(scenario)}-${iteration}`:`warm-${scenarios.indexOf(scenario)}`;
 let data={inputKind:'prompt',prompt:'Explain a responsible operating review with ownership, validation, delivery and monitoring',pages:targetPages,configId:'deterministic-model',template:'blue'};
 if(scenario==='Medium Rich Prompt')data.prompt=rich;
 if(scenario==='Paste')data={...data,inputKind:'paste',text};
 if(scenario==='Markdown Import')data={...data,inputKind:'file',fileName:'review.md',fileBase64:Buffer.from(text).toString('base64')};
 if(scenario==='PPTX Import')data={...data,inputKind:'file',fileName:'review.pptx',fileBase64:baseBytes};
 let start=performance.now(),acceptedAt=new Date().toISOString();
 let created=await request(uid,'POST','/ppt/projects',data),id=created.body.project.id;
 await settle(uid,id,'outline_ready');
 let genStart=performance.now(),generationAt=new Date().toISOString();
 await request(uid,'POST',`/ppt/projects/${id}/generate`);let project=await settle(uid,id,'completed');
 if(scenario==='Version Update'){
  start=performance.now(); acceptedAt=new Date().toISOString();
  const updated=await request(uid,'POST','/ppt/updates',{baseProjectId:id,progressKind:'prompt',progressText:'Apply the monitoring checklist and clarify ownership',pages:targetPages,configId:'deterministic-model',template:'blue'});id=updated.body.project.id;
  await settle(uid,id,'outline_ready');genStart=performance.now();generationAt=new Date().toISOString();await request(uid,'POST',`/ppt/projects/${id}/generate`);project=await settle(uid,id,'completed');
 }
 const ready=performance.now();const first=Object.entries(project.dagNodes||{}).filter(([id])=>id.startsWith('preview:')).map(([,node])=>Date.parse(node.completedAt)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
 const file=path.join(root,id+'.pptx');if(!fs.existsSync(file)||fs.statSync(file).size<1000||project.deck.slides.length!==targetPages)throw Error('invalid native artifact');
 records.push({scenario,cache,iteration:iteration+1,E2E:(ready-start)/1000,Generation:(ready-genStart)/1000,TTFP:first?(first-Date.parse(generationAt))/1000:null,sourceChars:project.source?.text?.length||0,pages:project.pages,quality:project.quality.status,acceptedAt,trace:project.trace?.timestamps||null});
 console.log(JSON.stringify(records.at(-1)));
}
fs.writeFileSync(output,JSON.stringify({schemaVersion:1,environment:{node:process.version,model:'deterministic simulation, no imposed latency',renderer:'module Python native exporter on host',sandbox:false},records},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
