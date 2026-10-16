import {selectPptImageModel} from '@/lib/ppt-image-routing';
import {getBailianImageConfig} from '@/lib/bailian-image-config';
import { NextRequest } from 'next/server';
import { generateTextToImage, NoImageProviderError, ImageGatewayError } from '@/lib/text-to-image';

interface GenerateRequest {
  prompt: string;
  qualityLevel?:string;
  model?: string;
  aspectRatio?: string;
  n?: number;
  negativePrompt?: string;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();

    if (!body.prompt || !body.prompt.trim()) {
      return Response.json({ error: '提示词不能为空。' }, { status: 400 });
    }

    const result = await generateTextToImage({
      prompt: body.prompt,
      model: body.qualityLevel?selectPptImageModel(getBailianImageConfig(),body.qualityLevel):body.model,
      aspectRatio: body.aspectRatio,
      n: body.n,
      negativePrompt: body.negativePrompt,
    });

    return Response.json({
      id: result.mediaGenerationId,
      images: result.images,
      model: result.model,
      providerName: result.providerName,
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    console.error('[image/generate] Failed:', error);

    if (error instanceof NoImageProviderError) {
      return Response.json({ error: error.message }, { status: 412 });
    }

    if (error instanceof ImageGatewayError) {
      // Pass the upstream status through (e.g. 429 rate-limit, 401 auth).
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : '图片生成失败。';
    return Response.json({ error: message }, { status: 500 });
  }
}
