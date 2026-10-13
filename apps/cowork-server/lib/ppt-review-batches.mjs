import {claimAuditRegistry} from './ppt-claim-semantics.mjs';
import {obligationRegistry} from './ppt-obligations.mjs';
import {inspectObjectIntegrity} from './ppt-object-integrity.mjs';
import {inputFramework} from './ppt-input-scope.mjs';
/** Internal read-only audit views. Full source authority is retained in every
 * view; only disjoint visible pages and obligation IDs are partitioned. */
export function reviewBatches(project){
 const slides=project.deck?.slides||[];if(slides.length<20)return [];
 const registry=obligationRegistry(project),groups=[];
 for(let start=0;start<slides.length;start+=8)groups.push(slides.slice(start,start+8));
 const assignments=new Map(groups.map((_,index)=>[index,[]])),orphan=[];
 for(const entry of registry.entries){const owners=groups.map((g,i)=>g.some(s=>entry.slideIds.includes(s.id))?i:-1).filter(i=>i>=0);const at=owners.length===1?owners[0]:-1;if(at<0)orphan.push(entry.id);else assignments.get(at).push(entry.id);}
 const fullObjectCoverage=inspectObjectIntegrity(project).ledger.objects;
 const scoped=(part,ids,mode)=>({...project,reviewScope:{obligationIds:ids,mode,fullObjectCoverage,...(mode==='global'?{claimIds:[],claimBasis:'Every visible claim is checked exactly once in its page batch; final composition revalidates the complete unscoped claim registry. Global view still checks cross-page narrative, repetition, conflicts and orphan obligations.'}:{})},deck:{...project.deck,slides:part},planning:{...project.planning,slidePlan:(project.planning?.slidePlan||[]).filter(p=>part.some(s=>s.id===p.slideId))}});
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
