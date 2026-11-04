import {sourceDisplayText}from './ppt-source-text.mjs';
/** Typed source relations (matrix / order / alternative / definition) derived
 * deterministically from the inventory, and checks that slides keep them.
 * Relations come from source structure only; nothing here invents edges.
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md (A). */
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { orderedSourceSteps } from './ppt-source-boundaries.mjs';

const sectionKey = item => (item.sectionPath || []).join('\u0000');
const stepLines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
const stepLabel = line => line.replace(/^\s*\d+[.)]\s*/u, '').split(/[:：]/u)[0].trim();
const BRANCH = /\b(?:yes|no|if|otherwise|else)\b\s*[:：]|是\s*[:：]|否\s*[:：]|如果|否则/iu;
const ALTERNATIVE_CUE = [
  /(?:can be (?:expressed|implemented|constructed|built|measured|computed|done|defined)|(?:several|multiple|different|various|many) (?:ways|forms|styles|approaches|expressions|variants|methods))[^:：.。]{0,60}[:：]\s*([^.。]+)/iu,
  /(?:多种|几种|若干|不同的?)(?:表达|构建|实现|方式|形式|做法|方法)[^：:。]{0,20}[：:]\s*([^。]+)/u,
];
const NOT_INTERCHANGEABLE = /not interchangeable|cannot be used interchangeably|不可互换|不能互换/iu;
const EXPLAINS = /^\s*(?:(?:where|here|then|with|in which|in this (?:formula|equation))\b|其中|这里|式中|此处|上式中)/iu;

function alternativeMembers(text) {
  for (const cue of ALTERNATIVE_CUE) {
    const match = String(text || '').match(cue);
    if (!match) continue;
    const members = match[1].split(/\s*(?:,|;|，|；|、)\s*(?:or\s+|and\s+|或者?|以及)?|\s+or\s+|或者/u)
      .map(item => item.replace(/^\s*(?:or|and|或|以及)\s+/iu, '').trim()).filter(item => item && item.length <= 120);
    if (members.length >= 2) return members;
  }
  return null;
}

/** Builds typed relations; legacy fields keep coverage statistics working. */
export function buildRelations(items) {
  const relations = [];
  const base = item => ({ sourceUnitId: item.id, source_ref: item.source_ref, chunkRefs: item.chunkRefs, priority: 'high' });
  items.forEach((item, index) => {
    if (item.presentation) return;
    if(item.diagramSource?.relation==='symbolic-interval'){
      relations.push({id:`rel_${item.id}`,type:'interval',relation:'symbolic-interval',...base(item),unitIds:[item.id],
        axes:item.rows?.[0]||[],members:item.rows?.slice(1).map(row=>row[0])||[],steps:[],
        sourceSpan:item.source_ref,topologyEvidence:'Literal interval positions with original annotations and boundary rules; no durations inferred'});
    }else if(item.diagramSource?.graph){
      const graph=item.diagramSource.graph;
      relations.push({id:`rel_${item.id}`,type:'source_graph',relation:'directed_flow',...base(item),unitIds:[item.id],members:graph.nodes.map(n=>n.label),nodes:graph.nodes,edges:graph.edges,steps:[]});
    }else if(item.diagramSource?.presentation==='literal_source_lines'){
      relations.push({id:`rel_${item.id}`,type:'source_diagram',relation:item.diagramSource.relation,...base(item),unitIds:[item.id],members:[],steps:[],topologyEvidence:'complete literal source drawing; no inferred edges'});
    }else if (item.type === 'TableBlock' && Array.isArray(item.rows) && item.rows.length > 1) {
      const [header, ...body] = item.rows;
      relations.push({ id: `rel_${item.id}`, type: 'matrix', relation: 'comparison', ...base(item), unitIds: [item.id],
        axes: header.map(String), members: body.map(row => String(row[0] ?? '')), rowCount: body.length, columnCount: header.length,
        steps: item.rows.map(row => row.join(' | ')) });
    } else if (item.type === 'ProcessBlock') {
      const steps = orderedSourceSteps(item.text);
      relations.push({ id: `rel_${item.id}`, type: 'order', relation: 'precedes', ...base(item), unitIds: [item.id],
        members: steps.map(stepLabel), branches: steps.filter(step => BRANCH.test(step)).map(step => ({ step: stepLabel(step), conditions: step.split(/[:：]/u).slice(1).join(':').trim() })),
        steps });
    } else {
      const members = alternativeMembers(item.text);
      // A translation of the same alternatives joins the existing relation.
      const pairOf = members && item.languagePairId && relations.find(relation => relation.type === 'alternative' && relation.languagePairId === item.languagePairId);
      if (pairOf) { pairOf.unitIds.push(item.id); pairOf.translatedMembers = members; if (NOT_INTERCHANGEABLE.test(item.text)) pairOf.interchangeable = false; }
      else if (members) relations.push({ ...(item.languagePairId ? { languagePairId: item.languagePairId } : {}), id: `rel_alt_${item.id}`, type: 'alternative', relation: 'alternative_of', ...base(item), unitIds: [item.id],
        members, interchangeable: !NOT_INTERCHANGEABLE.test(item.text) && !NOT_INTERCHANGEABLE.test(items[index + 1]?.text || '') ? null : false, steps: members });
    }
    if (item.type === 'EquationBlock') {
      const explanation = items.slice(index + 1, index + 4).find(next => sectionKey(next) === sectionKey(item) && next.type !== 'EquationBlock' && EXPLAINS.test(next.text));
      if (explanation) {
        const pair = items.find(other => other !== explanation && other.languagePairId && other.languagePairId === explanation.languagePairId);
        relations.push({ id: `rel_def_${item.id}`, type: 'definition', relation: 'defined_by', ...base(item),
          unitIds: [item.id, explanation.id, ...(pair ? [pair.id] : [])], members: [], steps: [] });
      }
    }
  });
  return relations;
}

