#!/usr/bin/env node
/**
 * R2 自测(文件通道)—— 在装了 docker 的服务器上跑:
 *   COWORK_ASSETS_DIR=<claude+shim 目录> node selftest-r2.mjs
 *
 * 覆盖:上传(含名字清洗/截断防半截文件)→ 容器内 agent 写文件 → since diff →
 * 下载(Content-Length/404/越权 403/符号链接逃逸 403)→ archive(tar.gz 完整性)→
 * 容器删除后文件仍可读(服务端直读 volume,会话容器不用醒)→ DELETE 清 volume →
 * reconcile 清孤儿 volume(只推过文件、从未起容器的会话)。
 */
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
const jget = async (p, opt) => (await fetch(BASE + p, opt)).json();
const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const srv = spawn(NODE, [path.join(DIR, 'index.mjs')], {
  env: { ...process.env, COWORK_SERVER_PORT: String(PORT), COWORK_SHIM_PATH: '/opt/cowork/cowork-shim.py' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

/** 谎报 Content-Length 后掐断连接 → 服务端不得留下半截文件。 */
function truncatedUpload(sid) {
  return new Promise((resolve) => {
    const req = http.request(`${BASE}/session/${sid}/file?name=trunc.bin`, {
      method: 'POST', headers: { 'content-length': '100' },
    });
    req.on('error', () => resolve());
    req.write(Buffer.alloc(10, 7));
    setTimeout(() => { req.destroy(); resolve(); }, 300);
  });
}

(async () => {
  await sleep(900);
  const A = 'cafe0001', C = 'cafe0003';
  await jget('/reconcile', { method: 'POST', body: JSON.stringify({ keep: [] }) });

  // 1. 上传(容器从未启动 → 纯 volume + helper)+ 名字清洗
  const up1 = await jget(`/session/${A}/file?name=in.txt`, { method: 'POST', body: 'hello-r2' });
  const up2 = await jget(`/session/${A}/file?name=${encodeURIComponent('../evil name?.txt')}`, { method: 'POST', body: 'x' });
  const noContainer = sh(`docker ps -aq --filter name=^cowork-${A}$ | wc -l`) === '0';
  check('R2 上传:容器不存在也可写(直写 volume)+ 名字清洗',
    up1.ok === true && up1.path === '/workspace/in.txt' && up2.path === '/workspace/evil_name_.txt' && noContainer,
    `p1=${up1.path} p2=${up2.path} noContainer=${noContainer}`);

  // 2. 截断上传不留半截文件
  await truncatedUpload(A);
  await sleep(1200);
  const afterTrunc = await jget(`/session/${A}/files?since=0`);
  const truncLeak = afterTrunc.files.some((f) => f.name.startsWith('trunc'));
  check('R2 上传:Content-Length 不符(断连)不留半截文件', !truncLeak, JSON.stringify(afterTrunc.files.map((f) => f.name)));

  // 3. 容器内 agent 写文件(非 root uid 对 volume 可写;HOME 在 tmpfs 不进 workspace)
  await jget(`/session/${A}`, { method: 'POST' });
  const t1 = Date.now();
  await sleep(1100); // mtime 粒度余量
  sh(`docker exec cowork-${A} sh -c 'echo agent-out > /workspace/gen.txt && mkdir -p /workspace/sub && echo nested > /workspace/sub/n.txt'`);
  sh(`docker exec cowork-${A} sh -c 'test "$HOME" = /home/agent && touch $HOME/.claude-state'`);
  const sinceDiff = await jget(`/session/${A}/files?since=${t1}`);
  const names = sinceDiff.files.map((f) => f.name).sort();
  const gen = sinceDiff.files.find((f) => f.name === 'gen.txt');
  // 期望恰好 [gen.txt, n.txt]:旧文件(in.txt)被 since 滤掉、目录本身不列、
  // HOME(tmpfs)里的 .claude-state 不混入 workspace diff。
  check('R2 diff:since 过滤 + 子目录递归 + HOME 状态不混入',
    JSON.stringify(names) === JSON.stringify(['gen.txt', 'n.txt'])
    && gen.path === '/workspace/gen.txt' && gen.size === 10 && gen.mtime >= t1,
    `names=${JSON.stringify(names)} gen=${JSON.stringify(gen)}`);

  // 4. 下载:Content-Length + 字节一致;404;server 侧越权 403;容器内符号链接逃逸 403
  const dl = await fetch(`${BASE}/session/${A}/file?path=${encodeURIComponent('/workspace/gen.txt')}`);
  const dlBody = Buffer.from(await dl.arrayBuffer());
  const miss = await fetch(`${BASE}/session/${A}/file?path=${encodeURIComponent('/workspace/missing.txt')}`);
  const esc = await fetch(`${BASE}/session/${A}/file?path=${encodeURIComponent('/etc/passwd')}`);
  sh(`docker exec cowork-${A} ln -s /etc/passwd /workspace/link.txt`);
  const sym = await fetch(`${BASE}/session/${A}/file?path=${encodeURIComponent('/workspace/link.txt')}`);
  check('R2 下载:200+CL+字节一致 / 404 / 越权 403 / 符号链接逃逸 403',
    dl.status === 200 && dl.headers.get('content-length') === '10' && dlBody.toString() === 'agent-out\n'
    && miss.status === 404 && esc.status === 403 && sym.status === 403,
    `dl=${dl.status}/${dlBody.length}B miss=${miss.status} esc=${esc.status} sym=${sym.status}`);

  // 5. archive:tar.gz 完整性(gzip 魔数 + Content-Length = 实际字节 + 成员齐全)
  const ar = await fetch(`${BASE}/session/${A}/archive`);
  const arBuf = Buffer.from(await ar.arrayBuffer());
  fs.writeFileSync('/tmp/r2-arch.tgz', arBuf);
  const members = sh('tar tzf /tmp/r2-arch.tgz');
  check('R2 archive:tar.gz 流式 + Content-Length 精确 + 成员齐全',
    ar.status === 200 && arBuf[0] === 0x1f && arBuf[1] === 0x8b
    && ar.headers.get('content-length') === String(arBuf.length)
    && members.includes('./in.txt') && members.includes('./gen.txt') && members.includes('./sub/n.txt'),
    `${arBuf.length}B members=[${members.split('\n').length}]`);

  // 6. 容器删除后文件仍可读(服务端直读 volume,会话容器不用醒)
  sh(`docker rm -f cowork-${A}`);
  const afterRm = await jget(`/session/${A}/files?since=0`);
  const dl2 = await fetch(`${BASE}/session/${A}/file?path=${encodeURIComponent('/workspace/in.txt')}`);
  const dl2Body = await dl2.text(); // 消费 body:不消费则 helper 还挂着 volume,影响下一步 DELETE
  const stillNoContainer = sh(`docker ps -aq --filter name=^cowork-${A}$ | wc -l`) === '0';
  check('R2 休眠读:容器已删仍可 list/下载(不唤醒会话容器)',
    afterRm.files.length >= 3 && dl2.status === 200 && dl2Body === 'hello-r2' && stillNoContainer,
    `files=${afterRm.files.length} dl=${dl2.status}/${dl2Body.length}B noContainer=${stillNoContainer}`);

  // 7. DELETE 会话 → volume 一起清;list 变空
  await jget(`/session/${A}`, { method: 'DELETE' });
  const volGone = sh(`docker volume ls -q --filter name=^cowork-ws-${A}$ | wc -l`) === '0';
  const afterDel = await jget(`/session/${A}/files?since=0`);
  check('R2 DELETE:容器+volume 全清,list 返空', volGone && afterDel.files.length === 0, `volGone=${volGone} files=${afterDel.files.length}`);

  // 8. reconcile 清"只有 volume 没容器"的孤儿会话
  await jget(`/session/${C}/file?name=orphan.txt`, { method: 'POST', body: 'o' });
  const rec = await jget('/reconcile', { method: 'POST', body: JSON.stringify({ keep: [] }) });
  const cVolGone = sh(`docker volume ls -q --filter name=^cowork-ws-${C}$ | wc -l`) === '0';
  check('R2 reconcile:孤儿 volume(无容器)也清', rec.removed.includes(C) && cVolGone, `removed=${JSON.stringify(rec.removed)} volGone=${cVolGone}`);

  console.log(`\n===== R2 SELFTEST: ${results.every(Boolean) ? 'ALL PASS' : 'FAILED'} =====`);
  try { srv.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(300);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
