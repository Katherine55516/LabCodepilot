import {choosePptRoleModel} from '../helpers';
import {selectPptOption,writeCardOutline} from '../helpers';
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
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0,{timeout:30000});
  return fixture;
}
async function enter(page:Page,kind='从 Prompt 开始') {
  await page.getByRole('button',{name:'＋ 新建',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'LLM（必填）'})).toHaveCount(0);
  await page.getByRole('button',{name:new RegExp(kind)}).click();
  await choosePptRoleModel(page,'managed-demo::demo-model');
  await page.getByRole('button',{name:'确认并继续 →'}).click();
  await expect(page.getByRole('textbox',{name:'输入 Prompt',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/Teaching template/}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
}
test('PPT template-first creation reads into the settings form, sends the policy and waits for confirmation @smoke',async({page},info)=>{
  const fixture=await setup(page);await enter(page);
  // Card decks (2026-10-23): no page count or estimate in the input step; length is a setting.
  await expect(page.getByTestId('ppt-page-count')).toHaveCount(0);
  const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});
  const estimates:string[]=[];page.on('request',request=>{if(request.url().includes('/page-estimate'))estimates.push(request.url());});
  await input.fill('为团队介绍平台架构与约束');
  await page.getByRole('button',{name:'← 返回模板'}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();await expect(input).toHaveValue('为团队介绍平台架构与约束');
  await page.screenshot({path:info.outputPath('input-desktop.png')});
  await writeCardOutline(page);
  expect(estimates).toEqual([]);
  // Reading goes straight on to write the outline at the default length (Gamma, 2026-10-31).
  expect(fixture.payloads.find(p=>p.inputKind==='prompt')).toMatchObject({planningFlow:'cards',generationPolicy:{version:2,archive:'none',knowledge:'source_only'}});
  expect(fixture.payloads.find(p=>p.inputKind==='prompt')?.readOnlyInput).toBeFalsy();
  expect(fixture.payloads.some(p=>p.action==='planning')).toBe(false);
  // Writing the outline starts no writer; only the explicit button confirms it.
  expect(fixture.payloads.some(p=>p.action==='outline')).toBe(false);
  await page.getByTestId('ppt-card-actions').getByRole('button',{name:'生成',exact:true}).click();
  await expect(page.getByTestId('ppt-card-outline')).toHaveCount(0,{timeout:20000});
  await expect.poll(()=>fixture.payloads.find(p=>p.action==='outline'&&p.slides)?.finalPageCount).toBe(8);
});
test('PPT pasted text reaches a card outline that stays editable and reachable at 390 by 500 @smoke',async({page},info)=>{
  const fixture=await setup(page);await enter(page,'粘贴文本');
  await page.setViewportSize({width:390,height:500});
  await page.getByRole('textbox',{name:'粘贴文本',exact:true}).fill('# Training\nConditions and mechanism. '.repeat(20));
  await writeCardOutline(page);
  const titles=page.getByTestId('ppt-card-list').getByRole('textbox',{name:'卡片标题',exact:true});
  await expect(titles).toHaveCount(8);
  await titles.nth(6).fill('Verified last topic');
  await expect.poll(()=>fixture.payloads.findLast(p=>p.action==='planning'&&p.command==='edit')).toBeTruthy();
  const generate=page.getByTestId('ppt-card-actions').getByRole('button',{name:'生成',exact:true});
  await expect(generate).toBeEnabled();await expect(generate).toBeInViewport();
  await page.screenshot({path:info.outputPath('paste-short.png')});
  await generate.click();
  await expect.poll(()=>fixture.payloads.find(p=>p.action==='outline'&&p.slides)?.slides?.[6]?.title).toBe('Verified last topic');
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

  const editor=page.getByTestId('ppt-structured-editor');
  await editor.getByRole('button',{name:'AI 局部优化',exact:true}).click();
  // Local optimisation opens the selection composer; the full AI panel is its advanced view.
  await page.getByTestId('ppt-inline-ai').getByRole('button',{name:'高级设置',exact:true}).click();
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
  (project.renderTree.slides[0].elements as PptRenderElement[]).push({id:'density-table',nodeId:'density-table',kind:'table',
    bounds:{x:914400,y:2286000,width:7315200,height:1828800},
    content:{rows:[['Object','Condition'],['Queue','Before execution'],['Result','After review']],columnWeights:[1,3],rowWeights:[1,2,1]},
    style:{fontSizePt:18,color:'#242a3b',fill:'#404b6b',tableHeaderColor:'#ffffff'},zIndex:500,locked:false} as PptRenderElement);
  await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();

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
  await choosePptRoleModel(page,'managed-demo::demo-model');
  await page.getByRole('button',{name:'确认并继续 →'}).click();
  await page.getByRole('button',{name:/Two page native template/}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
  await page.locator('input[type=file]').first().setInputFiles({name:'native.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from('fixture-native-pptx')});
  await selectPptOption(page.getByRole('combobox',{name:/PPTX 导入方式/}), 'editable');
  await page.getByRole('button',{name:'打开并编辑 PPTX',exact:true}).click();
  await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='file')).toMatchObject({importMode:'editable',fileName:'native.pptx'});
});
