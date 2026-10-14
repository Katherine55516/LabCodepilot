import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn, spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const state=path.join(root,'outputs/ppt-manual-testing');
const configPath=path.join(state,'launch-config.json');
const pidPath=path.join(state,'managed-service.json');
const command=process.argv[2]||'start';
const noOpen=process.argv.includes('--no-open');
const supported=new Set(['start','status','stop','check-llm']);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const require=createRequire(import.meta.url);
let config;

function loadConfig(){
  if(!fs.existsSync(configPath))throw Error('缺少本机启动配置：'+configPath);
  const value=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(value.url!=='http://127.0.0.1:3141/ppt'||value.backendPort!==3140||value.frontendPort!==3141)throw Error('启动配置的测试端口必须为 3140/3141。');
  return value;
}
function listener(port){
  const result=spawnSync('/usr/sbin/lsof',['-nP','-t','-iTCP:'+port,'-sTCP:LISTEN'],{encoding:'utf8'});
  return [...new Set(result.stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
}
function processCommand(pid){
  const result=spawnSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
  return result.status===0?result.stdout.trim():'';
}
function compatibleBackend(pid){
  const cmd=processCommand(pid);
  if(![config.serviceScript,...(config.compatibleServiceScripts||[])].some(script=>cmd.includes(script)))return false;
  const cwd=spawnSync('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'}).stdout;
  return cwd.split('\n').includes('n'+root);
}
async function healthy(){
  try{
    const page=await fetch(config.url,{signal:AbortSignal.timeout(8000)});
    if(!page.ok)return false;
    const response=await fetch(new URL('/api/ppt/projects',config.url),{signal:AbortSignal.timeout(10000)});
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))return false;
    const body=await response.json();
    return Array.isArray(body.projects);
  }catch{return false;}
}
function masterKey(){
  if(process.platform!=='darwin')throw Error('此本机脚本使用 macOS 钥匙串。');
  const result=spawnSync('/usr/bin/security',['find-generic-password','-s',config.credentialService,'-a',config.credentialAccount||os.userInfo().username,'-w'],{encoding:'utf8'});
  const key=result.status===0?result.stdout.trim():'';
  if(!/^[a-f0-9]{64}$/i.test(key))throw Error('无法读取现有开发钥匙串密钥；请解锁钥匙串。现有配置不会被替换。');
  return key;
}
function modelMetadata(live){
  process.env.CLAUDE_GUI_SECRET_KEY=masterKey();
  process.env.CLAUDE_GUI_DATA_DIR=live?path.join(config.env.PPT_IMPLEMENTATION_OUTPUT,'profile'):config.env.CLAUDE_GUI_DATA_DIR;
  const db=require(path.join(root,'src/lib/db.ts'));
  try{
    const providerId=db.getSetting('global_default_model_provider');
    const provider=db.getProvider(providerId);
    const model=config.env.PPT_LLM_MODEL||db.getSetting('global_default_model');
    if(!provider?.api_key||provider.api_key.startsWith('sealed:')||!model)throw Error('现有配置中未找到可解密的默认 LLM/API Key；请在 API 设置中完成配置。');
    if(provider.source==='managed')throw Error('当前配置不是本地 BYOK；请选择现有本地 API provider。');
    return {providerId,model,protocol:provider.protocol,baseUrl:provider.base_url,providerName:provider.name};
  }finally{db.closeDb();}
}
function openPage(){
  if(!noOpen)spawnSync('/usr/bin/open',['-a','Google Chrome',config.url],{stdio:'ignore'});
}
function managedPid(){
  if(!fs.existsSync(pidPath))return null;
  const record=JSON.parse(fs.readFileSync(pidPath,'utf8'));
  return record.root===root&&Number.isInteger(record.pid)&&compatibleBackend(record.pid)?record.pid:null;
}
async function start(){
  const back=listener(config.backendPort),front=listener(config.frontendPort);
  if(back.length||front.length){
    if(back.length!==1||front.length!==1||!compatibleBackend(back[0]))throw Error('3140/3141 被其他或未完整启动的服务占用；未停止已有进程。');
    if(!await healthy())throw Error('已有服务尚未就绪或不可用；请先检查服务日志，未重复启动。');
    const meta=modelMetadata(true);
    console.log('复用已运行的 PPT 服务；真实 LLM：'+meta.model);
    console.log(config.url);
    openPage();return;
  }
  if(Number(process.versions.node.split('.')[0])<22)throw Error('请使用 Node.js 22 或更新版本。');
  for(const file of [path.join(root,'node_modules/next/dist/bin/next'),path.join(root,config.serviceScript)])if(!fs.existsSync(file))throw Error('缺少运行依赖：'+file);
  const build=path.join(config.env.PPT_NEXT_SOURCE,config.env.PPT_NEXT_DIST_DIR,'BUILD_ID');
  if(config.env.PPT_NEXT_MODE==='production'&&!fs.existsSync(build))throw Error('缺少已经构建的前端快照：'+build);
  const meta=modelMetadata(false);
  const env={...process.env,...config.env,PPT_LLM_MODEL:meta.model};
  // Encrypted API credentials remain in the existing DB; the master key only
  // reaches child memory through its environment and is never printed/saved.
  const logPath=path.join(state,'service.log');
  const fd=fs.openSync(logPath,'a',0o600);
  const child=spawn(process.execPath,['--import','tsx',path.join(root,config.serviceScript)],{cwd:root,env,detached:true,stdio:['ignore',fd,fd]});
  fs.closeSync(fd);
  child.unref();
  fs.writeFileSync(pidPath,JSON.stringify({pid:child.pid,root,startedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
  console.log('正在启动 PPT 服务；真实 LLM：'+meta.model);
  let ready=false;
  for(let attempt=0;attempt<90;attempt++){
    if(await healthy()){ready=true;break;}
    if(!processCommand(child.pid))break;
    await pause(1000);
  }
  if(!ready){
    // Only clean up the child this invocation created.
    if(compatibleBackend(child.pid))process.kill(child.pid,'SIGTERM');
    fs.rmSync(pidPath,{force:true});
    throw Error('启动未就绪，详情见 '+logPath);
  }
  console.log('页面已就绪；关闭此终端或 Chrome 不会停止服务。');
  console.log(config.url);
  openPage();
}
async function checkLlm(){
  await start();
  const meta=modelMetadata(true);
  console.log('正在发送最小真实模型连接请求：'+meta.model);
  const response=await fetch(new URL('/api/providers/test',config.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:meta.providerId,protocol:meta.protocol,baseUrl:meta.baseUrl,modelName:meta.model}),signal:AbortSignal.timeout(180000)});
  const result=await response.json();
  if(!response.ok||result.success!==true)throw Error('真实 LLM 连接失败；请在页面 API 设置的连接测试中查看具体错误。');
  console.log('真实 LLM 连接测试通过：'+meta.model);
  fs.writeFileSync(path.join(state,'llm-check.json'),JSON.stringify({at:new Date().toISOString(),success:true,model:meta.model,providerId:meta.providerId,protocol:meta.protocol,basis:'Production /api/providers/test sends a real model request using the configured encrypted DB credential.'},null,2)+'\n',{mode:0o600});
}
async function main(){
  if(!supported.has(command))throw Error('用法：start-manual-test.command [start|status|check-llm|stop] [--no-open]');
  config=loadConfig();
  if(command==='start')return start();
  if(command==='check-llm')return checkLlm();
  if(command==='status'){
    if(!await healthy())throw Error('PPT 服务未就绪；运行 start 启动。');
    const meta=modelMetadata(true);
    console.log('PPT 页面/API 就绪；已配置真实 LLM：'+meta.model+'。');
    console.log('如需验证当前上游连接，运行 check-llm。');
    console.log(config.url);return;
  }
  const pid=managedPid();
  if(!pid){console.log('没有此脚本启动的服务；已有其他测试服务保持运行。');return;}
  process.kill(pid,'SIGTERM');
  for(let n=0;n<30&&processCommand(pid);n++)await pause(200);
  if(listener(config.backendPort).includes(pid))throw Error('服务仍在停止中，请稍后查看 status。');
  fs.rmSync(pidPath,{force:true});console.log('本脚本启动的服务已停止；测试项目和模型配置保留。');
}
try{await main();}catch(error){console.error('PPT 启动器：'+error.message);process.exitCode=1;}
