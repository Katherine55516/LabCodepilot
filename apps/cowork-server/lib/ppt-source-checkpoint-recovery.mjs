/** Recover a complete measured source-component checkpoint after correcting a
 * foreign evidence obligation. This revalidates existing work, never grants
 * another model attempt or accepts an incomplete/edited/stale draft. */
import { digest } from './ppt/edit-context.mjs';
import { RENDER_CONTRACT_VERSION } from './ppt/render-contract.mjs';
import { bindSourceArtifacts } from './ppt-source-artifacts.mjs';
import { inspectSlideCopy } from './ppt-presentation-writing.mjs';
import { missingRequiredEvidence } from './ppt-evidence.mjs';
import { updateSlidePreview } from './ppt/runtime.mjs';

export function recoverSourceCheckpoint(project, outline, index) {
  const state=project.runtime?.slides?.[outline.id],commit=state?.componentCommit,node=project.nodes?.[outline.id];
  const correction=project.runtime?.sourceEvidenceRevalidation?.find(item=>item.slideId===outline.id&&item.runId===project.currentRunId&&item.sourceHash===project.source?.sha256);
  if(!correction||node?.status!=='failed'||project.generationPolicy?.content!=='full_source'||project.generationPolicy?.knowledge!=='source_only'||outline.planningProtocolVersion!==2||state?.accepted||project.editing?.epochs?.[outline.id]||!commit||!state.canonicalSlide)return null;
  if(commit.runId!==project.currentRunId||commit.sourceHash!==project.source?.sha256||commit.epoch!==0||commit.baseRevision!==project.revision||state.renderContractVersion!==RENDER_CONTRACT_VERSION)return null;
  const contract=project.planning?.slidePlan?.find(item=>item.slideId===outline.id),refs=contract?.sourceArtifacts||[];
  const key=ref=>digest(Object.fromEntries(['sourceUnitId','rowStart','rowEnd','lineStart','lineEnd'].filter(k=>ref[k]!==undefined).map(k=>[k,ref[k]])));
  if((outline.sourceImageIds||[]).length||(outline.sourceUnitIds||[]).some(id=>!refs.some(ref=>ref.sourceUnitId===id))||!refs.length||digest(refs.map(key).sort())!==digest((commit.refs||[]).map(key).sort())||digest(state.canonicalSlide.sourceArtifactNodes)!==commit.componentHash)return null;
  const candidate=structuredClone(project),content=structuredClone(state.canonicalSlide);
  try {
    bindSourceArtifacts(candidate,content,commit.refs,index);
    const issues=[...inspectSlideCopy(content,contract,index,project.outline.length,{templatePreserved:project.templateFidelity?.mode==='preserve'}),...missingRequiredEvidence(candidate,content,contract).map(atom=>({code:'required_evidence_missing',severity:'error',evidenceId:atom.id}))];
    if(issues.some(item=>item.severity==='error'))return null;
    candidate.nodes[outline.id]={...node,status:'done',slide:content};
    updateSlidePreview(candidate,outline.id);
    if(candidate.runtime.slides[outline.id].quality.issues.some(item=>item.severity==='error'))return null;
    return {slide:content,state:candidate.runtime.slides[outline.id],audit:{slideId:outline.id,runId:commit.runId,sourceHash:commit.sourceHash,componentHash:commit.componentHash,previousEvidence:correction.previousEvidence,currentEvidence:correction.currentEvidence,basis:'complete current-run source component checkpoint; exact source rebound and all copy/evidence/physical gates rerun; provider attempts unchanged'}};
  }catch{return null;}
}
