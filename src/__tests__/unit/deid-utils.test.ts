/**
 * 脱敏网关纯函数单测 — buildOutbound(契约 §5.4 客户端重建)、
 * buildPreviewSegments(预览与外发同源)、remaskText(D3 历史重脱敏)、
 * restoreText(D5 渲染层还原)、parseDeidStateJson(状态解析容错)。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutbound,
  buildPreviewSegments,
  containsPlaceholder,
  parseDeidStateJson,
  remaskText,
  restoreText,
} from '../../lib/deid-utils';
import type { DeidEntity } from '../../types/deid';

const text = '帮我给张伟发邮件,他的邮箱是 zhangwei@example.com';
const entities: DeidEntity[] = [
  { id: 0, entity_type: 'PERSON', original: '张伟', placeholder: '<PERSON_1>', start: 3, end: 5, action: 'anonymized' },
  { id: 1, entity_type: 'EMAIL_ADDRESS', original: 'zhangwei@example.com', placeholder: '<EMAIL_1>', start: 15, end: 35, action: 'anonymized' },
];

describe('buildOutbound', () => {
  it('replaces all confirmed spans with placeholders', () => {
    assert.equal(
      buildOutbound(text, entities, new Set()),
      '帮我给<PERSON_1>发邮件,他的邮箱是 <EMAIL_1>',
    );
  });

  it('keeps original text for user-excluded entities, others still masked', () => {
    assert.equal(
      buildOutbound(text, entities, new Set([0])),
      '帮我给张伟发邮件,他的邮箱是 <EMAIL_1>',
    );
  });

  it('ignores non-anonymized / unlocated / placeholder-less entities', () => {
    const withNoise: DeidEntity[] = [
      ...entities,
      { id: 2, entity_type: 'PERSON', original: '李雷', placeholder: null, action: 'unlocated' },
      { id: 3, entity_type: 'LOCATION', original: '邮箱', placeholder: '<LOCATION_1>', start: 10, end: 12, action: 'kept' },
    ];
    assert.equal(
      buildOutbound(text, withNoise, new Set()),
      '帮我给<PERSON_1>发邮件,他的邮箱是 <EMAIL_1>',
    );
  });

  it('skips overlapping spans instead of corrupting the text', () => {
    const overlapping: DeidEntity[] = [
      { id: 0, entity_type: 'PERSON', original: '张伟发', placeholder: '<PERSON_1>', start: 3, end: 6, action: 'anonymized' },
      { id: 1, entity_type: 'PERSON', original: '伟发', placeholder: '<PERSON_2>', start: 4, end: 6, action: 'anonymized' },
    ];
    assert.equal(buildOutbound(text, overlapping, new Set()), '帮我给<PERSON_1>邮件,他的邮箱是 zhangwei@example.com');
  });

  it('empty entity list sends text unchanged', () => {
    assert.equal(buildOutbound(text, [], new Set()), text);
  });
});

describe('buildPreviewSegments', () => {
  it('mirrors buildOutbound exactly (joined preview === outbound)', () => {
    for (const excluded of [new Set<number>(), new Set([0]), new Set([0, 1])]) {
      const joined = buildPreviewSegments(text, entities, excluded).map((s) => s.text).join('');
      assert.equal(joined, buildOutbound(text, entities, excluded));
    }
  });

  it('marks excluded spans as original (yellow) and confirmed as placeholder (blue)', () => {
    const segs = buildPreviewSegments(text, entities, new Set([0]));
    const marked = segs.filter((s) => s.kind !== 'text');
    assert.deepEqual(
      marked.map((s) => [s.kind, s.text, s.entityId]),
      [
        ['original', '张伟', 0],
        ['placeholder', '<EMAIL_1>', 1],
      ],
    );
  });
});

describe('remaskText (D3 history re-mask)', () => {
  const mapping = { '<PERSON_1>': '张伟', '<PERSON_2>': '张伟丽', '<PHONE_NUMBER_1>': '13800138000' };

  it('replaces originals with placeholders, longest-first', () => {
    assert.equal(
      remaskText('张伟丽和张伟的电话都是 13800138000', mapping),
      '<PERSON_2>和<PERSON_1>的电话都是 <PHONE_NUMBER_1>',
    );
  });

  it('leaves text without any mapped originals untouched', () => {
    assert.equal(remaskText('今天天气不错', mapping), '今天天气不错');
  });

  it('empty mapping is a no-op', () => {
    assert.equal(remaskText('张伟', {}), '张伟');
  });
});

describe('restoreText (D5 render restore)', () => {
  const mapping = { '<PERSON_1>': '张伟', '<EMAIL_1>': 'zhangwei@example.com' };

  it('restores placeholders to originals', () => {
    assert.equal(
      restoreText('已通知<PERSON_1>(<EMAIL_1>)', mapping),
      '已通知张伟(zhangwei@example.com)',
    );
  });

  it('unknown placeholders stay as-is', () => {
    assert.equal(restoreText('联系<PERSON_9>', mapping), '联系<PERSON_9>');
  });

  it('roundtrip: remask then restore returns the original', () => {
    const src = '张伟的邮箱是 zhangwei@example.com';
    assert.equal(restoreText(remaskText(src, mapping), mapping), src);
  });
});

describe('containsPlaceholder', () => {
  it('detects <TYPE_n> shapes only', () => {
    assert.equal(containsPlaceholder('hi <PERSON_1>'), true);
    assert.equal(containsPlaceholder('a < b, c > d, <div>'), false);
  });
});

describe('parseDeidStateJson', () => {
  it('parses well-formed state', () => {
    const st = parseDeidStateJson(JSON.stringify({
      mapping: { '<PERSON_1>': '张伟' },
      denyValues: [{ text: '登月项目', entity_type: 'PROJECT' }, { text: '' }, { bogus: 1 }],
    }));
    assert.deepEqual(st.mapping, { '<PERSON_1>': '张伟' });
    assert.deepEqual(st.denyValues, [{ text: '登月项目', entity_type: 'PROJECT' }]);
  });

  it('empty / null / corrupted json → empty state', () => {
    for (const bad of ['', null, undefined, '{oops', '[1,2]', JSON.stringify({ mapping: [1] })]) {
      const st = parseDeidStateJson(bad as string);
      assert.deepEqual(st.mapping, {});
      assert.deepEqual(st.denyValues, []);
    }
  });
});
