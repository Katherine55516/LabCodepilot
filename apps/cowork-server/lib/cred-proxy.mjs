/**
 * 凭证代理编排(R3,方案 A)—— 宿主侧半边,配合 container/cred-proxy.py(sidecar 容器)。
 *
 * RD6:docker 场景"容器→宿主网关"不可靠(企业防火墙/k8s 残留 iptables 可堵死;
 * 验证 VM 实测容器→宿主全超时),故代理下沉为可信 sidecar 容器,与会话容器同处
 * 专用网络 cowork-net,走容器↔容器(docker 自身保证的稳定路径)。
 *
 * 本模块只做编排 + 凭证注入,不亲自转发:
 *   - ensureNetwork/ensureProxy:确保 cowork-net + cred-proxy 容器就绪(幂等)。
 *     proxy 容器 = python:3-slim 跑 cred-proxy.py,/creds 是 tmpfs(真 key 只落
 *     proxy 容器内存态 tmpfs,不落宿主盘)。会话容器接入 cowork-net 由 orchestrator 做。
 *   - registerCredentials:docker exec 把 {token,realKey,realBase,authStyle} 经
 *     **stdin** 写进 proxy 容器 /creds/<token>.json(exec 走 docker API,不走网络、
 *     真 key 不落宿主盘)。返回 { token, baseUrl: http://cowork-proxy:8791 }。
 *   - revokeCredentials:docker exec rm 该 token 文件。
 *
 * credSource 预留(RD4):registerCredentials 是唯一登记入口。方案 A 由 REST 路由
 * (客户端 TLS 交 key)喂;将来切方案 C(服务端向账号后端直取)时,服务端自己拉取
 * 后喂同一入口,proxy 容器/会话容器侧零改动。
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from './audit.mjs';

const execFileP = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));

const NET = process.env.COWORK_NET || 'cowork-net';
const PROXY_NAME = process.env.COWORK_PROXY_NAME || 'cowork-proxy';
const PROXY_PORT = parseInt(process.env.COWORK_PROXY_PORT || '8791', 10);
const IMAGE = process.env.COWORK_IMAGE || 'python:3-slim';
// 容器内 cred-proxy.py:bind-mount 宿主脚本(:ro)。dev/R3 最稳(docker cp 到 tmpfs
// 会被遮盖,踩过);R5 烘进自建镜像后改镜像自带路径,去掉此 mount。
const PROXY_PY_HOST = process.env.COWORK_CRED_PROXY_PATH || path.join(DIR, '..', 'container', 'cred-proxy.py');
const LABEL_MANAGED = 'cowork.managed=1';
const HEX = /^[a-f0-9]{1,64}$/i;

/** sessionId → token(幂等复用 + 废止;server 重启清零,客户端每回合重 register 自愈)。 */
const tokenBySession = new Map();

let ready = null;

async function docker(args, opts) {
  const { stdout } = await execFileP('docker', args, { maxBuffer: 8 * 1024 * 1024, ...opts });
  return stdout;
}

/** 确保专用网络 + proxy 容器就绪(幂等)。会话容器接入同网络由 orchestrator 负责。 */
export function ensureProxy(log = () => {}) {
  if (ready) return ready;
  ready = (async () => {
    if (!fs.existsSync(PROXY_PY_HOST)) throw new Error(`cred-proxy.py not found: ${PROXY_PY_HOST}`);
    // 网络(容器↔容器隔离域)
    const nets = await docker(['network', 'ls', '--filter', `name=^${NET}$`, '--format', '{{.Name}}']);
    if (!nets.trim()) await docker(['network', 'create', '--label', LABEL_MANAGED, NET]);

    // proxy 容器
    const ps = (await docker(['ps', '-a', '--filter', `name=^${PROXY_NAME}$`, '--format', '{{.State}}'])).trim();
    if (ps === 'running') return;
    if (ps) await docker(['rm', '-f', PROXY_NAME]).catch(() => {});
    await docker([
      'run', '-d', '--name', PROXY_NAME, '--label', LABEL_MANAGED,
      '--network', NET,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '256m', '--pids-limit', '128',
      // /creds 是 tmpfs:真 key 只落 proxy 容器内存态 tmpfs,永不落宿主盘。
      '--tmpfs', '/creds:mode=0700',
      // cred-proxy.py bind-mount 只读(dev/R3;R5 烘进镜像后去掉)。
      '-v', `${PROXY_PY_HOST}:/opt/cred-proxy.py:ro`,
      '-e', `COWORK_PROXY_PORT=${PROXY_PORT}`,
      IMAGE, 'python3', '/opt/cred-proxy.py',
    ]);
    log(`cred-proxy container ${PROXY_NAME} on ${NET}:${PROXY_PORT} (real keys only in its tmpfs)`);
  })();
  return ready;
}

export const networkName = NET;

/**
 * 登记会话凭证(幂等)。docker exec 把凭证经 stdin 写进 proxy 容器 tmpfs
 * /creds/<token>.json —— 不走网络、真 key 不落宿主盘。返回 { token, baseUrl }。
 */
export async function registerCredentials(sessionId, { realKey, realBase, authStyle }, log = () => {}) {
  if (!HEX.test(sessionId)) throw new Error('invalid sessionId');
  if (!realKey || !realBase) throw new Error('realKey/realBase required');
  await ensureProxy(log);
  const style = authStyle === 'auth_token' ? 'auth_token' : 'api_key';
  let token = tokenBySession.get(sessionId);
  if (!token) {
    token = 'cwk_' + crypto.randomBytes(24).toString('hex');
    tokenBySession.set(sessionId, token);
  }
  const payload = JSON.stringify({ sessionId, realKey, realBase, authStyle: style });
  // tee 经 stdin 写文件(真 key 不出现在 argv/进程表);0600 权限
  await new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', '-i', PROXY_NAME, 'sh', '-c', `umask 077; cat > /creds/${token}.json`]);
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`cred write exit ${code}: ${err.slice(0, 120)}`))));
    p.stdin.end(payload);
  });
  audit('cred_issued', { sessionId });
  return { token, baseUrl: `http://${PROXY_NAME}:${PROXY_PORT}` };
}

/** 废止会话 token(docker exec rm proxy 容器里的凭证文件)。best-effort。 */
export async function revokeCredentials(sessionId) {
  const token = tokenBySession.get(sessionId);
  if (!token) return;
  tokenBySession.delete(sessionId);
  try { await docker(['exec', PROXY_NAME, 'rm', '-f', `/creds/${token}.json`]); } catch { /* proxy 可能已重启,tmpfs 已空 */ }
  audit('cred_revoked', { sessionId });
}

export const _internals = { tokenBySession, NET, PROXY_NAME, PROXY_PORT };
