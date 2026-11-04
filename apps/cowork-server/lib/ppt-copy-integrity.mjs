/** Shared copy integrity. Layout load and unique information are different.
 * Exact redundancy is safe to normalize; similar claims are reviewed, never
 * deleted merely for sharing words, numbers, variables or bilingual labels. */
import { visibleNodes } from './ppt-visible-content.mjs';

export const copyKey = value => String(value || '').normalize('NFKC').toLocaleLowerCase()
  .replace(/\s+/gu, ' ').trim();
const length = value => [...String(value || '').replace(/\s/gu, '')].length;
const protectedRole = node => Boolean(node.sourceArtifact || ['table','chart','image'].includes(node.type) ||
  ['page-number','footnote','section'].includes(node.semanticRole) || node.templateSlot?.purpose === 'footnote');
const reusable = entry => Boolean(['recap','application','apply_to_new_case','translation','navigation'].includes(entry.repeatPurpose) || entry.translationOf || entry.recapOf);

export function normalizeVisibleCopy(copy, title = '') {
  const result = structuredClone(copy || {}), changes = [], seen = new Map();
  result.blocks = (result.blocks || []).filter((block, index) => {
    const key = copyKey(block.body), previous = seen.get(key);
    if (key && length(key) >= 12 && previous !== undefined && !reusable(block)) {
      changes.push({code:'duplicate_body',index,previousIndex:previous}); return false;
    }
    if (key) seen.set(key,index);
    return true;
  });
  const titleKey = copyKey(title);
  const headings = new Map();
  for (const block of result.blocks) if (block.heading) headings.set(copyKey(block.heading),(headings.get(copyKey(block.heading)) || 0)+1);
  for (const block of result.blocks) {
    const key = copyKey(block.heading);
    if (key && (key === titleKey || key === copyKey(block.body) || headings.get(key)>1)) {
      changes.push({code:'redundant_heading',text:block.heading}); block.heading='';
    }
  }
  const bodies = result.blocks.map(block => copyKey(block.body));
  for (const role of ['subtitle','takeaway','eyebrow']) {
    const key = copyKey(result[role]);
    if (key && (key === titleKey || bodies.includes(key) ||
      (role==='takeaway' && key===copyKey(result.subtitle)))) {
      changes.push({code:`duplicate_${role}`,text:result[role]}); result[role]='';
    }
  }
  return {copy:result,changes};
}

export function visibleCopyEntries(slide) {
  if (slide.nodes?.length || Array.isArray(slide.nodeOrder)) return visibleNodes(slide).flatMap(node => {
    if (protectedRole(node)) return [];
    const base={nodeId:node.id,role:node.semanticRole||node.type,locked:Boolean(node.locked),
      repeatPurpose:node.repeatPurpose||node.content?.repeatPurpose,claimId:node.claimId||node.content?.claimId};
    if (node.content?.items) return node.content.items.flatMap(item => {
      const body=item.body ?? item.text ?? '', heading=item.heading||item.label||'';
      return [{...base,...item,itemId:item.id,role:'body',text:body},
        ...(heading?[{...base,itemId:item.id,role:'heading',text:heading}]:[])];
    });
    return String(node.content?.text||'').split(/\n+/u).filter(Boolean).map(text=>({...base,text}));
  });
  const copy=slide.copy||{};
  return [{role:'title',text:slide.title},...['eyebrow','subtitle','takeaway'].map(role=>({role,text:copy[role]})),
    ...(copy.blocks?.length?copy.blocks.flatMap(block=>[{...block,role:'body',text:block.body},{role:'heading',text:block.heading}])
      :(slide.bullets||[]).map(text=>({role:'body',text})))].filter(entry=>entry.text);
}

export function inspectVisibleCopy(slides) {
  const issues=[], owners=new Map(), claims=new Map();
  for (const slide of slides) {
    const seen=new Map();
    for (const entry of visibleCopyEntries(slide)) {
      if(entry.claimId && !reusable(entry)) {
        const owner=claims.get(entry.claimId);
        if(owner && owner.slideId!==slide.id && !reusable(slide))issues.push({code:'claim_multiple_primary_owners',severity:'error',slideId:slide.id,slideIds:[owner.slideId,slide.id],claimId:entry.claimId,repairable:true,message:'A primary claim has multiple pages without a declared recap/application; keep a single primary owner and add distinct supported content.'});
        else claims.set(entry.claimId,{slideId:slide.id});
      }
      const key=copyKey(entry.text);
      if (length(key)<12 || ['heading','eyebrow'].includes(entry.role)) continue;
      if (['title','template-title'].includes(entry.role)) {seen.set(key,entry);continue;}
      const first=seen.get(key);
      if (first && !reusable(entry)) issues.push({code:'visible_copy_duplicate',severity:length(key)>=40?'error':'warning',
        slideId:slide.id,nodeIds:[first.nodeId,entry.nodeId].filter(Boolean),repairable:!first.locked&&!entry.locked,
        message:'The same visible statement occurs in multiple content roles; retain it once and add distinct source-supported information.',
        details:{roles:[first.role,entry.role],text:entry.text}});
      else seen.set(key,entry);
      const prior=owners.get(key);
      if (prior && prior.slideId!==slide.id && length(key)>=40 && !reusable(entry) && !reusable(slide))
        issues.push({code:'visible_copy_repeated_across_pages',severity:'error',slideId:slide.id,slideIds:[prior.slideId,slide.id],
          repairable:true,message:'A full statement repeats across pages without a declared recap or new application.',details:{text:entry.text}});
      else if (!prior) owners.set(key,{slideId:slide.id,...entry});
    }
  }
  return issues;
}

/** Normalize generated mapped copy and synchronize its canonical projection.
 * Manual/native/source-owned objects remain reviewable, never silently erased. */
export function normalizeSlideCopy(slide) {
  if (slide.nodes?.some(node=>node.nativeRef || (node.locked && ['body','subtitle','takeaway'].includes(node.semanticRole))) || slide.titleLocked || slide.copyLocked) return [];
  const normalized=normalizeVisibleCopy(slide.copy,slide.title);
  slide.copy=normalized.copy;
  if (slide.copy.blocks?.length) slide.bullets=slide.copy.blocks.map(block=>[block.heading,block.body].filter(Boolean).join('\n'));
  for (const node of slide.nodes||[]) {
    if (node.locked || node.sourceArtifact) continue;
    if (['subtitle','takeaway','eyebrow'].includes(node.semanticRole)) node.content={...node.content,text:slide.copy[node.semanticRole]||''};
    if (node.semanticRole==='body' && node.type==='list' && slide.copy.blocks?.length) {
      const existing=node.content?.items||[];
      node.content={...node.content,items:slide.copy.blocks.map((block,index)=>{
        const previous=existing.find(item=>copyKey(item.body||item.text)===copyKey(block.body))||existing[index]||{};
        return {...previous,...block,text:slide.bullets[index],pointType:block.type};
      })};
    }
  }
  return normalized.changes;
}

export function uniqueCopyText(values) {
  const seen=new Set();
  return values.flatMap(value=>String(value||'').split(/\n+/u)).filter(text=>{
    const key=copyKey(text);if(!key||seen.has(key))return false;seen.add(key);return true;
  }).join('\n');
}
