import {reviewBatches} from '../lib/ppt-review-batches.mjs';
import fs from 'node:fs';import path from 'node:path';
/** Full-input engineering fixture. It selects original complete paragraphs;
 * it is not an evaluation of real-model editorial quality. No network fallback. */
import {pipelineModelFixture} from './ppt-pipeline-model-fixture.mjs';
import {scopeReview} from '../ppt-scope-test-helpers.mjs';
import {claimAuditRegistry} from '../lib/ppt-claim-semantics.mjs';
import {selectionConstraints} from '../lib/ppt-content-selection.mjs';
import {ML_TABLE_PROJECTIONS} from './ppt-ml-table-projections.mjs';
import {ML_PROSE_SUMMARIES} from './ppt-ml-prose-summaries.mjs';
import {ML_EDITORIAL_PAGES,mlReadingObligations,mlProseMedia,mlPresentationSection} from './ppt-ml-editorial-fixture.mjs';
function selectionPlan(p,count){
 const items=p.originalSourceInventory?.items||p.source.semantic.inventory.items,rules=new Map(selectionConstraints(p).map(r=>[r.sourceUnitId,r]));
 let tasks=ML_EDITORIAL_PAGES.map(([title,ids,question])=>({title,question,focus:question+' Explain the sourced mechanism, applicability and tradeoffs.',role:ids.includes('b_0191')?'process':'mechanism',sourceUnitIds:ids.split(' ').map(id=>rules.get(id)?.allowedDestinations.includes('slides')?id:rules.get(id)?.visibleEquivalentSourceUnitIds?.[0]||id)}));
 const closingExtras=[];
 if(count===18){
  const move=(ids,from,to)=>{const origin=tasks.find(t=>t.title===from),target=to&&tasks.find(t=>t.title===to);origin.sourceUnitIds=origin.sourceUnitIds.filter(id=>!ids.includes(id));if(target)target.sourceUnitIds.push(...ids);else closingExtras.push(...ids);};
  move(['b_0250','b_0254'],'Production controls',null);
  move(['b_0237','b_0239'],'Interpret risks','Model families and capacity');
  move(['b_0175'],'Why random folds leak','Small signals and effective samples');
 }
 const selected=new Set([...closingExtras,...tasks.flatMap(t=>t.sourceUnitIds)]);
 for(const [id,rule]of rules){if(!rule.allowedDestinations.includes('excluded'))selected.add(id);if(rule.allowedDestinations.length===1&&rule.allowedDestinations[0]==='excluded'&&!rule.notesWithoutVisibleEquivalentAllowed&&rule.visibleEquivalentSourceUnitIds?.length)selected.add(rule.visibleEquivalentSourceUnitIds[0]);}
 for(let changed=true;changed;){changed=false;for(const relation of items.length&&(p.originalSourceInventory||p.source.semantic.inventory).relationships||[])if(['definition','order','alternative'].includes(relation.type)&&relation.unitIds.some(id=>selected.has(id)))for(const id of relation.unitIds)if(!selected.has(id)&&rules.get(id)?.allowedDestinations.includes('slides')){selected.add(id);changed=true;}}
 const closingSources=[...closingExtras,...(selected.has('b_0258')?['b_0258']:[])];
 // The registered narrative explicitly owns every selected source; it does not
 // call a character packer or silently attach unmatched late paragraphs.
 const assigned=new Set([...tasks.flatMap(t=>t.sourceUnitIds),...closingSources]);for(const id of selected)if(!assigned.has(id))throw Error('ML fixture needs an explicit semantic owner for '+id);
 tasks=tasks.map(t=>({...t,sourceUnitIds:[...new Set(t.sourceUnitIds.filter(id=>selected.has(id)))]}));
 const merge=(left,right,question)=>{const a=tasks.find(t=>t.title===left),at=tasks.findIndex(t=>t.title===right);if(!a||at<0)throw Error('Missing registered task');const b=tasks.splice(at,1)[0];a.sourceUnitIds.push(...b.sourceUnitIds);a.focus=question;a.question=question;a.title=left;};
 if(count===18){
  merge('Weight overlapping observations','Combine sample-weight corrections','How do uniqueness, decay and classification imbalance combine without conflating their purposes?');
  merge('Feature interactions','Encode industries without leakage','Which economically motivated interactions and encodings avoid label leakage?');
  merge('Why random folds leak','Purge and embargo','Why does label overlap leak, and which purge and embargo boundaries prevent it?');
  merge('Model families and capacity','Turn predictions into positions','What separates a controlled-capacity model from a constrained tradable portfolio?');
  merge('Production controls','Drift requires refreshed validation','Which changing conditions require refreshed validation and live production controls?');
  merge('Rolling evaluation and metrics','Interpret risks','How should forward predictions be evaluated and diagnosed before deployment?');
 }else if(count===19){
  merge('Small signals and effective samples','Drift requires refreshed validation','Which independent challenges and all comparisons are being overpacked?');
  merge('Small signals and effective samples','Choose the prediction task','Which independent challenges and all comparisons are being overpacked?');
  merge('Date transforms','Feature interactions','Which transforms and interactions are needed?');
  merge('Weight overlapping observations','Combine sample-weight corrections','How are weighting corrections combined?');
  merge('Model families and capacity','Turn predictions into positions','Which model-to-portfolio controls are needed?');
  // Intentional bad allocation: several full comparisons on the opening page.
  for(const task of tasks.slice(1))for(const id of [...task.sourceUnitIds])if(items.find(i=>i.id===id)?.rows){task.sourceUnitIds=task.sourceUnitIds.filter(v=>v!==id);tasks[0].sourceUnitIds.push(id);}
 }else if(count!==24)throw Error('No simulated editorial answer for this requested budget');
 const selection=items.map(i=>{
  const rule=rules.get(i.id),visible=selected.has(i.id),equivalent=rule?.visibleEquivalentSourceUnitIds?.find(id=>selected.has(id)),graph=visible&&mlProseMedia(i);
  if(graph)return {sourceUnitId:i.id,destination:'summary',reason:'Extractive source nodes and quoted relation evidence; independent semantic review is still required.',summaryGraph:graph};
  const semantic=visible&&rule.allowedDestinations.includes('summary')&&!i.rows&&Boolean(ML_PROSE_SUMMARIES[i.id]);
  if(visible&&i.rows&&ML_TABLE_PROJECTIONS[i.id])return {sourceUnitId:i.id,destination:'summary',reason:'Approve complete original comparison rows and columns with source-faithful cells before generation.',rowIndices:i.rows.slice(1).map((_,r)=>r+1),summaryRows:[i.rows[0],...ML_TABLE_PROJECTIONS[i.id].map((row,r)=>[i.rows[r+1][0],...row])]};
  return {sourceUnitId:i.id,destination:semantic?'summary':visible?'slides':'excluded',reason:visible?'Retain the required mechanism, relations and conditions.':'Outside this confirmed overview; original remains immutable.',...(semantic?{summaryText:count===18&&i.id==='b_0188'?'Embargo $\\tau$ must cover $h$ and the longest lookback (63-day volatility: at least 63 days). Purge and embargo protect distinct directions; both widths $h$ is conservative only when lookbacks $\\le h$.':ML_PROSE_SUMMARIES[i.id]}:{}),...(!visible&&equivalent?{visibleEquivalentSourceUnitId:equivalent}:{})};
 });
 return {version:2,slides:[{title:'Financial ML',focus:'Financial prediction with rigorous validation.',question:'Which financial learning problem does this tutorial address?',role:'cover',sourceUnitIds:[]},...tasks.map(t=>({...t,section:mlPresentationSection(t.sourceUnitIds)})),{title:'Rigorous validation before complexity',focus:'Extract tiny unstable signals without future leakage or noise fitting; validate rigorously before increasing model flexibility.',question:'Which principle should guide the next research decision?',role:'closing',sourceUnitIds:closingSources}],selection};
}

