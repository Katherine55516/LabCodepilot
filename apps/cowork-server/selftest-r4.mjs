#!/usr/bin/env node
/**
 * R4 自测(多用户 authz + 配额 + TTL 回收 + 出网禁内网)—— 装了 docker 的服务器上:
 *   COWORK_ASSETS_DIR=<...> node selftest-r4.mjs
 * 出网段需要 passwordless sudo(装/卸 DOCKER-USER 规则)。
 *
 * 覆盖:
 *  authz    — HMAC token 验签;userA 建的会话 userB 看不见/不能 exec/读文件(404 scope);
 *             坏/缺 token 401;reconcile 按 uid scope(A 的 reconcile 不动 B 的会话)。
 *  配额     — 容器 --cpus 生效(docker inspect NanoCpus)。
 *  TTL 回收 — stopContainer 停容器保留 volume;ensureContainer 复用(docker start)。
 *  出网     — 装 setup-egress.sh 后:会话容器→内网 REJECT、→公网 OPEN、→cred-proxy OPEN。
 */
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signToken } from './lib/authz.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'r4-test-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); }
const sh = (cmd) => { try { return execFileSync('sh', ['-c', cmd], { timeout: 30000 }).toString(); } catch (e) { return ((e.stdout || '') + (e.stderr || '')).toString(); } };

const tokenA = signToken('userA', SECRET);
const tokenB = signToken('userB', SECRET);
async function j(pathname, token, opt = {}) {
  const res = await fetch(BASE + pathname, { ...opt, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opt.headers || {}) } });
  let body = null; try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

// cowork-net 里跑一次性容器,python socket 探测目标可达性(OPEN / 立即失败 / 超时)
const PROBE_PY = `
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket(); s.settimeout(4)
try:
    s.connect((host, port)); s.close(); print('OPEN')
except Exception as e:
    print(type(e).__name__)
`;
function probe(host, port) {
  try {
    return execFileSync('docker', [
      'run', '--rm', '--network', 'cowork-net', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      'python:3-slim', 'python3', '-c', PROBE_PY, host, String(port),
    ], { timeout: 30000 }).toString().trim();
  } catch (e) { return 'ERR:' + ((e.stderr || e.message || '') + '').slice(-60); }
}

// spawn 前强制清干净:否则残留的 cowork-net(可能是旧网桥名)会让 ensureProxy 跳过重建,
// setup-egress.sh 的 -i cowork0 规则匹配不到旧网桥 → 内网拦不住(踩过)。
sh('docker rm -f cowork-proxy $(docker ps -aq --filter label=cowork.managed=1) 2>/dev/null; docker network rm cowork-net 2>/dev/null');

