#!/usr/bin/env node
/**
 * 管理面自测(用量后台 P0-b)—— 装了 docker 的服务器上:
 *   COWORK_ASSETS_DIR=<...> node selftest-admin.mjs
 *
 * 覆盖:
 *  鉴权     — /admin/* 只认 uid=__admin__ 的 token;普通用户 token → 404(防枚举,
 *             不承认 /admin 存在);坏 token → 401。
 *  audit    — 增量读取(offset 前进、行完整);fileId 稳定;截断(offset>size)归零。
 *  stats    — volumes/containers 形状;卷含 uid label 与 sizeBytes。
 *  admin 删 — 跨 uid 删除(用户面必 OWNER_MISMATCH 的场景)三方归零 + admin_remove 落审计。
 *  admin 读 — /admin/session/:sid/files 跨 uid 可列(用户面 404 的场景)。
 *
 * ⚠️ 与 r1-r3 相同的坑:跑之前 unset COWORK_AUTH_SECRET(本脚本自带测试 secret)。
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { signToken } from './lib/authz.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'admin-test-secret';
const AUDIT = path.join(os.tmpdir(), `cowork-audit-selftest-${process.pid}.log`);
// 末段直测 audit() 用动态 import —— audit.mjs 模块加载时读本进程 env,必须先设好
process.env.COWORK_AUDIT_FILE = AUDIT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
const sh = (cmd) => { try { return execFileSync('sh', ['-c', cmd], { timeout: 30000 }).toString(); } catch (e) { return ((e.stdout || '') + (e.stderr || '')).toString(); } };

const tokenUser = signToken('11111111-2222-3333-4444-555555555555', SECRET);
const tokenAdmin = signToken('__admin__', SECRET);
async function j(pathname, token, opt = {}) {
  const res = await fetch(BASE + pathname, { ...opt, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opt.headers || {}) } });
  let body = null; try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

sh('docker rm -f cowork-proxy $(docker ps -aq --filter label=cowork.managed=1) 2>/dev/null');
try { fs.unlinkSync(AUDIT); } catch { /* fresh */ }

const srv = spawn(NODE, [path.join(DIR, 'index.mjs')], {
  env: {
    ...process.env,
    COWORK_SERVER_PORT: String(PORT),
    COWORK_SERVER_HOST: '127.0.0.1',
    COWORK_AUTH_SECRET: SECRET,
    COWORK_AUDIT_FILE: AUDIT,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
process.on('exit', () => { try { srv.kill(); } catch { /* ignore */ } });

const SID = 'ad11a001';
try {
  await sleep(1200);

  // —— 鉴权 ——
  check('普通用户访问 /admin/audit → 404(防枚举)', (await j('/admin/audit', tokenUser)).status === 404);
  check('坏 token → 401', (await j('/admin/audit', 'bad.token')).status === 401);
  check('admin token 访问 /admin/audit → 200', (await j('/admin/audit', tokenAdmin)).status === 200);

  // —— 造数据:普通用户建会话(往审计里写事件) ——
  const en = await j(`/session/${SID}`, tokenUser, { method: 'POST' });
  check('普通用户建会话 200', en.status === 200, JSON.stringify(en.body));
  await sleep(300);

  // —— audit 增量 ——
  const a1 = await j('/admin/audit?offset=0', tokenAdmin);
  const okShape = a1.status === 200 && Array.isArray(a1.body.lines) && typeof a1.body.nextOffset === 'number' && typeof a1.body.fileId === 'string';
  check('audit 返回形状 {lines,nextOffset,fileSize,fileId}', okShape, JSON.stringify({ n: a1.body?.lines?.length, next: a1.body?.nextOffset }));
  const hasEnsure = (a1.body.lines || []).some((l) => l.includes('session_ensure') && l.includes(SID));
  check('audit 内容含 session_ensure', hasEnsure);
  const a2 = await j(`/admin/audit?offset=${a1.body.nextOffset}`, tokenAdmin);
  check('续拉无新事件 → lines 空且 offset 不动', a2.body.lines.length === 0 && a2.body.nextOffset === a1.body.nextOffset);
  check('fileId 稳定', a2.body.fileId === a1.body.fileId && a1.body.fileId.length === 16);
  const a3 = await j('/admin/audit?offset=999999999', tokenAdmin);
  check('offset 越界(截断信号)→ 归零重读', a3.body.lines.length > 0 && a3.body.nextOffset === a1.body.nextOffset);

  // —— stats ——
  const st = await j('/admin/stats', tokenAdmin);
  const vol = (st.body?.volumes || []).find((v) => v.sid === SID);
  check('stats.volumes 含新会话卷(uid label 对)', !!vol && vol.uid === '11111111-2222-3333-4444-555555555555', JSON.stringify(vol));
  check('stats.volumes 卷大小可取(数值或 null)', !!vol && (typeof vol.sizeBytes === 'number' || vol.sizeBytes === null));
  const ctr = (st.body?.containers || []).find((c) => c.sid === SID);
  check('stats.containers 含运行中会话', !!ctr, JSON.stringify(ctr));

  // —— admin 跨 uid 读/删(用户面语义下这是别人的会话) ——
  const lf = await j(`/admin/session/${SID}/files`, tokenAdmin);
  check('admin 跨 uid 列产物 200', lf.status === 200 && Array.isArray(lf.body.files));
  const del = await j(`/admin/session/${SID}`, tokenAdmin, { method: 'DELETE' });
  check('admin 跨 uid 删除 200', del.status === 200);
  await sleep(300);
  const gone = sh(`docker ps -a --filter name=^cowork-${SID}$ -q; docker volume ls --filter name=^cowork-ws-${SID}$ -q`).trim();
  check('删除后容器+卷归零', gone === '');
  const a4 = await j(`/admin/audit?offset=${a1.body.nextOffset}`, tokenAdmin);
  check('admin_remove 落审计', (a4.body.lines || []).some((l) => l.includes('admin_remove') && l.includes(SID)));

  // —— exec_end 字段存在性(靠 audit 模块直测,不起真 exec) ——
  const { audit } = await import('./lib/audit.mjs');
  audit('exec_end', { sessionId: 'deadbeef', detail: 'u', code: 0, durationMs: 1234 });
  await sleep(100);
  const tail = fs.readFileSync(AUDIT, 'utf8').trim().split('\n').pop();
  const rec = JSON.parse(tail);
  check('exec_end 记录 code/durationMs(code=0 不被丢)', rec.event === 'exec_end' && rec.code === 0 && rec.durationMs === 1234);
} finally {
  try { srv.kill(); } catch { /* ignore */ }
  sh(`docker rm -f cowork-${SID} 2>/dev/null; docker volume rm cowork-ws-${SID} 2>/dev/null`);
  try { fs.unlinkSync(AUDIT); } catch { /* ignore */ }
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
