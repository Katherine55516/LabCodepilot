/** Page design contract: what each slide must make visible and keep together.
 * The planner may propose it; only real inventory/relation IDs survive, and the
 * deterministic part (formula↔explanation adjacency, matrix axes, legal
 * prototypes) is always derived from the source.
 * Plan: docs/exec-plans/active/ppt-page-contract-relations-media-repair.md (B). */
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { recall } from './ppt-content-inventory.mjs';
import { slideUnitOwnership } from './ppt-semantic-relations.mjs';

export const PAGE_JOBS = ['cover', 'definition', 'comparison', 'mechanism', 'workflow', 'diagnostic', 'evidence', 'synthesis', 'closing'];
export const PAGE_PROTOTYPES = ['text', 'two-panel', 'image-split', 'collection-grid', 'numbered-steps', 'formula-variables', 'table-notes', 'dual-table', 'big-number', 'timeline', 'comparison'];
const ROLE_JOB = { cover: 'cover', closing: 'closing', summary: 'synthesis', comparison: 'comparison', process: 'workflow', roadmap: 'workflow', timeline: 'workflow',
  evidence: 'evidence', metric: 'evidence', mechanism: 'mechanism', framework: 'definition', architecture: 'mechanism', recommendation: 'synthesis', problem: 'diagnostic' };

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const strings = (value, limit, max) => (Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, max)).slice(0, limit);

/** Keeps only fields that reference real source units/relations. */
export function normalizePageContract(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const items = source?.semantic?.inventory?.items || [];
  const unitIds = new Set(items.filter(item => !item.presentation).map(item => item.id));
  const relationIds = new Set((source?.semantic?.inventory?.relationships || []).map(relation => relation.id));
  return {
    ...(PAGE_JOBS.includes(raw.job) ? { job: raw.job } : {}),
    ...(text(raw.question, 240) ? { question: text(raw.question, 240) } : {}),
    requiredUnits: [...new Set(strings(raw.requiredUnits, 1000, 40))].filter(id => unitIds.has(id)),
    requiredRelations: [...new Set(strings(raw.requiredRelations, 12, 60))].filter(id => relationIds.has(id)),
    adjacencyPairs: (Array.isArray(raw.adjacencyPairs) ? raw.adjacencyPairs : []).filter(pair => unitIds.has(pair?.a) && unitIds.has(pair?.b) && pair.a !== pair.b)
      .slice(0, 8).map(pair => ({ a: pair.a, b: pair.b, reason: text(pair.reason, 120) })),
    comparisonAxes: strings(raw.comparisonAxes, 8, 80),
    ...(text(raw.groupingReason, 240) ? { groupingReason: text(raw.groupingReason, 240) } : {}),
    omissions: (Array.isArray(raw.omissions) ? raw.omissions : []).filter(item => unitIds.has(item?.sourceUnitId) && text(item.reason, 240))
      .slice(0, 12).map(item => ({ sourceUnitId: item.sourceUnitId, reason: text(item.reason, 240) })),
    compositionCandidates: strings(raw.compositionCandidates, 4, 40).filter(id => PAGE_PROTOTYPES.includes(id)),
  };
}

const ownedUnits = (slide, source) => {
  const valid = new Set((source?.semantic?.inventory?.items || []).filter(item => !item.presentation).map(item => item.id));
  return [...new Set(slide.sourceUnitIds || slide.densityFit?.sourceUnitIds || [])].filter(id => valid.has(id));
};

