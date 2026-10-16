// Real-model acceptance through the actual UI. No model or PPT API substitutes.
import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';import {chromium,expect}from'@playwright/test';
const slug=process.env.PPT_CASE||'gamma';
const out=path.resolve(process.env.PPT_GAMMA_TEST_OUTPUT||'outputs/ppt-round7-20261013/live/'+slug),base=process.env.PPT_TEST_BASE||'http://127.0.0.1:3147';
const sourcePath=process.env.PPT_SOURCE_PATH||'/Users/dongli/Documents/ChatGPT/CodePilot/gamma.md',templatePath=process.env.PPT_TEMPLATE_PATH||'/Users/dongli/Desktop/Spatial_omics/templates/Copy-of-Deal-Review (1).pptx';
fs.mkdirSync(out,{recursive:true});
const log=x=>{const line=JSON.stringify({at:new Date().toISOString(),...x});fs.appendFileSync(out+'/ui-events.jsonl',line+'\n');console.log(line);};
let ready=false;for(let n=0;n<120;n++){try{const r=await fetch(base+'/api/ppt/projects',{signal:AbortSignal.timeout(10000)});if(r.ok&&r.headers.get('content-type')?.includes('application/json')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Production PPT API did not become ready; no model acceptance started');
log({action:'Round 7 readiness reached; launch actual Chrome CDP'});
const host=await chromium.launch({channel:'chrome',headless:true}),browser=host;
log({action:'Chrome CDP connected'});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[];
page.on('pageerror',e=>{errors.push(e.message);log({browserError:e.message});});
const api=async(method,route,data)=>{for(let n=0;;n++){
 let r;try{r=await page.request.fetch(base+'/api/ppt/'+route,{method,...(data?{data}:{}),timeout:method==='GET'?30000:180000});}
 catch(error){if(method==='GET'&&n<8&&/ECONNREFUSED|ECONNRESET|socket hang up|Timeout/.test(error.message)){log({transientConnectionRetry:n+1,route});await new Promise(resolve=>setTimeout(resolve,2000));continue;}throw error;}
 if(r.ok())return r.json();if(method==='GET'&&[502,503,504].includes(r.status())&&n<20){log({transientReadRetry:n+1,route,http:r.status()});await new Promise(resolve=>setTimeout(resolve,2000));continue;}throw Error(method+' '+route+' HTTP '+r.status());
}};
let capturePending=false;
const shot=async(name)=>{if(capturePending)return;capturePending=true;let timer;try{const image=await Promise.race([cdp.send('Page.captureScreenshot',{format:'png'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Chrome capture timed out')),10000);})]);fs.writeFileSync(out+'/'+name+'.png',Buffer.from(image.data,'base64'));}catch(error){log({screenshotDeferred:name,reason:error.message});}finally{clearTimeout(timer);capturePending=false;}};
const choose=async(label,value)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.locator('[data-ppt-option-value="'+value+'"]').click();};
let projectId=null;
page.on('response',async response=>{try{if(new URL(response.url()).pathname.replace(/\/$/,'')==='/api/ppt/projects'&&response.request().method()==='POST'){const body=await response.json();if(body.project?.id){projectId=body.project.id;fs.writeFileSync(out+'/project-id.json',JSON.stringify({id:projectId}));log({createdProject:projectId});}}}catch{}});
try{
 const checkpoint=out+'/project-id.json';
 if(fs.existsSync(checkpoint)){projectId=JSON.parse(fs.readFileSync(checkpoint)).id;await page.goto(base+'/ppt?projectId='+projectId,{waitUntil:'domcontentloaded',timeout:90000});}
 else{
  const upload=await page.request.post(base+'/api/ppt/templates?fileName='+encodeURIComponent(path.basename(templatePath)),{headers:{'content-type':'application/octet-stream'},data:fs.readFileSync(templatePath),timeout:180000});
  if(!upload.ok())throw Error('Template upload HTTP '+upload.status());const template=(await upload.json()).template;
  await page.goto(base+'/ppt',{waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.locator('main.ppt-workspace-shell')).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:/新建$/}).first().click();await page.getByRole('button',{name:/粘贴文本/}).click();
  await expect(page.getByRole('dialog',{name:'先选择 LLM'})).toBeVisible();
  const combo=page.getByRole('combobox',{name:'LLM（必填）'});await combo.click();await page.getByRole('option',{name:/qwen3.8-max/}).first().click();
  await page.getByRole('button',{name:'确认并继续 →'}).click();
  await expect(page.getByTestId('ppt-template-browser')).toBeVisible();
  await page.getByTestId('ppt-template-browser').getByRole('button').filter({hasText:template.name}).first().click();await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
  await choose('内容合同','overview');await choose('完整细节去向','notes');await choose('输出语言','source');
  const sourceRule=page.locator('label').filter({hasText:/^来源使用规则/}).getByRole('combobox');await sourceRule.click();await page.locator('[data-ppt-option-value="source_only"]').click();
  const text=fs.readFileSync(sourcePath,'utf8');await page.getByRole('textbox',{name:'粘贴文本',exact:true}).fill(text);
  await shot('01-original-input');
  fs.writeFileSync(out+'/manifest.json',JSON.stringify({sourcePath,sourceSha256:crypto.createHash('sha256').update(text).digest('hex'),sourceCharacters:text.length,sourceBytes:Buffer.byteLength(text),templatePath,templateId:template.id,templateSha256:crypto.createHash('sha256').update(fs.readFileSync(templatePath)).digest('hex'),model:'qwen3.8-max',policy:{content:'overview',details:'notes',language:{mode:'source'},knowledge:'source_only'},simulation:false,transport:'Actual Round 7 Chrome CDP UI; authenticated production API and AppShell BYOK model worker'},null,2));
  const analyze=page.getByRole('button',{name:'读取输入并生成大纲',exact:true});await expect(analyze).toBeEnabled({timeout:60000});await analyze.click();log({action:'actual UI read source and generate outline'});
  for(let n=0;n<60&&!projectId;n++)await page.waitForTimeout(1000);if(!projectId){log({creationAlerts:await page.getByRole('alert').allInnerTexts()});await shot('creation-failed');throw Error('UI did not create project');}
 }
 let terminal=false,last='',lastDraft='',generating=false,retries=0;const started=Date.now(),deadline=Date.now()+90*60000;
 while(Date.now()<deadline){
  const p=(await api('GET','projects/'+projectId+'?view=live')).project;fs.writeFileSync(out+'/project-latest.json',JSON.stringify(p,null,2));
  const state=p.status+':'+p.stage+':'+Object.values(p.nodes||{}).filter(n=>n.status==='done').length;
  if(state!==last){log({state,pages:p.pages,error:p.error,failure:p.failure,elapsedSeconds:Math.round((Date.now()-started)/1000)});last=state;await shot('state-'+state.replace(/[^a-z0-9_-]/gi,'-'));}
  const drafts=p.drafts||{},draftKey=JSON.stringify(Object.entries(drafts).map(([id,d])=>[id,d.blocks?.length,d.chars]));
  if(draftKey!==lastDraft&&Object.keys(drafts).length){lastDraft=draftKey;fs.appendFileSync(out+'/draft-events.jsonl',JSON.stringify({at:new Date().toISOString(),drafts})+'\n');if(await page.getByTestId('ppt-generation-skeleton').count())await shot('draft-'+Date.now());}
  if(p.status==='outline_ready'&&!generating){
   fs.writeFileSync(out+'/accepted-outline.json',JSON.stringify(p,null,2));
   if(process.env.PPT_STOP_AT_OUTLINE==='1'){terminal=true;fs.writeFileSync(out+'/result.json',JSON.stringify({id:projectId,status:p.status,pages:p.pages,createdAt:p.createdAt,acceptedAt:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-started)/1000),manualRetries:retries,realUi:true,realModel:true,browserErrors:errors},null,2));log({finished:'outline_ready',firstAttempt:retries===0});break;}
   const confirm=page.getByRole('button',{name:'确认大纲并生成页面',exact:true});
   if(await confirm.count()){await confirm.click();log({action:'actual UI confirms accepted outline'});}else{const start=page.getByRole('button',{name:/确认.*生成|生成 PPT/}).first();await expect(start).toBeEnabled({timeout:30000});await start.click();log({action:'actual UI confirms retained accepted outline'});}
   generating=true;
  }
  if(p.status==='failed'&&retries<Number(process.env.PPT_LIVE_RETRIES||'0')){retries++;log({retry:retries,failedStage:p.stage,error:p.error});await api('POST','projects/'+projectId+'/retry',{});await page.goto(base+'/ppt?projectId='+projectId,{waitUntil:'domcontentloaded',timeout:90000});generating=false;continue;}
  if(p.status==='paused'){await api('POST','projects/'+projectId+'/resume',{});continue;}
  if(['completed','quality_blocked','failed','cancelled'].includes(p.status)){
   const result={id:projectId,status:p.status,stage:p.stage,error:p.error,failure:p.failure,pages:p.pages,revision:p.revision,publishedRevision:p.publishedRevision,quality:p.quality,browserErrors:errors,realUi:true,realModel:true};
   if(p.status==='completed'&&p.publishedRevision)for(const[route,name]of[['export',''+slug+'.pptx'],['pdf',''+slug+'.pdf']]){const response=await page.request.get(base+'/api/ppt/projects/'+projectId+'/'+route,{timeout:180000});if(!response.ok())throw Error('Published export HTTP '+response.status());fs.writeFileSync(out+'/'+name,await response.body());}
   terminal=true;fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));log({finished:p.status});if(p.status!=='completed')process.exitCode=1;break;
  }
  await page.waitForTimeout(5000);
 }
 if(!terminal)throw Error('Real-model acceptance exceeded 90 minutes without a terminal result');
}catch(error){await shot('harness-error').catch(()=>{});fs.writeFileSync(out+'/ui-harness-error.json',JSON.stringify({error:error.message,projectId,errors},null,2));log({harnessError:error.message,projectId});throw error;}
finally{await host.close();}
