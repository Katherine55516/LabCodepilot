#!/usr/bin/env node
/**
 * Cowork 远程容器沙箱服务端控制面(R1–R4)。
 *
 * 单公司裸金属服务器上常驻。一个 HTTP server 承载:
 *   REST(短 op):
 *     GET  /health                     → docker 可用性 + 受管会话数
 *     POST /session/:id                → 确保会话容器就绪(幂等)
 *     DELETE /session/:id              → 移除会话容器 + volume(会话删除)
 *     POST /reconcile  {keep:[...]}    → 删除不在 keep 的孤儿会话(按 uid scope)
 *   文件通道(R2,服务端经 helper 容器直读会话 volume,会话容器不用醒):
 *     POST /session/:id/file?name=     → 上传(body=裸字节)→ {ok,path}
 *     GET  /session/:id/files?since=   → 产物 diff → {files:[{path,name,size,mtime}]}
 *     GET  /session/:id/file?path=     → 下载单文件(流式,Content-Length)
 *     GET  /session/:id/archive        → 打包 workspace(tar.gz 流式,Content-Length)
 *   凭证代理(R3,方案 A;真 key 只进 proxy 容器 tmpfs,会话容器只见 cwk_ 一次性 token):
 *     POST /session/:id/cred {realKey,realBase,authStyle} → {token,baseUrl}
 *     DELETE /session/:id/cred         → 废止 token(会话删除/reconcile 自动联动)
 *   WS:
 *     /session/:id/exec                → 帧桥到 docker exec(升级前先 ensureContainer)
 *
 * 鉴权(R4):COWORK_AUTH_SECRET 设置 → HMAC token 多用户模式(resolveUser 验签取 uid,
 * 会话按 cowork.uid label scope,跨用户访问 404 防枚举)。未设 → 回退单用户:
 * COWORK_SERVER_TOKEN 全局 Bearer(空=dev 全开)。TLS 在 R5 由反代接入(ws→wss 只加层)。
 *
 * env:见各 lib + COWORK_AUTH_SECRET(HMAC 密钥)/ COWORK_IDLE_TTL_MS(空闲回收,默认 30min)。
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import * as orch from './lib/orchestrator.mjs';
import * as files from './lib/files.mjs';
import * as cred from './lib/cred-proxy.mjs';
import { audit } from './lib/audit.mjs';
import { resolveUser, authzEnabled } from './lib/authz.mjs';
import { handleExec } from './lib/exec-bridge.mjs';

const PORT = parseInt(process.env.COWORK_SERVER_PORT || '8790', 10);
// 监听地址:默认 0.0.0.0(客户端直连);上 TLS 反代时设 127.0.0.1,让 caddy/nginx
// 独占对外、明文端口不暴露公网(见 deploy/docker-compose.tls.yml)。
const HOST = process.env.COWORK_SERVER_HOST || '0.0.0.0';
const TOKEN = process.env.COWORK_SERVER_TOKEN || '';
const SHIM = process.env.COWORK_SHIM_PATH || '/opt/cowork/cowork-shim.py';
const IDLE_TTL_MS = parseInt(process.env.COWORK_IDLE_TTL_MS || String(30 * 60 * 1000), 10);
const SID_RE = /^\/session\/([a-f0-9]{1,64})$/i;
const EXEC_RE = /^\/session\/([a-f0-9]{1,64})\/exec$/i;
const FILE_RE = /^\/session\/([a-f0-9]{1,64})\/(file|files|archive)$/i;
const CRED_RE = /^\/session\/([a-f0-9]{1,64})\/cred$/i;

function log(...a) { process.stderr.write('[cowork-server] ' + a.join(' ') + '\n'); }
async function readBody(req) { let b = ''; for await (const c of req) b += c; return b; }

/**
 * 统一鉴权 → 返回 { uid } 或 null(调用方 401)。
 * authz 开启:HMAC 验签取 uid。关闭:回退全局 COWORK_SERVER_TOKEN(空=全开,uid=__single__)。
 */
function authOf(req) {
  if (authzEnabled) return resolveUser(req);
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return null;
  return { uid: orch.SINGLE_UID };
}

