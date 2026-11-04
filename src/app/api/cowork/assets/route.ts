import { startAssetsDownload, cancelAssetsDownload } from '@/lib/cowork-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cowork 沙箱资产下载控制(镜像流水线 M2)。
 *
 * POST   开始下载缺失资产(显式触发 D3;幂等 —— 进行中重复调用只回状态);
 *        fire-and-forget,进度经 GET /api/cowork/status 轮询。
 * DELETE 取消当前下载(保留 .part,下次 POST 自动断点续传)。
 */
export async function POST() {
  try {
    return Response.json({ assets: startAssetsDownload() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[POST /api/cowork/assets] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    return Response.json({ assets: cancelAssetsDownload() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[DELETE /api/cowork/assets] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
