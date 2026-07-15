/**
 * cowork-audit.ts — 办公模式安全审计日志(P3-C)。
 *
 * 在**宿主侧**记录安全相关事件(凭证签发/废止、文件进出 VM、VM 生命周期)。
 * 为什么宿主侧而非 guest daemon:宿主是 VM 的唯一出入口(vsock RPC + 代理),
 * 所有"数据进出"与"凭证使用"都必经宿主;宿主侧日志 VM 被攻陷也改不了,更
 * 可信;且不用改 daemon(省一轮冷启动实测)。
 *
 * 不在范围:agent 在 VM 内跑的具体 shell 命令(daemon 只 spawn claude,不知
 * claude 再跑什么;那属沙箱内部,隔离已保证碰不到真机)。审计关心的是"什么
 * 数据进出了 VM、谁的会话用了凭证",不是沙箱内每条命令。
 *
 * 落盘:~/.codepilot/cowork-assets/audit.log,JSON Lines,append-only。
 * 审计失败绝不阻断主流程(best-effort)。
 */
import fs from 'fs';
import path from 'path';
import { COWORK_ROOT } from './cowork-paths';

const AUDIT_LOG = path.join(COWORK_ROOT, 'audit.log');
/** 软上限:超过则截断保留后半,防审计日志无限增长(安全事件不频繁,给足余量)。 */
const MAX_BYTES = 8 * 1024 * 1024;

export type AuditEvent =
  | 'vm_start' | 'vm_stop' | 'vm_crash'
  | 'cred_issued' | 'cred_revoked'
  | 'file_upload' | 'file_download' | 'archive_download';

export interface AuditRecord {
  ts: string;
  event: AuditEvent;
  sessionId?: string;
  detail?: string;
}

/** 记一条审计事件(best-effort,永不抛)。 */
export function audit(event: AuditEvent, opts: { sessionId?: string; detail?: string } = {}): void {
  try {
    const rec: AuditRecord = { ts: new Date().toISOString(), event };
    if (opts.sessionId) rec.sessionId = opts.sessionId;
    if (opts.detail) rec.detail = opts.detail;
    fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(rec) + '\n');
    // 软截断:超上限保留后半(粗粒度,不追求精确)
    try {
      const st = fs.statSync(AUDIT_LOG);
      if (st.size > MAX_BYTES) {
        const buf = fs.readFileSync(AUDIT_LOG);
        const half = buf.subarray(buf.length - Math.floor(MAX_BYTES / 2));
        const nl = half.indexOf(0x0a); // 从第一个完整行开始,避免半行
        fs.writeFileSync(AUDIT_LOG, nl >= 0 ? half.subarray(nl + 1) : half);
      }
    } catch { /* 截断失败无所谓 */ }
  } catch { /* 审计失败不致命,绝不阻断主流程 */ }
}

/** 读最近 N 条审计记录(供调试/未来 UI;倒序解析,坏行标 raw)。 */
export function readRecentAudit(limit = 200): AuditRecord[] {
  try {
    const lines = fs.readFileSync(AUDIT_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l) as AuditRecord; } catch { return { ts: '', event: 'vm_start', detail: `unparseable: ${l.slice(0, 80)}` }; }
    });
  } catch {
    return [];
  }
}