/** Source-determined contract for a planned slide, merged with the planner's. */
export function pageContractFor(slide, source, role, proposed = null) {
  const inventory = source?.semantic?.inventory || {};
  const items = new Map((inventory.items || []).map(item => [item.id, item]));
  const relations = inventory.relationships || [];
  const owned = ownedUnits(slide, source);
  const model = normalizePageContract(proposed ?? slide.pageContract, source) || { requiredUnits: [], requiredRelations: [], adjacencyPairs: [], comparisonAxes: [], omissions: [], compositionCandidates: [] };
  const omitted = new Set(model.omissions.map(item => item.sourceUnitId));
  const ownedRelations = relations.filter(relation => relation.unitIds?.some(id => owned.includes(id)));
  const derivedPairs = [], extraUnits = [];
  for (const relation of ownedRelations.filter(relation => relation.type === 'definition')) {
    const [formula, ...explanations] = relation.unitIds;
    if (!owned.includes(formula)) continue;
    for (const id of explanations) { derivedPairs.push({ a: formula, b: id, reason: 'formula and the explanation of its variables' }); extraUnits.push(id); }
  }
  const structural = owned.filter(id => items.get(id)?.must_preserve_structure);
  const numberUnits = new Set((source?.semantic?.evidenceAtoms || []).filter(atom => atom.kind === 'number').map(atom => (atom.id.match(/^e_(b_\d+)_/u) || [])[1]).filter(Boolean));
  const types = new Set(ownedRelations.map(relation => relation.type));
  const candidates = [
    ...(types.has('matrix') ? [ownedRelations.filter(relation => relation.type === 'matrix').length > 1 ? 'dual-table' : 'table-notes'] : []),
    ...(types.has('order') ? ['numbered-steps'] : []), ...(types.has('alternative') ? ['comparison', 'collection-grid'] : []),
    ...(types.has('definition') ? ['formula-variables'] : []), ...(owned.some(id => numberUnits.has(id)) ? ['big-number'] : []),
  ];
  const job = model.job || ROLE_JOB[role] || (types.has('definition') ? 'definition' : types.has('alternative') || types.has('matrix') ? 'comparison' : types.has('order') ? 'workflow' : 'mechanism');
  return {
    version: 1, job, ...(model.question || slide.question ? { question: model.question || String(slide.question).slice(0, 240) } : {}),
    requiredUnits: [...new Set([...model.requiredUnits, ...structural, ...extraUnits])].filter(id => !omitted.has(id) || items.get(id)?.must_preserve_structure || extraUnits.includes(id)),
    requiredRelations: [...new Set([...model.requiredRelations, ...ownedRelations.filter(relation => relation.type !== 'definition' || owned.includes(relation.unitIds[0])).map(relation => relation.id)])],
    adjacencyPairs: [...model.adjacencyPairs, ...derivedPairs.filter(pair => !model.adjacencyPairs.some(item => item.a === pair.a && item.b === pair.b))],
    comparisonAxes: model.comparisonAxes.length ? model.comparisonAxes : ownedRelations.filter(relation => relation.type === 'matrix').flatMap(relation => relation.axes.slice(1)).slice(0, 8),
    ...(model.groupingReason ? { groupingReason: model.groupingReason } : {}), omissions: model.omissions,
    compositionCandidates: [...new Set([...model.compositionCandidates.filter(id => id !== 'big-number' || owned.some(unit => numberUnits.has(unit))), ...candidates])].slice(0, 4),
    basis: proposed ?? slide.pageContract ? 'planner+source' : 'source',
  };
}

const sourceNumbers = source => new Set((String(source?.text || '').match(/\d+(?:[.,]\d+)?/gu) || []).map(value => value.replace(',', '')));
const fontOf = node => Number(node.style?.fontSizePt || node.textLayout?.fontSizePt || 0);

/** Visible-result checks against each slide's contract (warnings: these are
 * page-design signals, structure losses are reported by object integrity). */
