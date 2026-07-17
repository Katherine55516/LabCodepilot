/**
 * 容器 per 会话编排 —— docker labels 作事实源(控制面无状态,重启从 labels 重建;
 * 呼应应用侧 cowork-vm-manager 的 globalThis 单例哲学)。
 *
 * 每个办公会话一个硬化容器 cowork-<sid>:
 *   --cap-drop ALL --security-opt no-new-privileges --memory/--pids-limit
 *   claude + shim 从宿主 bind-mount(:ro);workspace 用会话专属 named volume
 *   (与容器生命周期解耦:容器可回收,volume 留到会话删)。
 * R1 用现成 python:3-slim + bind claude/shim;R5 换烘进二进制的自建镜像。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const IMAGE = process.env.COWORK_IMAGE || 'python:3-slim';
const ASSETS_DIR = process.env.COWORK_ASSETS_DIR || '/opt/cowork-assets'; // 宿主放 claude + cowork-shim.py
const MEM = process.env.COWORK_MEM || '2g';
const PIDS = process.env.COWORK_PIDS || '512';
const LABEL_MANAGED = 'cowork.managed=1';
const AGENT_UID = process.env.COWORK_AGENT_UID || '1000'; // 容器内非 root 跑 claude(--dangerously-skip-permissions 禁 root)
// 会话容器接入的专用网络:与 cred-proxy sidecar 同网,claude 经容器名访问代理(RD6)。
// cred-proxy.mjs 负责建网 + 起 proxy;这里只把会话容器接进去。
const NET = process.env.COWORK_NET || 'cowork-net';

const HEX = /^[a-f0-9]{1,64}$/i;
function name(sid) {
  if (!HEX.test(sid)) throw new Error('invalid sessionId');
  return `cowork-${sid}`;
}
export function volumeName(sid) {
  if (!HEX.test(sid)) throw new Error('invalid sessionId');
  return `cowork-ws-${sid}`;
}

async function docker(args) {
  const { stdout } = await execFileP('docker', args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/** 确保专用网络存在(幂等)。cred-proxy.mjs 也会建;两处都 ensure 防启动顺序耦合。 */
async function ensureNetwork() {
  const nets = await docker(['network', 'ls', '--filter', `name=^${NET}$`, '--format', '{{.Name}}']);
  if (!nets.trim()) {
    try { await docker(['network', 'create', '--label', LABEL_MANAGED, NET]); }
    catch (e) { if (!/already exists/i.test(String(e?.message || ''))) throw e; }
  }
}

export async function volumeExists(sid) {
  const out = await docker(['volume', 'ls', '-q', '--filter', `name=^${volumeName(sid)}$`]);
  return out.trim().length > 0;
}

/**
 * 确保会话 workspace volume 存在(幂等)。fresh named volume 属 root:root,而 claude 以
 * 非 root(AGENT_UID)跑,故创建后用一次性 helper 容器 chown —— 只在首次创建时付这一次成本。
 * volume 与容器同 label,是"会话存在"的另一半事实源(容器可回收,volume 留到会话删)。
 */
export async function ensureVolume(sid) {
  const vol = volumeName(sid);
  if (await volumeExists(sid)) return vol;
  await docker(['volume', 'create', '--label', LABEL_MANAGED, '--label', `cowork.sid=${sid}`, vol]);
  try {
    await docker([
      'run', '--rm', '--network', 'none',
      // cap-drop ALL 会连 root 的 CAP_CHOWN 一起剥掉(自测踩过)—— 这个一次性
      // init 容器只保留 CHOWN 这一个能力。
      '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--security-opt', 'no-new-privileges',
      '-v', `${vol}:/ws`, IMAGE, 'chown', `${AGENT_UID}:${AGENT_UID}`, '/ws',
    ]);
  } catch (e) {
    // 半初始化(已创建未 chown)的 volume 会被 volumeExists 幂等跳过而永远不可写:
    // 失败就地回收,让下次调用干净重试。
    try { await docker(['volume', 'rm', vol]); } catch { /* ignore */ }
    throw e;
  }
  return vol;
}

