import {test,expect} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';

test('PPT live follow moves the canvas to the earliest unfinished page in page order and repeated snapshots preserve scroll @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;
 // Pages finish out of order under concurrent writers; follow targets the earliest page that is not render-ready (s2).
 for(const ready of ['s0','s1']){project.nodes[ready].status='completed';project.runtime.slides[ready].phase='render_ready';}
 project.nodes.s3.status='completed';project.runtime.slides.s3.phase='render_ready';let streams=0;
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname===`/api/ppt/projects/${id}/events`){
   streams++;
   return route.fulfill({status:200,contentType:'text/event-stream',body:`event: snapshot\ndata: ${JSON.stringify({project,run:{lastSeq:1}})}\n\nevent: run-event\ndata: ${JSON.stringify({seq:2,type:'slide.render_ready',payload:{slideId:'s2'}})}\n\n`});
  }
  const raw=request.postData(),result=await fixture.handle(request.method(),url.pathname,raw?JSON.parse(raw):{});
  if(!result)return route.continue();
  return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto(`/ppt?projectId=${id}`, {waitUntil:'domcontentloaded'});
 const canvas=page.locator('#ppt-editor-canvas'),article=canvas.locator('article').nth(2);
 await expect(canvas).toBeVisible();
 await expect.poll(()=>canvas.evaluate(el=>el.scrollTop)).toBeGreaterThan(500);
 await expect.poll(async()=>{const a=await article.boundingBox(),c=await canvas.boundingBox();return !!a&&!!c&&Math.abs(a.y-c.y)<70;}).toBe(true);
 await page.screenshot({path:info.outputPath('live-follow-actual-canvas.png')});
 await canvas.evaluate(el=>{el.scrollTop-=100;});const manual=await canvas.evaluate(el=>el.scrollTop),initial=streams;
 await expect.poll(()=>streams,{timeout:10000}).toBeGreaterThan(initial);
 await expect.poll(()=>canvas.evaluate(el=>el.scrollTop)).toBe(manual);
});


test('PPT render snapshot restores live canvas while remembered manual browsing stays selected @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;
 for(const ready of ['s0','s1','s2','s3']){project.nodes[ready].status='completed';project.runtime.slides[ready].phase='render_ready';project.runtime.slides[ready].updatedAt=new Date().toISOString();}
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),raw=req.postData();const result=await fixture.handle(req.method(),url.pathname,raw?JSON.parse(raw):{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});});
 await page.goto(`/ppt?projectId=${id}`, {waitUntil:'domcontentloaded'});const canvas=page.locator('#ppt-editor-canvas');await expect.poll(()=>canvas.evaluate(el=>el.scrollTop)).toBeGreaterThan(1500);
 await page.screenshot({path:info.outputPath('snapshot-recovers-canvas.png')});
 await page.evaluate(({id})=>{sessionStorage.setItem(`ppt-follow-live:${id}`,'false');sessionStorage.setItem(`ppt-viewed-page:${id}`,'s1');},{id});
 await page.reload();await expect.poll(()=>canvas.evaluate(el=>el.scrollTop)).toBeGreaterThan(300);await expect.poll(()=>canvas.evaluate(el=>el.scrollTop)).toBeLessThan(1300);
});

test('Home can start a fresh quality retry without removing the retained PPT checkpoint @smoke',async({page})=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;project.status='quality_blocked';let retries=0;
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),raw=req.postData();if(url.pathname===`/api/ppt/projects/${id}/retry`&&req.method()==='POST'){retries++;project.status='generating';}const result=await fixture.handle(req.method(),url.pathname,raw?JSON.parse(raw):{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});});
 await page.goto('/chat', {waitUntil:'domcontentloaded'});const tasks=page.getByTestId('ppt-background-tasks');await expect(tasks).toBeVisible();await tasks.getByRole('button',{name:/重试.*Workflow fixture|Retry.*Workflow fixture/}).click();await expect.poll(()=>retries).toBe(1);await expect(tasks.getByRole('link')).toHaveAttribute('href',`/ppt?projectId=${id}`);await expect(tasks).toContainText('Workflow fixture');
});

