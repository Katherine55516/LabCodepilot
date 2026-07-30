/**
 * 「使用的技能」信号提取/合并/聚合(src/lib/skill-use.ts)+ db 持久化合并。
 *
 * 信号形态锚定生产实测(2026-07-30 会话 ef61d4f5…):
 *   {"type":"tool_use","id":"toolu_x","name":"Skill","input":{"skill":"office-cn"}}
 * 三源合并按 tool_use id 去重 —— 同一次调用出现在持久化/历史解析/实时三处
 * 也只算一次;这是计数正确性的根基,别改坏。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

import {
  extractSkillUses,
  mergeSkillUses,
  groupSkillUses,
  parseSkillUsesJson,
} from '../../lib/skill-use';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-skill-use-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const { createSession, getSessionSkillsUsed, mergeSessionSkillsUsed, closeDb } =
  require('../../lib/db') as typeof import('../../lib/db');

describe('extractSkillUses', () => {
  it('从真实形态的内容块提取(锚定生产数据)', () => {
    const blocks = [
      { type: 'text', text: '我先读取相关规范' },
      { type: 'tool_use', id: 'toolu_A', name: 'Skill', input: { skill: 'office-cn' } },
      { type: 'tool_result', tool_use_id: 'toolu_A', content: 'Launching skill: office-cn' },
      { type: 'tool_use', id: 'toolu_B', name: 'Skill', input: { skill: 'xlsx-manipulation' } },
      { type: 'tool_use', id: 'toolu_C', name: 'Bash', input: { command: 'ls' } },
    ];
    const uses = extractSkillUses(blocks, 123);
    assert.deepEqual(uses, [
      { id: 'toolu_A', skill: 'office-cn', ts: 123 },
      { id: 'toolu_B', skill: 'xlsx-manipulation', ts: 123 },
    ]);
  });

  it('流式源(ToolUseInfo,无 type 字段)也能提取', () => {
    const uses = extractSkillUses([{ id: 't1', name: 'Skill', input: { skill: 'office-cn' } }]);
    assert.equal(uses.length, 1);
    assert.equal(uses[0].skill, 'office-cn');
  });

  it('容忍脏数据:缺 id / 缺 skill / input 非对象 / 非数组入参', () => {
    assert.deepEqual(extractSkillUses([
      { type: 'tool_use', name: 'Skill', input: { skill: 'a' } },          // 缺 id
      { type: 'tool_use', id: 'x', name: 'Skill', input: {} },             // 缺 skill
      { type: 'tool_use', id: 'y', name: 'Skill', input: 'oops' },         // input 非对象
      { type: 'tool_use', id: 'z', name: 'Skill', input: { skill: '  ' } }, // 空白 skill
      null, 42, 'str',
    ]), []);
    assert.deepEqual(extractSkillUses('not-an-array' as unknown as unknown[]), []);
  });
});

describe('mergeSkillUses / groupSkillUses', () => {
  it('三源合并按 id 去重,同一调用不重复计数', () => {
    const persisted = [{ id: 'A', skill: 'office-cn', ts: 100 }];
    const fromMessages = [
      { id: 'A', skill: 'office-cn', ts: 0 },   // 与持久化同一次调用
      { id: 'B', skill: 'office-cn', ts: 0 },   // 老会话里的另一次
    ];
    const live = [{ id: 'C', skill: 'xlsx-manipulation', ts: 0 }];
    const merged = mergeSkillUses(persisted, fromMessages, live);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].ts, 100, '持久化条目先到先得,ts 不被 0 覆盖');
    assert.deepEqual(groupSkillUses(merged), [
      { skill: 'office-cn', count: 2 },
      { skill: 'xlsx-manipulation', count: 1 },
    ]);
  });

  it('聚合保持首次调用的先后顺序', () => {
    const g = groupSkillUses([
      { id: '1', skill: 'b-skill', ts: 0 },
      { id: '2', skill: 'a-skill', ts: 0 },
      { id: '3', skill: 'b-skill', ts: 0 },
    ]);
    assert.deepEqual(g.map((x) => x.skill), ['b-skill', 'a-skill']);
  });
});

describe('parseSkillUsesJson', () => {
  it("'' / 非法 JSON / 非数组 → []", () => {
    assert.deepEqual(parseSkillUsesJson(''), []);
    assert.deepEqual(parseSkillUsesJson('not json'), []);
    assert.deepEqual(parseSkillUsesJson('{"a":1}'), []);
    assert.deepEqual(parseSkillUsesJson(undefined), []);
  });
  it('过滤形状不对的条目,ts 缺省为 0', () => {
    const parsed = parseSkillUsesJson('[{"id":"a","skill":"s"},{"skill":"no-id"},{"id":"b","skill":"t","ts":9}]');
    assert.deepEqual(parsed, [
      { id: 'a', skill: 's', ts: 0 },
      { id: 'b', skill: 't', ts: 9 },
    ]);
  });
});

describe('db: mergeSessionSkillsUsed(回合末持久化)', () => {
  let sid = '';
  before(() => {
    sid = createSession('技能记录测试', 'sonnet', '', tmpDir, undefined, undefined, undefined, undefined, true).id;
  });
  after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('累计合并且幂等(错误兜底路径重复调用不双计)', () => {
    assert.deepEqual(getSessionSkillsUsed(sid), []);
    const turn1 = [{ id: 'T1', skill: 'office-cn', ts: 1 }];
    mergeSessionSkillsUsed(sid, turn1);
    mergeSessionSkillsUsed(sid, turn1); // 同一回合两条落库路径都会调 —— 必须幂等
    assert.equal(getSessionSkillsUsed(sid).length, 1);

    mergeSessionSkillsUsed(sid, [
      { id: 'T2', skill: 'office-cn', ts: 2 },
      { id: 'T3', skill: 'pdf-extraction', ts: 3 },
    ]);
    const all = getSessionSkillsUsed(sid);
    assert.equal(all.length, 3);
    assert.deepEqual(groupSkillUses(all), [
      { skill: 'office-cn', count: 2 },
      { skill: 'pdf-extraction', count: 1 },
    ]);
  });

  it('空入参不写库(no-op)', () => {
    const before = getSessionSkillsUsed(sid);
    mergeSessionSkillsUsed(sid, []);
    assert.deepEqual(getSessionSkillsUsed(sid), before);
  });
});
