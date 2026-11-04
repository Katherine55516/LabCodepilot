import {effectivePageRole} from './ppt-page-semantics.mjs';
/** Observed visible copy, not allocated rectangle area or hidden draft text. */
import { densityProfile, actualTextChars, displayUnits } from './ppt-density-profile.mjs';
import { pageCapacity } from './ppt-density-packing.mjs';
import { fitComponents } from './ppt-density-capacity.mjs';
import { visibleNodes } from './ppt-visible-content.mjs';
import { equationContent } from './ppt-math.mjs';
import { uniqueCopyText } from './ppt-copy-integrity.mjs';
export function densityComponents(slide) {
  const nodes = visibleNodes(slide).filter(node =>
    !['title','eyebrow','section','page-number','footnote'].includes(node.semanticRole) &&
    (!node.nativeRef || node.templateSlot?.role === 'content') && !['footnote','group-heading'].includes(node.templateSlot?.purpose));
  const visible = nodes.filter(node => node.content?.text || node.content?.rows || node.content?.items);
  if (visible.length) return visible.map(node => ({ type: node.type, content: node.content, fontSizePt:node.style?.fontSizePt||node.content?.pointLayout?.fontSizePt }));
  // Canonical nodes, when present, are authoritative even if all were hidden.
  if (slide.nodes?.length) return [];
  return [{ type: 'text', content: { text: (slide.copy?.blocks || []).map(b => `${b.heading || ''} ${b.body || ''}`).join('\n') || (slide.bullets || []).join('\n') } }];
}
const componentText = c => (c.content.mathMl ? equationContent(c.content.mathText || c.content.text).displayText : '') || c.content.text || c.content.rows?.flat().join(' ') || c.content.items?.map(i => i.text || i.body || '').join('\n') || '';
export function inspectDensity(project, slides) {
  const measurements = slides.map((slide, index) => {
    const components = densityComponents(slide), texts = components.map(componentText), text = texts.join('\n');
    const uniqueText=uniqueCopyText(texts);
    const visualNodes=visibleNodes(slide).filter(node=>['image','chart','table','timeline'].includes(node.type)||node.content?.mathMl||node.content?.diagram||node.content?.processCards);
    const canvasArea=Number(project.templateFidelity?.width || project.templateSpec?.width || 12192000)*Number(project.templateFidelity?.height || project.templateSpec?.height || 6858000);
    const meaningfulMedia=visualNodes.filter(n=>n.sourceArtifact||n.content?.diagram||n.content?.processCards||n.content?.evidenceSourceUnitIds?.length);
    const mediaArea=n=>(n.geometry?.width||0)*(n.geometry?.height||0)*(n.content?.pointLayout?.boxes?.length?Math.min(1,n.content.pointLayout.boxes.reduce((sum,b)=>sum+b.w*b.h,0)):1);
    const explanatoryMediaOccupancy=Math.min(1,meaningfulMedia.reduce((sum,n)=>sum+mediaArea(n),0)/canvasArea);
    const decorativeMediaOccupancy=Math.min(1,visualNodes.filter(n=>!meaningfulMedia.includes(n)).reduce((sum,n)=>sum+mediaArea(n),0)/canvasArea);
    const mediaOccupancy=Math.min(1,visualNodes.reduce((sum,node)=>sum+(node.geometry?.width||0)*(node.geometry?.height||0),0)/canvasArea);
    const cap = pageCapacity(project, index), plan = project.planning?.slidePlan?.find(p => p.slideId === slide.id);
    return { slideId: slide.id, role: effectivePageRole(project,slide,index), actualTextChars: actualTextChars(text),
      visibleVisualUnits: displayUnits(text), mediaOccupancy,explanatoryMediaOccupancy,decorativeMediaOccupancy, visibleStructuredObjects:visualNodes.length, referenceTargetVisualUnits: cap.target*(project.generationPolicy?.detail==='concise'?.6:1),
      rawVisibleUnits:displayUnits(text),uniqueInformationUnits:displayUnits(uniqueText),
      duplicateDisplayUnits:Math.max(0,displayUnits(text)-displayUnits(uniqueText)),
      densityRatio: Math.round(displayUnits(uniqueText) / cap.target * 100) / 100, measurementBasis: 'unique_visible_content', components };
  });
  const rich = (project.source?.text?.length || 0) >= 8000 || project.inputProfile?.level === 'rich';
  const eligible=measurements.filter((m,i)=>i>0&&!['cover','section','closing'].includes(m.role));
  const underfilled = rich ? eligible.filter(m=>m.uniqueInformationUnits < m.referenceTargetVisualUnits*.6 && m.explanatoryMediaOccupancy<.35 && !m.components.some(c=>c.content?.mathMl)) : [];
  const issues = underfilled.map(m => ({ code: 'gamma_density_underfill', severity: 'warning', slideId: m.slideId, repairable: false,
    message: `Distinct visible copy has ${Math.round(m.uniqueInformationUnits)} width units vs reference target ${Math.round(m.referenceTargetVisualUnits)}; consolidate connected content or explain a source/readability constraint. Never repeat claims or invent facts to fill space.` }));
  const merges = [];
  const graph = project.source?.semantic?.graph || [];
  // Include non-adjacent related pages, bounded by the deck's 100-page limit.
  for (let i = 1; i < slides.length; i++) for (let j = i + 1; j < slides.length; j++) {
    const a = project.outline?.find(s => s.id === slides[i].id), b = project.outline?.find(s => s.id === slides[j].id);
    if(!measurements[i].components.length||!measurements[j].components.length)continue;
    const sameQuestion = Boolean(a?.question && a.question === b?.question);
    const shared = a?.chunkRefs?.some(id => b?.chunkRefs?.includes(id));
    const connected = graph.some(e => a?.chunkRefs?.includes(e.from) && b?.chunkRefs?.includes(e.to) && ['contrasts_with','same_question','supports','depends_on'].includes(e.relation));
    const relatedObligation=(project.planning?.editorialBlueprint?.pages||[]).filter(p=>[a?.id,b?.id].includes(p.slideId)).flatMap(p=>p.explanationObligations||[]).some(o=>o.sourceUnitIds.some(id=>a?.sourceUnitIds?.includes(id))&&o.sourceUnitIds.some(id=>b?.sourceUnitIds?.includes(id)));
    if (!sameQuestion && !shared && !connected&&!relatedObligation) continue;
    if (measurements[i].visibleVisualUnits + measurements[j].visibleVisualUnits > pageCapacity(project, i).high) continue;
    const fit = fitComponents([...measurements[i].components, ...measurements[j].components], project, i);
    if (fit.capacity_ok) merges.push({ slideIds: [slides[i].id, slides[j].id], layoutId: fit.layoutId, fontSizePt: fit.fontSizePt,
      predictedOverflow: fit.predictedOverflow, reason: sameQuestion ? 'same_reader_question' : shared ? 'shared_source' : 'source_relationship',
      action: 'structure_proposal_after_confirmation' });
  }
  for (const candidate of merges.slice(0, 12)) issues.push({ code: 'gamma_density_merge_candidate', severity: 'warning', slideId: candidate.slideIds[0],
    repairable: false, message: `Related pages ${candidate.slideIds.join(', ')} fit together at ${candidate.fontSizePt}pt. Offer a structure proposal; preserve confirmed counts until accepted.` });
  return { issues, metrics: { densityProfileId: densityProfile().id,
    visibleDensityPerSlide: measurements.map(({ components, ...m }) => m), densityUnderfillRate: eligible.length ? underfilled.length / eligible.length : 0,
    densityMergeCandidates: merges } };
}
