import {test,expect,type Page} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';

type FixtureProject=ReturnType<ReturnType<typeof pptParityFixture>['projects']['get']>&object;
type FixtureRoute=(path:string,method:string,body:Record<string,unknown>,project:FixtureProject)=>unknown;
async function editorFixture(page:Page,unpublished=false,prepare?:(project:FixtureProject)=>void,routes?:FixtureRoute){
 const fixture=pptParityFixture(),project=fixture.projects.get('9'.repeat(32))!;
 project.status=unpublished?'quality_blocked':'completed';project.stage=project.status;
 project.publishedRevision=unpublished?0:project.revision;
 Object.assign(project,{templateSpec:{id:'light',fonts:{title:'Libre Baskerville',body:'Source Sans 3'}}});
 const slide=project.renderTree.slides[0],title=slide.elements[0];
 title.id=title.nodeId;
 Object.assign(title.style,{fontFamily:'Libre Baskerville',eastAsiaFontFamily:'Libre Baskerville'});
 slide.elements.push({...title,id:'body-node',nodeId:'body-node',semanticRole:'body',content:{text:'The selected body keeps its source and its independent formatting.'},bounds:{x:500000,y:2500000,width:10000000,height:1000000},style:{...title.style,fontSizePt:18},zIndex:2});
 const commands:{type:string;payload:{slideId:string;changes?:{nodeId:string;style:Record<string,unknown>;merge:boolean}[]}}[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,body=request.postData()?request.postDataJSON():{};
  const handled=routes?.(path,request.method(),body,project);if(handled)return route.fulfill({json:handled});
  if(path.endsWith('/commands')&&request.method()==='POST'){
   commands.push(body);
   if(body.type==='nodes.setStyle')for(const change of body.payload.changes){const node=project.renderTree.slides.find(s=>s.slideId===body.payload.slideId)?.elements.find(n=>n.nodeId===change.nodeId);if(node)Object.assign(node.style,change.style);}
   project.revision++;project.renderTree.hash='fixture-'+project.revision;
   return route.fulfill({json:{project,operation:{id:'operation-'+project.revision,revision:project.revision}}});
  }
  const response=await fixture.handle(request.method(),path,body);
  return route.fulfill({status:response?.status||200,contentType:response?.contentType||'application/json',body:response?typeof response.body==='string'?response.body:JSON.stringify(response.body):'{}'});
 });
 prepare?.(project);
 await page.goto('/ppt',{waitUntil:'domcontentloaded'});
 await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0,{timeout:30000});
 if(unpublished){
  await page.getByRole('navigation',{name:'PPT 工作区导航'}).getByRole('button',{name:/任务中心/}).click();
  await page.getByTestId('ppt-task-center').locator('article').filter({hasText:'Workflow fixture'}).getByRole('button',{name:/查看任务/}).click();
 }else await page.getByRole('heading',{name:'Workflow fixture',exact:true}).click();

 await expect(page.getByTestId('ppt-structured-editor')).toBeVisible();
 return{project,commands,errors};
}

