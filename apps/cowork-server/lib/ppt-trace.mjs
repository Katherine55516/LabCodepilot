/** Metadata-only stage tracing. Model/sandbox time is not simulated. */
import crypto from 'node:crypto';
export function markPptTime(project, stage) {
  project.trace ||= { ppt_trace_id: crypto.randomUUID(), session_id: project.id,
    workflow: project.inputKind, input_type: project.inputKind, template_id: project.template,
    template_source: project.templateSpec?.kind || 'builtin', template_bytes: project.templateSpec?.bytes || 0,
    page_count: project.pages, model: project.model, cache: {}, timestamps: {} };
  project.trace.cache.template = project.templateCacheHit === undefined ? 'not_applicable' : project.templateCacheHit ? 'hit' : 'miss';
  project.trace.timestamps[stage] ||= new Date().toISOString();
  return project.trace;
}
export function pptTimings(trace) {
  const t = trace?.timestamps || {};
  const seconds = (end, start) => t[end] && t[start] ? (Date.parse(t[end]) - Date.parse(t[start])) / 1000 : null;
  return { TTFP: seconds('t_first_slide_ready', 't_generation_started'),
    Generation: seconds('t_editor_ready', 't_generation_started'), E2E: seconds('t_editor_ready', 't_input_accepted'),
    Export: seconds('t_export_ready', 't_generation_started') };
}
export function traceNode(project, nodeId, status) {
  const trace = markPptTime(project, 't_input_accepted');
  const node = project.dagNodes?.[nodeId];
  trace.stage = nodeId;
  trace.stages ||= {};
  trace.stages[nodeId] = { stage: nodeId, status, start_time: node?.startedAt || null,
    end_time: ['completed','failed'].includes(status) ? node?.completedAt || node?.updatedAt || null : null,
    duration: node?.startedAt && ['completed','failed'].includes(status)
      ? Math.max(0,(Date.parse(node.completedAt || node.updatedAt)-Date.parse(node.startedAt))/1000) : null,
    error: status === 'failed' ? node?.error || 'stage failed' : null };
  if (status === 'running' && nodeId.startsWith('source:')) markPptTime(project, 't_generation_started');
  if (status !== 'completed') return;
  const [kind, target] = nodeId.split(':');
  if (nodeId === 'source') { markPptTime(project, 't_file_parse_done'); markPptTime(project, 't_semantic_parse_done'); }
  if (nodeId === 'outline') { markPptTime(project, 't_outline_ready'); markPptTime(project, 't_story_plan_done'); }
  const ids = project.outline?.map(slide => slide.id) || [];
  if (kind === 'preview' && target) {
    markPptTime(project, 't_first_slide_ready');
    const ready = ids.filter(id => ['done','completed'].includes(project.dagNodes?.[`preview:${id}`]?.status)).length;
    if (ready >= Math.ceil(ids.length / 2)) markPptTime(project, 't_half_deck_ready');
    if (ready === ids.length) markPptTime(project, 't_all_slide_rendered');
  }
  if (kind === 'content' && target && ids.every(id => ['done','completed'].includes(project.dagNodes?.[`content:${id}`]?.status))) markPptTime(project, 't_all_slide_content_ready');
  if (nodeId === 'publish') { markPptTime(project, 't_export_ready'); markPptTime(project, 't_editor_ready'); }
}
