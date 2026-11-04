#!/usr/bin/env node
/**
 * R0 docker 模式通道验证(在远程服务器上跑,需要一个名为 cowork-poc 的容器 + docker 权限)。
 *
 * 链路:forwarder-remote → TCP → cowork-server-poc → `docker exec -i` → cowork-shim.py
 *       → 容器内 /bin/cat(用 cat 当"模拟 claude":纯字节回显,免凭证就能验通道)。
 *
 * T1 字节穿透 + 优雅 EOF:发含二进制字节的多帧,cat 原样回显,收到==发送拼接,forwarder exit 0。
 *    (优雅 EOF 走应用层零长度帧,不赌 docker exec 半关闭 —— 应始终通过。)
 * T2 并发两 exec 到同容器:各自回显不串。
 * T3 中断无孤儿:SIGKILL forwarder(无零帧)→ 靠 docker exec 把 stdin EOF 真传给容器内 shim
 *    → shim 自保杀 cat。**这一条实测 docker exec 的 stdin-EOF 传播 + 孤儿行为**(调研点名的疑点):
 *    容器内无残留 cat = docker exec 正确传播 close;有残留 = 踩 moby 协议缺陷,需靠 server 兜底 kill。
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const PORT = 8790;
const CONTAINER = 'cowork-poc';
const SERVER = path.join(DIR, 'cowork-server-poc.mjs');
const FWD = path.join(DIR, 'forwarder-remote.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
function catCount() {
  try { return execSync(`docker top ${CONTAINER} 2>/dev/null | grep -c '/bin/cat' || true`).toString().trim(); }
  catch (e) { return 'err:' + (e.message || e); }
}

const srv = spawn(NODE, [SERVER], {
  env: { ...process.env, COWORK_REMOTE_PORT: String(PORT), COWORK_POC_CONTAINER: CONTAINER,
    COWORK_SHIM_PATH: '/opt/cowork/cowork-shim.py', COWORK_ABORT_GRACE_MS: '2500' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

function runFwd(sid, payloads, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(NODE, [FWD], {
      env: { ...process.env, COWORK_REMOTE_PORT: String(PORT), COWORK_SESSION_ID: sid,
        COWORK_CLAUDE_BIN: '/bin/cat' }, // 容器内 shim spawn /bin/cat 当"claude"
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    setTimeout(() => {
      for (const pl of payloads) p.stdin.write(pl);
      if (opts.kill) setTimeout(() => p.kill('SIGKILL'), 400);
      else p.stdin.end();
    }, 400);
    p.on('exit', (code) => resolve({ out: Buffer.concat(chunks), code }));
  });
}

(async () => {
  await sleep(1000);

  // T1 字节穿透 + 优雅 EOF
  const p1 = [Buffer.from('HELLO-'), Buffer.from([0x00, 0x01, 0x02, 0x0a, 0xff, 0xfe]), Buffer.from('-END')];
  const r1 = await runFwd('d1', p1);
  const want1 = Buffer.concat(p1);
  check('T1 docker-exec 字节穿透+优雅EOF',
    Buffer.compare(r1.out, want1) === 0 && r1.code === 0,
    `got ${r1.out.length}B want ${want1.length}B exit=${r1.code}`);

  // T2 并发
  const [rA, rB] = await Promise.all([runFwd('dA', [Buffer.from('AAAA')]), runFwd('dB', [Buffer.from('BBBBBBBB')])]);
  check('T2 并发两 exec 不串',
    rA.out.toString() === 'AAAA' && rB.out.toString() === 'BBBBBBBB',
    `A="${rA.out}" B="${rB.out}"`);

  // T3 中断:实测 docker exec stdin-EOF 传播 + 孤儿
  const before = catCount();
  await runFwd('dK', [Buffer.from('hang')], { kill: true });
  await sleep(3500);
  const after = catCount();
  check('T3 中断无孤儿(docker exec 传 stdin-EOF)', after === '0', `residual cat before=${before} after=${after}`);

  console.log(`\n===== R0 DOCKER SELFTEST: ${results.every(Boolean) ? 'ALL PASS' : 'FAILED'} =====`);
  try { srv.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(300);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
