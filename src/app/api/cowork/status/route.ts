import { getSetting } from '@/lib/db';
import { getStatus, isImageProvisioned } from '@/lib/cowork-vm-manager';
import { getAssetsStatus } from '@/lib/cowork-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cowork 沙箱可用性状态(E3;M2 扩资产状态)。只读探测,绝不触发 VM 启动
 * 或资产下载。
 *
 * - enabled:全局开关 settings.cowork_enabled === 'true'
 * - imageProvisioned:底镜是否就绪(纯 fs 检查;兼容字段,UI 应改看 assets)
 * - vmPhase:VM 管理器当前相位(stopped/starting/running/crashed)
 * - assets:M2 资产状态机 {image,claude,overall,totalPct}(下载中含进度,
 *   前端据 overall==='downloading' 轮询)
 */
export async function GET() {
  try {
    return Response.json({
      enabled: getSetting('cowork_enabled') === 'true',
      imageProvisioned: isImageProvisioned(),
      vmPhase: getStatus().phase,
      assets: getAssetsStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/cowork/status] Error:', message);
    // 状态探测失败按"不可用"返回,前端据此隐藏办公入口(fail-closed)。
    return Response.json({ enabled: false, imageProvisioned: false, vmPhase: 'stopped', error: message }, { status: 200 });
  }
}
