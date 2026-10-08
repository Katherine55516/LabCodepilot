import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import {Readable} from 'node:stream';
const root=path.resolve('outputs/ppt-copy-media-integrity-20261007');process.env.COWORK_STATE_DIR=path.join(root,'workflow-state');
const [{handlePpt,_internals},store,source,templates,imports,fidelity,render,pdf,capacity,quality,{localPptRuntime}]=await Promise.all([
 import('../../apps/cowork-server/lib/ppt-api.mjs'),import('../../apps/cowork-server/lib/ppt-store.mjs'),import('../../apps/cowork-server/lib/ppt-source.mjs'),import('../../apps/cowork-server/lib/ppt-template.mjs'),import('../../apps/cowork-server/lib/ppt/import-pptx.mjs'),import('../../apps/cowork-server/lib/ppt-template-fidelity.mjs'),import('../../apps/cowork-server/lib/ppt-render.mjs'),import('../../apps/cowork-server/lib/ppt-pdf.mjs'),import('../../apps/cowork-server/lib/ppt-density-capacity.mjs'),import('../../apps/cowork-server/lib/ppt-quality.mjs'),import('../../apps/cowork-server/test/ppt-local-runtime.mjs')]);
const runtime=localPptRuntime(path.join(root,'workspace'));const uid='copy-media-validation',calls=[];
const clean=(await import('../../apps/cowork-server/lib/ppt-source-text.mjs')).sourceDisplayText;
const deps={..._internals.defaultDeps,removeContainer:async()=>{},readFile:runtime.readFile,
 analyzeTemplate:(uid,id,ext,bytes)=>templates.analyzeTemplate(uid,id,ext,bytes,runtime.io),
 importTemplateIR:(p,b,h)=>imports.importEditablePptx(p,b,h,runtime.io),
 prepareTemplateFidelity:(p,b,h,t)=>fidelity.prepareTemplateFidelity(p,b,h,t,{importPptx:(p,b,h)=>imports.importEditablePptx(p,b,h,runtime.io),writeFile:runtime.writeFile}),
 extractFile:(p,n,b)=>source.extractFile(p,n,b,runtime.io),
 renderPptx:p=>render.renderPptx(p,runtime.io),renderTemplatePptx:p=>fidelity.renderTemplatePptx(p,runtime.io),renderPdf:p=>pdf.renderPdf(p,runtime.io)};