test('PPT unfinished pages show planned skeletons, real stages and a non-editable streaming draft @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;
 for(const ready of ['s0','s1']){project.nodes[ready].status='completed';project.runtime.slides[ready].phase='render_ready';}
 for(const pending of ['s2','s3','s4'])project.renderTree.slides.find((slide:any)=>slide.slideId===pending||slide.id===pending).elements=[];
 project.outline=project.outline.map((slide:any)=>slide.id==='s3'?{...slide,section:'Section 3',focus:'Planned claim for page four',keyPoints:[{text:'First planned point',refs:[],chunkRefs:[]}]}:slide);
 project.nodes.s2.status='running';
 project.generationStages={deck:'writing',pages:{s0:'ready',s1:'ready',s2:'writing',s3:'retrieving',s4:'waiting'}};
 const draft={title:'Streaming title for page three',blocks:[{field:'body',text:'A closed paragraph already written.'}],typing:'The sentence being typed',chars:128};
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname===`/api/ppt/projects/${id}/events`)return route.fulfill({status:200,contentType:'text/event-stream',body:`event: snapshot\ndata: ${JSON.stringify({project,run:{lastSeq:1}})}\n\nevent: draft\ndata: ${JSON.stringify({slideId:'s2',draft})}\n\n`});
  const raw=request.postData(),result=await fixture.handle(request.method(),url.pathname,raw?JSON.parse(raw):{});
  if(!result)return route.continue();
  return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto(`/ppt?projectId=${id}`, {waitUntil:'domcontentloaded'});
 await expect(page.getByTestId('ppt-live-editor-state')).toContainText(/Writing pages|正在逐页生成|正在逐頁生成/);
 const writing=page.locator('[data-testid="ppt-generation-skeleton"][data-stage="writing"]');
 await expect(writing).toBeVisible();
 await expect(writing.getByTestId('ppt-generation-draft')).toContainText('A closed paragraph already written.');
 await expect(writing).toContainText('Streaming title for page three');
 await expect(writing).toContainText('The sentence being typed');
 const planned=page.locator('[data-testid="ppt-generation-skeleton"][data-stage="retrieving"]');
 await expect(planned).toContainText('Planned claim for page four');await expect(planned).toContainText('First planned point');
 await expect(page.locator('[data-testid="ppt-generation-skeleton"][data-stage="waiting"]')).toHaveCount(1);
 await writing.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('generation-skeleton-draft.png')});
});

test('Home task strip shows the user-facing deck stage and current page, never internal node IDs @smoke',async({page})=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;
 const summary={...project,stage:'review:deck',deckStage:'reviewing',currentPage:{index:4,title:'Core tension',stage:'repairing'},progress:{contentReady:12,previewReady:12,total:12,phase:'review:deck',quality:'pending',lastUpdated:new Date().toISOString()}};
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/ppt/projects'&&request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[summary]})});
  const raw=request.postData(),result=await fixture.handle(request.method(),url.pathname,raw?JSON.parse(raw):{});
  if(!result)return route.continue();
  return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto('/chat', {waitUntil:'domcontentloaded'});
 const stage=page.getByTestId('ppt-task-stage');
 await expect(stage).toContainText(/Reviewing the whole deck|整稿审查中|整稿審查中/);
 await expect(stage).toContainText('Core tension');
 await expect(page.getByTestId('ppt-background-tasks')).not.toContainText('review:deck');
});

test('Retired template images are listed with page and reason and need an explicit user confirmation @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;project.status='quality_blocked';
 const retired=[{objectId:'tpl_img_7a',page:7,role:'template_artwork',status:'retired_by_adaptation',reason:'source text needs the area',approvalBasis:'source_region_artwork_avoidance'},{objectId:'tpl_icon_15',page:15,role:'template_icon',status:'retired_by_adaptation',reason:null,approvalBasis:'unverified_request'}];
 project.quality={status:'blocked',deterministic:{issues:[{code:'media_conservation_blocked',severity:'error',message:'Only 45% of the template media remain'}],hardErrors:1},modelReview:null,repairs:[],mediaLedger:{conservation:.45,effectiveConservation:.45,approvedExclusions:0,retired}};
 let posted:any=null,retries=0;
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),raw=request.postData();
  if(url.pathname===`/api/ppt/projects/${id}/media-exclusions`&&request.method()==='POST'){posted=JSON.parse(raw||'{}');project.sourceObjectExclusions=posted.objectIds.map((objectId:string)=>({objectId,approvedBy:'user',reason:posted.reason}));project.quality={...project.quality,mediaLedger:{conservation:.45,effectiveConservation:.55,approvedExclusions:1,retired:retired.filter(item=>!posted.objectIds.includes(item.objectId))}};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({project,excluded:posted.objectIds.length})});}
  if(url.pathname===`/api/ppt/projects/${id}/retry`&&request.method()==='POST')retries++;
  const result=await fixture.handle(request.method(),url.pathname,raw?JSON.parse(raw):{});
  if(!result)return route.continue();
  return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto(`/ppt?projectId=${id}`, {waitUntil:'domcontentloaded'});
 const panel=page.getByTestId('ppt-media-retirements');
 await expect(panel).toBeVisible();
 await expect(panel).toContainText(/45%/);
 await expect(panel).toContainText(/第 7 页|Page 7|第 7 頁/);
 await expect(panel).toContainText(/为来源内容腾出位置而移除|Removed to make room for source content|為來源內容騰出位置而移除/);
 await expect(panel).not.toContainText('source_region_artwork_avoidance');
 const confirm=panel.getByRole('button',{name:/确认移除|Confirm removal|確認移除/});
 await expect(confirm).toBeDisabled();
 await panel.getByRole('checkbox').first().check();
 await expect(confirm).toBeDisabled();
 await panel.getByRole('textbox').fill('Decorative only; the source table needs the width');
 await confirm.click();
 await expect.poll(()=>posted?.objectIds).toEqual(['tpl_img_7a']);
 expect(posted.reason).toBe('Decorative only; the source table needs the width');
 await expect(panel.getByRole('status')).toContainText(/1/);
 await expect(panel).not.toContainText(/第 7 页|Page 7|第 7 頁/);
 await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:info.outputPath('media-retirements.png')});
 await panel.getByRole('button',{name:/重新检查质量|Re-check quality|重新檢查質量/}).click();
 await expect.poll(()=>retries).toBe(1);
});


