#!/usr/bin/env node
/**
 * R0 本机协议自测(不依赖 docker / claude / 凭证)。
 *
 * 起 server(COWORK_POC_LOCAL=1:直接 spawn 本机 shim,shim 再 spawn fake-claude),
 * 再以"SDK"的身份 spawn forwarder-remote,喂 stream-json 行,验证:
 *   T1 基本 + 流式 + 优雅 EOF:init + N×assistant + result,forwarder exit 0
 *   T2 并发两会话:各自输出正确、内容不串
 *   T3 中断(abort):SIGKILL forwarder(不发零帧)→ 容器/本机 shim 靠 stdin EOF 自保杀 claude,无孤儿残留
 *
 * 把整条"帧编解码 / 零帧优雅 EOF / stdin-EOF abort 自保 / 流式 / 并发"钉死在本机,
 * 剩下唯一没验的就是 docker exec 那一格(等 UTM)。
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const PORT = 8791;
const SHIM = path.join(DIR, 'cowork-shim.py');
const FAKE = path.join(DIR, 'fake-claude.mjs');
const SERVER = path.join(DIR, 'cowork-server-poc.mjs');
const FWD = path.join(DIR, 'forwarder-remote.mjs');

fs.chmodSync(FAKE, 0o755);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
function countFake() { try { return parseInt(execSync(`pgrep -f fake-claude.mjs | wc -l`).toString().trim(), 10) || 0; } catch { return 0; } }

const srv = spawn(NODE, [SERVER], {
  env: { ...process.env, COWORK_POC_LOCAL: '1', COWORK_LOCAL_SHIM: SHIM, COWORK_CLAUDE_BIN: FAKE, COWORK_REMOTE_PORT: String(PORT), COWORK_ABORT_GRACE_MS: '1500' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

function runForwarder(sid, lines, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(NODE, [FWD], {
      env: { ...process.env, COWORK_REMOTE_PORT: String(PORT), COWORK_SESSION_ID: sid },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    setTimeout(() => {
      for (const l of lines) p.stdin.write(l + '\n');
      if (opts.kill) setTimeout(() => p.kill('SIGKILL'), 300);
      else p.stdin.end();
    }, 250);
    p.on('exit', (code) => resolve({ out, code }));
  });
}

function parseLines(out) { return out.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }); }

(async () => {
  await sleep(900); // 等 server listening

  // T1
  const r1 = await runForwarder('sess1', ['{"m":1}', '{"m":2}', '{"m":3}']);
  const l1 = parseLines(r1.out);
  const echoes1 = l1.filter((x) => x.type === 'assistant');
  check('T1 基本+流式+优雅EOF',
    l1[0]?.type === 'system' && echoes1.length === 3 && l1[l1.length - 1]?.type === 'result' && r1.code === 0,
    `lines=${l1.length} echoes=${echoes1.length} exit=${r1.code}`);

  // T2 并发
  const [a, b] = await Promise.all([runForwarder('sA', ['aaa', 'bbb']), runForwarder('sB', ['1', '2', '3', '4'])]);
  const la = parseLines(a.out).filter((x) => x.type === 'assistant');
  const lb = parseLines(b.out).filter((x) => x.type === 'assistant');
  const aClean = la.length === 2 && la.every((x) => ['aaa', 'bbb'].includes(x.echo_head));
  const bClean = lb.length === 4 && lb.every((x) => ['1', '2', '3', '4'].includes(x.echo_head));
  check('T2 并发两会话不串', aClean && bClean, `A echoes=${la.length}(${aClean}) B echoes=${lb.length}(${bClean})`);

  // T3 中断
  const before = countFake();
  await runForwarder('sKill', ['{"hang":true}'], { kill: true });
  await sleep(2600); // server abortGrace(1500) + shim watch_abort 轮询
  const after = countFake();
  check('T3 中断无孤儿残留', after === 0, `fake-claude 存活 before=${before} after=${after}`);

  const allOk = results.every((r) => r.ok);
  console.log(`\n===== R0 LOCAL SELFTEST: ${allOk ? 'ALL PASS' : 'FAILED'} =====`);
  try { srv.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(200);
  process.exit(allOk ? 0 : 1);
})();
