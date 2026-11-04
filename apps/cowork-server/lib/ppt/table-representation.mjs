/** A source table on a page is shown as the original table or as cards (Fable
 * plan T5). Switching rebinds the page from its own sources and keeps its own
 * explanations and evidence; it never calls a writer. It runs as the command
 * slide.setTableRepresentation, so undo restores the page snapshot and the
 * page's generation epoch moves (integration plan step 5, from the
 * representation contract of codex/ppt-gamma-factor-zoo-20261020). */
import {bindSourceArtifacts} from '../ppt-source-artifacts.mjs';
import {chooseLayout} from '../ppt-layout.mjs';

/** Version of the recorded choice on a source artifact. */
export const TABLE_REPRESENTATION_VERSION = 1;
export const TABLE_REPRESENTATIONS = Object.freeze(['table', 'diagram']);

class RepresentationError extends Error {
  constructor(message, statusCode, code) { super(message); this.statusCode = statusCode; this.code = code; }
}

/** The page as the binder sees it: the other pages as written, this one with its layout. */
function bindingProject(project, slide, index) {
  return { ...project, deck: { ...(project.deck || {}), slides: project.outline.map((entry, i) => i === index ? { ...slide, layoutId: chooseLayout(slide, i, project.outline.length) } : project.deck?.slides?.[i] || entry) } };
}

/** Rebinds `slide` (at `index` of `project`) with `sourceUnitId` in `representation`, in place. */
export function switchTableRepresentation(project, slide, index, sourceUnitId, representation) {
  const form = representation === 'table' ? 'table' : 'diagram', sourceNodes = slide.sourceArtifactNodes || [];
  if (!sourceNodes.some(item => item.sourceArtifact?.sourceUnitId === sourceUnitId)) throw new RepresentationError('this page does not show that source table', 400, 'representation_not_on_page');
  const refs = [...new Map(sourceNodes.filter(item => item.sourceArtifact).map(item => {
    const { sourceUnitId: id, rowStart, rowEnd, lineStart, lineEnd, tableRepresentation } = item.sourceArtifact;
    const chosen = id === sourceUnitId ? form : tableRepresentation;
    return { sourceUnitId: id, ...(rowStart !== undefined ? { rowStart, rowEnd } : {}), ...(lineStart !== undefined ? { lineStart, lineEnd } : {}), ...(chosen === 'table' ? { tableRepresentation: 'table' } : {}) };
  }).map(ref => [JSON.stringify(ref), ref])).values()];
  const evidenceIds = [...new Set(sourceNodes.flatMap(item => item.content?.sourceEvidenceIds || []))];
  const commentary = sourceNodes.filter(item => !item.sourceArtifact && !item.content?.derivedFrom && !item.content?.sourceEvidenceIds?.length)
    .map(item => ({ type: item.content?.pointType || 'mechanism', text: item.content?.rawText || item.content?.text || '' })).filter(entry => entry.text);
  try { bindSourceArtifacts(bindingProject(project, slide, index), slide, refs, index, commentary, evidenceIds); }
  catch (error) { if (/^source_artifact_capacity:/u.test(String(error.message))) throw new RepresentationError('The table does not fit this page in that form', 409, 'representation_capacity'); throw error; }
  for (const item of slide.sourceArtifactNodes || []) if (item.sourceArtifact?.sourceUnitId === sourceUnitId)
    item.sourceArtifact = { ...item.sourceArtifact, tableRepresentation: form, representationVersion: TABLE_REPRESENTATION_VERSION, representationBasis: 'user' };
  return slide;
}
