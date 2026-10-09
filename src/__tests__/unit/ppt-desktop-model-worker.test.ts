import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-byok-'));
process.env.CLAUDE_GUI_DATA_DIR = dir;
process.env.CLAUDE_GUI_SECRET_KEY = 'a'.repeat(64);
/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const { executeDesktopModelJob } = require('../../lib/ppt-desktop-model-worker') as typeof import('../../lib/ppt-desktop-model-worker');
after(() => { db.closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });
describe('PPT desktop model worker', () => {
  it('retains encrypted BYOK across startup and uses real SDK Chat Completions against a local fixture', async () => {
    let actualPath = ''; let requestedModel = ''; let auth = '';
    const server = http.createServer(async (req, res) => {
      actualPath = req.url || ''; auth = req.headers.authorization || '';
      const parts: Buffer[] = []; for await (const chunk of req) parts.push(chunk);
      const body = JSON.parse(Buffer.concat(parts).toString()); requestedModel = body.model;
      assert.equal(body.messages[0].content, 'Server-owned prompt');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: '{"slides":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const provider = db.createProvider({ name: 'Fixture', provider_type: 'custom', protocol: 'openai-compatible', base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test-only-not-real', role_models_json: JSON.stringify({ default: 'ppt应用测试' }) });
      const raw = db.getDb().prepare('SELECT api_key FROM api_providers WHERE id=?').get(provider.id) as { api_key: string };
      assert.ok(raw.api_key.startsWith('enc:v1:')); assert.ok(!raw.api_key.includes('test-only-not-real'));
      const { providerRequiresNative, predictNativeRuntime, resolveRuntime, registerRuntime } = require('../../lib/runtime/registry') as typeof import('../../lib/runtime/registry');
      const native = { id: 'native', isAvailable: () => true } as import('../../lib/runtime/types').AgentRuntime;
      registerRuntime(native);
      assert.equal(providerRequiresNative(provider.id), true);
      assert.equal(predictNativeRuntime(provider.id), true);
      assert.equal(resolveRuntime('claude-code-sdk', provider.id).id, 'native', 'unsupported wire protocol must not enter Claude Code');
      db.closeDb(); assert.equal(db.getProvider(provider.id)?.api_key, 'test-only-not-real', 'startup must not delete OpenAI-compatible provider');
      const id = 'a'.repeat(32); let complete: Record<string, unknown> = {};
      const result = await executeDesktopModelJob(id, async (route, body) => {
        if (route.endsWith('/claim')) return Response.json({ id, configId: `byok:${provider.id}`, model: 'ppt应用测试', prompt: 'Server-owned prompt', lease: 'nonce' });
        complete = body as Record<string, unknown>; return Response.json({ ok: true });
      });
      assert.equal(result.status, 200); assert.equal(actualPath, '/v1/chat/completions');
      assert.equal(requestedModel, 'ppt应用测试'); assert.equal(auth, 'Bearer test-only-not-real');
      assert.equal(complete.text, '{"slides":[]}'); assert.equal(complete.lease, 'nonce');
      assert.ok(!JSON.stringify(complete).includes('test-only-not-real'));
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('rejects managed/unknown providers and never sends SDK errors or credentials back', async () => {
    const id = 'b'.repeat(32); let invoked = false; let completed: unknown;
    const response = await executeDesktopModelJob(id, async (route, body) => {
      if (route.endsWith('/claim')) return Response.json({ id, configId: 'managed-other', model: 'model', prompt: 'prompt', lease: 'nonce' });
      completed = body; return Response.json({ ok: true });
    }, async () => { invoked = true; throw new Error('SECRET'); });
    assert.equal(invoked, false); assert.equal(response.status, 502); assert.ok(!JSON.stringify(completed).includes('SECRET'));
    const unavailable = await executeDesktopModelJob(id, async () => Response.json({}, { status: 409 }));
    assert.equal(unavailable.status, 409);
    assert.equal((await executeDesktopModelJob('../path', async () => { throw new Error('must not fetch'); })).status, 400);
  });
});
