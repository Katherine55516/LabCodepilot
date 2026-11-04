import {test,expect,type Page} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';

async function taskFixture(page:Page){
 const fixture=pptParityFixture(),published=fixture.projects.get('9'.repeat(32))!;
 Object.assign(published,{title:'Published task',status:'completed',stage:'completed',publishedRevision:1,taskEligible:true,libraryEligible:true});
 const failed=Object.assign(structuredClone(published),{id:'8'.repeat(32),title:'Failed task',status:'failed',stage:'outline',publishedRevision:0,libraryEligible:false});
 const running=Object.assign(structuredClone(failed),{id:'7'.repeat(32),title:'Running task',status:'generating',stage:'generation'});
 fixture.projects.set(failed.id,failed);fixture.projects.set(running.id,running);
 const removed:string[]=[],blocked=new Set<string>(),operations:string[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(method!=='GET'&&url.pathname.startsWith('/api/ppt/projects'))operations.push(method+' '+url.pathname);
  const match=url.pathname.match(/^\/api\/ppt\/projects\/([a-f0-9]{32})\/task-record$/);
  if(match&&method==='DELETE'){
   removed.push(match[1]);
   if(blocked.has(match[1]))return route.fulfill({status:409,json:{error:'Stop the active task before deleting its record'}});
   const project=fixture.projects.get(match[1])!;
   Object.assign(project,{taskDeletedAt:new Date().toISOString(),taskEligible:false});
   return route.fulfill({json:{project}});
  }
  const result=await fixture.handle(method,url.pathname,request.postData()?request.postDataJSON():{});
  return route.fulfill({status:result?.status||200,contentType:result?.contentType||'application/json',body:result?typeof result.body==='string'?result.body:JSON.stringify(result.body):'{}'});
 });
 await page.goto('/ppt',{waitUntil:'domcontentloaded'});
 await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0,{timeout:30000});
 // Below the xl breakpoint the workspace navigation lives in the drawer.
 // The drawer button renders after the list loads, and a click before hydration
 // opens nothing: open it (by viewport, not by a first look) until the navigation shows.
 const drawer=page.getByRole('button',{name:'打开 PPT 工作区导航'}),nav=page.getByRole('navigation',{name:'PPT 工作区导航'});
 if((page.viewportSize()?.width??1280)<1280)await expect(async()=>{if(!await nav.isVisible())await drawer.click({timeout:2000});await expect(nav).toBeVisible({timeout:2000});}).toPass({timeout:20000});
 await nav.getByRole('button',{name:/任务中心/}).click();
 const tasks=page.getByTestId('ppt-task-center'),row=(title:string)=>tasks.getByTestId('ppt-task-row').filter({has:page.getByRole('heading',{name:title,exact:true})});
 await expect(tasks.getByTestId('ppt-task-row')).toHaveCount(3);
 return{fixture,published,failed,running,tasks,row,removed,blocked,operations,errors};
}

test('task selection follows hover, selection and keyboard focus without opening a task @smoke',async({page},info)=>{
 const {tasks,row,errors}=await taskFixture(page),first=row('Published task'),second=row('Failed task'),box=first.getByRole('checkbox');
 await page.mouse.move(0,0);await expect(box).toHaveCSS('opacity','0');
 await first.hover();await expect(box).toHaveCSS('opacity','1');await expect(second.getByRole('checkbox')).toHaveCSS('opacity','0');
 await page.mouse.move(0,0);await expect(box).toHaveCSS('opacity','0');
 await first.hover();await box.check();await page.mouse.move(0,0);await expect(box).toHaveCSS('opacity','1');
 await expect(tasks.getByTestId('ppt-task-bulk-toolbar')).toContainText('已选择 1 个任务');
 await box.uncheck();await page.mouse.move(0,0);await expect(box).toHaveCSS('opacity','0');
 await expect(tasks.getByTestId('ppt-task-bulk-toolbar')).toHaveCount(0);
 await tasks.getByRole('button',{name:'失败',exact:true}).focus();await page.keyboard.press('Tab');
 await expect(box).toBeFocused();await expect(box).toHaveCSS('opacity','1');await page.keyboard.press('Space');await expect(box).toBeChecked();
 await row('Running task').hover();await expect(row('Running task').getByRole('checkbox')).toBeDisabled();
 await expect(page.getByTestId('ppt-structured-editor')).toHaveCount(0);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');await cdp.detach();
 await page.screenshot({path:info.outputPath('selected-task.png'),fullPage:true});
 await tasks.getByRole('button',{name:'失败',exact:true}).click();await expect(tasks.getByTestId('ppt-task-bulk-toolbar')).toHaveCount(0);
 await expect(row('Failed task').getByRole('checkbox')).not.toBeChecked();expect(errors).toEqual([]);
});

