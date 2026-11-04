import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

const auditMod = () => import(path.resolve(__dirname, '../../lib/cowork-audit.ts'));

describe('cowork-audit: 安全审计日志(P3-C)', () => {
  it('audit 永不抛(best-effort,绝不阻断主流程)', async () => {
    const { audit } = await auditMod();
    assert.doesNotThrow(() => audit('vm_start'));
    assert.doesNotThrow(() => audit('cred_issued', { sessionId: 'abc123', detail: 'x' }));
    assert.doesNotThrow(() => audit('file_upload', { sessionId: 'abc123', detail: 'f.csv (10B)' }));
  });

  it('写入的记录可读回,含 ts/event/sessionId,倒序取最近 N 条', async () => {
    const { audit, readRecentAudit } = await auditMod();
    const marker = 'audit-test-' + Math.floor(process.hrtime()[1]).toString(36);
    audit('cred_issued', { sessionId: marker, detail: 'unit-test' });
    const recent = readRecentAudit(500);
    assert.ok(Array.isArray(recent));
    const mine = recent.find((r) => r.sessionId === marker);
    assert.ok(mine, 'just-written record is readable back');
    assert.equal(mine!.event, 'cred_issued');
    assert.match(mine!.ts, /^\d{4}-\d{2}-\d{2}T/); // ISO 时间戳
    assert.equal(mine!.detail, 'unit-test');
  });

  it('readRecentAudit 无日志时返回空数组(不抛)', async () => {
    const { readRecentAudit } = await auditMod();
    assert.doesNotThrow(() => readRecentAudit());
    assert.ok(Array.isArray(readRecentAudit(1)));
  });
});
