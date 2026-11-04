import {createHash} from 'node:crypto';
import {outlineSummaryRepairPrompt,applyOutlineSummaryRepair} from './ppt-outline-protocol.mjs';
import {compileContentSelection,selectionSource} from './ppt-content-selection.mjs';
import {bindSourceArtifacts} from './ppt-source-artifacts.mjs';
import {bindTemplateFidelity} from './ppt-template-fidelity.mjs';
import {bindDeckNavigation} from './ppt-deck-navigation.mjs';
import {refreshPlanning} from './ppt-planning.mjs';
import {inspectObjectIntegrity} from './ppt-object-integrity.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const visiblePageHash=slide=>{const page=structuredClone(slide);for(const node of page.nodes||[])if(node.content?.derivedFrom==='notes-disclosure')delete node.content.notesHash;return hash(page);};

/** A generated prose summary is a mutable projection, not immutable source.
 * Recover only source-bound summaries diagnosed by the real critic. Native
 * source tables/processes, manual edits and accepted pages are excluded. */
export function summaryRecoveryScope(project){
  const issues=(project.quality?.modelIssues||[]).filter(i=>/unsupported|altered/iu.test(i.code));
  const ids=new Set();
  for(const slide of project.deck?.slides||[]){
    if(slide.locked||project.editing?.epochs?.[slide.id]>0||project.runtime?.slides?.[slide.id]?.accepted)continue;
    for(const node of slide.nodes||[]){
      const id=node.sourceArtifact?.sourceUnitId,entry=project.contentSelection?.entries?.find(e=>e.sourceUnitId===id);
      if(node.locked||node.type!=='text'||entry?.destination!=='summary'||typeof entry.summaryText!=='string')continue;
      const raw=node.content?.rawText||node.content?.richText?.source||node.content?.text;
      if(raw!==entry.summaryText.trim())continue;
      if(issues.some(i=>i.nodeId===node.id||!i.nodeId&&i.slideIds?.includes(slide.id)))ids.add(id);
    }
  }
  const sourceUnitIds=[...ids].slice(0,4);
  if(!sourceUnitIds.length)return null;
  const raw={version:2,slides:structuredClone(project.outline),selection:structuredClone(project.contentSelection.entries)};
  const error={message:'Real critic found unsupported or altered facts in the generated prose summaries. Correct only these summaries from immutable originals.',details:{summaryConflicts:sourceUnitIds.map(sourceUnitId=>({sourceUnitId,destination:'summary'}))}};
  const prompt=outlineSummaryRepairPrompt(project,raw,error);
  if(!prompt)return null;
  return {sourceUnitIds,raw,error,prompt:prompt+'\nKeep destination=summary for every update. The CURRENT summary already fits an unchanged native frame. Make the SMALLEST literal correction: remove/replace only the unsupported category or premise identified by the critic, preserving ALL existing source-supported wording, punctuation and clause order. Do NOT paraphrase, expand phrases, add line breaks or restore the full original paragraph. Return the existing summary with that precise unsupported span corrected. Retain page ownership and original names/numbers/qualifications. This is a local correction, not an outline rewrite.\n<critic_findings>'+JSON.stringify(issues.filter(i=>i.slideIds?.some(id=>project.outline.find(s=>s.id===id)?.sourceUnitIds?.some(unit=>sourceUnitIds.includes(unit)))))+'</critic_findings>'};
}

