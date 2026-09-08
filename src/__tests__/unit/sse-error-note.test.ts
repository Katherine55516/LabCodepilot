/**
 * Guards the delivery path for a classified SSE `error` frame.
 *
 * Field bug (packaged v4.2.0, managed gateway + Qwen3.8-Max): a turn died on
 * "API Error: Connection closed mid-response". error-classifier.ts classified
 * it correctly and claude-client.ts shipped the structured frame — but the
 * note was only ever appended to the FLAT accumulated text, which
 * stream-session-manager's buildFinalContentFromBlocks() consults solely as an
 * empty-blocks fallback. Every turn with a thinking or tool block (i.e. nearly
 * all of them) dropped it, and api/chat/route.ts never wrote it to the DB at
 * all. The user saw a reply that simply stopped mid-sentence, with a generic
 * "本轮已结束" chip and no error anywhere.
 *
 * Run with: npx tsx --test src/__tests__/unit/sse-error-note.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatSseErrorForDisplay,
  buildSseErrorNote,
  readSseErrorCategory,
  pushErrorNoteBlock,
  ERROR_NOTE_PREFIX,
} from '../../lib/sse-error-format';
import type { MessageContentBlock } from '../../types';
import { consumeSSEStream, type SSECallbacks } from '../../hooks/useSSEStream';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

/** The exact frame claude-client.ts emits for a gateway stream drop. */
const STREAM_DROP_FRAME = JSON.stringify({
  category: 'STREAM_DISCONNECTED',
  userMessage: '模型响应中途连接被断开（Qwen3.8-Max）。',
  actionHint: '通常是网关或服务商在长响应上超时断流。请重试。',
  retryable: true,
  providerName: 'Qwen3.8-Max',
});

