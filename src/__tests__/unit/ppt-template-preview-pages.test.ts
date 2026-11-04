/**
 * Template previews page through every template page: an uploaded PPTX with
 * 8 pages but 3 extracted sample titles previewed only 3 pages.
 *
 * Run with: npx tsx --test src/__tests__/unit/ppt-template-preview-pages.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { templatePreviewPageCount } from '../../components/ppt/template-pages';

describe('templatePreviewPageCount', () => {
  it('uses the template page count, not the sample titles', () => {
    assert.equal(templatePreviewPageCount({ pages: 8, sampleTitles: ['A', 'B', 'C'] }), 8);
  });
  it('falls back to the sample titles only without a page count', () => {
    assert.equal(templatePreviewPageCount({ pages: 0, sampleTitles: ['A', 'B', 'C'] }), 3);
  });
  it('always offers at least one page', () => {
    assert.equal(templatePreviewPageCount({} as never), 1);
    assert.equal(templatePreviewPageCount(null), 1);
  });
});
