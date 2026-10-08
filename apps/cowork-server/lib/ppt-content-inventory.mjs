/** Domain-independent content inventory and observed (not merely cited) coverage. */
import {sourceDisplayText} from './ppt-source-text.mjs';
import { visibleNodes } from './ppt-visible-content.mjs';
const normalizedText=value=>sourceDisplayText(value).toLowerCase().replace(/\s+/gu,' ').trim();
const structural = new Set(['TableBlock','EquationBlock','ProcessBlock','ChecklistBlock','TaxonomyBlock']);
const tokens = text => [...new Set(String(text||'').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|\d+(?:\.\d+)?|[\u3400-\u9fff]{2,4}/gu)||[])];
export function recall(expected, actual) {
  const terms = tokens(expected), shown = new Set(tokens(actual));
  return terms.length ? terms.filter(term=>shown.has(term)).length / terms.length : 0;
}
export function markdownRows(text) {
  return String(text).split('\n').filter(line=>/^\s*\|/.test(line)).map(line=>line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/u).map(cell=>cell.trim().replace(/\*\*|`/g,'')))
    .filter(row=>!row.every(cell=>/^[:\s-]*$/.test(cell)));
}
function role(block) {
  const section = (block.sectionPath||[]).join(' ');
  if (block.type==='table') return 'TableBlock';
  if (block.type==='equation' || /^\s*(?:\$\$|\\\[)/.test(block.text)) return 'EquationBlock';
  if (/checklist|检查清单|实践清单/i.test(section) && block.type==='list') return 'ChecklistBlock';
  if (/summary|conclusion|小结|总结|结论/i.test(section)) return 'SummaryBlock';
  if (block.type==='diagram' || block.semanticType==='process' && /->|→|步骤|step/i.test(block.text)) return 'ProcessBlock';
  return ({ definition:'DefinitionBlock', comparison:'ComparisonBlock', timeline:'TimelineBlock', example:'ExampleBlock', problem:'WarningBlock', evidence:'EvidenceBlock' })[block.semanticType] || 'MechanismBlock';
}
export function buildContentInventory(blocks, chunks, graph = []) {
  const items = blocks.filter(block=>block.type!=='heading' && !/^(?:table of contents|contents|目录)(?:\s*\||$)/iu.test(block.sectionPath?.at(-1)||'') && !/^[-_*\s]+$/.test(block.text)).map(block=> {
    const type=role(block), chunkRefs=chunks.filter(chunk=>chunk.sourceBlocks.includes(block.id)).map(chunk=>chunk.id);
    return { id:block.id, type, semanticRole:type.replace('Block','').toLowerCase(), priority: structural.has(type)||type==='SummaryBlock'?'high':'normal',
      source_ref: block.sourceRefs, chunkRefs, sectionPath:block.sectionPath, text:block.text,
      must_preserve_structure: structural.has(type), ...(type==='TableBlock'?{rows:markdownRows(block.text)}:{}) };
  });
  return { version:1, source_sections:[...new Set(items.map(item=>item.sectionPath.join(' / ')))],
    must_cover_topics:items.filter(item=>item.priority==='high').map(item=>item.id), items,
    key_claims:items.filter(item=>item.type==='DefinitionBlock').map(item=>item.id),
    mechanisms:items.filter(item=>item.type==='MechanismBlock').map(item=>item.id),
    examples:items.filter(item=>item.type==='ExampleBlock').map(item=>item.id),
    equations:items.filter(item=>item.type==='EquationBlock').map(item=>item.id), tables:items.filter(item=>item.type==='TableBlock').map(item=>item.id),
    workflows:items.filter(item=>item.type==='ProcessBlock').map(item=>item.id), comparisons:items.filter(item=>item.type==='ComparisonBlock').map(item=>item.id),
    checklists:items.filter(item=>item.type==='ChecklistBlock').map(item=>item.id), summary_items:items.filter(item=>item.type==='SummaryBlock').map(item=>item.id),
    relationships:items.filter(item=>['ProcessBlock','TableBlock'].includes(item.type)).map(item=>({id:`rel_${item.id}`,sourceUnitId:item.id,source_ref:item.source_ref,chunkRefs:item.chunkRefs,relation:item.type==='TableBlock'?'comparison':'precedes',steps:item.type==='TableBlock'?item.rows.map(row=>row.join(' | ')):item.text.split(/(?:->|→)/u).map(text=>text.trim()),priority:'high'})), adjacency:graph };
}
export function coverageMapV2(source, outline, explicit = []) {
  const inventory=source?.semantic?.inventory;
  if (!inventory) return { version:2, topic:[], detail:[], structure:[], relationship:[] };
  const decisions=new Map((Array.isArray(explicit)?explicit:[]).filter(item=>item && typeof item==='object').map(item=>[item.sourceUnitId,item]));
  const detail=inventory.items.map(item=> {
    // New plans own specific inventory units. A shared chunk citation must not
    // claim that every table/formula/paragraph in that chunk was assigned.
    const destinations=outline.filter(slide=>Array.isArray(slide.sourceUnitIds)
      ? slide.sourceUnitIds.includes(item.id) : slide.chunkRefs?.some(id=>item.chunkRefs.includes(id))).map(slide=>slide.id);
    const decision=decisions.get(item.id);
    return {sourceUnitId:item.id,type:item.type,priority:item.priority,source_ref:item.source_ref,slideIds:destinations,
      representation:decision?.representation || (structural.has(item.type)?'structured':'explained'), compressed:Boolean(decision?.compressed),
      omitted:!destinations.length, reason:!destinations.length?String(decision?.reason||'unmapped; requires planner review'):''};
  });
  return {version:2,topic:(source.semantic.chunks||[]).map(chunk=>({sourceUnitId:chunk.id,slideIds:outline.filter(slide=>slide.chunkRefs?.includes(chunk.id)).map(slide=>slide.id)})),
    detail,structure:detail.filter(item=>structural.has(item.type)),relationship:inventory.relationships.map(edge=>({...edge,
      slideIds:outline.filter(slide=>edge.chunkRefs?.some(id=>slide.chunkRefs?.includes(id))).map(slide=>slide.id)}))};
}
export function topicGroupDecisions(source, outline, plans, explicit = []) {
  return (source?.semantic?.chunks||[]).map(chunk=> {
    const destinations=outline.filter(slide=>slide.chunkRefs?.includes(chunk.id));
    const plan=plans.find(item=>item.slideId===destinations[0]?.id);
    const merge=destinations.some(slide=>slide.chunkRefs?.length>1);
    const supplied = (Array.isArray(explicit)?explicit:[]).find(item=>item && item.group_id===chunk.id && ['merge','split','standalone'].includes(item.decision) && typeof item.reason==='string' && item.reason.trim());
    return {group_id:chunk.id,decision:supplied?.decision || (destinations.length>1?'split':merge?'merge':'standalone'),
      origin:supplied?'planner':'derived_allocation',
      reason:supplied?supplied.reason.slice(0,800):destinations.length>1?'Source detail is allocated to multiple page questions; verify the distinct contribution':merge?'Source units share a destination page; verify cohesion and combined capacity':'Source unit has one destination; verify that focus is warranted',
      estimated_semantic_units:chunk.sourceBlocks?.length||0,layout_candidate:plan?.visualIntent?.type||'none',
      capacity_ok:plan?.densityFit?.capacity_ok ?? null, capacity_basis:plan?.densityFit?.measurementBasis || 'not_measured', slideIds:destinations.map(slide=>slide.id)};
  });
}
export function inspectInventoryCoverage(source, slides, visibleText) {
  const inventory=source?.semantic?.inventory;
  if (!inventory) return {metrics:{},issues:[]};
  const text=slides.map(visibleText).join('\n');
  const items=inventory.items.map(item=> {
    const nodes=slides.flatMap(visibleNodes).filter(node=>node.sourceArtifact?.sourceUnitId===item.id);
    const nativeStructure=nodes.length>0 && (item.type!=='TableBlock' || nodes.some(node=>node.type==='table'));
    const contentRecall=recall(normalizedText(item.text),normalizedText(text));
    const actualCells=nodes.filter(node=>node.type==='table').flatMap(node=>node.content.rows.flat()).map(normalizedText);
    return {...item, contentRecall, covered:contentRecall>=.45, structureRetained:!item.must_preserve_structure||nativeStructure,
      // Table recall compares all cells, not just the first column's row labels.
      cellRecall:item.rows?item.rows.flat().filter(cell=>actualCells.includes(normalizedText(cell)) || recall(normalizedText(cell),normalizedText(text))>=.6).length/item.rows.flat().length:null};
  });
  const ratio=list=>list.length?list.filter(item=>item.covered).length/list.length:null;
  const structures=items.filter(item=>item.must_preserve_structure);
  const relationships=inventory.relationships.map(edge=>{
    const structured=slides.flatMap(visibleNodes).filter(node=>node.sourceArtifact?.sourceUnitId===edge.sourceUnitId);
    const relatedText=structured.map(node=>node.content?.rows?.flat().join(' ') || node.content?.items?.map(item=>item.text).join(' ') || node.content?.text || '').join(' ');
    return {id:edge.id,covered:structured.length ? edge.steps.every(step=>recall(step,relatedText)>=.45)
      : slides.some(slide=>edge.steps.every(step=>recall(step,visibleText(slide))>=.45))};
  });
  const tail=items.slice(Math.floor(items.length*.75));
  const metrics={relationshipRecall:relationships.length?relationships.filter(item=>item.covered).length/relationships.length:null,endSectionRecall:ratio(tail),endSectionBiasGap:ratio(items)-ratio(tail),topicRecall:ratio(items),highPriorityDetailRecall:ratio(items.filter(item=>item.priority==='high')),
    structureRecall:structures.length?structures.filter(item=>item.structureRetained&&item.covered).length/structures.length:null,
    tableCellRecall:items.filter(item=>item.rows).map(item=>({id:item.id,recall:item.cellRecall})),
    equationRecall:ratio(items.filter(item=>item.type==='EquationBlock')),workflowRecall:ratio(items.filter(item=>item.type==='ProcessBlock')),
    checklistRecall:ratio(items.filter(item=>item.type==='ChecklistBlock')),summaryRecall:ratio(items.filter(item=>item.type==='SummaryBlock')),
    sourceUtilization:ratio(items),items:items.map(({id,type,priority,contentRecall,structureRetained,cellRecall})=>({id,type,priority,contentRecall,structureRetained,cellRecall}))};
  const issues=items.filter(item=>item.priority==='high'&&(!item.covered||!item.structureRetained)).map(item=>({code:item.type==='SummaryBlock'?'source_end_section_missing':'source_structure_or_detail_missing',severity:'warning',
    sourceUnitId:item.id,repairable:false,message:`${item.type} ${item.id} ${!item.covered?'has insufficient visible content':'lost its source structure'}`}));
  return {metrics,issues};
}
