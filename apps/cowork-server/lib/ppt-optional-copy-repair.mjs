import {operationHistory}from './ppt/command-history.mjs';
import {digest}from './ppt/edit-context.mjs';
const sourceSignature=slide=>digest((slide.sourceArtifactNodes||[]).filter(n=>n.sourceArtifact||n.content?.sourceEvidenceIds?.length).map(n=>({source:n.sourceArtifact,evidence:n.content.sourceEvidenceIds,content:n.content})));
export function userHistoryAffectsSlide(history,slideId){
 return history.some(operation=>{
  const command=operation.command,payload=command?.payload;
  // Unknown or structural/deck operations remain conservatively global.
  if(!command||/^deck\.|^slide\.(?:add|remove|duplicate|reorder)$/u.test(command.type||''))return true;
  if(typeof payload?.slideId==='string')return payload.slideId===slideId;
  return true;
 });
}
/** A critic's unsupported optional addition can be removed without rewriting
 * source copy. A user command on this page, accepted page or source loss leaves a proposal
 * only; source-derived requirements and all deterministic gates stay intact. */
export function optionalCopyRepair(project,review,slideId,inspect,{onReject}={}){
 if(project.generationPolicy?.content!=='full_source'||project.generationPolicy?.language?.mode!=='source'||project.runtime?.slides?.[slideId]?.accepted||typeof inspect!=='function')return null;
 if(project.uid&&project.id&&userHistoryAffectsSlide(operationHistory(project.uid,project.id),slideId))return null;
 const index=project.outline.findIndex(o=>o.id===slideId),before=project.deck?.slides?.find(s=>s.id===slideId)||project.nodes?.[slideId]?.slide;if(index<0||!before||before.nodes?.some(n=>n.locked&&['text','list','table','chart'].includes(n.type)))return null;
 const unsupported=new Set((review.claimAudit?.checks||[]).filter(c=>c.slideId===slideId&&['unsupported','contradicted','redundant'].includes(c.status)).map(c=>c.nodeId));
 // A whole-deck finding may quote a precise visible addition even when the
 // separately returned claim audit disagrees. Bind only literal current copy;
 // generic page findings and quotes also occurring in source stay proposals.
 const optional=(before.sourceArtifactNodes||[]).filter(n=>n.semanticRole==='source-explanation'&&!n.sourceArtifact&&!n.content?.sourceEvidenceIds?.length&&!n.content?.derivedFrom&&!n.locked);
 const text=n=>String(n.content?.richText?.source||n.content?.text||'');
 for(const finding of review.unsupported||[])if(finding.slideIds?.includes(slideId)){
  const quotes=[...String(finding.detail||'').matchAll(/["'“‘『「]([^"'”’』」]{12,})["'”’』」]/gu)].map(m=>m[1]);
  for(const quote of quotes){const matched=optional.filter(n=>text(n).includes(quote));if(matched.length===1&&!(before.sourceArtifactNodes||[]).some(n=>n.sourceArtifact&&text(n).includes(quote)))unsupported.add(matched[0].id);}
 }

 const removable=(before.sourceArtifactNodes||[]).filter(n=>unsupported.has(n.id)&&n.semanticRole==='source-explanation'&&!n.sourceArtifact&&!n.content?.sourceEvidenceIds?.length&&!n.content?.derivedFrom&&!n.locked);
 if(!removable.length)return null;
 const owned=project.outline[index].sourceUnitIds||[],bound=new Set((before.sourceArtifactNodes||[]).map(n=>n.sourceArtifact?.sourceUnitId).filter(Boolean));if(!owned.length||owned.some(id=>!bound.has(id)))return null;
 const candidate=structuredClone(project),slide=structuredClone(before),remove=new Set(removable.map(n=>n.id)),remaining=slide.sourceArtifactNodes.filter(n=>!remove.has(n.id));
 try{
  // Removing optional prose is a content transaction. Keep every source frame,
  // native carrier and clone exactly where it was; layout changes require their
  // own measured transaction instead of borrowing content-repair authority.
  const positions=(slide.sourceArtifactNodes||[]).flatMap((node,index)=>remove.has(node.id)?[]:[index]);
  slide.sourceArtifactNodes=remaining;
  slide.nodes=(slide.nodes||[]).filter(node=>!remove.has(node.id));
  slide.nodeOrder=(slide.nodeOrder||[]).filter(id=>!remove.has(id));
  const anchors=remaining.filter(node=>node.sourceArtifact&&Number.isInteger(node.semanticComponentBinding?.unitIndex));
  const orphaned=new Set(removable.map(node=>node.semanticComponentBinding?.unitIndex).filter(Number.isInteger));
  for(const unitIndex of orphaned){
    if(slide.nodes.some(node=>node.semanticComponentBinding?.unitIndex===unitIndex))continue;
    const members=slide.nodes.filter(node=>node.templateComponentBinding?.unitIndex===unitIndex);
    if(!members.length)continue;
    if(!anchors.length||members.some(node=>!['image','shape'].includes(node.type)||!node.nativeRef||node.sourceArtifact||node.content?.mustPreserve||node.content?.sourceEvidenceIds?.length))return null;
    for(const member of members){
      const anchor=anchors.slice().sort((a,b)=>Math.abs((a.geometry?.y||0)-(member.geometry?.y||0))-Math.abs((b.geometry?.y||0)-(member.geometry?.y||0)))[0];
      member.optionalIllustrationRebind={version:1,fromUnitIndex:unitIndex,toUnitIndex:anchor.semanticComponentBinding.unitIndex,removedNodeIds:[...remove],sourceAnchorNodeId:anchor.id};
      member.templateComponentBinding={...member.templateComponentBinding,unitIndex:anchor.semanticComponentBinding.unitIndex,purpose:'supplementary original illustration for an existing source reading unit after rejected optional prose removal; no new factual point'};
    }
  }
  slide.copy={...slide.copy,blocks:remaining.map(node=>({type:node.content.pointType||'evidence',heading:node.sourceArtifact?.type.replace('Block','')||'',body:node.type==='table'?node.content.rows.map(row=>row.join(' | ')).join('\n'):node.content.text||(node.content.items||[]).map(item=>item.text).join('\n')})),takeaway:'',subtitle:''};
  if(slide.sourceArtifactFit){for(const key of ['boxes','measurements'])if(Array.isArray(slide.sourceArtifactFit[key]))slide.sourceArtifactFit[key]=positions.map(index=>slide.sourceArtifactFit[key][index]).filter(Boolean);}
  candidate.deck.slides[index]=slide;
  candidate.nodes[slideId].slide=slide;
  if(sourceSignature(before)!==sourceSignature(slide)){onReject?.({reason:'source_signature_changed'});return null;}
  const existing=new Set(inspect(project).issues.filter(i=>i.severity==='error').map(i=>i.code+':'+(i.sourceUnitId||i.slideId||'')));
  const introduced=inspect(candidate).issues.filter(i=>i.severity==='error'&&!existing.has(i.code+':'+(i.sourceUnitId||i.slideId||'')));
  if(introduced.length){onReject?.({reason:'new_hard_errors',issues:introduced.map(({code,slideId,nodeIds})=>({code,slideId,nodeIds}))});return null;}
  return {slide,removedNodeIds:[...remove],sourceHash:project.source.sha256,sourceOwnershipHash:sourceSignature(slide),operations:['remove_unsupported_optional_claim_preserving_geometry',...(orphaned.size?['rebind_original_illustration_reference_preserving_pixels_and_geometry']:[])]};
 }catch(error){onReject?.({reason:'candidate_exception',message:String(error.message).slice(0,200)});return null;}
}
