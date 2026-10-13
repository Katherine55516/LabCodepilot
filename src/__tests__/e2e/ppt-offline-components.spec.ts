import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import type {PptRenderElement} from '../../components/ppt/types';
import {pptParityFixture} from '../fixtures/ppt-parity';
// Produced by the no-provider production export harness; no independent UI geometry.
const scene=JSON.parse(readFileSync('src/__tests__/fixtures/ppt-offline-components.json','utf8'));
test('PPT offline components share canvas geometry and preserve navigation @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),project=fixture.projects.get('9'.repeat(32))!;
 project.status='completed';project.pages=scene.slides.length;
 project.outline=project.outline.slice(0,scene.slides.length).map((item,i)=>({...item,id:scene.slides[i].slideId,title:scene.slides[i].elements.find((x:{semanticRole:string})=>x.semanticRole==='title').content.text}));
 Object.assign(project,{deck:structuredClone(scene.fixtureDeck),templateSpec:scene.fixtureTemplateSpec});
 project.renderTree=structuredClone(scene);
 const server=async(name:string)=>import(pathToFileURL(path.resolve(`apps/cowork-server/lib/ppt/${name}.mjs`)).href);
 const [{normalizeCommand},{_internals},{buildRenderTree},{slideSvg}]=await Promise.all([server('command-schema'),server('command-service'),server('render-tree'),server('exporters/preview')]);
 const executed:string[]=[];
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/api/**',async route=>{const request=route.request();
 const previewId=new URL(request.url()).pathname.match(/\/slides\/([^/]+)\/preview$/)?.[1];
 if(previewId){const slide=project.renderTree.slides.find(x=>x.slideId===previewId);if(slide)return route.fulfill({status:200,contentType:'image/svg+xml',body:slideSvg(slide)});}
 if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/commands')) {
  const command=normalizeCommand(request.postDataJSON(),project);executed.push(command.type);Object.assign(project,{deck:_internals.applyToDeck(project.deck,command,project).deck,revision:project.revision+1});project.renderTree=buildRenderTree(project);
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({project,operation:{id:'op_fixture'}})});
 }
 const r=await fixture.handle(request.method(),new URL(request.url()).pathname,request.postData()?request.postDataJSON():{});if(!r)return route.continue();return route.fulfill({status:r.status,contentType:r.contentType||'application/json',body:typeof r.body==='string'?r.body:JSON.stringify(r.body)});});
 await page.goto('/ppt', {waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();await page.getByRole('button',{name:'打开编辑器',exact:true}).click();
 const editor=page.getByTestId('ppt-structured-editor');
 await editor.getByRole('button',{name:'2. Methods and conditions',exact:true}).click();
 await expect(editor.getByText('A ranked portfolio compares signals under a fixed universe.',{exact:false})).toBeVisible();
 await expect(editor.getByText('Costs and liquidity determine implementation limits.',{exact:false})).toBeVisible();
 await editor.locator('#ppt-editor-canvas article').nth(1).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('two-panels.png')});
 await editor.getByRole('button',{name:'3. Model and variables',exact:true}).click();
 await expect(editor.getByText('x is the input variable.',{exact:false})).toBeVisible();
 await expect(editor.getByLabel('y=ax+b',{exact:true})).toBeVisible();
 await editor.locator('#ppt-editor-canvas article').nth(2).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('formula-variables.png')});
 await editor.getByRole('button',{name:'4. Distinct research tasks',exact:true}).click();
 await expect(editor.getByText('State a testable hypothesis and its economic mechanism.',{exact:true})).toBeVisible();
 await editor.getByRole('button',{name:'添加版式',exact:true}).click();
 await page.getByRole('button',{name:'不等宽面板',exact:true}).click();
 await expect.poll(()=>executed.length).toBe(1);
 await page.getByRole('button',{name:'条目与图标',exact:true}).click();
 await expect.poll(()=>executed.length).toBe(2);
 await page.getByRole('button',{name:'关闭工具',exact:true}).click();
 await expect(editor.getByText('State a testable hypothesis and its economic mechanism.',{exact:true})).toBeVisible();
 // Use the browser's CDP session for the actual React canvas, not an HTML stand-in.
 const cdp=await page.context().newCDPSession(page);await cdp.send('Runtime.enable');
 const snapshot=await cdp.send('Page.captureScreenshot',{format:'png'});require('node:fs').writeFileSync(info.outputPath('components-desktop-cdp.png'),Buffer.from(snapshot.data,'base64'));
 await page.setViewportSize({width:980,height:760});await page.screenshot({path:info.outputPath('components-compact.png')});
 // Exercise the actual point inspector through production command validation.
 const body=project.renderTree.slides[3].elements.find(x=>x.kind==='list')! as PptRenderElement;
 const original=structuredClone(body.content!.items!);
 await editor.locator(`[data-node-id="${body.nodeId}"]`).click();
 await editor.getByRole('button',{name:'文本格式',exact:true}).click();
 await page.getByLabel('要点 2 说明',{exact:true}).fill('Compare alternatives with their source conditions preserved.');
 await page.getByRole('button',{name:'应用并重排',exact:true}).click();
 await expect.poll(()=>executed.filter(type=>type==='node.setContent').length).toBe(1);
 const updated=(project.deck!.slides[3] as any).nodes.find((x:any)=>x.id===body.nodeId).content.items;
 expect(updated).toHaveLength(original.length);expect(updated[0].text).toBe(original[0].text);expect(updated[2].text).toBe(original[2].text);
 await page.getByRole('button',{name:'关闭工具',exact:true}).click();
 await expect(editor.getByText('Compare alternatives with their source conditions preserved.',{exact:true})).toBeVisible();
 expect(errors).toEqual([]);await cdp.detach();
});
