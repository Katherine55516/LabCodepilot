import type { NativePermissionResult } from './types/agent-types';
import { resolvePermissionRequest as dbResolvePermission } from './db';

// Use our own type. SDK path casts to this at the boundary.
type PermissionResult = NativePermissionResult;

/**
 * 超时诊断用的上下文 —— 只进日志,不参与任何判定逻辑。
 *
 * 背景:线上日志里出现过 84 次「timed out after 300s」,但那条日志只有请求 id,
 * 既不知道是哪个会话、哪个工具,也分不清两种完全不同的故障:
 *   a) 前端压根没收到提示(SSE 通道已关 / 用户不在该会话)→ 超时是必然结果;
 *   b) 前端收到了、弹窗也在,只是没人点。
 * 两者的修法完全不同,所以把这些信息在注册时一并带上。
 */
export interface PendingPermissionMeta {
  sessionId?: string;
  toolName?: string;
  /** 注册时 SSE 通道是否还开着。false ⇒ 前端不可能看到这条提示。 */
  deliveredToClient?: boolean;
}

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  createdAt: number;
  abortSignal?: AbortSignal;
  toolInput: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
  meta?: PendingPermissionMeta;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Use globalThis to ensure the Map is shared across all module instances.
// In Next.js dev mode (Turbopack), different API routes may load separate
// module instances, so a module-level variable would NOT be shared.
const globalKey = '__pendingPermissions__' as const;

function getMap(): Map<string, PendingPermission> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, PendingPermission>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, PendingPermission>;
}

/**
 * Helper to deny and remove a pending permission entry.
 * Also writes the denial to DB for persistence/audit.
 */
function denyAndRemove(id: string, message: string, dbStatus: 'timeout' | 'aborted' = 'aborted') {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.resolve({ behavior: 'deny', message });
  map.delete(id);
  try {
    dbResolvePermission(id, dbStatus, { message });
  } catch {
    // DB write failure should not affect in-memory path
  }
}

/**
 * Register a pending permission request.
 * Returns a Promise that resolves when the user responds or after TIMEOUT_MS.
 */
export function registerPendingPermission(
  id: string,
  toolInput: Record<string, unknown>,
  abortSignal?: AbortSignal,
  meta?: PendingPermissionMeta,
): Promise<PermissionResult> {
  const map = getMap();

  return new Promise<PermissionResult>((resolve) => {
    // Per-request independent timer: auto-deny after TIMEOUT_MS.
    // `.unref()` so this timer doesn't prevent Node process from exiting
    // during graceful shutdown — if the app is closing, we don't need to
    // fire the timeout handler.
    const timer = setTimeout(() => {
      if (map.has(id)) {
        // 带上上下文:哪个会话、哪个工具、当时到底有没有送到前端(见 PendingPermissionMeta)。
        const ctx = [
          meta?.toolName ? `tool=${meta.toolName}` : null,
          meta?.sessionId ? `session=${meta.sessionId}` : null,
          meta?.deliveredToClient === undefined
            ? null
            : `已投递前端=${meta.deliveredToClient ? '是' : '否(SSE 通道已关,前端不可能看到)'}`,
        ].filter(Boolean).join(' ');
        console.warn(
          `[permission-registry] Permission request ${id} timed out after ${TIMEOUT_MS / 1000}s` +
          (ctx ? ` — ${ctx}` : ''),
        );
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
        map.delete(id);
        try {
          dbResolvePermission(id, 'timeout', { message: 'Permission request timed out' });
        } catch {
          // DB write failure should not affect in-memory path
        }
      }
    }, TIMEOUT_MS);
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    map.set(id, {
      resolve,
      createdAt: Date.now(),
      abortSignal,
      toolInput,
      timer,
      meta,
    });

    // Auto-deny if the abort signal fires (client disconnect / stop button)
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => denyAndRemove(id, 'Request aborted'), { once: true });
    }
  });
}

/**
 * Resolve a pending permission request with the user's decision.
 * Returns true if the permission was found and resolved, false otherwise.
 */
export function resolvePendingPermission(
  id: string,
  result: PermissionResult,
): boolean {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) return false;

  clearTimeout(entry.timer);

  if (result.behavior === 'allow' && !result.updatedInput) {
    result = { ...result, updatedInput: entry.toolInput };
  }

  // Dual-write: persist to DB before resolving in-memory
  try {
    const dbStatus = result.behavior === 'allow' ? 'allow' as const : 'deny' as const;
    dbResolvePermission(id, dbStatus, {
      updatedPermissions: result.behavior === 'allow' ? (result.updatedPermissions as unknown[]) : undefined,
      updatedInput: result.behavior === 'allow' ? (result.updatedInput as Record<string, unknown>) : undefined,
      message: result.behavior === 'deny' ? result.message : undefined,
    });
  } catch {
    // DB write failure should not affect in-memory path
  }

  entry.resolve(result);
  map.delete(id);
  return true;
}
