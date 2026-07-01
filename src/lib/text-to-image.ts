/**
 * Standalone text-to-image generation via Aliyun Bailian (DashScope).
 *
 * Independent from `image-generator.ts` (the in-chat / MCP / batch pipeline).
 * Powers the standalone Image Studio page:
 *   - calls the synchronous Qwen-Image multimodal-generation endpoint directly
 *     (no Claude Code in the loop) using the qwen-image-2.0 series
 *   - credentials (api key + workspace) come from the encrypted
 *     `bailian_image_config` setting (see bailian-image-config.ts)
 *   - the API returns OSS image URLs (valid 24h) which we download and persist
 *     to disk + a media_generations row so the existing gallery /
 *     /api/media/serve infrastructure renders them
 *
 * Endpoint (verified working): POST
 *   https://{workspaceId}.{region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 * Body: { model, input:{messages:[{role,content:[{text}]}]}, parameters:{size,n,...} }
 * Response image URLs: output.choices[].message.content[].image
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '@/lib/db';
import { getBailianImageConfig } from '@/lib/bailian-image-config';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
const MEDIA_DIR = path.join(dataDir, '.codepilot-media');

export const DEFAULT_IMAGE_MODEL = 'qwen-image-2.0-pro';

const MAX_IMAGES_PER_REQUEST = 6;
const REQUEST_TIMEOUT_MS = 300_000;
const URL_FETCH_TIMEOUT_MS = 120_000;

/**
 * UI aspect ratio → qwen-image-2.0 size string (separator is '*', total pixels
 * capped at 2048×2048). The 2.0 series exposes one resolution per ratio.
 */
const QWEN_SIZE_BY_RATIO: Record<string, string> = {
  '1:1': '2048*2048',
  '16:9': '2688*1536',
  '9:16': '1536*2688',
  '4:3': '2368*1728',
  '3:4': '1728*2368',
};

export interface TextToImageParams {
  prompt: string;
  /** Future-extensible. Defaults to the configured model (qwen-image-2.0-pro). */
  model?: string;
  /** UI aspect ratio, e.g. '1:1' | '16:9' | '9:16' | '4:3' | '3:4'. */
  aspectRatio?: string;
  /** Number of images to generate (clamped to 1..6). */
  n?: number;
  /** Optional negative prompt (max ~500 chars). */
  negativePrompt?: string;
  abortSignal?: AbortSignal;
}

export interface TextToImageImage {
  mimeType: string;
  localPath: string;
}

export interface TextToImageResult {
  /** media_generations id of the FIRST persisted image (one row per image). */
  mediaGenerationId: string;
  images: TextToImageImage[];
  model: string;
  providerName: string;
  elapsedMs: number;
}

/** Thrown when the image service has no usable credentials configured. */
export class NoImageProviderError extends Error {
  constructor(message = '请登录账号以使用文生图。') {
    super(message);
    this.name = 'NoImageProviderError';
  }
}

/** Thrown when the upstream image gateway returns a non-2xx response. Carries
 *  the upstream HTTP status so the API route can surface it accurately. */
export class ImageGatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ImageGatewayError';
    this.status = status;
  }
}

interface BailianResponse {
  output?: {
    choices?: Array<{
      message?: { content?: Array<{ image?: string; text?: string }> };
    }>;
  };
  code?: string;
  message?: string;
  request_id?: string;
}

/** Build the per-workspace MaaS endpoint host. */
function buildEndpoint(workspaceId: string, region: string): string {
  return `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
}

function extractImageUrls(json: BailianResponse): string[] {
  const urls: string[] = [];
  for (const choice of json.output?.choices || []) {
    for (const item of choice.message?.content || []) {
      if (item.image) urls.push(item.image);
    }
  }
  return urls;
}

/**
 * Generate one or more images from a prompt and persist them.
 * Inserts ONE media_generations row per returned image so all images surface
 * in the gallery + in-page history.
 */
export async function generateTextToImage(params: TextToImageParams): Promise<TextToImageResult> {
  const startTime = Date.now();

  const prompt = params.prompt?.trim();
  if (!prompt) throw new Error('提示词不能为空。');

  const cfg = getBailianImageConfig();
  if (!cfg.apiKey) throw new NoImageProviderError();

  const model = params.model || cfg.model || DEFAULT_IMAGE_MODEL;
  const aspectRatio = params.aspectRatio || '1:1';
  const size = QWEN_SIZE_BY_RATIO[aspectRatio] || QWEN_SIZE_BY_RATIO['1:1'];
  const n = Math.min(Math.max(Math.floor(params.n ?? 1), 1), MAX_IMAGES_PER_REQUEST);

  const endpoint = buildEndpoint(cfg.workspaceId, cfg.region);
  const body = {
    model,
    input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
    parameters: {
      size,
      n,
      watermark: false,
      prompt_extend: true,
      ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.abortSignal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as BailianResponse;
      detail = j.message || j.code || JSON.stringify(j);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ImageGatewayError(res.status, `图片生成失败（HTTP ${res.status}）：${(detail || '').slice(0, 500)}`);
  }

  const json = (await res.json()) as BailianResponse;
  const urls = extractImageUrls(json);
  if (urls.length === 0) {
    const reason = json.message || json.code || '服务未返回任何图片，请更换提示词后重试。';
    throw new Error(reason);
  }

  // Download each OSS url (they expire in 24h).
  const buffers: Buffer[] = [];
  for (const url of urls) {
    const imgRes = await fetch(url, {
      signal: params.abortSignal ?? AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
    });
    if (!imgRes.ok) throw new Error(`下载生成图片失败：HTTP ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 0) buffers.push(buf);
  }
  if (buffers.length === 0) throw new Error('服务返回的图片为空。');

  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const saved: TextToImageImage[] = [];
  for (const buf of buffers) {
    // qwen-image returns PNG.
    const filename = `t2i-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.png`;
    const filePath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filePath, buf);
    saved.push({ mimeType: 'image/png', localPath: filePath });
  }

  const elapsed = Date.now() - startTime;
  console.log(`[text-to-image] ${model} ${size} x${saved.length} in ${elapsed}ms`);

  // Persist one row per image.
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO media_generations (id, type, status, provider, model, prompt, aspect_ratio, image_size, local_path, thumbnail_path, session_id, message_id, tags, metadata, error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const ids: string[] = [];
  const insertAll = db.transaction((rows: TextToImageImage[]) => {
    for (const img of rows) {
      const id = crypto.randomBytes(16).toString('hex');
      ids.push(id);
      const metadata = {
        source: 'text-to-image',
        model,
        size,
        elapsedMs: elapsed,
        providerName: 'Aliyun Bailian',
      };
      insert.run(
        id, 'image', 'completed', 'bailian', model, prompt,
        aspectRatio, size, img.localPath, '',
        null, null, '[]', JSON.stringify(metadata), null, now, now,
      );
    }
  });
  insertAll(saved);

  return {
    mediaGenerationId: ids[0] || '',
    images: saved,
    model,
    providerName: 'Aliyun Bailian',
    elapsedMs: elapsed,
  };
}
