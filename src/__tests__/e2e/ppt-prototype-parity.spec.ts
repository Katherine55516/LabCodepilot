import { test, expect, type Page } from '@playwright/test';
import { pptParityFixture } from '../fixtures/ppt-parity';
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
  await page.goto('/ppt');await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  return fixture;
}
async function enter(page:Page,kind='从 Prompt 开始') {
  await page.getByRole('button',{name:'＋ 新建',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'LLM（必填）'})).toHaveCount(0);
  await page.getByRole('button',{name:new RegExp(kind)}).click();
  await page.getByRole('combobox',{name:'LLM（必填）'}).selectOption('managed-demo::demo-model');
  await page.getByRole('button',{name:'确认并继续 →'}).click();
  await expect(page.getByRole('textbox',{name:'输入 Prompt',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/Teaching template/}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
}
test('PPT template-first creation keeps manual pages, handles estimate races and sends policy @smoke',async({page},info)=>{
  const fixture=await setup(page);await enter(page);
  await expect(page.getByTestId('ppt-page-count')).toHaveText('12 页');
  const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});
  await input.fill('slow topic');await expect(page.getByTestId('ppt-page-count')).toHaveText('12 页');await expect(page.getByText('Agent 正在估算页数…')).toBeVisible();
  await input.fill('latest topic');await expect(page.getByTestId('ppt-page-count')).toHaveText('9 页');
  await page.getByRole('button',{name:'增加页数',exact:true}).click();
  await input.fill('Different topic');await expect(page.getByTestId('ppt-page-count')).toHaveText('10 页');
  await input.fill('');await expect(page.getByTestId('ppt-page-count')).toHaveText('10 页');
  await page.getByRole('button',{name:'采用当前建议',exact:true}).click();await expect(page.getByTestId('ppt-page-count')).toHaveText('12 页');
  await input.fill('为团队介绍平台架构与约束，生成8页');
  await page.getByRole('combobox',{name:'内容详细程度'}).selectOption('detailed');
  await page.getByRole('button',{name:'← 返回模板'}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();await expect(input).toHaveValue('为团队介绍平台架构与约束，生成8页');
  await page.screenshot({path:info.outputPath('input-desktop.png')});
  await page.getByRole('button',{name:'开始生成',exact:true}).click();
  await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='prompt')).toMatchObject({pages:8,generationPolicy:{version:1,detail:'detailed',language:{mode:'source'},knowledge:'source_plus_explanation'}});
  await expect(page.getByTestId('ppt-create-wizard')).toHaveCount(0);
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
  await expect(page.getByRole('button',{name:'确认 Syllabus 并开始生成'})).toBeVisible();
  await page.screenshot({path:info.outputPath('paste-short.png')});
  await page.getByRole('button',{name:'确认 Syllabus 并开始生成'}).click();
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
  await editor.getByRole('combobox',{name:'文字动作'}).selectOption('translate');
  await editor.getByRole('combobox',{name:'目标语言'}).selectOption('fr');
  await editor.getByRole('combobox',{name:'翻译方式'}).selectOption('bilingual');
  await editor.getByRole('textbox',{name:'地区（可选）'}).fill('France');
  await editor.getByRole('textbox',{name:'术语规则（可选）'}).fill('mechanism=mécanisme');
  await editor.getByRole('button',{name:'用 AI 编辑当前页',exact:true}).click();
  await expect(editor.getByTestId('ppt-ai-length')).toContainText('20 → 40 (2×)');
  expect(fixture.payloads.filter(p=>p.action==='ai-edit').at(-1)).toMatchObject({scope:'slide',type:'content',parameters:{targetLanguage:'fr',mode:'bilingual',region:'France',glossary:'mechanism=mécanisme'}});
  await editor.getByRole('button',{name:'取消',exact:true}).click();
  await editor.getByRole('combobox',{name:'文字动作'}).selectOption('expand');
  await editor.getByRole('combobox',{name:'近似长度目标'}).selectOption('2');
  await editor.getByRole('button',{name:'用 AI 编辑当前页',exact:true}).click();
  await expect(editor.getByTestId('ppt-ai-length')).toContainText('≈2×');
  expect(fixture.payloads.filter(p=>p.action==='ai-edit').at(-1)?.parameters).toEqual({lengthRatio:2});
  await page.screenshot({path:info.outputPath('local-ai-parameters.png')});
  await editor.getByRole('button',{name:'应用修改',exact:true}).click();
  await expect(editor.getByTestId('ppt-ai-comparison')).toHaveCount(0);
});

test('PPT editable import keeps native page count independent of a small selected template @smoke',async({page})=>{
  const fixture=await setup(page);
  await page.route('**/api/ppt/templates',route=>route.fulfill({json:{templates:[{id:'a'.repeat(32),name:'Two page native template',pages:2,kind:'uploaded',extension:'pptx',compatibility:'mapped',capabilities:{maxPages:2},sampleTitles:['Cover']}]}}));
  await page.reload();
  await page.getByRole('button',{name:'＋ 新建',exact:true}).click();
  await page.getByRole('button',{name:/导入文件/}).click();
  await page.getByRole('combobox',{name:'LLM（必填）'}).selectOption('managed-demo::demo-model');
  await page.getByRole('button',{name:'确认并继续 →'}).click();
  await page.getByRole('button',{name:/Two page native template/}).click();
  await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
  await page.locator('input[type=file]').setInputFiles({name:'native.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from('fixture-native-pptx')});
  await page.getByRole('combobox',{name:/PPTX 导入方式/}).selectOption('editable');
  await page.getByRole('button',{name:'打开并编辑 PPTX',exact:true}).click();
  await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='file')).toMatchObject({importMode:'editable',fileName:'native.pptx'});
});
