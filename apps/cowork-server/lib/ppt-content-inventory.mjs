import {sourcePointListKind}from './ppt-source-list-kinds.mjs';
/** Domain-independent content inventory and observed (not merely cited) coverage. */
import {sourceDisplayText} from './ppt-source-text.mjs';
import { visibleNodes } from './ppt-visible-content.mjs';
import { inspectObjectIntegrity } from './ppt-object-integrity.mjs';
import { markLanguagePairs, markEquivalentStructures } from './ppt-presentation-policy.mjs';
import { buildRelations } from './ppt-semantic-relations.mjs';
const normalizedText=value=>sourceDisplayText(value).toLowerCase().replace(/\s+/gu,' ').trim();
const structural = new Set(['ChartBlock','CodeBlock','TableBlock','EquationBlock','ProcessBlock','ChecklistBlock','TaxonomyBlock']);
const tokens = text => [...new Set(String(text||'').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|\d+(?:\.\d+)?|[\u3400-\u9fff]{2,4}/gu)||[])];
export function recall(expected, actual) {
  const terms = tokens(expected), shown = new Set(tokens(actual));
  return terms.length ? terms.filter(term=>shown.has(term)).length / terms.length : 0;
}
/** Splits one Markdown table row. A pipe inside inline math or inline code is
 * content (e.g. the absolute value in `$|\overline{IC}|$`), not a column
 * separator. Inline math follows the Pandoc rule so currency such as
 * `$5 | $10` still splits: an opening `$` is followed by a non-space and a
 * closing `$` is preceded by a non-space and not followed by a digit. */
