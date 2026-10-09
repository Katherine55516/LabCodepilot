/** Bounded, traceable grouping and physical fit inside estimate/outline nodes.
 * Initial source projections are estimates of writing cost, not emitted copy. */
import { densityProfile, densityText, displayUnits, automaticPages } from './ppt-density-profile.mjs';
import { contentCanvas, fitComponents, measureComponent, sourceComponent, sourceImageComponents, isSourceArtifactItem, validateSourceArtifactRefs, INCH } from './ppt-density-capacity.mjs';
import { copyKey } from './ppt-copy-integrity.mjs';
const unique = list => [...new Set(list.filter(Boolean))];
function uniquePoints(points) {
  const map=new Map();
  for(const point of points||[]) {
    const key=copyKey(point.text||point);if(!key)continue;
    if(map.has(key) && typeof point==='object') {
      const first=map.get(key);first.refs=unique([...(first.refs||[]),...(point.refs||[])]);first.chunkRefs=unique([...(first.chunkRefs||[]),...(point.chunkRefs||[])]);
    } else if(!map.has(key))map.set(key,typeof point==='object'?{...point}:point);
  }
  return [...map.values()];
}
const clampPages = n => Math.max(3, Math.min(100, Math.ceil(n)));
export function pageCapacity(project = {}, index = 1) {
  const { geometry, fontSizePt, capacityBasis } = contentCanvas(project, index);
  const lineUnits = geometry.width / INCH * 72 / fontSizePt * .88;
  const physicalUnits = lineUnits * geometry.height / INCH * 72 / (fontSizePt * 1.18);
  return { ...densityProfile().bodyVisualUnits, low: Math.min(densityProfile().bodyVisualUnits.low, physicalUnits * .80), high: Math.min(densityProfile().bodyVisualUnits.high, physicalUnits * .98),
    target: Math.min(densityProfile().bodyVisualUnits.target, physicalUnits * .95), physicalUnits, fontSizePt, geometry, capacityBasis };
}
function projection(item, detail) {
  const units = displayUnits(item.text);
  if (item.must_preserve_structure || ['SummaryBlock', 'ExampleBlock'].includes(item.type)) return units;
  // Source-dependent synthesis cost: preserve distinct relationships rather
  // than budgeting every paragraph as the same shallow 65/95-unit summary.
  // This is an estimate, never a word minimum or authority to discard facts.
  const anchors=(item.text.match(/\d+(?:\.\d+)?|\b(?:if|unless|because|therefore|however|when|before|after)\b|假设|条件|因此|但是|只有|除非|不(?:得|能|适用)/giu)||[]).length;
  const retained=units*(detail==='detailed'?.8:.6);
  return Math.min(units,Math.max(retained,Math.min(units,anchors*18)));

}
function sectionOf(item) { return (item.sectionPath || []).slice(0, 2).join(' / '); }
export function sourceDensityPlan(source, project = {}) {
  const inventory = source?.semantic?.inventory;
  if (!inventory?.items?.length) return null;
  const profile = densityProfile(), capacity = pageCapacity(project);
  const detail = project.generationPolicy?.detail || 'balanced';
  const groups = [], seen = new Map();
  for (const item of inventory.items) {
    // Policy-omitted or merged-equivalent items are disclosed in the planning
    // assumptions and do not occupy slide space.
    if (item.presentation) continue;
    const text = densityText(item.text), prev = groups.at(-1);
    const key = text.replace(/\s+/gu, ' ').trim();
    const duplicate = !item.must_preserve_structure && seen.get(key);
    if (duplicate) {
      duplicate.sourceUnitIds.push(item.id); duplicate.chunkRefs.push(...item.chunkRefs); duplicate.refs.push(...item.source_ref);
      duplicate.relations.push('exact_repeated_claim'); continue;
    }
    let units = projection(item, detail);
    if(item.must_preserve_structure){
      const measured=measureComponent(sourceComponent(item),capacity.geometry,capacity.fontSizePt);
      units=Math.max(units,measured.height/Math.max(1,capacity.geometry.height)*capacity.target);
    }
    // A detected language pair is one claim; the output language follows the
    // input, so both languages keep their display cost and source IDs. Plain
    // language alternation without a detected pair stays a candidate only.
    const detectedPair = Boolean(prev && item.languagePairId && prev.lastPairId === item.languagePairId);
    const translationPair = detectedPair || prev && sectionOf(item) === prev.section && prev.types.includes(item.type) &&
      /\p{Script=Han}/u.test(text) !== /\p{Script=Han}/u.test(prev.lastText);
    const connected = prev && sectionOf(item) === prev.section && (detectedPair || prev.estimatedVisibleUnits + units <= capacity.target);
    const relation = detectedPair ? 'translation_pair' : translationPair ? 'possible_translation_pair' : connected ? 'same_source_context' : null;
    if (connected) {
      prev.sourceUnitIds.push(item.id); prev.chunkRefs.push(...item.chunkRefs); prev.refs.push(...item.source_ref);
      prev.estimatedVisibleUnits += units; prev.types.push(item.type); prev.lastText = text; prev.lastPairId = item.languagePairId || null;
      if (relation) prev.relations.push(relation);
    } else groups.push({ groupId: `density_${groups.length + 1}`, section: sectionOf(item), sourceUnitIds: [item.id],
      readerQuestion: item.sectionPath?.at(-1) || item.semanticRole, chunkRefs: [...item.chunkRefs], refs: [...item.source_ref],
      estimatedVisibleUnits: units, types: [item.type], lastText: text, lastPairId: item.languagePairId || null, relations: [],
      estimateBasis: 'source_display_projection', provisional: true });
    if (!item.must_preserve_structure) seen.set(key, groups.at(-1));
  }
  const totalUnits = groups.reduce((n, g) => n + g.estimatedVisibleUnits, 0);
  // Chapters impose no page floor. Roles/relations and fit are refined by the
  // planner; a global load gives the provisional budget without ceil per heading.
  const recommended = clampPages(1 + totalUnits / capacity.target);
  const min = clampPages(1 + totalUnits / capacity.high), max = clampPages(1 + totalUnits / Math.max(1, capacity.low));
  const sectionMap = new Map();
  for (const g of groups) {
    const s = sectionMap.get(g.section) || { title: g.section.split(' / ').at(-1), chunkIds: [], sourceTokens: 0, contentCost: 0, objects: [], slides: 0 };
    s.chunkIds.push(...g.chunkRefs); s.contentCost += g.estimatedVisibleUnits;
    s.objects.push(...g.types.filter(t => /Table|Code|Equation|Process|Checklist/.test(t)));
    sectionMap.set(g.section, s);
  }
  const sections = [...sectionMap.values()].map(s => ({ ...s, chunkIds: unique(s.chunkIds), objects: unique(s.objects),
    contentCost: Math.round(s.contentCost), sourceTokens: (source.semantic.chunks || []).filter(c => s.chunkIds.includes(c.id)).reduce((n, c) => n + (c.tokenCount || 0), 0),
    // Fractional allocation is a planning hint, not one-page chapter entitlement.
    slides: Math.round(s.contentCost / capacity.target * 100) / 100 }));
  return { version: 1, densityProfileId: profile.id, recommended, range: [Math.min(min, recommended), Math.max(max, recommended)],
    selected: project.pages || recommended, bodyPages: (project.pages || recommended) - 1,
    languagePairs: new Set(inventory.items.map(item => item.languagePairId).filter(Boolean)).size,
    policyOmitted: inventory.items.filter(item => item.presentation).map(item => ({ sourceUnitId: item.id, type: item.type, presentation: item.presentation, basis: item.presentationBasis || '' })),
    contentCost: Math.round(totalUnits), costUnit: 'projected_display_visual_units', sections, groups: groups.map(({ lastText, lastPairId, ...g }) => ({ ...g, chunkRefs: unique(g.chunkRefs), refs: unique(g.refs) })),
    compactSections: sections.filter(s => s.slides < 1).map(s => s.title), preservedObjects: unique(sections.flatMap(s => s.objects)),
    sourceTokens: (source.semantic.chunks || []).reduce((n, c) => n + (c.tokenCount || 0), 0),
    compressionRatio: Math.round(totalUnits / (Math.max(1, (project.pages || recommended) - 1) * capacity.target) * 100) / 100,
    capacity, capacityBasis: capacity.capacityBasis, provisional: true };
}
function related(a, b) {
  if (a.question && b.question && a.question !== b.question) return false;
  if (a.question && a.question === b.question || a.groupId && a.groupId === b.groupId) return true;
  const aa = new Set(a.chunkRefs || []);
  return (b.chunkRefs || []).some(id => aa.has(id)) || a.section && a.section === b.section;
}
export function candidateFit(slide, project, index = 1) {
  const items = project.source?.semantic?.inventory?.items || [];
  const owned = Array.isArray(slide.sourceUnitIds) ? slide.sourceUnitIds : items.filter(item => isSourceArtifactItem(item) && item.chunkRefs.some(id => slide.chunkRefs?.includes(id))).map(item => item.id);
  const ranges = Array.isArray(slide.sourceArtifactRanges) ? slide.sourceArtifactRanges : [];
  const components = items.filter(item => owned.includes(item.id) && isSourceArtifactItem(item)).flatMap(item => {
    const assigned = ranges.filter(ref => ref.sourceUnitId === item.id);
    return assigned.length ? assigned.map(ref => sourceComponent(item, ref)) : [sourceComponent(item)];
  });
  for(const id of slide.sourceImageIds||[]){
    const image=project.source?.images?.find(image=>image.id===id);if(!image)throw new Error('unknown source image');
    components.push(...sourceImageComponents(image));
  }
  for(const point of uniquePoints(slide.keyPoints))for(const text of point.text.split(/\n\s*\n/u).filter(part=>part.trim()))
    components.push({type:'text',content:{text}});
  const fit = components.length ? fitComponents(components, project, index) : null;
  const plannedUnits = components.reduce((n, c) => n + displayUnits(c.content.displayText || c.content.text || c.content.rows?.flat().join(' ') || c.content.items?.map(i => i.text).join('\n')), 0);
  const capacity = pageCapacity(project, index);
  return { sourceUnitIds: owned, plannedVisibleUnits: plannedUnits, densityProfileId: densityProfile().id,
    predictedOverflow: fit?.predictedOverflow || 0, capacity_ok: Boolean(fit?.capacity_ok),
    layoutId: fit?.layoutId || 'unmeasured', fontSizePt: fit?.fontSizePt || capacity.fontSizePt,
    availableContentRect:fit?.canvas||capacity.geometry,capacityBasis:fit?.capacityBasis||capacity.capacityBasis,
    targetVisualUnits: capacity.target, maximumVisualUnits: capacity.high, measurementBasis: fit?.measurementBasis || 'missing_display_plan' };
}
function mergedTableRanges(a,b,items) {
  const result=[];
  for(const item of items.filter(item=>item.type==='TableBlock')){
    const selections=[a,b].flatMap(slide=>{
      if(!(slide.sourceUnitIds||slide.densityFit?.sourceUnitIds||[]).includes(item.id))return [];
      const ranges=(slide.sourceArtifactRanges||[]).filter(ref=>ref.sourceUnitId===item.id);
      return (ranges.length?ranges:[{sourceUnitId:item.id}]).map(ref=>({sourceUnitId:item.id,rowStart:ref.rowStart??1,rowEnd:ref.rowEnd??item.rows.length}));
    }).sort((a,b)=>a.rowStart-b.rowStart);
    const combined=[];
    for(const ref of selections){const previous=combined.at(-1);if(previous && ref.rowStart<=previous.rowEnd)previous.rowEnd=Math.max(previous.rowEnd,ref.rowEnd);else combined.push({...ref});}
    result.push(...combined);
  }
  return result;
}
export function packOutline(project, raw) {
  if (!Array.isArray(raw?.slides) || raw.slides.length < 3 || raw.slides.length > 100) throw new Error('outline must contain 3–100 candidate pages');
  const items = project.source?.semantic?.inventory?.items || [];
  const ids = new Set(items.map(i => i.id));
  const candidates = raw.slides.map(s => {
    if(!s||typeof s!=='object')throw new Error('invalid outline candidate');
    if (s.sourceUnitIds!==undefined && (!Array.isArray(s.sourceUnitIds) || s.sourceUnitIds.some(id => !ids.has(id)))) throw new Error('unknown source unit in group plan');
    if (s.sourceArtifactRanges && (!Array.isArray(s.sourceArtifactRanges) || s.sourceArtifactRanges.some(ref => !ids.has(ref?.sourceUnitId) || !s.sourceUnitIds?.includes(ref.sourceUnitId)))) throw new Error('invalid source artifact range assignment');
    if(s.sourceArtifactRanges!==undefined)validateSourceArtifactRefs(items,s.sourceArtifactRanges);
    // Source ownership supplies genuine refs, never fabricate or drop citations.
    const owned = items.filter(i => s.sourceUnitIds?.includes(i.id));
    return { ...s, keyPoints:uniquePoints(s.keyPoints), refs: unique([...(s.refs || []), ...owned.flatMap(i => i.source_ref)]), chunkRefs: unique([...(s.chunkRefs || []), ...owned.flatMap(i => i.chunkRefs)]) };
  });
  const auto = automaticPages(project), slides = [];
  for (let index = 0; index < candidates.length; index++) {
    const s = candidates[index], previous = slides.at(-1);
    const fit = candidateFit(s, project, slides.length);
    // Code only combines a documented common question/source context, with
    // measured copy, no locked user titles, and within the visible density budget.
    if (auto && index > 1 && index < candidates.length - 1 && previous && !previous.titleLocked && !previous.title_locked && !s.titleLocked && !s.title_locked && related(previous, s)) {
      const merged = { ...previous, sourceArtifactRanges: mergedTableRanges(previous,{...s,densityFit:fit},items), sourceUnitIds: unique([...(previous.densityFit?.sourceUnitIds || []), ...fit.sourceUnitIds]),
        sourceImageIds:unique([...(previous.sourceImageIds||[]),...(s.sourceImageIds||[])]),
        refs: unique([...previous.refs, ...s.refs]), chunkRefs: unique([...previous.chunkRefs, ...s.chunkRefs]),
        keyPoints: uniquePoints([...(previous.keyPoints || []), ...(s.keyPoints || [])]),
        requiredDetails: unique([...(previous.requiredDetails || []), ...(s.requiredDetails || [])]),
        requiredEvidenceIds: unique([...(previous.requiredEvidenceIds || []), ...(s.requiredEvidenceIds || [])]),
        supportingPoints: unique([...(previous.supportingPoints || []), ...(s.supportingPoints || [])]),
        requiredSupport: unique([...(previous.requiredSupport || previous.required_support || []), ...(s.requiredSupport || s.required_support || [])]),
        claimIds: unique([...(previous.claimIds || []), ...(s.claimIds || [])]),
        sourceTopics: unique([...(previous.sourceTopics || []), ...(s.sourceTopics || [])]),
        children: [...(previous.children || []), ...(s.children || [])], transitionToNext: s.transitionToNext,
        focus: [previous.focus, s.focus].filter(Boolean).join(' '), packedFrom: [...(previous.packedFrom || [previous.id || String(index - 1)]), s.id || String(index)] };
      const mf = candidateFit(merged, project, slides.length - 1);
      if (merged.keyPoints.length <= 10 && merged.supportingPoints.length <= 6 && merged.requiredSupport.length <= 6 && merged.claimIds.length <= 8 && merged.sourceTopics.length <= 8 && merged.children.length <= 12 && merged.focus.length <= 360 && merged.requiredDetails.length <= 10 && merged.requiredEvidenceIds.length <= 6 &&
          fit.plannedVisibleUnits > 0 && previous.densityFit?.plannedVisibleUnits > 0 && mf.capacity_ok && mf.plannedVisibleUnits <= mf.maximumVisualUnits && items.filter(item => mf.sourceUnitIds.includes(item.id) && isSourceArtifactItem(item)).length <= 10) {
        slides[slides.length - 1] = { ...merged, densityFit: mf }; continue;
      }
    }
    slides.push({ ...s, densityFit: fit });
  }
  return { ...raw, slides, densityPacking: { version: 1, densityProfileId: densityProfile().id,
    initialPageCount: project.pages, candidatePageCount: candidates.length, finalPageCount: slides.length,
    automatic: auto, mergeCount: candidates.length - slides.length, fits: slides.map(s => s.densityFit) } };
}
export function revalidateOutlineFits(project, raw, outline=raw.slides) {
  const fits=outline.map((slide,index)=>candidateFit(slide,project,index));
  return {...raw,slides:raw.slides.map((slide,index)=>({...slide,densityFit:fits[index]})),
    densityPacking:{...raw.densityPacking,finalPageCount:outline.length,fits,templateAssignmentValidated:Boolean(project.templateFidelity?.mode==='preserve'),
      templateSlideMap:project.templateFidelity?.slideMap||null}};
}
export function inspectDensityOutline(raw,project) {
  const issues=(raw.slides || []).slice(1).flatMap(s => s.densityFit?.predictedOverflow > 0 ? [{ code: 'planned_density_overflow', repairable: true,
    message: `Candidate ${s.title} exceeds measured ${s.densityFit.fontSizePt}pt capacity; split the owned structures/relations without deleting cells or facts` }] : []);
  for(const item of project?.source?.semantic?.inventory?.items||[])if(isSourceArtifactItem(item)){
    const assigned=(raw.slides||[]).filter(slide=>(slide.sourceUnitIds||slide.densityFit?.sourceUnitIds||[]).includes(item.id));
    if(item.type!=='TableBlock'&&assigned.filter(slide=>!['recap','application','translation'].includes(slide.repeatPurpose)).length>1)
      issues.push({code:'planned_source_object_duplicate',repairable:true,message:`Required object ${item.id} has several primary assignments. Assign one owner; use references or declared recap/application for later pages.`});
    let complete=assigned.length>0;
    if(complete&&item.type==='TableBlock'){
      const rows=new Set();
      for(const slide of assigned){const selections=slide.sourceArtifactRanges?.filter(ref=>ref.sourceUnitId===item.id);for(const ref of selections?.length?selections:[{}])for(let row=ref.rowStart??1;row<(ref.rowEnd??item.rows.length);row++)rows.add(row);}
      complete=rows.size===item.rows.length-1;
    }
    if(!complete)issues.push({code:'planned_source_object_missing',repairable:true,message:`Required object ${item.id} (${item.type}) needs complete ownership including all rows/columns and tail summaries.`});
  }
  for(const image of project?.source?.images||[])if((image.required||image.mustPreserve)&&!raw.slides?.some(slide=>slide.sourceImageIds?.includes(image.id)))issues.push({code:'planned_source_media_missing',repairable:true,message:`Required source image ${image.id} needs a visible sourceImageIds assignment and capacity budget.`});
  return issues;
}
