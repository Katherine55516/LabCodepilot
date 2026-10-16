// Actual UI + production model jobs. No API routes or model responses are mocked.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium,expect} from '@playwright/test';

const root=process.cwd(),base=process.env.PPT_LIVE_BASE||'http://127.0.0.1:3167';
const sourcePath=process.env.PPT_LIVE_SOURCE;
if(!sourcePath)throw Error('PPT_LIVE_SOURCE must name an original source file');
const out=path.resolve(process.env.PPT_LIVE_OUTPUT||'outputs/ppt-experience-quality-20261014/live/ui-live');
const serviceOutput=path.resolve(process.env.PPT_LIVE_SERVICE_OUTPUT||root+'/outputs/ppt-experience-quality-20261014/live');
const service=JSON.parse(fs.readFileSync(serviceOutput+'/service-ready.json','utf8'));
if(service.uid!=='ppt-report-implementation-real-ui')throw Error('Only the isolated QA account is allowed');
const text=fs.readFileSync(sourcePath,'utf8'),sourceHash=crypto.createHash('sha256').update(text).digest('hex');
const templateId=process.env.PPT_LIVE_TEMPLATE||'violet',quality=process.env.PPT_LIVE_QUALITY||'balanced';
if(!['fast','balanced','rigorous'].includes(quality))throw Error('Invalid quality level');
fs.mkdirSync(out,{recursive:true});
const events=[];
function log(value){const row={at:new Date().toISOString(),...value};events.push(row);fs.appendFileSync(out+'/events.jsonl',JSON.stringify(row)+'\n');console.log(JSON.stringify(value));}
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out+'/video',size:{width:1440,height:900}}});
const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[];
page.on('pageerror',error=>{errors.push(error.message);log({browserError:error.message});});
page.on('console',message=>{if(message.type()==='error'){const text=message.text().slice(0,1200);errors.push(text);log({browserConsoleError:text,resource:message.location().url?new URL(message.location().url,base).pathname:undefined});}});
const shot=async name=>{const result=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'/'+name+'.png',Buffer.from(result.data,'base64'));};
const api=async(method,route,body)=>{
 let response;for(let attempt=1;attempt<=3;attempt++){try{response=await page.request.fetch(base+'/api/ppt/'+route,{method,...(body?{data:body}:{}),timeout:60000});break;}catch(error){if(method!=='GET'||attempt===3||!/ECONNRESET|ECONNREFUSED|socket hang up|Timeout/u.test(error.message))throw error;log({readTransportRetry:attempt,route,errorClass:error.name});await page.waitForTimeout(attempt*500);}}
 const value=await response.json();if(!response.ok())throw Error(`${response.status()}: ${value.error}`);
 if(value.project?.uid&&value.project.uid!==service.uid)throw Error('UI is connected to a different account');
 return value;
};
const choose=async(label,value)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.locator(`[data-ppt-option-value="${value}"]`).click();};
let id=null,manual=null,paused=false,confirmed=false,last='',terminal=false;
page.on('response',async response=>{try{if(new URL(response.url()).pathname==='/api/ppt/projects'&&response.request().method()==='POST'){const value=await response.json();if(value.project?.id){id=value.project.id;fs.writeFileSync(out+'/project-id.json',JSON.stringify({id}));log({createdProject:id});}}}catch{}});
try{
 const resumedId=process.env.PPT_LIVE_PROJECT;if(resumedId&&!/^[a-f0-9]{32}$/.test(resumedId))throw Error('Invalid isolated project ID');
 // SSR buttons can precede hydration during cold development compilation.
 // Observe the real component effect's browser request before clicking them.
 const mounted=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/providers/models',{timeout:120000}).then(()=>null,error=>error);
 await page.goto(base+'/ppt'+(resumedId?'?projectId='+resumedId:''),{waitUntil:'domcontentloaded',timeout:180000});
 const mountError=await mounted;if(mountError)throw mountError;log({uiMounted:true,basis:'Actual model-catalog browser request from the mounted workspace'});
 // Creating is independent of a slow project list; verify the actual entry.
 await expect(page.getByRole('button',{name:'＋ 新建',exact:true})).toBeVisible({timeout:120000});
 if(resumedId){const prior=(await api('GET','projects/'+resumedId)).project;if(process.env.PPT_LIVE_REVIEW_RECORD){const dir=process.env.PPT_LIVE_REVIEW_RECORD,previous=JSON.parse(fs.readFileSync(dir+'/manifest.json','utf8'));if(previous.resumedFrom!==resumedId||previous.sourceHash!==sourceHash)throw Error('Prior UI edit evidence belongs to another source/project');const history=fs.readFileSync(dir+'/events.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));manual=history.find(row=>row.action==='actual UI resumes with saved manual style')?.manual;if(!manual)throw Error('Prior actual UI style evidence is missing');}
 if((prior.status!=='paused'&&!manual)||prior.source?.sha256!==sourceHash)throw Error('Resume requires the same unchanged source and a paused project or its recorded UI edit');id=resumedId;paused=true;confirmed=true;log({reopenedPausedProject:id,sourceHash});fs.writeFileSync(out+'/manifest.json',JSON.stringify({sourcePath,sourceHash,templateId,quality,backendCodeHash:service.codeHash,resumedFrom:id,simulation:false},null,2));}
 else{
 const template=(await api('GET','templates')).templates.find(row=>row.id===templateId);if(!template)throw Error('Requested actual template is unavailable');
 await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/粘贴文本/}).click();
 const dialog=page.getByRole('dialog',{name:'生成质量',exact:true});await expect(dialog).toBeVisible();
 const proceed=dialog.getByRole('button',{name:'确认并继续 →',exact:true});
 for(let attempt=0;attempt<3&&!await proceed.isEnabled();attempt++){
  await expect(dialog.getByRole('status')).toHaveCount(0,{timeout:65000});
  if(await proceed.isEnabled())break;
  const retry=dialog.getByRole('button',{name:'重新加载模型',exact:true});
  if(!await retry.count())throw Error('Quality gate is blocked without a model-catalog recovery action');
  log({modelCatalogRetry:attempt+1});await shot('model-catalog-retry-'+(attempt+1));await retry.click();
 }
 await dialog.getByRole('button',{name:new RegExp('^'+({fast:'快速',balanced:'均衡',rigorous:'严谨'})[quality])}).click();
 await expect(proceed).toBeEnabled({timeout:65000});await proceed.click();
 await page.getByTestId('ppt-template-browser').getByRole('button').filter({hasText:template.name}).first().click();
 await page.getByRole('button',{name:'下一步：输入内容 →',exact:true}).click();
 await choose('内容合同','full_source');await choose('输出语言','source-both');
 await page.getByRole('textbox',{name:'粘贴文本',exact:true}).fill(text);
 await shot('01-original-input');
 fs.writeFileSync(out+'/manifest.json',JSON.stringify({sourcePath,sourceHash,characters:text.length,templateId,templateHash:template.sha256,quality,backendCodeHash:service.codeHash,simulation:false},null,2));
 if(process.env.PPT_LIVE_INPUT_GATE_FILE){
  log({inputReady:true,waitingForSeparateBenchmark:true});const gateDeadline=Date.now()+15*60000;
  while(!fs.existsSync(process.env.PPT_LIVE_INPUT_GATE_FILE)&&Date.now()<gateDeadline)await page.waitForTimeout(1000);
  if(!fs.existsSync(process.env.PPT_LIVE_INPUT_GATE_FILE))throw Error('Input gate exceeded its bounded wait; no project was created');
 }
 await page.getByRole('button',{name:'读取输入并生成大纲',exact:true}).click();
 await expect.poll(()=>id,{timeout:60000}).not.toBeNull();
 }
 const deadline=Date.now()+30*60000;
 while(Date.now()<deadline){
  const p=(await api('GET','projects/'+id+'?view=live')).project;
  fs.writeFileSync(out+'/project-latest.json',JSON.stringify(p,null,2));
  const phases=Object.fromEntries(Object.entries(p.runtime?.slides||{}).map(([key,value])=>[key,value.phase]));
  const state=JSON.stringify({status:p.status,stage:p.stage,phases,draftChars:Object.values(p.drafts||{}).map(value=>value.chars)});
  if(state!==last){last=state;log({status:p.status,stage:p.stage,phases,draftChars:Object.values(p.drafts||{}).map(value=>value.chars)});await shot('state-'+String(events.length).padStart(3,'0'));}
  if(p.status==='outline_ready'&&!confirmed){
   await expect(page.getByRole('button',{name:'确认大纲并生成页面',exact:true})).toBeEnabled({timeout:30000});
   await page.getByRole('button',{name:'确认大纲并生成页面',exact:true}).click();confirmed=true;
  }
  const first=p.outline?.[0],ready=first&&p.nodes?.[first.id]?.status==='done';
  if(p.status==='generating'&&ready&&!paused){
   const pause=page.getByRole('button',{name:'暂停',exact:true}).first();
   await expect(pause).toBeEnabled({timeout:10000});await pause.click();paused=true;log({action:'actual UI pause after the first real page'});
  }
  if(p.status==='paused'&&paused&&!manual){
   await shot('02-retained-paused-draft');
   const editor=page.getByTestId('ppt-structured-editor');
   if(!await editor.count()){
    await page.getByRole('button',{name:new RegExp('^1[.、]')}).first().click();
    await page.getByRole('button',{name:'编辑页面',exact:true}).click();
   }
   await expect(editor).toBeVisible();
   await editor.getByRole('button').filter({hasText:'1. '+first.title}).first().click();
   const toolbar=page.getByTestId('ppt-text-toolbar');await expect(toolbar).toBeVisible();
   await toolbar.getByRole('button',{name:'选标题',exact:true}).click();
   await toolbar.getByRole('combobox',{name:'字体',exact:true}).selectOption('Arial');
   await toolbar.getByRole('spinbutton',{name:'字号',exact:true}).fill('32');
   const node=p.deck.slides.find(slide=>slide.id===first.id).nodes.find(node=>['title','template-title'].includes(node.semanticRole));
   if(!node)throw Error('The actual first-page title node is missing');
   await toolbar.getByRole('button',{name:'应用样式',exact:true}).click();
   await expect.poll(async()=>{const value=(await api('GET','projects/'+id+'?view=live')).project;return value.deck?.slides.find(slide=>slide.id===first.id)?.nodes.find(item=>item.id===node.id)?.style?.fontSizePt;},{timeout:30000}).toBe(32);
   manual={slideId:first.id,nodeId:node.id,fontFamily:'Arial',fontSizePt:32};await shot('03-paused-style-applied');
   const beforeReload=(await api('GET','projects/'+id)).project;
   await page.goto(base+'/ppt?projectId='+id,{waitUntil:'domcontentloaded',timeout:180000});
   const resume=page.getByRole('button',{name:/^继续生成$|^恢复生成$|^继续$/}).first();
   await expect(resume).toBeEnabled({timeout:120000});
   const restored=(await api('GET','projects/'+id)).project;
   expect(restored.status).toBe('paused');expect(restored.source.sha256).toBe(sourceHash);
   expect(restored.revision).toBeGreaterThanOrEqual(beforeReload.revision);
   const restoredNode=restored.deck.slides.find(slide=>slide.id===manual.slideId)?.nodes.find(item=>item.id===manual.nodeId);
   expect(restoredNode?.style?.fontFamily).toBe('Arial');expect(restoredNode?.style?.fontSizePt).toBe(32);
   expect(restored.editing?.epochs?.[manual.slideId]).toBe(beforeReload.editing?.epochs?.[manual.slideId]);
   await shot('03b-reloaded-paused-style');log({action:'actual browser reload preserves paused source and manual style',manual,revision:restored.revision});
   await resume.click();log({action:'actual UI resumes with saved manual style',manual});
  }
  if(['failed','quality_blocked','completed','cancelled'].includes(p.status)){
   terminal=true;const node=manual&&p.deck?.slides.find(slide=>slide.id===manual.slideId)?.nodes.find(item=>item.id===manual.nodeId);
   const stylePreserved=Boolean(manual&&node?.style?.fontFamily===manual.fontFamily&&node?.style?.fontSizePt===manual.fontSizePt);
   const passed=p.status==='completed'&&Boolean(p.publishedRevision)&&paused&&stylePreserved&&!errors.length;
   const artifacts={};
   if(p.status==='completed')for(const [route,extension]of[['export','pptx'],['pdf','pdf']]){
    const response=await page.request.get(base+'/api/ppt/projects/'+id+'/'+route,{timeout:180000});if(!response.ok())throw Error('Actual export failed '+response.status());
    const bytes=await response.body();fs.writeFileSync(out+'/actual.'+extension,bytes);artifacts[extension]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
   }
   await shot('04-terminal');const unchanged=crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')===sourceHash;
   fs.writeFileSync(out+'/result.json',JSON.stringify({passed:passed&&unchanged,id,status:p.status,error:p.error,paused,manual,stylePreserved,sourceUnchanged:unchanged,artifacts,browserErrors:errors,backendCodeHash:service.codeHash,realUi:true,realModel:true,visualReview:'pending'},null,2));
   if(!passed||!unchanged)process.exitCode=1;break;
  }
  await page.waitForTimeout(500);
 }
 if(!terminal)throw Error('Live UI acceptance exceeded its 30 minute bound');
}catch(error){log({failed:error.message,id});await shot('failure').catch(()=>{});fs.writeFileSync(out+'/failure-dom.txt',await page.locator('body').innerText().catch(()=>''));fs.writeFileSync(out+'/failure.json',JSON.stringify({id,error:error.message,events,browserErrors:errors},null,2));process.exitCode=1;}
finally{await context.close();await browser.close();}