/** Unit IDs owned by each slide: planned ownership plus rendered source artifacts. */
export function slideUnitOwnership(project, slides) {
  const owners = new Map();
  for (const slide of slides) {
    const outline = (project.outline || []).find(item => item.id === slide.id) || {};
    const plan = (project.planning?.slidePlan || []).find(item => item.slideId === slide.id) || {};
    const ids = new Set([...(outline.sourceUnitIds || outline.densityFit?.sourceUnitIds || []), ...(plan.pageContract?.requiredUnits || []),
      ...visibleNodes(slide).map(node => node.sourceArtifact?.sourceUnitId).filter(Boolean)]);
    owners.set(slide.id, ids);
  }
  return owners;
}

const norm = text => String(text || '').toLowerCase().replace(/\s+/gu, ' ').trim();
const sequenceLike = (slide, outline) => slide.layoutId === 'timeline' || ['pipeline', 'timeline', 'process'].includes(outline?.visualIntent?.type)
  || visibleNodes(slide).some(node => node.type === 'timeline' || node.content?.ordered === true || node.content?.listStyle === 'numbered');

export function inspectRelationFidelity(project, slides = project.deck?.slides || []) {
  const relations = project.source?.semantic?.inventory?.relationships || [];
  if (!relations.length) return [];
  const owners = slideUnitOwnership(project, slides);
  const issues = [];
  for (const relation of relations) {
    const owning = slides.filter(slide => relation.unitIds?.some(id => owners.get(slide.id)?.has(id)));
    if (relation.type === 'alternative') {
      for (const slide of owning) {
        const outline = (project.outline || []).find(item => item.id === slide.id);
        const text = norm(visibleNodes(slide).map(nodeContentText).join(' '));
        const shown = relation.members.filter(member => text.includes(norm(member).split(' ').slice(0, 3).join(' '))).length;
        if (sequenceLike(slide, outline) && shown >= 2)
          issues.push({ code: 'relation_alternative_as_sequence', severity: 'error', slideId: slide.id, relationId: relation.id, repairable: true,
            message: `Alternatives (${relation.members.slice(0, 4).join(' / ')}) are presented as ordered steps; use a comparison/collection structure — they are not a sequence.` });
      }
    }
    if (relation.type === 'order') {
      for (const slide of slides) for (const node of visibleNodes(slide).filter(node => node.type === 'timeline' && node.sourceArtifact?.sourceUnitId === relation.sourceUnitId)) {
        const shown = (node.content?.items || []).map(item => norm(stepLabel(item.text || item.body || '')));
        const expected = relation.members.map(member => norm(member));
        const positions = expected.map(label => shown.findIndex(value => value && (value.includes(label) || label.includes(value)))).filter(at => at >= 0);
        if (positions.some((at, i) => i > 0 && at < positions[i - 1]))
          issues.push({ code: 'relation_order_changed', severity: 'error', slideId: slide.id, relationId: relation.id, nodeIds: [node.id], repairable: true,
            message: 'Process steps are shown in a different order from the source.' });
      }
    }
    if (relation.type === 'definition') {
      const [formula, ...explanations] = relation.unitIds;
      const formulaSlides = slides.filter(slide => owners.get(slide.id)?.has(formula)).map(slide => slide.id);
      const explanationSlides = slides.filter(slide => explanations.some(id => owners.get(slide.id)?.has(id))).map(slide => slide.id);
      if (formulaSlides.length && explanationSlides.length && !formulaSlides.some(id => explanationSlides.includes(id)))
        issues.push({ code: 'relation_definition_split', severity: 'warning', slideId: explanationSlides[0], slideIds: [...formulaSlides, ...explanationSlides], relationId: relation.id, repairable: true,
          message: 'A formula and the explanation of its variables are on different slides; keep them adjacent.' });
    }
  }
  return issues;
}