function mockReader(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + '\n'));
  let idx = 0;
  return {
    read: async () => {
      if (idx >= chunks.length) return { done: true, value: undefined } as { done: true; value: undefined };
      return { done: false, value: chunks[idx++] } as { done: false; value: Uint8Array };
    },
    cancel: async () => {},
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

function noopCallbacks(overrides: Partial<SSECallbacks> = {}): SSECallbacks {
  return {
    onText: () => {},
    onToolUse: () => {},
    onToolResult: () => {},
    onToolOutput: () => {},
    onToolProgress: () => {},
    onStatus: () => {},
    onResult: () => {},
    onPermissionRequest: () => {},
    onToolTimeout: () => {},
    onModeChanged: () => {},
    onTaskUpdate: () => {},
    onRewindPoint: () => {},
    onKeepAlive: () => {},
    onError: () => {},
    ...overrides,
  };
}

describe('sse-error-format', () => {
  it('renders userMessage + action hint + details', () => {
    const out = formatSseErrorForDisplay(STREAM_DROP_FRAME);
    assert.ok(out.includes('模型响应中途连接被断开'), out);
    assert.ok(out.includes('**What to do:**'), out);
    assert.ok(out.includes('超时断流'), out);
  });

  it('renders recovery actions as links, skipping bare retry', () => {
    const out = formatSseErrorForDisplay(JSON.stringify({
      category: 'AUTH_REJECTED',
      userMessage: 'Auth failed.',
      recoveryActions: [
        { label: 'Docs', url: 'https://example.com' },
        { label: 'Settings', action: 'open_settings' },
        { label: 'New chat', action: 'new_conversation' },
        { label: 'Retry', action: 'retry' },
      ],
    }));
    assert.ok(out.includes('[Docs](https://example.com)'), out);
    assert.ok(out.includes('[Settings](/settings#providers)'), out);
    assert.ok(out.includes('[New chat](/chat)'), out);
    assert.ok(!out.includes('[Retry]'), 'bare retry is a chip action, not a link');
  });

  it('falls back to the raw frame for unstructured payloads', () => {
    assert.equal(formatSseErrorForDisplay('boom'), 'boom');
    assert.equal(formatSseErrorForDisplay('{"category":"X"}'), '{"category":"X"}');
    assert.equal(readSseErrorCategory('boom'), undefined);
  });

  it('exposes the classifier category and a prefixed note', () => {
    assert.equal(readSseErrorCategory(STREAM_DROP_FRAME), 'STREAM_DISCONNECTED');
    assert.ok(buildSseErrorNote(STREAM_DROP_FRAME).startsWith(ERROR_NOTE_PREFIX));
  });
});

describe('consumeSSEStream error frame', () => {
  it('hands the caller the isolated note and category, not just the merged text', async () => {
    let seen: { acc: string; note?: string; category?: string } | null = null;
    await consumeSSEStream(
      mockReader([
        `data: ${JSON.stringify({ type: 'text', data: '选 20VU 而非' })}`,
        `data: ${JSON.stringify({ type: 'error', data: STREAM_DROP_FRAME })}`,
        `data: ${JSON.stringify({ type: 'done', data: '' })}`,
      ]),
      noopCallbacks({
        onError: (acc, note, category) => { seen = { acc, note, category }; },
      }),
    );

    assert.ok(seen, 'onError must fire for an error frame');
    const got = seen as unknown as { acc: string; note?: string; category?: string };
    // The merged text keeps working for the flat/fallback path…
    assert.ok(got.acc.startsWith('选 20VU 而非'), got.acc);
    assert.ok(got.acc.includes('模型响应中途连接被断开'), got.acc);
    // …and the note arrives on its own so a block-based caller can append it.
    assert.ok(got.note && got.note.startsWith(ERROR_NOTE_PREFIX), String(got.note));
    assert.ok(got.note!.includes('模型响应中途连接被断开'), String(got.note));
    assert.equal(got.category, 'STREAM_DISCONNECTED');
  });
});

/**
 * The block-assembly logic (separator, flush order) lives in the shared module
 * and is tested for real below. What cannot be imported — buildFinalContentFromBlocks
 * is module-private, and the tee is inline in a Next route handler — is
 * source-scanned instead, same approach as terminal-reason-coverage.test.ts,
 * to catch a revert of the exact call sites that make the note reach the user.
 */
describe('error note reaches both the rendered message and the DB row', () => {
  it('the client success path feeds the note into the block builder', () => {
    const src = read('src/lib/stream-session-manager.ts');

    assert.match(
      src,
      /buildFinalContentFromBlocks\(\s*stream,\s*accumulated,\s*errorNote,?\s*\)/,
      'the success path must pass the error note into the block builder — ' +
        'the flat `accumulated` text is only used when there are no blocks at all',
    );
    assert.match(
      src,
      /const withNote[\s\S]{0,160}\{\s*type:\s*'text',\s*text:\s*note\s*\}/,
      'the builder must append the note as a trailing text block',
    );
    assert.match(
      src,
      /return JSON\.stringify\(withNote\)/,
      'the serialized block array must be the one that includes the note',
    );
    assert.ok(
      src.includes('if (note) stream.errorNote = note;'),
      'onError must capture the isolated note',
    );
  });

  it('the server tee calls the shared block appender', () => {
    const src = read('src/app/api/chat/route.ts');
    const errorBranch = src.slice(src.indexOf("event.type === 'error'"));
    const branchBody = errorBranch.slice(0, errorBranch.indexOf("event.type === 'result'"));
    assert.ok(
      branchBody.includes('pushErrorNoteBlock(contentBlocks, currentText, event.data)'),
      'the error branch must push the note into contentBlocks, not just set hasError — ' +
        'otherwise addMessage() writes a row with no trace of why the turn died',
    );
  });

  it('pushErrorNoteBlock flushes pending text, then appends the note last', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'thinking', thinking: '回归只需要一个固定负载点。' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
    ];
    const pending = pushErrorNoteBlock(blocks, '💡 选 20VU 而非', STREAM_DROP_FRAME);

    assert.equal(pending, '', 'pending text must be consumed, not persisted twice');
    assert.equal(blocks.length, 5, 'flushed text + note both appended');
    const flushed = blocks[3];
    const note = blocks[4];
    assert.deepEqual(flushed, { type: 'text', text: '💡 选 20VU 而非' });
    assert.equal(note.type, 'text');
    assert.ok(
      (note as { text: string }).text.includes('模型响应中途连接被断开'),
      'the note must carry the classified message',
    );
    assert.ok(
      (note as { text: string }).text.startsWith('\n\n'),
      'note needs its own separator — text blocks are joined with \'\' for text-only turns',
    );
  });

  it('pushErrorNoteBlock omits the separator when the note is the whole message', () => {
    const blocks: MessageContentBlock[] = [];
    pushErrorNoteBlock(blocks, '   ', STREAM_DROP_FRAME);
    assert.equal(blocks.length, 1, 'whitespace-only pending text is not flushed');
    assert.ok(
      (blocks[0] as { text: string }).text.startsWith(ERROR_NOTE_PREFIX),
      'no leading blank lines when nothing precedes the note',
    );
  });

  it('a text-only turn joins to a readable message, not a glued-on note', () => {
    // Mirrors route.ts: text-only turns are persisted with join('').
    const blocks: MessageContentBlock[] = [];
    pushErrorNoteBlock(blocks, '💡 选 20VU 而非', STREAM_DROP_FRAME);
    const joined = blocks
      .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    assert.ok(joined.startsWith('💡 选 20VU 而非'), joined);
    assert.ok(
      joined.includes('而非\n\n**Error:**'),
      `the note must not be glued onto the truncated sentence, got: ${joined}`,
    );
  });

  it('a transient stream drop keeps the CLI session id', () => {
    const src = read('src/lib/claude-client.ts');
    assert.ok(
      src.includes("const keepSdkSession = classified.category === 'STREAM_DISCONNECTED';"),
      'stream drops must not wipe a healthy CLI session — that forces a full ' +
        'DB-history replay on the next turn',
    );
    assert.match(
      src,
      /if \(sessionId && !keepSdkSession\)/,
      'the clear must be gated on that flag',
    );
  });
});