test('text toolbar edits template fonts, size and emphasis only on the selected text @smoke',async({page},info)=>{
 const {project,commands,errors}=await editorFixture(page),toolbar=page.getByTestId('ppt-text-toolbar');
 await toolbar.getByRole('button',{name:'选标题',exact:true}).click();
 await expect(toolbar.getByRole('combobox',{name:'字体',exact:true})).toHaveValue('Libre Baskerville');
 await toolbar.getByRole('combobox',{name:'字体',exact:true}).selectOption('Georgia');
 await toolbar.getByRole('spinbutton',{name:'字号',exact:true}).fill('24');
 for(const name of ['粗体','斜体','下划线'])await toolbar.getByRole('button',{name,exact:true}).click();
 await toolbar.getByRole('combobox',{name:'对齐',exact:true}).selectOption('center');
 await toolbar.getByRole('spinbutton',{name:'行高',exact:true}).fill('1.5');
 await toolbar.locator('input[type="color"]').fill('#445566');
 await toolbar.getByRole('button',{name:'应用样式',exact:true}).click();
 await expect.poll(()=>commands.length).toBe(1);
 expect(commands[0]).toMatchObject({type:'nodes.setStyle',payload:{slideId:'s0',changes:[{nodeId:'n0',merge:true,style:{fontFamily:'Georgia',eastAsiaFontFamily:'Georgia',fontSizePt:24,fontWeight:700,fontStyle:'italic',textDecoration:'underline',textAlign:'center',lineHeight:1.5,color:'#445566'}}]}});
 expect(project.renderTree.slides[0].elements[1].style.fontSizePt).toBe(18);
 await toolbar.getByRole('button',{name:'选正文',exact:true}).click();
 await expect(toolbar.getByRole('spinbutton',{name:'字号',exact:true})).toHaveValue('18');
 await toolbar.getByRole('spinbutton',{name:'字号',exact:true}).fill('120');
 await toolbar.getByRole('button',{name:'应用样式',exact:true}).click();
 expect(commands,'invalid manual size must not submit a mutation').toHaveLength(1);
 await toolbar.getByRole('spinbutton',{name:'字号',exact:true}).fill('20');
 await toolbar.getByRole('button',{name:'应用样式',exact:true}).click();
 await expect.poll(()=>commands.length).toBe(2);
 expect(commands[1].payload.changes?.map(c=>c.nodeId)).toEqual(['body-node']);
 await page.setViewportSize({width:480,height:800});
 await page.screenshot({path:info.outputPath('text-controls-mobile.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('unaccepted draft export has no keyboard-activatable download target @smoke',async({page},info)=>{
 const {errors}=await editorFixture(page,true);
 await page.getByRole('button',{name:/导出$/}).click();
 const dialog=page.getByRole('dialog').filter({hasText:'导出演示文稿'});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('a[href$="/export"],a[href$="/pdf"]')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'PPTX（可编辑）',exact:true})).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'PDF',exact:true})).toBeDisabled();
 await page.screenshot({path:info.outputPath('draft-export-blocked.png')});
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(errors).toEqual([]);
});

test('published export and presentation navigation keep the object commands untouched @smoke',async({page},info)=>{
 const {commands,errors}=await editorFixture(page);
 await page.getByRole('button',{name:/导出$/}).click();
 const dialog=page.getByRole('dialog').filter({hasText:'导出演示文稿'});
 await expect(dialog.getByRole('link',{name:'PPTX（可编辑）',exact:true})).toHaveAttribute('href',/\/export$/);
 await expect(dialog.getByRole('link',{name:'PDF',exact:true})).toHaveAttribute('href',/\/pdf$/);
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:/演示$/}).click();
 await expect(page.getByText('1 / 12',{exact:true})).toBeVisible();
 const exit=page.getByRole('button',{name:'退出',exact:true}),presentation=exit.locator('../..');
 await expect(presentation.getByRole('button',{name:'←',exact:true})).toBeDisabled();
 await presentation.getByRole('button',{name:'→',exact:true}).click();
 await expect(page.getByText('2 / 12',{exact:true})).toBeVisible();
 await presentation.getByRole('button',{name:'←',exact:true}).click();
 await page.screenshot({path:info.outputPath('presentation.png')});
 await exit.click();await expect(exit).toHaveCount(0);expect(commands).toEqual([]);expect(errors).toEqual([]);
});

