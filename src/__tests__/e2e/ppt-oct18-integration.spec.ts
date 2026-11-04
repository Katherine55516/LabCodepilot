import fs from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';
test.setTimeout(120000);
async function fixturePage(page:Page){
 const fixture=pptParityFixture(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 const source=fixture.projects.get('9'.repeat(32))!;
 Object.assign(source,{publishedRevision:0,libraryEligible:false,taskEligible:true});
 fixture.projects.set('8'.repeat(32),Object.assign(structuredClone(source),{id:'8'.repeat(32),title:'Published presentation',status:'completed',publishedRevision:1,libraryEligible:true,taskEligible:true,coverAvailable:true}));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const task=url.pathname.match(/^\/api\/ppt\/projects\/([a-f0-9]{32})\/task-record$/);
  if(task&&request.method()==='DELETE'){
   const project=fixture.projects.get(task[1])!;Object.assign(project,{taskDeletedAt:new Date().toISOString(),taskEligible:false});return route.fulfill({json:{project}});
  }
  const result=await fixture.handle(request.method(),url.pathname,request.postData()?request.postDataJSON():{});
  if(!result)return route.continue();await route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto('/ppt',{waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0,{timeout:30000});
 return {fixture,errors};
}
test('advanced execution is collapsed and Home preserves input until explicit leave @smoke',async({page},info)=>{
 const {errors}=await fixturePage(page);
 await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();
 const gate=page.getByRole('dialog',{name:'选择模型',exact:true});await expect(gate.getByRole('combobox',{name:'LLM（必填）'})).toBeVisible();await expect(gate.getByRole('button',{name:/^严谨/})).not.toBeVisible();
 await gate.locator('summary').filter({hasText:'高级：执行策略'}).click();await expect(gate.getByRole('button',{name:/^均衡/})).toHaveAttribute('aria-pressed','true');
 await gate.getByRole('button',{name:'确认并继续 →'}).click();await page.getByRole('button',{name:/Teaching template/}).click();await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
 const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});await input.fill('Keep this source and all of its conditions.');
 await page.getByRole('button',{name:'返回 PPT 首页',exact:true}).click();const confirm=page.getByRole('dialog',{name:'离开新建流程？'});await confirm.getByRole('button',{name:'取消',exact:true}).click();await expect(input).toHaveValue('Keep this source and all of its conditions.');
 await page.getByRole('button',{name:'返回 PPT 首页',exact:true}).click();await page.getByRole('dialog',{name:'离开新建流程？'}).getByRole('button',{name:'离开',exact:true}).click();await expect(page.getByTestId('ppt-create-wizard')).toHaveCount(0);
 const cdp=await page.context().newCDPSession(page),shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(info.outputPath('home-cdp.png'),Buffer.from(shot.data,'base64'));await cdp.detach();expect(errors).toEqual([]);
});
test('task center retains successful tasks and deleting the task keeps its file @smoke',async({page})=>{
 const {errors}=await fixturePage(page);
 await expect(page.getByTestId('ppt-project-card')).toHaveCount(1);await expect(page.getByTestId('ppt-project-card')).not.toContainText('生成中');await expect(page.getByTestId('ppt-published-cover').locator('[data-node-id]')).toHaveCount(1);await expect(page.getByTestId('ppt-published-cover').locator('button')).toHaveCount(0);
 await page.getByRole('navigation',{name:'PPT 工作区导航'}).getByRole('button',{name:/任务中心/}).click();const tasks=page.getByTestId('ppt-task-center');await expect(tasks.getByRole('button',{name:'＋ 新建',exact:true})).toHaveCount(0);
 await tasks.getByRole('button',{name:'成功',exact:true}).click();await expect(tasks.getByTestId('ppt-task-row')).toHaveCount(1);
 await tasks.getByRole('button',{name:'删除任务记录',exact:true}).click();await page.getByRole('dialog',{name:'删除任务记录',exact:true}).getByRole('button',{name:'确认',exact:true}).click();await expect(tasks.getByTestId('ppt-task-row')).toHaveCount(0);
 await page.getByRole('navigation',{name:'PPT 工作区导航'}).getByRole('button',{name:/全部 PPT/}).click();await expect(page.getByTestId('ppt-project-card')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Published presentation',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

// Card decks (2026-10-23): the input is read by code and stops at the
// settings form; one command writes the outline in the same task.
test('reading goes straight on to write the outline, and the settings rewrite it in the same task @smoke',async({page},info)=>{
 const {fixture,errors}=await fixturePage(page);
 await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();await page.getByRole('button',{name:'确认并继续 →',exact:true}).click();await page.getByRole('button',{name:/Teaching template/}).click();await page.getByRole('button',{name:'下一步：输入内容 →',exact:true}).click();
 await page.getByRole('textbox',{name:'输入 Prompt',exact:true}).fill('Explain source validation and necessary release conditions.');
 await page.getByRole('button',{name:'继续：生成大纲',exact:true}).click();
 // Like Gamma (2026-10-31): no stop at the settings form; the default length is written at once.
 await expect(page.getByTestId('ppt-card-list').locator(':scope > li')).toHaveCount(8);await expect(page.getByTestId('ppt-card-settings')).toBeVisible();
 expect(fixture.payloads.filter(p=>p.inputKind==='prompt')).toHaveLength(1);expect(fixture.payloads.find(p=>p.inputKind==='prompt')?.readOnlyInput).toBeFalsy();expect(fixture.payloads.filter(p=>p.action==='planning')).toHaveLength(0);
 await page.getByTestId('ppt-card-length').getByRole('radio').first().click();await page.getByTestId('ppt-card-rewrite').click();
 const cards=page.getByTestId('ppt-card-list').locator(':scope > li');await expect(cards).toHaveCount(7);
 expect(fixture.payloads.filter(p=>p.inputKind==='prompt')).toHaveLength(1);expect(fixture.payloads.findLast(p=>p.action==='planning')).toMatchObject({command:'outline',length:{preset:'quick'}});
 await expect(page.getByTestId('ppt-card-summary')).toBeVisible();const cdp=await page.context().newCDPSession(page);await page.setViewportSize({width:480,height:800});await expect(cards.first()).toBeVisible();const footer=await page.getByTestId('ppt-card-actions').boundingBox();expect(footer!.y+footer!.height).toBeLessThanOrEqual(801);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));fs.writeFileSync(info.outputPath('read-settings-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));await cdp.detach();expect(errors).toEqual([]);
});

test('a saved reading checkpoint resumes from the task center into the settings form @smoke',async({page})=>{
 const {fixture,errors}=await fixturePage(page);const p=fixture.projects.get('9'.repeat(32))!;
 Object.assign(p,{status:'input_ready',stage:'input',outline:[],deck:null,publishedRevision:0,generationPolicy:{version:2,detail:'standard',content:'overview',knowledge:'source_only',language:{mode:'source',body:'both'}},planningContract:fixture.cardContract()});
 await page.getByRole('navigation',{name:'PPT 工作区导航'}).getByRole('button',{name:/任务中心/}).click();await page.getByTestId('ppt-task-row').filter({hasText:p.title}).getByRole('button',{name:'查看任务',exact:true}).click();
 await expect(page.getByTestId('ppt-card-settings')).toBeVisible();await page.getByTestId('ppt-card-length').getByRole('radio').first().click();await page.getByTestId('ppt-card-write').click();
 await expect(page.getByTestId('ppt-card-list').locator(':scope > li')).toHaveCount(7);await expect(page.getByTestId('ppt-card-actions').getByRole('button',{name:'生成',exact:true})).toBeEnabled({timeout:20000});expect(fixture.projects.get(p.id)!.pages).toBe(7);expect(errors).toEqual([]);
});
