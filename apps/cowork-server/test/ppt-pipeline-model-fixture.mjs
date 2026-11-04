/** Small source-aware protocol double. It never returns business API states.
 * Semantic judgments from this double are explicitly not live-model quality. */
import {scopeReview,cardDeckReply} from '../ppt-scope-test-helpers.mjs';
import {auditDouble} from './ppt-audit-double.mjs';
export const PIPELINE_SOURCE='# Evidence\n\nRecords are reviewed before release.\n\n## Methods\n\n| Method | Limit |\n|---|---|\n| A | 4 |\n| B | 7 |\n\n## Controls\n\nOnly release after validation; keep the limitation visible.\n\n## Conclusion\n\nThe review must verify both method limits before approving the records.';
export function pipelineModelFixture({wrongCountOnce=false}={}){
 let wrongSent=false;
 return async(p,prompt,_activity,_log,meta={})=>{
  const items=p.source?.semantic?.inventory?.items||[],key=meta.nodeKey||'';
  // Card outline (2026-10-23): the deck and finishing calls are answered from the prompt.
  const deck=cardDeckReply(p,prompt,meta);if(deck)return deck;
  if(key.startsWith('input:understand'))return {version:1,subject:'Release evidence',primaryLanguage:'en',groups:[{question:'What permits release?',coreMessage:'Review the method limits and validation condition before release.',relations:['condition','evidence'],sourceUnitIds:items.map(i=>i.id)}],recommended:4,min:3,max:5,reason:'Controlled reader response: the source has measurement evidence, a release condition and a conclusion.'};
  if(key.startsWith('review:'))return scopeReview(p);
  if(key.startsWith('outline:subject-')){const rows=JSON.parse(prompt.match(/<final_outline_subjects>(.*?)<\/final_outline_subjects>/su)[1]);return {version:1,checks:rows.map(r=>({slideId:r.slideId,status:'aligned',reason:'Controlled model audit, not a live semantic assessment.',evidenceSourceUnitIds:r.source.map(s=>s.sourceUnitId)}))};}
  if(key==='outline'){
   const method=items.filter(i=>i.type==='TableBlock'||i.sectionPath?.length===1),controls=items.filter(i=>i.sectionPath?.at(-1)==='Controls'),conclusion=items.filter(i=>i.sectionPath?.at(-1)==='Conclusion');
   const slides=[{title:'Release review',focus:'Measurement evidence and the condition for approving records.',role:'cover',sourceUnitIds:[]},{title:'Method limits',focus:'Compare the complete original method limits before the release decision.',role:'comparison',sourceUnitIds:method.map(i=>i.id)},{title:'Validation condition',focus:'Release is conditional on validation; retain the stated limitation.',role:'mechanism',sourceUnitIds:controls.map(i=>i.id)},{title:'Approval decision',focus:'Verify both method limits before approving the records.',role:'closing',sourceUnitIds:conclusion.map(i=>i.id)}];
   if(wrongCountOnce&&!wrongSent){wrongSent=true;slides.splice(1,0,{title:'Unnecessary context',focus:'Optional context that should be merged.',sourceUnitIds:[]});}
   return {version:2,slides,selection:items.map(i=>({sourceUnitId:i.id,destination:'slides',reason:'Keep the complete source evidence and release conditions.'}))};
  }
  if(key.startsWith('outline:page-budget'))return {version:2,replacements:[{index:1,slides:[]}]};
  const index=p.outline?.findIndex(s=>key==='content:'+s.id);
  if(index>=0){const s=p.outline[index],plan=p.planning.slidePlan.find(x=>x.slideId===s.id),prose=items.filter(i=>s.sourceUnitIds?.includes(i.id)&&!i.must_preserve_structure&&!i.rows);
   // A card page is written from its own points (the card outline's contract).
   const blocks=s.keyPoints?.length?s.keyPoints.map(point=>({type:'mechanism',heading:point.label||'',body:point.text,sourceRefs:point.refs||[]})):prose.map(i=>({type:'mechanism',heading:'',body:i.text,sourceRefs:i.source_ref}));
   return {title:s.title,contentBlocks:blocks,sourceArtifacts:plan?.sourceArtifacts||[],sourceCommentary:[],sourceEvidenceIds:[]};}
  const audit=auditDouble(key,prompt,meta.jsonSchema);if(audit)return audit;
  throw Object.assign(new Error('Unregistered model fixture stage '+key),{code:'schema_invalid'});
 };
}