export function inspectPageContracts(project, slides = project.deck?.slides || []) {
  const items = new Map((project.source?.semantic?.inventory?.items || []).map(item => [item.id, item]));
  const plans = new Map((project.planning?.slidePlan || []).map(plan => [plan.slideId, plan]));
  const owners = slideUnitOwnership(project, slides);
  const numbers = sourceNumbers(project.source);
  const visibleText = new Map(slides.map(slide => [slide.id, visibleNodes(slide).map(nodeContentText).join('\n')]));
  // Source IDs establish provenance, not visible explanation. Evaluate the
  // actual copy even when a node claims the right sourceArtifact ID.
  const visibleOn = (id, slideId) => recall(items.get(id)?.text || '', visibleText.get(slideId) || '') >= .45;
  const issues = [];
  slides.forEach((slide, index) => {
    const contract = plans.get(slide.id)?.pageContract;
    if (contract && index > 0) {
      const waived = (contract.omissions || []).filter(x => items.get(x.sourceUnitId)?.must_preserve_structure);
      if (waived.length) issues.push({ code: 'page_contract_structure_waiver', severity: 'error', slideId: slide.id, sourceUnitIds: waived.map(x=>x.sourceUnitId), repairable: true, message: 'Planner omissions cannot waive source structure obligations; use the explicit presentation policy.' });
      const missing = contract.requiredUnits.filter(id => items.has(id) && !items.get(id).must_preserve_structure && !visibleOn(id, slide.id));
      if (missing.length) issues.push({ code: 'page_contract_unit_missing', severity: 'warning', slideId: slide.id, sourceUnitIds: missing, repairable: true,
        message: `Contracted source units are not visibly explained on this slide: ${missing.slice(0, 6).join(', ')}` });
      for(const id of contract.requiredUnits.filter(id=>items.has(id)&&!items.get(id).must_preserve_structure&&visibleOn(id,slide.id))) {
        const original=items.get(id).text,visible=visibleText.get(slide.id)||'';
        const checks=[[/\b(?:not|cannot|never|no longer)\b|不得|不能|并非|不是/iu,/\b(?:not|cannot|never|no longer)\b|不得|不能|并非|不是/iu,'negation'],[/\b(?:only if|only when|unless|provided that)\b|只有|除非|仅当/iu,/\b(?:if|when|unless|provided that|conditional)\b|只有|除非|仅当|条件|前提/iu,'condition']];
        for(const [sourceMarker,visibleMarker,kind] of checks)if(sourceMarker.test(original)&&!visibleMarker.test(visible))issues.push({code:'page_contract_qualifier_missing',severity:'warning',slideId:slide.id,sourceUnitIds:[id],repairable:true,message:`Required source ${kind} is not explicit in visible copy; lexical signal requires source review.`});
      }
      for (const pair of contract.adjacencyPairs || []) {
        const here = [pair.a, pair.b].map(id => visibleOn(id, slide.id));
        if (here[0] === here[1]) continue;
        const elsewhere = slides.find(other => other.id !== slide.id && visibleOn(here[0] ? pair.b : pair.a, other.id) && owners.get(other.id)?.has(here[0] ? pair.b : pair.a));
        if (elsewhere) issues.push({ code: 'page_contract_adjacency_split', severity: 'warning', slideId: slide.id, slideIds: [slide.id, elsewhere.id], sourceUnitIds: [pair.a, pair.b], repairable: true,
          message: `${pair.reason || 'Related units'} are split across slides.` });
      }
    }
    if (index === 0) return;
    const headings = new Set(['title', 'template-title', 'section', 'subtitle', 'eyebrow', 'page-number']);
    for (const node of visibleNodes(slide).filter(node => fontOf(node) >= 40 && !headings.has(node.semanticRole))) {
      const value = nodeContentText(node).trim();
      if (!value || value.length > 24) continue;
      const found = (value.match(/\d+(?:[.,]\d+)?/gu) || []).map(item => item.replace(',', ''));
      if (!found.length || found.some(item => !numbers.has(item)))
        issues.push({ code: 'big_number_without_source_value', severity: 'warning', slideId: slide.id, nodeIds: [node.id], repairable: true,
          message: `"${value}" occupies a big-number position but is not a value stated in the source; use a different prototype or a sourced number with its unit.` });
    }
  });
  return issues;
}
