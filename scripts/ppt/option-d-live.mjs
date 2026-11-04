// Option D POC, live: one card deck through a running manual test service
// (template upload, input read, card outline, generation, publication), with
// stage timings and model-call counts. Usage:
// node scripts/ppt/option-d-live.mjs <base> <template.pptx> <input> <outDir> [configId] [existingProjectId]
// <input>: a .md/.txt is pasted; a .pdf, .docx, .xlsx, .html or other file is uploaded.
// Settings form: PPT_LENGTH=quick|standard|full|<pages>, PPT_LANGUAGE=bilingual|en|zh, PPT_TEXT=concise|standard|detailed.
// The service's PPT page must be open (its model worker runs the jobs).
import fs from 'node:fs';import path from 'node:path';
const [base,templatePath,inputPath,out,configId,resumeId]=process.argv.slice(2);
if(!base||!templatePath||!inputPath||!out)throw Error('usage: option-d-live.mjs <base> <template.pptx> <input.md> <outDir> [configId]');
fs.mkdirSync(out,{recursive:true});
const started=Date.now(),marks={},log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const api=async(route,method='GET',body,raw=false,attempt=0)=>{
 let response;
 try{response=await fetch(base+'/api/ppt/'+route,{method,headers:body===undefined?{}:raw?{'content-type':'application/octet-stream'}:{'content-type':'application/json'},body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(300000)});}
 // A dev server recompiling resets a connection now and then; reads are retried.
 catch(error){if(method==='GET'&&attempt<5){await new Promise(r=>setTimeout(r,3000));return api(route,method,body,raw,attempt+1);}throw error;}
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{value={raw:text.slice(0,500)};}
 // The proxy answers 503 "fetch failed" while the backend is busy compiling a large outline; retry.
 if(response.status===503&&/fetch failed/u.test(text)&&attempt<4){await new Promise(r=>setTimeout(r,5000));return api(route,method,body,raw,attempt+1);}
 // A read the proxy timed out (408/504) while the backend measured or rescheduled pages is retried.
 if(method==='GET'&&[408,502,504].includes(response.status)&&attempt<8){await new Promise(r=>setTimeout(r,5000));return api(route,method,body,raw,attempt+1);}
 if(!response.ok)throw Object.assign(Error(`${method} ${route} ${response.status}: ${text.slice(0,600)}`),{status:response.status,value});
 return value;
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const project=async id=>(await api(`projects/${id}?view=live`)).project;
async function until(id,done,label,limitMs=60*60*1000){
 const start=Date.now();let last='';
 for(;;){
  const p=await project(id),state=`${p.status}/${p.stage}/${p.planningContract?.phase||''}`;
  if(state!==last){log(label,state,p.error?String(p.error).slice(0,200):'');last=state;}
  if(done(p))return p;
  if(['failed','cancelled'].includes(p.status))return p;
  if(Date.now()-start>limitMs)throw Error(label+' timed out at '+state);
  await pause(3000);
 }
}

let template,p;
if(resumeId){p=await project(resumeId);template={id:p.template};log('resume',p.id,p.status,p.stage);}
else{
// 1. Template.
const uploaded=await api('templates?fileName='+encodeURIComponent(path.basename(templatePath)),'POST',fs.readFileSync(templatePath),true);
template=uploaded.template||uploaded;log('template',template.id,template.status||'');
for(let n=0;n<120;n++){const list=(await api('templates')).templates||[];const t=list.find(item=>item.id===template.id);if(!t||!t.status||['ready','analyzed','available'].includes(t.status)||t.analysis||t.spec)break;await pause(2000);}
marks.template=Date.now()-started;

// 2. Project and input read.
// A text input is pasted; any other file (PDF, Word, Excel, HTML) is uploaded as a file.
const asText=/\.(?:md|markdown|txt)$/iu.test(inputPath);
const input=asText?{inputKind:'paste',text:fs.readFileSync(inputPath,'utf8')}:{inputKind:'file',fileName:path.basename(inputPath),fileBase64:fs.readFileSync(inputPath).toString('base64')};
const generationPolicy={version:2,detail:'standard',selection:'editorial',archive:'none',language:{mode:'source',body:'both'},content:'overview',sourceTypography:'bounded',knowledge:'source_only',code:{presentation:'omit'}};
const created=(await api('projects','POST',{readOnlyInput:true,...input,generationPolicy,template:template.id,templateContentMode:'design_only',...(configId?{configId}:{}),model:'qwen3.8-max'})).project;
log('project',created.id,created.status);
p=created;
}
if(['ingesting','outlining'].includes(p.status)&&(!p.planningContract||p.planningContract.phase==='reading'))p=await until(p.id,p=>p.status==='input_ready','read');
marks.read=Date.now()-started;
if(p.status==='input_ready'){
// 3. Card outline.
const length=/^\d+$/u.test(process.env.PPT_LENGTH||'')?{exact:Number(process.env.PPT_LENGTH)}:{preset:process.env.PPT_LENGTH||'standard'};
log('settings',JSON.stringify({length,language:process.env.PPT_LANGUAGE||'(default)',presets:p.planningContract?.settings?.presets}));
await api(`projects/${p.id}/planning`,'POST',{command:'outline',template:template.id,contentMode:process.env.PPT_TEXT||'concise',length,...(process.env.PPT_LANGUAGE?{language:process.env.PPT_LANGUAGE}:{})});}
if(!['generating','completed','quality_blocked'].includes(p.status))p=await until(p.id,p=>p.status==='outline_ready'&&p.planningContract?.phase==='page_plan_ready','outline');marks.outline=Date.now()-started;
fs.writeFileSync(path.join(out,'outline.json'),JSON.stringify({summary:p.planningContract?.summary,cards:p.outline.map(s=>({title:s.title,titleSecondary:s.titleSecondary,section:s.section,frame:s.cardFrame,numbered:s.numberedPoints,visual:s.visualIntent?.type,objects:s.cardObjects,points:(s.keyPoints||[]).map(k=>({label:k.label,text:k.text}))}))},null,1));
if(!['outline_ready','generating','completed','quality_blocked'].includes(p.status))throw Error('outline failed: '+p.error);
log('outline pages',p.outline.length);

// 4. Generation and publication.
if(p.status==='outline_ready'){try{await api(`projects/${p.id}/generate`,'POST');}
catch(error){if(error.status!==409)throw error;log('generate needs confirmation:',error.message.slice(0,200));
 // A required source warning (e.g. an inconsistent count in the input) takes
 // the author's choice; this run keeps the original as written, as the UI offers.
 if(error.value?.code==='source_warnings_unresolved'){for(const w of error.value.warnings||[]){await api(`projects/${p.id}/source-warnings`,'POST',{keys:[w.key],reason:'User kept the original count statement unchanged'});log('acknowledged source warning (kept original):',w.code,w.location);marks.acknowledged=(marks.acknowledged||[]).concat(w.code);}}
 else await api(`projects/${p.id}/outline`,'PATCH',{slides:p.outline,finalPageCount:p.outline.length});
 await api(`projects/${p.id}/generate`,'POST');}}
p=await until(p.id,p=>['completed','quality_blocked'].includes(p.status)&&!['publishing','reviewing'].includes(p.runtime?.publication?.phase),'generate');marks.generate=Date.now()-started;
// A card that shows a source count which does not multiply out waits for the
// author; this run keeps the original, as the card's note offers.
if(p.status==='quality_blocked'&&((await api(`projects/${p.id}`)).project?.quality?.deterministic?.issues||[]).some(issue=>issue.code==='source_arithmetic_shown')){
 for(const w of (p.sourceMediaWarnings||[]).filter(w=>w.code==='source_arithmetic_conflict'&&!w.kept&&w.key)){await api(`projects/${p.id}/source-warnings`,'POST',{keys:[w.key],reason:'User kept the original count statement unchanged'});log('kept the original count shown on a card:',w.location);marks.acknowledged=(marks.acknowledged||[]).concat('source_arithmetic_shown');}
}
if(p.status==='quality_blocked'&&!p.publishedRevision){log('publishing');try{await api(`projects/${p.id}/publish`,'POST');}catch(error){log('publish:',error.message.slice(0,300));}p=await until(p.id,p=>!['publishing','reviewing'].includes(p.runtime?.publication?.phase),'publish');}
marks.done=Date.now()-started;
const full=(await api(`projects/${p.id}`)).project||p;
// The full project is 100+ MB; kept only on request (PPT_SAVE_PROJECT=1).
if(process.env.PPT_SAVE_PROJECT==='1')fs.writeFileSync(path.join(out,'project.json'),JSON.stringify(full));
if(full.publishedRevision){const response=await fetch(base+`/api/ppt/projects/${p.id}/export`,{signal:AbortSignal.timeout(300000)});if(response.ok)fs.writeFileSync(path.join(out,'deck.pptx'),Buffer.from(await response.arrayBuffer()));}
// 5. Editor phases (Fable plan T7, replacing ppt-template-first-live.spec.ts):
// one local AI candidate on a card page (request, apply, re-measured), its
// version restore (the deck equals the snapshot), then publication and export
// of the restored deck. PPT_EDITOR=0 skips them.
async function editorPhases(){
 const editor={candidate:false,restore:false,export:false};
 if(!full.publishedRevision)return {...editor,error:'not published'};
 const before=(await api(`projects/${p.id}`)).project;
 const readable=n=>n.type==='text'&&n.semanticRole==='source-explanation'&&String(n.content?.text||'').length>40;
 // A divider lists section titles; a tightening edit has nothing to change there (live fz-r43 p5).
 const slide=before.deck.slides.find(s=>s.cardPage?.mode==='theme'&&s.cardPage?.shape!=='divider'&&!before.runtime?.slides?.[s.id]?.accepted&&(s.nodes||[]).some(readable));
 if(!slide)return {...editor,error:'no unaccepted theme page with a text point'};
 const node=slide.nodes.find(readable),pageErrors=q=>(q.quality?.deterministic?.issues||[]).filter(i=>i.severity==='error'&&i.slideId===slide.id).map(i=>i.code);
 editor.page=before.deck.slides.indexOf(slide)+1;editor.nodeId=node.id;
 try{
  const {proposal}=await api(`projects/${p.id}/ai-edit`,'POST',{baseRevision:before.revision,slideId:slide.id,scope:'object',nodeId:node.id,type:'content',
   instruction:'Tighten the wording of this point; keep every fact, number, formula and condition.'});
  editor.proposal={id:proposal.id,status:proposal.status,quality:proposal.quality};
  await api(`projects/${p.id}/proposals/${proposal.id}/apply`,'POST',{});
  const applied=(await api(`projects/${p.id}`)).project,edited=applied.deck.slides.find(s=>s.id===slide.id)?.nodes.find(n=>n.id===node.id);
  editor.appliedText=String(edited?.content?.text||'').slice(0,300);editor.appliedErrors=pageErrors(applied);
  editor.candidate=applied.revision>before.revision&&edited?.content?.text!==node.content.text&&!editor.appliedErrors.length;
  await api(`projects/${p.id}/proposals/${proposal.id}/restore`,'POST',{side:'before',baseRevision:applied.revision});
  const restored=(await api(`projects/${p.id}`)).project,shape=q=>JSON.stringify(q.deck.slides.map(s=>(s.nodes||[]).map(n=>[n.id,n.type,n.content?.text??null,n.geometry])));
  editor.restore=shape(restored)===shape(before);
  await api(`projects/${p.id}/publish`,'POST');
  const published=await until(p.id,q=>!['publishing','reviewing'].includes(q.runtime?.publication?.phase)&&q.publishedRevision===q.revision,'republish',30*60*1000);
  const pptx=await fetch(base+`/api/ppt/projects/${p.id}/export`,{signal:AbortSignal.timeout(300000)}),pdf=await fetch(base+`/api/ppt/projects/${p.id}/pdf`,{signal:AbortSignal.timeout(600000)});
  if(pptx.ok)fs.writeFileSync(path.join(out,'deck-restored.pptx'),Buffer.from(await pptx.arrayBuffer()));
  if(pdf.ok)fs.writeFileSync(path.join(out,'deck.pdf'),Buffer.from(await pdf.arrayBuffer()));
  editor.export=published.publishedRevision===published.revision&&pptx.ok&&pdf.ok;editor.exportStatus=[pptx.status,pdf.status];
 }catch(error){editor.error=String(error.message).slice(0,600);}
 return editor;
}
const editor=process.env.PPT_EDITOR==='0'?null:await editorPhases();marks.editor=Date.now()-started;
if(editor)log('editor',JSON.stringify(editor).slice(0,600));
const usage=full.modelUsage||[],stage=u=>String(u.stage||'').split(':').slice(0,2).join(':').replace(/^content:.*/u,'content:*');
const calls={};for(const u of usage){const k=stage(u);calls[k]=(calls[k]||0)+1;}
const summary={projectId:p.id,status:full.status,stage:full.stage,published:Boolean(full.publishedRevision),error:String(full.error||'').slice(0,800),pages:full.outline?.length,
 seconds:Object.fromEntries(Object.entries(marks).filter(([,v])=>typeof v==='number').map(([k,v])=>[k,Math.round(v/1000)])),acknowledged:marks.acknowledged||[],outlineSeconds:Math.round(((marks.outline||0)-(marks.read||0))/1000),modelCalls:usage.length,calls,
 frames:{dividers:(full.outline||[]).filter(s=>s.cardFrame==='divider').length,takeaway:(full.outline||[]).some(s=>s.cardFrame==='takeaway'),labels:(full.outline||[]).reduce((n,s)=>n+(s.keyPoints||[]).filter(k=>k.label).length,0)},
 cardPages:(full.deck?.slides||[]).map((s,i)=>({page:i+1,mode:s.cardPage?.mode,shape:s.cardPage?.shape,templatePage:s.cardPage?.templatePage,title:s.title})),
 blocking:(full.quality?.deterministic?.issues||[]).filter(i=>i.severity==='error').map(i=>({code:i.code,message:String(i.message||'').slice(0,200)}))};
if(editor)summary.editor=editor;
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,1));
console.log(JSON.stringify(summary,null,1));