/** 确保会话容器存在且运行;不存在则起硬化容器。幂等。返回 { name, reused }。 */
export async function ensureContainer(sid) {
  const cname = name(sid);
  const ps = (await docker(['ps', '-a', '--filter', `name=^${cname}$`, '--format', '{{.State}}'])).trim();
  if (ps) {
    if (ps !== 'running') await docker(['start', cname]);
    return { name: cname, reused: true };
  }
  await ensureVolume(sid);
  await ensureNetwork();
  await docker([
    'run', '-d', '--name', cname,
    '--label', LABEL_MANAGED, '--label', `cowork.sid=${sid}`,
    // 专用网络:claude 经容器名访问 cred-proxy sidecar(RD6);R4 出网禁内网也针对本网络。
    '--network', NET,
    // 非 root 跑:claude 的 --dangerously-skip-permissions(办公 full_access)禁止 root。
    '--user', `${AGENT_UID}:${AGENT_UID}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', MEM, '--pids-limit', PIDS,
    // HOME 放 tmpfs(不在 workspace 内):claude 的状态文件(~/.claude* 等)不落持久
    // volume,否则回合末产物 diff 会把它们当用户产物;容器存活期内跨回合仍持久。
    '-e', 'HOME=/home/agent',
    '--tmpfs', `/home/agent:uid=${AGENT_UID},gid=${AGENT_UID},mode=0700`,
    '-v', `${ASSETS_DIR}:/opt/cowork:ro`,
    // R2:workspace 用会话专属 named volume(与容器生命周期解耦,文件 op 服务端直读)。
    '-v', `${volumeName(sid)}:/workspace`,
    IMAGE, 'sleep', 'infinity',
  ]);
  return { name: cname, reused: false };
}

/** 移除会话容器;默认保留 volume(会话删除时才 keepVolume:false 连 volume 一起清)。 */
export async function removeContainer(sid, { keepVolume = true } = {}) {
  const cname = name(sid);
  try { await docker(['rm', '-f', cname]); } catch { /* 不存在即已达成 */ }
  if (!keepVolume) {
    // 在飞的文件 helper(--rm)可能瞬时还挂着 volume(下载刚结束/刚被取消)→
    // "volume is in use":短退避重试;仍占用则静默留给 reconcile 兜底。
    for (let i = 0; i < 4; i++) {
      try { await docker(['volume', 'rm', volumeName(sid)]); return; }
      catch (e) {
        if (/no such volume/i.test(String(e?.message || ''))) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}

/**
 * 从 labels 列出所有受管会话 id(事实源)= 容器 ∪ volume。
 * volume 也要扫:容器被回收(或从未起过,只推过文件)时 volume 仍代表会话存在,
 * 否则 reconcile 永远看不到孤儿 volume。
 */
export async function listSessions() {
  const [c, v] = await Promise.all([
    docker(['ps', '-a', '--filter', `label=${LABEL_MANAGED}`, '--format', '{{.Label "cowork.sid"}}']),
    docker(['volume', 'ls', '--filter', `label=${LABEL_MANAGED}`, '--format', '{{.Label "cowork.sid"}}']),
  ]);
  return [...new Set(`${c}\n${v}`.split('\n').map((s) => s.trim()).filter(Boolean))];
}

/** 对账:删除不在 keep 里的孤儿会话(容器 + volume)。对齐 daemon reconcileSessions 语义。 */
export async function reconcile(keepSids) {
  const keep = new Set(keepSids);
  const removed = [];
  for (const sid of await listSessions()) {
    if (!keep.has(sid)) { await removeContainer(sid, { keepVolume: false }); removed.push(sid); }
  }
  return removed;
}

/** 健康:docker 可用性 + 受管会话数。 */
export async function health() {
  const ver = (await docker(['version', '--format', '{{.Server.Version}}'])).trim();
  return { ok: true, dockerVersion: ver, sessions: (await listSessions()).length };
}

export { AGENT_UID, IMAGE };
export const _internals = { name, volumeName, IMAGE, ASSETS_DIR };
