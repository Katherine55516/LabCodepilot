/**
 * Renders the PPT failure details for real (react-dom/server + the real
 * I18nContext) from the failure records the project store actually saved.
 *
 * Field case: every outline contract or gate failure was saved with
 * `diagnostic: {}`. The dialog treated the empty object as model-call timing
 * and printed "失败步骤: outline · 耗时 / 首字延迟 / 已收字符: — ms / — ms / —",
 * while the F1 trace (class, page, source units, repair governor) that
 * explains the failure was never shown. Fixture: real records of the Factor
 * Zoo lab runs, src/__tests__/fixtures/ppt-failure-records.json.
 *
 * Run with: npx tsx --test src/__tests__/unit/ppt-failure-dialog-render.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext } from '../../components/layout/I18nProvider';
import { PptFailureDetails, isTransportFailure } from '../../components/ppt/workspace/PptFailureDialog';
import type { PptProject } from '../../components/ppt/types';
import { translate, type Locale, type TranslationKey } from '../../i18n';

type Failure = NonNullable<PptProject['failure']>;
const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/ppt-failure-records.json'), 'utf8')) as { records: Record<string, { failure: Failure }> };
const record = (name: string): Failure => structuredClone(fixture.records[name].failure);

function render(failure: Failure, locale: Locale = 'zh'): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { locale, setLocale: () => {}, t: (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params) } },
      createElement(PptFailureDetails, { failure }),
    ),
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const PLANNING = ['legacy_contract_no_trace', 'legacy_budget', 'ownership_page_repairs', 'coverage_oscillation', 'capacity_step', 'page_authorization', 'coverage_budget_stop', 'coverage_many_sources'];
const TRANSPORT = ['transport_timeout', 'transport_http400', 'transport_window_timeout'];

describe('PptFailureDetails: contract and gate failures', () => {
  for (const locale of ['zh', 'en'] as Locale[]) {
    for (const name of PLANNING) {
      it(`${name} has no model-call timing (${locale})`, () => {
        const failure = record(name), html = render(failure, locale), body = text(html);
        assert.equal(isTransportFailure(failure), false, 'an empty diagnostic is not timing');
        assert.match(html, /data-kind="planning"/);
        assert.doesNotMatch(html, /ppt-failure-timing/);
        assert.ok(!body.includes('— ms'), 'no "— ms / — ms / —" placeholder line');
        assert.ok(body.includes(translate(locale, 'ppt.failure.code')) && body.includes(failure.trace?.code || failure.code), 'the failure code is shown');
        assert.ok(!/ppt\.failure\./.test(body), 'no raw i18n key');
      });
    }
  }

  it('the latest cd5a2737 re-plan: no-progress class, source units, governor stop', () => {
    const body = text(render(record('coverage_oscillation')));
    assert.ok(body.includes(translate('zh', 'ppt.failure.class.remediation_no_progress')));
    assert.ok(body.includes('b_0117, b_0119, b_0120, b_0214, b_0212'));
    assert.ok(body.includes(translate('zh', 'ppt.failure.governor', { used: 10, budget: 16 })));
    assert.ok(body.includes(translate('zh', 'ppt.failure.stopped.oscillation')));
    assert.ok(body.includes(translate('zh', 'ppt.failure.advised', { n: 3 })));
  });

  it('an ownership failure names its page and the last four repairs', () => {
    const html = render(record('ownership_page_repairs')), body = text(html);
    assert.ok(body.includes(translate('zh', 'ppt.failure.page', { page: 16 })));
    assert.equal((body.match(/#\d+ /g) || []).length, 4);
    assert.ok(body.includes('#7 selection → progress (semantic_ownership_invalid)'));
    assert.ok(!body.includes('#3 selection'), 'older passes are left out');
  });

  it('more than eight source units are counted, not listed', () => {
    const body = text(render(record('coverage_many_sources')));
    assert.ok(body.includes('b_0142') && !body.includes('b_0147'), 'the first eight of fourteen');
    assert.ok(body.includes(translate('zh', 'ppt.failure.more', { n: 6 })));
  });

  it('a named step is shown; budget stop is translated', () => {
    assert.ok(text(render(record('capacity_step'))).includes(`${translate('zh', 'ppt.failure.step')}: outline:capacity`));
    assert.ok(text(render(record('coverage_budget_stop'))).includes(translate('zh', 'ppt.failure.stopped.budget')));
  });

  it('records saved after the fix: the batch step, or the last model call as context', () => {
    const tagged = record('coverage_oscillation');
    delete tagged.diagnostic; tagged.contractStage = 'outline:editorial-local:selection'; tagged.trace = { ...tagged.trace!, step: 'outline:editorial-local:selection' };
    const taggedBody = text(render(tagged));
    assert.ok(taggedBody.includes(`${translate('zh', 'ppt.failure.step')}: outline:editorial-local:selection`));
    assert.ok(!taggedBody.includes(translate('zh', 'ppt.failure.afterStep')));
    const untagged = record('ownership_page_repairs');
    delete untagged.diagnostic; untagged.trace = { ...untagged.trace!, afterStep: 'outline:selection:7' };
    const html = render(untagged);
    assert.match(html, /data-testid="ppt-failure-after-step"/);
    assert.ok(text(html).includes(`${translate('zh', 'ppt.failure.afterStep')}: outline:selection:7`));
  });

  it('legacy records without a trace: step and code only', () => {
    const body = text(render(record('legacy_budget')));
    assert.ok(body.includes(`${translate('zh', 'ppt.failure.step')}: outline`));
    assert.ok(body.includes('execution_attempt_limit'));
    assert.ok(!body.includes(translate('zh', 'ppt.failure.kind')));
  });
});

describe('PptFailureDetails: model-call failures', () => {
  for (const name of TRANSPORT) {
    it(`${name} shows the measured timing`, () => {
      const failure = record(name), d = failure.diagnostic!, body = text(render(failure));
      assert.equal(isTransportFailure(failure), true);
      assert.ok(body.includes(`${translate('zh', 'ppt.failure.step')}: ${failure.modelStage}`));
      assert.ok(body.includes(`${d.elapsedMs} ms / ${d.firstTokenMs ?? '—'} ms / ${d.receivedChars}`), body);
      assert.ok(body.includes('model_transport'), 'the record origin, not the legacy diagnostic origin');
    });
  }
  it('an HTTP error names its status', () => {
    assert.ok(text(render(record('transport_http400'))).includes('HTTP 400'));
  });
});
