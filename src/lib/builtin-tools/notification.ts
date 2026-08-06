/**
 * builtin-tools/notification.ts — Notification tool handlers (shared between runtimes).
 *
 * ⚠️ 2026-08-05:三个**本机**定时任务工具已按用户决定下线(与 notification-mcp.ts 同步)。
 * 这是**第二条**通往模型的路径(native runtime 走 AI SDK tool(),不走 MCP),只删一处不够 ——
 * 留着的话模型在那条路径上照样能建出跑在用户电脑上、关机就停、且没有界面能看到的任务。
 *
 * These are the pure handler functions extracted from notification-mcp.ts.
 * Both SDK Runtime (via createSdkMcpServer) and Native Runtime (via AI SDK tool())
 * use these same handlers — single source of truth.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const NOTIFICATION_SYSTEM_PROMPT = `## 通知

- codepilot_notify: 立即发送通知给用户（支持系统通知和应用内提示）

使用场景：
- 任务完成需要告知用户 → 用 codepilot_notify

注意：跑在用户本机的旧定时任务工具已下线（用户决定不再要）。用户提「每天/定时做某事」时，
只有**办公会话**能做到 —— 那里有 codepilot-routines，任务跑在沙箱服务器上、关机也照跑；
其它场景请如实说明做不了，不要临时拿别的工具凑。`;

/**
 * Create notification tools as Vercel AI SDK ToolSet.
 * Can be used by both Native Runtime and as reference for SDK Runtime.
 */
export function createNotificationTools() {
  return {
    codepilot_notify: tool({
      description: 'Send an immediate notification to the user.',
      inputSchema: z.object({
        title: z.string().describe('Notification title'),
        body: z.string().describe('Notification body text'),
        priority: z.enum(['low', 'normal', 'urgent']).optional().describe('low=toast, normal=toast+system, urgent=+telegram'),
      }),
      execute: async ({ title, body, priority }) => {
        try {
          const { sendNotification } = await import('@/lib/notification-manager');
          await sendNotification({ title, body, priority: priority || 'normal' });
          return `Notification sent: "${title}"`;
        } catch (err) {
          return `Failed to send notification: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

  };
}
