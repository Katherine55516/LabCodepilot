/** A source definition travels with the formula it explains, including when
 * the point cites the following prose rather than the equation's own ID. */
export function objectPointOwner(project,objects){
 const items=project.source?.semantic?.inventory?.items||[],order=new Map(items.map((item,k)=>[item.id,k]));
 const relations=project.source?.semantic?.inventory?.relationships||[];
 return point=>objects.find(id=>(point.sourceUnitIds||[]).includes(id))
  ||objects.find(id=>relations.some(r=>r.type==='definition'&&r.unitIds?.[0]===id&&r.unitIds.slice(1).some(unit=>(point.sourceUnitIds||[]).includes(unit))))
  ||objects.find(id=>(point.sourceUnitIds||[]).some(unit=>order.has(unit)&&order.has(id)&&order.get(id)>order.get(unit)&&order.get(id)-order.get(unit)<=3&&!/^\s*(?:where|with|其中)/iu.test(items[order.get(unit)]?.text||'')))
  ||[...objects].reverse().find(id=>(point.sourceUnitIds||[]).some(unit=>order.has(unit)&&order.get(unit)>order.get(id)&&order.get(unit)-order.get(id)<=3))
  ||objects[0];
}

/** A shared variable definition belongs to each equation it actually defines.
 * Copy the definition when splitting the family and measure that copy, rather
 * than attaching it only to the first linked equation. */
export function pointBelongsToObjects(project,point,group,allObjects){
 const definitions=(project.source?.semantic?.inventory?.relationships||[]).filter(r=>r.type==='definition'&&r.unitIds.slice(1).some(id=>point.sourceUnitIds?.includes(id)));
 return definitions.length?definitions.some(r=>group.includes(r.unitIds[0])):group.includes(objectPointOwner(project,allObjects)(point));
}
export function formulaDefinitionExcerpt(value){
 const sentences=String(value||'').split(/(?<=[.!?。！？])\s+|(?<=[。！？])/u).map(s=>s.trim()).filter(Boolean);
 return sentences.filter((s,k)=>k===0||/\$|[σ⊙]/u.test(s)&&/\b(?:is|are|denotes?|represents?|parameters?|head|gate|retain)\b|其中|表示|参数|预测头|遗忘门/iu.test(s)).join(' ');
}
const norm=value=>String(value||'').replace(/[\s$\\{}_*]/gu,'').toLocaleLowerCase();
/** Restore literal defining sentences, not whole paragraphs. Long examples
 * remain editorial choices; symbol meanings and conditions cannot disappear. */
export function restoreFormulaDefinitions(project,raw){
 const items=project.source?.semantic?.inventory?.items||[],byId=new Map(items.map(item=>[item.id,item]));
 const relations=project.source?.semantic?.inventory?.relationships||[],notes=[];
 for(const relation of relations.filter(r=>r.type==='definition')){
  const page=raw.slides.find(page=>page.cardObjects?.includes(relation.unitIds[0]));if(!page)continue;
  for(const id of relation.unitIds.slice(1)){
   const item=byId.get(id);if(!item)continue;
   const text=formulaDefinitionExcerpt(item.text);
   if(!text||text.length>4000)continue;
   const output=(page.keyPoints||[]).map(point=>point.text).join('\n');
   if(norm(output).includes(norm(text)))continue;
   // A single-output-language deck does not reintroduce the other language.
   const lang=project.generationPolicy?.language,han=/\p{Script=Han}/u.test(text);
   if(lang?.mode==='output'&&han!==String(lang.locale||'en').startsWith('zh'))continue;
   const definitionIds=new Set(relations.filter(r=>r.type==='definition'&&r.unitIds?.[0]===relation.unitIds[0]).flatMap(r=>r.unitIds.slice(1)));
   const existing=(page.keyPoints||[]).find(point=>point.sourceUnitIds?.includes(id)&&point.sourceUnitIds.every(unit=>definitionIds.has(unit)));
   if(existing){
    // Complete a paraphrased definition in its existing point. Appending it
    // again created an entire thin continuation with the same g/head meaning.
    // Only definition-only points qualify, so unrelated facts cannot vanish.
    const halves=existing.text.split(/\s+\|\s+/u),at=halves.findIndex(half=>/\p{Script=Han}/u.test(half)===han);
    if(at>=0){halves[at]=text;existing.text=halves.join(' | ');notes.push({code:'formula_definition_completed',sourceUnitIds:[relation.unitIds[0],id],message:`${id}: complete the existing definition instead of repeating it.`});continue;}
   }
   (page.keyPoints||=[]).push({text,sourceUnitIds:[relation.unitIds[0],id],refs:item.source_ref||[],chunkRefs:item.chunkRefs||[],definitionFor:relation.unitIds[0]});
   page.sourceUnitIds=[...new Set([...(page.sourceUnitIds||[]),id])];
   notes.push({code:'formula_definition_restored',sourceUnitIds:[relation.unitIds[0],id],message:`${id}: the defining sentence stays with its formula.`});
  }
 }
 return notes;
}

/** A literal architecture name introducing a contiguous equation run can
 * refine a split title. It never invents an acronym or mixes equation runs. */
export function equationFamilyTitle(project,page,ids){
 const items=project.source?.semantic?.inventory?.items||[];let first=items.findIndex(item=>item.id===ids[0]);
 if(first<0||!ids.every(id=>items.find(item=>item.id===id)?.type==='EquationBlock'))return null;
 while(first>0&&items[first-1].type==='EquationBlock')first--;
 const introduction=items.slice(Math.max(0,first-2),first).reverse().map(item=>String(item.text||'')).find(text=>/^\s*[A-Z][A-Z0-9-]{1,12}\b/u.test(text));
 const acronym=introduction?.trim().match(/^[A-Z][A-Z0-9-]{1,12}\b/u)?.[0];
 if(!acronym||!/[A-Z][A-Z0-9-]{1,12}\b/u.test(page.title||''))return null;
 return {acronym,title:String(page.title).replace(/[A-Z][A-Z0-9-]{1,12}\b/u,acronym)};
}