test('A retry started from another tab reconnects a retained failed detail to the live editor @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;
 project.status='failed';project.error='Earlier review could not complete';let restarted=false;
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),raw=req.postData();
  const result=await fixture.handle(req.method(),url.pathname,raw?JSON.parse(raw):{});if(!result)return route.continue();
  return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
 });
 await page.goto(`/ppt?projectId=${id}`, {waitUntil:'domcontentloaded'});await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(page.getByText('Earlier review could not complete',{exact:true}).first()).toBeVisible();
 project.status='generating';project.currentRunId='external-retry';project.error='';project.updatedAt=new Date().toISOString();restarted=true;
 await expect(page.locator('#ppt-editor-canvas')).toBeVisible({timeout:30000});
 await expect(page.getByTestId('ppt-live-editor-state')).toBeVisible();await page.screenshot({path:info.outputPath('external-retry-restores-live-editor.png')});
 expect(restarted).toBe(true);
});

test('A failed later stage retains the verified editor and disables AI only on pending pages @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project:any=fixture.projects.get(id)!;
 project.status='failed';project.stage='generation';project.error='Later review transport failed';
 for(const slide of project.outline){project.nodes[slide.id].status='done';project.runtime.slides[slide.id].phase='render_ready';project.runtime.slides[slide.id].preview=project.renderTree.slides.find((tree:any)=>tree.slideId===slide.id||tree.id===slide.id);}
 project.nodes.s1.status='pending';delete project.runtime.slides.s1.preview;project.runtime.slides.s1.phase='queued';
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),raw=req.postData(),result=await fixture.handle(req.method(),url.pathname,raw?JSON.parse(raw):{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});});
 await page.goto('/ppt?projectId='+id, {waitUntil:'domcontentloaded'});const editor=page.getByTestId('ppt-structured-editor');await expect(editor).toBeVisible();
 await expect(page.getByRole('alertdialog')).toContainText('Later review transport failed');await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toHaveCount(0);await editor.getByRole('button',{name:'错误详情',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('Later review transport failed');await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toHaveCount(0);
 await editor.getByRole('button',{name:'AI 局部优化',exact:true}).click();await editor.getByRole('textbox',{name:'编辑要求',exact:true}).fill('Clarify the existing title');
 const preview=editor.getByRole('button',{name:'用 AI 编辑当前页',exact:true});await expect(preview).toBeEnabled();
 await editor.getByRole('combobox',{name:'目标页面',exact:true}).click();await page.getByRole('option').nth(1).click();await expect(preview).toBeDisabled();
 await expect(editor).toContainText('请等待本页完成校验');await page.screenshot({path:info.outputPath('failed-stage-retains-verified-editor.png')});
});

test('An automatic outline that outgrew its page budget waits for confirmation and shows the concision metrics @smoke',async({page},info)=>{
 const fixture=pptParityFixture(),id='9'.repeat(32),project=fixture.projects.get(id)! as unknown as {status:string;stage:string;pageDecision?:Record<string,unknown>};
 project.status='outline_ready';project.stage='outline';
 project.pageDecision={...(project.pageDecision||{}),source:'estimate',mode:'auto',confirmedAt:null,initialPageCount:8,finalPageCount:12,
  growth:{version:1,initial:8,final:12,limit:10,basis:'presentation_budget',needsConfirmation:true},
  concision:{version:1,pages:12,contentPages:9,majorSections:12,pagesPerSection:.75,medianFill:.55,withinBudget:false,budget:{target:8,max:10},warnings:['over_budget','underfilled','page_per_section']}};
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),raw=request.postData();const result=await fixture.handle(request.method(),url.pathname,raw?JSON.parse(raw):{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});});
 await page.goto(`/ppt?projectId=${id}`);
 const notice=page.getByTestId('ppt-outline-concision');
 await expect(notice).toBeVisible();
 await expect(notice.getByRole('alert')).toContainText(/12[\s\S]*10/);
 await expect(notice).toContainText(/0\.75/);
 await expect(notice).toContainText(/55%/);
 await expect(notice.locator('li')).toHaveCount(3);
 await notice.scrollIntoViewIfNeeded();await notice.screenshot({path:info.outputPath('outline-concision.png')});
});
