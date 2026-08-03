/**
 * WS exec 桥 —— 把一条 WebSocket 连接桥接到 `docker exec -i <容器> shim`。
 *
 * 协议(与 R0 帧协议一致,只是承载从裸 TCP 换成 WS message):
 *   - 客户端首个 **text** message = header JSON { argv, env }
 *   - 客户端后续 **binary** message = stdin 帧流字节([u32 BE len][bytes] + 零长 EOF),
 *     server 原样 write 给 docker exec stdin(帧由容器内 shim 解,server 是哑管道)
 *   - server 把 docker exec stdout 的字节 chunk 作为 binary message 发回客户端(claude 裸 stream-json)
 *
 * EOF/中断:WS 关 → 关 docker exec stdin(触发容器内 shim 的 stdin EOF → 自保杀 claude),
 * 加 abort-grace 兜底 kill。R0 已实测 docker exec 正确传 stdin-EOF、零孤儿。
 */
import { spawn } from 'node:child_process';
import { audit } from './audit.mjs';

const ABORT_GRACE_MS = parseInt(process.env.COWORK_ABORT_GRACE_MS || '3000', 10);

export function handleExec(ws, sid, containerName, { shimPath, log, uid }) {
  let child = null;
  let started = false;

  ws.on('message', (data, isBinary) => {
    if (!started) {
      // 首消息 = header(text JSON)
      started = true;
      let header;
      try { header = JSON.parse(data.toString('utf8')); } catch { ws.close(1002, 'bad header'); return; }
      const env = header.env && typeof header.env === 'object' ? header.env : {};
      const argv = Array.isArray(header.argv) ? header.argv : [];
      const eArgs = [];
      for (const [k, v] of Object.entries(env)) eArgs.push('-e', `${k}=${v}`);
      const args = ['exec', '-i', ...eArgs, containerName, 'python3', shimPath, '--', ...argv];
      log?.(`exec spawn session=${sid} argv=${argv.length} env=${Object.keys(env).length}`);
      const startedAt = Date.now();
      child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'inherit'] });
      child.stdin.on('error', () => { /* EPIPE when claude exits first */ });
      child.stdout.on('data', (chunk) => { if (ws.readyState === ws.OPEN) { try { ws.send(chunk); } catch { /* ignore */ } } });
      child.on('exit', (code) => {
        log?.(`exec exit session=${sid} code=${code}`);
        // 回合成败/时长的唯一结构化来源(此前只进 journal,统计后台无从取数)。
        // code=null(被信号杀)记 -1,与正常退出码区分。
        audit('exec_end', { sessionId: sid, detail: uid, code: code === null ? -1 : code, durationMs: Date.now() - startedAt });
        try { ws.close(1000, 'exec exit'); } catch { /* ignore */ }
      });
      child.on('error', (e) => { log?.(`exec error session=${sid} ${e.message}`); try { ws.close(1011, 'exec error'); } catch { /* ignore */ } });
      return;
    }
    // 后续 binary message = 帧字节 → docker exec stdin
    if (child && child.stdin.writable) { try { child.stdin.write(data); } catch { /* ignore */ } }
  });

  ws.on('close', () => {
    if (!child) return;
    // 关 docker exec stdin → 容器内 shim 见 stdin EOF → 自保杀 claude(R0 实测有效)
    try { child.stdin.end(); } catch { /* ignore */ }
    const t = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* ignore */ } }, ABORT_GRACE_MS);
    child.on('exit', () => clearTimeout(t));
  });

  ws.on('error', () => { /* close 会跟着触发 */ });
}
