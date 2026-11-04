/**
 * Guards TerminalReasonChip against SDK drift.
 *
 * The chip renders `SDKResultMessage.terminal_reason`, but it only had labels
 * for 9 of the SDK's 19 `TerminalReason` values. Everything else fell through
 * to `terminal.unknown` → "本轮已结束". Field consequence (packaged v4.2.0,
 * 2026-08-17): a turn blocked upstream by content policy reports
 * `api_error`, so the only thing the user saw for a policy block was a
 * generic "turn ended" chip.
 *
 * Source-scanned rather than imported: TerminalReasonChip.tsx pulls in React
 * and the useTranslation hook, and the sets are module-private. Same approach
 * as stale-default-provider.test.ts / context-budget-and-gating.test.ts.
 *
 * Run with: npx tsx --test src/__tests__/unit/terminal-reason-coverage.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

const CHIP_PATH = 'src/components/chat/TerminalReasonChip.tsx';
const SDK_TYPES_PATH = 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts';
const I18N_PATHS = ['src/i18n/zh.ts', 'src/i18n/en.ts', 'src/i18n/zh-HK.ts'];

/** Pull the quoted members out of `const <name> = new Set([...])`. */
function readSet(src: string, name: string): Set<string> {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  assert.ok(m, `${name} not found in ${CHIP_PATH} — did it get renamed?`);
  return new Set(Array.from(m![1].matchAll(/'([^']+)'/g), (q) => q[1]));
}

/** Pull the members of the SDK's `TerminalReason` string union. */
function readSdkTerminalReasons(): Set<string> {
  const src = read(SDK_TYPES_PATH);
  const m = src.match(/export declare type TerminalReason = ([^;]+);/);
  assert.ok(m, 'TerminalReason union not found in the SDK types');
  return new Set(Array.from(m![1].matchAll(/'([^']+)'/g), (q) => q[1]));
}

/** Keys actually present in an i18n bundle for the `terminal.` namespace. */
function readTerminalKeys(rel: string): Set<string> {
  const src = read(rel);
  return new Set(Array.from(src.matchAll(/'terminal\.([a-z_]+)':/g), (q) => q[1]));
}

describe('TerminalReasonChip covers the SDK TerminalReason union', () => {
  const chip = read(CHIP_PATH);
  const silent = readSet(chip, 'SILENT_REASONS');
  const known = readSet(chip, 'KNOWN_REASONS');
  const sdkReasons = readSdkTerminalReasons();

  it('sanity: the SDK union parsed and is non-trivial', () => {
    assert.ok(sdkReasons.size >= 19, `expected >=19 SDK reasons, got ${sdkReasons.size}`);
    // Spot-check the value whose absence caused the field bug.
    assert.ok(sdkReasons.has('api_error'));
  });

  it('every SDK reason is either silent or explicitly labelled', () => {
    const uncovered = [...sdkReasons].filter((r) => !silent.has(r) && !known.has(r));
    assert.deepEqual(
      uncovered,
      [],
      'these SDK terminal_reason values would render as "本轮已结束": ' + uncovered.join(', '),
    );
  });

  it('the chip declares no reason the SDK does not have (no dead entries)', () => {
    const stale = [...known, ...silent].filter((r) => !sdkReasons.has(r));
    assert.deepEqual(stale, [], 'reasons no longer in the SDK union: ' + stale.join(', '));
  });

  it('silent and known do not overlap', () => {
    const both = [...known].filter((r) => silent.has(r));
    assert.deepEqual(both, [], 'a reason cannot be both silent and labelled: ' + both.join(', '));
  });

  it('api_error carries no retry action (a retry resends the blocked prefix)', () => {
    const m = chip.match(/const ACTIONS_BY_REASON[\s\S]*?\n\};/);
    assert.ok(m, 'ACTIONS_BY_REASON not found');
    assert.ok(
      !/\n {2}api_error:/.test(m![0]),
      'api_error must not declare actions — the classified error banner owns the guidance',
    );
  });
});

describe('i18n bundles carry a label for every non-silent reason', () => {
  const chip = read(CHIP_PATH);
  const known = readSet(chip, 'KNOWN_REASONS');

  for (const rel of I18N_PATHS) {
    it(`${rel} has every terminal.<reason> key (+ unknown fallback)`, () => {
      const keys = readTerminalKeys(rel);
      const missing = [...known].filter((r) => !keys.has(r));
      assert.deepEqual(missing, [], `missing terminal.* keys in ${rel}: ` + missing.join(', '));
      assert.ok(keys.has('unknown'), 'the unknown fallback key must stay');
    });
  }

  it('the three bundles agree on which terminal.<reason> keys exist', () => {
    const [zh, en, hk] = I18N_PATHS.map(readTerminalKeys);
    // zh-HK is hand-maintained (regenerating it reverts curated HK terms), so
    // this catches a bundle being forgotten when a reason is added.
    for (const [label, set] of [['en.ts', en], ['zh-HK.ts', hk]] as const) {
      const missing = [...zh].filter((k) => !set.has(k));
      assert.deepEqual(missing, [], `${label} is missing keys present in zh.ts: ` + missing.join(', '));
    }
  });
});
