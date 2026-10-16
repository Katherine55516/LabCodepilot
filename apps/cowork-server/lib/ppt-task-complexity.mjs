/** Content signals decide writing effort; geometry is handled by the renderer. */
export function taskComplexity(project, stage, prompt = '') {
  const slide = (project.outline || []).find(item => stage === `content:${item.id}` || stage.startsWith(`content:${item.id}:`));
  const ids = new Set(slide?.sourceUnitIds || []);
  const inventory=project.source?.semantic?.inventory?.items || [];
  const units = slide ? inventory.filter(item => ids.has(item.id)) : inventory;
  // Global prompts contain bilingual rubrics, JSON schemas and examples of
  // formulas even for a tiny English business source. Those instructions
  // describe the protocol; they must not upgrade the source's difficulty.
  const sourceText=project.source?.text || (project.source?.segments || []).map(segment=>segment.text||'').join('\n') || units.map(item=>item.text||item.content?.text||'').join('\n') || project.prompt;
  const text = slide ? JSON.stringify([slide, ...units]) : sourceText || String(prompt);
  const reasons = [];
  if (/^review:.*:source-witness:\d+$/u.test(stage)) reasons.push('disputed_source_verdict');
  if (/```|\\(?:frac|sum|int|begin)\b|\$[^$\n]+\$|"(?:type|kind)":"(?:code|formula|math)"/iu.test(text)) reasons.push('code_or_formula');
  if(units.some(item=>/code|math|formula|equation/iu.test(item.type||item.kind||'')))reasons.push('structured_code_or_formula');
  if(units.some(item=>/table/iu.test(item.type||'')&&((item.rows?.length||0)>8||item.rows?.some(row=>row.length>4))))reasons.push('table_semantics');
  if(slide?.dependsOn?.length||slide?.requiresSlideIds?.length||!slide&&(project.outline||[]).some(item=>item.dependsOn?.length||item.requiresSlideIds?.length))reasons.push('cross_page_dependency');
  if ((slide?.requiredDetails?.length || 0) > 4 || (slide?.requiredEvidenceIds?.length || 0) > 3) reasons.push('multiple_conditions');
  if ((slide?.sourceArtifactRanges?.length || 0) > 1) reasons.push('table_fragments');
  if (units.some(item => /image|chart|scan/iu.test(item.type || item.kind || ''))||!slide&&project.source?.images?.length) reasons.push('visual_evidence');
  const unitCount=slide?ids.size:units.length;
  if (unitCount > 8 || text.length > 12000) reasons.push('large_scope');
  const languageText=slide?[slide.title,slide.description,slide.focus,...(slide.requiredDetails||[]),...(slide.keyPoints||[]).map(point=>typeof point==='string'?point:point.text),...units.map(item=>item.text||item.content?.text||item.raw||'')].filter(value=>typeof value==='string').join('\n'):text;
  if (/translation:|language.*audit/iu.test(stage) || /[\u3400-\u9fff]/u.test(languageText) && /[A-Za-z]{4}/u.test(languageText)) reasons.push('mixed_language');
  const complex = reasons.some(reason => !['mixed_language','large_scope'].includes(reason));
  return { level: complex ? 'complex' : reasons.length || unitCount > 3 || text.length > 3500 ? 'medium' : 'simple', reasons, slideIds: slide ? [slide.id] : [] };
}

export function taskRole(stage, complexity) {
  if(stage.startsWith('vision:'))return 'vision_reader';
  if (/^review:|audit/iu.test(stage)) return 'critic';
  if (/^planning:language-pairs(?::\d+)?$/iu.test(stage))return 'source_organizer';
  if (/^outline|^planning:|navigation/iu.test(stage)) return 'planner';
  if (/^source|^translation:/iu.test(stage)) return 'source_organizer';
  return complexity.level === 'complex' ? 'writer_reasoning' : complexity.level === 'medium' ? 'writer_standard' : 'writer_fast';
}