export function splitTableRow(line) {
  const text = String(line).trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells = []; let cell = '';
  const closingDollar = start => {
    for (let j = start; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (text[j] === '$' && !/\s/u.test(text[j - 1] || ' ') && !/\d/u.test(text[j + 1] || '')) return j;
    }
    return -1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') { cell += '|'; i++; continue; }
    if (ch === '`') {
      const run = text.slice(i).match(/^`+/u)[0], end = text.indexOf(run, i + run.length);
      if (end > i) { cell += text.slice(i, end + run.length); i = end + run.length - 1; continue; }
    }
    if (ch === '$' && text[i + 1] !== '$' && text[i + 1] && !/\s/u.test(text[i + 1])) {
      const end = closingDollar(i + 1);
      if (end > i) { cell += text.slice(i, end + 1); i = end; continue; }
    }
    if (ch === '\\' && text[i + 1] === '(') {
      const end = text.indexOf('\\)', i + 2);
      if (end > i) { cell += text.slice(i, end + 2); i = end + 1; continue; }
    }
    if (ch === '|') { cells.push(cell); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell);
  return cells.map(value => value.trim().replace(/<br\s*\/?\s*>/gi, '\n'));
}
export function markdownRows(text) {
  return String(text).split('\n').filter(line=>/^\s*\|/.test(line)).map(splitTableRow)
    .filter(row=>!row.every(cell=>/^:?-{3,}:?$/.test(cell)));
}
/** Source tables must be rectangular for measurement and rendering. A ragged
 * row is normalised to the header width (missing cells become empty, surplus
 * cells are joined into the last cell) and reported, never thrown away. */
export function normalizeTableRows(rows) {
  const valid = (Array.isArray(rows) ? rows : []).filter(Array.isArray).map(row => row.map(cell => String(cell ?? '')));
  const width = valid[0]?.length || 0;
  const ragged = valid.map((row, index) => ({ index, width: row.length })).filter(row => row.width !== width);
  if (!width || !ragged.length) return { rows: valid, warning: null };
  const normalized = valid.map(row => row.length === width ? row
    : row.length < width ? [...row, ...Array(width - row.length).fill('')]
      : [...row.slice(0, width - 1), row.slice(width - 1).join(' | ')]);
  return { rows: normalized, warning: { code: 'source_table_ragged_rows', headerWidth: width, raggedRows: ragged } };
}
function role(block) {
  const section = (block.sectionPath||[]).join(' ');
  if(block.type==='chart')return 'ChartBlock';
  if (block.type==='code') return 'CodeBlock';
  if (block.type==='table') return 'TableBlock';
  if (block.type==='equation' || /^\s*(?:\$\$|\\\[)/.test(block.text)) return 'EquationBlock';
  if(block.type==='list'){const kind=sourcePointListKind(block);if(kind)return kind;}
  if (/summary|conclusion|小结|总结|结论/i.test(section)) return 'SummaryBlock';
  if (block.type==='list' && /workflow|process|procedure|流程|步骤/i.test(section)) return 'ProcessBlock';
  if(block.type==='diagram'&&['parallel','branching'].includes(block.diagramSource?.relation))return 'ComparisonBlock';
  if (block.type==='diagram' || block.semanticType==='process' && /->|→|步骤|step/i.test(block.text)) return 'ProcessBlock';
  return ({ definition:'DefinitionBlock', comparison:'ComparisonBlock', timeline:'TimelineBlock', example:'ExampleBlock', problem:'WarningBlock', evidence:'EvidenceBlock' })[block.semanticType] || 'MechanismBlock';
}
export function buildContentInventory(blocks, chunks, graph = []) {
  const warnings = [];
  const items = blocks.filter(block=>block.type!=='heading' && !/^(?:table of contents|contents|目录)(?:\s*\||$)/iu.test(block.sectionPath?.at(-1)||'') && !/^[-_*\s]+$/.test(block.text)).map(block=> {
    const type=role(block), chunkRefs=chunks.filter(chunk=>chunk.sourceBlocks.includes(block.id)).map(chunk=>chunk.id);
    const table = type==='TableBlock' ? normalizeTableRows(block.rows || markdownRows(block.text)) : null;
    if (table?.warning) warnings.push({ ...table.warning, sourceUnitId:block.id, sectionPath:block.sectionPath, source_ref:block.sourceRefs });
    return { id:block.id, type, semanticRole:type.replace('Block','').toLowerCase(), priority: structural.has(type)||type==='SummaryBlock'?'high':'normal',
      source_ref: block.sourceRefs, chunkRefs, sectionPath:block.sectionPath, text:block.text,
      must_preserve_structure: structural.has(type), ...(type==='CodeBlock'?{language:block.language || ''}:{}),
      ...(block.diagramSource?{mustDisplay:true,must_preserve_structure:true}:{}),
      ...(block.chart?{chart:structuredClone(block.chart)}:{}),
      ...(block.diagramSource?{diagramSource:block.diagramSource}:{}),
      ...(table?{rows:table.rows,...(table.warning?{tableGeometryWarning:table.warning}:{})}:{}) };
  });
  markLanguagePairs(items); markEquivalentStructures(items);
  return { version:1, warnings, source_sections:[...new Set(items.map(item=>item.sectionPath.join(' / ')))],
    must_cover_topics:items.filter(item=>item.priority==='high').map(item=>item.id), items,
    key_claims:items.filter(item=>item.type==='DefinitionBlock').map(item=>item.id),
    mechanisms:items.filter(item=>item.type==='MechanismBlock').map(item=>item.id),
    examples:items.filter(item=>item.type==='ExampleBlock').map(item=>item.id),
    codes:items.filter(item=>item.type==='CodeBlock').map(item=>item.id),
    equations:items.filter(item=>item.type==='EquationBlock').map(item=>item.id), tables:items.filter(item=>item.type==='TableBlock').map(item=>item.id),
    workflows:items.filter(item=>item.type==='ProcessBlock').map(item=>item.id), comparisons:items.filter(item=>item.type==='ComparisonBlock').map(item=>item.id),
    checklists:items.filter(item=>item.type==='ChecklistBlock').map(item=>item.id), summary_items:items.filter(item=>item.type==='SummaryBlock').map(item=>item.id),
    // Typed relations (matrix/order/alternative/definition) keep the legacy
    // id/relation/steps fields used by coverage statistics.
    relationships:buildRelations(items), adjacency:graph };
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
    if(item.presentation)return {sourceUnitId:item.id,type:item.type,priority:item.priority,source_ref:item.source_ref,slideIds:destinations,
      representation:item.presentation,compressed:false,omitted:item.presentation==='omitted_by_policy',...(item.equivalentTo?{equivalentTo:item.equivalentTo}:{}),
      reason:`${item.presentation}: ${item.presentationBasis||'presentation policy'}`};
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
  const verified=new Map(inspectObjectIntegrity({source},slides).ledger.objects.map(object=>[object.objectId,object.status==='rendered']));
  // Items omitted or merged by a disclosed presentation policy are not
  // expected on slides as separate objects and do not count against recall.
  const items=inventory.items.filter(item=>!item.presentation).map(item=> {
    const nodes=slides.flatMap(visibleNodes).filter(node=>node.sourceArtifact?.sourceUnitId===item.id);
    const nativeStructure=verified.get(item.id)===true;
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
