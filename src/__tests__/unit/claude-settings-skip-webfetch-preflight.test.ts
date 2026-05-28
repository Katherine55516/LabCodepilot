/**
 * Tests for ensureSkipWebFetchPreflight() — startup hook that injects
 * `skipWebFetchPreflight: true` into ~/.claude/settings.json so users
 * behind enterprise networks / GFW don't hit the "Unable to verify if
 * domain X is safe to fetch" preflight failure.
 *
 * Five acceptance scenarios:
 *   1. ~/.claude/ doesn't exist → directory + file are created
 *   2. settings.json exists without the field → field is merged in,
 *      other fields preserved
 *   3. settings.json has the field already (true) → leave alone
 *   4. settings.json has the field set to FALSE → leave alone
 *      (respect user's explicit choice)
 *   5. Unparseable settings.json → returns error, doesn't overwrite
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSkipWebFetchPreflight } from '../../lib/claude-settings';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-settings-test-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile; else delete process.env.USERPROFILE;
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function readSettings(): Record<string, unknown> {
  const p = path.join(tempHome, '.claude', 'settings.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

describe('ensureSkipWebFetchPreflight', () => {
  it('creates ~/.claude/ + settings.json when missing', () => {
    const result = ensureSkipWebFetchPreflight();
    assert.equal(result.error, undefined);
    assert.equal(result.created, true);
    assert.equal(result.updated, true);
    assert.equal(result.skipped, false);

    const settings = readSettings();
    assert.equal(settings.skipWebFetchPreflight, true);
    assert.equal(Object.keys(settings).length, 1);
  });

  it('merges field into existing settings.json, preserves other fields', () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        env: { ANTHROPIC_AUTH_TOKEN: 'sk-abc', ANTHROPIC_BASE_URL: 'https://api.test' },
        permissions: { allow: ['Bash(git:*)'] },
      }),
    );

    const result = ensureSkipWebFetchPreflight();
    assert.equal(result.error, undefined);
    assert.equal(result.updated, true);
    assert.equal(result.skipped, false);

    const settings = readSettings();
    assert.equal(settings.skipWebFetchPreflight, true);
    // Other fields untouched
    assert.deepEqual(settings.env, {
      ANTHROPIC_AUTH_TOKEN: 'sk-abc',
      ANTHROPIC_BASE_URL: 'https://api.test',
    });
    assert.deepEqual(settings.permissions, { allow: ['Bash(git:*)'] });
  });

  it('leaves settings.json alone when skipWebFetchPreflight is already true', () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ skipWebFetchPreflight: true, customField: 'kept' }),
    );

    const result = ensureSkipWebFetchPreflight();
    assert.equal(result.error, undefined);
    assert.equal(result.updated, false);
    assert.equal(result.skipped, true);

    // File on disk untouched
    const settings = readSettings();
    assert.equal(settings.skipWebFetchPreflight, true);
    assert.equal(settings.customField, 'kept');
  });

  it('respects explicit `false` — does NOT flip it to true', () => {
    // Regression guard: if a user deliberately set this to false to keep
    // the preflight ON, we must NOT clobber that choice on every startup.
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ skipWebFetchPreflight: false }),
    );

    const result = ensureSkipWebFetchPreflight();
    assert.equal(result.error, undefined);
    assert.equal(result.updated, false);
    assert.equal(result.skipped, true);

    const settings = readSettings();
    assert.equal(settings.skipWebFetchPreflight, false);
  });

  it('returns error + leaves file alone when settings.json is unparseable', () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settingsPath, '{ "this is not valid json');

    const result = ensureSkipWebFetchPreflight();
    assert.notEqual(result.error, undefined);
    assert.equal(result.updated, false);

    // Original (broken) file must stay so the user can fix it themselves —
    // never silently overwrite to avoid losing whatever they were editing.
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    assert.equal(raw, '{ "this is not valid json');
  });

  it('multiple calls are idempotent', () => {
    // First call creates the file
    const r1 = ensureSkipWebFetchPreflight();
    assert.equal(r1.updated, true);

    // Second call should skip
    const r2 = ensureSkipWebFetchPreflight();
    assert.equal(r2.updated, false);
    assert.equal(r2.skipped, true);

    // Third call same
    const r3 = ensureSkipWebFetchPreflight();
    assert.equal(r3.skipped, true);
  });
});
