// Run account-isolated PPT domain selftests against this checkout. Individual
// output and failure records are kept, including timeouts and exit signals.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
const root=process.cwd(),out=path.resolve(process.env.PPT_SELFTEST_OUTPUT||'outputs/ppt-experience-quality-20261014/domain-full');fs.mkdirSync(out,{recursive:true});
// Bind every domain result to the same production module identity used by
// manual-test-service. A green test list cannot certify a changing checkout.
function codeSnapshot(){const files=[];const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.mjs'))files.push(file);}};walk(root+'/apps/cowork-server/lib');files.push(root+'/src/lib/ppt-desktop-model-worker.ts',root+'/src/lib/ai-provider.ts');const manifest=Object.fromEntries(files.sort().map(file=>[path.relative(root,file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));return {codeHash:crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),files:manifest};}
const startCode=codeSnapshot();let codeUnchanged=true;fs.writeFileSync(out+'/code-start.json',JSON.stringify(startCode,null,2));
const selected=process.env.PPT_SELFTEST_FILTER?new RegExp(process.env.PPT_SELFTEST_FILTER):null;
const files=fs.readdirSync(root+'/apps/cowork-server').filter(name=>/^selftest-ppt-.*\.mjs$/.test(name)&&(!selected||selected.test(name))).sort();
const results=[],started=Date.now();let next=0;
async function worker(){while(next<files.length){const name=files[next++],file=path.join(root,'apps/cowork-server',name),fd=fs.openSync(path.join(out,name+'.log'),'w'),begin=Date.now();
 const testHashStart=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const artifactDir=path.join(out,'artifacts',name);
 const child=spawn(process.execPath,['--import','tsx',file],{cwd:root,env:{...process.env,PPT_TEST_PYTHON:process.env.PPT_TEST_PYTHON||'python3',COWORK_STATE_DIR:path.join(out,'state',name),PPT_BENCH_OUTPUT:artifactDir,PPT_PARAGRAPH_OUTPUT:artifactDir},stdio:['ignore',fd,fd]});let timedOut=false;
 const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},Number(process.env.PPT_SELFTEST_TIMEOUT_MS||900000));
 const result=await new Promise(resolve=>{child.on('error',error=>resolve({exitCode:null,error:error.message}));child.on('exit',(exitCode,signal)=>resolve({exitCode,signal}));});clearTimeout(timeout);fs.closeSync(fd);
 const currentCode=codeSnapshot();codeUnchanged&&=currentCode.codeHash===startCode.codeHash;const testHashEnd=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const skipped=result.exitCode===77&&!timedOut;
 const record={name,...result,timedOut,skipped,passed:result.exitCode===0&&!timedOut&&testHashStart===testHashEnd,elapsedMs:Date.now()-begin,testHash:testHashStart,testHashEnd,productionCodeHash:currentCode.codeHash,matchesStartCode:currentCode.codeHash===startCode.codeHash};results.push(record);fs.writeFileSync(out+'/results.json',JSON.stringify({at:new Date().toISOString(),elapsedMs:Date.now()-started,codeHash:startCode.codeHash,codeUnchanged,total:files.length,finished:results.length,passed:results.filter(x=>x.passed).length,skipped:results.filter(x=>x.skipped).length,results},null,2));console.log(JSON.stringify(record));
}}
await Promise.all(Array.from({length:Math.min(2,Number(process.env.PPT_SELFTEST_WORKERS||1))},worker));const finishCode=codeSnapshot();codeUnchanged&&=finishCode.codeHash===startCode.codeHash;fs.writeFileSync(out+'/code-finish.json',JSON.stringify(finishCode,null,2));fs.writeFileSync(out+'/results.json',JSON.stringify({at:new Date().toISOString(),elapsedMs:Date.now()-started,codeHash:startCode.codeHash,finishedCodeHash:finishCode.codeHash,codeUnchanged,total:files.length,finished:results.length,passed:results.filter(x=>x.passed).length,skipped:results.filter(x=>x.skipped).length,results},null,2));if(!codeUnchanged)console.log(JSON.stringify({event:'production_code_changed_during_run',startedCodeHash:startCode.codeHash,finishedCodeHash:finishCode.codeHash}));if(!codeUnchanged||results.some(row=>!row.passed))process.exitCode=1;
