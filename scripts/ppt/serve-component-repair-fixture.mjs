import {prepareLocalPptFonts} from '../../apps/cowork-server/test/ppt-local-fonts.mjs';
/** Isolated real UI/backend for the recorded page; modelCall is a named fixture.
 * Does not read provider keys or touch running services and their profiles. */
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {spawn,execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
import {createPptHttpHarness} from '../../apps/cowork-server/test/ppt-http-harness.mjs';
import {scopeReview} from '../../apps/cowork-server/ppt-scope-test-helpers.mjs';
const [input,output]=process.argv.slice(2),out=path.resolve(output),root=process.cwd(),port=Number(process.env.PPT_COMPONENT_UI_PORT||3179),backendPort=Number(process.env.PPT_COMPONENT_BACKEND_PORT||3178);
if(!input||!output||[3141,3143,3157].includes(port)||[3141,3143,3157].includes(backendPort))throw Error('Use a snapshot, private output and isolated ports');
if(process.env.PPT_COMPONENT_BACKEND_ONLY!=='1')await new Promise((r,j)=>{const s=net.createServer();s.on('error',j);s.listen(port,'127.0.0.1',()=>s.close(r));});
fs.mkdirSync(out,{recursive:true});prepareLocalPptFonts(out);process.env.CLAUDE_GUI_DATA_DIR=process.env.PPT_COMPONENT_PROFILE||out+'/profile';delete process.env.CLAUDE_GUI_SECRET_KEY;
const p=JSON.parse(fs.readFileSync(input,'utf8')).project;
const h=await createPptHttpHarness({root:out,uid:p.uid,port:backendPort,python:process.env.PPT_TEST_PYTHON,modelCall:async(project,prompt,_a,_l,o={})=>{
 if(prompt.includes('<fill_components>')){const containers=JSON.parse(prompt.split('\nContainers: ')[1].split('\nInstruction:')[0]),points=JSON.parse(prompt.split('\nPoints: ')[1].split('\nContainers:')[0]),texts=['研究员 / LLM\n→ 候选卡片','候选卡片 → 编译器\n→ 开发集上的评估器','冻结候选\n→ 独立外部测试评估器\n→ 决策记录'];return{components:containers.map((c,i)=>({id:c.id,text:texts[i],pointIds:[points[i===2?1:0].id]}))};}
 if(prompt.includes('<card_point_coverage_audit>')){const objects=JSON.parse(prompt.split('\nVisible: ')[1].split('\n</card_point_coverage_audit>')[0]),points=JSON.parse(prompt.split('\nReviewed: ')[1].split('\nSources:')[0]),text=objects.map(n=>n.text).join('\n');return{unsupported:[],points:points.map((pt,i)=>({id:pt.id,preserved:(i===0?['LLM','候选','编译','开发']:['冻结','独立','外部测试','决策']).every(t=>text.includes(t)),nodeIds:objects.map(n=>n.id),quotes:objects.map(n=>n.text),reason:'Named recorded fixture: both source process chains retain their ordered stages and independent frozen outer-test boundary.'}))};}
 if(String(o.nodeKey).startsWith('review:'))return scopeReview(project);
 throw Error('No model fixture registered for '+o.nodeKey);
}});
const repo=await import('../../apps/cowork-server/lib/ppt/repository.mjs');const original=out+'/original-template.pptx';fs.copyFileSync(p.templateFidelity.originalPath,original);p.templateFidelity.originalPath=original;
const templateDir=path.join(out,'state','ppt',p.uid,'templates');fs.mkdirSync(templateDir,{recursive:true});fs.copyFileSync(original,path.join(templateDir,p.template+'.bin'));
repo.saveProject(p);repo.saveRevision(p,'isolated UI baseline');
const db=createRequire(import.meta.url)(root+'/src/lib/db.ts');for(const[k,v]of Object.entries({current_user_uid:h.uid,cowork_remote_url:h.base,cowork_remote_token:h.token,locale:'zh'}))db.setSetting(k,v);db.closeDb();
if(process.env.PPT_COMPONENT_BACKEND_ONLY==='1'){
const data={base:'http://127.0.0.1:'+port,backend:h.base,pid:process.pid,projectId:p.id,basis:'isolated backend, existing private UI profile, simulated modelCall, real native export'};fs.writeFileSync(out+'/service.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void h.close());
}else{
const fd=fs.openSync(out+'/next.log','a'),child=spawn(process.execPath,[root+'/node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,CODEPILOT_NEXT_DIST_DIR:'.next-ppt-fixture-dev-'+port,PPT_FIXTURE_NO_WEBPACK_CACHE:'1'},stdio:['ignore',fd,fd]}),owned=new Set([child.pid]);
const capture=()=>{const rows=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));for(let change=true;change;){change=false;for(const[pid,ppid]of rows)if(owned.has(ppid)&&!owned.has(pid)){owned.add(pid);change=true;}}};
let closing=false;async function close(){if(closing)return;closing=true;capture();for(const pid of [...owned].reverse())try{process.kill(pid,'SIGTERM');}catch{}await h.close();fs.closeSync(fd);}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void close());child.on('exit',()=>void close());
const data={base:'http://127.0.0.1:'+port,backend:h.base,pid:process.pid,projectId:p.id,basis:'isolated state, actual application, simulated modelCall, real native export'};fs.writeFileSync(out+'/service.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data));

}
