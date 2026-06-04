/**
 * Unit tests for electron/auth/config-crypto.ts — decryption of the encrypted
 * configs endpoint's auth_token (AES-256-GCM, key = SHA-256(passphrase)).
 *
 * The `encrypt()` helper mirrors the server's algorithm (文档/config-delivery-api.md
 * §4) so a round-trip proves client/server compatibility. config-crypto.ts has
 * no electron deps, so it runs under tsx directly.
 *
 * Run with: npx tsx --test src/__tests__/unit/config-crypto.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { decryptAuthToken, decryptConfigAuthTokens } from '../../../electron/auth/config-crypto';
import type { ModelConfig } from '../../../electron/auth/types';

/** Server-side algorithm: nonce(12) ‖ ciphertext ‖ tag(16), base64. */
function encrypt(plaintext: string, passphrase = 'ZJH2026'): string {
  const key = crypto.createHash('sha256').update(passphrase, 'utf8').digest();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]).toString('base64');
}

function makeConfig(over: Partial<ModelConfig>): ModelConfig {
  return {
    id: 'id', name: 'n', description: '', base_url: '', auth_token: '',
    model: '', default_opus_model: '', default_sonnet_model: '', default_haiku_model: '',
    subagent_model: '', effort_level: '', extra: {}, sort_order: 0, ...over,
  };
}

describe('decryptAuthToken', () => {
  it('round-trips a key encrypted with the default passphrase (server-compatible)', () => {
    const plain = 'sk-anlcode-abc123xyz-0987654321';
    const blob = encrypt(plain);
    assert.notEqual(blob, plain);
    assert.equal(decryptAuthToken(blob), plain);
  });

  it('empty string → "" (空 key 不加密)', () => {
    assert.equal(decryptAuthToken(''), '');
  });

  it('throws on too-short / tampered ciphertext', () => {
    assert.throws(() => decryptAuthToken('aGVsbG8=')); // "hello" base64, < 28B
    const good = Buffer.from(encrypt('sk-x'), 'base64');
    good[good.length - 1] ^= 0xff; // flip a tag byte
    assert.throws(() => decryptAuthToken(good.toString('base64')));
  });

  it('honours ANLCODE_CONFIG_SECRET env override', () => {
    const ORIG = process.env.ANLCODE_CONFIG_SECRET;
    process.env.ANLCODE_CONFIG_SECRET = 'custom-pass-2026';
    try {
      const plain = 'sk-custom-key';
      assert.equal(decryptAuthToken(encrypt(plain, 'custom-pass-2026')), plain);
      // Ciphertext made with the default passphrase must NOT decrypt under the override.
      assert.throws(() => decryptAuthToken(encrypt(plain, 'ZJH2026')));
    } finally {
      if (ORIG === undefined) delete process.env.ANLCODE_CONFIG_SECRET;
      else process.env.ANLCODE_CONFIG_SECRET = ORIG;
    }
  });
});

describe('decryptConfigAuthTokens', () => {
  it('decrypts each config, leaves other fields untouched', () => {
    const configs = [
      makeConfig({ id: 'a', name: 'A', base_url: 'https://a', auth_token: encrypt('sk-a') }),
      makeConfig({ id: 'b', name: 'B', auth_token: encrypt('sk-b') }),
    ];
    const out = decryptConfigAuthTokens(configs);
    assert.equal(out[0].auth_token, 'sk-a');
    assert.equal(out[1].auth_token, 'sk-b');
    assert.equal(out[0].base_url, 'https://a');
    assert.equal(out[0].id, 'a');
  });

  it('empty auth_token is skipped (stays "")', () => {
    const out = decryptConfigAuthTokens([makeConfig({ auth_token: '' })]);
    assert.equal(out[0].auth_token, '');
  });

  it('single bad token → "" (fail-safe), others unaffected', () => {
    const configs = [
      makeConfig({ id: 'good', auth_token: encrypt('sk-good') }),
      makeConfig({ id: 'bad', auth_token: 'not-valid-ciphertext!!!' }),
      makeConfig({ id: 'good2', auth_token: encrypt('sk-good2') }),
    ];
    const out = decryptConfigAuthTokens(configs);
    assert.equal(out[0].auth_token, 'sk-good');
    assert.equal(out[1].auth_token, ''); // bad one neutralised
    assert.equal(out[2].auth_token, 'sk-good2'); // later ones still decrypt
  });
});
