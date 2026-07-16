#!/usr/bin/env node
/**
 * Cowork 远程容器沙箱服务端控制面(R1)。
 *
 * 单公司裸金属服务器上常驻。一个 HTTP server 承载:
 *   REST(短 op,Bearer 鉴权):
 *     GET  /health                     → docker 可用性 + 受管会话数
 *     POST /session/:id                → 确保会话容器就绪(幂等)
 *     DELETE /session/:id              → 移除会话容器(保留 volume)
 *     POST /reconcile  {keep:[...]}    → 删除不在 keep 的孤儿会话(容器+volume)
 *   WS:
 *     /session/:id/exec                → 帧桥到 docker exec(升级前先 ensureContainer)
 *
 * R1 鉴权:COWORK_SERVER_TOKEN 为空则关闭(dev);R3/R5 强制。TLS 在 R5 由反代/证书接入
 * (ws→wss 只加 TLS 层,协议不变)。文件 op(上传/下载/产物)在 R2 补;凭证代理在 R3 补。
 *
 * env:
 *   COWORK_SERVER_PORT(默认 8790)/ COWORK_SERVER_TOKEN(Bearer,空=dev 关闭)
 *   COWORK_SHIM_PATH(容器内 shim,默认 /opt/cowork/cowork-shim.py)
 *   COWORK_ASSETS_DIR / COWORK_IMAGE / COWORK_MEM / COWORK_PIDS(见 orchestrator)
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import * as orch from './lib/orchestrator.mjs';
import { handleExec } from './lib/exec-bridge.mjs';

const PORT = parseInt(process.env.COWORK_SERVER_PORT || '8790', 10);
const TOKEN = process.env.COWORK_SERVER_TOKEN || '';
const SHIM = process.env.COWORK_SHIM_PATH || '/opt/cowork/cowork-shim.py';
const SID_RE = /^\/session\/([a-f0-9]{1,64})$/i;
const EXEC_RE = /^\/session\/([a-f0-9]{1,64})\/exec$/i;

function log(...a) { process.stderr.write('[cowork-server] ' + a.join(' ') + '\n'); }
function bearerOk(req) { return !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`; }
async function readBody(req) { let b = ''; for await (const c of req) b += c; return b; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (!bearerOk(req)) return send(401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/health') return send(200, await orch.health());

    if (req.method === 'POST' && url.pathname === '/reconcile') {
      const keep = (JSON.parse((await readBody(req)) || '{}').keep) || [];
      return send(200, { removed: await orch.reconcile(keep) });
    }

    const m = url.pathname.match(SID_RE);
    if (m) {
      const sid = m[1];
      if (req.method === 'POST') return send(200, await orch.ensureContainer(sid));
      if (req.method === 'DELETE') { await orch.removeContainer(sid, { keepVolume: true }); return send(200, { ok: true }); }
    }
    send(404, { error: 'not found' });
  } catch (e) { log('req error', e.message); send(500, { error: String(e.message || e) }); }
});

// WS /session/:id/exec
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(EXEC_RE);
  if (!m) { socket.destroy(); return; }
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) { socket.destroy(); return; }
  const sid = m[1];
  try {
    const { name, reused } = await orch.ensureContainer(sid);
    log(`exec upgrade session=${sid} → ${name} (${reused ? 'reused' : 'new'})`);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
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

server.listen(PORT, () => log(`listening :${PORT} token=${TOKEN ? 'required' : 'OFF(dev)'} image=${orch._internals.IMAGE} assets=${orch._internals.ASSETS_DIR}`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { clearInterval(pinger); server.close(); process.exit(0); });
