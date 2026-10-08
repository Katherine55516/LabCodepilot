import {chromium,expect} from '@playwright/test';
import {pptParityFixture} from '../../src/__tests__/fixtures/ppt-parity';
async function main(){
const root='outputs/ppt-copy-media-integrity-20261007';
const launched=await chromium.launch({headless:true,args:['--remote-debugging-port=9229']});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 const fixture=pptParityFixture();const project=fixture.projects.get('9'.repeat(32))!;project.status='completed';Object.assign(project.renderTree.slides[0].elements[0].content,{text:'\\frac{a}{b}',mathMl:'<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>'});
 await page.route('**/api/**',async route=>{const r=await fixture.handle(route.request().method(),new URL(route.request().url()).pathname,route.request().postData()?route.request().postDataJSON():{});if(!r)return route.continue();await route.fulfill({status:r.status,contentType:r.contentType||'application/json',body:typeof r.body==='string'?r.body:JSON.stringify(r.body)});});
 await page.goto('http://localhost:3017/ppt');await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();await page.getByRole('button',{name:'打开编辑器',exact:true}).click();const editor=page.getByTestId('ppt-structured-editor');await expect(editor.locator('math mfrac').first()).toBeVisible();await page.screenshot({path:root+'/cdp-desktop-math.png'});
 await editor.getByRole('button',{name:'AI 局部优化',exact:true}).click();await editor.getByRole('combobox',{name:'文字动作'}).selectOption('expand');await editor.getByRole('button',{name:'用 AI 编辑当前页',exact:true}).click();await expect(editor.getByTestId('ppt-ai-object-integrity')).toContainText('2');await page.screenshot({path:root+'/cdp-source-object-proposal.png'});await editor.getByRole('button',{name:'取消',exact:true}).click();
 await page.setViewportSize({width:390,height:500});await expect(editor.locator('math mfrac').first()).toBeVisible();await page.screenshot({path:root+'/cdp-mobile-math.png'});expect(errors).toEqual([]);console.log('CDP: desktop/mobile semantic math, actual local AI button/proposal/cancel, preserved-object count and console: OK');
}finally{await context.close();await browser.close();await launched.close();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
