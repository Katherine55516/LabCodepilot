// Evidence report, not a pass/fail replacement for the production gates.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out=path.resolve(process.env.PPT_BENCHMARK_OUTPUT||'outputs/ppt-experience-quality-20261014/live');
const target=path.join(out,'benchmark-report');fs.mkdirSync(target,{recursive:true});
const readLines=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}):[];
const events=readLines(out+'/benchmark.jsonl'),finished=events.filter(row=>row.event==='result');
const orphans=events.filter(row=>row.event==='created'&&!finished.some(result=>result.projectId===row.projectId)).map(row=>{const control=events.findLast(event=>event.projectId===row.projectId&&event.event==='interrupted_for_repair');return {...row,event:'result',codeHash:row.codeHash||control?.codeHash,status:'client_interrupted',passed:false,error:control?.reason||'Created attempt has no terminal client result; inspect preserved state, not a pass.',incompleteAttempt:true};});
const all=[...finished,...orphans].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
const selected=process.env.PPT_REPORT_CODE_HASH?all.filter(row=>row.codeHash===process.env.PPT_REPORT_CODE_HASH):all;
const reviews=readLines(out+'/visual-reviews.jsonl');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function localArtifact(name){if(typeof name!=='string'||name!==path.basename(name))return null;return path.join(out,name);}
const records=selected.map((row,index)=>{
 const problems=[],artifacts={};
 for(const [kind,artifact]of Object.entries(row.artifacts||{})){
  const file=localArtifact(artifact.name);
  if(!file||!fs.existsSync(file)){problems.push('missing_'+kind);continue;}
  const bytes=fs.readFileSync(file),sha256=digest(bytes),header=kind==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':bytes.subarray(0,2).toString()==='PK';
  if(!header||sha256!==artifact.sha256||bytes.length!==artifact.bytes)problems.push('artifact_mismatch_'+kind);
  artifacts[kind]={...artifact,actualSha256:sha256,headerValid:header};
 }
 const negative=row.outcome==='expected_source_conflict';
 if(row.passed&&!negative&&(!artifacts.pptx||!artifacts.pdf))problems.push('published_files_incomplete');
 const name=row.projectId&&row.case&&row.qualityLevel?`${row.case}-${row.qualityLevel}-${row.repeat||1}-${row.projectId}.json`:null;
 const snapshot=name&&localArtifact(name);
 let project=null;if(snapshot&&fs.existsSync(snapshot))try{project=JSON.parse(fs.readFileSync(snapshot,'utf8'));}catch{problems.push('unreadable_project_snapshot');}
 if(project&&row.sourceHash&&project.source?.sha256!==row.sourceHash)problems.push('snapshot_source_mismatch');
 const usage=project?.executionHistory?.length?project.executionHistory:project?.modelUsage||[];
 const telemetry=usage.map(item=>item.telemetry||item);
 const total=key=>telemetry.some(item=>Number.isFinite(item[key]))?telemetry.reduce((sum,item)=>sum+(Number.isFinite(item[key])?item[key]:0),0):null;
 const visual=reviews.findLast(review=>review.projectId===row.projectId&&review.pdfSha256===artifacts.pdf?.actualSha256&&review.pptxSha256===artifacts.pptx?.actualSha256);
 return {index,at:row.at,case:row.case,qualityLevel:row.qualityLevel,repeat:row.repeat||1,projectId:row.projectId,codeHash:row.codeHash||'unbound-early-trial',sourceHash:row.sourceHash,template:row.template||null,routingProfile:row.routingProfile||'not_recorded',status:negative?'expected_source_conflict':row.status||'failed',pipelinePassed:row.passed===true,artifactEvidenceValid:Boolean(row.passed&&!problems.length),problems,error:row.error||'',incompleteAttempt:row.incompleteAttempt===true,elapsedMs:row.elapsedMs,firstPageMs:row.firstPageMs,pages:row.pages,models:row.models||[...new Set(usage.map(item=>item.model).filter(Boolean))],reportedInputTokens:row.inputTokens??null,reportedOutputTokens:row.outputTokens??null,verifiedInputTokens:total('inputTokens'),verifiedOutputTokens:total('outputTokens'),usageUnknownRecords:telemetry.length?telemetry.filter(item=>!Number.isFinite(item.inputTokens)||!Number.isFinite(item.outputTokens)||(item.wireAttempts||1)>1).length:null,usageComplete:telemetry.length>0&&telemetry.every(item=>Number.isFinite(item.inputTokens)&&Number.isFinite(item.outputTokens)&&(item.wireAttempts||1)===1),generationPolicyHash:project?.generationPolicy?digest(Buffer.from(JSON.stringify(project.generationPolicy))):null,usageBasis:project?'saved_actual_execution_trace':'no_project_snapshot',costStatus:'unknown',artifacts,visualReview:visual||{physicalLayout:'pending',sourceVisibility:'pending',powerPointDesktopOpen:false}};
});
const groups=records.reduce((result,row)=>{(result[row.codeHash]||=[]).push(row);return result;},{});
const summary=Object.entries(groups).map(([codeHash,rows])=>({codeHash,runs:rows.length,pipelinePassed:rows.filter(row=>row.pipelinePassed).length,filesVerified:rows.filter(row=>row.artifactEvidenceValid&&row.status!=='expected_source_conflict').length,expectedSourceConflicts:rows.filter(row=>row.status==='expected_source_conflict').length,failures:rows.filter(row=>!row.pipelinePassed).length,visualReviewed:rows.filter(row=>row.visualReview.physicalLayout==='passed').length}));
const report={at:new Date().toISOString(),requestedCodeHash:process.env.PPT_REPORT_CODE_HASH||null,totalHistoricalRuns:all.length,selectedRuns:records.length,summary,records,limits:['A successful pipeline/export is not human visual acceptance.','All attempts are retained; this report never chooses only successful repeats.','Different code hashes and source hashes are not pooled into a performance claim.','Provider cost is unknown; missing usage is never reported as zero. Schema fallbacks can leave unmetered attempts even when the final attempt reports usage.','No stable p95 or best-model recommendation is inferred from sparse observations.']};
fs.writeFileSync(target+'/summary.json',JSON.stringify(report,null,2));
const seconds=value=>Number.isFinite(value)?(value/1000).toFixed(1):'未知';
const cell=value=>String(value??'—').replaceAll('|','\\|').replaceAll('\n',' ');
const lines=['# PPT 实际基准证据报告','','仅汇总实际记录。流水线完成、文件完整和人工逐页验收分别记录；失败与旧版本不删除。','','| 代码 hash | 运行数 | 流水线通过 | 文件核验 | 来源矛盾负例 | 失败 | 人工视觉核验 |','|---|---:|---:|---:|---:|---:|---:|',...summary.map(row=>`| ${row.codeHash} | ${row.runs} | ${row.pipelinePassed} | ${row.filesVerified} | ${row.expectedSourceConflicts} | ${row.failures} | ${row.visualReviewed} |`),'','| 样本 / 档位 / 次数 | 代码 | 状态 | 总时长 / 首页(s) | 实际模型 | 输入 / 输出 token | 视觉 | 错误 |','|---|---|---|---|---|---|---|---|',...records.map(row=>`| ${cell(row.case)} / ${cell(row.qualityLevel)} / ${row.repeat} | ${row.codeHash.slice(0,12)} | ${row.pipelinePassed?'通过':'未通过'} · ${cell(row.status)} | ${seconds(row.elapsedMs)} / ${seconds(row.firstPageMs)} | ${cell(row.models.join(', '))} | ${row.verifiedInputTokens??'未知'} / ${row.verifiedOutputTokens??'未知'}${row.usageComplete?'':'（另有未计量请求或记录缺失）'} | ${cell(row.visualReview.physicalLayout)} | ${cell(row.error||row.problems.join(', '))} |`),'','费用未知；缺失 token 保留为未知。早期原记录的零用量与实际轨迹不一致时，保留原值，并在 JSON 中分别列出核对值和依据。不同构建不合并宣传速度，当前样本不支持稳定 p95 或最优模型结论。',''];
fs.writeFileSync(target+'/report.md',lines.join('\n'));console.log(JSON.stringify({report:target+'/report.md',summary}));
