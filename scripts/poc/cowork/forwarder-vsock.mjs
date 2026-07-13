#!/usr/bin/env node
/**
 * Cowork 沙箱 P1-C — exec 转发器(vsock 版,取代 forwarder-ssh.sh)。
 *
 * SDK 把本脚本当 claude 可执行文件 spawn。它连 vfkit 暴露的 vsock unix
 * socket,发一帧 exec header(sessionId + argv + 白名单 env),之后把
 * process.stdin ↔ 连接做裸双向管道,让 guest 内 daemon spawn 的 linux
 * claude 跑 stream-json。无握手、无魔数(vfkit 透明代理)。
 *
 * env:
 *   COWORK_VSOCK_PATH   — vfkit socketURL(宿主 unix socket 路径)
 *   COWORK_SESSION_ID   — 会话 id(hex)
 */
import net from 'node:net';
import fs from 'node:fs';

const sockPath = process.env.COWORK_VSOCK_PATH;
const sessionId = process.env.COWORK_SESSION_ID || '';
if (!sockPath || !fs.existsSync(sockPath)) {
  process.stderr.write(`[forwarder-vsock] vsock socket not found: ${sockPath}\n`);
  process.exit(127);
}

// 白名单 env 过河(不透传宿主 HOME/PATH 等)
const envOut = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^(ANTHROPIC_|CLAUDE_|COWORK_)/.test(k) || ['API_TIMEOUT_MS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].includes(k)) {
    if (typeof v === 'string') envOut[k] = v;
  }
}

const argv = process.argv.slice(2);
const sock = net.createConnection({ path: sockPath });

sock.on('connect', () => {
  sock.write(JSON.stringify({ op: 'exec', sessionId, argv, env: envOut }) + '\n');
  // 裸双向管道
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
});

// 连接结束 → CLI 进程结束,退出转发器
sock.on('close', () => process.exit(0));
sock.on('error', (err) => {
  process.stderr.write(`[forwarder-vsock] ${err.message}\n`);
  process.exit(1);
});

// SDK abort → 转发器被 kill → 连接关闭 → guest daemon 检测到 kill child
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { try { sock.destroy(); } catch { /* ignore */ } process.exit(0); });
}
