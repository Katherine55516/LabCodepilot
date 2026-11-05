/**
 * Gamma-compatible API service: the I/O half of the compatibility layer.
 *
 * Routes (mounted at /api/ppt/gamma/v1.0/...):
 *   POST /generations                       Classic create   -> { generationId }
 *   GET  /generations/{id}                  Classic poll
 *   POST /agent/generations                 Gamma 5 create   -> { generationId, status, warnings }
 *   GET  /agent/generations/{id}            Gamma 5 poll
 *   GET  /themes                            engine templates as Gamma themes
 *   GET  /files/{id}.{pptx|pdf}?expires&signature   signed export download (no API key)
 *
 * Each poll advances the engine by at most one step (plan -> generate), so a
 * plain create-then-poll client drives the whole outline-first engine without
 * the review stops the app shows a person. Model calls still run through the
 * desktop model worker (PptBackgroundTasks), so the AIMate window must be open.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fetchInputImage, type ImageFetchResult } from './ppt-gamma-image-fetch';
import {
  GammaApiError, MAX_INPUT_IMAGES, nextEngineStep, parseAgentGeneration, parseClassicGeneration, toGammaStatus, toGammaThemes,
  type GammaFlavor, type GammaJobPhase, type GammaJobSettings, type GammaWarning, type PptProjectSnapshot,
} from './ppt-gamma-compat';

export interface GammaJobRecord {
  id: string; uid: string; projectId: string; flavor: GammaFlavor;
  settings: GammaJobSettings; warnings: GammaWarning[]; phase: GammaJobPhase; phaseError: string;
  createdAt: string; updatedAt: string;
}

export interface GammaJobStore {
  insert(job: GammaJobRecord): void;
  get(id: string): GammaJobRecord | undefined;
  update(id: string, patch: Partial<Pick<GammaJobRecord, 'phase' | 'phaseError'>>): void;
}

export interface GammaServiceDeps {
  /** Configured API key; undefined disables the API. */
  apiKey: string | undefined;
  uid: string;
  store: GammaJobStore;
  /** Calls the PPT engine at `${base}/ppt/${path}`; resolves to the raw response. */
  upstream(path: string, init?: { method?: string; body?: unknown; accept?: string }): Promise<Response>;
  now?: () => number;
  /** Fetches one input image URL; defaults to the guarded public-HTTPS fetcher. */
  fetchImage?: (url: string) => Promise<ImageFetchResult>;
}

const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Gamma export links last about one week.
const GENERATION_ID = /^gen_[a-f0-9]{24}$/;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const errorBody = (statusCode: number, message: string, code?: string) => ({ message, statusCode, ...(code ? { code } : {}) });

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signExport(apiKey: string, generationId: string, ext: string, expires: number) {
  return createHmac('sha256', apiKey).update(`${generationId}.${ext}.${expires}`).digest('hex');
}

function presentedKey(request: Request) {
  const header = request.headers.get('x-api-key');
  if (header) return header.trim();
  const auth = request.headers.get('authorization');
  return auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

async function readUpstream(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { error: text.slice(0, 500) }; }
}

/** Engine errors keep their status when they describe the request (4xx); others are 502. */
function engineError(status: number, data: { error?: string; code?: string }) {
  const message = typeof data?.error === 'string' && data.error ? data.error : 'PPT engine request failed';
  return status >= 400 && status < 500 ? new GammaApiError(status, message, data?.code) : new GammaApiError(502, message, 'engine_unavailable');
}

