import { createDeck, EngineError } from './engine';
import { ImportError } from './import-pptx';
import { buildSourceDoc, defaultCardTarget, parseSourceFile, SourceImportError, sourceDeckRequest, type ParsedSource } from './source-import';
import { parseTemplate, type TemplateAssets } from './template-pptx';
import { figureTraits } from './media-relations';
import type { GenerationSettings } from './types';

/**
 * Decks Lab (/decks/lab): a test bench for long sources and templates.
 * Uploaded files are parsed once and kept in memory for an hour (max 12
 * entries), so the page can preview chunking at different card targets and
 * then run a real generation with a chosen model. Nothing here is needed by
 * normal deck creation; PDF import in /api/decks/import uses the same
 * source-import path.
 */

interface SourceEntry { kind: 'source'; fileName: string; parsed: ParsedSource; at: number }
interface TemplateEntry { kind: 'template'; fileName: string; template: TemplateAssets; at: number }
type Entry = SourceEntry | TemplateEntry;
interface LabRegistry { entries: Map<string, Entry> }
const lab: LabRegistry = ((globalThis as unknown as { __decksLab?: LabRegistry }).__decksLab ??= { entries: new Map() });

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 12;

function remember(entry: Entry): string {
  const now = Date.now();
  for (const [id, e] of lab.entries) if (now - e.at > TTL_MS) lab.entries.delete(id);
  while (lab.entries.size >= MAX_ENTRIES) lab.entries.delete(lab.entries.keys().next().value!);
  const id = `lab_${Math.random().toString(36).slice(2, 10)}${now.toString(36).slice(-4)}`;
  lab.entries.set(id, entry);
  return id;
}

function entry<K extends Entry['kind']>(id: string, kind: K): Extract<Entry, { kind: K }> {
  const found = lab.entries.get(id);
  if (!found || found.kind !== kind) throw new EngineError(404, kind === 'source' ? 'Upload the source again (lab uploads expire after an hour).' : 'Upload the template again (lab uploads expire after an hour).', 'lab_upload_expired');
  return found as Extract<Entry, { kind: K }>;
}

const asset = (uploadId: string, name: string) => `/api/decks/lab/assets/${uploadId}/${name}`;

// ── Analysis ───────────────────────────────────────────────────────────────

export async function analyzeSource(bytes: Buffer, fileName: string, targetCards?: number) {
  let parsed: ParsedSource;
  try { parsed = await parseSourceFile(bytes, fileName); } catch (error) {
    if (error instanceof SourceImportError) throw new EngineError(error.status, error.message, error.code);
    throw error;
  }
  const uploadId = remember({ kind: 'source', fileName, parsed, at: Date.now() });
  return sourceView(uploadId, parsed, targetCards ?? defaultCardTarget(parsed));
}

export function rechunk(uploadId: string, targetCards: number) {
  const { parsed } = entry(uploadId, 'source');
  return sourceView(uploadId, parsed, targetCards);
}

function sourceView(uploadId: string, parsed: ParsedSource, targetCards: number) {
  const doc = buildSourceDoc(parsed, targetCards);
  const imageIds = new Set(parsed.images.map(i => i.figureId));
  return {
    uploadId, fileName: parsed.fileName, kind: parsed.kind, title: doc.title, authors: doc.authors, pages: doc.pages, targetCards,
    defaultTarget: defaultCardTarget(parsed),
    blocks: { headings: parsed.blocks.filter(b => b.kind === 'heading').length, paragraphs: parsed.blocks.filter(b => b.kind === 'paragraph').length, tables: parsed.blocks.filter(b => b.kind === 'table').length, figures: parsed.figures.length },
    chunks: doc.chunks.map(c => ({ id: c.id, path: c.path, title: c.title, kind: c.kind, chars: c.chars, cardBudget: c.cardBudget, pages: c.pages, figureIds: c.figureIds, refFigureIds: c.refFigureIds, preview: c.text.slice(0, 360) })),
    figures: doc.figures.map(f => ({ id: f.id, label: f.label, caption: f.caption, kind: f.kind, series: f.series, chunkId: f.chunkId, width: f.width, height: f.height, page: f.page, traits: figureTraits(f), url: imageIds.has(f.id) ? asset(uploadId, f.id) : null })),
    dropped: doc.dropped, droppedSamples: parsed.droppedSamples.slice(0, 40), warnings: doc.warnings,
  };
}

export async function analyzeTemplate(bytes: Buffer, fileName: string) {
  let template: TemplateAssets;
  try { template = await parseTemplate(bytes, fileName); } catch (error) {
    if (error instanceof ImportError) throw new EngineError(error.status, error.message, error.code);
    throw error;
  }
  const uploadId = remember({ kind: 'template', fileName, template, at: Date.now() });
  return {
    uploadId, fileName, slides: template.slides, theme: template.theme, rhythm: template.rhythm, notes: template.notes,
    images: template.images.map((img, i) => ({ index: i, role: img.role, share: img.share, width: img.width, height: img.height, slide: img.slide, url: asset(uploadId, `img-${i}`) })),
    logo: template.logo ? { slot: template.logo.slot, slides: template.logo.slides, width: template.logo.width, height: template.logo.height, url: asset(uploadId, 'logo') } : null,
    components: template.components.map(c => ({ id: c.id, slide: c.slide, kind: c.kind, units: c.units, numbered: c.numbered, hasBody: c.hasBody, imageSlots: c.imageSlots, fixed: Boolean(c.fixed), titles: c.slots.filter(s => s.role === 'title').map(s => s.sample) })),
  };
}

