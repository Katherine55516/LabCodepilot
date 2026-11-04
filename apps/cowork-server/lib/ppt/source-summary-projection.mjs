import {digest} from './edit-context.mjs';
import {sourceDisplayText,sourceRichText} from '../ppt-source-text.mjs';
const textKey=content=>sourceDisplayText(content?.text||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const mathKey=content=>sourceRichText(content?.richText?.source??content?.rawText??content?.text??'').runs.filter(r=>r.kind==='math').map(r=>r.mathKey);
export function summaryProjectionProofs(project,after,slideId,status='pending',audit){
 const slide=after.deck.slides.find(s=>s.id===slideId),before=project.deck.slides.find(s=>s.id===slideId),proofs={};
 if(project.generationPolicy?.content!=='overview')return proofs;
 for(const node of slide?.nodes||[]){
  const prior=before?.nodes.find(n=>n.id===node.id),item=project.source?.semantic?.inventory?.items?.find(i=>i.id===node.sourceArtifact?.sourceUnitId),entry=project.contentSelection?.entries?.find(e=>e.sourceUnitId===item?.id);
  if(!prior||node.type!=='text'||!item?.derivedSummary||item.rows||entry?.destination!=='summary'||textKey(node.content)===textKey(prior.content))continue;
  proofs[node.id]={version:1,authority:'server_scoped_semantic_audit',status,sourceUnitId:item.id,sourceHash:project.source.sha256,sourceRevision:project.sourceRevision||0,unitHash:entry.unitHash,ledgerHash:project.contentSelection.hash,textHash:digest(textKey(node.content)),mathHash:digest(mathKey(node.content)),...(audit?{auditHash:digest(audit)}:{})};
 }
 return proofs;
}
export function validSummaryProjection(project,item,node){
 const proof=node.sourceSummaryProjection;
 return Boolean(item?.derivedSummary&&!item.rows&&node.type==='text'&&node.sourceArtifact?.sourceUnitId===item.id&&proof?.version===1&&proof.authority==='server_scoped_semantic_audit'&&(proof.status==='complete'&&proof.auditHash||proof.status==='pending'&&project.summaryProjectionReview===true)&&proof.sourceUnitId===item.id&&proof.sourceHash===project.source?.sha256&&proof.sourceRevision===(project.sourceRevision||0)&&proof.unitHash===item.derivedSummary.unitHash&&proof.ledgerHash===project.contentSelection?.hash&&proof.textHash===digest(textKey(node.content))&&proof.mathHash===digest(mathKey(node.content)));
}
