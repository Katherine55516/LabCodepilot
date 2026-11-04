// Option D POC, offline: rebuild a stored card deck's pages with the hybrid
// card pages (ppt-card-pages.mjs), then run the page copy checks, the
// deterministic publish review and the native PPTX export on the host.
// Usage: COWORK_STATE_DIR=<copy of a state dir> node scripts/ppt/option-d-offline.mjs <uid> <projectId> <outDir>
// (read through ppt-store so stored media are revived; use a copy, never a live service's state)
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.cwd(),[uid,id,out]=process.argv.slice(2);
if(!uid||!id||!out||!process.env.COWORK_STATE_DIR)throw Error('usage: COWORK_STATE_DIR=<state copy> option-d-offline.mjs <uid> <projectId> <outDir>');
const lib=name=>import(path.join(root,'apps/cowork-server/lib',name+'.mjs'));
const [store,{_internals:api},fidelity,cards,cardPages,quality,layout,ir,{localPptRuntime}]=await Promise.all([
 lib('ppt-store'),lib('ppt-api'),lib('ppt-template-fidelity'),lib('ppt-outline-cards'),lib('ppt-card-pages'),lib('ppt/quality-service'),lib('ppt-layout'),lib('ppt/ir'),
 import(path.join(root,'apps/cowork-server/test/ppt-local-runtime.mjs'))]);
const project=structuredClone(store.get(uid,id));
if(!project)throw Error('project not found in COWORK_STATE_DIR');
fs.mkdirSync(out,{recursive:true});
const report={project:project.id,title:project.title,pages:project.outline.length,before:{slideMap:project.templateFidelity.slideMap},pages_:[]};

// 1-2. Template pages by option D score (as the outline confirmation does),
// then every card page without objects written by code; other pages as stored.
// A card page too long for any frame continues on another page (splitCardPage),
// as tryGenerationContinuation does, and the deck is scheduled again.
let slides=[],errors=[],splits=[];
for(let round=0;round<6;round++){
 fidelity.rescheduleTemplateFidelity(project,{scoreSlide:(p,index)=>cardPages.cardPageScore(p,index)??0});
 slides=[];errors=[];report.pages_=[];let split=null;
 for(const [index,outline] of project.outline.entries()){
  const stored=project.deck?.slides?.find(slide=>slide.id===outline.id);
  const isCard=index>0&&outline.keyPoints?.length&&Array.isArray(outline.cardObjects)&&!outline.cardObjects.length;
  if(!isCard){slides.push(stored);continue;}
  const score=cardPages.cardPageScore(project,index),draft=cardPages.cardPageDraft(project,index,outline);
  try{
   const slide=api.normalizeSlide(draft,outline,project,slides.map(s=>s?.title));
   const missing=cards.missingCardPoints(outline,slide),slotIssues=fidelity.inspectTemplateSlotDraft(project,index,slide).filter(issue=>issue.severity==='error');
   report.pages_.push({page:index+1,title:outline.title,mode:slide.cardPage?.mode,shape:slide.cardPage?.shape,templatePage:project.templateFidelity.slideMap[index]+1,score,points:outline.keyPoints.length,missingPoints:missing.length,slotErrors:slotIssues.map(issue=>issue.code+': '+issue.message)});
   slides.push(slide);
  }catch(error){
   if(/card_page_capacity/u.test(error.message)){split=cards.splitCardPage(project,{version:2,slides:project.outline},index);if(split){splits.push({page:index+1,title:outline.title,into:split.change.pageIds.length});break;}}
   errors.push({page:index+1,title:outline.title,error:String(error.message).slice(0,400)});report.pages_.push({page:index+1,title:outline.title,error:String(error.message).slice(0,300)});slides.push(stored);
  }
 }
 if(!split)break;
 project.outline=split.raw.slides;project.pages=project.outline.length;project.pageDecision={...project.pageDecision,finalPageCount:project.pages};
}
report.after={slideMap:project.templateFidelity.slideMap,pages:project.outline.length,splits};
report.buildErrors=errors;

