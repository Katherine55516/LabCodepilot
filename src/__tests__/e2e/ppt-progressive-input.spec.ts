import {test,expect,type Page} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVKHmEEYCvluBm4PGgNZZ19N8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPr/wBoUlll4sAAAAASUVORK5CYII=','base64');
async function setup(page:Page) {
 const fixture=pptParityFixture();
 await page.route('**/api/**',async route=>{const r=await fixture.handle(route.request().method(),new URL(route.request().url()).pathname,route.request().postData()?route.request().postDataJSON():{});if(!r)return route.continue();return route.fulfill({status:r.status,contentType:r.contentType||'application/json',body:typeof r.body==='string'?r.body:JSON.stringify(r.body)});});
 await page.goto('/ppt');return fixture;
}
test('Prompt carries pasted/selected images through analyze and generation @smoke',async({page},info)=>{
 const fixture=await setup(page);
 await page.getByRole('button',{name:'＋ 新建',exact:true}).click();await page.getByRole('button',{name:/从 Prompt 开始/}).click();
 await page.getByRole('combobox',{name:'LLM（必填）'}).selectOption('managed-demo::demo-model');await page.getByRole('button',{name:'确认并继续 →'}).click();
 await page.getByRole('button',{name:/Teaching template/}).click();await page.getByRole('button',{name:'下一步：输入内容 →'}).click();
 const input=page.getByRole('textbox',{name:'输入 Prompt',exact:true});await input.fill('Explain the attached diagram in 8 slides.');
 await page.getByTestId('ppt-input-images').locator('input[type=file]').setInputFiles({name:'evidence.png',mimeType:'image/png',buffer:png});
 await expect(page.getByTestId('ppt-input-images').getByRole('img')).toHaveCount(1);
 // Real clipboard file path, handled by the Prompt textarea's bubbling paste.
 await input.evaluate((el,data)=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true}));},png.toString('base64'));
 await expect(page.getByTestId('ppt-input-images').getByRole('img')).toHaveCount(2);
 await page.screenshot({path:info.outputPath('prompt-with-images.png')});await page.getByRole('button',{name:'开始生成',exact:true}).click();
 await expect.poll(()=>fixture.payloads.find(p=>p.inputKind==='prompt')?.images?.length).toBe(2);
 expect(fixture.payloads.find(p=>p.inputKind==='prompt')?.images[0].fileName).toBe('evidence.png');
});
test('Progressive canvas hides future templates and keeps chat actions in short windows @smoke',async({page},info)=>{
 const fixture=await setup(page);const project=fixture.projects.get('9'.repeat(32))!;
 project.prompt='Keep the supplied figures and explain the mechanism.';
 project.outline.forEach((slide,index)=>{project.nodes[slide.id].status=index<2?'done':index===2?'running':'pending';});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.reload();await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();
 const canvas=page.getByTestId('ppt-generation-pages');await expect(canvas.getByTestId('ppt-generation-page')).toHaveCount(3);
 await expect(canvas.locator('[data-page-state=pending]')).toHaveCount(0);
 await page.getByTestId('ppt-generation-monitor').locator('header').getByRole('button',{name:'修改生成要求',exact:true}).click();
 const panel=page.getByTestId('ppt-generation-edit');await expect(panel.getByTestId('ppt-generation-messages')).toContainText(project.prompt);
 for(const viewport of [{width:1440,height:600},{width:390,height:500}]) {
  await page.setViewportSize(viewport);const scroll=panel.getByTestId('ppt-generation-edit-scroll');await scroll.evaluate(e=>e.scrollTop=e.scrollHeight);
  await panel.getByRole('textbox').fill('Show the table in the centre and retain its evidence.');
  const submit=panel.getByRole('button',{name:'提交修改',exact:true});await expect(submit).toBeVisible();
  const b=await submit.boundingBox();expect(b!.y+b!.height).toBeLessThanOrEqual(viewport.height);
  expect(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await page.screenshot({path:info.outputPath(`generation-chat-${viewport.width}.png`)});
 }
 await panel.getByRole('button',{name:'提交修改',exact:true}).click();
 await expect(panel.getByTestId('ppt-generation-messages')).toContainText('Show the table');await expect(panel.getByTestId('ppt-generation-messages')).toContainText('处理结果');
 expect(fixture.payloads.filter(p=>p.action==='generation-edits')).toHaveLength(1);expect(errors).toEqual([]);
});