// —— R4 空闲回收:仅 exec 续命(file op 不算会话活跃);有活跃 exec 连接的会话绝不回收 ——
const lastActive = new Map();   // sid → 最后一次 exec 的毫秒时间
const activeExec = new Map();   // sid → 当前活跃 exec 连接数
function markActive(sid) { lastActive.set(sid, Date.now()); }
function execOpened(sid) { activeExec.set(sid, (activeExec.get(sid) || 0) + 1); markActive(sid); }
function execClosed(sid) {
  const n = (activeExec.get(sid) || 1) - 1;
  if (n <= 0) activeExec.delete(sid); else activeExec.set(sid, n);
  markActive(sid);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const auth = authOf(req);
    if (!auth) return send(401, { error: 'unauthorized' });
    const { uid } = auth;

    if (req.method === 'GET' && url.pathname === '/health') return send(200, await orch.health());

    if (req.method === 'POST' && url.pathname === '/reconcile') {
      const keep = (JSON.parse((await readBody(req)) || '{}').keep) || [];
      // scope 到本 uid:绝不动别的用户的会话。authz 关闭时 uid=__single__(全部单用户)。
      const removed = await orch.reconcile(keep, authzEnabled ? uid : undefined);
      for (const sid of removed) { await cred.revokeCredentials(sid); lastActive.delete(sid); activeExec.delete(sid); }
      if (removed.length) audit('reconcile', { sessionId: uid, detail: `removed ${removed.join(',')}` });
      return send(200, { removed });
    }

    // 凭证登记/废止(R3)。本路由绝不 log 请求体 —— 真 key 只进 cred-proxy 容器 tmpfs。
    const cm = url.pathname.match(CRED_RE);
    if (cm) {
      const sid = cm[1];
      if (await ownerReject(sid, uid, send)) return;
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        return send(200, await cred.registerCredentials(sid, body, log));
      }
      if (req.method === 'DELETE') { await cred.revokeCredentials(sid); return send(200, { ok: true }); }
    }

    const fm = url.pathname.match(FILE_RE);
    if (fm) {
      const sid = fm[1];
      if (await ownerReject(sid, uid, send)) return;
      return await handleFileOp(req, res, url, sid, fm[2].toLowerCase(), uid, send);
    }

    const m = url.pathname.match(SID_RE);
    if (m) {
      const sid = m[1];
      if (req.method === 'POST') {
        try {
          const r = await orch.ensureContainer(sid, uid);
          if (!r.reused) audit('session_ensure', { sessionId: sid, detail: uid });
          return send(200, r);
        } catch (e) {
          if (/OWNER_MISMATCH/.test(String(e?.message))) return send(404, { error: 'not found' });
          throw e;
        }
      }
      if (req.method === 'DELETE') {
        if (await ownerReject(sid, uid, send)) return;
        await orch.removeContainer(sid, { keepVolume: false });
        await cred.revokeCredentials(sid);
        lastActive.delete(sid); activeExec.delete(sid);
        audit('session_remove', { sessionId: sid, detail: uid });
        return send(200, { ok: true });
      }
    }
    send(404, { error: 'not found' });
  } catch (e) { log('req error', e.message); send(500, { error: String(e.message || e) }); }
});

/** 归属校验:会话属于别的 uid → 回 404 并返回 true(调用方 return)。absent/属本人 → false。 */
async function ownerReject(sid, uid, send) {
  try { await orch.assertOwner(sid, uid); return false; }
  catch (e) {
    if (/OWNER_MISMATCH/.test(String(e?.message))) { send(404, { error: 'not found' }); return true; }
    throw e;
  }
}

