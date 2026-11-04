#!/usr/bin/env node
/**
 * R3 自测(凭证代理,sidecar 容器版 RD6)—— 装了 docker 的服务器上跑:node selftest-r3.mjs
 *
 * 全链路都在 cowork-net 容器网络内(与生产一致,绕开"容器→宿主"的环境依赖):
 *   假上游容器(cowork-net 里跑 python http,记录收到的头,流式回两 chunk)
 *   ← cred-proxy 容器(被测)← 请求容器(模拟会话容器 claude,--network cowork-net)
 *
 * 覆盖:register(cwk_ token/幂等/凭证进 proxy tmpfs 经 docker exec stdin,不落宿主盘)
 * → 请求容器带 token 打 proxy:剥 token 注入真 key(api_key/auth_token 两风格)+ host
 * 重写 + path/query 保留 + 流式回传 → **真 key 零泄漏到请求容器**(env|grep 自证)
 * → 错/缺 token 401 → revoke 后 401 → DELETE session 联动废止 → 审计不含 key/token 本体。
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const NET = 'cowork-net';
const UPSTREAM = 'cwr3-upstream';
const AUDIT = '/tmp/cowork-audit-r3.log';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
const jget = async (p, opt) => (await fetch(BASE + p, opt)).json();
const sh = (cmd) => { try { return execFileSync('sh', ['-c', cmd], { timeout: 30000 }).toString(); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

// 假上游:cowork-net 里的容器,记录最后一次请求的头/体到 /shared/last.json,流式回两 chunk
const UPSTREAM_PY = `
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get('content-length',0) or 0)
        body=self.rfile.read(n).decode() if n else ''
        rec={'method':self.command,'path':self.path,'headers':{k.lower():v for k,v in self.headers.items()},'body':body}
        open('/shared/last.json','w').write(json.dumps(rec))
        self.send_response(200); self.send_header('content-type','text/event-stream'); self.end_headers()
        self.wfile.write(b'SSE-CHUNK-1;'); self.wfile.flush()
        import time; time.sleep(0.15); self.wfile.write(b'SSE-CHUNK-2'); self.wfile.flush()
HTTPServer(('0.0.0.0',8080),H).serve_forever()
`;

// 请求容器(模拟会话容器 claude):打 proxy,顺带 env 自证不含真 key
const CLIENT_PY = `
import sys, os, urllib.request, urllib.error
url, hname, hval = sys.argv[1], sys.argv[2], sys.argv[3]
env_has_real = any('sk-real-' in v for v in os.environ.values())
req = urllib.request.Request(url + '/v1/messages?beta=true', data=b'{"ping":1}', method='POST')
if hname != '-': req.add_header(hname, hval)
req.add_header('content-type','application/json')
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        sys.stdout.write(str(r.status)+'|'+r.read().decode()+'|envReal='+str(env_has_real))
except urllib.error.HTTPError as e:
    sys.stdout.write(str(e.code)+'||envReal='+str(env_has_real))
`;

// 在 cowork-net 里跑一次性请求容器(模拟会话容器 claude):只经 header 拿 token,
// env 全程无真 key —— envReal 应恒 False(真正的 P3-B 式 env 自证在 R3-4 dev 端到端)。
function fromContainer(hname, hval) {
  const args = [
    'run', '--rm', '--network', NET, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    'python:3-slim', 'python3', '-c', CLIENT_PY, 'http://cowork-proxy:8791', hname, hval,
  ];
  try { return execFileSync('docker', args, { timeout: 40000 }).toString(); }
  catch (e) { return 'ERR|' + ((e.stderr || e.message || '').toString().slice(-120)); }
}

const srv = spawn(NODE, [path.join(DIR, 'index.mjs')], {
  env: { ...process.env, COWORK_SERVER_PORT: String(PORT), COWORK_AUDIT_FILE: AUDIT, COWORK_SHIM_PATH: '/opt/cowork/cowork-shim.py' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

(async () => {
  try { fs.unlinkSync(AUDIT); } catch { /* fresh */ }
  await sleep(1500); // 等 server + ensureProxy(建网/起 proxy 容器/拷脚本)

  // 起假上游容器(cowork-net + 共享卷读回请求记录)
  sh(`docker rm -f ${UPSTREAM} >/dev/null 2>&1; docker volume rm cwr3-shared >/dev/null 2>&1`);
  sh(`docker volume create cwr3-shared >/dev/null`);
  const upFile = '/tmp/cwr3-upstream.py';
  fs.writeFileSync(upFile, UPSTREAM_PY);
  sh(`docker run -d --name ${UPSTREAM} --network ${NET} -v cwr3-shared:/shared -v ${upFile}:/up.py:ro python:3-slim python3 /up.py`);
  await sleep(1500);
  const readLast = () => { try { return JSON.parse(sh(`docker run --rm -v cwr3-shared:/shared python:3-slim cat /shared/last.json`)); } catch { return null; } };
  const UPBASE = `http://${UPSTREAM}:8080/`;

  const A = 'a3c00001', B = 'a3c00002';
  const KEY_A = 'sk-real-key-alpha', KEY_B = 'sk-real-key-bravo';

  // 1. register:cwk_ token + proxy baseUrl + 幂等
  const r1 = await jget(`/session/${A}/cred`, { method: 'POST', body: JSON.stringify({ realKey: KEY_A, realBase: UPBASE, authStyle: 'api_key' }) });
  const r1b = await jget(`/session/${A}/cred`, { method: 'POST', body: JSON.stringify({ realKey: KEY_A, realBase: UPBASE, authStyle: 'api_key' }) });
  check('R3 register:cwk_ token + proxy 容器 baseUrl + 幂等',
    /^cwk_[0-9a-f]{48}$/.test(r1.token) && r1.baseUrl === 'http://cowork-proxy:8791' && r1b.token === r1.token,
    `token=${String(r1.token).slice(0, 12)}… base=${r1.baseUrl}`);

  // 2. api_key 注入 + host 重写 + path 保留 + 流式 + 请求容器 env 无真 key
  const c1 = fromContainer('x-api-key', r1.token);
  const up1 = readLast();
  check('R3 注入(api_key):容器 200+两 chunk;上游见真 key;请求容器 env 无真 key',
    c1.startsWith('200|SSE-CHUNK-1;SSE-CHUNK-2|') && c1.includes('envReal=False')
    && up1 && up1.headers['x-api-key'] === KEY_A && up1.headers['authorization'] === undefined
    && up1.headers['host'] === `${UPSTREAM}:8080` && up1.path === '/v1/messages?beta=true' && up1.body === '{"ping":1}',
    `client=${c1.slice(0, 46)} up.x-api-key=${up1 && up1.headers['x-api-key']}`);

  // 3. auth_token 风格:Bearer 注入
  const r2 = await jget(`/session/${B}/cred`, { method: 'POST', body: JSON.stringify({ realKey: KEY_B, realBase: UPBASE, authStyle: 'auth_token' }) });
  const c2 = fromContainer('authorization', `Bearer ${r2.token}`);
  const up2 = readLast();
  check('R3 注入(auth_token):上游见 Bearer 真 key,不见 x-api-key',
    c2.startsWith('200|') && up2 && up2.headers['authorization'] === `Bearer ${KEY_B}` && up2.headers['x-api-key'] === undefined,
    `up.auth=${up2 && String(up2.headers['authorization']).slice(0, 22)}`);

  // 4. 错 token / 缺 auth → 401
  const bad = fromContainer('x-api-key', 'cwk_deadbeef');
  const none = fromContainer('-', '-');
  check('R3 拒绝:错 token 401 / 缺 auth 401', bad.startsWith('401|') && none.startsWith('401|'), `bad=${bad.slice(0, 8)} none=${none.slice(0, 8)}`);

  // 5. revoke:A 废止后 401,B 不受影响
  await jget(`/session/${A}/cred`, { method: 'DELETE' });
  const aRevoked = fromContainer('x-api-key', r1.token);
  const bStill = fromContainer('authorization', `Bearer ${r2.token}`);
  check('R3 revoke:A 废止后 401,B 不受影响', aRevoked.startsWith('401|') && bStill.startsWith('200|'), `A=${aRevoked.slice(0, 8)} B=${bStill.slice(0, 8)}`);

  // 6. DELETE session 联动废止 B
  await jget(`/session/${B}`, { method: 'DELETE' });
  const bGone = fromContainer('authorization', `Bearer ${r2.token}`);
  check('R3 会话删除联动废止 token', bGone.startsWith('401|'), `B=${bGone.slice(0, 8)}`);

  // 7. 审计:事件齐 + 零 key/token 泄漏
  const a = fs.existsSync(AUDIT) ? fs.readFileSync(AUDIT, 'utf8') : '';
  check('R3 审计:cred_issued/cred_revoked 齐,零 key/token 泄漏',
    a.includes('cred_issued') && a.includes('cred_revoked') && !a.includes('sk-real-') && !a.includes('cwk_'),
    `${a.trim().split('\n').filter(Boolean).length} 条`);

  console.log(`\n===== R3 SELFTEST: ${results.every(Boolean) ? 'ALL PASS' : 'FAILED'} =====`);
  sh(`docker rm -f ${UPSTREAM} >/dev/null 2>&1; docker volume rm cwr3-shared >/dev/null 2>&1`);
  try { srv.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(300);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
