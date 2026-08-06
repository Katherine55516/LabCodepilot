/**
 * codepilot-notify MCP — in-process MCP server for notifications.
 *
 * Provides 2 tools:
 * - codepilot_notify: Send an immediate notification
 * - codepilot_hatch_buddy: Hatch / name the user's buddy
 *
 * ⚠️ 2026-08-05:三个**本机**定时任务工具(schedule_task / list_tasks / cancel_task)
 * 已按用户决定下线。它们建的任务跑在用户电脑上、关机就不跑,而且那套界面早已隐藏,
 * 用户根本没地方看到成果。定时任务现在只有一条路:办公会话里的 `codepilot-routines`
 * (见 routines-mcp.ts),跑在沙箱服务器上。
 *
 * 留着它们的**真实危害**是模型挑错:两套工具名字相近、描述也像,而挑错的后果极其隐蔽 ——
 * 建成功了、用户也看到「已创建」,但它永远不会产出任何用户看得见的东西。
 *
 * 引擎 `task-scheduler.ts` 与 `/api/tasks/*` 暂留(设置页和项目页还在读),单独清理。
 *
 * Globally registered: available in all contexts (no keyword gating).
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/** Resolve base URL from PORT env, supporting worktree dev servers and Electron builds. */
function getBaseUrl(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export const NOTIFICATION_MCP_SYSTEM_PROMPT = `## 通知

- codepilot_notify: 立即发送通知给用户（支持系统通知和应用内提示）
- codepilot_hatch_buddy: 孵化或命名用户的助理伙伴

使用场景：
- 任务完成需要告知用户 → 用 codepilot_notify
- 用户说"孵化"、"领养"、"hatch" → 用 codepilot_hatch_buddy
- 用户给伙伴起名字 → 用 codepilot_hatch_buddy(buddyName: 名字)

注意：跑在用户本机的旧定时任务工具已下线（用户决定不再要）。用户提「每天/定时做某事」时，
只有**办公会话**能做到 —— 走 codepilot-routines，任务跑在沙箱服务器上、关机也照跑；
研发会话请如实说明做不了，不要临时拿别的工具凑。`;

export function createNotificationMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-notify',
    version: '1.0.0',
    tools: [
      // Tool 1: Immediate notification
      tool(
        'codepilot_notify',
        'Send an immediate notification to the user. Supports system notification, in-app toast, and Telegram (for urgent). Use when a task completes, something needs attention, or user asked to be notified.',
        {
          title: z.string().describe('Notification title'),
          body: z.string().describe('Notification body text'),
          priority: z.enum(['low', 'normal', 'urgent']).optional().default('normal')
            .describe('low=toast only, normal=toast+system, urgent=toast+system+telegram'),
        },
        async ({ title, body, priority }) => {
          try {
            const { sendNotification } = await import('@/lib/notification-manager');
            await sendNotification({ title, body, priority });
            return { content: [{ type: 'text' as const, text: `Notification sent: "${title}"` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to send notification: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 2: Hatch / name buddy
      tool(
        'codepilot_hatch_buddy',
        'Hatch a new buddy companion for the user, or update the buddy name. Call this when the user wants to adopt/hatch their buddy or give it a name.',
        {
          buddyName: z.string().optional().describe('Name for the buddy (user-given)'),
        },
        async ({ buddyName }) => {
          try {
            const res = await fetch(`${getBaseUrl()}/api/workspace/hatch-buddy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ buddyName: buddyName || '' }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.buddy) throw new Error('No buddy data');

            const b = data.buddy;
            const { SPECIES_LABEL, RARITY_DISPLAY, STAT_LABEL, SPECIES_IMAGE_URL, getBuddyTitle } = await import('@/lib/buddy');
            const speciesName = SPECIES_LABEL[b.species as keyof typeof SPECIES_LABEL]?.zh || b.species;
            const rarityInfo = RARITY_DISPLAY[b.rarity as keyof typeof RARITY_DISPLAY];
            const title = getBuddyTitle(b);
            const imageUrl = SPECIES_IMAGE_URL[b.species as keyof typeof SPECIES_IMAGE_URL] || '';
            const statsText = Object.entries(b.stats)
              .map(([stat, val]) => `${STAT_LABEL[stat as keyof typeof STAT_LABEL]?.zh || stat}: ${val}`)
              .join(' · ');

            const result = [
              data.alreadyHatched ? `Updated buddy name to "${buddyName}"` : `Hatched a new buddy!`,
              `Species: ${b.emoji} ${speciesName}`,
              `Rarity: ${rarityInfo?.stars || ''} ${rarityInfo?.label.zh || b.rarity}`,
              title ? `Title: "${title}"` : '',
              `Stats: ${statsText}`,
              `Peak: ${b.peakStat}`,
              imageUrl ? `Image: ${imageUrl}` : '',
              buddyName ? `Name: ${buddyName}` : '',
            ].filter(Boolean).join('\n');

            return { content: [{ type: 'text' as const, text: result }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to hatch buddy: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),
    ],
  });
}
