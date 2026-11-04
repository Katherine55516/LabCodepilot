import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, REDACTION_PLACEHOLDER as R } from '../../../electron/log-scrub';

describe('scrubSecrets — exact known-value redaction (layer 1)', () => {
  it('redacts a known secret value verbatim, even when it matches no pattern', () => {
    const secret = 'Pzq-store-Value-9921'; // not sk-/Bearer/hex shaped
    const out = scrubSecrets(`provider key = ${secret} loaded`, [secret]);
    assert.ok(!out.includes(secret), 'raw secret must be gone');
    assert.ok(out.includes(R), 'placeholder must be present');
    assert.ok(out.includes('loaded'), 'surrounding text preserved');
  });

  it('redacts the 64-hex master key passed as a known value', () => {
    const masterKey = 'ab12cd34'.repeat(8); // 64 hex chars
    const out = scrubSecrets(`CLAUDE_GUI_SECRET_KEY=${masterKey}`, [masterKey]);
    assert.ok(!out.includes(masterKey));
  });

  it('does NOT redact a short known value (< 8 chars) to avoid over-redaction', () => {
    const out = scrubSecrets('value is abc', ['abc']);
    assert.equal(out, 'value is abc');
  });
});

describe('scrubSecrets — pattern redaction (layer 2)', () => {
  it('redacts Bearer tokens but keeps the "Bearer " prefix', () => {
    const out = scrubSecrets('header Bearer sk-abc123def456ghi789xyz');
    assert.ok(!out.includes('sk-abc123def456ghi789xyz'));
    assert.match(out, /Bearer /);
  });

  it('redacts sk-ant and sk- API keys', () => {
    const out1 = scrubSecrets('key sk-ant-api03-AAAAbbbbCCCCdddd1234');
    assert.ok(!out1.includes('AAAAbbbbCCCCdddd1234'));
    const out2 = scrubSecrets('key sk-proj-1234567890abcdefABCDEF');
    assert.ok(!out2.includes('567890abcdefABCDEF'));
  });

  it('redacts an Authorization / x-api-key header value', () => {
    const out = scrubSecrets('x-api-key: deadbeefcafef00d12345678');
    assert.ok(!out.includes('deadbeefcafef00d12345678'));
    assert.match(out, /x-api-key/i);
  });

  it('redacts a 64-hex master key by shape even without a known value', () => {
    const masterKey = 'ab12cd34'.repeat(8);
    const out = scrubSecrets(`leaked ${masterKey} here`);
    assert.ok(!out.includes(masterKey));
    assert.ok(out.includes('here'));
  });

  it('redacts credentials embedded in a URL', () => {
    const out = scrubSecrets('connect https://user:s3cretP@ssw0rd@example.com/api');
    assert.ok(!out.includes('s3cretP'));
    assert.match(out, /https:\/\/user:/);
  });

  it('redacts credential-bearing query params', () => {
    const out = scrubSecrets('GET /v1?model=x&token=abc123secretXYZ987&n=1');
    assert.ok(!out.includes('abc123secretXYZ987'));
    assert.match(out, /token=/);
    assert.ok(out.includes('model=x'), 'non-secret params preserved');
  });
});

describe('scrubSecrets — must NOT over-redact useful debug info', () => {
  it('preserves filesystem paths (essential for "binary not found" diagnosis)', () => {
    const p = '/Users/dev/Library/Logs/AI Native Lab/main.log';
    assert.equal(scrubSecrets(p), p);
  });

  it('preserves provider/base-url hosts and ordinary error text', () => {
    const line = 'Claude Code process exited with code 1 (Provider: GLM5.1) base https://api.example.com/v1';
    assert.equal(scrubSecrets(line), line);
  });

  it('passes through empty / plain strings unchanged', () => {
    assert.equal(scrubSecrets(''), '');
    assert.equal(scrubSecrets('exited with code 137'), 'exited with code 137');
  });

  it('preserves a 40-char lowercase git SHA (hex rule is 48+, not 32+)', () => {
    const gitSha = '0123456789abcdef0123456789abcdef01234567'; // 40 hex, lowercase
    assert.equal(scrubSecrets(`commit ${gitSha} ok`), `commit ${gitSha} ok`);
  });
});

describe('scrubSecrets — provider-prefix & high-entropy patterns', () => {
  it('redacts bare provider-prefixed keys (Google / Groq / xAI / GitHub)', () => {
    const google = 'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const groq = 'gsk_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
    const xai = 'xai-aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    const gh = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
    assert.ok(!scrubSecrets(google).includes(google));
    assert.ok(!scrubSecrets(groq).includes(groq));
    assert.ok(!scrubSecrets(xai).includes(xai));
    assert.ok(!scrubSecrets(gh).includes(gh));
  });

  it('redacts a bare high-entropy token (40+ chars, mixed case + digit)', () => {
    const token = 'aB3'.repeat(14); // 42 chars: has lower, upper, digit
    const out = scrubSecrets(`leaked ${token} end`);
    assert.ok(!out.includes(token), 'high-entropy token must be redacted');
    assert.ok(out.includes('end'), 'surrounding text preserved');
  });

  it('still redacts a 64-hex master key by shape (>= 48 hex)', () => {
    const mk = '0123456789abcdef'.repeat(4); // 64 hex
    assert.ok(!scrubSecrets(`mk ${mk}`).includes(mk));
  });

  it('does NOT redact ordinary long lowercase words (no digit/upper mix)', () => {
    const word = 'a'.repeat(45); // 45 lowercase letters, no digit/upper
    assert.equal(scrubSecrets(`value ${word}`), `value ${word}`);
  });
});