/** 文件通道四 op(R2)。错误信息含 "No such file"/"escapes" 供状态码归类。 */
async function handleFileOp(req, res, url, sid, op, uid, send) {
  const asStatus = (e) => {
    const msg = String(e?.message || e);
    if (/escapes|invalid path/.test(msg)) return [403, msg];
    if (/No such file/.test(msg)) return [404, msg];
    return [500, msg];
  };
  try {
    if (op === 'file' && req.method === 'POST') {
      const name = url.searchParams.get('name') || '';
      if (!name) return send(400, { error: 'name query param required' });
      const expected = req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) : -1;
      const dest = await files.writeFile(sid, name, req, expected, uid);
      log(`file upload session=${sid} ${dest} (${expected}B)`);
      audit('file_upload', { sessionId: sid, detail: `${dest} (${expected}B)` });
      return send(200, { ok: true, path: dest });
    }
    if (op === 'files' && req.method === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      return send(200, { ok: true, files: await files.listFiles(sid, since) });
    }
    if (op === 'file' && req.method === 'GET') {
      const vmPath = url.searchParams.get('path') || '';
      const { size, stream } = await files.readFile(sid, vmPath);
      log(`file download session=${sid} ${vmPath} (${size}B)`);
      audit('file_download', { sessionId: sid, detail: `${vmPath} (${size}B)` });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size });
      stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
      res.on('error', () => { /* 客户端断开 */ });
      stream.pipe(res);
      // 客户端断开 → 掐 helper 输出流(helper 收 EPIPE 自退,--rm 清容器)
      res.on('close', () => { try { stream.destroy(); } catch { /* ignore */ } });
      return;
    }
    if (op === 'archive' && req.method === 'GET') {
      const { size, stream, cleanup } = await files.archive(sid);
      log(`archive download session=${sid} (${size}B)`);
      audit('archive_download', { sessionId: sid, detail: `${size}B` });
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': size });
      stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
      res.on('error', () => { /* 客户端断开 */ });
      stream.pipe(res);
      res.on('close', cleanup);
      return;
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    const [code, msg] = asStatus(e);
    log(`file op ${op} session=${sid} → ${code}: ${msg.slice(0, 200)}`);
    return send(code, { error: msg.slice(0, 200) });
  }
}

// WS /session/:id/exec
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(EXEC_RE);
  if (!m) { socket.destroy(); return; }
  const auth = authOf(req);
  if (!auth) { socket.destroy(); return; }
  const sid = m[1];
  try {
    // ensureContainer 内含归属校验(OWNER_MISMATCH → 拒绝升级,不暴露他人会话)
    const { name, reused } = await orch.ensureContainer(sid, auth.uid);
    log(`exec upgrade session=${sid} → ${name} (${reused ? 'reused' : 'new'})`);
    audit('exec_start', { sessionId: sid, detail: auth.uid });
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      execOpened(sid);
      ws.on('close', () => execClosed(sid));
      handleExec(ws, sid, name, { shimPath: SHIM, log });
    });
  } catch (e) { log('upgrade error', e.message); try { socket.destroy(); } catch { /* ignore */ } }
});

// keepalive:25s 双向 ping/pong(防企业中间设备掐长连接)
const pinger = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 25000);
pinger.unref?.();

// R4 空闲回收:每分钟扫 running 会话容器,超 TTL 且无活跃 exec → stop(保留 volume,
// 下次 ensure 时 docker start 复用)。server 重启后无 lastActive 记录的容器给一个 TTL 宽限。
const reaper = setInterval(async () => {
  try {
    for (const sid of await orch.listRunning()) {
      if (activeExec.get(sid)) { markActive(sid); continue; } // 有连接,续命
      const la = lastActive.get(sid);
      if (la === undefined) { markActive(sid); continue; }     // 重启宽限
      if (Date.now() - la > IDLE_TTL_MS) {
        if (await orch.stopContainer(sid)) { audit('idle_reap', { sessionId: sid }); lastActive.delete(sid); }
      }
    }
  } catch (e) { log('reaper error', e.message); }
}, 60000);
reaper.unref?.();

server.listen(PORT, HOST, () => log(`listening ${HOST}:${PORT} authz=${authzEnabled ? 'HMAC' : (TOKEN ? 'global-token' : 'OFF(dev)')} image=${orch._internals.IMAGE} assets=${orch._internals.ASSETS_DIR} idleTTL=${IDLE_TTL_MS}ms`));

// cred-proxy sidecar 容器随服务启动(失败不阻塞主服务:首个 register 会懒重试)
cred.ensureProxy(log).catch((e) => log('cred-proxy start deferred:', e.message));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { clearInterval(pinger); clearInterval(reaper); server.close(); process.exit(0); });
