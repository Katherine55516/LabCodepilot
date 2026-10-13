/** Actual app UI over CDP; deterministic source/model fixture and production
 * command schema, mutation and render tree. Domain IO/export is tested separately. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { ensureProjectV3 } from '../apps/cowork-server/lib/ppt/ir.mjs';
import { buildRenderTree } from '../apps/cowork-server/lib/ppt/render-tree.mjs';
import { normalizeCommand } from '../apps/cowork-server/lib/ppt/command-schema.mjs';
import { _internals as commands } from '../apps/cowork-server/lib/ppt/command-service.mjs';

const module=await transform(fs.readFileSync('src/__tests__/fixtures/ppt-parity.ts','utf8'),{loader:'ts',format:'esm'});
const {pptParityFixture}=await import('data:text/javascript;base64,'+Buffer.from(module.code).toString('base64'));
const fixture=pptParityFixture(),output=path.resolve(process.env.PPT_CDP_OUTPUT || 'outputs/ppt-editor-template-bilingual-20261013/editor-cdp');
fs.mkdirSync(output,{recursive:true});
const base=process.env.PPT_CDP_URL || 'http://localhost:3000';
let project=ensureProjectV3({...fixture.projects.get('9'.repeat(32)),uid:'ui-fixture',title:'Editable generation fixture',pages:4,outline:Array.from({length:4},(_,i)=>({id:`s${i}`,title:`Topic ${i+1}`,section:'Mechanism'})),deck:{slides:Array.from({length:4},(_,i)=>({id:`s${i}`,title:`Topic ${i+1}`,bullets:[`Source-backed mechanism ${i+1}.`],layoutId:i?'summary':'cover'}))}});
project.nodes=Object.fromEntries(project.outline.map((slide,i)=>[slide.id,{status:i<2?'done':i===2?'running':'pending'}]));
project.renderTree=buildRenderTree(project);project.runtime.slides=Object.fromEntries(project.renderTree.slides.map(slide=>[slide.slideId,{preview:slide,phase:'render_ready'}]));
fixture.projects.set(project.id,project);
const errors=[],checks=[],calls=[];let host,browser;
try {
 host=await chromium.launch({headless:true,args:['--remote-debugging-port=9243']});browser=await chromium.connectOverCDP('http://127.0.0.1:9243');
 const page=await browser.newPage({viewport:{width:1440,height:600}});page.setDefaultNavigationTimeout(120000);page.setDefaultTimeout(30000);
 const cdp=await page.context().newCDPSession(page);page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push(message.text());});
 await page.route('**/api/**',async route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname,body=request.postData()?request.postDataJSON():{};
  if(pathname===`/api/ppt/projects/${project.id}/pause`){calls.push('pause');project.status='paused';project.runtime.pauseRequested=false;fixture.projects.set(project.id,project);return route.fulfill({json:{project}});}
  if(pathname===`/api/ppt/projects/${project.id}/resume`){calls.push('resume');project.status='generating';fixture.projects.set(project.id,project);return route.fulfill({json:{project}});}
  if(pathname===`/api/ppt/projects/${project.id}/commands`&&request.method()==='POST'){
   const normalized=normalizeCommand(body,project),result=commands.applyToDeck(project.deck,normalized,project);calls.push(normalized.type);
   project={...project,deck:result.deck,revision:project.revision+1};project.renderTree=buildRenderTree(project);fixture.projects.set(project.id,project);
   return route.fulfill({json:{project,operation:{id:normalized.id}}});
  }
  const result=await fixture.handle(request.method(),pathname,body);if(!result)return route.continue();
  return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 const shot=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
 const bounds=async locator=>{const box=await locator.boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=page.viewportSize().width&&box.y+box.height<=page.viewportSize().height,JSON.stringify(box));};
 async function create(kind){await page.goto(base+'/ppt');await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:new RegExp(kind)}).click();await page.getByRole('combobox',{name:'LLM（必填）'}).selectOption('managed-demo::demo-model');await page.getByRole('button',{name:'确认并继续 →'}).click();await page.getByRole('button',{name:/Teaching template/}).click();await bounds(page.getByRole('button',{name:'下一步：输入内容 →'}));await page.getByRole('button',{name:'下一步：输入内容 →'}).click();}
 for(const size of [{width:1440,height:600},{width:390,height:500}]){
  await page.setViewportSize(size);await create('从 Prompt 开始');await page.getByRole('textbox',{name:'输入 Prompt',exact:true}).fill('Long source explaining mechanism, evidence and constraints. '.repeat(150));
  const next=page.getByRole('button',{name:'开始生成',exact:true});await expect(next).toBeEnabled();await bounds(next);
  await page.locator('.ppt-create-body').evaluate(element=>{element.scrollTop=element.scrollHeight;});await bounds(next);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot('prompt-actions-'+size.width);
  checks.push(`${size.width}x${size.height}: template/input actions stay visible through long-source scrolling`);
 }
 await page.addStyleTag({content:'html { font-size:24px !important; }'});await bounds(page.getByRole('button',{name:'开始生成',exact:true}));await shot('large-text-actions');checks.push('Large UI text preserves creation actions');
 await create('粘贴文本');await page.getByRole('textbox',{name:'粘贴文本',exact:true}).fill('# Shared topic\nEnglish mechanism.\n中文条件与解释。'.repeat(40));
 await page.getByRole('button',{name:'生成 Syllabus',exact:true}).click();await expect(page.getByRole('button',{name:'确认 Syllabus 并开始生成'})).toBeEnabled();await bounds(page.getByRole('button',{name:'确认 Syllabus 并开始生成'}));await shot('syllabus-actions');checks.push('Paste syllabus confirmation stays in the short viewport');
 await create('导入文件');await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({name:'sample.md',mimeType:'text/markdown',buffer:Buffer.from('# Records\nValidate before release.')});
 const fileNext=page.getByRole('button',{name:'生成 Syllabus 并确认',exact:true});await expect(fileNext).toBeEnabled();await bounds(fileNext);await fileNext.click();await expect(page.getByRole('button',{name:'确认 Syllabus 并开始生成'})).toBeEnabled();await bounds(page.getByRole('button',{name:'确认 Syllabus 并开始生成'}));await shot('file-actions');checks.push('File parse and final confirmation remain accessible');
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/ppt');await page.getByRole('heading',{name:'Editable generation fixture',exact:true}).click();
 const monitor=page.getByTestId('ppt-generation-monitor');await monitor.locator('aside button').filter({has:page.locator('.aspect-video')}).first().click();
 await monitor.getByRole('button',{name:'编辑页面',exact:true}).click();const editor=page.getByTestId('ppt-structured-editor');await expect(editor).toBeVisible();assert.deepEqual(calls,['pause']);
 const toolbar=editor.getByTestId('ppt-text-toolbar');await toolbar.getByRole('button',{name:'选择本页文字'}).click();await toolbar.getByRole('combobox',{name:'字体',exact:true}).selectOption('Georgia');await toolbar.getByRole('spinbutton',{name:'字号',exact:true}).fill('32');
 await toolbar.getByRole('button',{name:'斜体',exact:true}).click();await toolbar.getByRole('button',{name:'下划线',exact:true}).click();await toolbar.getByRole('button',{name:'应用样式',exact:true}).click();
 await expect.poll(()=>project.deck.slides[0].nodes.find(n=>n.semanticRole==='title').style?.fontSizePt).toBe(32);
 const title=editor.locator('[data-node-id]').filter({hasText:'Topic 1'}).last();await expect(title.locator('[style*="font-style"]').first()).toHaveCSS('font-style','italic');await shot('paused-formatting');
 assert.equal(project.deck.slides[0].nodes.find(n=>n.semanticRole==='title').style.fontFamily,'Georgia');assert.ok(!await editor.getByText('Topic 4',{exact:true}).count(),'pending pages not editable');checks.push('Running deck pauses, edits finished page with production batch style command, and hides pending pages');
 await editor.getByRole('button',{name:'关闭编辑器',exact:true}).click();await expect(editor).toHaveCount(0);await monitor.getByRole('button',{name:'恢复生成',exact:true}).click();await expect.poll(()=>calls.at(-1)).toBe('resume');checks.push('Closing paused editor retains draft and exposes resume');
 project.status='completed';project.nodes=Object.fromEntries(project.outline.map(slide=>[slide.id,{status:'done'}]));fixture.projects.set(project.id,project);await page.goto(base+'/ppt');await page.getByRole('heading',{name:'Editable generation fixture',exact:true}).click();await page.getByRole('button',{name:'打开编辑器',exact:true}).click();await expect(editor).toBeVisible();
 await toolbar.getByRole('button',{name:'选择本页文字'}).click();await toolbar.getByRole('spinbutton',{name:'字号',exact:true}).fill('28');await toolbar.getByRole('button',{name:'应用样式',exact:true}).click();await expect.poll(()=>project.deck.slides[0].nodes.find(n=>n.semanticRole==='title').style.fontSizePt).toBe(28);await shot('completed-formatting');checks.push('Completed presentation shares the same formatting controls');
 await editor.getByRole('button',{name:'添加版式',exact:true}).click();await editor.getByRole('button',{name:'对比',exact:true}).click();await expect.poll(()=>project.deck.slides[0].layoutId).toBe('comparison');assert.equal(project.deck.slides[0].nodes.find(n=>n.semanticRole==='title').content.text,'Topic 1');await shot('completed-layout');checks.push('Layout change preserves the edited text and style');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({transport:'CDP',checks,errors,calls},null,2));console.log(JSON.stringify({checks,errors},null,2));
} finally {if(browser)await browser.close();if(host)await host.close();}
