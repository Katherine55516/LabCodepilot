import fs from 'node:fs';
import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';
import {selectPptOption,writeCardOutline} from '../helpers';
test.setTimeout(120000);
async function capture(page:Page,info:TestInfo,name:string){const cdp=await page.context().newCDPSession(page);const result=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(info.outputPath(name),Buffer.from(result.data,'base64'));await cdp.detach();}
async function enter(page:Page){await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();await page.getByRole('button',{name:'确认并继续 →',exact:true}).click();await page.getByRole('button',{name:/Teaching template/}).click();await page.getByRole('button',{name:'下一步：输入内容 →',exact:true}).click();}
async function fixturePage(page:Page,options:{hold?:boolean;failProjects?:boolean;unavailable?:boolean;failFolders?:boolean;failDefaults?:boolean;failModels?:boolean;holdModels?:Promise<void>;holdProjects?:Promise<void>;templateObjects?:boolean}={}){
 const fixture=pptParityFixture({holdOutline:options.hold});let failing=Boolean(options.failProjects),unavailable=Boolean(options.unavailable),foldersFailing=Boolean(options.failFolders),modelsFailing=Boolean(options.failModels);
 const errors:string[]=[],network:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>network.push(r.url()+' '+r.failure()?.errorText));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),data=req.postData()?req.postDataJSON():{};
  if(url.pathname==='/api/providers/models'&&options.holdModels)await options.holdModels;
  if(url.pathname==='/api/providers/models'&&modelsFailing)return route.fulfill({status:503,json:{error:'Model catalog temporarily unavailable'}});
  if(url.pathname==='/api/providers/models'&&unavailable)return route.fulfill({json:{groups:[{provider_id:'managed-demo',models:[{value:'demo-model',label:'Demo LLM',capabilities:{ppt:{health:'unavailable'}}}]}]}});
  if(url.pathname==='/api/ppt/projects'&&req.method()==='GET'&&failing)return route.fulfill({status:503,json:{error:'Project list temporarily unavailable'}});
  if(url.pathname==='/api/ppt/folders'&&foldersFailing)return route.fulfill({status:400,json:{error:'Folder list temporarily unavailable'}});
  if(options.failDefaults&&url.pathname==='/api/providers/options')return route.fulfill({status:503,json:{error:'Optional defaults unavailable'}});
  if(options.templateObjects&&url.pathname==='/api/ppt/templates/light'&&url.searchParams.get('view')==='objects')return route.fulfill({json:{size:{width:1000,height:600},objects:[{id:'old-background',page:1,kind:'image',name:'Old report background',text:'Old revenue',geometry:{x:0,y:0,width:1000,height:600}},{id:'brand-logo',page:1,kind:'image',name:'Brand logo',text:'',geometry:{x:50,y:40,width:120,height:60}},{id:'fixed-footer',page:2,kind:'text',name:'Company footer',text:'Confidential',geometry:{x:30,y:550,width:600,height:40}}]}});
  const result=await fixture.handle(req.method(),url.pathname,data);if(!result)return route.continue();
  if(options.holdProjects&&url.pathname==='/api/ppt/projects'&&req.method()==='GET'&&!url.searchParams.has('trash'))await options.holdProjects;
  if(options.templateObjects&&url.pathname==='/api/ppt/templates'&&req.method()==='GET')for(const template of (result.body as {templates:{kind:string}[]}).templates)template.kind='uploaded';
  // A card outline still being written: fifty cards pending.
  // A fresh read goes straight on to write the outline (2026-10-31): held, it forms fifty topics.
  if(options.hold&&url.pathname==='/api/ppt/projects'&&req.method()==='POST'&&result.status===201){
   const project=fixture.projects.get((result.body as {project:{id:string}}).project.id)! as unknown as {outlineForming:{syllabus:unknown[];total:number}};
   project.outlineForming={...project.outlineForming,total:50,syllabus:Array.from({length:50},(_,k)=>({id:`forming_${k}`,title:`Topic ${k+1}`,points:[],pending:true}))};
  }
  if(options.hold&&url.pathname.endsWith('/planning')&&data.command==='outline'){
   const project=fixture.projects.get(url.pathname.split('/')[4])! as unknown as {planningContract:Record<string,unknown>;outline:unknown[]};
   Object.assign(project,{status:'outlining',stage:'outline',outline:[]});Object.assign(project.planningContract,{phase:'expanding',writing:{pages:50}});
  }
  return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto('/ppt',{waitUntil:'domcontentloaded'});
 if(!options.holdProjects)await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0,{timeout:30000});
 await expect(page.getByRole('button',{name:'＋ 新建',exact:true})).toBeVisible({timeout:30000});
 return {fixture,errors,network,recover:()=>{failing=false;unavailable=false;foldersFailing=false;modelsFailing=false;},failModels:()=>{modelsFailing=true;}};
}
test('quality chosen with the model reaches the confirmed card outline and the input is read once @smoke',async({page},info)=>{
 const {fixture,errors}=await fixturePage(page);
 await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();
 await page.getByTestId('ppt-quality-settings').locator('summary').filter({hasText:'高级：执行策略'}).click();await page.getByRole('button',{name:/^严谨/}).click();await page.getByRole('button',{name:'确认并继续 →',exact:true}).click();
 await page.getByRole('button',{name:/Teaching template/}).click();await page.getByRole('button',{name:'下一步：输入内容 →',exact:true}).click();
 await page.getByRole('textbox',{name:'输入 Prompt',exact:true}).fill('Create a presentation about release gates and source evidence.');
 await writeCardOutline(page);expect(fixture.payloads.filter(p=>p.inputKind==='prompt')).toHaveLength(1);
 await page.getByTestId('ppt-card-actions').getByRole('button',{name:'生成',exact:true}).click();
 await expect.poll(()=>fixture.payloads.findLast(p=>p.action==='outline')?.executionPolicy?.qualityLevel).toBe('rigorous');
 await capture(page,info,'quality-confirmed-cdp.png');expect(errors).toEqual([]);
});
test('fifty cards being written keep the outline actions reachable at short and zoom-equivalent viewports @smoke',async({page},info)=>{
 const {errors}=await fixturePage(page,{hold:true});await enter(page);await page.getByRole('textbox',{name:'输入 Prompt',exact:true}).fill('Keep all release conditions and source evidence.');
 await page.getByRole('button',{name:'继续：生成大纲',exact:true}).click();
 const outline=page.getByTestId('ppt-card-outline');await expect(page.getByTestId('ppt-card-list').locator('[data-pending]')).toHaveCount(50);
 for(const viewport of [{width:390,height:360},{width:720,height:450},{width:1440,height:900}]){
  await page.setViewportSize(viewport);const footer=page.getByTestId('ppt-card-actions'),close=outline.getByRole('button',{name:'关闭',exact:true});await expect(close).toBeEnabled();
  const box=await footer.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);
  expect(await outline.locator(':scope > div.overflow-auto').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await capture(page,info,`writing-${viewport.width}-cdp.png`);
 }
 expect(errors).toEqual([]);await outline.getByRole('button',{name:'关闭',exact:true}).click();await expect(outline).toHaveCount(0);
});
test('a failed project list does not block creation and its retry recovers independently @smoke',async({page},info)=>{
 const {recover,errors}=await fixturePage(page,{failProjects:true});
 const alert=page.getByRole('alert').filter({hasText:'Project list temporarily unavailable'});await expect(alert.first()).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await expect(page.getByRole('button',{name:/从 Prompt 开始/})).toBeVisible();await page.getByRole('dialog',{name:'新建',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 recover();const projectsAlert=alert.filter({hasText:'(projects)'}),trashAlert=alert.filter({hasText:'(trash)'});await projectsAlert.getByRole('button',{name:'重试',exact:true}).click();await expect(projectsAlert).toHaveCount(0);await expect(trashAlert).toBeVisible();await trashAlert.getByRole('button',{name:'重试',exact:true}).click();await expect(alert).toHaveCount(0);await capture(page,info,'list-recovered-cdp.png');expect(errors).toEqual([]);
});

test('standalone PPT uses one navigation and search shortcut keeps the creation draft @smoke',async({page},info)=>{
 await fixturePage(page);await expect(page.getByRole('button',{name:/展开侧边栏|收起侧边栏/})).toHaveCount(0);
 await page.keyboard.press('Control+k');await expect(page.getByRole('textbox',{name:'搜索 PPT',exact:true})).toBeFocused();await expect(page.getByRole('dialog',{name:'Global Search',exact:true})).toHaveCount(0);
 await enter(page);const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});await input.fill('Keep my creation draft.');await input.press('Control+k');await expect(input).toHaveValue('Keep my creation draft.');await expect(page.getByTestId('ppt-create-wizard')).toBeVisible();await capture(page,info,'single-navigation-cdp.png');
});

