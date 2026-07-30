import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitSessionsByWorkspaceTab } from '@/components/layout/chat-list-utils';
import type { ChatSession } from '@/types';

/**
 * E3「办公 / 研发」双栏的纯逻辑单测(cowork-office-mode.md)。
 * UI 接线(tab 渲染 gate / 新建流 / 空态卡)由 dev+CDP 验证。
 */

function sess(id: string, sandbox: number | undefined, updatedAt: string): ChatSession {
  return {
    id,
    title: id,
    created_at: updatedAt,
    updated_at: updatedAt,
    working_directory: sandbox ? '' : `/proj/${id}`,
    sandbox_enabled: sandbox,
  } as ChatSession;
}

describe('chat-list-utils: splitSessionsByWorkspaceTab', () => {
  it('partitions by sandbox_enabled (1 → office, 0/undefined → dev)', () => {
    const { office, dev } = splitSessionsByWorkspaceTab([
      sess('a', 1, '2026-07-13 10:00:00'),
      sess('b', 0, '2026-07-13 09:00:00'),
      sess('c', undefined, '2026-07-13 08:00:00'),
    ]);
    assert.deepEqual(office.map((s) => s.id), ['a']);
    assert.deepEqual(dev.map((s) => s.id), ['b', 'c']);
  });

  it('sorts office flat list by updated_at DESC regardless of input order', () => {
    const { office } = splitSessionsByWorkspaceTab([
      sess('old', 1, '2026-07-10 08:00:00'),
      sess('new', 1, '2026-07-13 12:00:00'),
      sess('mid', 1, '2026-07-12 12:00:00'),
    ]);
    assert.deepEqual(office.map((s) => s.id), ['new', 'mid', 'old']);
  });

  it('preserves dev input order (project grouping happens downstream)', () => {
    const { dev } = splitSessionsByWorkspaceTab([
      sess('x', 0, '2026-07-10 08:00:00'),
      sess('y', 0, '2026-07-13 12:00:00'),
    ]);
    assert.deepEqual(dev.map((s) => s.id), ['x', 'y']);
  });

  it('handles empty input', () => {
    assert.deepEqual(splitSessionsByWorkspaceTab([]), { office: [], dev: [] });
  });
});
