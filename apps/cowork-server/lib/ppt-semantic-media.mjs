/** Unlabelled rectangles/arrows are decorative patterns, not source media.
 * Semantic diagrams are emitted as source-owned, editable objects with complete
 * labels/relationships. They must never be raster placeholders counted as facts.
 * Keep the legacy adapter API for callers; absence falls back to native artwork.
 */
export function semanticMediaForSlide() { return null; }
