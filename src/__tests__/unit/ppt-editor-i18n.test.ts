import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translate, type Locale, type TranslationKey } from '../../i18n';

const editorKeys = [
  'ppt.editor.back',
  'ppt.editor.closeEditor',
  'ppt.editor.newSlide',
  'ppt.editor.search',
  'ppt.editor.format',
  'ppt.editor.image',
  'ppt.editor.layout',
  'ppt.editor.chart',
  'ppt.editor.table',
  'ppt.editor.arrange',
  'ppt.editor.ai',
  'ppt.editor.previewObjectAi',
  'ppt.editor.aiRelayout',
  'ppt.editor.applyAi',
  'ppt.editor.publishBeforeExport',
  'ppt.editor.weightRegular',
  'ppt.editor.weightSemibold',
  'ppt.editor.weightBold',
  'ppt.editor.imageGenerationFailed',
  'ppt.editor.imageLoadFailed',
] satisfies TranslationKey[];

describe('PPT visual editor localization', () => {
  it('has resolved copy in Simplified Chinese, English and Traditional Chinese', () => {
    for (const locale of ['zh', 'en', 'zh-HK'] as Locale[]) {
      for (const key of editorKeys) assert.notEqual(translate(locale, key), key, `${locale} leaked ${key}`);
    }
  });

  it('uses distinct Simplified and Traditional Chinese copy for editor controls', () => {
    assert.equal(translate('zh', 'ppt.editor.closeEditor'), '关闭编辑器');
    assert.equal(translate('zh-HK', 'ppt.editor.closeEditor'), '關閉編輯器');
    assert.equal(translate('en', 'ppt.editor.closeEditor'), 'Close editor');
  });

  it('keeps user-facing editor components free of inline Chinese copy', () => {
    for (const file of [
      'src/components/ppt/editor/StructuredPptEditor.tsx',
      'src/components/ppt/canvas/PptCanvas.tsx',
      'src/components/ppt/inspector/PptInspector.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.doesNotMatch(source, /[\u3400-\u9fff]/u, `${file} contains inline Chinese copy`);
    }
  });
});
