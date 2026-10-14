/** Outline concision, item 5: under the overview contract an outline is
 * condensed before it grows. Order: selected table rows on the slide (full
 * table in speaker notes) → existing layout reassignment → merging underfilled
 * neighbours → only then the existing measured partition. Every candidate is
 * re-assessed by the caller's full gates; a change is kept only if it helps. */
import { selectionConstraints } from './ppt-content-selection.mjs';
import { displayUnits } from './ppt-density-profile.mjs';
import { concisionApplies, concisionCost, presentationBudget } from './ppt-outline-concision.mjs';

const overflowOf = candidate => candidate.rawOutline.slides.reduce((sum, slide) => sum + (slide.densityFit?.predictedOverflow || 0), 0);
const otherIssues = candidate => candidate.issues.filter(issue => issue.code !== 'planned_density_overflow').length;
const inventoryOf = project => project.originalSourceInventory?.items || project.source?.semantic?.inventory?.items || [];
const ledgerApplies = (project, raw) => concisionApplies(project) && project.generationPolicy?.details === 'notes' && raw?.version === 2 && Array.isArray(raw.selection) && raw.selection.length > 0;

/** Condense overflowing pages before any partition: (1) tables show their
 * required rows (conditions, risks, comparison set) plus leading rows up to
 * half; (2) secondary prose cards move to speaker notes, last first, one per
 * page per pass. A pass is kept only when the measured overflow falls under
 * the full gates. Definitions, hard conditions and lists never move (their
 * rules forbid notes); a translation that relied on a moved original keeps
 * its complete text in notes only when its own rule allows that. */
export function condenseOverflowingPages(project, assessed, assess, { passes = 6 } = {}) {
  let current = assessed, changedAny = false;
  if (!ledgerApplies(project, current?.rawOutline)) return null;
  const rules = new Map(selectionConstraints(project).map(rule => [rule.sourceUnitId, rule]));
  const items = new Map(inventoryOf(project).map(item => [item.id, item]));
  for (let pass = 0; pass < passes && overflowOf(current) > 0; pass++) {
    const raw = current.rawOutline;
    let selection = [...raw.selection], changed = 0;
    const movedUnitIds = new Set();
    const moveGroup = id => {
      const item = items.get(id);
      const both = project.generationPolicy?.language?.mode === 'source' && project.generationPolicy.language.body !== 'primary';
      return both && item?.languagePairId ? [...items.values()].filter(other => other.languagePairId === item.languagePairId).map(other => other.id) : [id];
    };
    const set = entry => { selection = [...selection.filter(candidate => candidate.sourceUnitId !== entry.sourceUnitId), entry]; };
    const slides = raw.slides.map((slide, index) => {
      if (!index || !(slide.densityFit?.predictedOverflow > 0)) return slide;
      let next = slide;
      // (1) Tables: selected rows on the slide, complete table in notes.
      for (const id of slide.sourceUnitIds || []) {
        const item = items.get(id), rule = rules.get(id), entry = selection.find(candidate => candidate.sourceUnitId === id);
        if (item?.type !== 'TableBlock' || !rule?.allowedDestinations.includes('summary') || entry && entry.destination !== 'slides') continue;
        if (raw.slides.filter(other => other.sourceUnitIds?.includes(id)).length > 1) continue;
        const data = item.rows.length - 1, required = [...new Set(rule.mandatoryRowIndices || [])].sort((a, b) => a - b);
        const keep = Math.max(required.length, Math.ceil(data / 2), Math.min(data, 2));
        if (keep >= data) continue;
        const rows = [...required];
        for (let row = 1; rows.length < keep && row <= data; row++) if (!rows.includes(row)) rows.push(row);
        set({ sourceUnitId: id, destination: 'summary', rowIndices: rows.sort((a, b) => a - b), reason: 'Capacity: selected rows on the slide; the complete table stays in speaker notes.' });
        const ranges = (next.sourceArtifactRanges || []).filter(ref => ref.sourceUnitId !== id);
        next = { ...next, sourceArtifactRanges: ranges }; if (!ranges.length) delete next.sourceArtifactRanges;
        changed++;
      }
      // (2) One secondary prose card to notes (the last movable one; the page keeps at least one owner).
      const owned = next.sourceUnitIds || [];
      if (owned.length < 2) return next;
      const dependents = id => selection.filter(entry => entry.destination === 'notes' && entry.visibleEquivalentSourceUnitId === id);
      const movable = [...owned].reverse().find(id => {
        const group = moveGroup(id);
        // This local pass neither empties a page nor changes an unrelated
        // page's owners. Cross-page pair consolidation has its own planner.
        if (!group.every(member => owned.includes(member)) || owned.every(member => group.includes(member))) return false;
        return group.every(member => {
          const item = items.get(member), rule = rules.get(member);
          return item && !item.rows && rule?.allowedDestinations.includes('notes') && rule.allowedDestinations.some(d => d === 'slides' || d === 'summary') &&
            dependents(member).every(entry => rules.get(entry.sourceUnitId)?.notesWithoutVisibleEquivalentAllowed);
        });
      });
      if (!movable) return next;
      for (const member of moveGroup(movable)) {
        for (const entry of dependents(member)) { const { visibleEquivalentSourceUnitId, ...rest } = entry; set({ ...rest, reason: 'Capacity: kept in speaker notes with its original.' }); }
        set({ sourceUnitId: member, destination: 'notes', reason: 'Capacity: complete secondary language pair kept in notes (overview contract).' });
        movedUnitIds.add(member);
      }
      changed++;
      return { ...next, sourceUnitIds: owned.filter(id => id !== movable) };
    }).map(slide => ({ ...slide, sourceUnitIds: (slide.sourceUnitIds || []).filter(id => !movedUnitIds.has(id)) }));
    if (!changed) break;
    let revised;
    try { revised = assess(project, { ...raw, slides, selection }); } catch { break; }
    if (!(overflowOf(revised) < overflowOf(current)) || otherIssues(revised) > otherIssues(current)) break;
    current = revised; changedAny = true;
  }
  return changedAny ? current : null;
}
/** Back-compatible name used by the first hook. */
export const condenseOverflowingTables = condenseOverflowingPages;

