import {test,expect} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';
import type {PptProject} from '@/components/ppt/types';

test('version switching hides stale previews and restores only the last selected side @smoke',async({page})=>{
  const fixture=pptParityFixture(),id='9'.repeat(32),proposalId='proposal_abc123',project=fixture.projects.get(id)! as unknown as PptProject;
  project.status='completed';project.templateSpec={id:'theme-fonts',name:'Theme fonts',version:1,fonts:{title:'Fraunces SemiBold',body:'DM Sans',titleEastAsia:'等线 Light',bodyEastAsia:'等线'}};
  const errors:string[]=[],restores:unknown[]=[];page.on('pageerror',e=>errors.push(e.message));
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname.endsWith('/proposals'))return route.fulfill({json:{proposals:[{id:proposalId,instruction:'Scoped text edit'}]}});
    if(url.pathname.endsWith('/version')){const side=url.searchParams.get('side');if(side==='after')await held;return route.fulfill({json:{version:{id:proposalId,side,readOnly:true,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text x="10" y="40">${side}</text></svg>`}}});}
    if(url.pathname.endsWith('/restore')){restores.push(request.postDataJSON());project.revision=(project.revision||0)+1;return route.fulfill({json:{project}});}
    const result=await fixture.handle(request.method(),url.pathname,request.postData()?request.postDataJSON():{});if(!result)return route.continue();return route.fulfill({status:result.status,contentType:result.contentType||'application/json',body:typeof result.body==='string'?result.body:JSON.stringify(result.body)});
  });
  try{
    await page.goto(`/ppt?projectId=${id}`,{waitUntil:'domcontentloaded'});await expect(page.getByTestId('ppt-structured-editor')).toBeVisible({timeout:60000});
    await page.getByRole('button',{name:'◐ 主题',exact:true}).click();await expect(page.getByText(/标题字体: Fraunces SemiBold/)).toBeVisible();await expect(page.getByText(/正文字体: DM Sans/)).toBeVisible();
    await page.getByRole('button',{name:'版本历史',exact:true}).click();const history=page.getByTestId('ppt-ai-version-history');
    await history.getByRole('button',{name:'原页面',exact:true}).click();await expect(history.locator('[data-version-side="before"]')).toBeVisible();
    await history.getByRole('button',{name:'候选页面',exact:true}).click();await expect(history.getByRole('status')).toBeVisible();await expect(history.getByRole('button',{name:'恢复',exact:true})).toHaveCount(0);
    await history.getByRole('button',{name:'原页面',exact:true}).click();await expect(history.locator('[data-version-side="before"]')).toBeVisible();
    const late=page.waitForResponse(r=>r.url().includes('/version?side=after'));release();await late;await expect(history.locator('[data-version-side="after"]')).toHaveCount(0);await expect(history.locator('[data-version-side="before"]')).toBeVisible();
    await history.getByRole('button',{name:'恢复',exact:true}).click();await expect.poll(()=>restores).toEqual([{baseRevision:1,side:'before'}]);expect(errors).toEqual([]);
  }finally{release();}
});
