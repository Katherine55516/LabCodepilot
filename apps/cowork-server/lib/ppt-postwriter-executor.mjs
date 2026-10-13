import {postWriterPlan} from './ppt-postwriter-plan.mjs';
import {digest} from './ppt/edit-context.mjs';
import {buildRenderTree} from './ppt/render-tree.mjs';
import {bindTemplateFidelity} from './ppt-template-fidelity.mjs';
import {refreshPlanning} from './ppt-planning.mjs';
import {isSourceOwnedNode} from './ppt-source-artifacts.mjs';
const ownership=p=>(p.deck?.slides||[]).flatMap(s=>(s.nodes||[]).filter(n=>n.sourceArtifact).map(n=>({source:n.sourceArtifact,content:{text:n.content.richText?.source||n.content.text,rows:n.content.rows,items:n.content.items?.map(i=>i.richText?.source||i.text),mathMl:n.content.mathMl}}))).map(x=>digest(x)).sort();
const hard=review=>new Set((review.issues||[]).filter(i=>i.severity==='error').map(i=>`${i.code}:${i.sourceUnitId||i.objectId||''}`));
/** Copy-on-write transaction. Exact N never changes. Auto may consolidate
 * complete written objects, only after a fresh coherent source-bound rewrite. */
export async function executePostWriterPlan(project,{rewrite,inspect,limit=Math.min(12,Math.max(2,Number(project.pages||0)-Number(project.pageDecision?.initialPageCount||project.pages||0)))}={}){
  let current=project;const executions=[],unusable=new Set();
  if(project.confirmedOutline||project.pageDecision?.mode!=='auto'||typeof rewrite!=='function'||typeof inspect!=='function')return {project,executions,reason:project.confirmedOutline?'user_confirmed_outline':'exact_or_unapproved_contract'};
  for(let attempt=0;attempt<limit;attempt++){
    const plan=postWriterPlan(current),proposal=plan.mergeProposals.find(p=>!unusable.has(p.slideIds.join('|'))&&p.slideIds.every(id=>!current.runtime?.slides?.[id]?.accepted));if(!proposal)break;
    const [left,right]=proposal.slideIds,a=current.deck.slides.findIndex(s=>s.id===left),b=a+1;
    if(current.deck.slides.length<=3)break;
    const targetOrigin=current.templateFidelity?.slideMap?.[b];if(current.templateFidelity?.mode==='preserve'&&current.templateFidelity.slideMap.filter(x=>x===targetOrigin).length===1){unusable.add(proposal.slideIds.join('|'));executions.push({status:'rejected',proposal,reason:'would remove the only original template instance; seek another eligible pair'});continue;}
    const candidate=structuredClone(current),before=digest(current),sourceBefore=ownership(current),baseline=hard(inspect(current));
    try{
      if(candidate.templateFidelity?.mode==='preserve'){
        const fidelity=candidate.templateFidelity,origin=fidelity.slideMap[b];
        if(fidelity.slideMap.filter(x=>x===origin).length===1)throw Error('removal would lose the only instance of an original template slide');
        fidelity.slides.splice(b,1);fidelity.slideMap.splice(b,1);candidate.templateSlideMap=[...fidelity.slideMap];
        fidelity.slides.forEach((s,i)=>{s.index=i;for(const n of s.nodes||[])if(n.nativeRef)n.nativeRef.slideIndex=i;});
      }
      const outline=candidate.outline[a];outline.sourceUnitIds=proposal.sourceUnitIds;
      const rightContract=candidate.outline[b].pageContract;
      if(outline.pageContract||rightContract){
        const leftContract=outline.pageContract||{},right=rightContract||{};
        const distinct=(left=[],right=[])=>[...new Map([...left,...right].map(value=>[JSON.stringify(value),value])).values()];
        outline.pageContract={...leftContract,version:1,requiredUnits:distinct(leftContract.requiredUnits,right.requiredUnits),requiredRelations:distinct(leftContract.requiredRelations,right.requiredRelations),adjacencyPairs:distinct(leftContract.adjacencyPairs,right.adjacencyPairs),comparisonAxes:distinct(leftContract.comparisonAxes,right.comparisonAxes),omissions:distinct(leftContract.omissions,right.omissions)};
      }
      outline.refs=[...new Set([...(outline.refs||[]),...(candidate.outline[b].refs||[])])];
      outline.chunkRefs=[...new Set([...(outline.chunkRefs||[]),...(candidate.outline[b].chunkRefs||[])])];
      outline.sourceArtifacts=[...(outline.sourceArtifacts||[]),...(candidate.outline[b].sourceArtifacts||[])];
      candidate.outline.splice(b,1);candidate.deck.slides.splice(b,1);candidate.pages=candidate.outline.length;
      candidate.pageDecision={...candidate.pageDecision,finalPageCount:candidate.pages,postWriterBasis:'complete actual objects measured at unchanged font'};
      // refreshPlanning is a pure return value. Discarding it made the writer
      // receive only the left page's old frozen selection and omit the right
      // page's complete source objects; the conservation guard then rolled back.
      candidate.planning=refreshPlanning(candidate);
      candidate.deck.slides[a]=await rewrite(candidate,outline,a,proposal);
      candidate.nodes[left]={...candidate.nodes[left],slide:candidate.deck.slides[a],status:'done'};delete candidate.nodes[right];delete candidate.runtime?.slides?.[right];
      candidate.deck.slides.forEach((s,i)=>{if(Number.isInteger(s.nativeSlideIndex))s.nativeSlideIndex=i;for(const n of s.nodes||[])if(n.nativeRef)n.nativeRef.slideIndex=i;});
      if(candidate.templateFidelity?.mode==='preserve')bindTemplateFidelity(candidate);
      if(JSON.stringify(sourceBefore)!==JSON.stringify(ownership(candidate)))throw Error('source object ownership/content changed');
      const introduced=[...hard(inspect(candidate))].filter(k=>!baseline.has(k));if(introduced.length)throw Error('new hard gates: '+introduced.join(', '));
      candidate.renderTree=buildRenderTree(candidate);candidate.revision=Number(current.revision||0)+1;
      executions.push({status:'committed',proposal,beforeHash:before,afterHash:digest(candidate),beforePages:current.pages,afterPages:candidate.pages,sourceOwnershipHash:digest(sourceBefore),revision:candidate.revision});current=candidate;
    }catch(error){executions.push({status:'rolled_back',proposal,beforeHash:before,reason:String(error.message)});break;}
  }
  current.postWriterExecutions=[...(current.postWriterExecutions||[]),...executions];return {project:current,executions};
}
