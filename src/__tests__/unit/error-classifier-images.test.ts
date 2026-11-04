import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../../lib/error-classifier';

/**
 * Verifies the IMAGES_NOT_SUPPORTED fast-path added to classifyError:
 *   - Image-related "not supported" messages get a friendly category when
 *     hasImages=true.
 *   - Same keywords without hasImages do NOT misfire (so plain `not supported`
 *     errors from unrelated requests still fall through to UNSUPPORTED_FEATURE
 *     or other proper categories).
 *   - Fast-path runs before UNSUPPORTED_FEATURE / MODEL_NOT_AVAILABLE so the
 *     friendlier wording wins for image-laden requests.
 */
describe('classifyError — IMAGES_NOT_SUPPORTED fast-path', () => {
  it('Qwen-style "does not support vision" with hasImages → IMAGES_NOT_SUPPORTED', () => {
    const result = classifyError({
      error: new Error('The model qwen3.7-max does not support vision'),
      providerName: 'Qwen3.7-Max',
      hasImages: true,
    });
    assert.equal(result.category, 'IMAGES_NOT_SUPPORTED');
    // Chinese-first wording — see error-classifier.ts fast-path comment.
    assert.match(result.userMessage, /不支持图片输入/);
    assert.match(result.userMessage, /Qwen3.7-Max/);
    assert.match(result.actionHint, /移除消息中的图片/);
    assert.match(result.actionHint, /切换右下角的模型/);
    assert.equal(result.retryable, false);
    // Critical: no Open Settings button — would mislead users to Provider Doctor
    assert.deepEqual(result.recoveryActions, []);
  });

  it('OpenAI-style "image content are not supported" with hasImages → IMAGES_NOT_SUPPORTED', () => {
    const result = classifyError({
      error: new Error('messages with image content are not supported by this model'),
      providerName: 'gpt-3.5-turbo',
      hasImages: true,
    });
    assert.equal(result.category, 'IMAGES_NOT_SUPPORTED');
  });

  it('"image_url is not supported" with hasImages → IMAGES_NOT_SUPPORTED', () => {
    const result = classifyError({
      error: new Error('Bad request: image_url is not supported on this endpoint'),
      providerName: 'deepseek-v4-pro',
      hasImages: true,
    });
    assert.equal(result.category, 'IMAGES_NOT_SUPPORTED');
  });

  it('image keyword present but hasImages=false → does NOT misfire (falls through to other categories)', () => {
    // Regression guard: a stderr happens to mention "does not support image"
    // for an unrelated reason (e.g. tool-call error), but the user did not
    // attach any image. We must not produce a misleading IMAGES_NOT_SUPPORTED.
    const result = classifyError({
      error: new Error('The configured tool does not support image streaming'),
      providerName: 'Qwen3.7-Max',
      hasImages: false,
    });
    assert.notEqual(result.category, 'IMAGES_NOT_SUPPORTED');
  });

  it('fast-path beats UNSUPPORTED_FEATURE: "image content are not supported" should NOT be classified as UNSUPPORTED_FEATURE', () => {
    // The UNSUPPORTED_FEATURE pattern matches `'not supported'`. Without the
    // fast-path the more specific image case would get swallowed by the
    // generic CLI-unsupported-feature wording. This test pins the order.
    const result = classifyError({
      error: new Error('messages with image content are not supported by this model'),
      providerName: 'Kimi-K2.6',
      hasImages: true,
    });
    assert.equal(result.category, 'IMAGES_NOT_SUPPORTED');
    assert.notEqual(result.category, 'UNSUPPORTED_FEATURE');
  });

  it('fast-path beats MODEL_NOT_AVAILABLE: "does not support vision" should NOT be classified as MODEL_NOT_AVAILABLE', () => {
    // MODEL_NOT_AVAILABLE pattern matches `'does not exist'` — close to but
    // not equal to `'does not support'`. Still worth pinning the contract.
    const result = classifyError({
      error: new Error('Model GLM5.1 does not support vision input'),
      providerName: 'GLM5.1',
      hasImages: true,
    });
    assert.equal(result.category, 'IMAGES_NOT_SUPPORTED');
    assert.notEqual(result.category, 'MODEL_NOT_AVAILABLE');
  });

  it('plain "not supported" without image keyword and without hasImages → original UNSUPPORTED_FEATURE category', () => {
    // Sanity: the fast-path must not steal classification from legitimately
    // unrelated "not supported" errors.
    const result = classifyError({
      error: new Error('Option --foo is not supported by this CLI version'),
      providerName: 'env',
      hasImages: false,
    });
    assert.equal(result.category, 'UNSUPPORTED_FEATURE');
  });
});
