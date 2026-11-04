/* eslint-disable @typescript-eslint/no-explicit-any -- Explicit simulated API states. */
import fs from 'node:fs';
import {test,expect} from '@playwright/test';
import {pptParityFixture} from '../fixtures/ppt-parity';

// Card outline (Gamma style, 2026-10-23): the settings form first (length with
// page counts, text, language, notes, template), one planning command writes
// the whole outline, the summary says what it decided, and an instruction
// rewrites it. There is no topic review step and no outline pause.
const settings={length:{preset:'standard'},presets:{quick:{content:6,dividers:0,takeaway:true,total:8},standard:{content:8,dividers:2,takeaway:true,total:12},full:{content:11,dividers:2,takeaway:true,total:15}},language:'bilingual',languageDefault:'bilingual',bilingualSource:true,notesOther:false,instruction:''};
const structure={sections:10,chars:9000,objects:{tables:1,code:2,equations:3,lists:4},images:0,primaryLanguage:'en',bilingualRatio:0.9,warnings:[{code:'long_section',message:'Section "Data" has 9000 characters; it is written as one topic.'}]};

test('card outline: settings form, one-step outline, summary and a rewrite with an instruction @smoke',async({page},info)=>{
 const f=pptParityFixture(),p:any=f.projects.get('9'.repeat(32)),errors:string[]=[],commands:any[]=[];
 const slides=structuredClone(p.outline).slice(0,3);
 const written=[...slides.map((slide:any,i:number)=>({...slide,cardFrame:undefined,keyPoints:i?[{text:'Data dictionary: source, frequency, lag',label:'Data dictionary',refs:[],chunkRefs:[]},{text:'Turnover rises with decay',refs:[],chunkRefs:[]}]:[]})),
  {...slides[1],id:'divider-1',title:'Combining factors',cardFrame:'divider',keyPoints:[{text:'Neutralisation',refs:[],chunkRefs:[],navigation:true}]},
  {...slides[1],id:'takeaway-1',title:'Takeaway',cardFrame:'takeaway',keyPoints:[{text:'Test every formula out of sample.',refs:[],chunkRefs:[]}]}];
 Object.assign(p,{status:'input_ready',stage:'input',pages:12,outline:[],deck:null,error:'',inputUnderstanding:{recommended:12,min:8,max:15,reason:'10 sections'},source:{text:'Mechanism under C. Practice under D.',segments:[]},
  generationPolicy:{version:2,detail:'concise',selection:'editorial',archive:'none',content:'overview',knowledge:'source_only',language:{mode:'source',body:'both'}},
  planningContract:{version:3,phase:'reading',contentMode:null,logicalCards:[],settings,structure}});
 let polls=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.endsWith('/planning')){
   const data=req.postDataJSON();commands.push(data);
   if(data.command==='outline'){polls=0;Object.assign(p,{status:'outlining',stage:'outline'});p.planningContract={...p.planningContract,phase:'expanding',writing:{pages:5}};}
   return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({project:p})});
  }
  if(url.pathname===`/api/ppt/projects/${p.id}`&&p.status==='outlining'&&++polls>=2){
   const last=commands.at(-1);
   Object.assign(p,{status:'outline_ready',pages:written.length,outline:structuredClone(written),outlineAcceptance:{confirmable:true}});
   p.planningContract={...p.planningContract,phase:'page_plan_ready',writing:undefined,semanticRevision:'r'+commands.length,contentMode:last.contentMode,settings:{...settings,length:last.length,language:last.language,notesOther:last.notesOther},
    summary:{version:1,language:last.language,notesOther:last.notesOther,textMode:last.contentMode,length:'full',pages:written.length,steps:[],objects:[],statements:['Takeaway'],chapters:['Combining factors'],takeaway:true,uncoveredSections:[],labelled:1,warnings:[]}};
  }
  const response=await f.handle(req.method(),url.pathname,req.postData()?req.postDataJSON():{});
  if(!response)return route.continue();
  return route.fulfill({status:response.status,contentType:response.contentType||'application/json',body:typeof response.body==='string'?response.body:JSON.stringify(response.body)});
 });
 await page.goto('/ppt?projectId='+p.id);
 const outline=page.getByTestId('ppt-card-outline');await expect(outline).toBeVisible();
 // Settings first: no cards yet, the source as code read it, presets with their page counts.
 await expect(page.getByTestId('ppt-card-settings')).toBeVisible();await expect(page.getByTestId('ppt-card-list')).toHaveCount(0);
 await expect(page.getByTestId('ppt-card-source')).toContainText('9000');
 const length=page.getByTestId('ppt-card-length');await expect(length).toContainText('15');
 await length.getByRole('radio').nth(2).click();
 await page.getByTestId('ppt-card-language').getByRole('radio').nth(1).click();
 await page.getByTestId('ppt-card-notes-other').check();
 await page.getByTestId('ppt-card-density').getByRole('radio').nth(2).click();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
 const shot=async(name:string)=>fs.writeFileSync(info.outputPath(name),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await shot('card-outline-settings-desktop.png');
 await page.getByTestId('ppt-card-write').click();
 await expect.poll(()=>commands.length).toBe(1);
 expect(commands[0]).toMatchObject({command:'outline',length:{preset:'full'},language:'en',notesOther:true,contentMode:'detailed',instruction:''});
 // The written outline: cards, a chapter divider, the takeaway, point headings and the summary.
 await expect(page.getByTestId('ppt-card-summary')).toBeVisible({timeout:15000});
 await expect(page.getByTestId('ppt-card-list').locator(':scope > li')).toHaveCount(5);
 await expect(page.locator('[data-frame="divider"]')).toHaveCount(1);await expect(page.locator('[data-frame="takeaway"]')).toHaveCount(1);
 await expect(outline).toContainText('Data dictionary');
 const generate=page.getByTestId('ppt-card-actions').getByRole('button').last();await expect(generate).toBeEnabled();
 await shot('card-outline-written-desktop.png');
 // A rewrite takes the author's instruction (D6).
 const rewrite=page.getByTestId('ppt-card-rewrite');await expect(rewrite).toBeDisabled();
 await page.getByTestId('ppt-card-instruction-text').fill('Merge the background sections.');await expect(rewrite).toBeEnabled();await rewrite.click();
 await expect.poll(()=>commands.length).toBe(2);expect(commands[1]).toMatchObject({command:'outline',instruction:'Merge the background sections.',language:'en'});
 await expect(page.getByTestId('ppt-card-summary')).toBeVisible({timeout:15000});await expect(page.getByTestId('ppt-card-instruction-text')).toHaveValue('');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await expect(generate).toBeInViewport();await shot('card-outline-written-mobile.png');
 await cdp.detach();
 expect(errors).toEqual([]);
});
