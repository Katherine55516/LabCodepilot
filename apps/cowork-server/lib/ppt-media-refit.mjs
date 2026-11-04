import {bindSourceArtifacts} from './ppt-source-artifacts.mjs';
import {bindTemplateFidelity} from './ppt-template-fidelity.mjs';
import {inspectObjectIntegrity} from './ppt-object-integrity.mjs';
import {coverageMap} from './ppt-planning.mjs';
import {bindDeckNavigation} from './ppt-deck-navigation.mjs';
import {enrichAssetRefs}from './ppt/assets.mjs';
/** Re-measure the actual source body against original native illustrations.
 * This is layout recovery; it does not rewrite facts or approve exclusions. */
export function refitSourceMedia(project,{slideIds=null}={}){
 if(slideIds&&(!Array.isArray(slideIds)||!slideIds.length||new Set(slideIds).size!==slideIds.length||slideIds.some(id=>!project.deck?.slides.some(s=>s.id===id))))throw Object.assign(new Error('Unknown or duplicate media retry target'),{statusCode:400});
 const next=structuredClone(project),beforeHash=project.source?.sha256,changed=[];
 for(let index=0;index<next.deck.slides.length;index++){
  const slide=next.deck.slides[index];if(slideIds&&!slideIds.includes(slide.id)||!slide.sourceArtifactNodes?.length)continue;
  const plan=next.planning.slidePlan.find(p=>p.slideId===slide.id);
  const commentary=slide.sourceArtifactNodes.filter(n=>!n.sourceArtifact&&n.semanticRole==='source-explanation'&&!n.content?.derivedFrom).map(n=>({type:n.content?.pointType||'mechanism',text:n.content?.rawText||n.content?.richText?.source||n.content?.text}));
  const evidence=[...new Set(slide.sourceArtifactNodes.flatMap(n=>n.content?.sourceEvidenceIds||[]))];
  const prior=JSON.stringify(slide.templateAdaptations||[]);
  bindSourceArtifacts(next,slide,plan?.sourceArtifacts||[],index,commentary,evidence);
  if(JSON.stringify(slide.templateAdaptations||[])!==prior)changed.push(slide.id);
  if(next.nodes[slide.id]?.status==='done')next.nodes[slide.id].slide=structuredClone(slide);
 }
 bindTemplateFidelity(next);
 bindDeckNavigation(next);
 enrichAssetRefs(next);
 // Global binders may materialize projections. A scoped retry cannot modify
 // an unrelated accepted page, its text or its component checkpoint.
 if(slideIds)for(let index=0;index<next.deck.slides.length;index++){
  const prior=project.deck.slides[index];if(slideIds.includes(prior.id))continue;
  next.deck.slides[index]=structuredClone(prior);
  if(project.nodes?.[prior.id])next.nodes[prior.id]=structuredClone(project.nodes[prior.id]);
 }
 next.planning.coverage=coverageMap(next.source,next.outline,next.planning.coverage);
 const integrityErrors=inspectObjectIntegrity(next).issues.filter(i=>i.severity==='error');
 if(next.source?.sha256!==beforeHash||integrityErrors.length)
  throw Object.assign(new Error('Media refit changed or lost a protected source object; original checkpoint retained.'),{statusCode:409,details:integrityErrors});
 next.mediaRefitHistory=[...(project.mediaRefitHistory||[]),{at:new Date().toISOString(),sourceHash:beforeHash,slideIds:changed,basis:'Complete source cells and current explanation retained at native fonts; original image bytes/crops reflowed beside actual rows, no exclusions'}];
 next.renderTree=undefined;
 return next;
}

/** Synchronous native-media retry. It never calls a writer/image model and
 * rejects stale UI/worker envelopes before touching the checkpoint. */
export function retrySourceMedia(project,envelope){
 const {slideId,runId,sourceHash,epoch,baseRevision}=envelope;
 if(project.deletedAt||!['completed','quality_blocked'].includes(project.status)||runId!==project.currentRunId||sourceHash!==project.source?.sha256||epoch!==Number(project.editing?.epochs?.[slideId]||0)||baseRevision!==project.revision)
  throw Object.assign(new Error('Media retry superseded by a source, run, revision or epoch change'),{statusCode:409});
 if(!(project.planning?.slidePlan?.find(p=>p.slideId===slideId)?.sourceArtifacts||[]).length)throw Object.assign(new Error('No source components assigned to this page'),{statusCode:409});
 const target=project.deck?.slides.find(s=>s.id===slideId);
 if(project.runtime?.slides?.[slideId]?.accepted||(target?.nodes||[]).some(n=>(n.sourceArtifact||n.semanticRole==='source-explanation')&&(n.locked||n.userGeometry||n.textStyleOverrides?.length)))
  throw Object.assign(new Error('Preserve accepted or manually styled source components; unlock or use a scoped layout proposal'),{statusCode:409});
 return refitSourceMedia(project,{slideIds:[slideId]});
}