/** Gamma fetches image URLs from the input and silently skips failures; we report the skips as one warning. */
async function embedImages(parsed: ReturnType<typeof parseClassicGeneration>, fetchImage: (url: string) => Promise<ImageFetchResult>) {
  const urls = parsed.imageUrls.slice(0, MAX_INPUT_IMAGES);
  const skipped: string[] = parsed.imageUrls.slice(MAX_INPUT_IMAGES).map(url => `${url} (over ${MAX_INPUT_IMAGES} images)`);
  const results = await Promise.all(urls.map(fetchImage));
  const images: NonNullable<typeof parsed.create.images> = [];
  results.forEach((result, index) => {
    if (result.ok) {
      const last = new URL(urls[index]).pathname.split('/').pop() || '';
      let name = last; try { name = decodeURIComponent(last); } catch { /* keep the raw segment */ }
      name = name.replace(/\.[a-z0-9]+$/i, '');
      images.push({ dataUrl: result.dataUrl, caption: name.slice(0, 100), required: false });
    } else skipped.push(`${urls[index]} (${result.reason})`);
  });
  if (images.length) parsed.create.images = images;
  if (skipped.length) parsed.warnings.push({ code: 'image_urls_skipped', message: `${skipped.length} image URL${skipped.length > 1 ? 's were' : ' was'} not used (this engine embeds public HTTPS PNG/JPEG up to 512 KB): ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? '; ...' : ''}` });
}

async function createGeneration(flavor: GammaFlavor, request: Request, deps: GammaServiceDeps, now: number) {
  let raw: unknown;
  try { raw = await request.json(); } catch { throw new GammaApiError(400, 'Request body must be valid JSON'); }
  const parsed = flavor === 'agent' ? parseAgentGeneration(raw) : parseClassicGeneration(raw);
  await embedImages(parsed, deps.fetchImage || fetchInputImage);
  const response = await deps.upstream('projects', { method: 'POST', body: parsed.create });
  const data = await readUpstream(response);
  if (!response.ok || !data?.project?.id) throw engineError(response.status, data);
  const id = `gen_${randomBytes(12).toString('hex')}`;
  const at = new Date(now).toISOString();
  deps.store.insert({ id, uid: deps.uid, projectId: data.project.id, flavor, settings: parsed.settings, warnings: parsed.warnings, phase: 'created', phaseError: '', createdAt: at, updatedAt: at });
  return flavor === 'agent'
    // Gamma: agent create answers 202 Accepted, Classic create answers 200.
    ? json(202, { generationId: id, status: 'pending', warnings: parsed.warnings })
    : json(200, { generationId: id, ...(parsed.warnings.length ? { warnings: parsed.warnings.map(w => w.message).join(' ') } : {}) });
}

function ownedJob(id: string, flavor: GammaFlavor | null, deps: GammaServiceDeps) {
  const job = GENERATION_ID.test(id) ? deps.store.get(id) : undefined;
  // Another account's job, or the other API flavor's id, reads as not found.
  if (!job || job.uid !== deps.uid || (flavor && job.flavor !== flavor)) throw new GammaApiError(404, 'Generation not found');
  return job;
}

async function readProject(job: GammaJobRecord, deps: GammaServiceDeps): Promise<PptProjectSnapshot> {
  const response = await deps.upstream(`projects/${job.projectId}?view=live`);
  const data = await readUpstream(response);
  if (!response.ok || !data?.project) throw engineError(response.status === 404 ? 404 : response.status, data);
  return data.project as PptProjectSnapshot;
}

/** Take the next engine step, if any; a refused step marks the job blocked with the engine's reason. */
async function advance(job: GammaJobRecord, project: PptProjectSnapshot, deps: GammaServiceDeps): Promise<boolean> {
  const step = nextEngineStep(job.phase, job.settings, project);
  if (step.type === 'none') return false;
  const response = step.type === 'plan'
    ? await deps.upstream(`projects/${job.projectId}/planning`, { method: 'POST', body: step.body })
    : await deps.upstream(`projects/${job.projectId}/generate`, { method: 'POST', body: {} });
  const data = await readUpstream(response);
  if (response.ok) {
    deps.store.update(job.id, { phase: step.type === 'plan' ? 'planning' : 'generating' });
    return true;
  }
  // 409 from generate is a review stop (facts to edit, source warnings...): the
  // API cannot answer it, so the job fails with the engine's own explanation.
  if (response.status === 409 && step.type === 'generate') {
    deps.store.update(job.id, { phase: 'blocked', phaseError: `${data?.error || 'The outline needs review.'} Open the presentation to resolve it.` });
    return true;
  }
  if (response.status >= 500) return false; // transient: retry on the next poll
  deps.store.update(job.id, { phase: 'blocked', phaseError: String(data?.error || 'The engine refused the next step.') });
  return true;
}