// Fable plan T35: the template preview dialog lists every page as a thumbnail,
// marks the shown page, turns pages with ←/→, retries a failed thumbnail on its
// own and keeps the strip inside a phone-width dialog.
test('template preview thumbnails select, page by keyboard and retry one failed page @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),errors:string[]=[];let failSlide3=true;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),body=request.postData()?request.postDataJSON():{};
  if(url.pathname.endsWith('/preview')&&url.searchParams.get('slide')==='3'&&failSlide3)return route.fulfill({status:500,body:'fixture failure'});
  const response=await fixture.handle(request.method(),url.pathname,body);
  return route.fulfill({status:response?.status||200,contentType:response?.contentType||'application/json',body:response?typeof response.body==='string'?response.body:JSON.stringify(response.body):'{}'});
 });
 await page.goto('/ppt',{waitUntil:'domcontentloaded'});
 await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0,{timeout:30000});
 await page.getByRole('navigation',{name:'PPT 工作区导航'}).getByRole('button',{name:/模板中心/}).click();
 await page.getByRole('article').filter({hasText:'Teaching template'}).getByRole('button',{name:'预览',exact:true}).click();
 const dialog=page.getByTestId('ppt-template-preview'),thumbs=dialog.getByRole('tablist',{name:'模板页面'});
 await expect(thumbs.getByRole('tab')).toHaveCount(12);
 await expect(thumbs.getByRole('tab',{name:'第 1 页',exact:true})).toHaveAttribute('aria-current','page');
 await thumbs.getByRole('tab',{name:'第 5 页',exact:true}).click();
 await expect(dialog.getByText('5/12',{exact:true})).toBeVisible();
 await expect(thumbs.getByRole('tab',{name:'第 5 页',exact:true})).toHaveAttribute('aria-selected','true');
 await dialog.press('ArrowRight');await expect(dialog.getByText('6/12',{exact:true})).toBeVisible();
 await dialog.press('ArrowLeft');await dialog.press('ArrowLeft');await expect(dialog.getByText('4/12',{exact:true})).toBeVisible();
 // Page 4 (slide=3) failed alone; its retry reloads only that thumbnail.
 const retry=dialog.getByRole('button',{name:'重新加载 · 第 4 页',exact:true});await retry.scrollIntoViewIfNeeded();await expect(retry).toBeVisible();
 failSlide3=false;await retry.click();await expect(retry).toHaveCount(0);
 await expect.poll(()=>thumbs.getByRole('tab',{name:'第 4 页',exact:true}).locator('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
 await page.screenshot({path:info.outputPath('template-preview-thumbs-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 await expect(thumbs).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await thumbs.evaluate(element=>getComputedStyle(element).flexDirection)).toBe('row');
 await expect.poll(()=>thumbs.getByRole('tab',{name:'第 4 页',exact:true}).evaluate(tab=>{const a=tab.getBoundingClientRect(),b=tab.closest('[role=tablist]')!.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;})).toBe(true);
 await page.screenshot({path:info.outputPath('template-preview-thumbs-mobile.png')});
 expect(errors).toEqual([]);
});

test('export says when the rendered-page check could not run on this computer @smoke',async({page})=>{
 // Published on a host without LibreOffice: the PPTX structure was verified, rendered visibility was not.
 const {errors}=await editorFixture(page,false,project=>{Object.assign(project,{quality:{...(project as {quality?:object}).quality,acceptanceAxes:{nativeExport:{status:'verified',renderedVisibility:'unavailable'}}}});});
 await page.getByRole('button',{name:/导出$/}).click();
 const dialog=page.getByRole('dialog').filter({hasText:'导出演示文稿'});
 await expect(dialog.getByTestId('ppt-export-visibility-unverified')).toHaveText(/本机的 LibreOffice 不可用/);
 await expect(dialog.getByRole('link',{name:'PPTX（可编辑）',exact:true})).toHaveAttribute('href',/\/export$/);
 expect(errors).toEqual([]);
});

test('published outline-first deck lists review findings that did not block publishing @smoke',async({page},info)=>{
 // One targeted repair was tried; the reviewer's remaining finding is listed, not a gate.
 const detail='"Adopted by every fund" is not stated in the source.';
 const {errors}=await editorFixture(page,false,project=>{Object.assign(project,{quality:{...(project as {quality?:object}).quality,status:'passed_with_warnings',reviewAdvisories:1,modelIssues:[{code:'model_unsupported',severity:'warning',advisory:true,requiresReview:true,detail,slideIds:['s2']}]}});});
 await expect(page.getByTestId('ppt-review-advisories')).toContainText('1 项提示未阻断发布');
 await expect(page.getByTestId('ppt-review-advisories')).toContainText(detail);
 await page.getByRole('button',{name:/导出$/}).click();
 const dialog=page.getByRole('dialog').filter({hasText:'导出演示文稿'});
 await expect(dialog.getByTestId('ppt-export-review-advisories')).toHaveText(/整稿审查有 1 项提示未阻断发布/);
 await expect(dialog.getByRole('link',{name:'PPTX（可编辑）',exact:true})).toHaveAttribute('href',/\/export$/);
 await page.screenshot({path:info.outputPath('review-advisories-export.png')});
 expect(errors).toEqual([]);
});

test('export shows no rendering notice when the check ran @smoke',async({page})=>{
 await editorFixture(page);
 await page.getByRole('button',{name:/导出$/}).click();
 const dialog=page.getByRole('dialog').filter({hasText:'导出演示文稿'});
 await expect(dialog.getByRole('link',{name:'PPTX（可编辑）',exact:true})).toBeVisible();
 await expect(dialog.getByTestId('ppt-export-visibility-unverified')).toHaveCount(0);
 await expect(dialog.getByTestId('ppt-export-review-advisories')).toHaveCount(0);
});

test('review advisories are flagged in the editor, applied through an AI proposal and dismissed @smoke',async({page},info)=>{
 // Live view shape (review-advisories.mjs): one entry per finding, its target on each flagged page.
 const unsupported={id:'adv_'+'a'.repeat(20),code:'model_unsupported',severity:'warning',advisory:true,requiresReview:true,slideIds:['s0'],targets:[{slideId:'s0',nodeId:'body-node',basis:'quote'}],
  detail:'"keeps its source" is broader than the source states.',suggestedFix:'Say which source the body keeps, as the source does.'};
 const repeated={id:'adv_'+'b'.repeat(20),code:'model_repeated',severity:'warning',advisory:true,requiresReview:true,slideIds:['s0','s1'],targets:[{slideId:'s0',nodeId:null,basis:'page'},{slideId:'s1',nodeId:'n1',basis:'named'}],
  detail:'Topic 1 and Topic 2 open with the same claim.'};
 const requests:{path:string;body:Record<string,unknown>}[]=[];
 const count=(project:FixtureProject)=>{const quality=(project as unknown as {quality:{modelIssues:{review?:unknown}[];reviewAdvisories:number;reviewedAdvisories:number}}).quality;quality.reviewAdvisories=quality.modelIssues.filter(i=>!i.review).length;quality.reviewedAdvisories=quality.modelIssues.length-quality.reviewAdvisories;};
 const {project,commands,errors}=await editorFixture(page,false,project=>{Object.assign(project,{quality:{...(project as {quality?:object}).quality,status:'passed_with_warnings',reviewAdvisories:2,reviewedAdvisories:0,modelIssues:[unsupported,repeated]}});},(path,method,body,project)=>{
  if(method!=='POST')return null;
  const issue=(id:string)=>(project as unknown as {quality:{modelIssues:{id:string;review?:object}[]}}).quality.modelIssues.find(i=>i.id===id)!;
  if(path.endsWith('/ai-edit')){requests.push({path,body});return {proposal:{id:'proposal_advisory',scope:'object',type:'content',slideId:'s0',nodeId:'body-node',instruction:'Apply the deck reviewer\'s suggested fix.',baseRevision:project.revision,
   beforeSvg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="20" y="60">Original</text></svg>',afterSvg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="20" y="60">Candidate</text></svg>',quality:{issues:[],hardErrors:0}}};}
  if(path.endsWith('/proposals/proposal_advisory/apply')){requests.push({path,body});project.revision++;issue(unsupported.id).review={status:'applied',operationId:'proposal_advisory'};count(project);return {project,operation:{id:'proposal_advisory',revision:project.revision}};}
  const decision=path.match(/\/review-advisories\/(adv_[a-f0-9]{20})$/);
  if(decision){requests.push({path,body});const target=issue(decision[1]);if(body.status==='dismissed')target.review={status:'dismissed'};else delete target.review;count(project);return {project};}
  return null;
 });
 const rail=page.getByRole('complementary',{name:'页面缩略图'}),thumb=(n:number)=>rail.locator('[data-review-advisories]').filter({hasText:`${n}. `});
 // Highlight: the rail marks both flagged pages; the canvas outlines the flagged object with the reviewer's reason on hover.
 await expect(thumb(1).getByTestId('ppt-thumb-advisory')).toHaveText('⚑ 2');
 await expect(thumb(2).getByTestId('ppt-thumb-advisory')).toHaveText('⚑ 1');
 await expect(rail.getByTestId('ppt-thumb-advisory')).toHaveCount(2);
 const body=page.locator('[data-render-slide-id="render0"] [data-node-id="body-node"]');
 await expect(body).toHaveAttribute('data-review-advisory','open');
 await expect(body).toHaveAttribute('title',`审查提示：${unsupported.detail}`);
 await expect(page.locator('[data-render-slide-id="render0"] [data-node-id="n0"]')).not.toHaveAttribute('data-review-advisory','open');
 // Selecting the flagged object shows the finding next to it, and in the page's list below the slide.
 await body.click();
 const composer=page.getByTestId('ppt-inline-ai'),inline=composer.getByTestId('ppt-inline-advisories');
 await expect(inline).toContainText(unsupported.detail);await expect(inline).toContainText(unsupported.suggestedFix);
 await expect(inline.locator('[data-advisory-id]')).toHaveCount(1);
 const panel=page.locator('[data-render-slide-id="render0"]').getByTestId('ppt-slide-advisories');
 await expect(panel.locator(`[data-advisory-id="${unsupported.id}"]`)).toHaveAttribute('data-focused','true');
 await expect(panel).toContainText(unsupported.detail);await expect(panel).toContainText(unsupported.suggestedFix);await expect(panel).toContainText('来源未支持');
 await expect(panel.locator(`[data-advisory-id="${repeated.id}"]`)).toContainText('针对整页');
 await expect(panel.locator(`[data-advisory-id="${repeated.id}"]`).getByRole('button',{name:'应用建议'}),'no suggestion, nothing to apply').toHaveCount(0);
 await page.screenshot({path:info.outputPath('advisory-flagged.png')});
 // Apply: the server builds the edit from the stored finding; the preview is applied as a proposal (command path, undoable).
 await inline.getByRole('button',{name:'应用建议'}).click();
 await expect(composer.getByTestId('ppt-inline-target')).toHaveText('审查建议 · 1');
 await expect(inline).toHaveCount(0);
 await expect(composer.getByRole('button',{name:'应用',exact:true})).toBeVisible();
 expect(requests[0].body).toEqual({reviewAdvisoryId:unsupported.id,slideId:'s0',baseRevision:1,preview:true});
 await page.screenshot({path:info.outputPath('advisory-apply-preview.png')});
 await composer.getByRole('button',{name:'应用',exact:true}).click();
 await expect.poll(()=>requests.map(r=>r.path.split('/').slice(-2).join('/'))).toContain('proposal_advisory/apply');
 await expect(body).not.toHaveAttribute('data-review-advisory','open');
 await expect(thumb(1).getByTestId('ppt-thumb-advisory')).toHaveText('⚑ 1');
 expect(commands,'applying a suggestion never writes the project directly').toEqual([]);
 // Dismiss: a review decision; the count goes down everywhere, and it can be restored.
 const toggle=page.locator('[data-render-slide-id="render0"]').getByTestId('ppt-slide-advisory-toggle');
 await expect(toggle).toHaveText('⚑ 1 项审查提示');
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 await panel.locator(`[data-advisory-id="${repeated.id}"]`).getByRole('button',{name:'忽略'}).click();
 await expect(rail.getByTestId('ppt-thumb-advisory')).toHaveCount(0);
 expect(requests.at(-1)).toEqual({path:expect.stringMatching(new RegExp(`/review-advisories/${repeated.id}$`)),body:{status:'dismissed',baseRevision:2}});
 await expect(toggle).toHaveText('⚑ 已处理（2）');
 await panel.getByTestId('ppt-reviewed-advisories').locator('summary').click();
 await expect(panel.getByTestId('ppt-reviewed-advisories')).toContainText('已应用建议；保存时会重新审查');
 await page.screenshot({path:info.outputPath('advisory-reviewed.png')});
 await page.getByRole('button',{name:/导出$/}).click();
 await expect(page.getByRole('dialog').filter({hasText:'导出演示文稿'}).getByTestId('ppt-export-review-advisories')).toHaveCount(0);
 await page.getByRole('dialog').filter({hasText:'导出演示文稿'}).getByRole('button',{name:'关闭',exact:true}).click();
 await panel.getByTestId('ppt-reviewed-advisories').locator(`[data-advisory-id="${repeated.id}"]`).getByRole('button',{name:'恢复'}).click();
 await expect(thumb(2).getByTestId('ppt-thumb-advisory')).toHaveText('⚑ 1');
 expect(requests.at(-1)?.body).toEqual({status:'open',baseRevision:2});
 await page.setViewportSize({width:480,height:800});
 await panel.scrollIntoViewIfNeeded();await expect(panel).toBeVisible();
 await page.screenshot({path:info.outputPath('advisory-mobile.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
