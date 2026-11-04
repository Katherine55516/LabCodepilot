/**
 * Unit tests for electron/feedback-core.ts — 问题反馈纯逻辑核心。
 *
 * Pure module (no electron / fs), imported directly. Covers:
 * - message 归一化（trim / 空 / 超长）
 * - multipart 表单组装（字段齐全、日志 Blob 有/无、文件名固定 main.log、
 *   不含任何身份字段 — 身份以服务端 JWT claims 为准）
 * - postFeedback 状态码映射（201/401/413/429/500/网络异常）与 Bearer 注入
 *
 * Run with: npx tsx --test src/__tests__/unit/feedback-core.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FEEDBACK_MESSAGE_MAX,
  normalizeFeedbackMessage,
  buildFeedbackForm,
  postFeedback,
  isAllowedFeedbackImage,
} from '../../../electron/feedback-core';

const ENV = { appVersion: '1.9.0', platform: 'darwin', osVersion: '15.5' };

describe('normalizeFeedbackMessage', () => {
  it('trims surrounding whitespace', () => {
    assert.equal(normalizeFeedbackMessage('  导出没反应  '), '导出没反应');
  });

  it('rejects empty / whitespace-only / non-string', () => {
    assert.equal(normalizeFeedbackMessage(''), null);
    assert.equal(normalizeFeedbackMessage('   '), null);
    assert.equal(normalizeFeedbackMessage(undefined), null);
    assert.equal(normalizeFeedbackMessage(42), null);
  });

  it('rejects messages over the max length', () => {
    assert.equal(normalizeFeedbackMessage('x'.repeat(FEEDBACK_MESSAGE_MAX + 1)), null);
    assert.equal(
      normalizeFeedbackMessage('x'.repeat(FEEDBACK_MESSAGE_MAX)),
      'x'.repeat(FEEDBACK_MESSAGE_MAX),
    );
  });
});

describe('buildFeedbackForm', () => {
  it('includes message + env fields, no identity fields', () => {
    const form = buildFeedbackForm({ message: 'hello', env: ENV });
    assert.equal(form.get('message'), 'hello');
    assert.equal(form.get('app_version'), '1.9.0');
    assert.equal(form.get('platform'), 'darwin');
    assert.equal(form.get('os_version'), '15.5');
    // 身份字段绝不出现在表单里（服务端以 claims 为准）
    assert.equal(form.get('user_sub'), null);
    assert.equal(form.get('username'), null);
    assert.equal(form.get('email'), null);
    assert.equal(form.get('log'), null);
  });

  it('attaches the log as a Blob named main.log when bytes provided', async () => {
    const bytes = new TextEncoder().encode('[info] started\n');
    const form = buildFeedbackForm({ message: 'm', env: ENV, logBytes: bytes });
    const log = form.get('log');
    assert.ok(log instanceof Blob);
    assert.equal((log as File).name, 'main.log');
    assert.equal(await (log as Blob).text(), '[info] started\n');
  });

  it('omits the log field for null / empty bytes', () => {
    assert.equal(
      buildFeedbackForm({ message: 'm', env: ENV, logBytes: null }).get('log'),
      null,
    );
    assert.equal(
      buildFeedbackForm({ message: 'm', env: ENV, logBytes: new Uint8Array(0) }).get('log'),
      null,
    );
  });
});

describe('feedback images', () => {
  it('allows only the four supported raster types', () => {
    for (const ok of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      assert.equal(isAllowedFeedbackImage(ok), true);
    }
    // SVG 是可执行 XML —— 管理端展示会成为 XSS 面，刻意不支持
    assert.equal(isAllowedFeedbackImage('image/svg+xml'), false);
    assert.equal(isAllowedFeedbackImage('text/html'), false);
    assert.equal(isAllowedFeedbackImage(''), false);
  });

  it('appends every image under the same field name, in order', async () => {
    const form = buildFeedbackForm({
      message: 'm',
      env: ENV,
      images: [
        { name: 'a.png', type: 'image/png', data: new Uint8Array([1, 2, 3]) },
        { name: 'b.jpg', type: 'image/jpeg', data: new Uint8Array([4, 5]) },
      ],
    });
    const all = form.getAll('images');
    assert.equal(all.length, 2);
    assert.equal((all[0] as File).name, 'a.png');
    assert.equal((all[1] as File).name, 'b.jpg');
    assert.equal((all[0] as Blob).type, 'image/png');
    assert.equal((await (all[0] as Blob).arrayBuffer()).byteLength, 3);
    assert.equal((await (all[1] as Blob).arrayBuffer()).byteLength, 2);
  });

  it('accepts ArrayBuffer payloads (the IPC wire form)', async () => {
    const buf = new Uint8Array([9, 9]).buffer;
    const form = buildFeedbackForm({
      message: 'm',
      env: ENV,
      images: [{ name: 's.png', type: 'image/png', data: buf }],
    });
    assert.equal((await (form.get('images') as Blob).arrayBuffer()).byteLength, 2);
  });

  it('skips empty payloads and omits the field when there are no images', () => {
    assert.equal(buildFeedbackForm({ message: 'm', env: ENV }).get('images'), null);
    assert.equal(
      buildFeedbackForm({
        message: 'm',
        env: ENV,
        images: [{ name: 'x.png', type: 'image/png', data: new Uint8Array(0) }],
      }).get('images'),
      null,
    );
  });
});

describe('postFeedback', () => {
  const captured: { url?: string; init?: RequestInit } = {};

  function fakeFetch(status: number, body?: unknown): typeof fetch {
    return (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  const form = buildFeedbackForm({ message: 'm', env: ENV });

  it('maps 201 to ok with id and sends Bearer + multipart to the right path', async () => {
    const impl = fakeFetch(201, { id: 'abc-123' });
    const r = await postFeedback({ baseUrl: 'https://api.example.com', token: 'tok-1', form, fetchImpl: impl });
    assert.deepEqual(r, { ok: true, id: 'abc-123' });
    assert.equal(captured.url, 'https://api.example.com/api/v1/feedback');
    assert.equal(
      (captured.init?.headers as Record<string, string>).Authorization,
      'Bearer tok-1',
    );
    assert.ok(captured.init?.body instanceof FormData);
  });

  it('maps auth / size / rate-limit / server statuses', async () => {
    for (const [status, error] of [
      [401, 'not-logged-in'],
      [413, 'too-large'],
      [429, 'rate-limited'],
      [500, 'server'],
    ] as const) {
      const r = await postFeedback({ baseUrl: 'http://b', token: 't', form, fetchImpl: fakeFetch(status) });
      assert.deepEqual(r, { ok: false, error, status });
    }
  });

  it('maps 422 to invalid-image, but keeps message errors distinct', async () => {
    const imgErr = await postFeedback({
      baseUrl: 'http://b', token: 't', form,
      fetchImpl: fakeFetch(422, { detail: 'unsupported image format (png/jpeg/gif/webp only)' }),
    });
    assert.deepEqual(imgErr, { ok: false, error: 'invalid-image', status: 422 });

    const msgErr = await postFeedback({
      baseUrl: 'http://b', token: 't', form,
      fetchImpl: fakeFetch(422, { detail: 'message must be 1-5000 characters' }),
    });
    assert.deepEqual(msgErr, { ok: false, error: 'invalid-message', status: 422 });
  });

  it('maps thrown fetch errors to network', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await postFeedback({ baseUrl: 'http://b', token: 't', form, fetchImpl: impl });
    assert.deepEqual(r, { ok: false, error: 'network' });
  });
});