/** Bytes of an uploaded figure (F4), template image (img-3) or logo. */
export function labAsset(uploadId: string, name: string): { data: Buffer; mime: string } | null {
  const found = lab.entries.get(uploadId);
  if (!found) return null;
  if (found.kind === 'source') {
    const img = found.parsed.images.find(i => i.figureId === name);
    return img ? { data: img.data, mime: img.mime } : null;
  }
  if (name === 'logo') return found.template.logo ? { data: found.template.logo.data, mime: found.template.logo.mime } : null;
  const m = /^img-(\d{1,3})$/.exec(name);
  const img = m ? found.template.images[Number(m[1])] : undefined;
  return img ? { data: img.data, mime: img.mime } : null;
}

// ── Run ────────────────────────────────────────────────────────────────────

export interface LabRunRequest {
  sourceUploadId: string;
  templateUploadId?: string;
  targetCards?: number;
  settings?: Partial<GenerationSettings>;
  model?: { providerId: string; model: string };
}

export async function runLab(req: LabRunRequest) {
  const { parsed } = entry(req.sourceUploadId, 'source');
  const template = req.templateUploadId ? entry(req.templateUploadId, 'template').template : undefined;
  const { request, figures } = sourceDeckRequest(parsed, {
    targetCards: req.targetCards,
    settings: { mode: 'plan', imageSource: 'themeAccent', ...req.settings, ...(req.model?.providerId && req.model.model ? { model: { providerId: String(req.model.providerId).slice(0, 80), model: String(req.model.model).slice(0, 200) } } : {}) },
    source: { kind: 'import', fileName: parsed.fileName, intent: 'condense' },
  });
  return createDeck(request, { attachments: { figures, ...(template ? { template } : {}) } });
}

// ── Models ─────────────────────────────────────────────────────────────────

const ENV = { key: 'DECKS_LAB_API_KEY', base: 'DECKS_LAB_BASE_URL', model: 'DECKS_LAB_MODEL', models: 'DECKS_LAB_MODELS', protocol: 'DECKS_LAB_PROTOCOL' } as const;
const LAB_PROVIDER_NAME = 'Decks Lab (env)';

/** Configured chat providers and their models (no secrets), plus whether the env-based provider can be set up. */
export async function labModels() {
  const db = await import('../db');
  const providers = db.getAllProviders().filter(p => !/image/i.test(p.protocol || '') && !/image/i.test(p.provider_type || ''));
  const list = providers.map(p => {
    let roleDefault = '';
    try { roleDefault = String((JSON.parse(p.role_models_json || '{}') as Record<string, unknown>).default || ''); } catch { roleDefault = ''; }
    const models = [...new Set([roleDefault, ...db.getModelsForProvider(p.id).map(m => m.model_id)].filter(Boolean))];
    return { id: p.id, name: p.name, protocol: p.protocol || p.provider_type, baseHost: hostOf(p.base_url), hasKey: Boolean(p.api_key), models };
  });
  const envModel = process.env[ENV.model] || 'qwen-3.8-max';
  return {
    providers: list,
    defaultProviderId: db.getDefaultProviderId() || null,
    env: { available: Boolean(process.env[ENV.key] && (process.env[ENV.base] || (process.env[ENV.protocol] || '') === 'anthropic')), baseHost: hostOf(process.env[ENV.base] || ''), model: envModel, extraModels: (process.env[ENV.models] || '').split(',').map(s => s.trim()).filter(Boolean) },
  };
}

function hostOf(url: string | undefined | null): string {
  if (!url) return '';
  try { return new URL(url).host; } catch { return ''; }
}

/** Creates or updates the "Decks Lab (env)" provider from DECKS_LAB_* variables; the key never leaves the server. */
export async function configureProviderFromEnv() {
  const key = process.env[ENV.key];
  const protocol = (process.env[ENV.protocol] || 'openai-compatible').trim();
  const base = (process.env[ENV.base] || '').trim();
  if (!key) throw new EngineError(400, `${ENV.key} is not set in this environment.`, 'lab_env_missing');
  if (protocol !== 'anthropic' && !base) throw new EngineError(400, `${ENV.base} is required for an OpenAI-compatible gateway.`, 'lab_env_missing');
  const model = (process.env[ENV.model] || 'qwen-3.8-max').trim();
  const extra = (process.env[ENV.models] || '').split(',').map(s => s.trim()).filter(Boolean);
  const db = await import('../db');
  const existing = db.getAllProviders().find(p => p.name === LAB_PROVIDER_NAME);
  const fields = {
    name: LAB_PROVIDER_NAME,
    provider_type: protocol === 'anthropic' ? 'anthropic' : 'openai-compatible',
    protocol: protocol === 'anthropic' ? 'anthropic' : 'openai-compatible',
    base_url: base,
    api_key: key,
    role_models_json: JSON.stringify({ default: model }),
    notes: 'Created by Decks Lab from DECKS_LAB_* environment variables.',
  };
  const provider = existing ? db.updateProvider(existing.id, fields)! : db.createProvider(fields);
  [model, ...extra].forEach((m, i) => db.upsertProviderModel({ provider_id: provider.id, model_id: m, display_name: m, sort_order: i, enabled: 1 }));
  return { providerId: provider.id, name: provider.name, models: [model, ...extra], baseHost: hostOf(base) };
}