// 3. The content barrier: one deck, template binding, render tree.
project.deck=ir.ensureDeckV3(layout.applyLayoutRegistry({schemaVersion:2,slides}));
fidelity.bindTemplateFidelity(project);
const reviewed=quality.reviewProject(project);
const blocking=reviewed.deterministic.issues.filter(issue=>issue.severity==='error');
report.review={hardErrors:blocking.length,codes:Object.fromEntries([...new Set(blocking.map(issue=>issue.code))].map(code=>[code,blocking.filter(issue=>issue.code===code).length])),
 errors:blocking.slice(0,40).map(issue=>({code:issue.code,slides:issue.slideIds||issue.slideId,message:String(issue.message||issue.detail||'').slice(0,260)}))};

// 4. Native export and rendering on the host.
const runtime=localPptRuntime(out,process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const candidate={...reviewed.project,renderOutput:'/workspace/option-d.pptx'};
try{const exported=await fidelity.renderTemplatePptx(candidate,runtime.io);const proof=exported?.exportVerification||{};report.export={ok:true,verification:{status:proof.status,checks:Object.keys(proof).slice(0,20),pages:proof.pages||proof.pageCount},fontResolution:exported?.fontResolution};}
catch(error){report.export={ok:false,error:String(error.message).slice(-1500)};}
const pptx=runtime.host(candidate,'/workspace/option-d.pptx');
if(fs.existsSync(pptx)){
 const bin=process.env.PPT_TOOL_BIN||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override';
 const pdfDir=path.dirname(pptx);
 // PPT_PREVIEW_FONTCONFIG: a fontconfig file that adds the host's CJK fonts (preview only).
 const office=spawnSync(path.join(bin,'soffice'),['--headless','--convert-to','pdf','--outdir',pdfDir,pptx],{encoding:'utf8',timeout:240000,env:{...process.env,...(process.env.PPT_PREVIEW_FONTCONFIG?{FONTCONFIG_FILE:process.env.PPT_PREVIEW_FONTCONFIG}:{})}});
 const pdf=pptx.replace(/\.pptx$/u,'.pdf');
 report.render={soffice:office.status,pdf:fs.existsSync(pdf)};
 if(fs.existsSync(pdf)){const png=spawnSync(path.join(bin,'pdftoppm'),['-png','-r','60',pdf,path.join(pdfDir,'page')],{encoding:'utf8'});report.render.pngs=png.status===0?fs.readdirSync(pdfDir).filter(name=>name.startsWith('page')).length:png.stderr.slice(-300);}
 report.pptx=pptx;
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({slideMap:report.after.slideMap,splits,pages:report.pages_,buildErrors:errors.length,review:{hardErrors:report.review.hardErrors,codes:report.review.codes},export:report.export,render:report.render},null,1));
if(process.env.PPT_OPTION_D_DUMP){
 const index=Number(process.env.PPT_OPTION_D_DUMP),slide=reviewed.project.deck.slides[index],spec=reviewed.project.templateFidelity.slides[index];
 console.error(JSON.stringify({section:slide.section,slotTexts:slide.templateSlotTexts,slots:spec.slots.filter(s=>['title','section'].includes(s.role)).map(s=>({role:s.role,shapeId:s.shapeId,capacity:s.capacity})),
  titleNodes:slide.nodes.filter(n=>/title/u.test(n.semanticRole||'')||n.content?.derivedFrom==='title-hierarchy').map(n=>({role:n.semanticRole,shapeId:n.nativeRef?.shapeId,text:String(n.content?.text||'').slice(0,60),y:n.geometry?.y,h:n.geometry?.height})),
  omitted:(slide.templateOmissions||[]).map(o=>o.shapeId),
  shapes:spec.nodes.filter(n=>n.geometry&&n.geometry.y<1600000).map(n=>({id:n.nativeRef?.shapeId,type:n.type,role:n.semanticRole,text:String(n.content?.text||'').slice(0,30),x:n.geometry.x,y:n.geometry.y,w:n.geometry.width,h:n.geometry.height}))},null,1));
}
