/**
 * Tests for model-multimodal pure helpers — the「多模态」detection rule and
 * the media MIME-type classifier that drive the model picker label and the
 * composer upload guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMultimodalDescription, isMediaMimeType } from '../../lib/model-multimodal';

describe('isMultimodalDescription', () => {
  it('returns true when the description contains 多模态', () => {
    assert.equal(isMultimodalDescription('支持多模态输入的强大模型'), true);
    assert.equal(isMultimodalDescription('多模态'), true);
    assert.equal(isMultimodalDescription('Kimi-K2.6，多模态、长上下文'), true);
  });

  it('returns false when the description lacks 多模态', () => {
    assert.equal(isMultimodalDescription('纯文本对话模型'), false);
    assert.equal(isMultimodalDescription('a powerful text model'), false);
    assert.equal(isMultimodalDescription('多模'), false); // partial keyword
  });

  it('returns false for empty / null / undefined', () => {
    assert.equal(isMultimodalDescription(''), false);
    assert.equal(isMultimodalDescription(null), false);
    assert.equal(isMultimodalDescription(undefined), false);
  });
});

describe('isMediaMimeType', () => {
  it('returns true for image / audio / video', () => {
    assert.equal(isMediaMimeType('image/png'), true);
    assert.equal(isMediaMimeType('image/jpeg'), true);
    assert.equal(isMediaMimeType('audio/mpeg'), true);
    assert.equal(isMediaMimeType('video/mp4'), true);
    assert.equal(isMediaMimeType('IMAGE/PNG'), true); // case-insensitive
  });

  it('returns false for text / code / document types', () => {
    assert.equal(isMediaMimeType('text/plain'), false);
    assert.equal(isMediaMimeType('text/markdown'), false);
    assert.equal(isMediaMimeType('application/pdf'), false);
    assert.equal(isMediaMimeType('application/json'), false);
    assert.equal(isMediaMimeType('application/octet-stream'), false);
  });

  it('returns false for empty / null / undefined', () => {
    assert.equal(isMediaMimeType(''), false);
    assert.equal(isMediaMimeType(null), false);
    assert.equal(isMediaMimeType(undefined), false);
  });
});
