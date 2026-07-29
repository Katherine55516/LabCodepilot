#!/usr/bin/env node
/**
 * Cowork 远程容器沙箱 — exec 转发器(WebSocket 版,R1)。
 *
 * SDK 把本脚本当 claude 可执行文件 spawn。它连 cowork-server 的
 * `ws(s)://host:port/session/<sid>/exec`,发一个 header(text)+ stdin 帧流(binary),
 * 把 process 的 stdin↔WS 做帧封装双向管道,让远程容器内 claude 跑 stream-json。
 *
 * 从 R0 的裸 TCP 版升级:帧协议(stdin [u32 BE len][bytes]+零长 EOF / stdout 裸流)
 * 一字不改,只把承载换成 WS message —— header=text、stdin 帧=binary、stdout=binary。
 * 生产 wss:// + Bearer 由此打通(切 TLS 只是 ws→wss)。
 *
 * env:
 *   COWORK_REMOTE_HOST / COWORK_REMOTE_PORT / COWORK_REMOTE_SCHEME(ws|wss,默认 ws)
 *   COWORK_SESSION_ID / COWORK_REMOTE_TOKEN(Bearer)
 *   ANTHROPIC_* / CLAUDE_* / COWORK_* 白名单过河
 */
import WebSocket from 'ws';

const scheme = process.env.COWORK_REMOTE_SCHEME || 'ws';
const host = process.env.COWORK_REMOTE_HOST || '127.0.0.1';
const port = parseInt(process.env.COWORK_REMOTE_PORT || '8790', 10);
const sid = process.env.COWORK_SESSION_ID || '';
const token = process.env.COWORK_REMOTE_TOKEN || '';

// HTTP_PROXY/HTTPS_PROXY/NO_PROXY **故意不过河**(生产实测踩过):宿主的代理地址
// 几乎总是 127.0.0.1:xxxx —— 系统代理、Clash/Surge 之类本地代理软件,而 main.ts
// 还会主动探测 macOS 系统代理并注入这两个变量。送进远程容器后 127.0.0.1 指向容器
// 自身,claude 把每个 API 请求都发给一个不存在的端口 → 出向零字节、卡两分多钟后
// exit 1,客户端表现为"模型没有任何反应"。沙箱有自己的出网路径(cred-proxy +
// 公网直连),与客户端宿主的网络环境无关;沙箱侧若需代理应在服务器端配置。
// 同理适用于本地 VM(vfkit):VM 内的 127.0.0.1 也不是宿主。
const envOut = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^(ANTHROPIC_|CLAUDE_|COWORK_)/.test(k) || k === 'API_TIMEOUT_MS') {
    if (typeof v === 'string') envOut[k] = v;
  }
}
const argv = process.argv.slice(2);

const ws = new WebSocket(`${scheme}://${host}:${port}/session/${sid}/exec`, {
  headers: token ? { authorization: `Bearer ${token}` } : {},
});
ws.binaryType = 'nodebuffer';

ws.on('open', () => {
  ws.send(JSON.stringify({ argv, env: envOut })); // header(text)
  process.stdin.on('data', (chunk) => {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(chunk.length, 0);
    ws.send(Buffer.concat([len, chunk])); // stdin 帧(binary)
  });
  process.stdin.on('end', () => { ws.send(Buffer.alloc(4)); }); // 长度 0 = EOF 标记
});
ws.on('message', (data) => { process.stdout.write(data); }); // claude stdout 裸流
ws.on('close', () => process.exit(0));
ws.on('error', (err) => { process.stderr.write(`[forwarder-remote] ${err.message}\n`); process.exit(1); });

for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(s, () => { try { ws.close(); } catch { /* ignore */ } process.exit(0); });
}
