import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { translate, type Locale, type TranslationKey } from '../../i18n';

const reportKeys = [
  'ppt.report.title', 'ppt.report.ready', 'ppt.report.needsReview',
  'ppt.report.issue.report_summary_late', 'ppt.report.issue.report_source_thin',
  'ppt.report.issue.report_core_flow_late', 'ppt.report.issue.report_decision_unclear',
  'ppt.report.issue.report_recommendation_missing', 'ppt.report.issue.report_repeated_claim',
  'ppt.report.issue.report_claim_without_source', 'ppt.report.issue.report_topic_uncovered',
  'ppt.report.issue.report_small_text',
] satisfies TranslationKey[];

describe('PPT report readiness localization', () => {
  it('resolves every issue in Simplified Chinese, English and Traditional Chinese', () => {
    for (const locale of ['zh', 'en', 'zh-HK'] as Locale[])
      for (const key of reportKeys) assert.notEqual(translate(locale, key), key, `${locale} leaked ${key}`);
  });
});
