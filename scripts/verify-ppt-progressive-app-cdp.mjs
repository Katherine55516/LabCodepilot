/** Actual Next application, CDP transport, isolated shared API fixture. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {transform} from 'esbuild';import {chromium,expect} from '@playwright/test';
const fixtureModule=await transform(fs.readFileSync('src/__tests__/fixtures/ppt-parity.ts','utf8'),{loader:'ts',format:'esm'});
const {pptParityFixture}=await import('data:text/javascript;base64,'+Buffer.from(fixtureModule.code).toString('base64'));
const fixture=pptParityFixture(),project=fixture.projects.get('9'.repeat(32));
project.prompt='Keep the supplied figures and explain the mechanism.';
project.outline.forEach((slide,index)=>{project.nodes[slide.id].status=index<2?'done':index===2?'running':'pending';});
const base=process.env.PPT_CDP_URL || 'http://localhost:3000';
const output=path.resolve(process.env.PPT_CDP_OUTPUT || 'outputs/ppt-input-progressive-editor-20261013/full-app-progressive-cdp');fs.mkdirSync(output,{recursive:true});
const checks=[],errors=[];let host,browser;
try {
 host=await chromium.launch({headless:true,args:['--remote-debugging-port=9239']});browser=await chromium.connectOverCDP('http://127.0.0.1:9239');
 const page=await browser.newPage({viewport:{width:1440,height:600}}),cdp=await page.context().newCDPSession(page);page.setDefaultNavigationTimeout(120000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});
 await page.route('**/api/**',async route=>{const r=await fixture.handle(route.request().method(),new URL(route.request().url()).pathname,route.request().postData()?route.request().postDataJSON():{});if(!r)return route.continue();return route.fulfill({status:r.status,contentType:r.contentType||'application/json',body:typeof r.body==='string'?r.body:JSON.stringify(r.body)});});
 const screenshot=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
 await page.goto(base+'/ppt');await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();
 const canvas=page.getByTestId('ppt-generation-pages');await expect(canvas.getByTestId('ppt-generation-page')).toHaveCount(3);await expect(canvas.locator('[data-page-state=pending]')).toHaveCount(0);await expect.poll(()=>canvas.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);checks.push('Completed/current pages remain visible; future blank templates are absent; follow scrolls to current page');await screenshot('progressive-pages');
 await page.getByTestId('ppt-generation-monitor').locator('header').getByRole('button',{name:'修改生成要求',exact:true}).click();
 const panel=page.getByTestId('ppt-generation-edit');await expect(panel.getByTestId('ppt-generation-messages')).toContainText(project.prompt);
 for(const size of [{width:1440,height:600},{width:390,height:500}]) {
  await cdp.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:size.width<600});const scroll=panel.getByTestId('ppt-generation-edit-scroll');await scroll.evaluate(e=>e.scrollTop=e.scrollHeight);
  await panel.getByRole('textbox').fill('Centre the table and keep the visible evidence.');const submit=panel.getByRole('button',{name:'提交修改',exact:true});await expect(submit).toBeVisible();const b=await submit.boundingBox();assert.ok(b.y+b.height<=size.height+1);assert.ok(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight));await screenshot('chat-'+size.width);checks.push(size.width+'px: scrolling works and submit remains inside viewport');
 }
 await panel.getByRole('button',{name:'提交修改',exact:true}).click();await expect(panel.getByTestId('ppt-generation-messages')).toContainText('Centre the table');await expect(panel.getByTestId('ppt-generation-messages')).toContainText('处理结果');assert.equal(fixture.payloads.filter(p=>p.action==='generation-edits').length,1);checks.push('User request and assistant result are shown after submission');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await page.goto(base+'/ppt');await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();
 await page.getByRole('combobox',{name:'LLM（必填）'}).selectOption('managed-demo::demo-model');await page.getByRole('button',{name:'确认并继续 →'}).click();await page.getByRole('button',{name:/Teaching template/}).click();await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
 const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});await input.fill('Explain the attached evidence in 8 slides.');const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVKHmEEYCvluBm4PGgNZZ19N8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPr/wBoUlll4sAAAAASUVORK5CYII=','base64');
 await page.getByTestId('ppt-input-images').locator('input[type=file]').setInputFiles({name:'evidence.png',mimeType:'image/png',buffer:png});await input.evaluate((el,data)=>{const clipboard=new DataTransfer();clipboard.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true}));},png.toString('base64'));await expect(page.getByTestId('ppt-input-images').getByRole('img')).toHaveCount(2);await screenshot('prompt-images');await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='prompt')?.images?.length).toBe(2);checks.push('Selected and clipboard PNGs enter the actual Prompt creation payload');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({transport:'CDP',application:base+'/ppt',checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
} finally {if(browser)await browser.close();if(host)await host.close();}
