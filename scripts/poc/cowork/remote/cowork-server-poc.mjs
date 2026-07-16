#!/usr/bin/env node
/**
 * Cowork 远程容器 POC — 服务端桥(TCP ↔ docker exec)。
 *
 * 在远程 Linux 服务器(R0 阶段:UTM 里的 Linux 虚机)上跑。监听 TCP,每个连接:
 *   1. 读第一行 JSON header(sessionId / argv / env / token),'\n' 结尾。
 *   2. 起容器内 shim:docker exec -i [-e K=V...] <container> python3 <shim> -- <argv...>
 *      (POC 阶段容器由你手工 docker run 起好、长期存在;容器生命周期编排是 R1 的事。)
 *   3. 把 header 之后的字节流 pipe 给 docker exec 的 stdin(帧流,给容器内 shim 解),
 *      docker exec 的 stdout pipe 回 TCP 连接(claude 裸 stream-json)。
 *
 * server 是哑字节管道,不解帧 —— 帧是给容器内 shim 解的。中断处理也不区分优雅/abort
 * (那由 shim 靠"有没有收到零帧"判断):连接一断,就关 docker exec 的 stdin(触发容器内
 * shim 的 stdin EOF → shim 走自保杀 claude),加超时兜底 kill。
 *
 * 本地验协议模式(COWORK_POC_LOCAL=1):不走 docker,直接 spawn 本机 shim,让 shim 起
 * 一个"模拟 claude"。用于在 mac 上钉死帧/EOF/流式/并发/中断,把不确定性隔离到 docker
 * exec 那一格。等 UTM 好了去掉这个环境变量即走真 docker。
 *
 * env:
 *   COWORK_REMOTE_PORT   — 监听端口(默认 8790)
 *   COWORK_POC_CONTAINER — 目标容器名(默认 cowork-poc)
 *   COWORK_SHIM_PATH     — 容器内 shim 路径(默认 /opt/cowork/cowork-shim.py)
 *   COWORK_ABORT_GRACE_MS— 连接断后等 shim 自行收尾的兜底 kill 超时(默认 4000)
 *   COWORK_POC_LOCAL=1    — 本地验协议(不走 docker)
 *   COWORK_LOCAL_SHIM     — 本地模式:本机 shim 路径
 */
import net from 'node:net';
import { spawn } from 'node:child_process';

const port = parseInt(process.env.COWORK_REMOTE_PORT || '8790', 10);
const container = process.env.COWORK_POC_CONTAINER || 'cowork-poc';
const shimPath = process.env.COWORK_SHIM_PATH || '/opt/cowork/cowork-shim.py';
const abortGraceMs = parseInt(process.env.COWORK_ABORT_GRACE_MS || '4000', 10);
const local = process.env.COWORK_POC_LOCAL === '1';

function log(...a) { process.stderr.write('[cowork-server] ' + a.join(' ') + '\n'); }

const server = net.createServer((conn) => {
  let headerDone = false;
  let headBuf = Buffer.alloc(0);
  let child = null;
  let sid = '?';

  function startChild(header) {
    sid = header.sessionId || '?';
    const argv = Array.isArray(header.argv) ? header.argv : [];
    const env = header.env && typeof header.env === 'object' ? header.env : {};

    let cmd, args, childEnv;
    if (local) {
      // 本机验协议:直接 spawn shim,shim 再 spawn COWORK_CLAUDE_BIN(模拟 claude)
      cmd = 'python3';
      args = [process.env.COWORK_LOCAL_SHIM, '--', ...argv];
      childEnv = { ...process.env, ...env };
    } else {
      // docker exec 进手工起的容器;env 白名单经 -e 传入(POC:真 key 直接过,R3 换 token)
      const eArgs = [];
      for (const [k, v] of Object.entries(env)) eArgs.push('-e', `${k}=${v}`);
      cmd = 'docker';
      args = ['exec', '-i', ...eArgs, container, 'python3', shimPath, '--', ...argv];
      childEnv = process.env;
    }

    log(`session=${sid} spawn ${cmd} ${local ? '(local)' : 'exec ' + container}`);
    child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env: childEnv });
    child.stdin.on('error', () => { /* EPIPE when claude/shim exits first */ });
    child.stdout.on('error', () => {});

    // header 之后已到达的字节 = 帧流起点
    if (headBuf.length) { try { child.stdin.write(headBuf); } catch { /* ignore */ } headBuf = Buffer.alloc(0); }
    conn.pipe(child.stdin);
    child.stdout.pipe(conn);

    child.on('exit', (code) => { log(`session=${sid} child exit ${code}`); try { conn.end(); } catch { /* ignore */ } });
    child.on('error', (e) => { log(`session=${sid} child error ${e.message}`); try { conn.destroy(); } catch { /* ignore */ } });
  }

  function onData(d) {
    if (headerDone) return; // 之后 conn.pipe(child.stdin) 接管字节流
    headBuf = Buffer.concat([headBuf, d]);
    const nl = headBuf.indexOf(0x0a);
    if (nl < 0) return;
    const line = headBuf.slice(0, nl).toString('utf8');
    headBuf = headBuf.slice(nl + 1);
    headerDone = true;
    let header;
    try { header = JSON.parse(line); } catch { log('bad header, dropping'); try { conn.destroy(); } catch { /* ignore */ } return; }
    startChild(header);
  }

  function onClose() {
    // 连接断 → 关 docker exec stdin(触发容器内 shim 的 stdin EOF → shim 自保杀 claude)。
    // 不直接 kill child:真实 docker 场景 kill 的是 exec CLI、容器内 shim 靠 stdin EOF 感知,
    // 本地模式关 shim stdin 同构。加兜底:超时 shim/claude 仍在就 kill exec CLI。
    if (!child) return;
    try { conn.unpipe(child.stdin); } catch { /* ignore */ }
    try { child.stdin.end(); } catch { /* ignore */ }
    const t = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* ignore */ } }, abortGraceMs);
    child.on('exit', () => clearTimeout(t));
  }

  conn.on('data', onData);
  conn.on('close', onClose);
  conn.on('error', () => { /* onClose 会跟着触发 */ });
});

server.listen(port, () => log(`listening on :${port} mode=${local ? 'LOCAL' : 'docker:' + container}`));
