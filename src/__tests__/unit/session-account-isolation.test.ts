/**
 * 办公会话的账号隔离(同一台机器换账号登录时不串数据)。
 *
 * 背景:对话记录存在本地 SQLite 且原本不带任何账号字段,于是 A 登录用办公模式聊完、
 * 登出换 B 登录后,B 能读到 A 的全部办公对话;而沙箱侧本就按 uid 隔离
 * (cowork-server assertOwner → OWNER_MISMATCH → 404),B 点进去必然报错 ——
 * 既泄漏又是坏会话。这里锁住修复后的可见性规则。
 *
 * 关键不变量(改动 db.ts 可见性逻辑时必须仍然成立):
 *   1. 研发会话(sandbox_enabled=0)不参与账号隔离 —— 它绑定本地项目目录;
 *   2. 办公会话只对归属账号可见;
 *   3. owner_uid='' 的存量办公会话对**所有**账号隐藏(含未登录);
 *   4. 未登录(uid='')不得因为 ''==''  而把存量全部漏出;
 *   5. 搜索(消息正文)必须与列表同一把锁 —— 它是泄漏面最大的入口。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-acct-isolation-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  addMessage,
  getSession,
  getVisibleSessions,
  isSessionVisibleToCurrentUser,
  getCurrentUserUid,
  searchMessages,
  setSetting,
  closeDb,
} = require('../../lib/db') as typeof import('../../lib/db');

const UID_A = '92c34452-1d5a-459b-8f01-64720d3fee9a';
const UID_B = '5e75b845-48a9-417c-b3bd-9f22922c5790';

/** 模拟登录/登出:主进程经 /api/auth/current-user/sync 落的就是这个 setting。 */
function loginAs(uid: string): void {
  setSetting('current_user_uid', uid);
}

let legacyOfficeId = '';
let officeAId = '';
let officeBId = '';
let devId = '';

describe('办公会话账号隔离', () => {
  before(() => {
    // 存量:本功能上线前建的办公会话 —— 未登录状态下创建即得到 owner_uid=''
    loginAs('');
    legacyOfficeId = createSession('存量办公会话', 'sonnet', '', tmpDir, undefined, undefined, undefined, undefined, true).id;
    addMessage(legacyOfficeId, 'user', 'LEGACYSECRET 存量办公对话内容');

    loginAs(UID_A);
    officeAId = createSession('A 的办公会话', 'sonnet', '', tmpDir, undefined, undefined, undefined, undefined, true).id;
    addMessage(officeAId, 'user', 'ALPHASECRET A 的办公对话内容');
    // 研发会话:绑定本地目录,不参与账号隔离
    devId = createSession('A 建的研发会话', 'sonnet', '', tmpDir).id;
    addMessage(devId, 'user', 'DEVSHARED 研发对话内容');

    loginAs(UID_B);
    officeBId = createSession('B 的办公会话', 'sonnet', '', tmpDir, undefined, undefined, undefined, undefined, true).id;
    addMessage(officeBId, 'user', 'BRAVOSECRET B 的办公对话内容');
  });

  after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('创建期即定死归属:办公会话记当前账号,研发会话留空', () => {
    assert.equal(getSession(officeAId)?.owner_uid, UID_A);
    assert.equal(getSession(officeBId)?.owner_uid, UID_B);
    assert.equal(getSession(devId)?.owner_uid, '');
    assert.equal(getSession(legacyOfficeId)?.owner_uid, '');
  });

  it('A 登录时:看得到自己的办公会话,看不到 B 的,也看不到存量', () => {
    loginAs(UID_A);
    assert.equal(getCurrentUserUid(), UID_A);
    const ids = getVisibleSessions().map((s) => s.id);
    assert.ok(ids.includes(officeAId), 'A 应看到自己的办公会话');
    assert.ok(!ids.includes(officeBId), 'A 不应看到 B 的办公会话');
    assert.ok(!ids.includes(legacyOfficeId), '归属未知的存量办公会话应隐藏');
    assert.ok(ids.includes(devId), '研发会话不参与账号隔离');
  });

  it('换 B 登录:立刻看不到 A 的办公会话(核心场景)', () => {
    loginAs(UID_B);
    const ids = getVisibleSessions().map((s) => s.id);
    assert.ok(!ids.includes(officeAId), 'B 不得读到 A 的办公会话');
    assert.ok(ids.includes(officeBId));
    assert.ok(ids.includes(devId), '研发会话对 B 仍可见(按项目绑定,非账号)');
  });

  it('登出后:办公会话一个都不可见,研发会话仍在', () => {
    loginAs('');
    const ids = getVisibleSessions().map((s) => s.id);
    assert.ok(!ids.includes(officeAId));
    assert.ok(!ids.includes(officeBId));
    assert.ok(!ids.includes(legacyOfficeId), "uid='' 不得与 owner_uid='' 互相匹配");
    assert.ok(ids.includes(devId));
  });

  it('单会话守卫:知道 id 也读不到别人的办公会话(按 404 处理)', () => {
    loginAs(UID_B);
    assert.equal(isSessionVisibleToCurrentUser(getSession(officeAId)), false);
    assert.equal(isSessionVisibleToCurrentUser(getSession(legacyOfficeId)), false);
    assert.equal(isSessionVisibleToCurrentUser(getSession(officeBId)), true);
    assert.equal(isSessionVisibleToCurrentUser(getSession(devId)), true, '研发会话不隔离');
    assert.equal(isSessionVisibleToCurrentUser(undefined), false, '不存在 = 不可见');
  });

  it('搜索不得命中别人办公会话的消息正文', () => {
    loginAs(UID_B);
    assert.equal(searchMessages('ALPHASECRET', { limit: 50 }).length, 0, '不得搜到 A 的办公对话');
    assert.equal(searchMessages('LEGACYSECRET', { limit: 50 }).length, 0, '不得搜到存量办公对话');
    assert.equal(searchMessages('BRAVOSECRET', { limit: 50 }).length, 1, '自己的应能搜到');
    assert.equal(searchMessages('DEVSHARED', { limit: 50 }).length, 1, '研发会话消息不受影响');

    loginAs(UID_A);
    assert.equal(searchMessages('ALPHASECRET', { limit: 50 }).length, 1);
    assert.equal(searchMessages('BRAVOSECRET', { limit: 50 }).length, 0);

    loginAs('');
    assert.equal(searchMessages('ALPHASECRET', { limit: 50 }).length, 0, '登出后办公消息全不可搜');
    assert.equal(searchMessages('DEVSHARED', { limit: 50 }).length, 1, '研发消息仍可搜');
  });
});