/** Visible load of one outline page in card units (notes cost nothing). */
export function pageLoad(project, slide, selection = []) {
  const items = new Map(inventoryOf(project).map(item => [item.id, item]));
  return (slide.sourceUnitIds || []).reduce((sum, id) => {
    const item = items.get(id), entry = selection.find(candidate => candidate.sourceUnitId === id);
    if (!item || entry?.destination === 'notes' || item.presentation) return sum;
    if (entry?.destination === 'summary') return sum + displayUnits(entry.summaryText ?? (entry.rowIndices ? [0, ...entry.rowIndices].map(row => item.rows[row].join(' ')).join('\n') : item.text));
    return sum + concisionCost(project, item, displayUnits(item.text));
  }, 0);
}

/** Adjacent content pages that are both under 60% full merge — across section
 * boundaries too — while the deck is above its budget target. Navigation,
 * cover and the closing page are never merged. */
export function mergeUnderfilledPages(project, assessed, assess, { capacity = 671 } = {}) {
  const budget = presentationBudget(project);
  let current = assessed;
  if (!budget || !concisionApplies(project) || current?.rawOutline?.version !== 2) return null;
  let merged = 0;
  for (let pass = 0; pass < 8 && current.rawOutline.slides.length > budget.target; pass++) {
    const raw = current.rawOutline, selection = raw.selection || [];
    // Measured height when available; the card estimate otherwise.
    const fill = raw.slides.map(slide => slide.densityFit?.availableHeight ? slide.densityFit.usedHeight / slide.densityFit.availableHeight : pageLoad(project, slide, selection) / capacity);
    const pairs = [];
    for (let i = 1; i < raw.slides.length - 2; i++) {
      const a = raw.slides[i], b = raw.slides[i + 1];
      if ([a.role, b.role].includes('navigation') || a.titleLocked || b.titleLocked || fill[i] >= .6 || fill[i + 1] >= .6 || fill[i] + fill[i + 1] > .95) continue;
      pairs.push({ i, load: fill[i] + fill[i + 1] });
    }
    let accepted = null;
    for (const { i } of pairs.sort((x, y) => x.load - y.load)) {
      const a = raw.slides[i], b = raw.slides[i + 1], focus = [a.focus, b.focus].filter(Boolean).join('；');
      const combined = { ...a, sourceUnitIds: [...new Set([...(a.sourceUnitIds || []), ...(b.sourceUnitIds || [])])],
        ...(a.sourceArtifactRanges || b.sourceArtifactRanges ? { sourceArtifactRanges: [...(a.sourceArtifactRanges || []), ...(b.sourceArtifactRanges || [])] } : {}),
        ...(a.sourceImageIds || b.sourceImageIds ? { sourceImageIds: [...new Set([...(a.sourceImageIds || []), ...(b.sourceImageIds || [])])] } : {}),
        focus: focus.length <= 360 ? focus : a.focus, mergedFrom: [...(a.mergedFrom || [a.title]), ...(b.mergedFrom || [b.title])] };
      try {
        const revised = assess(project, { ...raw, slides: [...raw.slides.slice(0, i), combined, ...raw.slides.slice(i + 2)] });
        if (revised.rawOutline.slides.length < raw.slides.length && overflowOf(revised) <= overflowOf(current) && otherIssues(revised) <= otherIssues(current)) { accepted = revised; break; }
      } catch { /* this pair cannot be merged under the full gates */ }
    }
    if (!accepted) break;
    current = accepted; merged++;
  }
  return merged ? { ...current, concisionMerges: merged } : null;
}

/** Repair guidance for the overview contract: condense before adding pages. */
export function condenseFirstRule(project) {
  if (!concisionApplies(project)) return '';
  const budget = presentationBudget(project);
  return `Overview contract repair order: (1) move secondary units to speaker notes or use a summary (selected table rows, audited text summary) through the selection ledger; (2) combine with an adjacent related page; (3) only then split into more pages.${budget ? ` Keep the deck at or below ${budget.max} pages.` : ''}`;
}
