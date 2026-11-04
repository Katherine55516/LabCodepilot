#!/usr/bin/env node
/**
 * Cowork 远程容器 POC — exec 转发器(TCP 版)。
 *
 * SDK 把本脚本当 claude 可执行文件 spawn。它连远程 server 的 TCP 端口,发一帧
 * exec header(sessionId + argv + 白名单 env),之后 stdin↔连接做帧封装双向管道。
 *
 * 与 forwarder-vsock.mjs 逐行同构 —— 唯一差别是连 TCP host:port 而非 unix socket。
 * 帧协议(stdin [uint32 BE 长度][字节] + 长度0=EOF;stdout 裸流)一字不改。这正是
 * "换传输层、不换协议"的证明:生产切 WebSocket/TLS 时,同理只换 createConnection
 * 这一句,帧协议与容器内 shim 完全复用。
 *
 * env:
 *   COWORK_REMOTE_HOST / COWORK_REMOTE_PORT — server 地址(默认 127.0.0.1:8790)
 *   COWORK_SESSION_ID   — 会话 id(hex)
 *   COWORK_REMOTE_TOKEN — 鉴权令牌(POC 可选,随 header 过去,生产必填)
 *   ANTHROPIC_* / CLAUDE_* / COWORK_* — 白名单过河(POC 阶段真 key 直接过;R3 换一次性 token)
 */
import net from 'node:net';

const host = process.env.COWORK_REMOTE_HOST || '127.0.0.1';
const port = parseInt(process.env.COWORK_REMOTE_PORT || '8790', 10);
const sessionId = process.env.COWORK_SESSION_ID || '';
const token = process.env.COWORK_REMOTE_TOKEN || '';

// 白名单 env 过河(不透传宿主 HOME/PATH 等)
const envOut = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^(ANTHROPIC_|CLAUDE_|COWORK_)/.test(k) || ['API_TIMEOUT_MS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].includes(k)) {
    if (typeof v === 'string') envOut[k] = v;
  }
}

const argv = process.argv.slice(2);
const sock = net.createConnection({ host, port });

sock.on('connect', () => {
  sock.write(JSON.stringify({ op: 'exec', sessionId, token, argv, env: envOut }) + '\n');
  // stdin 方向帧封装:传输层(TCP/WS/docker exec)不保证可靠传播半关闭,不能靠
  // sock.end() 让容器内进程见 EOF。SDK 关我们 stdin → 发长度 0 帧 → 容器内 shim
  // 据此关 claude stdin → claude 退出 → 流正常终止。
  process.stdin.on('data', (chunk) => {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(chunk.length, 0);
    sock.write(len);
    sock.write(chunk);
  });
  process.stdin.on('end', () => {
    sock.write(Buffer.alloc(4)); // 长度 0 = EOF 标记;不关 sock(还要收 stdout)
  });
  // stdout 方向裸流
  sock.pipe(process.stdout);
});

// stdout 收完(server 在 claude 退出后半关闭 → 'end')即可退出
sock.on('end', () => process.exit(0));
sock.on('close', () => process.exit(0));
sock.on('error', (err) => {
  process.stderr.write(`[forwarder-remote] ${err.message}\n`);
  process.exit(1);
});

// SDK abort → 转发器被 kill → 连接关闭 → server 检测到 → 关 docker exec stdin → shim 杀 claude
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { try { sock.destroy(); } catch { /* ignore */ } process.exit(0); });
}
