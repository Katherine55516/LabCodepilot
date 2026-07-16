#!/usr/bin/env node
/**
 * R1-1 自测(在装了 docker + ws 的服务器上跑,需要 COWORK_ASSETS_DIR 指向含 claude+shim 的宿主目录)。
 *
 * REST 编排:health / ensure(幂等复用)/ 多会话 / reconcile 孤儿清理。
 * WS exec:forwarder(WS)→ server → docker exec → 容器内 /bin/cat 回显 + 优雅 EOF + 中断无孤儿。
 * 容器 per 会话:每个 hex sid 一个 cowork-<sid> 容器,volume 独立。
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const FWD = path.join(DIR, 'client', 'forwarder-remote.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
function catCount(sid) {
  try { return execSync(`docker top cowork-${sid} 2>/dev/null | grep -c '/bin/cat' || true`).toString().trim(); }
  catch { return '0'; }
}

const srv = spawn(NODE, [path.join(DIR, 'index.mjs')], {
  env: { ...process.env, COWORK_SERVER_PORT: String(PORT), COWORK_SHIM_PATH: '/opt/cowork/cowork-shim.py', COWORK_ABORT_GRACE_MS: '2500' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

function runFwd(sid, payloads, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(NODE, [FWD], {
      env: { ...process.env, COWORK_REMOTE_PORT: String(PORT), COWORK_SESSION_ID: sid, COWORK_CLAUDE_BIN: '/bin/cat' },
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
const jget = async (p, opt) => (await fetch(BASE + p, opt)).json();

(async () => {
  await sleep(900);
  const A = 'aaaa1111', B = 'bbbb2222';
  // 先清干净
  await jget('/reconcile', { method: 'POST', body: JSON.stringify({ keep: [] }) });

  // REST 编排
  const health = await jget('/health');
  const e1 = await jget(`/session/${A}`, { method: 'POST' });
  const e1b = await jget(`/session/${A}`, { method: 'POST' });
  const e2 = await jget(`/session/${B}`, { method: 'POST' });
  check('R1 REST: health + 容器 per 会话 + 幂等复用',
    health.ok === true && e1.reused === false && e1b.reused === true && e2.reused === false,
    `health=${health.ok} e1.new=${!e1.reused} e1b.reused=${e1b.reused} e2.new=${!e2.reused}`);

  const rec = await jget('/reconcile', { method: 'POST', body: JSON.stringify({ keep: [A] }) });
  check('R1 REST: reconcile 清孤儿(keep A → 删 B)', Array.isArray(rec.removed) && rec.removed.includes(B) && !rec.removed.includes(A), `removed=${JSON.stringify(rec.removed)}`);

  // WS exec 字节穿透 + 优雅 EOF
  const p1 = [Buffer.from('WS-'), Buffer.from([0x00, 0x0a, 0xff]), Buffer.from('-OK')];
  const r1 = await runFwd(A, p1);
  const want = Buffer.concat(p1);
  check('R1 WS exec: 字节穿透 + 优雅零帧 EOF', Buffer.compare(r1.out, want) === 0 && r1.code === 0, `got ${r1.out.length}B want ${want.length}B exit=${r1.code}`);

  // WS exec 中断无孤儿
  await runFwd(A, [Buffer.from('hang')], { kill: true });
  await sleep(3200);
  check('R1 WS exec: 中断无孤儿', catCount(A) === '0', `residual cat=${catCount(A)}`);

  // cleanup
  await jget('/reconcile', { method: 'POST', body: JSON.stringify({ keep: [] }) });
  console.log(`\n===== R1-1 SELFTEST: ${results.every(Boolean) ? 'ALL PASS' : 'FAILED'} =====`);
  try { srv.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(300);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