export function applySummaryRecovery(project,scope,delta){
  if(!scope||delta?.version!==2||!Array.isArray(delta.updates)||!delta.updates.length||delta.updates.some(u=>u?.destination!=='summary'||typeof u.summaryText!=='string'))throw Error('Summary recovery must preserve disposition and page ownership');
  const formatted=structuredClone(delta),formattingAdjustments=[];
  // Prose summaries do not need an explicit hard line after a semicolon.
  // Fold only that redundant break; retain every non-whitespace character,
  // delimiter and clause. Structured source objects never enter this path.
  for(const update of formatted.updates||[]){
    const text=update.summaryText.replace(/([;；])[ \t]*\n[ \t]*/gu,'$1 ');
    if(text!==update.summaryText){formattingAdjustments.push(update.sourceUnitId);update.summaryText=text;}
  }
  const next=structuredClone(project),raw=applyOutlineSummaryRepair(project,scope.raw,scope.error,formatted);
  next.contentSelection=compileContentSelection(next,raw);
  next.source=selectionSource(next,next.contentSelection);
  next.planning=refreshPlanning(next);
  const affected=next.outline.filter(s=>s.sourceUnitIds?.some(id=>scope.sourceUnitIds.includes(id))).map(s=>s.id);
  const protectedPages=project.deck.slides.filter(s=>!affected.includes(s.id)).map(s=>[s.id,visiblePageHash(s)]);
  for(const id of affected){
    const index=next.outline.findIndex(s=>s.id===id),slide=next.deck.slides[index];
    if(slide.locked||slide.nodes?.some(n=>n.locked)||next.runtime?.slides?.[id]?.accepted||next.editing?.epochs?.[id]>0)throw Error('Summary recovery cannot replace a protected page');
    const source=slide.sourceArtifactNodes||[];
    const commentary=source.filter(n=>!n.sourceArtifact&&n.semanticRole==='source-explanation'&&!n.content?.derivedFrom).map(n=>({type:n.content?.pointType||'mechanism',text:n.content?.rawText||n.content?.richText?.source||n.content?.text}));
    const evidence=[...new Set(source.flatMap(n=>n.content?.sourceEvidenceIds||[]))];
    const fonts=source.map(n=>Number(n.style?.fontSizePt)||0);
    next.sourceFontFloors={...next.sourceFontFloors,[id]:Math.max(next.sourceFontFloors?.[id]||0,...fonts)};
    bindSourceArtifacts(next,slide,next.planning.slidePlan.find(p=>p.slideId===id)?.sourceArtifacts||[],index,commentary,evidence);
    if(next.nodes?.[id]?.status==='done')next.nodes[id].slide=structuredClone(slide);
  }
  bindTemplateFidelity(next,{slideIds:affected});bindDeckNavigation(next);
  // Shared binders also normalize deck-wide eyebrows. That is outside this
  // transaction: retain every unaffected page exactly, updating only the
  // non-visible notes-ledger hash on an existing disclosure.
  next.deck.slides=next.deck.slides.map(page=>{
    if(affected.includes(page.id))return page;
    const original=structuredClone(project.deck.slides.find(s=>s.id===page.id));
    for(const node of original.nodes||[])if(node.content?.derivedFrom==='notes-disclosure')node.content.notesHash=next.contentSelection.hash;
    return original;
  });
  const sourceChanged=next.source.sha256!==project.source.sha256||next.source.text!==project.source.text;
  const outlineChanged=JSON.stringify(next.outline)!==JSON.stringify(project.outline);
  const changedProtectedPages=protectedPages.filter(([id,before])=>visiblePageHash(next.deck.slides.find(s=>s.id===id))!==before).map(([id])=>id);
  if(sourceChanged||outlineChanged||changedProtectedPages.length)throw Error('Summary recovery changed protected state: '+JSON.stringify({sourceChanged,outlineChanged,changedProtectedPages}));
  const violations=inspectObjectIntegrity(next).issues.filter(i=>i.severity==='error');
  if(violations.length)throw Object.assign(Error('Summary recovery failed source object integrity'),{details:violations});
  next.summaryRecoveryHistory=[...(project.summaryRecoveryHistory||[]),{at:new Date().toISOString(),sourceHash:project.source.sha256,sourceUnitIds:scope.sourceUnitIds,slideIds:affected,beforeSelectionHash:project.contentSelection.hash,afterSelectionHash:next.contentSelection.hash,formattingAdjustments,basis:'Real model summary delta; semicolon soft breaks only; immutable original and unrelated pages retained; independent review still required'}];
  next.renderTree=undefined;
  return next;
}
