import {bindSourceArtifacts} from './ppt-source-artifacts.mjs';
import {bindTemplateFidelity} from './ppt-template-fidelity.mjs';
import {inspectObjectIntegrity} from './ppt-object-integrity.mjs';
import {coverageMap} from './ppt-planning.mjs';
import {bindDeckNavigation} from './ppt-deck-navigation.mjs';
import {enrichAssetRefs}from './ppt/assets.mjs';
/** Re-measure the actual source body against original native illustrations.
 * This is layout recovery; it does not rewrite facts or approve exclusions. */
export function refitSourceMedia(project){
 const next=structuredClone(project),beforeHash=project.source?.sha256,changed=[];
 for(let index=0;index<next.deck.slides.length;index++){
  const slide=next.deck.slides[index];if(!slide.sourceArtifactNodes?.length)continue;
  const plan=next.planning.slidePlan.find(p=>p.slideId===slide.id);
  const commentary=slide.sourceArtifactNodes.filter(n=>!n.sourceArtifact&&n.semanticRole==='source-explanation').map(n=>({type:n.content?.pointType||'mechanism',text:n.content?.rawText||n.content?.richText?.source||n.content?.text}));
  const evidence=[...new Set(slide.sourceArtifactNodes.flatMap(n=>n.content?.sourceEvidenceIds||[]))];
  const prior=JSON.stringify(slide.templateAdaptations||[]);
  bindSourceArtifacts(next,slide,plan?.sourceArtifacts||[],index,commentary,evidence);
  if(JSON.stringify(slide.templateAdaptations||[])!==prior)changed.push(slide.id);
  if(next.nodes[slide.id]?.status==='done')next.nodes[slide.id].slide=structuredClone(slide);
 }
 bindTemplateFidelity(next);
 bindDeckNavigation(next);
 enrichAssetRefs(next);
 next.planning.coverage=coverageMap(next.source,next.outline,next.planning.coverage);
 const integrityErrors=inspectObjectIntegrity(next).issues.filter(i=>i.severity==='error');
 if(next.source?.sha256!==beforeHash||integrityErrors.length)
  throw Object.assign(new Error('Media refit changed or lost a protected source object; original checkpoint retained.'),{statusCode:409,details:integrityErrors});
 next.mediaRefitHistory=[...(project.mediaRefitHistory||[]),{at:new Date().toISOString(),sourceHash:beforeHash,slideIds:changed,basis:'Complete source cells and current explanation retained at native fonts; original image bytes/crops reflowed beside actual rows, no exclusions'}];
 next.renderTree=undefined;
 return next;
}
