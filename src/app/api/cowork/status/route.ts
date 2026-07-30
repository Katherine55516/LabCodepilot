import { getSetting } from '@/lib/db';
import { getCoworkBackend } from '@/lib/cowork-backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cowork 沙箱可用性状态(E3;M2 扩资产;R1-3 按后端分)。只读探测,绝不触发容器/VM
 * 启动或本地资产下载。
 *
 * - enabled:全局开关 settings.cowork_enabled === 'true'
 * - backendKind:'remote'(单公司服务器,RD1 默认)| 'vfkit'(保留本地 VM)
 * - remote:可用性 = cowork-server 可达(GET /health);无本地镜像/下载概念,
 *   imageProvisioned/assets 为兼容字段,按 server 可达映射(前端 gate 直接放行)。
 * - vfkit:保留 imageProvisioned(纯 fs)+ assets 状态机(本地下载进度)。
 */
export async function GET() {
  try {
    const enabled = getSetting('cowork_enabled') === 'true';
    const backend = await getCoworkBackend();
    const status = await backend.getStatus();

    if (backend.kind === 'remote') {
      return Response.json({
        enabled,
        backendKind: 'remote',
        imageProvisioned: status.ready,
        vmPhase: status.ready ? 'running' : 'stopped',
        assets: { overall: status.ready ? 'ready' : 'unavailable', usable: status.ready },
      });
    }

    // R5-6:vfkit 是 macOS 专属(vfkit 二进制 + vsock)。非 darwin 且未下发 remote 时,
    // 本地资产状态机是死路(下载的是 mac 资产)—— 返回 unsupported,前端只解释
    // 「由公司远程沙箱提供、登录自动开通」(RD5 诚实降级),绝不引导下载。
    if (process.platform !== 'darwin') {
      const noAsset = { state: 'missing', receivedBytes: 0, totalBytes: 0, pct: 0 };
      return Response.json({
        enabled,
        backendKind: 'vfkit',
        imageProvisioned: false,
        vmPhase: 'stopped',
        assets: { image: noAsset, claude: noAsset, overall: 'unsupported', totalPct: 0, usable: false, upgradeAvailable: false },
      });
    }

    // vfkit 保留:本地镜像/资产状态(M2 下载引导)
    const { isImageProvisioned } = await import('@/lib/cowork-vm-manager');
    const { getAssetsStatus } = await import('@/lib/cowork-assets');
    return Response.json({
      enabled,
      backendKind: 'vfkit',
      imageProvisioned: isImageProvisioned(),
      vmPhase: status.phase,
      assets: getAssetsStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/cowork/status] Error:', message);
    // 状态探测失败按"不可用"返回,前端据此隐藏办公入口(fail-closed)。
    return Response.json({ enabled: false, imageProvisioned: false, vmPhase: 'stopped', error: message }, { status: 200 });
  }
}