const srv = spawn(NODE, [path.join(DIR, 'index.mjs')], {
  env: { ...process.env, COWORK_SERVER_PORT: String(PORT), COWORK_AUTH_SECRET: SECRET, COWORK_CPUS: '1.5', COWORK_SHIM_PATH: '/opt/cowork/cowork-shim.py' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

(async () => {
  await sleep(2800); // server + ensureProxy(建 cowork-net/cowork0 + 拉起 proxy 容器)
  const A = 'd4a00001', B = 'd4b00002';
  // 清理:两 uid 各自 reconcile 空
  await j('/reconcile', tokenA, { method: 'POST', body: JSON.stringify({ keep: [] }) });
  await j('/reconcile', tokenB, { method: 'POST', body: JSON.stringify({ keep: [] }) });

  // 1. 鉴权:坏 token 401 / 缺 token 401 / 好 token 200
  const bad = await j(`/session/${A}`, 'garbage.sig', { method: 'POST' });
  const none = await j(`/session/${A}`, '', { method: 'POST' });
  const okA = await j(`/session/${A}`, tokenA, { method: 'POST' });
  check('R4 authz:坏/缺 token 401,好 token 200',
    bad.status === 401 && none.status === 401 && okA.status === 200 && okA.body.reused === false,
    `bad=${bad.status} none=${none.status} okA=${okA.status}`);

  // 2. scope:A 的会话,B 看不见(ensure/exec 前置 ensure/file/delete 全 404)
  const bEnsure = await j(`/session/${A}`, tokenB, { method: 'POST' });   // B 借 A 的 sid ensure
  const bFiles = await j(`/session/${A}/files?since=0`, tokenB);           // B 读 A 的文件
  const bDelete = await j(`/session/${A}`, tokenB, { method: 'DELETE' });  // B 删 A 的会话
  const aFiles = await j(`/session/${A}/files?since=0`, tokenA);           // A 自己读 OK
  check('R4 scope:B 对 A 会话 ensure/read/delete 全 404;A 自己 200',
    bEnsure.status === 404 && bFiles.status === 404 && bDelete.status === 404 && aFiles.status === 200,
    `bEnsure=${bEnsure.status} bFiles=${bFiles.status} bDelete=${bDelete.status} aFiles=${aFiles.status}`);

  // 3. 配额:--cpus 1.5 → NanoCpus 1.5e9
  const nano = sh(`docker inspect cowork-${A} --format '{{.HostConfig.NanoCpus}}'`).trim();
  check('R4 配额:容器 --cpus 生效', nano === '1500000000', `NanoCpus=${nano}`);

  // 4. TTL 回收机制:stopContainer 停容器保留 volume;ensure 复用(docker start)。
  // -t 1:sleep infinity 不理 SIGTERM,给 1s 就 SIGKILL(默认 10s 会拖长测试)。
  const stopped = sh(`docker stop -t 1 cowork-${A} >/dev/null 2>&1 && echo ok`).includes('ok');
  const stateAfterStop = sh(`docker inspect cowork-${A} --format '{{.State.Status}}'`).trim();
  const volAfterStop = sh(`docker volume ls -q --filter name=^cowork-ws-${A}$`).trim();
  const reAfter = await j(`/session/${A}`, tokenA, { method: 'POST' });
  const running = sh(`docker inspect cowork-${A} --format '{{.State.Running}}'`).trim();
  check('R4 TTL:stop 保留 volume + ensure 复用(docker start)',
    stopped && stateAfterStop === 'exited' && volAfterStop.length > 0 && reAfter.body.reused === true && running === 'true',
    `stopped=${stopped} state=${stateAfterStop} vol=${!!volAfterStop} reused=${reAfter.body && reAfter.body.reused} running=${running}`);

  // 5. reconcile scope:B 建会话,A 的 reconcile keep=[] 不该删 B 的
  await j(`/session/${B}`, tokenB, { method: 'POST' });
  const recA = await j('/reconcile', tokenA, { method: 'POST', body: JSON.stringify({ keep: [] }) });
  const bAlive = sh(`docker inspect cowork-${B} --format '{{.State.Running}}'`).trim();
  check('R4 reconcile scope:A 的 reconcile 只删 A 的,不动 B',
    recA.body.removed.includes(A) && !recA.body.removed.includes(B) && bAlive === 'true',
    `A.removed=${JSON.stringify(recA.body.removed)} bAlive=${bAlive}`);

  // 6. 出网禁内网:装 egress 前基线(公网 OPEN)→ 装 → 内网 REJECT/公网 OPEN/proxy OPEN
  const pubBefore = probe('1.1.1.1', 443);
  sh(`sudo -n sh ${path.join(DIR, 'setup-egress.sh')} 2>&1`);
  const intranet = probe('192.168.64.1', 443);   // vmnet 网关(私网,非 cowork-net)
  const pubAfter = probe('1.1.1.1', 443);
  const proxyReach = probe('cowork-proxy', 8791);
  check('R4 出网:装 egress 后内网被拦、公网放行、cred-proxy 可达',
    pubBefore === 'OPEN' && intranet !== 'OPEN' && pubAfter === 'OPEN' && proxyReach === 'OPEN',
    `pubBefore=${pubBefore} intranet=${intranet} pubAfter=${pubAfter} proxy=${proxyReach}`);

  // 清理:卸载 egress 规则(不留 VM 全局副作用)+ 会话
  sh(`sudo -n sh -c 'while iptables -L DOCKER-USER -n --line-numbers | grep -q cowork-egress; do l=$(iptables -L DOCKER-USER -n --line-numbers | grep cowork-egress | head -1 | awk "{print \\$1}"); iptables -D DOCKER-USER $l; done' 2>&1`);
  await j('/reconcile', tokenA, { method: 'POST', body: JSON.stringify({ keep: [] }) });
  await j('/reconcile', tokenB, { method: 'POST', body: JSON.stringify({ keep: [] }) });

  console.log(`\n===== R4 SELFTEST: ${results.every(Boolean) ? 'ALL PASS' : 'FAILED'} =====`);
  try { srv.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(300);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
