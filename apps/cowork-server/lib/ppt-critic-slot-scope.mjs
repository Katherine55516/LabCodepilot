/** Only an explicitly diagnosed, generated section label may change during a
 * source-owned rewrite. Main titles, data, user locks and other slots freeze. */
export function diagnosedSectionSlots(draft,findings=[]){
 const text=findings.map(f=>String(f.detail||f.message||'')).join('\n');
 return (draft.nodes||[]).filter(n=>n.templateSlot?.role==='section'&&!n.locked&&!n.userGeometry&&!n.content?.mustPreserve&&!n.sourceArtifact&&n.nativeRef?.shapeId!==undefined&&
  (text.includes(n.id)||String(n.content?.text||'').length>=4&&text.includes(n.content.text)));
}
export function criticSlotTexts(draft,raw,findings){
 const result=structuredClone(draft.templateSlotTexts||{});
 for(const n of diagnosedSectionSlots(draft,findings)){const id=String(n.nativeRef.shapeId),value=raw.slotTexts?.[id];if(typeof value==='string')result[id]=value;}
 return result;
}
