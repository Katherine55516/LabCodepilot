/**
 * 分母统一 resolver 单测（src/lib/context-window-resolver.ts）。
 *
 * 背景（context-usage-accuracy-overhaul Phase 2B）：UI 与服务端压缩此前各持
 * 一条窗口解析链，managed 模型 id 在服务端 substring 命中 'opus' → 200K 而
 * UI 显示 1M，压缩在 ~160K 误触发。resolver 是两侧唯一入口。
 *
 * 覆盖：
 * - 优先级全链：[1m] 标记 > live 窗口 > 账号侧窗口 > 静态 catalog > null
 * - 回归：claude-opus-4-8 + 账号侧 1M 不再落到 catalog 的 200K
 * - upstream 消歧与 1M beta 开关直通 catalog 分支
 *
 * Run with: npx tsx --test src/__tests__/unit/context-window-resolver.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContextWindow } from '@/lib/context-window-resolver';

describe('resolveContextWindow · 优先级链', () => {
  it('[1m] 运行时模型名最高优先，压过其他一切来源', () => {
    assert.equal(
      resolveContextWindow({
        runtimeModelName: 'claude-opus-4-7[1m]',
        liveWindow: 200_000,
        accountWindow: 200_000,
        model: 'opus',
      }),
      1_000_000,
    );
  });

  it('live 窗口(2A 落库值)高于账号侧与 catalog', () => {
    assert.equal(
      resolveContextWindow({
        runtimeModelName: 'qwen-max',
        liveWindow: 1_000_000,
        accountWindow: 200_000,
        model: 'opus',
      }),
      1_000_000,
    );
  });

  it('无 live 时账号侧窗口生效 —— claude-opus-4-8 回归：不再 substring 落到 200K', () => {
    assert.equal(
      resolveContextWindow({
        accountWindow: 1_000_000, // managed 展示名表(高阶模型C48)
        model: 'claude-opus-4-8', // catalog substring 会命中 'opus' → 200K
      }),
      1_000_000,
    );
  });

  it('前三级都缺时回退静态 catalog（含 upstream 消歧）', () => {
    assert.equal(resolveContextWindow({ model: 'opus' }), 200_000);
    assert.equal(
      resolveContextWindow({ model: 'opus', upstreamModel: 'claude-opus-4-7' }),
      1_000_000,
    );
  });

  it('1M beta 开关直通 catalog 分支', () => {
    assert.equal(resolveContextWindow({ model: 'sonnet', context1m: true }), 1_000_000);
  });

  it('全部无法解析 → null（调用方兜底），0/负值不当有效窗口', () => {
    assert.equal(resolveContextWindow({ model: 'totally-unknown-model' }), null);
    assert.equal(
      resolveContextWindow({ liveWindow: 0, accountWindow: -1, model: 'unknown-x' }),
      null,
    );
  });
});
