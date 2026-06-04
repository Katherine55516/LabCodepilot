/**
 * Unit tests for bridge channel-router model/provider self-heal.
 *
 * Bridge sessions must follow the current 「桥接默认设置」: changing
 * bridge_default_model / bridge_default_provider_id applies to existing
 * bindings on the next inbound message (resolve()), not just new ones.
 *
 * Uses a real sqlite db isolated via CLAUDE_GUI_DATA_DIR + require() (so db.ts
 * picks up the temp dir at module load). Mirrors db-encryption.test.ts.
 *
 * Run with: npx tsx --test src/__tests__/unit/channel-router.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-chrouter-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
const WORK_DIR = path.join(tmpDir, 'work');
fs.mkdirSync(WORK_DIR, { recursive: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const { getDb, setSetting, getSession } = require('../../lib/db') as typeof import('../../lib/db');
const { resolve, createBinding } = require('../../lib/bridge/channel-router') as typeof import('../../lib/bridge/channel-router');
type ChannelAddress = import('../../lib/bridge/types').ChannelAddress;

before(() => {
  getDb();
  setSetting('bridge_default_work_dir', WORK_DIR); // 存在的目录,避免 cwd 回退
});
after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function addr(chatId: string): ChannelAddress {
  return { channelType: 'telegram', chatId, displayName: chatId };
}

describe('channel-router model/provider 自愈', () => {
  it('createBinding 固化当前桥接默认模型', () => {
    setSetting('bridge_default_model', 'model-A');
    const b = createBinding(addr('chat-1'));
    assert.equal(b.model, 'model-A');
    assert.equal(getSession(b.codepilotSessionId)!.model, 'model-A');
  });

  it('改桥接默认模型后,resolve 让已有会话跟随(复用同一 session)', () => {
    setSetting('bridge_default_model', 'model-A');
    const b1 = createBinding(addr('chat-2'));
    assert.equal(b1.model, 'model-A');

    setSetting('bridge_default_model', 'model-B');
    const b2 = resolve(addr('chat-2'));
    assert.equal(b2.codepilotSessionId, b1.codepilotSessionId, '复用同一会话');
    assert.equal(b2.model, 'model-B', 'binding 跟随新默认');
    assert.equal(getSession(b2.codepilotSessionId)!.model, 'model-B', 'session 跟随新默认');
  });

  it('provider 同步跟随', () => {
    setSetting('bridge_default_model', 'm1');
    setSetting('bridge_default_provider_id', 'prov-A');
    const b1 = createBinding(addr('chat-3'));
    assert.equal(b1.providerId, 'prov-A');

    setSetting('bridge_default_provider_id', 'prov-B');
    const b2 = resolve(addr('chat-3'));
    assert.equal(b2.providerId, 'prov-B');
    assert.equal(getSession(b2.codepilotSessionId)!.provider_id, 'prov-B');
  });

  it('桥接默认模型为空时不覆盖已有绑定', () => {
    setSetting('bridge_default_model', 'keep-me');
    setSetting('bridge_default_provider_id', '');
    const b1 = createBinding(addr('chat-4'));
    assert.equal(b1.model, 'keep-me');

    setSetting('bridge_default_model', ''); // 清空默认
    const b2 = resolve(addr('chat-4'));
    assert.equal(b2.model, 'keep-me', '为空时保留原 binding model');
    assert.equal(getSession(b2.codepilotSessionId)!.model, 'keep-me');
  });
});
