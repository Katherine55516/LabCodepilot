import {mergedTopicTitle} from './ppt-merged-topic.mjs';
export {mergedTopicTitle} from './ppt-merged-topic.mjs';
/** Outline concision, item 5: under the overview contract an outline is
 * condensed before it grows. Order: selected table rows on the slide (full
 * table in speaker notes) → existing layout reassignment → merging underfilled
 * neighbours → only then the existing measured partition. Every candidate is
 * re-assessed by the caller's full gates; a change is kept only if it helps. */
import { selectionConstraints } from './ppt-content-selection.mjs';
import { displayUnits, automaticPages } from './ppt-density-profile.mjs';
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
export async function condenseOverflowingPages(project, assessed, assess, { passes = 6 } = {}) {
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
    try { revised = await assess(project, { ...raw, slides, selection }); } catch { break; }
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

/** A thin content page can merge with an adjacent content page — across section
 * boundaries too — while the deck is above its budget target. Navigation,
 * cover and the closing page are never merged. */
export async function mergeUnderfilledPages(project, assessed, assess, { capacity = 671, low = .6, ignoreBudget = false } = {}) {
  const budget = presentationBudget(project);
  let current = assessed;
  // Keeping every source fact does not require one sparse page per heading.
  // Full-source candidates may merge before confirmation; the full assessment
  // still checks ownership, every source item and the complete measured fit.
  // Explicit page counts, confirmed plans and update/import decks stay frozen.
  const completeSource = project?.generationPolicy?.content === 'full_source' && automaticPages(project);
  if (!budget && !ignoreBudget || !(concisionApplies(project) || completeSource) || current?.rawOutline?.version !== 2) return null;
  let merged = 0;
  // Thin-page merging never goes below about one content page per two major
  // sections (the estimate's floor); budget merging stops at the target.
  const floor = ignoreBudget ? (budget ? Math.min(budget.max, 1 + budget.contentPages) : 3) : budget.target;
  for (let pass = 0; pass < 8 && current.rawOutline.slides.length > floor; pass++) {
    const raw = current.rawOutline, selection = raw.selection || [];
    // Measured height when available; the card estimate otherwise.
    const fill = raw.slides.map(slide => slide.densityFit?.availableHeight ? slide.densityFit.usedHeight / slide.densityFit.availableHeight : pageLoad(project, slide, selection) / capacity);
    const pairs = [];
    for (let i = 1; i < raw.slides.length - 2; i++) {
      const a = raw.slides[i], b = raw.slides[i + 1];
      if ([a.role, b.role].includes('navigation') || a.titleLocked || b.titleLocked || Math.min(fill[i],fill[i+1]) >= low) continue;
      // Native and system source layouts can change columns when combined.
      // Adding separate-page heights cannot predict the merged layout.
      // Measure the complete candidate below before rejecting a thin pair.
      pairs.push({ i, load: fill[i] + fill[i + 1] });
    }
    let accepted = null;
    for (const { i } of pairs.sort((x, y) => x.load - y.load)) {
      const a = raw.slides[i], b = raw.slides[i + 1], focus = [a.focus, b.focus].filter(Boolean).join('；');
      const title=mergedTopicTitle(project,a.title,b.title);if(!title)continue;
      const combined = { ...a, sourceUnitIds: [...new Set([...(a.sourceUnitIds || []), ...(b.sourceUnitIds || [])])],
        ...(a.sourceArtifactRanges || b.sourceArtifactRanges ? { sourceArtifactRanges: [...(a.sourceArtifactRanges || []), ...(b.sourceArtifactRanges || [])] } : {}),
        ...(a.sourceImageIds || b.sourceImageIds ? { sourceImageIds: [...new Set([...(a.sourceImageIds || []), ...(b.sourceImageIds || [])])] } : {}),
        focus: focus.length <= 360 ? focus : a.focus, mergedFrom: [...(a.mergedFrom || [a.title]), ...(b.mergedFrom || [b.title])],
        // The merged page names both topics; a title of one topic would
        // misdescribe the other half of the page.
        ...(a.titleLocked || a.title_locked || !b.title || String(a.title).includes(b.title) ? {} : { title }) };
      try {
        const revised = await assess(project, { ...raw, slides: [...raw.slides.slice(0, i), combined, ...raw.slides.slice(i + 2)] });
        if (revised.rawOutline.slides.length < raw.slides.length && overflowOf(revised) <= overflowOf(current) && otherIssues(revised) <= otherIssues(current)) { accepted = revised; break; }
      } catch { /* this pair cannot be merged under the full gates */ }
    }
    if (!accepted) break;
    current = accepted; merged++;
  }
  return merged ? { ...current, concisionMerges: merged } : null;
}

/** Round 7 (A5): a thin content page (measured fill under `low`) first takes
 * back related secondary units of its own section from speaker notes — the
 * reverse of condensing — one unit (or translation pair) per page per pass,
 * kept only when nothing overflows and no other gate gets worse. Remaining thin
 * neighbours are merged by mergeUnderfilledPages. */
export async function enrichUnderfilledPages(project, assessed, assess, { low = .55, passes = 4 } = {}) {
  let current = assessed, changedAny = false;
  if (!ledgerApplies(project, current?.rawOutline)) return null;
  const rules = new Map(selectionConstraints(project).map(rule => [rule.sourceUnitId, rule]));
  const ordered = inventoryOf(project), items = new Map(ordered.map(item => [item.id, item])), position = new Map(ordered.map((item, index) => [item.id, index]));
  const section = id => (items.get(id)?.sectionPath || []).join('\u0000');
  const fillOf = (raw, slide) => slide.densityFit?.availableHeight ? slide.densityFit.usedHeight / slide.densityFit.availableHeight : pageLoad(project, slide, raw.selection || []) / 671;
  for (let pass = 0; pass < passes; pass++) {
    const raw = current.rawOutline;
    let selection = [...raw.selection], changed = 0;
    const taken = new Set();
    const slides = raw.slides.map((slide, index) => {
      if (!index || index === raw.slides.length - 1 || slide.role === 'navigation' || slide.titleLocked || !(slide.sourceUnitIds || []).length || fillOf(raw, slide) >= low || slide.densityFit?.predictedOverflow > 0) return slide;
      const owned = slide.sourceUnitIds, sections = new Set(owned.map(section)), near = Math.min(...owned.map(id => position.get(id) ?? Infinity));
      const candidates = selection.filter(entry => entry.destination === 'notes' && !entry.visibleEquivalentSourceUnitId && !taken.has(entry.sourceUnitId)
        && sections.has(section(entry.sourceUnitId)) && rules.get(entry.sourceUnitId)?.allowedDestinations.includes('slides') && !items.get(entry.sourceUnitId)?.rows
        && items.get(entry.sourceUnitId)?.type !== 'CodeBlock' && !raw.slides.some(other => other.sourceUnitIds?.includes(entry.sourceUnitId)))
        .sort((a, b) => Math.abs((position.get(a.sourceUnitId) ?? 0) - near) - Math.abs((position.get(b.sourceUnitId) ?? 0) - near));
      const pick = candidates[0];
      if (!pick) return slide;
      const pair = items.get(pick.sourceUnitId)?.languagePairId, both = project.generationPolicy?.language?.body !== 'primary';
      const group = pair && both ? ordered.filter(item => item.languagePairId === pair).map(item => item.id) : [pick.sourceUnitId];
      if (group.some(id => selection.find(entry => entry.sourceUnitId === id)?.destination !== 'notes')) return slide;
      for (const id of group) { taken.add(id); selection = selection.map(entry => entry.sourceUnitId === id ? { sourceUnitId: id, destination: 'slides', reason: 'Fill: related point of this section returned from speaker notes.' } : entry); }
      changed++;
      return { ...slide, sourceUnitIds: [...owned, ...group].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0)) };
    });
    if (!changed) break;
    let revised;
    try { revised = await assess(project, { ...raw, slides, selection }); } catch { break; }
    if (overflowOf(revised) > overflowOf(current) || otherIssues(revised) > otherIssues(current)) break;
    current = { ...revised, enrichedPages: (current.enrichedPages || 0) + changed }; changedAny = true;
  }
  return changedAny ? current : null;
}

/** Repair guidance for the overview contract: condense before adding pages. */
export function condenseFirstRule(project) {
  if (!concisionApplies(project)) return '';
  const budget = presentationBudget(project);
  return `Overview contract repair order: (1) move secondary units to speaker notes or use a summary (selected table rows, audited text summary) through the selection ledger; (2) combine with an adjacent related page; (3) only then split into more pages.${budget ? ` Keep the deck at or below ${budget.max} pages.` : ''}`;
}
