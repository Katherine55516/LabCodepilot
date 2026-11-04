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

// 白名单 env 过河(不透传宿主 HOME/PATH 等)。
// HTTP_PROXY/HTTPS_PROXY/NO_PROXY 故意不过河:宿主代理地址几乎总是 127.0.0.1:xxxx
// (main.ts 还会主动探测 macOS 系统代理并注入),而 VM 内的 127.0.0.1 是 VM 自己,
// claude 会把 API 请求发给不存在的端口并卡死。见 forwarder-remote.mjs 同处注释
// (远程沙箱上已生产实测:出向零字节 + 两分钟后 exit 1)。
const envOut = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^(ANTHROPIC_|CLAUDE_|COWORK_)/.test(k) || k === 'API_TIMEOUT_MS') {
    if (typeof v === 'string') envOut[k] = v;
  }
}

const argv = process.argv.slice(2);
const sock = net.createConnection({ path: sockPath });

sock.on('connect', () => {
  sock.write(JSON.stringify({ op: 'exec', sessionId, argv, env: envOut }) + '\n');
  // stdin 方向做 [uint32 BE 长度][字节] 帧封装:vfkit 透明代理不可靠传播半关闭,
  // 不能靠 sock.end() 让 guest 见 EOF。SDK 关我们的 stdin 时,发一个长度 0 帧
  // 作为显式 EOF 标记,daemon 据此关 claude stdin → claude 退出 → 流正常终止。
  process.stdin.on('data', (chunk) => {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(chunk.length, 0);
    sock.write(len);
    sock.write(chunk);
  });
  process.stdin.on('end', () => {
    const zero = Buffer.alloc(4); // 长度 0 = EOF 标记;不关 sock(还要收 stdout)
    sock.write(zero);
  });
  // stdout 方向裸流
  sock.pipe(process.stdout);
});

// stdout 收完(daemon 在 claude 退出后 shutdown(SHUT_WR)→ 这里 'end')即可退出:
// 该轮输出已全部转发给 SDK。不能只等 'close' —— daemon 半关闭时 host 只收 'end'
// 不收 'close',会导致转发器残留。
sock.on('end', () => process.exit(0));
sock.on('close', () => process.exit(0));
sock.on('error', (err) => {
  process.stderr.write(`[forwarder-vsock] ${err.message}\n`);
  process.exit(1);
});

// SDK abort → 转发器被 kill → 连接关闭 → guest daemon 检测到 kill child
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { try { sock.destroy(); } catch { /* ignore */ } process.exit(0); });
}
