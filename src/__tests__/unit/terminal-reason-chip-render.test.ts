/**
 * Renders TerminalReasonChip for real (react-dom/server + the real I18nContext
 * and the real `translate`) and asserts the rendered text.
 *
 * Why a render test and not only the source-scan guard next door: `translate()`
 * returns the raw key when a key is missing, and the chip calls
 * `t(\`terminal.${reason}\` as TranslationKey)` through a cast — so a missing
 * key is invisible to tsc and would ship as the literal string
 * "terminal.api_error" in the UI. Only an actual render catches that.
 *
 * The field bug this locks down: `api_error` was absent from KNOWN_REASONS, so
 * a turn blocked by upstream content policy rendered as "本轮已结束".
 *
 * Uses createElement rather than JSX so the filename stays `.ts` and the
 * existing `test:unit` glob (`src/__tests__/unit/*.test.ts`) collects it.
 *
 * Run with: npx tsx --test src/__tests__/unit/terminal-reason-chip-render.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext } from '../../components/layout/I18nProvider';
import { TerminalReasonChip } from '../../components/chat/TerminalReasonChip';
import { translate, type Locale, type TranslationKey } from '../../i18n';

/** Render the chip inside a real I18n provider for the given locale. */
function render(reason: string | undefined, locale: Locale = 'zh', withActions = false): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      {
        value: {
          locale,
          setLocale: () => {},
          t: (key: TranslationKey, params?: Record<string, string | number>) =>
            translate(locale, key, params),
        },
      },
      createElement(TerminalReasonChip, {
        reason,
        onAction: withActions ? () => {} : undefined,
      }),
    ),
  );
}

describe('TerminalReasonChip render', () => {
  it('api_error renders its own label, NOT the "本轮已结束" fallback', () => {
    const html = render('api_error');
    assert.ok(html.includes('data-terminal-reason="api_error"'), 'chip should render');
    assert.ok(html.includes('上游接口返回错误'), `expected the api_error label, got: ${html}`);
    assert.ok(!html.includes('本轮已结束'), 'must not fall through to terminal.unknown');
  });

  it('never leaks a raw i18n key for any labelled reason, in all three locales', () => {
    const reasons = [
      'api_error', 'malformed_tool_use_exhausted', 'turn_setup_failed',
      'budget_exhausted', 'structured_output_retry_exhausted',
      'tool_deferred_unavailable', 'background_requested',
      'max_turns', 'prompt_too_long', 'blocking_limit', 'rapid_refill_breaker',
      'image_error', 'model_error', 'stop_hook_prevented', 'hook_stopped',
      'tool_deferred',
    ];
    for (const locale of ['zh', 'en', 'zh-HK'] as Locale[]) {
      for (const reason of reasons) {
        const html = render(reason, locale);
        assert.ok(
          !html.includes(`terminal.${reason}`),
          `${locale}/${reason} leaked the raw key into the UI`,
        );
        assert.ok(
          html.includes(`data-terminal-reason="${reason}"`),
          `${locale}/${reason} should render a chip`,
        );
      }
    }
  });

  it('stays silent for completed and user-initiated aborts', () => {
    for (const reason of ['completed', 'aborted_streaming', 'aborted_tools', undefined]) {
      assert.equal(render(reason), '', `${reason} should render nothing`);
    }
  });

  it('an untranslated future SDK reason still falls back cleanly (no raw string)', () => {
    const html = render('some_future_sdk_reason');
    assert.ok(html.includes('本轮已结束'), 'unknown reasons use the fallback label');
    assert.ok(!html.includes('some_future_sdk_reason</span>'), 'raw reason must not be the label');
  });

  it('api_error offers no action button; turn_setup_failed offers retry', () => {
    const blocked = render('api_error', 'zh', true);
    assert.ok(!blocked.includes('data-terminal-action'), 'api_error must offer no action');

    const setup = render('turn_setup_failed', 'zh', true);
    assert.ok(setup.includes('data-terminal-action="retry_simple"'), 'turn_setup_failed offers retry');
  });
});