async function pollGeneration(flavor: GammaFlavor, id: string, request: Request, deps: GammaServiceDeps, now: number) {
  let job = ownedJob(id, flavor, deps);
  let project = await readProject(job, deps);
  if (await advance(job, project, deps)) {
    job = deps.store.get(job.id)!;
    project = await readProject(job, deps);
  }
  const origin = new URL(request.url).origin;
  const published = ['completed', 'quality_blocked'].includes(project.status) && Boolean(project.publishedRevision);
  let exportUrl: string | undefined;
  if (published && job.settings.exportAs && deps.apiKey) {
    const expires = now + EXPORT_TTL_MS;
    exportUrl = `${origin}/api/ppt/gamma/v1.0/files/${job.id}.${job.settings.exportAs}?expires=${expires}&signature=${signExport(deps.apiKey, job.id, job.settings.exportAs, expires)}`;
  }
  return json(200, toGammaStatus(project, {
    generationId: job.id, flavor: job.flavor, phase: job.phase, phaseError: job.phaseError,
    gammaUrl: `${origin}/ppt?projectId=${job.projectId}`, exportUrl, warnings: job.warnings,
  }));
}

async function downloadFile(name: string, request: Request, deps: GammaServiceDeps, now: number) {
  const match = name.match(/^(gen_[a-f0-9]{24})\.(pptx|pdf)$/);
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature') || '';
  if (!match || !deps.apiKey || !Number.isSafeInteger(expires) || expires < now || !safeEqual(signature, signExport(deps.apiKey, match[1], match[2], expires)))
    throw new GammaApiError(403, 'This download link is invalid or has expired');
  const job = ownedJob(match[1], null, deps);
  const response = await deps.upstream(`projects/${job.projectId}/${match[2] === 'pdf' ? 'pdf' : 'export'}`);
  if (!response.ok) throw engineError(response.status, await readUpstream(response));
  const headers = new Headers({ 'cache-control': 'private, no-store' });
  for (const key of ['content-type', 'content-length', 'content-disposition']) { const value = response.headers.get(key); if (value) headers.set(key, value); }
  return new Response(response.body, { status: 200, headers });
}

/** Entry point used by the route; `path` is the part after /v1.0/. */
export async function handleGammaRequest(request: Request, path: string[], deps: GammaServiceDeps): Promise<Response> {
  const now = deps.now ? deps.now() : Date.now();
  try {
    const method = request.method.toUpperCase();
    // Signed download links work without the key, like Gamma's exportUrl.
    if (method === 'GET' && path.length === 2 && path[0] === 'files') return await downloadFile(path[1], request, deps, now);
    if (!deps.apiKey) throw new GammaApiError(403, 'The Gamma-compatible API is disabled. Set the ppt_gamma_api_key setting (or PPT_GAMMA_API_KEY) to enable it.', 'api_disabled');
    const key = presentedKey(request);
    if (!key || !safeEqual(key, deps.apiKey)) throw new GammaApiError(401, 'Invalid API key', 'unauthorized');
    if (!deps.uid) throw new GammaApiError(401, 'Sign in to AIMate before using the API', 'not_signed_in');
    const route = path.join('/');
    if (method === 'POST' && route === 'generations') return await createGeneration('classic', request, deps, now);
    if (method === 'POST' && route === 'agent/generations') return await createGeneration('agent', request, deps, now);
    if (method === 'GET' && path.length === 2 && path[0] === 'generations') return await pollGeneration('classic', path[1], request, deps, now);
    if (method === 'GET' && path.length === 3 && path[0] === 'agent' && path[1] === 'generations') return await pollGeneration('agent', path[2], request, deps, now);
    if (method === 'GET' && route === 'themes') {
      const response = await deps.upstream('templates');
      const data = await readUpstream(response);
      if (!response.ok) throw engineError(response.status, data);
      return json(200, toGammaThemes(data.templates));
    }
    throw new GammaApiError(404, `No route for ${method} /v1.0/${route}`);
  } catch (error) {
    if (error instanceof GammaApiError) return json(error.statusCode, errorBody(error.statusCode, error.message, error.code));
    return json(503, errorBody(503, error instanceof Error ? error.message : 'PPT service unavailable', 'engine_unavailable'));
  }
}