test('a single project keeps a readable card width at desktop sizes @smoke',async({page},info)=>{
 await fixturePage(page);
 for(const width of [1280,1440,1920]){
  await page.setViewportSize({width,height:900});const card=page.locator('.ppt-project-grid').first().locator(':scope > *').first();await expect(card).toBeVisible();const box=await card.boundingBox();expect(box!.width).toBeLessThan(480);expect(box!.width).toBeGreaterThanOrEqual(235);await capture(page,info,`single-card-${width}-cdp.png`);
 }
});

test('an old template retry cannot restore the previous account after an account change @smoke',async({page})=>{
 await page.addInitScript(()=>{
  const snapshot={authenticated:false,offline:false,me:null,managedConfigCount:0};
  Object.defineProperty(window,'electronAPI',{configurable:true,value:{auth:{getState:async()=>snapshot,onChange:(callback:(state:typeof snapshot)=>void)=>{const handle=()=>callback(snapshot);window.addEventListener('__ppt_auth_change',handle);return()=>window.removeEventListener('__ppt_auth_change',handle);}}}});
 });
 const {fixture}=await fixturePage(page);let phase='fail',pending=false,release!:()=>void;const oldRequest=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/ppt/templates**',async route=>{
  if(phase==='fail')return route.fulfill({status:400,json:{error:'Templates unavailable'}});
  if(phase==='old-retry'){pending=true;await oldRequest;return route.fulfill({json:{templates:[{id:'light',name:'Previous account template',kind:'builtin',pages:3}]}});}
  return route.fulfill({json:{templates:[{id:'blue',name:'Account B template',kind:'builtin',pages:3}]}});
 });
 try{
  await page.getByRole('button',{name:/模板中心/}).first().click();const alert=page.getByRole('alert').filter({hasText:'(templates)'}).filter({hasText:'Templates unavailable'});await expect(alert).toBeVisible();phase='old-retry';await alert.getByRole('button',{name:'重试',exact:true}).click();await expect.poll(()=>pending).toBe(true);
  const project=structuredClone([...fixture.projects.values()][0]);project.id='8'.repeat(32);project.title='Account B deck';fixture.projects.clear();fixture.projects.set(project.id,project);phase='new-account';await page.evaluate(()=>window.dispatchEvent(new Event('__ppt_auth_change')));
  await expect(page.getByRole('heading',{name:'Account B deck',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Workflow fixture',exact:true})).toHaveCount(0);
  release();await page.getByRole('button',{name:/模板中心/}).first().click();await expect(page.getByRole('heading',{name:'Account B template',exact:true})).toBeVisible();await expect(page.getByText('Previous account template',{exact:true})).toHaveCount(0);await expect(alert).toHaveCount(0);
 }finally{release();}
});
test('desktop PPT retains the host navigation @smoke',async({page},info)=>{
 await page.addInitScript(()=>Object.defineProperty(window,'electronAPI',{value:{},configurable:true}));await fixturePage(page);await expect(page.getByRole('button',{name:/展开侧边栏|收起侧边栏/})).toHaveCount(1);await capture(page,info,'desktop-host-navigation-cdp.png');
});

test('unavailable role models block creation and recover after the model catalog refresh @smoke',async({page})=>{
 const {recover}=await fixturePage(page,{unavailable:true});await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();
 const dialog=page.getByRole('dialog',{name:'选择模型',exact:true});await expect(dialog.getByRole('alert')).toContainText('缺少可用角色');await expect(dialog.getByRole('button',{name:'确认并继续 →',exact:true})).toBeDisabled();
 recover();await page.evaluate(()=>window.dispatchEvent(new Event('provider-changed')));await expect(dialog.getByRole('button',{name:'确认并继续 →',exact:true})).toBeEnabled();
});

test('folder retry cannot invalidate an in-flight project response and optional defaults do not block models @smoke',async({page},info)=>{
 let release!:()=>void;const holdProjects=new Promise<void>(resolve=>{release=resolve;});
 try{
  // The 5 s budget runs from the failed folder response: the dev server shows
  // the server-rendered "＋ 新建" about 4 s before hydration starts the first
  // read (T10, measured: folders 400 at +15.6 s, alert at +16.4 s).
  const folderFailed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/ppt/folders'&&response.status()===400,{timeout:60000});
  const {recover,errors}=await fixturePage(page,{holdProjects,failFolders:true,failDefaults:true});
  await folderFailed;const alert=page.getByRole('alert').filter({hasText:'Folder list temporarily unavailable'});await expect(alert).toBeVisible({timeout:5000});recover();await alert.getByRole('button',{name:'重试',exact:true}).click();await expect(alert).toHaveCount(0);
  release();await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);await expect(page.getByText('Workflow fixture',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();await expect(page.getByRole('button',{name:'确认并继续 →',exact:true})).toBeEnabled();
  await capture(page,info,'independent-resource-recovery-cdp.png');expect(errors).toEqual([]);
 }finally{release();}
});

test('fixed template objects can be selected visually across pages and only chosen IDs enter creation @smoke',async({page},info)=>{
 const {fixture,errors}=await fixturePage(page,{templateObjects:true});await enter(page);
 await selectPptOption(page.getByRole('combobox',{name:'模板内容',exact:true}),'keep_fixed');
 const picker=page.getByTestId('ppt-template-fixed-objects');await picker.scrollIntoViewIfNeeded();await expect(picker.getByRole('img')).toBeVisible();await expect.poll(()=>picker.getByRole('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
 const logo=picker.getByRole('button',{name:'切换保留对象: Brand logo',exact:true});await logo.click();await expect(logo).toHaveAttribute('aria-pressed','true');await expect(picker.getByRole('button',{name:'切换保留对象: Old report background',exact:true})).toHaveAttribute('aria-pressed','false');
 await picker.getByRole('button',{name:'下一页模板',exact:true}).click();await expect(picker.getByText('2 / 2',{exact:true})).toBeVisible();await picker.getByRole('checkbox').check();
 await picker.getByRole('button',{name:'上一页模板',exact:true}).click();await expect(logo).toHaveAttribute('aria-pressed','true');await capture(page,info,'template-fixed-objects-cdp.png');
 await page.getByRole('textbox',{name:'输入 Prompt',exact:true}).fill('Use the approved brand and footer. Replace all old report facts.');await writeCardOutline(page);
 expect(fixture.payloads[0].templateContentMode).toBe('keep_fixed');expect(fixture.payloads[0].templateFixedObjectIds).toEqual(['brand-logo','fixed-footer']);expect(errors).toEqual([]);
});

test('model catalog loading is visible inside the quality gate without claiming models are unconfigured @smoke',async({page},info)=>{
 let release!:()=>void;const holdModels=new Promise<void>(resolve=>{release=resolve;});
 try{await fixturePage(page,{holdModels});await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();
  const dialog=page.getByRole('dialog',{name:'选择模型',exact:true});await expect(dialog.getByRole('status')).toContainText('正在加载可用模型');await expect(dialog.getByRole('button',{name:'确认并继续 →',exact:true})).toBeDisabled();await expect(dialog.getByText('没有可用文本模型，请先配置服务商及模型。',{exact:true})).toHaveCount(0);
  await capture(page,info,'model-catalog-loading-cdp.png');release();await expect(dialog.getByRole('button',{name:'确认并继续 →',exact:true})).toBeEnabled();
 }finally{release();}
});

test('failed model catalog reload inside the quality gate preserves input and quality @smoke',async({page},info)=>{
 const {failModels,recover,errors,fixture}=await fixturePage(page);await enter(page);
 const text='Keep the complete release conditions and the current input.';const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});await input.fill(text);
 await page.getByRole('button',{name:/LLM ·.*Demo LLM/}).click();const dialog=page.getByRole('dialog',{name:'选择模型',exact:true});await dialog.getByTestId('ppt-quality-settings').locator('summary').filter({hasText:'高级：执行策略'}).click();await dialog.getByRole('button',{name:/^严谨/}).click();
 failModels();await page.evaluate(()=>window.dispatchEvent(new Event('provider-changed')));await expect(dialog.getByRole('alert')).toContainText('暂时无法读取模型列表');await expect(dialog.getByRole('button',{name:'确认并继续 →',exact:true})).toBeDisabled();
 recover();await dialog.getByRole('button',{name:'重新加载模型',exact:true}).click();await expect(dialog.getByRole('button',{name:'确认并继续 →',exact:true})).toBeEnabled();await expect(dialog.getByRole('button',{name:/^严谨/})).toHaveAttribute('aria-pressed','true');
 await capture(page,info,'model-catalog-retry-cdp.png');await dialog.getByRole('button',{name:'确认并继续 →',exact:true}).click();await expect(input).toHaveValue(text);expect(fixture.payloads).toHaveLength(0);expect(errors).toEqual([]);
});
