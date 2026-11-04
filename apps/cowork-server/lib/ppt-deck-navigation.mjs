import {navigationPlanEntries} from './ppt-navigation-plan.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {stableId} from './ppt/ir.mjs';
import {fitComponents,measureComponent} from './ppt-density-capacity.mjs';
import {richTextContent} from './ppt-source-text.mjs';
import {repairNativePageAssignment,bindTemplateFidelity} from './ppt-template-fidelity.mjs';
import {sourceExplanationComponents,bindSourceArtifacts} from './ppt-source-artifacts.mjs';
import {templateTextColor} from './ppt-template-colors.mjs';
import {visibleNodes} from './ppt-visible-content.mjs';
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
  const editorialNavigation=project.generationPolicy?.version===2&&project.planning?.editorialBlueprint&&project.outline?.every(s=>s.section?.trim());
  const originalChapters=!editorialNavigation&&Boolean(inventory.some(item=>sourceChapter(item)))&&!project.requestedOutline&&!project.outlineSeed?.length;
  slides.forEach((slide,index)=>{
    const outline=project.outline?.find(item=>item.id===slide.id);
    if(index===0||outline?.role==='navigation')return;
    const sections=originalChapters?[...new Set((outline?.sourceUnitIds||[]).map(id=>sourceChapter(byId.get(id))).filter(Boolean))]:[];
    // Unnumbered introductions remain navigable when later source chapters
    // have ordinals. Only source-owned pages get this fallback; a closing
    // slide is not a new source chapter.
    if(!sections.length&&(!originalChapters||!inventory.length||(outline?.sourceUnitIds||[]).some(id=>byId.has(id))))sections.push(outline?.section||slide.section||(outline?.sourceUnitIds||[]).map(id=>byId.get(id)?.sectionPath?.[0]).find(Boolean));
    for(const section of sections.filter(Boolean)){
      const list=groups.get(section)||[];list.push({slideId:slide.id,page:index+1});groups.set(section,list);
    }
  });
  return {version:2,revision:project.revision,totalPages:slides.length,basis:originalChapters?'owned-original-source-chapters':'outline-sections',entries:navigationPlanEntries([...groups].map(([section,targets],index)=>({section,displayLabel:navigationLabel(section,locale),sectionNumber:/^(\d+)[.)、]\s/u.exec(section)?.[1]||null,groupIndex:index+1,targets,pageStart:targets[0].page,pageEnd:targets.at(-1).page,
    pageRanges:targets.reduce((ranges,target)=>{const last=ranges.at(-1);if(last&&target.page===last.end+1)last.end=target.page;else ranges.push({start:target.page,end:target.page});return ranges;},[])})),project.navigationPlan)};
}
/** A multi-chapter page is one physical target even when several groups cite it. */
export const finalNavigationTargets = navigation => [...new Map(navigation.entries.flatMap(entry=>entry.targets).map(target=>[target.slideId,target])).values()];
export function normalizePaginationTitles(project){
  // A card deck's "(cont.)" is set by code on a card's later pages, and its
  // titles stay unfrozen through generation: this legacy pass read a single
  // continuation page as an orphan and removed the marker (live fz/mlq-r42).
  if(cardsFlow(project))return;
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
export function navigationCommentary(project,navigation=finalDeckNavigation(project)){
  const english=project.generationPolicy?.language?.locale==='en'||project.generationPolicy?.language?.mode==='source'&&!navigation.entries.some(e=>/[\u3400-\u9fff]/u.test(e.section));
  const numbered=project.navigationPlan?.audit?.status!=='passed';
  const entries=navigation.entries.map(entry=>`${numbered&&entry.sectionNumber?entry.sectionNumber+'. ':''}${entry.displayLabel}  ·  ${english?'p.':'第'}${entry.pageRanges.map(range=>range.start===range.end?range.start:range.start+'–'+range.end).join(', ')}${english?'':'页'}`);
  // Source-language bilingual chapter headings use facing language columns.
  // Keep every complete label and the same final page ranges; per-entry
  // paragraph gaps must not consume most of a small native contents frame.
  const bilingual=project.generationPolicy?.language?.mode==='source'&&navigation.entries.some(e=>e.section.includes('|')&&/[\u3400-\u9fff]/u.test(e.section));
  const rangeLabel=entry=>entry.pageRanges.map(range=>range.start===range.end?range.start:range.start+'–'+range.end).join(', ');
  return bilingual?['en','zh'].map(locale=>({type:'support',text:navigation.entries.map(e=>`${numbered&&e.sectionNumber?e.sectionNumber+'. ':''}${navigationLabel(e.section,locale)} · ${locale==='en'?'p.':'第'}${rangeLabel(e)}${locale==='en'?'':'页'}`).join('\n')})):project.navigationPlan?.audit?.status==='passed'&&entries.length>1?[entries.slice(0,Math.ceil(entries.length/2)),entries.slice(Math.ceil(entries.length/2))].filter(p=>p.length).map(part=>({type:'support',text:part.join('\n')})):[{type:'support',text:entries.join('\n')}];
}
/** Place a short derived field handoff in measured free space. Adding this
 * system label must not reflow a complete table or the page's explanation.
 * If no free rectangle fits at the existing font, normal composition remains
 * the fallback; no source text, font, media or page count is changed here. */
export function appendSourceExampleNavigation(slide,reference,{pageSize}={}) {
  const fit=slide.sourceArtifactFit,canvas=fit?.canvas,font=fit?.fontSizePt;
  if(!canvas||!Number.isFinite(font)||font<=0)return false;
  const prior=slide.sourceArtifactNodes||[],body=prior.filter(n=>n.content?.derivedFrom!=='source-example-navigation');
  const occupied=[...body,...(slide.nodes||[]).filter(n=>(['image','chart','table'].includes(n.type)||n.type==='shape'&&fit.keptMediaShapeIds?.includes(n.nativeRef?.shapeId))&&n.geometry
    &&!(n.geometry.width>=canvas.width*.85&&n.geometry.height>=canvas.height*.85))];
  const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  const gap=Math.round(914400*(fit.layoutGapInches||.16));
  const append=(box,anchor,measurement,region)=>{
    const content={...richTextContent(reference.text),pointType:'support',derivedFrom:'source-example-navigation',navigationTargets:reference.targets};
    const node={id:stableId('node',slide.id,'source-example-navigation'),type:'text',slotId:'absolute',semanticRole:'source-explanation',geometry:box,content,style:{...anchor.style,fontSizePt:font},zIndex:500};
    const stale=new Set(prior.filter(n=>n.content?.derivedFrom==='source-example-navigation').map(n=>n.id));
    slide.sourceArtifactNodes=[...body,node];slide.nodes=[...(slide.nodes||[]).filter(n=>!stale.has(n.id)),node];
    slide.sourceArtifactFit={...fit,boxes:[...body.map(n=>n.geometry),box],measurements:[...(fit.measurements||[]).slice(0,body.length),measurement],
      usedHeight:region==='page-footer'?fit.usedHeight:Math.max(...body.map(n=>n.geometry.y+n.geometry.height),box.y+box.height)-canvas.y,
      navigationPlacement:region==='page-footer'?'measured-page-footer; existing body geometry retained':'measured-free-space; existing body geometry retained',
      ...(region==='page-footer'?{auxiliaryRegions:[...(fit.auxiliaryRegions||[]).filter(r=>r.purpose!=='source-example-navigation'),{purpose:'source-example-navigation',nodeId:node.id,bounds:box}]}:{})};
    return true;
  };
  for(const anchor of body.filter(n=>n.geometry).sort((a,b)=>a.geometry.y+a.geometry.height-b.geometry.y-b.geometry.height)) {
    const g=anchor.geometry,box={x:g.x,y:g.y+g.height+gap,width:g.width,height:canvas.y+canvas.height-g.y-g.height-gap};
    if(box.height<=0||box.x<canvas.x||box.x+box.width>canvas.x+canvas.width)continue;
    const content={...richTextContent(reference.text),pointType:'support',derivedFrom:'source-example-navigation',navigationTargets:reference.targets};
    const measurement=measureComponent({type:'text',content},box,font);
    box.height=measurement.height;
    if(measurement.overflow||box.y+box.height>canvas.y+canvas.height||occupied.some(n=>n.geometry&&overlap(box,n.geometry)))continue;
    return append(box,anchor,measurement,'body');
  }
  if(Number.isFinite(pageSize?.height)&&Number.isFinite(pageSize?.width)&&body.length){
    const y=canvas.y+canvas.height+3*12700,height=pageSize.height-6*12700-y;
    const blockers=visibleNodes(slide).filter(n=>n.geometry&&n.content?.derivedFrom!=='source-example-navigation'&&
      (!['text','list'].includes(n.type)||n.content?.text||n.content?.items?.length)&&!(n.geometry.width>=pageSize.width*.85&&n.geometry.height>=pageSize.height*.85));
    for(const region of [canvas,...body.map(n=>n.geometry)].filter(Boolean)){
      const box={x:region.x,y,width:region.width,height};if(height<=0||box.x<0||box.x+box.width>pageSize.width)continue;
      const content=richTextContent(reference.text),measurement=measureComponent({type:'text',content},box,font);box.height=measurement.height;
      if(measurement.overflow||box.y+box.height>pageSize.height-6*12700||blockers.some(n=>overlap(box,n.geometry)))continue;
      return append(box,body[0],measurement,'page-footer');
    }
  }
  return false;
}
export function bindDeckNavigation(project){
  normalizePaginationTitles(project);const navigation=finalDeckNavigation(project);project.navigation=navigation;
  (project.deck?.slides||[]).forEach((slide,index)=>{
    if(project.outline?.find(o=>o.id===slide.id)?.role==='navigation'){
      const commentary=navigationCommentary(project,navigation);
      try{bindSourceArtifacts(project,slide,[],index,commentary);}catch(error){
        if(!/source_artifact_capacity/u.test(error.message))throw error;
        const parts=sourceExplanationComponents(commentary.map(c=>c.text));
        const repair=repairNativePageAssignment(project,index,(p,i)=>fitComponents(parts,p,i),{derivedNavigation:true});
        if(!repair)throw error;
        project.runtime||={};(project.runtime.nativePageRepairs||=[]).push(repair);
        bindSourceArtifacts(project,slide,[],index,commentary);
        bindTemplateFidelity(project,{slideIds:[slide.id]});
      }
      const targets=finalNavigationTargets(navigation);
      for(const n of slide.sourceArtifactNodes||[]){n.content.derivedFrom='final-deck-navigation';n.content.navigationTargets=targets;}
      if(project.nodes?.[slide.id])project.nodes[slide.id].slide=slide;
    }
  });
  for(const reference of sourceExampleReferences(project)){
    const index=project.outline.findIndex(s=>s.id===reference.slideId),slide=project.deck.slides[index];
    if(project.revision>0||project.editing?.epochs?.[slide.id]>0||project.runtime?.slides?.[slide.id]?.accepted||slide.locked||slide.sourceArtifactNodes?.some(n=>n.locked))continue;
    const current=slide.sourceArtifactNodes||[];
    const existing=current.find(n=>n.content?.derivedFrom==='source-example-navigation'&&n.content.text===reference.text&&JSON.stringify(n.content.navigationTargets)===JSON.stringify(reference.targets));
    if(existing&&slide.nodes?.some(n=>n.id===existing.id&&n.content?.derivedFrom==='source-example-navigation'))continue;
    if(appendSourceExampleNavigation(slide,reference,{pageSize:project.templateFidelity||{width:12192000,height:6858000}})){if(project.nodes?.[slide.id])project.nodes[slide.id].slide=slide;continue;}
    const commentary=current.filter(n=>!n.sourceArtifact&&n.semanticRole==='source-explanation'&&!n.content?.derivedFrom).map(n=>({type:n.content?.pointType||'mechanism',text:n.content?.rawText||n.content?.richText?.source||n.content?.text}));
    const evidence=[...new Set(current.flatMap(n=>n.content?.sourceEvidenceIds||[]))];
    bindSourceArtifacts(project,slide,project.planning.slidePlan.find(p=>p.slideId===slide.id)?.sourceArtifacts||[],index,[...commentary,{type:'support',text:reference.text}],evidence);
    const node=slide.sourceArtifactNodes.find(n=>!n.sourceArtifact&&n.content?.text===reference.text);
    if(node){node.content.derivedFrom='source-example-navigation';node.content.navigationTargets=reference.targets;}
    bindTemplateFidelity(project,{slideIds:[slide.id]});
    if(project.nodes?.[slide.id])project.nodes[slide.id].slide=slide;
  }
  return navigation;
}

/** A definition followed by an actual schema example needs a visible handoff.
 * Derive it only from adjacent displayed schema fragments in the same source
 * chunk; this is navigation, never a generated fact or a completeness verdict. */
export function sourceExampleReferences(project){
 const inventory=project.source?.semantic?.inventory?.items||[],slides=project.deck?.slides||[],result=[];
 for(let i=0;i<slides.length-1;i++){
  const owned=project.outline?.find(s=>s.id===slides[i].id)?.sourceUnitIds||[];
  const definitions=inventory.filter(item=>owned.includes(item.id)&&!item.diagramSource&&!item.rows);
  if(!definitions.length||!slides[i].sourceArtifactNodes?.some(n=>definitions.some(d=>d.id===n.sourceArtifact?.sourceUnitId)))continue;
  const chunks=new Set(definitions.flatMap(d=>d.chunkRefs||[]));
  const exampleIds=new Set(inventory.filter(item=>item.diagramSource?.kind==='schema'&&item.diagramSource?.relation!=='absolute-geometry'&&item.chunkRefs?.some(id=>chunks.has(id))).map(item=>item.id));
  const targets=[];
  for(let j=i+1;j<slides.length;j++){
   const nodes=(slides[j].sourceArtifactNodes||[]).filter(n=>exampleIds.has(n.sourceArtifact?.sourceUnitId)&&n.type==='table'&&n.content?.rows?.length>1);
   if(!nodes.length)break;
   targets.push({slideId:slides[j].id,page:j+1,sourceUnitIds:[...new Set(nodes.map(n=>n.sourceArtifact.sourceUnitId))]});
  }
  if(!targets.length)continue;
  const english=project.generationPolicy?.language?.locale==='en'||project.generationPolicy?.language?.mode==='source'&&!definitions.some(d=>/[\p{Script=Han}]/u.test(d.text));
  const fields=[...new Set(targets.flatMap(target=>(slides.find(s=>s.id===target.slideId)?.sourceArtifactNodes||[]).filter(n=>exampleIds.has(n.sourceArtifact?.sourceUnitId)&&n.type==='table').flatMap(n=>(n.content.rows||[]).slice(1).map(row=>String(row[0]||'').trim()))))].filter(Boolean);
  // Name the actual companion content rather than promising future exposition.
  // Only current rendered field labels and actual stable targets enter the label.
  const pages=targets.length>1?`${targets[0].page}–${targets.at(-1).page}`:String(targets[0].page),label=fields[0]||'';
  result.push({slideId:slides[i].id,text:english?`Fields: ${label}${fields.length>1?'…':''} (p. ${pages})`:`字段：${label}${fields.length>1?'…':''}（第${pages}页）`,targets});
 }
 return result;
}

/** Editing text uses the public content schema. Reconstruct system provenance
 * only for an exact current label with actual source companions; caller text
 * cannot supply or preserve arbitrary navigation metadata. */
export function sourceExampleContent(project,slideId,text){
 const reference=sourceExampleReferences(project).find(ref=>ref.slideId===slideId&&ref.text===text);
 return reference?{text,derivedFrom:'source-example-navigation',navigationTargets:structuredClone(reference.targets)}:null;
}
