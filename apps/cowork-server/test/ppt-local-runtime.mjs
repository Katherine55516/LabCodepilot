/** Test transport only. Uses the exact production parsers/exporters and payloads. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {PYTHON_STDIN_ARGS,pythonStdinInput} from '../lib/ppt-python-stdin.mjs';
export function localPptRuntime(root,python=process.env.PPT_TEST_PYTHON||'python3') {
  const workspace=project=>path.join(root,project.id||'template');
  const host=(project,value)=>typeof value==='string'&&value.startsWith('/workspace/')?path.join(workspace(project),value.slice('/workspace/'.length)):value;
  const io={runPython:async(project,script,input,extra={})=>{
    fs.mkdirSync(workspace(project),{recursive:true});
    const env={...process.env,PPT_OUTPUT:host(project,project.renderOutput||'/workspace/presentation.pptx'),PPT_EXTERNAL_DIR:path.join(workspace(project),'external'),PPT_SOURCE_DIR:path.join(workspace(project),'sources')};
    for(const [name,value] of Object.entries(extra))env[name]=host(project,value);
    if(env.PPT_OUTPUT)fs.mkdirSync(path.dirname(env.PPT_OUTPUT),{recursive:true});
    return new Promise((resolve,reject)=>{
      const child=spawn(python,[...PYTHON_STDIN_ARGS],{env});let out='',err='';
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('local production Python timeout'));},180000);
      child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data',data=>{out+=data;if(out.length>32000000){child.kill();reject(new Error('local output budget exceeded'));}});
      child.stderr.on('data',data=>err=(err+data).slice(-10000));
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(err));try{resolve(JSON.parse(out));}catch{reject(new Error('Invalid production Python response '+out.slice(-200)));}});
      child.stdin.on('error',()=>{});child.stdin.end(pythonStdinInput(script,input));
    });
  }};
  const writeFile=async(id,name,stream,_bytes,uid)=>{const project={id,uid},chunks=[];for await(const chunk of stream)chunks.push(chunk);const filename=path.join(workspace(project),name);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,Buffer.concat(chunks));return filename;};
  return {io,writeFile,readFile:async(id,value)=>fs.readFileSync(host({id},value)),host,workspace};
}
/** spawnSync(python, ['-c', script, ...args], options) without the per-argument size limit. */
export function spawnPythonSync(python,script,args=[],options={}) {
  return spawnSync(python,[...PYTHON_STDIN_ARGS,...args],{...options,input:pythonStdinInput(script,options.input)});
}
