/** A display repair is bound to one immutable source range and one node.
 * It can change delimiters/emphasis, never the source or adjacent structures. */
import {equationContent} from './ppt-math.mjs';
import {sourceRichText} from './ppt-rich-text.mjs';
import {richTextContent} from './ppt-source-text.mjs';
import {measureText,applyRenderContract} from './ppt/render-contract.mjs';
import {digest} from './ppt/edit-context.mjs';
export function sourceSpanRepairCandidate(project,patch){
  const fail=reason=>({status:'candidate_only',reason,baseRevision:patch.baseRevision});
  if(patch.baseRevision!==project.revision||patch.sourceHash!==project.source?.sha256)return fail('revision or immutable source changed');
  const slide=project.deck?.slides?.find(s=>s.id===patch.slideId),node=slide?.nodes?.find(n=>n.id===patch.nodeId);
  const item=project.source?.semantic?.inventory?.items?.find(i=>i.id===patch.sourceUnitId);
  if(!node||node.locked||!item||node.sourceArtifact?.sourceUnitId!==item.id||node.type!=='text')return fail('not an editable text instance of the bound source');
  const raw=String(item.text||''),{start,end}=patch;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>raw.length||raw.slice(start,end)!==patch.expectedRaw)return fail('source range mismatch');
  const display=node.content?.richText?.source??raw;
  if(display!==raw)return fail('display already edited; review a rebased candidate');
  const replaced=raw.slice(0,start)+patch.replacement+raw.slice(end),before=sourceRichText(raw),after=sourceRichText(replaced);
  const canonical=rich=>({text:rich.plainText,math:rich.runs.filter(r=>r.kind==='math').map(r=>r.mathMl||r.latex)});
  const delimiterOnly=patch.replacement===`$${patch.expectedRaw}$`||patch.replacement===`\\(${patch.expectedRaw}\\)`;
  const typed=delimiterOnly?equationContent(patch.expectedRaw,{displayMode:false}):null;
  if(after.diagnostics.length||!(delimiterOnly&&typed?.mathMl)&&digest(canonical(before))!==digest(canonical(after)))return fail('display repair changes a fact or mathematical tree');
  const content=richTextContent(replaced),element=applyRenderContract({kind:'text',bounds:node.geometry,style:node.style,content});
  if(measureText(element).overflow)return fail('repaired span exceeds the unchanged frame/font');
  return {status:'validated',baseRevision:patch.baseRevision,sourceHash:patch.sourceHash,sourceUnitId:item.id,rawRange:{start,end},slideId:slide.id,nodeId:node.id,beforeHash:digest(node.content),content};
}
