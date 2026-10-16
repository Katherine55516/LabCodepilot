import {choosePptRoleModel} from '../helpers';
import fs from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';
import type {PptProject} from '@/components/ppt/types';
type FixtureDeck=ReturnType<typeof pptParityFixture>['projects'] extends Map<string,infer T> ? T : never;
type FixtureMetadata=FixtureDeck & {deletedAt?:string;folderId?:string};
// Includes development route hydration and cold template/editor compilation.
test.setTimeout(90000);
test.use({viewport:{width:1440,height:900}});

async function screenshot(page:Page,path:string) {
  const cdp=await page.context().newCDPSession(page);
  const image=await cdp.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path,Buffer.from(image.data,'base64'));await cdp.detach();
}

test('Round 7 selection hit targets, Shift range, sticky inline actions, move/delete and Esc @smoke',async({page},info)=>{
  const fixture=pptParityFixture(),first=fixture.projects.values().next().value!;
  first.title='A first deck';
  for(const [id,title] of [['8'.repeat(32),'B middle deck'],['7'.repeat(32),'C last deck']])fixture.projects.set(id,{...structuredClone(first),id,title});
  const mutations:{action:string;ids:string[];folderId?:string}[]=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():{};
    if(url.pathname==='/api/ppt/folders')return route.fulfill({json:{folders:[{id:'f'.repeat(32),name:'Evidence',count:0}]}});
    if(url.pathname==='/api/ppt/projects'&&req.method()==='GET')return route.fulfill({json:{projects:[...fixture.projects.values()].filter(p=>Boolean((p as FixtureMetadata).deletedAt)===url.searchParams.has('trash'))}});
    if(url.pathname==='/api/ppt/projects/bulk'){
      mutations.push(body);
      for(const id of body.ids){const p=fixture.projects.get(id) as FixtureMetadata;if(body.action==='move')p.folderId=body.folderId;if(body.action==='trash')p.deletedAt=new Date().toISOString();}
      return route.fulfill({json:{projects:[...fixture.projects.values()]}});
    }
    const result=await fixture.handle(req.method(),url.pathname,body);if(!result)return route.continue();
    return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
  });
  await page.goto('/ppt',{waitUntil:'domcontentloaded'});
  const boxes=page.locator('.ppt-project-select');await expect(boxes).toHaveCount(3);
  expect(await boxes.first().evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);
  await boxes.first().click();await boxes.last().click({modifiers:['Shift']});
  await expect(page.locator('.ppt-project-select:checked')).toHaveCount(3);
  const toolbar=page.getByRole('toolbar',{name:'批量操作'});await expect(toolbar).toContainText('3');
  expect(await toolbar.evaluate(el=>Boolean(el.closest('.ppt-workspace-header')))).toBe(true);
  await screenshot(page,info.outputPath('selection-inline-cdp.png'));
  await toolbar.getByRole('button',{name:/移至文件夹|移动到文件夹/}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('combobox').click();await page.getByRole('option',{name:'Evidence',exact:true}).click();
  await dialog.getByRole('button',{name:/确认|保存/}).click();
  await expect.poll(()=>mutations[0]).toMatchObject({action:'move',ids:expect.any(Array),folderId:'f'.repeat(32)});
  expect(mutations[0].ids).toHaveLength(3);
  await boxes.first().click();await page.keyboard.press('Escape');await expect(toolbar).toHaveCount(0);
  await boxes.first().click();await toolbar.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('dialog',{name:'删除',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
  await expect.poll(()=>mutations.at(-1)?.action).toBe('trash');
  await expect(page.getByTestId('ppt-project-card')).toHaveCount(2);
});

test('Chat Ctrl+Enter sends, Enter adds a line and history scrolls to its new status @smoke',async({page},info)=>{
  const fixture=pptParityFixture();
  await page.route('**/api/**',async route=>{const r=route.request(),result=await fixture.handle(r.method(),new URL(r.url()).pathname,r.postData()?r.postDataJSON():{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});});
  await page.goto('/ppt?projectId='+ '9'.repeat(32),{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'修改生成要求',exact:true}).first().click();
  const panel=page.getByTestId('ppt-generation-edit'),input=panel.getByRole('textbox'),history=panel.getByRole('log');
  for(let n=0;n<5;n++){
    await input.fill('Keep the source evidence '+n);await input.press('Enter');await expect(input).toHaveValue('Keep the source evidence '+n+'\n');
    await input.type('Add the relevant condition.');await input.press('Control+Enter');
    await expect.poll(()=>fixture.payloads.filter(p=>p.action==='generation-edits').length).toBe(n+1);
    await expect(input).toHaveValue('');
  }
  await expect(history).toContainText('Keep the source evidence 4');
  expect(await history.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
  await page.setViewportSize({width:390,height:500});
  const submit=panel.getByRole('button',{name:'提交修改',exact:true}),box=await submit.boundingBox();
  expect(box!.y+box!.height).toBeLessThanOrEqual(500);await expect(submit).toBeVisible();
  await screenshot(page,info.outputPath('chat-mobile-cdp.png'));
});

test('Round 7 native-template draft grows as one page without clipping, and manual scroll pauses follow @smoke',async({page},info)=>{
  const fixture=pptParityFixture(),p=fixture.projects.get('9'.repeat(32))! as unknown as PptProject;
  for(let i=0;i<12;i++){
    const id='s'+i;p.nodes![id].status=i===0?'done':i===1?'running':'pending';
    p.runtime!.slides[id].phase=i===0?'render_ready':'content';
    if(i>0){p.renderTree!.slides[i].elements=[];delete p.runtime!.slides[id].preview;}
  }
  p.generationStages={deck:'writing',pages:Object.fromEntries(p.outline.map((s,i)=>[s.id,i===0?'ready':i===1?'writing':'waiting']))};
  p.generationMedia={s1:[{id:'source-photo',caption:'Observed comparison',width:640,height:480}]};
  p.generationSkeletons={s1:{...p.renderTree!.slides[1],background:'#eee9dc',elements:[]}};
  p.drafts={s1:{title:'A real streamed page',blocks:Array.from({length:12},(_,i)=>({type:'TextBlock',heading:'Source point '+i,text:'Preserve the mechanism, conditions and source evidence. '.repeat(12)})),chars:7200}};
  await page.route('**/api/**',async route=>{const r=route.request(),result=await fixture.handle(r.method(),new URL(r.url()).pathname,r.postData()?r.postDataJSON():{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});});
  await page.goto('/ppt?projectId='+p.id,{waitUntil:'domcontentloaded'});
  const canvas=page.locator('#ppt-editor-canvas'),draft=canvas.getByTestId('ppt-generation-skeleton');
  await expect(canvas.locator('article')).toHaveCount(2);await expect(draft.getByTestId('ppt-draft-point')).toHaveCount(12);
  await expect(draft.locator('svg')).toHaveCount(0);
  const media=draft.getByTestId('ppt-draft-media');await expect(media).toHaveAttribute('aria-label','Observed comparison');
  const mediaBox=await media.boundingBox();expect(mediaBox!.width/mediaBox!.height).toBeCloseTo(640/480,2);
  expect(await draft.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await canvas.hover();await page.mouse.wheel(0,-500);
  await expect(page.getByTestId('ppt-back-to-current')).toBeVisible();
  await page.getByTestId('ppt-back-to-current').click();await expect(page.getByTestId('ppt-back-to-current')).toHaveCount(0);
  await screenshot(page,info.outputPath('live-flow-cdp.png'));
});

for(const failures of [2,5,10])test(`Round 7 ${failures} temporary outline read failures keep the same project and reach explicit confirmation @smoke`,async({page})=>{
 const fixture=pptParityFixture();let created=0,reads=0;
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(req.method()==='POST'&&url.pathname==='/api/ppt/projects')created++;
  if(req.method()==='GET'&&/^\/api\/ppt\/projects\/0{31}1$/.test(url.pathname)&&++reads<=failures)return route.fulfill({status:503,json:{error:'Temporary upstream interruption'}});
  const result=await fixture.handle(req.method(),url.pathname,req.postData()?req.postDataJSON():{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto('/ppt',{waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:/新建$/}).first().click();await page.getByRole('button',{name:/粘贴文本/}).click();
 await choosePptRoleModel(page,'managed-demo::demo-model');await page.getByRole('button',{name:'确认并继续 →'}).click();
 await page.getByRole('button',{name:/Teaching template/}).click();await page.getByRole('button',{name:'下一步：输入内容 →'}).click();await page.getByRole('textbox',{name:'粘贴文本',exact:true}).fill('Preserve this source through a transient read interruption.');
 await page.getByRole('button',{name:'读取输入并生成大纲',exact:true}).click();for(let retry=0;retry<Math.floor(failures/5);retry++){await expect(page.getByRole('alert').filter({hasText:'Temporary upstream interruption'}).first()).toBeVisible({timeout:20000});await page.getByRole('button',{name:'读取输入并生成大纲',exact:true}).click();}await expect(page.getByRole('button',{name:'确认大纲并生成页面',exact:true})).toBeEnabled();expect(created).toBe(1);expect(reads).toBeGreaterThanOrEqual(failures+1);expect(fixture.payloads.some(p=>p.action==='generate')).toBe(false);expect(fixture.payloads.some(p=>p.action==='outline')).toBe(false);
});