export function mlModelFixture(){const fallback=pipelineModelFixture();return async(p,prompt,a,l,meta={})=>{
 const key=meta.nodeKey||'',items=p.originalSourceInventory?.items||p.source?.semantic?.inventory?.items||[];
 if(key.startsWith('translation:audit:'))return {version:1,checks:JSON.parse(prompt.match(/<pairs>([\s\S]*?)<\/pairs>/u)[1]).map(pair=>({key:pair.key,equivalent:true,targetLanguage:true,reason:'Controlled reviewed primary-language projection; not a production model verdict.'}))};
 if(key.startsWith('translation:')){
  const segments=JSON.parse(prompt.match(/<source>([\s\S]*?)<\/source>/u)[1]);
  return {version:1,translations:segments.map(segment=>{
   if(segment.sourceUnitId==='b_0079'&&segment.column===0&&segment.row>0){const names=['','1 day','5–10 days','21 days (1 month)','63 days (1 quarter)','252 days (1 year)'];return {key:segment.key,text:names[segment.row]};}
   // Registered ML parallel prose only. Remove the paired heading variant,
   // then retain its complete English statement; unknown monolingual text fails.
   let text=segment.text.replace(/\s*\|\s*[^*—]+(?=\*\*)/u,'').replace(/\s*[\u3400-\u9fff][\s\S]*$/u,'').trim();
   if((text.match(/\*\*/gu)||[]).length%2)text=text.replace(/\s*\*\*$/u,'').trim();
   if(!text||!/[A-Za-z]/u.test(text))throw Error('ML fixture needs reviewed English projection for '+segment.key);
   return {key:segment.key,text};
  })};
 }

 if(key.startsWith('planning:language-pairs:'))return {checks:JSON.parse(prompt.match(/<pairs>([\s\S]*?)<\/pairs>/u)[1]).map(pair=>({hash:pair.hash,equivalent:items.find(i=>i.id===pair.sourceUnitId)?.languagePairId&&items.find(i=>i.id===pair.sourceUnitId)?.languagePairId===items.find(i=>i.id===pair.targetUnitId)?.languagePairId||['b_0071:b_0070','b_0077:b_0076','b_0131:b_0130','b_0136:b_0135','b_0138:b_0137','b_0192:b_0191','b_0255:b_0254'].includes(pair.sourceUnitId+':'+pair.targetUnitId),reason:'Controlled verdict for specifically reviewed complete counterparts; the barrier list is NOT equivalent to its adjacent path description. Not a real-model evaluation.'}))};
 if(key.startsWith('outline:table-cell-audit:'))return {checks:JSON.parse(prompt.match(/<cells>([\s\S]*?)<\/cells>/u)[1]).map(cell=>({key:cell.key,equivalent:true,reason:'Controlled response for reviewed ML_TABLE_PROJECTIONS; all selected row/column keys and material source mechanisms retained. Not a real-model assessment.'}))};
 if(key.startsWith('input:understand')){
   const buckets=new Map();for(const item of items){const sectionName=item.sectionPath?.[1]||'Orientation';if(!buckets.has(sectionName))buckets.set(sectionName,[]);buckets.get(sectionName).push(item);}
   return {version:1,explanationObligations:mlReadingObligations(items),subject:'Machine Learning for Quantitative Finance',primaryLanguage:'en',recommended:18,min:18,max:26,reason:'Controlled reader fixture: combine complementary feature/weight/production tasks at the compact budget and expand them at 24 total physical pages. Recommendation remains 18 when user selects 19 or 24.',groups:[...buckets].map(([name,units])=>({question:'本部分如何支持可靠的金融机器学习？ '+name.slice(0,100),coreMessage:'解释'+name.slice(0,180)+'的机制、条件及适用边界。',sourceUnitIds:units.map(i=>i.id),relations:['support'],narrativeRole:'explanation',groupingReason:'Coarse reading ownership; physical page tasks are allocated only after the user confirms N.',supportRoles:units.map(i=>({sourceUnitId:i.id,role:i.type==='WarningBlock'?'condition':'mechanism'}))}))};
 }
 if(key.startsWith('source:graph-audit:'))return {version:1,equivalent:true,missingLabels:[],missingConnections:[],unsupportedConnections:[],reason:'Controlled registered source-quoted graph audit. This engineering fixture is not a real model semantic verdict.'};
 if(key.startsWith('outline:native-titles:')){
  const conflicts=JSON.parse(prompt.match(/<metadata_conflicts>([\s\S]*?)<\/metadata_conflicts>/u)[1]);
  const context=JSON.parse(prompt.match(/<(?:context|source_owned_page_context)>([\s\S]*?)<\/(?:context|source_owned_page_context)>/u)?.[1]||'[]');
  const titles={'Small signals and effective samples':'Small signals','Drift requires refreshed validation':'Drift and validation','Choose the prediction task':'Prediction tasks','Choose regression or classification':'Regression or classes','Weight overlapping observations':'Observation overlap','Combine sample-weight corrections':'Weight corrections','Compare walk-forward with CPCV':'Walk-forward and CPCV','Model families and capacity':'Model capacity','Turn predictions into positions':'Predictions to positions','Rolling evaluation and metrics':'Forward evaluation','Control exposures at the right stage':'Exposure controls','Encode industries without leakage':'Industry encoding','Match horizon to trading costs':'Horizon and costs'};
  return {version:2,updates:conflicts.map(c=>({pageIndex:c.pageIndex,field:c.field,text:titles[c.current||context.find(p=>p.pageIndex===c.pageIndex)?.title]||c.current||context.find(p=>p.pageIndex===c.pageIndex)?.title}))};
 }
 if(key==='outline')return selectionPlan(p,p.pages);
 if(key.startsWith('ai:')){
   const target=prompt.match(/Frozen target: (\{[^\n]+\})\. Only replace/u);
   if(target){const frozen=JSON.parse(target[1]);return {replacement:frozen.expectedText.replace(/\btiny\b/gu,'small')};}
   const objects=JSON.parse(prompt.match(/Objects: (\[[^\n]+\])\nInstruction:/u)?.[1]||'[]');
   if(objects.length===1)return {content:objects[0].content};
   return {patches:objects.map(object=>({nodeId:object.nodeId,content:object.content}))};
 }
 if(key.startsWith('outline:subject-')){const rows=JSON.parse(prompt.match(/<final_outline_subjects>([\s\S]*?)<\/final_outline_subjects>/u)[1]);return {version:1,checks:rows.map(r=>({slideId:r.slideId,status:'aligned',reason:'Controlled local-subject audit of the reviewed fixture; not live model quality.',evidenceSourceUnitIds:[...new Set(r.source.map(s=>s.sourceUnitId))]}))};}
 if(key.startsWith('review:')){const batch=key.match(/:batch:(\d+)/u),view=batch?reviewBatches(p)[Number(batch[1])].project:p;const result=scopeReview(view),registry=claimAuditRegistry(view);result.claimAudit.checks=result.claimAudit.checks.map(check=>{const entry=registry.entries.find(e=>e.id===check.claimId),quote=registry.sourceQuotes.find(q=>entry.permittedEvidenceSourceUnitIds.includes(q.sourceUnitId));if(!quote)throw Error('Missing original claim quote '+check.claimId);return {...check,sourceEvidence:[{sourceUnitId:quote.sourceUnitId,quoteId:quote.quoteId}]};});return result;}
 if(p.outline?.some(s=>key==='content:'+s.id||key.startsWith('content:'+s.id+':'))){if(key.includes(':repair')&&process.env.PPT_ML_DEBUG_DIR){fs.mkdirSync(process.env.PPT_ML_DEBUG_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.PPT_ML_DEBUG_DIR,key.replace(/[^\w-]/gu,'_')+'.txt'),prompt);}const s=p.outline.find(s=>key==='content:'+s.id||key.startsWith('content:'+s.id+':')),plan=p.planning.slidePlan.find(v=>v.slideId===s.id);return {title:s.title,sourceArtifacts:plan.sourceArtifacts,sourceCommentary:[],contentBlocks:[],sourceEvidenceIds:[]};}
 return fallback(p,prompt,a,l,meta);
};}
