/**
 * registerPendingPermission 的 5 分钟超时诊断。
 *
 * 背景:线上日志里出现过 84 次「timed out after 300s」,但那条日志只带一个请求 id,
 * 既不知道是哪个会话/哪个工具,也分不清两种根因完全不同的故障:
 *   a) SSE 通道已关 → 前端压根没收到提示,5 分钟等待纯属白等;
 *   b) 前端收到了、弹窗也在,只是没人点。
 * 这里锁住超时日志里的上下文输出,避免以后被改回没有信息量的版本。
 *
 * 用 node:test 内置假时钟推进 5 分钟,不真等。
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerPendingPermission } from '@/lib/permission-registry';

/** 接管 console.warn,返回捕获到的行 + 还原函数。 */
function captureWarn(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.warn = original; } };
}

describe('permission-registry: 超时日志带诊断上下文', () => {
  it('通道已关时标注「前端不可能看到」,并带上 tool/session', async () => {
    const warn = captureWarn();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = registerPendingPermission(
        'perm-test-closed',
        { command: 'ls' },
        undefined,
        { sessionId: 'sess-abc', toolName: 'Bash', deliveredToClient: false },
      );

      mock.timers.tick(5 * 60 * 1000);
      const result = await pending;

      // 超时语义不变:自动拒绝。
      assert.equal(result.behavior, 'deny');

      const line = warn.lines.find((l) => l.includes('perm-test-closed'));
      assert.ok(line, '应当有一条超时日志');
      assert.match(line!, /timed out after 300s/);
      assert.match(line!, /tool=Bash/);
      assert.match(line!, /session=sess-abc/);
      assert.match(line!, /已投递前端=否/);
    } finally {
      mock.timers.reset();
      warn.restore();
    }
  });

  it('通道正常时标注「已投递=是」—— 说明是没人点,而不是没收到', async () => {
    const warn = captureWarn();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = registerPendingPermission(
        'perm-test-delivered',
        {},
        undefined,
        { sessionId: 'sess-xyz', toolName: 'Write', deliveredToClient: true },
      );

      mock.timers.tick(5 * 60 * 1000);
      await pending;

      const line = warn.lines.find((l) => l.includes('perm-test-delivered'));
      assert.ok(line, '应当有一条超时日志');
      assert.match(line!, /已投递前端=是/);
      assert.doesNotMatch(line!, /SSE 通道已关/);
    } finally {
      mock.timers.reset();
      warn.restore();
    }
  });

  it('不传 meta 时退回原始格式(老调用点不受影响)', async () => {
    const warn = captureWarn();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = registerPendingPermission('perm-test-nometa', {});
      mock.timers.tick(5 * 60 * 1000);
      await pending;

      const line = warn.lines.find((l) => l.includes('perm-test-nometa'));
      assert.ok(line, '应当有一条超时日志');
      assert.match(line!, /timed out after 300s$/);
    } finally {
      mock.timers.reset();
      warn.restore();
    }
  });
});
