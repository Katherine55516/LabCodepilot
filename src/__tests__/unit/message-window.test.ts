/**
 * Unit tests for trimMessageWindow — the chat-history retention window
 * (count + byte cap) used by ChatView's cappedSetMessages (memory-leak fix #3).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trimMessageWindow } from '../../lib/message-window';

const msg = (id: string, content: string) => ({ id, content });

describe('trimMessageWindow', () => {
  it('returns the same array reference when under both caps (no needless re-render)', () => {
    const msgs = [msg('a', 'x'), msg('b', 'y')];
    const out = trimMessageWindow(msgs, 300, 1000);
    assert.equal(out.didTrim, false);
    assert.equal(out.trimmed, msgs); // same reference
  });

  it('handles an empty array', () => {
    const msgs: { content?: string }[] = [];
    const out = trimMessageWindow(msgs, 300, 1000);
    assert.equal(out.didTrim, false);
    assert.equal(out.trimmed, msgs);
  });

  it('trims the head (oldest) when count exceeds maxCount, keeping the newest', () => {
    const msgs = Array.from({ length: 305 }, (_, i) => msg(`m${i}`, 'tiny'));
    const out = trimMessageWindow(msgs, 300, 100 * 1024 * 1024);
    assert.equal(out.didTrim, true);
    assert.equal(out.trimmed.length, 300);
    assert.equal(out.trimmed[out.trimmed.length - 1].id, 'm304'); // newest kept
    assert.equal(out.trimmed[0].id, 'm5'); // oldest 5 evicted
  });

  it('trims earlier than the count cap when the byte budget is exceeded', () => {
    // 10 messages of 1MB each; budget 3MB → keep only the newest 3.
    const oneMB = 'a'.repeat(1024 * 1024);
    const msgs = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, oneMB));
    const out = trimMessageWindow(msgs, 300, 3 * 1024 * 1024);
    assert.equal(out.didTrim, true);
    assert.equal(out.trimmed.length, 3);
    assert.equal(out.trimmed[out.trimmed.length - 1].id, 'm9');
    assert.equal(out.trimmed[0].id, 'm7');
  });

  it('always keeps at least the single newest message even if it alone exceeds the byte budget', () => {
    const huge = 'a'.repeat(30 * 1024 * 1024); // 30MB
    const msgs = [msg('old', 'small'), msg('newest-huge', huge)];
    const out = trimMessageWindow(msgs, 300, 24 * 1024 * 1024); // 24MB budget
    assert.equal(out.didTrim, true);
    assert.equal(out.trimmed.length, 1);
    assert.equal(out.trimmed[0].id, 'newest-huge');
  });

  it('treats null/undefined content as zero bytes without throwing', () => {
    const msgs = [
      { id: 'a', content: null },
      { id: 'b', content: undefined },
      { id: 'c', content: 'hi' },
    ];
    const out = trimMessageWindow(msgs, 300, 1000);
    assert.equal(out.didTrim, false);
    assert.equal(out.trimmed.length, 3);
  });
});
