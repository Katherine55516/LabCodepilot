/**
 * Unit tests for src/lib/crypto-seal.ts — AES-256-GCM seal/open + key sourcing.
 *
 * Run with: npx tsx --test src/__tests__/unit/crypto-seal.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { seal, open, isSealed, getKey } from '../../lib/crypto-seal';

const KEY = crypto.createHash('sha256').update('test-master-key').digest(); // 32B
const KEY2 = crypto.createHash('sha256').update('other-master-key').digest();

describe('seal / open round-trip', () => {
  it('round-trips a secret with the same key', () => {
    const plain = 'sk-ant-supersecret-0123456789';
    const sealed = seal(plain, KEY);
    assert.ok(sealed.startsWith('enc:v1:'));
    assert.notEqual(sealed, plain);
    assert.equal(open(sealed, KEY), plain);
  });

  it('uses a fresh IV each call (ciphertext differs, both decrypt equal)', () => {
    const plain = 'anl_sess_repeat';
    const a = seal(plain, KEY);
    const b = seal(plain, KEY);
    assert.notEqual(a, b, 'two seals of same plaintext must differ (random IV)');
    assert.equal(open(a, KEY), plain);
    assert.equal(open(b, KEY), plain);
  });

  it('handles unicode / json payloads', () => {
    const plain = JSON.stringify({ token: 'abc', 名称: '测试', n: 42 });
    assert.equal(open(seal(plain, KEY), KEY), plain);
  });
});

describe('seal short-circuits', () => {
  it('empty string is never sealed (preserves != "" semantics)', () => {
    assert.equal(seal('', KEY), '');
    assert.equal(isSealed(seal('', KEY)), false);
  });

  it('no key → plaintext passthrough', () => {
    assert.equal(seal('plain-token', null), 'plain-token');
    assert.equal(isSealed(seal('plain-token', null)), false);
  });
});

describe('open fail-safe', () => {
  it('legacy plaintext (no prefix) returns unchanged — silent migration probe', () => {
    assert.equal(open('sk-legacy-plaintext', KEY), 'sk-legacy-plaintext');
    assert.equal(open('', KEY), '');
    assert.equal(open('{}', KEY), '{}');
  });

  it('sealed but no key → "" (never returns ciphertext)', () => {
    const sealed = seal('secret', KEY);
    assert.equal(open(sealed, null), '');
  });

  it('sealed with the WRONG key → "" (GCM auth fails)', () => {
    const sealed = seal('secret', KEY);
    assert.equal(open(sealed, KEY2), '');
  });

  it('tampered ciphertext → "" (GCM integrity)', () => {
    const sealed = seal('secret-value', KEY);
    // Flip a byte in the base64 body
    const body = sealed.slice('enc:v1:'.length);
    const buf = Buffer.from(body, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = 'enc:v1:' + buf.toString('base64');
    assert.equal(open(tampered, KEY), '');
  });
});

describe('isSealed', () => {
  it('detects the magic prefix', () => {
    assert.equal(isSealed(seal('x', KEY)), true);
    assert.equal(isSealed('enc:v1:whatever'), true);
    assert.equal(isSealed('plain'), false);
    assert.equal(isSealed(''), false);
    assert.equal(isSealed(undefined), false);
    assert.equal(isSealed(123 as unknown), false);
  });
});

describe('getKey (env-based)', () => {
  const ORIG = process.env.CLAUDE_GUI_SECRET_KEY;
  const after = () => {
    if (ORIG === undefined) delete process.env.CLAUDE_GUI_SECRET_KEY;
    else process.env.CLAUDE_GUI_SECRET_KEY = ORIG;
  };

  it('parses a valid 64-hex env into a 32-byte Buffer', () => {
    const hex = KEY.toString('hex');
    process.env.CLAUDE_GUI_SECRET_KEY = hex;
    const k = getKey();
    assert.ok(k);
    assert.equal(k!.length, 32);
    assert.equal(k!.toString('hex'), hex);
    after();
  });

  it('returns null for missing / malformed env', () => {
    delete process.env.CLAUDE_GUI_SECRET_KEY;
    assert.equal(getKey(), null);
    process.env.CLAUDE_GUI_SECRET_KEY = 'not-hex';
    assert.equal(getKey(), null);
    process.env.CLAUDE_GUI_SECRET_KEY = 'abcd'; // too short
    assert.equal(getKey(), null);
    after();
  });

  it('end-to-end via getKey: seal then open round-trips', () => {
    process.env.CLAUDE_GUI_SECRET_KEY = KEY.toString('hex');
    const k = getKey();
    assert.equal(open(seal('round', k), getKey()), 'round');
    after();
  });
});
