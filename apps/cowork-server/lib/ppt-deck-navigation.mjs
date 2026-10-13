import {navigationPlanEntries} from './ppt-navigation-plan.mjs';
import {stableId} from './ppt/ir.mjs';
import {fitComponents} from './ppt-density-capacity.mjs';
import {repairNativePageAssignment,bindTemplateFidelity} from './ppt-template-fidelity.mjs';
import {sourceExplanationComponents,bindSourceArtifacts} from './ppt-source-artifacts.mjs';
import {templateTextColor} from './ppt-template-colors.mjs';
/** Unowned navigation is a compiled system object, not a writer summary. */
export function navigationWriterHeaders(project, outline, index) {
 const english=project.generationPolicy?.language?.locale==='en'||project.generationPolicy?.language?.mode==='source'&&!/[\u3400-\u9fff]/u.test(outline.title||'');
 const slots=project.templateFidelity?.slides?.[index]?.slots||[];
 return Object.fromEntries(slots.filter(slot=>['title','section'].includes(slot.role)).map(slot=>[String(slot.shapeId),slot.role==='title'?outline.title:english?'Agenda':'目录']));
}
const suffix=/\s*[（(](上|下|中|续|續|continued|cont\.?)[）)]\s*$/iu;
/** Derive ranges from final stable slide IDs, never from provisional model
 * page numbers. A navigational object is provenance, not a new factual claim. */
