/**
 * 服务端安全审计(R3,"双侧审计"的服务端半边;app 侧见 src/lib/cowork-audit.ts)。
 *
 * append-only JSONL,best-effort 永不抛(审计失败不能影响业务链路)。事件名与
 * app 侧对齐(cred_issued/cred_revoked/file_upload/file_download/archive_download),
 * 服务端专属事件:cred_reject(坏 token 打代理)/ session_ensure / session_remove /
 * reconcile / exec_start。凭证类事件只记元数据,**绝不记 key/token 本体**。
 */
import fs from 'node:fs';
import path from 'node:path';

const AUDIT_FILE = process.env.COWORK_AUDIT_FILE || path.join(process.cwd(), 'cowork-audit.log');
const MAX_BYTES = 4 * 1024 * 1024;

export function audit(event, { sessionId, detail } = {}) {
  try {
    const rec = { ts: new Date().toISOString(), event };
    if (sessionId) rec.sessionId = sessionId;
    if (detail) rec.detail = detail;
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(rec) + '\n');
    // 软截断:超上限保留后半(粗粒度,对齐 app 侧 cowork-audit 语义)
    const { size } = fs.statSync(AUDIT_FILE);
    if (size > MAX_BYTES) {
      const tail = fs.readFileSync(AUDIT_FILE).subarray(Math.floor(size / 2));
      const nl = tail.indexOf(0x0a);
      fs.writeFileSync(AUDIT_FILE, nl === -1 ? tail : tail.subarray(nl + 1));
    }
  } catch { /* best-effort */ }
}

export const _internals = { AUDIT_FILE };
