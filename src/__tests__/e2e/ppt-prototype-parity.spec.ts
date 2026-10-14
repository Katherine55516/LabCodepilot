import {selectPptOption} from '../helpers';
import { test, expect, type Page } from '@playwright/test';
import { pptParityFixture } from '../fixtures/ppt-parity';
import type { PptRenderElement } from '@/components/ppt/types';
const uiErrors = new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{ const errors:string[]=[]; uiErrors.set(page,errors); page.on('pageerror',error=>errors.push(error.message)); page.on('console',message=>{if(message.type()==='error')errors.push(message.text());}); });
test.afterEach(async({page})=>{expect(uiErrors.get(page)).toEqual([]);});
async function setup(page:Page,options: {completeAfterEdits?: number} = {}) {
  const fixture=pptParityFixture(options);
  await page.route('**/api/**',async route=>{
    const result=await fixture.handle(route.request().method(),new URL(route.request().url()).pathname,route.request().postData()?route.request().postDataJSON():{});
    if(!result)return route.continue();
    return route.fulfill({status:result.status,contentType:result.contentType || 'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  return fixture;
}
async function enter(page:Page,kind='从 Prompt 开始') {
  await page.getByRole('button',{name:'＋ 新建',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'LLM（必填）'})).toHaveCount(0);
  await page.getByRole('button',{name:new RegExp(kind)}).click();
  await selectPptOption(page.getByRole('combobox',{name:'LLM（必填）'}), 'managed-demo::demo-model');
  await page.getByRole('button',{name:'确认并继续 →'}).click();
  await expect(page.getByRole('textbox',{name:'输入 Prompt',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/Teaching template/}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
}
test('PPT template-first creation keeps manual pages, handles estimate races and sends policy @smoke',async({page},info)=>{
  const fixture=await setup(page);await enter(page);
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('12');
  const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});
  await input.fill('slow topic');await expect(page.getByTestId('ppt-page-count')).toHaveValue('12');await expect(page.getByText('Agent 正在估算页数…')).toBeVisible();
  await input.fill('latest topic');await expect(page.getByTestId('ppt-page-count')).toHaveValue('9');
  await page.getByRole('button',{name:'增加页数',exact:true}).click();
  await input.fill('Different topic');await expect(page.getByTestId('ppt-page-count')).toHaveValue('10');
  await input.fill('');await expect(page.getByTestId('ppt-page-count')).toHaveValue('10');
  await page.getByRole('button',{name:'采用当前建议',exact:true}).click();await expect(page.getByTestId('ppt-page-count')).toHaveValue('12');
  await input.fill('为团队介绍平台架构与约束，生成8页');
  await selectPptOption(page.getByRole('combobox',{name:'内容详细程度'}), 'detailed');
  await page.getByRole('button',{name:'← 返回模板'}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();await expect(input).toHaveValue('为团队介绍平台架构与约束，生成8页');
  await page.screenshot({path:info.outputPath('input-desktop.png')});
  await page.getByRole('button',{name:'读取输入并生成大纲',exact:true}).click();
  await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='prompt')).toMatchObject({pages:8,generationPolicy:{version:1,detail:'detailed',language:{mode:'source'},knowledge:'source_only'}});
  // Planning cannot start writers before explicit confirmation.
  await expect(page.getByTestId('ppt-outline-review')).toBeVisible();
  await expect(page.getByTestId('ppt-outline-auto-continue')).toHaveCount(0);
  expect(fixture.payloads.some(p=>p.action==='generate')).toBe(false);
  await page.getByRole('button',{name:'确认大纲并生成页面',exact:true}).click();
  await expect(page.getByTestId('ppt-create-wizard')).toHaveCount(0,{timeout:20000});
});
test('PPT paste syllabus and composer remain reachable at 390 by 500 @smoke',async({page},info)=>{
  const fixture=await setup(page);await enter(page,'粘贴文本');
  await page.setViewportSize({width:390,height:500});
  await page.getByRole('textbox',{name:'粘贴文本',exact:true}).fill('# Training\nConditions and mechanism. '.repeat(20));
  await page.getByRole('button',{name:'生成 Syllabus',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'大纲标题 8',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'大纲标题 8',exact:true}).fill('Verified last topic');
  const body=page.locator('.ppt-create-body'); await body.hover();await page.mouse.wheel(0,1800);
  expect(await body.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('button',{name:'确认大纲并生成页面'})).toBeVisible();
  await page.screenshot({path:info.outputPath('paste-short.png')});
  await page.getByRole('button',{name:'确认大纲并生成页面'}).click();
  expect(fixture.payloads.find(p=>p.action==='outline' && p.slides)?.slides.at(-1).title).toBe('Verified last topic');
});
test('PPT generation dock preserves draft through close and supports two fixed-scope turns @smoke',async({page},info)=>{
  const fixture=await setup(page,{completeAfterEdits:2});
  await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();
  await page.getByRole('button',{name:/修改生成要求|Edit during generation/}).click();
  const panel=page.getByTestId('ppt-generation-edit'), composer=panel.getByRole('textbox');
  await composer.fill('Clarify the definition');
  await panel.getByRole('button',{name:/提交修改|Submit/}).click();
  await expect(panel.getByTestId('ppt-generation-messages')).toContainText('Clarify the definition');
  await composer.fill('Keep source conditions');
  await page.screenshot({path:info.outputPath('chat-desktop.png')});
  await panel.getByRole('button',{name:'关闭',exact:true}).last().click();
  await page.getByRole('button',{name:/修改生成要求|Edit during generation/}).click();
  await expect(composer).toHaveValue('Keep source conditions');
  await panel.getByRole('button',{name:/提交修改|Submit/}).click();
  await expect(panel.getByTestId('ppt-generation-messages')).toContainText('Keep source conditions');
  const sent=fixture.payloads.filter(p=>p.action==='generation-edits');expect(sent).toHaveLength(2);expect(sent[0].scope).toBe('current');expect(sent[1].scope).toBe('current');expect(sent[1].scopeId).not.toBe(sent[0].scopeId);
  await expect(page.getByTestId('ppt-structured-editor')).toBeVisible();
  await composer.fill('Next draft remains intact');await page.setViewportSize({width:390,height:500});await panel.hover();await page.mouse.wheel(0,1200);
  await expect(panel.getByRole('button',{name:/提交修改|Submit/})).toBeVisible();await expect(composer).toHaveValue('Next draft remains intact');await page.screenshot({path:info.outputPath('chat-short.png')});
});

test('PPT local translate and expand send parameters and review real proposal metrics @smoke',async({page},info)=>{
  const fixture=await setup(page);
  fixture.projects.get('9'.repeat(32))!.status='completed';
  await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();
  await page.getByRole('button',{name:'打开编辑器',exact:true}).click();
  const editor=page.getByTestId('ppt-structured-editor');
  await editor.getByRole('button',{name:'AI 局部优化',exact:true}).click();
  await editor.getByRole('combobox',{name:'文字动作'}).click();await page.getByRole('option',{name:'翻译',exact:true}).click();
  await editor.getByRole('combobox',{name:'目标语言'}).click();await page.getByRole('option',{name:'Français',exact:true}).click();
  await editor.getByRole('combobox',{name:'翻译方式'}).click();await page.getByRole('option',{name:'保留原文并加译文',exact:true}).click();
  await editor.getByRole('textbox',{name:'地区（可选）'}).fill('France');
  await editor.getByRole('textbox',{name:'术语规则（可选）'}).fill('mechanism=mécanisme');
  await editor.getByRole('button',{name:'用 AI 编辑当前页',exact:true}).click();
  await expect(editor.getByTestId('ppt-ai-length')).toContainText('20 → 40 (2×)');
  await expect(editor.getByTestId('ppt-ai-object-integrity')).toContainText('2');
  expect(fixture.payloads.filter(p=>p.action==='ai-edit').at(-1)).toMatchObject({scope:'slide',type:'content',parameters:{targetLanguage:'fr',mode:'bilingual',region:'France',glossary:'mechanism=mécanisme'}});
  await editor.getByRole('button',{name:'取消',exact:true}).click();
  await editor.getByRole('combobox',{name:'文字动作'}).click();await page.getByRole('option',{name:'扩写',exact:true}).click();
  await editor.getByRole('combobox',{name:'近似长度目标'}).click();await page.getByRole('option',{name:'≈ 2×',exact:true}).click();
  await editor.getByRole('button',{name:'用 AI 编辑当前页',exact:true}).click();
  await expect(editor.getByTestId('ppt-ai-length')).toContainText('≈2×');
  expect(fixture.payloads.filter(p=>p.action==='ai-edit').at(-1)?.parameters).toEqual({lengthRatio:2});
  await page.screenshot({path:info.outputPath('local-ai-parameters.png')});
  await editor.getByRole('button',{name:'应用修改',exact:true}).click();
  await expect(editor.getByTestId('ppt-ai-comparison')).toHaveCount(0);
});

test('PPT source table editor uses measured column/row weights and readable header @smoke',async({page},info)=>{
  const fixture=await setup(page);
  const project=fixture.projects.get('9'.repeat(32))!;
  project.status='completed';
  // Use production Render Tree data at the editor boundary, without model calls.
  const elements = project.renderTree.slides[0].elements as unknown as PptRenderElement[];
  elements.push({id:'density-table',nodeId:'density-table',kind:'table',
    bounds:{x:914400,y:2286000,width:7315200,height:1828800},
    content:{rows:[['Object','Condition'],['Queue','Before execution'],['Result','After review']],columnWeights:[1,3],rowWeights:[1,2,1]},
    style:{fontSizePt:18,color:'#242a3b',fill:'#404b6b',tableHeaderColor:'#ffffff'},zIndex:500,locked:false});
  await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();
  await page.getByRole('button',{name:'打开编辑器',exact:true}).click();
  const table=page.getByTestId('ppt-structured-editor').locator('[data-node-id="density-table"] table');
  await expect(table).toBeVisible();
  expect(await table.locator('col').evaluateAll(cols=>cols.map(col=>(col as HTMLElement).style.width))).toEqual(['25%','75%']);
  expect(await table.locator('tr').evaluateAll(rows=>rows.map(row=>(row as HTMLElement).style.height))).toEqual(['25%','50%','25%']);
  await expect(table.locator('td').first()).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(table.locator('td').first()).toHaveCSS('background-color','rgb(64, 75, 107)');
  const cdp=await page.context().newCDPSession(page);
  const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'});
  await import('node:fs').then(fs=>fs.writeFileSync(info.outputPath('source-table-cdp.png'),Buffer.from(screenshot.data,'base64')));
  await cdp.detach();
});

test('PPT editable import keeps native page count independent of a small selected template @smoke',async({page})=>{
  const fixture=await setup(page);
  await page.route('**/api/ppt/templates',route=>route.fulfill({json:{templates:[{id:'a'.repeat(32),name:'Two page native template',pages:2,kind:'uploaded',extension:'pptx',compatibility:'mapped',capabilities:{maxPages:2},sampleTitles:['Cover']}]}}));
  await page.reload();
  await page.getByRole('button',{name:'＋ 新建',exact:true}).click();
  await page.getByRole('button',{name:/导入文件/}).click();
  await selectPptOption(page.getByRole('combobox',{name:'LLM（必填）'}), 'managed-demo::demo-model');
  await page.getByRole('button',{name:'确认并继续 →'}).click();
  await page.getByRole('button',{name:/Two page native template/}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({name:'native.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from('fixture-native-pptx')});
  await selectPptOption(page.getByRole('combobox',{name:/PPTX 导入方式/}), 'editable');
  await page.getByRole('button',{name:'打开并编辑 PPTX',exact:true}).click();
  await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='file')).toMatchObject({importMode:'editable',fileName:'native.pptx'});
});

test('PPT auto estimate remains provisional until syllabus confirmation @smoke', async ({page}, info) => {
  const fixture = await setup(page); await enter(page, '粘贴文本');
  await page.getByRole('textbox', {name:'粘贴文本', exact:true}).fill('latest topic');
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('9');
  const requests: Record<string, unknown>[] = [];
  page.on('request', request => { if(request.url().includes('/api/ppt/page-estimate') && request.method()==='POST') requests.push(request.postDataJSON()); });
  await selectPptOption(page.getByRole('combobox', {name:'内容详细程度'}), 'detailed');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.at(-1)).toMatchObject({template:'light', generationPolicy:{detail:'detailed'}});
  await page.getByRole('button', {name:'生成 Syllabus', exact:true}).click();
  await expect(page.getByRole('textbox', {name:'大纲标题 8', exact:true})).toBeVisible();
  expect(fixture.payloads.find(p => p.inputKind === 'paste')).not.toHaveProperty('pages');
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('8');
  const cdp = await page.context().newCDPSession(page);
  const state = await cdp.send('Runtime.evaluate', {expression:'document.querySelector(".ppt-create-body").scrollHeight > 0', returnByValue:true});
  expect(state.result.value).toBe(true);
  const screenshot = await cdp.send('Page.captureScreenshot', {format:'png'});
  await import('node:fs').then(fs => fs.writeFileSync(info.outputPath('auto-calibrated-cdp.png'), Buffer.from(screenshot.data,'base64')));
  await cdp.detach();
  await page.screenshot({path:info.outputPath('auto-calibrated-syllabus.png'), fullPage:true});
  await page.getByRole('button', {name:'确认大纲并生成页面'}).click();
  expect(fixture.payloads.find(p => p.action === 'outline')).toMatchObject({finalPageCount:8});
});

test('PPT template capacity changes invalidate provisional syllabus and estimate @smoke', async ({page}) => {
  await setup(page);
  const requests: string[] = [];
  await page.route('**/api/ppt/page-estimate', async route => {
    const body = route.request().postDataJSON(); requests.push(body.template);
    await route.fulfill({json:{recommendation:{recommended:body.template==='blue'?6:9,min:3,max:15,reason:'Capacity fixture'}}});
  });
  await enter(page, '粘贴文本');
  await page.getByRole('textbox', {name:'粘贴文本', exact:true}).fill('Conditions and the decision mechanism.');
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('9');
  await page.getByRole('button', {name:'生成 Syllabus', exact:true}).click();
  await expect(page.getByRole('textbox', {name:'大纲标题 8', exact:true})).toBeVisible();
  await page.getByRole('button', {name:'← 返回模板'}).click();
  await page.getByRole('button', {name:/Blue template/}).click();
  await page.getByRole('button', {name:'下一步：输入内容 →'}).click();
  await expect(page.getByTestId('ppt-page-count')).toHaveValue('6');
  await expect(page.getByRole('textbox', {name:'大纲标题 8', exact:true})).toHaveCount(0);
  expect(requests).toContain('blue');
});

test('Switching a failed fixed-page outline back to module estimation starts the matching contract @smoke',async({page},info)=>{
 const fixture=await setup(page);let first=true,retries=0;
 await page.route('**/api/ppt/projects**',async route=>{
  const request=route.request(),url=new URL(request.url()),body=request.postData()?request.postDataJSON():{};
  if(request.method()==='POST'&&url.pathname.endsWith('/retry')){retries++;return route.fulfill({status:409,json:{error:'The old fixed-page contract must not be retried'}});}
  if(request.method()==='POST'&&url.pathname==='/api/ppt/projects'){
   const result=await fixture.handle('POST',url.pathname,body);const project=(result!.body as any).project;
   Object.assign(project,{configId:body.configId,model:body.model,publishedRevision:0,pageDecision:{mode:body.pages?'explicit':'auto'}});
   if(first){first=false;project.status='failed';project.stage='outline';project.error='capacity_conflict_fixture';}
   return route.fulfill({status:result!.status,json:{project}});
  }
  return route.fallback();
 });
 await enter(page);await page.getByRole('textbox',{name:'输入 Prompt',exact:true}).fill('Source relations and their conditions.');
 await expect(page.getByTestId('ppt-page-count')).toHaveValue('8');await page.getByTestId('ppt-page-count').fill('16');
 await page.getByRole('button',{name:'读取输入并生成大纲',exact:true}).click();await expect(page.getByText('capacity_conflict_fixture',{exact:false}).first()).toBeVisible();
 await page.getByRole('button',{name:'采用当前建议',exact:true}).click();await expect(page.getByTestId('ppt-page-count')).toHaveValue('8');
 await page.getByRole('button',{name:'读取输入并生成大纲',exact:true}).click();await expect(page.getByTestId('ppt-outline-review')).toBeVisible();
 expect(retries).toBe(0);expect(fixture.payloads.filter(p=>!p.action)).toHaveLength(2);expect(fixture.payloads.filter(p=>!p.action)[0].pages).toBe(16);expect(fixture.payloads.filter(p=>!p.action)[1].pages).toBeUndefined();
 expect([...fixture.projects.values()].find(p=>p.status==='failed')?.pages).toBe(16);await page.screenshot({path:info.outputPath('failed-fixed-to-module-auto.png')});
});
test('PPT default keeps source languages in titles and body; primary-only is an explicit choice @smoke',async({page},info)=>{
  const fixture=await setup(page);await enter(page);
  const language=page.getByRole('combobox',{name:'输出语言'});
  await expect(language).toContainText('双语标题及正文');
  await page.getByRole('textbox',{name:'输入 Prompt',exact:true}).fill('为团队介绍平台架构与约束');
  await selectPptOption(language,'source');
  await expect(language).toContainText('仅原文语言正文');
  await selectPptOption(language,'source-both');
  await expect(language).toContainText('双语标题及正文');
  await page.screenshot({path:info.outputPath('language-both.png')});
  await page.getByRole('button',{name:'读取输入并生成大纲',exact:true}).click();
  await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='prompt')?.generationPolicy?.language).toEqual({mode:'source',body:'both'});
});
