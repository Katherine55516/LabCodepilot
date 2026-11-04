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
// 退出码必须还原成容器内 claude 的,不能一律 0 ——
// 原来这里无条件 process.exit(0),于是 claude 在容器里 exit 1(如 "No conversation
// found with session ID" )也被抹平成"正常结束"。SDK 见子进程 code 0 且 stdout 零字节,
// 既不生成 exitError 也不产出消息,回合静默收场:用户"发出去没反应",客户端日志无痕,
// 错误只留在服务端 journal 里(2026-08 线上事故,排查成本极高)。
// 约定(server 侧 exec-bridge.mjs 对应):1000=claude 正常退出;4000+N=claude 退出码 N;
// 其余(1006 断线、1011 服务端错等)一律按失败。老服务端只会发 1000/1011,行为不变。
ws.on('close', (code) => {
  if (code >= 4000 && code <= 4255) process.exit(code - 4000);
  process.exit(code === 1000 || code === 1005 ? 0 : 1);
});
ws.on('error', (err) => { process.stderr.write(`[forwarder-remote] ${err.message}\n`); process.exit(1); });

for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(s, () => { try { ws.close(); } catch { /* ignore */ } process.exit(0); });
}