const required=item=>item.must_preserve_structure||item.type==='SummaryBlock';
function plan(p){
 const all=p.source.semantic.inventory.items;
 // Source-derived model simulation: selects complete distinct explanations;
 // every mandatory structure retains its full source payload.
 const chosen=new Set(all.filter(item=>required(item)||['DefinitionBlock','ComparisonBlock','WarningBlock'].includes(item.type)).map(item=>item.id));
 for(const chunk of p.source.semantic.chunks){if(!all.some(item=>chosen.has(item.id)&&item.chunkRefs.includes(chunk.id))){const first=all.find(item=>item.chunkRefs.includes(chunk.id));if(first)chosen.add(first.id);}}
 const selected=all.filter(item=>chosen.has(item.id)).flatMap(item=>{
 if(required(item)||clean(item.text).length<=650)return[item];
 const sentences=clean(item.text).split(/(?<=[.!?。！？])\s+|\n+/u).filter(Boolean);const parts=[];let pending='';
 for(const sentence of sentences){if(pending&&(pending.length+sentence.length>650)){parts.push({...item,text:pending});pending='';}pending=[pending,sentence].filter(Boolean).join(' ');}if(pending)parts.push({...item,text:pending});return parts;
 });
 const pages=[],bySection=new Map();
 for(const item of selected){const question=item.sectionPath[1]||item.sectionPath[0]||'Factor framework';if(!bySection.has(question))bySection.set(question,[]);bySection.get(question).push(item);}
 for(const [question,items] of bySection){let group=[];const emit=()=>{if(!group.length)return;const ids=group.map(item=>item.id);const section=question.replace(/^\d+\.\s*/u,'').split('|')[0].trim();const labels=group[0].sectionPath.at(-1).replace(/^\d+(?:\.\d+)*\.?\s*/u,'').split('|').map(s=>s.trim());const short=labels.find(label=>label.length<=18)||labels.find(label=>label.length<=44)||section;const semanticAlias=/q-Factor|Hou-Xue-Zhang/iu.test(short)?'q 因子模型':/Stambaugh-Yuan/iu.test(short)?'SY 错误定价因子':/因子动物园/iu.test(short)?'因子动物园':null;const primaryAlias=semanticAlias || short.match(/\b(CAPM|APT|FF3|FF5|GRS|PCA|HML|HXZ|Carhart|SY)\b/iu)?.[0]||short;const alias=primaryAlias.length<=18?primaryAlias:[...primaryAlias.split(/[：:|（(]/u),...group[0].sectionPath.slice().reverse().flatMap(label=>label.replace(/^\d+(?:\.\d+)*\.?\s*/u,'').split('|').map(s=>s.trim()))].find(label=>label.length>1&&label.length<=12)||'Research findings';
  pages.push({title:alias,section:section.length<=32?section:'Factor research',focus:`Explain ${alias} with distinct source mechanisms, conditions and limitations.`,question,sourceUnitIds:ids,refs:[...new Set(group.flatMap(item=>item.source_ref))],chunkRefs:[...new Set(group.flatMap(item=>item.chunkRefs))],keyPoints:group.filter(item=>!required(item)).map(item=>({text:clean(item.text).length<=650?clean(item.text):clean(item.text).split(/(?<=[.!?。！？])\s+/u)[0],claimId:item.id+'_'+crypto.createHash('sha256').update(item.text).digest('hex').slice(0,8),refs:item.source_ref,chunkRefs:item.chunkRefs})).filter(point=>point.text.length<=700).slice(0,10)});group=[];};
  for(const item of items){const components=[...group,item].map(value=>required(value)?capacity.sourceComponent(value):{type:'text',content:{text:clean(value.text)}});const candidate=capacity.fitComponents(components,p,Math.min(pages.length+1,p.pages-1));
   if(group.length && (!candidate.capacity_ok||group.filter(required).length>=10||group.filter(value=>!required(value)).length>=10))emit();
   const solo=capacity.fitComponents([required(item)?capacity.sourceComponent(item):{type:'text',content:{text:clean(item.text)}}],p,Math.min(pages.length+1,p.pages-1));
   if(!solo.capacity_ok && item.type==='TableBlock'){
    emit();for(let start=1;start<item.rows.length;){let end=start+1;while(end<item.rows.length&&capacity.fitComponents([capacity.sourceComponent(item,{rowStart:start,rowEnd:end+1})],p,Math.min(pages.length+1,p.pages-1)).capacity_ok)end++;
     pages.push({title:question.includes('理论')?'模型对照表':question.includes('分类')?'因子分类表':'Factor comparison',section:'Comparisons',question,focus:'Compare all source cells and controls.',sourceUnitIds:[item.id],sourceArtifactRanges:[{sourceUnitId:item.id,rowStart:start,rowEnd:end}],refs:item.source_ref,chunkRefs:item.chunkRefs,keyPoints:[]});start=end;}
   }else{if(!solo.capacity_ok)throw new Error('Source item does not fit without loss '+item.id+' '+item.type);group.push(item);}
  }emit();
 }
 return {brief:{presentationUse:'course_walkthrough',audience:'Quantitative research team',goal:'Explain factors and their limitations'},slides:[{title:'The Factor Zoo',section:'Factor research',focus:'Theory, taxonomy, validation and implementation.',refs:[],sourceUnitIds:[],keyPoints:[]},...pages]};
}
deps.modelCall=async(p,prompt,_a,_l,options={})=>{
 let result;
 if(prompt.includes('叙事规划器')) {result=plan(p);let adapted=p;for(let round=0;round<3;round++){const a=_internals.assessOutlineCandidate(adapted,result);if(!a.issues.some(i=>i.code==='planned_density_overflow'))break;adapted=a.project;result=plan(adapted);}const assessed=_internals.assessOutlineCandidate(p,result);fs.writeFileSync(path.join(root,'planning-diagnostics.json'),JSON.stringify({issues:assessed.issues,raw:assessed.rawOutline,project:assessed.project},null,2));}
 else if(options.nodeKey?.startsWith('review:')){const issues=quality.deterministicReview(p).issues;result={evaluation:'evaluated',missing:issues.filter(i=>i.code==='required_source_object_missing').map(i=>({slideIds:i.slideIds||[i.slideId].filter(Boolean),sourceUnitId:i.sourceUnitId,detail:i.message})),repeated:issues.filter(i=>/visible_copy/.test(i.code)).map(i=>({slideIds:i.slideIds||[i.slideId].filter(Boolean),detail:i.message})),conflicts:[],unsupported:[],simulationBasis:'source-derived deterministic integrity review; not a live LLM'};}
 else {const index=Number(prompt.match(/第 (\d+) 页/)?.[1])-1;const slide=p.outline[index];if(!slide)throw new Error('Unrecognized writer call '+options.nodeKey);const items=p.source.semantic.inventory.items.filter(item=>slide.sourceUnitIds?.includes(item.id));const paragraphs=(slide.keyPoints||[]).map(point=>point.text);const commentary=[];for(const paragraph of paragraphs){const last=commentary.at(-1);if(last && last.length+paragraph.length+2<=1800)commentary[commentary.length-1]+='\n\n'+paragraph;else commentary.push(paragraph);}if(commentary.length>4)throw new Error('Source commentary requires a split without losing facts');
  const refs=p.planning.slidePlan.find(plan=>plan.slideId===slide.id)?.sourceArtifacts||[];const spec=p.templateFidelity?.slides[index];
  const slotTexts={};const omissions=[];
  for(const slot of spec?.slots||[]){if(slot.role==='title')slotTexts[slot.shapeId]=slide.title;else if(slot.role==='section')slotTexts[slot.shapeId]='Factor research';else if(slot.role==='content')omissions.push({shapeId:slot.shapeId,reason:'This old template content is replaced by complete source-owned structures and distinct research explanations.'});}
  result={title:slide.title,contentBlocks:commentary.slice(0,4).map((body,n)=>({type:'evidence',heading:'',body,claimId:'copy_'+crypto.createHash('sha256').update(body).digest('hex').slice(0,12),sourceRefs:slide.refs})),sourceArtifacts:refs,sourceCommentary:commentary.slice(0,4),...(spec?{slotTexts,omitTemplateShapes:omissions}:{})};
 }
 calls.push({nodeKey:options.nodeKey,prompt,result});return result;
};
async function request(method,route,data){const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;req.headers={};let result;await handlePpt(req,new URL('http://test/ppt/'+route),{uid,deps,activity:()=>{},log:()=>{},res:{},send:(status,body)=>{result={status,body};return true;}});if(result.status>=400)throw new Error(JSON.stringify(result));return result.body;}
async function settled(id,statuses){for(let n=0;n<1800;n++){const p=store.get(uid,id);if(statuses.includes(p.status))return p;if(p.status==='failed')throw new Error(p.error);await new Promise(r=>setTimeout(r,100));}throw new Error('Workflow timed out');}
const templateBytes=fs.readFileSync('/Users/dongli/Downloads/Copy-of-Mood-Board.pptx');const {template}=await request('POST','templates',{fileName:'Mood-Board.pptx',fileBase64:templateBytes.toString('base64')});
const bytes=fs.readFileSync('/Users/dongli/Documents/quant_research/quant_3.0/04_factor_zoo_overview.md');
for(const mode of (process.env.PPT_REPLAY_MODES||'preserve,mapped').split(',')){calls.length=0;
 const {project}=await request('POST','projects',{inputKind:'file',fileName:'factor-zoo.md',fileBase64:bytes.toString('base64'),prompt:'Explain the supplied factor research to researchers; retain formulas, all table cells, workflows and the full end-section checklist and summary.',template:template.id,templateMode:mode,configId:'local-model-simulation',model:'simulated-source-writer',generationPolicy:{version:1,detail:'balanced',language:{mode:'source'},knowledge:'source_only'}});
 const ready=await settled(project.id,['outline_ready']);fs.writeFileSync(path.join(root,`${mode}-outline.json`),JSON.stringify(ready,null,2));console.log(mode,'outline',ready.pages,ready.pageDecision);
 await request('POST',`projects/${project.id}/generate`);const finished=await settled(project.id,['completed','quality_blocked']);fs.writeFileSync(path.join(root,`${mode}-workflow.json`),JSON.stringify(finished,null,2));fs.writeFileSync(path.join(root,`${mode}-model-calls.json`),JSON.stringify(calls,null,2));
 if(finished.status!=='completed')throw new Error(JSON.stringify({status:finished.status,error:finished.error,hard:finished.quality.deterministic.issues.filter(i=>i.severity==='error')},null,2));
 const actual=runtime.host(finished,finished.publishedArtifactPath||'/workspace/presentation.pptx');fs.copyFileSync(actual,path.join(root,`factor-zoo-${mode}.pptx`));const pdfResult=await deps.renderPdf(finished);fs.copyFileSync(runtime.host(finished,finished.pdfArtifactPath||'/workspace/presentation.pdf'),path.join(root,`factor-zoo-${mode}.pdf`));console.log(mode,'COMPLETE',finished.pages,finished.quality.exportVerification,finished.quality.objectLedger);
}
