/** Structured failure trace (F1 of the capacity/remediation fixture plan).
 * Every failed run records WHAT kind of failure it was and the evidence behind
 * it, instead of only a message: page, template, available size, font,
 * estimated vs measured height, measurement basis, source IDs, and the repairs
 * already attempted. Classes:
 * - true_overflow: measured or projected geometry really overflows;
 * - unverified_capacity: a capacity block without measured geometry
 *   (an estimate) — a candidate false rejection;
 * - false_rejection: a structurally valid plan blocked by a public text field;
 * - planning: the plan or its repair broke a contract (ownership, coverage,
 *   order, page authorization, fidelity);
 * - remediation_no_progress: the same failure returned after the same repair;
 * - transport: the model call itself failed.
 * The trace is diagnostic data only; it never changes a gate decision. */
import { nextRemediation, mustKeepTokens } from './ppt-remediation-ladder.mjs';
import { allowsEditorialSelection } from './ppt-generation-policy.mjs';
export const FAILURE_TRACE_VERSION = 1;
const EMU_PER_PT = 12700;
const TRANSPORT = new Set(['transport', 'timeout', 'rate_limit', 'network', 'auth', 'request_invalid', 'model_unavailable', 'model_not_found', 'cancelled', 'execution_attempt_limit', 'execution_budget', 'truncated_output', 'empty_visible_output', 'invalid_json']);
const CAPACITY = /capacity|overflow|template_slot|density/u;
const MEASURED = new Set(['projected_geometry', 'rendered', 'source_component_contract', 'native_text_fit', 'rendered_visibility', 'shared_line_estimator']);
const pt = emu => Number.isFinite(Number(emu)) ? Math.round(Number(emu) / EMU_PER_PT * 10) / 10 : undefined;
const clean = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));

/** Source IDs named anywhere in a failure's details (bounded). */
export function failureSourceIds(details = {}) {
  const ids = [details.sourceUnitId, details.entry?.sourceUnitId, ...(details.sourceUnitIds || []), ...(details.missing || []), ...(details.missingIds || []), ...(details.invalid || []),
    ...(details.editorialCoverageConflicts || []).flatMap(c => c.missingSourceUnitIds || []), ...(details.summaryConflicts || []).map(c => c.sourceUnitId),
    ...(details.issues || []).flatMap(i => i.details?.sourceUnitIds || []), ...(details.tableProjectionConflicts || []).map(c => c.sourceUnitId),
    ...(details.duplicateSourceIds || []), ...(details.missingSourceIds || []), ...(details.unexpectedSourceIds || [])];
  return [...new Set(ids.filter(id => typeof id === 'string' && id))].slice(0, 40);
}

/** Stable identity of a failure for no-progress detection: code + source IDs + page. */
export function failureSignature(error) {
  if (!error) return '';
  const d = error.details || {};
  return JSON.stringify([error.code || '', failureSourceIds(d).sort(), d.pageIndex ?? null, String(error.message || '').replace(/\d+/gu, '#').slice(0, 120)]);
}

export function classifyFailure(error = {}) {
  const code = String(error.code || ''), d = error.details || {}, message = String(error.message || '');
  if (error.noProgress || code === 'capacity_no_progress') return 'remediation_no_progress';
  if (TRANSPORT.has(code) || error.origin === 'model_transport') return 'transport';
  if (code === 'planning_metadata_invalid' || d.field === 'allocation reason') return 'false_rejection';
  // Classified by code; the wording is used only when no code was given
  // (messages often mention capacity while describing a planning rule).
  if (d.overflowSource === 'reference_count') return 'planning';
  if (d.overflowSource === 'unmeasured') return 'unverified_capacity';
  if (CAPACITY.test(code) || !code && /capacity|overflow/iu.test(message)) {
    const measurement = d.measurement || error.measurement;
    const overflow = Number(d.overflowEMU ?? d.overflow ?? 0) > 0 || /overflow/iu.test(message);
    return MEASURED.has(measurement) && overflow ? 'true_overflow' : 'unverified_capacity';
  }
  return 'planning';
}

/** Advisory only (decision 2026-10-21): summaries in the latest candidate
 * that dropped numbers, units, years or citations from their source. It is
 * recorded in the failure trace and never blocks or repairs anything. */
