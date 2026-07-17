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

const HEX = /^[a-f0-9]{1,64}$/i;
function name(sid) {
  if (!HEX.test(sid)) throw new Error('invalid sessionId');
  return `cowork-${sid}`;
}
function volume(sid) { return `cowork-ws-${sid}`; }

async function docker(args) {
  const { stdout } = await execFileP('docker', args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/** 确保会话容器存在且运行;不存在则起硬化容器。幂等。返回 { name, reused }。 */
export async function ensureContainer(sid) {
  const cname = name(sid);
  const ps = (await docker(['ps', '-a', '--filter', `name=^${cname}$`, '--format', '{{.State}}'])).trim();
  if (ps) {
    if (ps !== 'running') await docker(['start', cname]);
    return { name: cname, reused: true };
  }
  await docker([
    'run', '-d', '--name', cname,
    '--label', LABEL_MANAGED, '--label', `cowork.sid=${sid}`,
    // 非 root 跑:claude 的 --dangerously-skip-permissions(办公 full_access)禁止 root。
    '--user', `${AGENT_UID}:${AGENT_UID}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', MEM, '--pids-limit', PIDS,
    '-e', 'HOME=/workspace',
    '-v', `${ASSETS_DIR}:/opt/cowork:ro`,
    // R1:workspace 用 tmpfs(agent uid 可写);R2 换持久 named volume + uid 权限处理。
    '--tmpfs', `/workspace:uid=${AGENT_UID},gid=${AGENT_UID},mode=0700`,
    IMAGE, 'sleep', 'infinity',
  ]);
  return { name: cname, reused: false };
}

/** 移除会话容器;默认保留 volume(会话删除时才 keepVolume:false 连 volume 一起清)。 */
export async function removeContainer(sid, { keepVolume = true } = {}) {
  const cname = name(sid);
  try { await docker(['rm', '-f', cname]); } catch { /* 不存在即已达成 */ }
  if (!keepVolume) { try { await docker(['volume', 'rm', volume(sid)]); } catch { /* ignore */ } }
}

/** 从 labels 列出所有受管会话 id(事实源)。 */
export async function listSessions() {
  const out = await docker(['ps', '-a', '--filter', `label=${LABEL_MANAGED}`, '--format', '{{.Label "cowork.sid"}}']);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
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

export const _internals = { name, volume, IMAGE, ASSETS_DIR };