function sourceChapter(item) {
  const path=item?.sectionPath||[];
  return path.find(label=>/^\d+[.)、]\s/u.test(label)) || (path.length>1?path[1]:null);
}
function navigationLabel(section, locale) {
  const pieces=String(section).split(/\s*\|\s*/u);
  if(locale==='source')return pieces.map(piece=>piece.replace(/^\d+[.)、]\s*/u,'').trim()).join(' | ');
  const selected=locale==='en'?pieces.find(p=>!/[\p{Script=Han}]/u.test(p)):pieces.find(p=>/[\p{Script=Han}]/u.test(p));
  return (selected||section).replace(/^\d+[.)、]\s*/u,'').trim();
}
export function finalDeckNavigation(project){
  const groups=new Map(),slides=project.deck?.slides||project.outline||[];
  const inventory=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
  const byId=new Map(inventory.map(item=>[item.id,item]));
  const locale=project.generationPolicy?.language?.mode==='source'?'source':project.generationPolicy?.language?.locale||project.locale||'zh';
  const originalChapters=Boolean(inventory.some(item=>sourceChapter(item)))&&!project.requestedOutline&&!project.outlineSeed?.length;
  slides.forEach((slide,index)=>{
    const outline=project.outline?.find(item=>item.id===slide.id);
    if(index===0||outline?.role==='navigation')return;
    const sections=originalChapters?[...new Set((outline?.sourceUnitIds||[]).map(id=>sourceChapter(byId.get(id))).filter(Boolean))]:[];
    if(!sections.length&&(!originalChapters||!inventory.length))sections.push(outline?.section||slide.section);
    for(const section of sections.filter(Boolean)){
      const list=groups.get(section)||[];list.push({slideId:slide.id,page:index+1});groups.set(section,list);
    }
  });
  return {version:2,revision:project.revision,totalPages:slides.length,basis:originalChapters?'owned-original-source-chapters':'outline-sections',entries:navigationPlanEntries([...groups].map(([section,targets],index)=>({section,displayLabel:navigationLabel(section,locale),sectionNumber:/^(\d+)[.)、]\s/u.exec(section)?.[1]||null,groupIndex:index+1,targets,pageStart:targets[0].page,pageEnd:targets.at(-1).page,
    pageRanges:targets.reduce((ranges,target)=>{const last=ranges.at(-1);if(last&&target.page===last.end+1)last.end=target.page;else ranges.push({start:target.page,end:target.page});return ranges;},[])})),project.navigationPlan)};
}
export function normalizePaginationTitles(project){
  const slides=project.deck?.slides||project.outline||[],groups=new Map();
  for(const slide of slides){if(!suffix.test(slide.title||''))continue;const stem=slide.title.replace(suffix,'').trim();groups.set(stem,[...(groups.get(stem)||[]),slide]);}
  for(const [stem,parts]of groups)for(const [i,slide]of parts.entries()){
    const outline=project.outline?.find(o=>o.id===slide.id);if(project.confirmedOutline?.titlesFrozen!==false&&project.confirmedOutline||outline?.titleLocked||slide.locked||slide.nodes?.some(n=>n.semanticRole==='template-title'&&n.locked))continue;
    const next=parts.length===1?stem:`${stem} (${i+1}/${parts.length})`;
    slide.title=next;if(outline)outline.title=next;
    for(const node of slide.nodes||[])if(['title','template-title'].includes(node.semanticRole))node.content={...node.content,text:next};
    slide.paginationTitle={basis:'final_same_stem_pages',part:i+1,count:parts.length,removedOrphan:parts.length===1};
  }
}
export function bindDeckNavigation(project){
  normalizePaginationTitles(project);const navigation=finalDeckNavigation(project);project.navigation=navigation;
  (project.deck?.slides||[]).forEach((slide,index)=>{
    if(project.outline?.find(o=>o.id===slide.id)?.role==='navigation'){
      const english=project.generationPolicy?.language?.locale==='en'||project.generationPolicy?.language?.mode==='source'&&!navigation.entries.some(e=>/[\u3400-\u9fff]/u.test(e.section));
      const numbered=project.navigationPlan?.audit?.status!=='passed';
      const entries=navigation.entries.map(entry=>`${numbered&&entry.sectionNumber?entry.sectionNumber+'. ':''}${entry.displayLabel}  ·  ${english?'p.':'第'}${entry.pageRanges.map(range=>range.start===range.end?range.start:range.start+'–'+range.end).join(', ')}${english?'':'页'}`);
      // Source-language bilingual chapter headings use facing language columns.
      // Keep every complete label and the same final page ranges; per-entry
      // paragraph gaps must not consume most of a small native contents frame.
      const bilingual=project.generationPolicy?.language?.mode==='source'&&navigation.entries.some(e=>e.section.includes('|')&&/[\u3400-\u9fff]/u.test(e.section));
      const rangeLabel=entry=>entry.pageRanges.map(range=>range.start===range.end?range.start:range.start+'–'+range.end).join(', ');
      const commentary=bilingual?['en','zh'].map(locale=>({type:'support',text:navigation.entries.map(e=>`${numbered&&e.sectionNumber?e.sectionNumber+'. ':''}${navigationLabel(e.section,locale)} · ${locale==='en'?'p.':'第'}${rangeLabel(e)}${locale==='en'?'':'页'}`).join('\n')})):project.navigationPlan?.audit?.status==='passed'&&entries.length>1?[entries.slice(0,Math.ceil(entries.length/2)),entries.slice(Math.ceil(entries.length/2))].filter(p=>p.length).map(part=>({type:'support',text:part.join('\n')})):[{type:'support',text:entries.join('\n')}];
      try{bindSourceArtifacts(project,slide,[],index,commentary);}catch(error){
        if(!/source_artifact_capacity/u.test(error.message))throw error;
        const parts=sourceExplanationComponents(commentary.map(c=>c.text));
        const repair=repairNativePageAssignment(project,index,(p,i)=>fitComponents(parts,p,i),{derivedNavigation:true});
        if(!repair)throw error;
        project.runtime||={};(project.runtime.nativePageRepairs||=[]).push(repair);
        bindSourceArtifacts(project,slide,[],index,commentary);
        bindTemplateFidelity(project,{slideIds:[slide.id]});
      }
      for(const n of slide.sourceArtifactNodes||[]){n.content.derivedFrom='final-deck-navigation';n.content.navigationTargets=navigation.entries.flatMap(e=>e.targets);}
      if(project.nodes?.[slide.id])project.nodes[slide.id].slide=slide;
    }
  });return navigation;
}