export function compressionAdvisory(project = {}) {
  const selection = project.candidateOutline?.executionPlan?.selection || [];
  const items = new Map((project.originalSourceInventory?.items || project.source?.semantic?.inventory?.items || []).map(item => [item.id, item]));
  const found = [];
  for (const entry of selection) {
    if (entry?.destination !== 'summary' || typeof entry.summaryText !== 'string') continue;
    const missing = mustKeepTokens(items.get(entry.sourceUnitId)?.text || '').filter(token => !entry.summaryText.includes(token));
    if (missing.length) found.push({ sourceUnitId: entry.sourceUnitId, missing: missing.slice(0, 8) });
    if (found.length >= 20) break;
  }
  return found;
}
/** F3: the next ladder rung for a page that does not fit. */
function remedyFor(project = {}, d = {}) {
  const pref = project.planningContract?.pagePreference;
  const authorized = pref ? (pref.mode === 'fixed' ? pref.exact : pref.max) : undefined;
  const native = project.templateFidelity?.mode === 'preserve';
  return nextRemediation({ layoutId: d.layoutId, native, nativeBaselinePt: native ? d.fontSizePt : undefined, fontSizePt: d.fontSizePt,
    pages: project.outline?.length, pagesAuthorized: authorized, continuations: project.planningContract?.generationContinuations,
    editorialSelection: allowsEditorialSelection(project), tried: d.triedRemedies });
}
/** Build the trace stored on project.failure. */
export function failureTrace({ stage, error = {}, project = {}, repairs } = {}) {
  const d = error.details || {};
  const bounds = d.bounds || d.geometry || d.canvas || null;
  const pageIndex = Number.isInteger(d.pageIndex) ? d.pageIndex : Number.isInteger(error.pageIndex) ? error.pageIndex : undefined;
  return clean({
    version: FAILURE_TRACE_VERSION,
    class: classifyFailure(error),
    stage,
    code: error.code || undefined,
    message: String(error.message || error).slice(0, 400),
    step: error.contractStage || error.modelStage || undefined,
    // No named step: the last model call before the failure, as context only.
    afterStep: error.contractStage || error.modelStage ? undefined : error.afterStep,
    pageIndex,
    slideId: d.slideId,
    field: d.field,
    template: clean({ id: project.template, mode: project.templateFidelity?.mode, layoutId: d.layoutId, slot: d.slotId || d.slot || d.nodeRole }),
    available: bounds ? clean({ widthPt: pt(bounds.width), heightPt: pt(bounds.height) }) : undefined,
    font: clean({ family: d.fontFamily, sizePt: d.fontSizePt }),
    height: clean({ estimatedPt: d.estimatedHeightPt, measuredPt: d.measuredHeightPt ?? d.usedHeightPt, overflowPt: d.overflowPt ?? pt(d.overflowEMU) }),
    measurement: d.measurement || error.measurement,
    sourceUnitIds: failureSourceIds(d),
    repairs: (repairs || error.repairs || []).slice(-12).map(r => clean({ pass: r.pass, kind: r.kind, outcome: r.outcome, code: r.code })),
    nextRemedy: ['true_overflow', 'unverified_capacity'].includes(classifyFailure(error)) ? remedyFor(project, d) : undefined,
    advisories: clean({ keepFacts: compressionAdvisory(project) }),
    // O5: why the outline repair loops stopped (budget, oscillation) and what they spent.
    governor: error.repairGovernor ? clean({ stopped: error.repairGovernor.stopped?.reason, used: error.repairGovernor.used, budget: error.repairGovernor.budget, adviseAll: error.repairGovernor.adviseAll, advised: error.repairGovernor.advised }) : undefined,
  });
}

/** F4: record one repair pass and decide whether to stop. A pass whose result
 * is identical, or whose failure matches the previous pass of the same kind
 * that also failed to change the failure, is no progress: stop and keep the
 * checkpoint instead of spending more passes on the same repair. */
export function recordRepairPass(log, { pass, kind, before, after, unchanged = false }) {
  if (unchanged) { log.push({ pass, kind, code: before?.code, outcome: 'unchanged' }); return { stop: true, noProgress: true }; }
  if (!after) { log.push({ pass, kind, outcome: 'accepted' }); return { stop: true, noProgress: false }; }
  const same = failureSignature(after) === failureSignature(before);
  const repeated = same && log.at(-1)?.kind === kind && log.at(-1)?.outcome === 'same_failure';
  log.push({ pass, kind, code: after.code, outcome: same ? 'same_failure' : 'progress' });
  return { stop: repeated, noProgress: repeated };
}
