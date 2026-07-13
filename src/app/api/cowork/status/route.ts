import { getSetting } from '@/lib/db';
import { getStatus, isImageProvisioned } from '@/lib/cowork-vm-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cowork 沙箱可用性状态(E3;原计划 E5 项,提前给「办公」tab 的可见性
 * gate 与办公空态卡用)。只读探测,绝不触发 VM 启动。
 *
 * - enabled:全局开关 settings.cowork_enabled === 'true'
 * - imageProvisioned:本机 VM 镜像资产是否就绪(纯 fs 检查)
 * - vmPhase:VM 管理器当前相位(stopped/starting/running/crashed)
 */
export async function GET() {
  try {
    return Response.json({
      enabled: getSetting('cowork_enabled') === 'true',
      imageProvisioned: isImageProvisioned(),
      vmPhase: getStatus().phase,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/cowork/status] Error:', message);
    // 状态探测失败按"不可用"返回,前端据此隐藏办公入口(fail-closed)。
    return Response.json({ enabled: false, imageProvisioned: false, vmPhase: 'stopped', error: message }, { status: 200 });
  }
}
