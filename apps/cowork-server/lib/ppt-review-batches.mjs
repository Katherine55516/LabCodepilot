import{reviewSourceStructure}from'./ppt-review-source-structure.mjs';
import {reviewDisplayText,reviewDisplayRows,reviewMathFormatting}from './ppt-review-display.mjs';
import {claimAuditRegistry} from './ppt-claim-semantics.mjs';
import {obligationRegistry} from './ppt-obligations.mjs';
import {inspectObjectIntegrity} from './ppt-object-integrity.mjs';
import {inputFramework} from './ppt-input-scope.mjs';
import {visibleNodes,nodeContentText,visibleSlideTitle}from './ppt-visible-content.mjs';
import {visibleEvidenceQuoteId}from './ppt-obligations.mjs';
/** Internal read-only audit views. Full source authority is retained in every
 * view; only disjoint visible pages and obligation IDs are partitioned. */
export function reviewBatches(project){
 const slides=project.deck?.slides||[],richSource=Buffer.byteLength(project.source?.text||'')>12000;
 // A compact rich-source deck may contain the same obligations as a much
 // longer deck. Partition by source/audit load as well as physical page count.
 if(slides.length<(richSource?12:20))return [];
 const registry=obligationRegistry(project),groups=[];
 const readOnlyClaimRegistry=claimAuditRegistry({...project,reviewScope:undefined});
 const batchSize=richSource?4:8;
 for(let start=0;start<slides.length;start+=batchSize)groups.push(slides.slice(start,start+batchSize));
 const assignments=new Map(groups.map((_,index)=>[index,[]])),orphan=[];
 for(const entry of registry.entries){const owners=groups.map((g,i)=>g.some(s=>entry.slideIds.includes(s.id))?i:-1).filter(i=>i>=0);const at=owners.length===1?owners[0]:-1;if(at<0)orphan.push(entry.id);else assignments.get(at).push(entry.id);}
 const fullObjectCoverage=inspectObjectIntegrity(project).ledger.objects;
 const inventory=project.source?.semantic?.inventory?.items||[];
 const chunksOf=slide=>new Set(inventory.filter(item=>(project.outline?.find(o=>o.id===slide.id)?.sourceUnitIds||[]).includes(item.id)).flatMap(item=>item.chunkRefs||[]));
 const fullSourceInstances=slides.flatMap((slide,index)=>visibleNodes(slide).filter(n=>n.sourceArtifact).map(n=>({slideId:slide.id,page:index+1,nodeId:n.id,quoteId:visibleEvidenceQuoteId(slide.id,n),...n.sourceArtifact,sourceStructure:reviewSourceStructure(n,project),text:reviewDisplayText(n),...(reviewMathFormatting(n.content).length?{mathFormatting:reviewMathFormatting(n.content)}:{}),...(n.type==='table'?{rows:reviewDisplayRows(n.content),displayedDataRowCount:Math.max(0,(n.content.rows?.length||0)-1)}:{})})));
 const scoped=(part,ids,mode)=>{
  const chunkIds=new Set(part.flatMap(s=>[...chunksOf(s)])),partIds=new Set(part.map(s=>s.id));
  const companionInstances=slides.filter(s=>!partIds.has(s.id)&&[...chunksOf(s)].some(id=>chunkIds.has(id))).flatMap(s=>visibleNodes(s).filter(n=>nodeContentText(n)).map(n=>({slideId:s.id,nodeId:n.id,text:reviewDisplayText(n),...(reviewMathFormatting(n.content).length?{mathFormatting:reviewMathFormatting(n.content)}:{}),sourceArtifact:n.sourceArtifact,sourceStructure:reviewSourceStructure(n,project),derivedFrom:n.content?.derivedFrom,basis:'Actual visible same-chunk continuation; generated explanations still receive their own claim audit in their page batch'})));
  // Page batches inspect owned units and actual same-chunk continuations;
  // unrelated page instances are checked in their own batch and the global view.
  const relevantUnits=new Set([...part.flatMap(slide=>visibleNodes(slide).map(n=>n.sourceArtifact?.sourceUnitId).filter(Boolean)),...companionInstances.map(n=>n.sourceArtifact?.sourceUnitId).filter(Boolean)]);
  const coverage=mode==='global'?fullObjectCoverage:fullObjectCoverage.filter(item=>relevantUnits.has(item.objectId));
  const instances=mode==='global'?fullSourceInstances.map(identity=>({sourceUnitId:identity.sourceUnitId,visibleWitnessRef:identity.quoteId})):fullSourceInstances.filter(item=>relevantUnits.has(item.sourceUnitId));
  const outsidePageContext=mode==='pages'?slides.filter(s=>!partIds.has(s.id)).map(s=>({slideId:s.id,title:visibleSlideTitle(s),nodes:visibleNodes(s).filter(n=>nodeContentText(n)).map(n=>({nodeId:n.id,quoteId:visibleEvidenceQuoteId(s.id,n),text:reviewDisplayText(n)}))})):[];
  return {...project,reviewScope:{finalSlideRegistry:slides.map((s,i)=>({slideId:s.id,page:i+1,title:visibleSlideTitle(s)})),outsidePageContext,obligationIds:ids,mode,fullObjectCoverage:coverage,fullSourceInstances:instances,companionInstances,...(mode==='global'?{claimIds:[],claimBasis:'Every visible claim is checked exactly once in its page batch; final composition revalidates the complete unscoped claim registry. Global view still checks cross-page narrative, repetition, conflicts and orphan obligations.'}:{})},deck:{...project.deck,slides:part},planning:{...project.planning,slidePlan:(project.planning?.slidePlan||[]).filter(p=>part.some(s=>s.id===p.slideId))}};
 };
 const batches=groups.map((part,index)=>({index,project:scoped(part,assignments.get(index),'pages')}));
 // Orphan obligations and cross-page narrative/repetition get the complete
 // visible deck. The global view removes duplicate metadata, never text/cells.
 batches.push({index:groups.length,project:scoped(slides,orphan,'global')});return batches;
}
export function composeReviews(project,batches,results,normalize){
 if(batches.length!==results.length||!results.length)throw Error('review batch completeness mismatch');
 const registry=obligationRegistry(project),checks=results.flatMap(r=>r.obligationAudit.checks),ids=project.deck.slides.map(s=>s.id);
 const claimRegistry=claimAuditRegistry(project),claimChecks=new Map();for(const r of results)for(const c of r.claimAudit?.checks||[]){const prior=claimChecks.get(c.claimId);if(!prior||prior.status==='entailed')claimChecks.set(c.claimId,c);}
 const merged={claimAudit:{version:2,registryHash:claimRegistry.registryHash,status:results.every(r=>r.claimAudit?.status==='complete')?'complete':'not_evaluated',checks:[...claimChecks.values()]},evaluation:results.every(r=>r.evaluation==='evaluated')?'evaluated':'not_evaluated',scopeAudit:{frameworkHash:inputFramework(project).frameworkHash,checkedSlideIds:ids,status:results.every(r=>r.scopeAudit.status==='complete')?'complete':'not_evaluated'},obligationAudit:{registryHash:registry.registryHash,status:results.every(r=>r.obligationAudit.status==='complete')?'complete':'not_evaluated',checks}};
 for(const key of ['missing','repeated','conflicts','unsupported']){
  const seen=new Set();merged[key]=results.flatMap(r=>r[key]).filter(f=>{const k=JSON.stringify(f);if(seen.has(k))return false;seen.add(k);return true;});
 }
 return normalize(merged,ids,project);
}
