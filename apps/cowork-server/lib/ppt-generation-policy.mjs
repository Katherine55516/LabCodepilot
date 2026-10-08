/** Versioned, optional policy. Missing fields deliberately preserve legacy decks. */
export const PPT_PROMPT_CONTRACT_VERSION = 4;
export function normalizeGenerationPolicy(value) {
  if (value === undefined) return undefined;
  if (!value || value.version !== 1 || !['balanced', 'detailed'].includes(value.detail)
    || value.language?.mode !== 'source' || !['source_only', 'source_plus_explanation'].includes(value.knowledge)) {
    const error = new Error('invalid generation policy'); error.statusCode = 400; throw error;
  }
  return { version: 1, detail: value.detail, language: { mode: 'source' }, knowledge: value.knowledge };
}
export function effectiveKnowledge(project) {
  return project.generationPolicy?.knowledge || (project.source?.segments?.length || project.update ? 'source_only' : 'source_plus_explanation');
}
export function requestedPageCount(...inputs) {
  for (const input of inputs) {
    const match = String(input || '').match(/(?:^|[^第\d])(\d{1,3})\s*(?:页|slides?)(?!\w)/iu);
    if (match) return Math.max(3, Math.min(100, Number(match[1])));
  }
}
