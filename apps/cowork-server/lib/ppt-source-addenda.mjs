/** Reassign only an unambiguous technical tail after a closing section. Source
 * bytes, IDs, chunk/segment citations and the original section path stay intact. */
const closing=/\b(?:closing|conclusions?|final reminders|decision table)\b|结语|結語|总结|總結|结论|結論/iu;
const technical=new Set(['MechanismBlock','ExampleBlock','EquationBlock','CodeBlock']);
export function rehomeClosingAddenda(inventory){
 const items=inventory?.items||[],last=items.at(-1),path=item=>JSON.stringify(item.sectionPath||[]);
 if(!last||!closing.test(last.sectionPath?.at(-1)||''))return inventory;
 const endPath=path(last),candidates=new Map();
 for(const item of items){if(path(item)===endPath)continue;
  const heading=item.sectionPath?.at(-1)||'';
  for(const match of heading.matchAll(/\(([A-Z][A-Z0-9-]{2,15})\)/gu)){
   const paths=candidates.get(match[1])||new Map();paths.set(path(item),item.sectionPath);candidates.set(match[1],paths);
  }
 }
 for(const [subject,paths]of candidates){
  if(paths.size!==1)continue;
  const names=text=>new RegExp('\\b'+subject+'\\b','u').test(String(text||''));
  const start=items.findIndex(item=>path(item)===endPath&&item.type==='MechanismBlock'&&names(item.text)&&/[:：]\s*$/u.test(item.text||''));
  if(start<0)continue;
  const tail=items.slice(start);
  if(!tail.every(item=>path(item)===endPath&&technical.has(item.type)&&
   (names(item.text)||item.type==='EquationBlock'||/^(?:with\b|where\b|其中|式中)/iu.test(String(item.text||'').trim())))||!tail.some(item=>['EquationBlock','CodeBlock'].includes(item.type)))continue;
  const target=[...paths.values()][0];
  for(const item of tail){item.originalSectionPath=[...item.sectionPath];item.sectionPath=[...target];item.presentationRelocation={subject,basis:'unique_heading_subject_with_contiguous_technical_tail',originalSectionPath:item.originalSectionPath,targetSectionPath:[...target]};}
  inventory.presentationRelocations=tail.map(item=>({sourceUnitId:item.id,...item.presentationRelocation}));break;
 }
 return inventory;
}
