/**
 * Unit tests for 用例 id 的「回贴」解析器 (src/lib/test/case-id.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/case-id.test.ts
 *
 * 锁两件事：(1) 模型把印刷体标点抄成 ASCII 时仍能认回 cases.json 的那条用例；
 * (2) 歧义时【绝不猜】——判定张冠李戴比漏判危险得多。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCaseKey, createCaseIdResolver, remapCaseKeys } from '../../lib/test/case-id';

// 真机事故的原始 id（弯引号 U+2018/U+2019）与模型回写的变体（ASCII U+0027）。
const AUTHORITATIVE = '1108941+菜单栏-更多-‘码’上合规的子标题更改';
const AS_EMITTED = "1108941+菜单栏-更多-'码'上合规的子标题更改";

describe('canonicalCaseKey', () => {
  it('folds curly quotes onto ASCII (真机事故的那一对)', () => {
    assert.notEqual(AUTHORITATIVE, AS_EMITTED); // 前提：两者字面确实不同
    assert.equal(canonicalCaseKey(AUTHORITATIVE), canonicalCaseKey(AS_EMITTED));
  });

  it('folds curly double quotes, dashes and full-width forms', () => {
    assert.equal(canonicalCaseKey('TC“x”'), canonicalCaseKey('TC"x"'));
    assert.equal(canonicalCaseKey('TC—001'), canonicalCaseKey('TC-001'));
    assert.equal(canonicalCaseKey('ＴＣ－００１'), canonicalCaseKey('TC-001'));
  });

  it('ignores whitespace drift, invisible characters and letter case', () => {
    assert.equal(canonicalCaseKey('TC 001'), canonicalCaseKey('TC001'));
    assert.equal(canonicalCaseKey('TC​001'), canonicalCaseKey('TC001'));
    assert.equal(canonicalCaseKey('tc-001'), canonicalCaseKey('TC-001'));
  });

  it('keeps genuinely different ids apart', () => {
    assert.notEqual(canonicalCaseKey('TC-001'), canonicalCaseKey('TC-002'));
    // CJK 引号是中文标题里的结构符号，不参与归一（否则制造歧义）
    assert.notEqual(canonicalCaseKey('用例「A」'), canonicalCaseKey('用例"A"'));
  });
});

describe('createCaseIdResolver', () => {
  it('snaps a quote-drifted id back to the cases.json spelling', () => {
    const resolve = createCaseIdResolver([AUTHORITATIVE]);
    assert.equal(resolve(AS_EMITTED), AUTHORITATIVE);
  });

  it('prefers exact match over canonical fallback', () => {
    // 两条 id 仅大小写不同 → 精确匹配必须各归各位，绝不能被 fallback 抢走
    const resolve = createCaseIdResolver(['TC-a', 'TC-A']);
    assert.equal(resolve('TC-a'), 'TC-a');
    assert.equal(resolve('TC-A'), 'TC-A');
  });

  it('refuses to guess when two case ids share one canonical key', () => {
    const resolve = createCaseIdResolver(['TC‘x’', "TC'x'"]);
    // 撞键 → 该键作废；认不出的写法原样返回，交由调用方走「未执行」兜底
    assert.equal(resolve('TC’x‘'), 'TC’x‘');
  });

  it('returns unknown ids unchanged (AI 编造的用例不得被硬塞给某条真用例)', () => {
    const resolve = createCaseIdResolver([AUTHORITATIVE]);
    assert.equal(resolve('TC-编造的'), 'TC-编造的');
  });

  it('tolerates a duplicated id in cases.json without going ambiguous', () => {
    const resolve = createCaseIdResolver(['TC-001', 'TC-001']);
    assert.equal(resolve('tc-001'), 'TC-001');
  });
});

describe('remapCaseKeys', () => {
  it('moves a record onto authoritative ids, first key wins', () => {
    const resolve = createCaseIdResolver([AUTHORITATIVE]);
    const out = remapCaseKeys({ [AS_EMITTED]: 1234 }, resolve);
    assert.deepEqual(out, { [AUTHORITATIVE]: 1234 });
  });

  it('leaves unresolvable keys in place', () => {
    const resolve = createCaseIdResolver(['TC-001']);
    assert.deepEqual(remapCaseKeys({ 'TC-999': 7 }, resolve), { 'TC-999': 7 });
  });
});
