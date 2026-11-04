import type { PptTemplate } from './types';

/**
 * How many pages a template preview can show. `pages` is authoritative: an
 * uploaded PPTX carries only a few extracted sample titles, which capped its
 * preview at 3 of 8 pages. Sample titles count only when `pages` is missing.
 */
export function templatePreviewPageCount(template: Pick<PptTemplate, 'pages' | 'sampleTitles'> | null | undefined): number {
  return Math.max(1, Number(template?.pages) || template?.sampleTitles?.length || 1);
}
