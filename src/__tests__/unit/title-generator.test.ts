import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTitlePrompt, parseTitleTag, TITLE_INPUT_MAX_CHARS } from '../../lib/title-generator';
import { shouldNotifyTurnCompletion, shouldNotifyPendingQuestion } from '../../lib/turn-notification-policy';

/**
 * Pure-logic tests for auto title generation (official-parity contract:
 * 4000-char input cap, <title>-tag-required parsing, silent failure) and the
 * notification suppression policy shared by turn-completion / ask-question
 * notifications.
 */

describe('buildTitlePrompt', () => {
  it('embeds the message inside the description tags', () => {
    const p = buildTitlePrompt('帮我写一个贪吃蛇小游戏');
    assert.ok(p.includes('<description>帮我写一个贪吃蛇小游戏</description>'));
  });

  it('truncates input to the official 4000-char cap', () => {
    const long = 'x'.repeat(TITLE_INPUT_MAX_CHARS + 500);
    const p = buildTitlePrompt(long);
    const inner = p.match(/<description>([\s\S]*)<\/description>/)![1];
    assert.equal(inner.length, TITLE_INPUT_MAX_CHARS);
  });
});

describe('parseTitleTag', () => {
  it('extracts a tagged title', () => {
    assert.equal(parseTitleTag('blah <title>贪吃蛇小游戏</title> blah'), '贪吃蛇小游戏');
  });

  it('collapses internal whitespace/newlines', () => {
    assert.equal(parseTitleTag('<title>Q3\n  financial   model</title>'), 'Q3 financial model');
  });

  it('rejects output without a title tag (official contract: no guess-parsing)', () => {
    assert.equal(parseTitleTag('Here is a nice title: snake game'), null);
  });

  it('rejects an empty tag', () => {
    assert.equal(parseTitleTag('<title>   </title>'), null);
  });

  it('clamps runaway titles to 60 chars + ellipsis', () => {
    const out = parseTitleTag(`<title>${'很'.repeat(80)}</title>`)!;
    assert.equal(out.length, 61);
    assert.ok(out.endsWith('…'));
  });
});

describe('notification suppression policy', () => {
  it('turn completion: suppressed only when focused AND viewing', () => {
    assert.equal(shouldNotifyTurnCompletion({ phase: 'completed', windowFocused: true, sessionVisible: true }), false);
    assert.equal(shouldNotifyTurnCompletion({ phase: 'completed', windowFocused: false, sessionVisible: true }), true);
    assert.equal(shouldNotifyTurnCompletion({ phase: 'completed', windowFocused: true, sessionVisible: false }), true);
    assert.equal(shouldNotifyTurnCompletion({ phase: 'stopped', windowFocused: false, sessionVisible: false }), false);
  });

  it('pending question: same suppression rule, no phase filter', () => {
    assert.equal(shouldNotifyPendingQuestion({ windowFocused: true, sessionVisible: true }), false);
    assert.equal(shouldNotifyPendingQuestion({ windowFocused: false, sessionVisible: true }), true);
    assert.equal(shouldNotifyPendingQuestion({ windowFocused: true, sessionVisible: false }), true);
  });
});
