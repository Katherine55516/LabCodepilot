import {it} from 'node:test';import assert from 'node:assert/strict';
import {retryPptRead,retryPptUpstreamRead} from '../../lib/ppt-read-retry';
import {pptFailureMessage} from '../../lib/ppt-error';
it('an interrupted write asks the user to reload current state without claiming it failed or replaying it',()=>{
 assert.match(pptFailureMessage('fetch failed','zh'),/刷新项目确认当前状态/);assert.match(pptFailureMessage('Failed to fetch','en'),/check its current state/);assert.match(pptFailureMessage('fetch failed','zh-HK'),/重新載入專案/);assert.equal(pptFailureMessage('Exact source mismatch','en'),'Exact source mismatch');
});
it('PPT reads recover temporary proxy/network interruptions without replacing a valid outline',async()=>{
 let calls=0;const delays:number[]=[],outline={status:'outline_ready',id:'existing',pages:18};
 const result=await retryPptRead(async()=>{calls++;if(calls===1)throw Object.assign(new Error('Busy'),{status:503});if(calls===2)throw new TypeError('Failed to fetch');return outline;},{wait:async ms=>{delays.push(ms);}});
 assert.equal(result,outline);assert.equal(calls,3);assert.deepEqual(delays,[500,1000]);
});
it('PPT read retries are bounded and do not retry permanent status/schema failures',async()=>{
 for(const status of [400,401,403,404,409,422]){let calls=0;await assert.rejects(retryPptRead(async()=>{calls++;throw Object.assign(new Error('Permanent'),{status});},{wait:async()=>{}}));assert.equal(calls,1);}
 let calls=0;await assert.rejects(retryPptRead(async()=>{calls++;throw Object.assign(new Error('Still busy'),{status:503});},{retries:2,wait:async()=>{}}),/Still busy/);assert.equal(calls,3);
 calls=0;await assert.rejects(retryPptRead(async()=>{calls++;throw new SyntaxError('Invalid response');},{wait:async()=>{}}));assert.equal(calls,1);
});

it('PPT proxy retries a dropped GET once before a response, without retrying writes or received errors',async()=>{
 const drop=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});let calls=0;const delays:number[]=[];
 const response=new Response('accepted');assert.equal(await retryPptUpstreamRead('GET',async()=>{if(++calls===1)throw drop();return response;},{wait:async ms=>{delays.push(ms);}}),response);assert.equal(calls,2);assert.deepEqual(delays,[500]);
 for(const method of ['POST','PATCH','DELETE']){calls=0;await assert.rejects(retryPptUpstreamRead(method,async()=>{calls++;throw drop();},{wait:async()=>{}}));assert.equal(calls,1);}
 calls=0;const denied=new Response('denied',{status:401});assert.equal(await retryPptUpstreamRead('GET',async()=>{calls++;return denied;}),denied);assert.equal(calls,1);
 calls=0;await assert.rejects(retryPptUpstreamRead('GET',async()=>{calls++;throw drop();},{wait:async()=>{}}));assert.equal(calls,2);
});
it('PPT proxy preserves aborts and permanent configuration errors',async()=>{
 for(const error of [new SyntaxError('bad configuration'),Object.assign(new TypeError('Invalid URL'),{cause:{code:'ERR_INVALID_URL'}})]){let calls=0;await assert.rejects(retryPptUpstreamRead('GET',async()=>{calls++;throw error;},{wait:async()=>{}}));assert.equal(calls,1);}
 const c=new AbortController();c.abort();let calls=0;await assert.rejects(retryPptUpstreamRead('GET',async()=>{calls++;throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});},{signal:c.signal,wait:async()=>{}}));assert.equal(calls,1);
});
it('a title that does not fit is named with its page and limit in the UI language (Fable 2026-10-26)',()=>{
 const refusal='ppt_title_capacity '+JSON.stringify([{page:1,cover:true,han:8,latin:14},{page:4,cover:false,han:12,latin:21}]);
 assert.equal(pptFailureMessage(refusal,'zh'),'请先缩短以下标题再生成：封面标题最多 8 个汉字（英文 14 个字符），完整标题会显示在下方；第 4 页标题最多 12 个汉字（英文 21 个字符）。');
 assert.match(pptFailureMessage(refusal,'zh-HK'),/封面標題最多 8 個漢字/);
 assert.match(pptFailureMessage(refusal,'en'),/the cover title: at most 14 characters \(8 Chinese characters\)/);
});
it('a page-structure edit a template deck cannot take is explained in the UI language (2026-10-27)',()=>{
 assert.match(pptFailureMessage('native templates preserve their original layout and structure','zh'),/成稿后暂不能合并、拆分/);
 assert.match(pptFailureMessage('native templates preserve slide structure','zh-HK'),/在大綱中合併或拆分卡片/);
 assert.match(pptFailureMessage('native templates do not support relayout','en'),/merge or split the cards in the outline/);
});

it('card structure failures name the selected native pages and explain measured refusals',()=>{
 const native='ppt_structure_native_bound '+JSON.stringify([{page:3,title:'Native Results',kind:'native'},{page:4,title:'Chart',kind:'figure'}]);
 assert.match(pptFailureMessage(native,'zh'),/第 3 页.*第 4 页.*原生文字槽位/u);
 assert.match(pptFailureMessage('merged card exceeds the measured template capacity; keep both pages','zh'),/原来两页已保留/u);
 assert.match(pptFailureMessage('the card has edits newer than its outline','en'),/preserve those edits/u);
});
it('manual typography overflow is a rejected style edit rather than a failed generation',()=>{
 assert.match(pptFailureMessage('style_capacity_exceeded','zh'),/此次样式修改未保存/);
 assert.match(pptFailureMessage('style_capacity_exceeded','zh-HK'),/此次樣式修改未保存/);
 assert.match(pptFailureMessage('font size and spacing exceed the available page height','en'),/This style change was not saved/);
});
