#!/usr/bin/env node
/**
 * 转发器退出码还原自测(不需要 docker,也不连生产)。
 *
 *   node apps/cowork-server/selftest-forwarder-exit.mjs
 *
 * 起一个本地 WS 服务冒充 exec 桥,按约定的 close code 关连接,验证真实的
 * client/forwarder-remote.mjs 以正确的退出码结束:
 *   1000 / 1005 → 0(claude 正常退出)
 *   4000+N      → N(claude 以 N 退出;4000-4999 是 WS 规范留给应用层的区间)
 *   其余(1006 断线 / 1011 服务端错)→ 1(失败,绝不能静默成 0)
 *
 * 为什么值得单独钉:原实现是 `ws.on('close', () => process.exit(0))` —— 容器里 claude
 * exit 1 被抹平成 0,SDK 认为进程正常结束且零输出,回合静默收场。这是 2026-08 那次
 * "消息发出去毫无反应、客户端日志无痕"事故里最难查的一环,回归代价极高。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FWD = path.join(DIR, 'client', 'forwarder-remote.mjs');

const CASES = [
  { closeCode: 1000, expect: 0, label: 'claude 正常退出(1000)→ 0' },
  { closeCode: 4001, expect: 1, label: 'claude exit 1(4001)→ 1  ← 事故那一条' },
  { closeCode: 4042, expect: 42, label: 'claude exit 42(4042)→ 42' },
  { closeCode: 1011, expect: 1, label: '服务端错(1011)→ 1,不静默' },
  { closeCode: 4255, expect: 255, label: '边界:退出码上限 255' },
];

/** 起一个只做"收 header → 按给定 code 关连接"的假 exec 桥,返回端口。 */
function fakeBridge(closeCode) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', (ws) => {
      ws.once('message', () => {          // 首帧 = header(text JSON)
        setTimeout(() => ws.close(closeCode, 'exec exit'), 20);
      });
    });
    wss.on('listening', () => resolve({ port: wss.address().port, close: () => wss.close() }));
  });
}

function runForwarder(port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FWD, '--print'], {
      env: {
        ...process.env,
        COWORK_REMOTE_SCHEME: 'ws',
        COWORK_REMOTE_HOST: '127.0.0.1',
        COWORK_REMOTE_PORT: String(port),
        COWORK_SESSION_ID: 'selftest',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

let failed = 0;
for (const c of CASES) {
  const bridge = await fakeBridge(c.closeCode);
  const { code, stderr } = await runForwarder(bridge.port);
  bridge.close();
  const ok = code === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}${ok ? '' : `  (实际 exit=${code} stderr=${stderr.trim()})`}`);
}

console.log(failed ? `\nFAILED: ${failed}/${CASES.length}` : `\nALL PASS (${CASES.length})`);
process.exit(failed ? 1 : 0);