/** Reading units among a page's source units, in source order: a translation
 * pair, and a lead-in sentence ending in ":" together with the list it opens
 * (and the lead-in's translation). Splitting a unit across pages is allowed
 * only when the unit alone does not fit one page. */
export function readingUnits(items, ids) {
  const wanted = new Set(ids), ordered = items.filter(item => wanted.has(item.id)), units = [];
  const positions=new Map(items.map((item,index)=>[item.id,index]));
  const adjacent=(a,b)=>Boolean(a&&b)&&positions.get(b.id)===positions.get(a.id)+1&&JSON.stringify(a.sectionPath||[])===JSON.stringify(b.sectionPath||[]);
  const isList = item => /^\s*(?:[-*+•]|\d+[.)])\s+/mu.test(String(item?.text || ''));
  const leadIn = item => /[:：]\s*$/u.test(sourceDisplayText(item?.text || '').trim());
  for (let i = 0; i < ordered.length;) {
    const unit = [ordered[i]];
    const pairEnd = () => { while (i + unit.length < ordered.length && unit.at(-1).languagePairId && ordered[i + unit.length].languagePairId === unit.at(-1).languagePairId) unit.push(ordered[i + unit.length]); };
    pairEnd();
    if (unit.every(leadIn)) {
      // A bilingual lead-in may be two consecutive unpaired items ("You define:" / "你需要定义：").
      while (i + unit.length < ordered.length && leadIn(ordered[i + unit.length]) && adjacent(unit.at(-1),ordered[i + unit.length]) && unit.length < 2) unit.push(ordered[i + unit.length]);
      // Keep the complete consecutive list, not only its first item.
      // The wanted-ID filter must never bridge an omitted source unit.
      while (isList(ordered[i + unit.length])&&adjacent(unit.at(-1),ordered[i + unit.length])) { unit.push(ordered[i + unit.length]); pairEnd(); }
      // A colon can introduce a prose pipeline or code/diagram, too. Keep
      // its first complete adjacent body object with it when measured to fit.
      if(unit.every(leadIn)&&ordered[i+unit.length]?.type!=='HeadingBlock'&&adjacent(unit.at(-1),ordered[i+unit.length])){unit.push(ordered[i+unit.length]);pairEnd();}
    }
    units.push(unit.map(item => item.id)); i += unit.length;
  }
  return units;
}