test('task bulk deletion confirms the exact selection and retains published files @smoke',async({page},info)=>{
 const {fixture,published,failed,tasks,row,removed,operations,errors}=await taskFixture(page);
 for(const title of ['Published task','Failed task']){await row(title).hover();await row(title).getByRole('checkbox').check();}
 await expect(tasks.getByTestId('ppt-task-bulk-toolbar')).toContainText('已选择 2 个任务');
 await tasks.getByRole('button',{name:'删除所选任务',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'删除任务记录',exact:true});await expect(dialog).toContainText('2 条任务记录');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(removed).toEqual([]);
 await tasks.getByRole('button',{name:'删除所选任务',exact:true}).click();await dialog.getByRole('button',{name:'确认',exact:true}).click();
 await expect(tasks.getByTestId('ppt-task-row')).toHaveCount(1);await expect(tasks.getByTestId('ppt-task-bulk-toolbar')).toHaveCount(0);
 expect(removed.sort()).toEqual([published.id,failed.id].sort());
 expect(operations).toHaveLength(2);expect(operations.every(value=>value.startsWith('DELETE ')&&value.endsWith('/task-record'))).toBe(true);
 expect(fixture.projects.get(published.id)?.publishedRevision).toBe(1);
 await page.getByRole('navigation',{name:'PPT 工作区导航'}).getByRole('button',{name:/全部 PPT/}).click();
 await expect(page.getByTestId('ppt-project-card')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Published task',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('published-file-retained.png')});expect(errors).toEqual([]);
});

test('task bulk deletion keeps failed records selected and retries only those records @smoke',async({page})=>{
 const {published,failed,tasks,row,removed,blocked,errors}=await taskFixture(page);blocked.add(failed.id);
 for(const title of ['Published task','Failed task']){await row(title).hover();await row(title).getByRole('checkbox').check();}
 await tasks.getByRole('button',{name:'删除所选任务',exact:true}).click();await page.getByRole('dialog',{name:'删除任务记录',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
 await expect(row('Published task')).toHaveCount(0);await expect(row('Failed task').getByRole('checkbox')).toBeChecked();
 await expect(page.getByRole('alert').filter({hasText:'1 条任务记录删除失败'})).toContainText('Failed task');
 await expect(tasks.getByTestId('ppt-task-bulk-toolbar')).toContainText('已选择 1 个任务');
 blocked.clear();await tasks.getByRole('button',{name:'删除所选任务',exact:true}).click();await page.getByRole('dialog',{name:'删除任务记录',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
 await expect(row('Failed task')).toHaveCount(0);expect(removed.filter(id=>id===published.id)).toHaveLength(1);expect(removed.filter(id=>id===failed.id)).toHaveLength(2);
 expect(errors.filter(error=>!error.includes('409'))).toEqual([]);
});

test('task selection remains reachable on a touch viewport @smoke',async({browser},info)=>{
 const context=await browser.newContext({baseURL:String(info.project.use.baseURL),hasTouch:true,isMobile:true,viewport:{width:480,height:800}});
 try{
  const page=await context.newPage(),{tasks,row,errors}=await taskFixture(page);
  await expect(row('Published task').getByRole('checkbox')).toHaveCSS('opacity','1');await row('Published task').getByRole('checkbox').check();
  await expect(tasks.getByRole('button',{name:'删除所选任务',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('task-selection-touch.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 }finally{await context.close();}
});
