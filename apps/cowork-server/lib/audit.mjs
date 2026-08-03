/**
 * 服务端安全审计(R3,"双侧审计"的服务端半边;app 侧见 src/lib/cowork-audit.ts)。
 *
 * append-only JSONL,best-effort 永不抛(审计失败不能影响业务链路)。事件名与
 * app 侧对齐(cred_issued/cred_revoked/file_upload/file_download/archive_download),
 * 服务端专属事件:session_ensure / session_remove / reconcile / exec_start / idle_reap。
 * 凭证类事件只记元数据,**绝不记 key/token 本体**。
 * 注意:没有 cred_reject 事件 —— 坏 token 的拒绝发生在 cred-proxy 容器内(只回 401,
 * 故意不打日志防敏感头落盘),宿主侧无观测信号(tech-debt #15;勿把它写进运维文档)。
 */
import fs from 'node:fs';
import path from 'node:path';

const AUDIT_FILE = process.env.COWORK_AUDIT_FILE || path.join(process.cwd(), 'cowork-audit.log');
// 用量后台上线后审计日志是唯一史料的"缓冲区"(增量拉进账号后端 PG),截断上限
// 从 4MB 调大到 64MB —— 拉取周期内(分钟级)绝不可能写满,截断丢数据的窗口
// 实际消失;env 可覆盖(=0 表示不截断,联调用)。
const MAX_BYTES = (() => {
  const v = parseInt(process.env.COWORK_AUDIT_MAX_BYTES || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 64 * 1024 * 1024;
})();

export function audit(event, { sessionId, detail, code, durationMs } = {}) {
  try {
    const rec = { ts: new Date().toISOString(), event };
    if (sessionId) rec.sessionId = sessionId;
    if (detail) rec.detail = detail;
    // exec_end 专用(回合成败与时长的唯一结构化来源):code 允许 0,不能用 truthy 判
    if (code !== undefined && code !== null) rec.code = code;
    if (durationMs !== undefined && durationMs !== null) rec.durationMs = durationMs;
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(rec) + '\n');
    // 软截断:超上限保留后半(粗粒度,对齐 app 侧 cowork-audit 语义)
    const { size } = fs.statSync(AUDIT_FILE);
    if (MAX_BYTES > 0 && size > MAX_BYTES) {
      const tail = fs.readFileSync(AUDIT_FILE).subarray(Math.floor(size / 2));
      const nl = tail.indexOf(0x0a);
      fs.writeFileSync(AUDIT_FILE, nl === -1 ? tail : tail.subarray(nl + 1));
    }
  } catch { /* best-effort */ }
}

export const _internals = { AUDIT_FILE };
