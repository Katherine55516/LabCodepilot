/**
 * model-multimodal.ts — pure helpers for the "multimodal model" feature.
 *
 * The managed-account backend pushes a `ModelConfig.description` for every
 * model; CodePilot stores it in the provider row's `notes` column (see
 * electron/auth/managed-providers.ts → notes: cfg.description). A model is
 * treated as multimodal when that description contains the keyword「多模态」.
 *
 * These functions are pure and unit-tested so the detection rule lives in one
 * place, shared by the model picker (label suffix) and the composer upload
 * guard (block media attachments on non-multimodal models).
 */

/** Keyword that marks a model description as multimodal-capable. */
const MULTIMODAL_KEYWORD = '多模态';

/**
 * True when a model's description marks it as multimodal — i.e. it contains
 * the「多模态」keyword. Empty / null / undefined → false (unknown is treated
 * as non-multimodal for labelling, but the upload guard layers an additional
 * "managed only" check so unknown providers are NOT blocked).
 */
export function isMultimodalDescription(desc?: string | null): boolean {
  if (!desc) return false;
  return desc.includes(MULTIMODAL_KEYWORD);
}

/**
 * True when a MIME type is a media kind that only multimodal models can
 * accept — image/audio/video. Plain text, code and documents return false
 * (those are inlined as text and work on any model, so they are never
 * blocked).
 */
export function isMediaMimeType(mime?: string | null): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return (
    m.startsWith('image/') ||
    m.startsWith('audio/') ||
    m.startsWith('video/')
  );
}
