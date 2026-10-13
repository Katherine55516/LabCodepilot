import {test,expect} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';
test('PPT editor renders semantic math and strips active content @smoke',async({page},info)=>{
 const fixture=pptParityFixture();const project=fixture.projects.get('9'.repeat(32))!;project.status='completed';
 Object.assign(project.renderTree.slides[0].elements[0].content,{text:'\\frac{a}{b}',mathText:'\\frac{a}{b}',mathMl:'<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac><mtext onclick="window.__mathUnsafe=true">safe</mtext><script>window.__mathUnsafe=true</script></math>'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/api/**',async route=>{const r=await fixture.handle(route.request().method(),new URL(route.request().url()).pathname,route.request().postData()?route.request().postDataJSON():{});if(!r)return route.continue();return route.fulfill({status:r.status,contentType:r.contentType||'application/json',body:typeof r.body==='string'?r.body:JSON.stringify(r.body)});});
 await page.goto('/ppt', {waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();await page.getByRole('button',{name:'打开编辑器',exact:true}).click();
 const editor=page.getByTestId('ppt-structured-editor');await expect(editor.locator('math mfrac').first()).toBeVisible();await expect(editor.locator('math script')).toHaveCount(0);await expect(editor.locator('math [onclick]')).toHaveCount(0);expect(await page.evaluate(()=>Reflect.get(window,'__mathUnsafe'))).toBeUndefined();
 await page.screenshot({path:info.outputPath('native-math-preview.png')});expect(errors).toEqual([]);
});

test('click and double click select/edit without submitting a geometry mutation @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),project=fixture.projects.get('9'.repeat(32))!;project.status='completed';project.renderTree.slides[0].elements[0].id='n0';const commands:string[]=[];
 await page.route('**/api/**',async route=>{const request=route.request(),body=request.postData()?request.postDataJSON():{};if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/commands'))commands.push(body.command?.type||body.type);const r=await fixture.handle(request.method(),new URL(request.url()).pathname,body);if(!r)return route.continue();return route.fulfill({status:r.status,contentType:r.contentType||'application/json',body:typeof r.body==='string'?r.body:JSON.stringify(r.body)});});
 await page.goto('/ppt', {waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();await page.getByRole('button',{name:'打开编辑器',exact:true}).click();
 const node=page.getByTestId('ppt-structured-editor').locator('[data-node-id="n0"]');await node.click();await node.dblclick();await expect(node.locator('textarea')).toBeVisible();expect(commands).toEqual([]);await page.screenshot({path:info.outputPath('real-object-textarea.png')});
});
