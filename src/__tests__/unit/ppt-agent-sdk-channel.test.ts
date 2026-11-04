/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures exercise SDK errors and partial jobs. */
// The PPT model channel through AIMate's Claude Agent SDK helper (the user,
// 2026-11-03; Fable Q1-Q5): Anthropic-protocol providers use the SDK unless
// forced direct; image jobs stay direct; an SDK machinery failure falls back
// once; at most three SDK calls run at a time.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-sdk-channel-'));
process.env.CLAUDE_GUI_DATA_DIR = dir;
process.env.CLAUDE_GUI_SECRET_KEY = 'b'.repeat(64);
/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const worker = require('../../lib/ppt-desktop-model-worker') as typeof import('../../lib/ppt-desktop-model-worker');
after(() => { db.closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });
const job = (extra: any = {}) => ({ id: 'a'.repeat(32), configId: 'byok:p1', model: 'qwen3.8-max', prompt: 'Write the cards.', lease: 'l', options: { stage: 'outline:cards', jsonSchema: { type: 'object', properties: { pages: { type: 'array' } } }, ...extra } }) as any;
describe('PPT Agent SDK channel', () => {
  it('routes Anthropic-protocol providers through the SDK, everything else direct', () => {
    assert.equal(worker.pptModelChannel(job(), { protocol: 'anthropic' }, undefined), 'agent_sdk');
    assert.equal(worker.pptModelChannel(job(), { protocol: 'openai-compatible' }, undefined), 'direct', 'AIMate runs openai-compatible providers natively only');
    assert.equal(worker.pptModelChannel(job(), { protocol: 'anthropic' }, 'direct'), 'direct', 'the setting forces direct');
    assert.equal(worker.pptModelChannel(job({ images: [{ id: 'f', dataUrl: 'data:image/png;base64,AA' }] }), { protocol: 'anthropic' }, undefined), 'direct', 'figure reads stay direct');
  });
  it('sends the job as one schema-constrained SDK query and names model failures', async () => {
    let seen: any;
    const ok = await worker.agentSdkGenerate(job(), 'p1', { generateTextViaSdk: async (params) => { seen = params; return '{"pages":[]}'; } });
    assert.equal(ok.text, '{"pages":[]}'); assert.equal(ok.telemetry?.outputMode, 'agent_sdk_schema');
    assert.equal(seen.providerId, 'p1'); assert.equal(seen.model, 'qwen3.8-max'); assert.equal(seen.outputFormat.type, 'json_schema'); assert.equal(seen.timeoutMs, 240000);
    await assert.rejects(worker.agentSdkGenerate(job(), 'p1', { generateTextViaSdk: async () => { throw new Error('SDK query timed out after 240s'); } }), (e: any) => e.code === 'timeout');
    await assert.rejects(worker.agentSdkGenerate(job(), 'p1', { generateTextViaSdk: async () => { throw new Error('Not logged in · Please run /login'); } }), (e: any) => e.code === 'auth');
    await assert.rejects(worker.agentSdkGenerate(job(), 'p1', { generateTextViaSdk: async () => '  ' }), (e: any) => e.code === 'empty_visible_output');
  });
  it('treats only the SDK machinery as a reason to fall back', () => {
    assert.equal(worker.sdkInfrastructureFailure(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })), true);
    assert.equal(worker.sdkInfrastructureFailure(new Error('Claude Code process exited with code 1')), true);
    assert.equal(worker.sdkInfrastructureFailure(Object.assign(new Error('x'), { code: 'timeout' })), false);
    assert.equal(worker.sdkInfrastructureFailure(Object.assign(new Error('Not logged in'), { code: 'auth' })), false);
  });
  it('runs at most three SDK calls at once', async () => {
    let active = 0, peak = 0;
    const work = () => worker.withSdkSlot(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active--; return 1; });
    await Promise.all(Array.from({ length: 8 }, work));
    assert.equal(peak, worker.PPT_AGENT_SDK_CONCURRENCY);
  });
});
