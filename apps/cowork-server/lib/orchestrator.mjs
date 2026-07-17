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
// 自建镜像模式(image/build-image.sh 产出的 cowork-sandbox):claude+shim 已烘进镜像
// /opt/cowork,不再 bind 宿主 assets(cred-proxy.mjs 同开关跳过脚本挂载)。
const BUNDLED = process.env.COWORK_IMAGE_BUNDLED === '1';
const MEM = process.env.COWORK_MEM || '2g';
const PIDS = process.env.COWORK_PIDS || '512';
const CPUS = process.env.COWORK_CPUS || '2'; // R4 配额:每会话容器 CPU 上限
const LABEL_MANAGED = 'cowork.managed=1';
const AGENT_UID = process.env.COWORK_AGENT_UID || '1000'; // 容器内非 root 跑 claude(--dangerously-skip-permissions 禁 root)
// 会话容器接入的专用网络:与 cred-proxy sidecar 同网,claude 经容器名访问代理(RD6)。
// cred-proxy.mjs 负责建网 + 起 proxy;这里只把会话容器接进去。
const NET = process.env.COWORK_NET || 'cowork-net';
// authz 关闭时的占位 owner(与 authz.mjs singleUid 一致):session 不做跨用户 scope。
const SINGLE_UID = '__single__';

const HEX = /^[a-f0-9]{1,64}$/i;
// uid 与 authz.signToken 的 uid 字符集一致(label 值安全:无空格/引号)。
const UID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
function assertUid(uid) {
  if (!UID_RE.test(uid)) throw new Error('invalid uid');
  return uid;
}
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

// 固定网桥接口名:出网 iptables 规则(setup-egress.sh)按此接口匹配 cowork 会话流量。
const NET_BRIDGE = process.env.COWORK_NET_BRIDGE || 'cowork0';

/** 确保专用网络存在(幂等)。cred-proxy.mjs 也会建;两处都 ensure 防启动顺序耦合。 */
async function ensureNetwork() {
  const nets = await docker(['network', 'ls', '--filter', `name=^${NET}$`, '--format', '{{.Name}}']);
  if (!nets.trim()) {
    try { await docker(['network', 'create', '--label', LABEL_MANAGED, '--opt', `com.docker.network.bridge.name=${NET_BRIDGE}`, NET]); }
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
export async function ensureVolume(sid, uid = SINGLE_UID) {
  assertUid(uid);
  const vol = volumeName(sid);
  if (await volumeExists(sid)) return vol;
  await docker(['volume', 'create', '--label', LABEL_MANAGED, '--label', `cowork.sid=${sid}`, '--label', `cowork.uid=${uid}`, vol]);
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

/**
 * 会话的属主 uid(R4 多用户 scope 事实源)= 容器 label 优先,回退 volume label。
 * 返回 null = 会话不存在;返回 '' = 存在但无 uid 标签(R1-R3 旧会话,视为单用户)。
 */
export async function sessionOwner(sid) {
  const c = (await docker(['ps', '-a', '--filter', `name=^${name(sid)}$`, '--format', '{{.Label "cowork.uid"}}'])).trim();
  if (c) return c;
  const cExists = (await docker(['ps', '-a', '--filter', `name=^${name(sid)}$`, '--format', '{{.ID}}'])).trim();
  const v = (await docker(['volume', 'ls', '--filter', `name=^${volumeName(sid)}$`, '--format', '{{.Label "cowork.uid"}}'])).trim();
  if (v) return v;
  const vExists = await volumeExists(sid);
  return cExists || vExists ? '' : null;
}

/**
 * 断言会话归属:owner 与 uid 不符 → throw OWNER_MISMATCH(index.mjs 转 404 防枚举)。
 * 返回 'absent'(会话不存在,调用方可创建)或 'ok'。authz 关闭(uid=__single__)时,
 * 旧会话 owner='' 视为同属单用户,放行。
 */
export async function assertOwner(sid, uid) {
  const owner = await sessionOwner(sid);
  if (owner === null) return 'absent';
  if (owner === '' && uid === SINGLE_UID) return 'ok';
  if (owner !== uid) throw new Error('OWNER_MISMATCH');
  return 'ok';
}

/** 确保会话容器存在且运行;不存在则起硬化容器。幂等。返回 { name, reused }。 */
export async function ensureContainer(sid, uid = SINGLE_UID) {
  assertUid(uid);
  const cname = name(sid);
  // 复用/重建前先校验归属:借他人 sid 的请求在这里被挡(容器已回收只剩 volume 也算数)。
  const guard = await assertOwner(sid, uid);
  const ps = (await docker(['ps', '-a', '--filter', `name=^${cname}$`, '--format', '{{.State}}'])).trim();
  if (ps) {
    if (ps !== 'running') await docker(['start', cname]);
    return { name: cname, reused: true };
  }
  // guard 为 'absent'(全新)或 'ok'(volume 属本人、容器被 TTL 回收待重建)
  void guard;
  await ensureVolume(sid, uid);
  await ensureNetwork();
  await docker([
    'run', '-d', '--name', cname,
    '--label', LABEL_MANAGED, '--label', `cowork.sid=${sid}`, '--label', `cowork.uid=${uid}`,
    // 专用网络:claude 经容器名访问 cred-proxy sidecar(RD6);R4 出网禁内网也针对本网络。
    '--network', NET,
    // 非 root 跑:claude 的 --dangerously-skip-permissions(办公 full_access)禁止 root。
    '--user', `${AGENT_UID}:${AGENT_UID}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', MEM, '--pids-limit', PIDS, '--cpus', CPUS,
    // HOME 放 tmpfs(不在 workspace 内):claude 的状态文件(~/.claude* 等)不落持久
    // volume,否则回合末产物 diff 会把它们当用户产物;容器存活期内跨回合仍持久。
    '-e', 'HOME=/home/agent',
    '--tmpfs', `/home/agent:uid=${AGENT_UID},gid=${AGENT_UID},mode=0700`,
    ...(BUNDLED ? [] : ['-v', `${ASSETS_DIR}:/opt/cowork:ro`]),
    // R2:workspace 用会话专属 named volume(与容器生命周期解耦,文件 op 服务端直读)。
    '-v', `${volumeName(sid)}:/workspace`,
    IMAGE, 'sleep', 'infinity',
  ]);
  return { name: cname, reused: false };
}

/** 停止会话容器但保留 volume(R4 TTL 空闲回收:省资源,下次 ensure 时 docker start 复用)。 */
export async function stopContainer(sid) {
  try { await docker(['stop', name(sid)]); return true; } catch { return false; }
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
 * 从 labels 列出受管会话 id(事实源)= 容器 ∪ volume。
 * uid 省略 = 全部(health/内部用);传 uid = 只该用户的(R4 多用户 scope)。
 * volume 也要扫:容器被回收(或从未起过,只推过文件)时 volume 仍代表会话存在,
 * 否则 reconcile 永远看不到孤儿 volume。
 */
export async function listSessions(uid) {
  const filters = uid !== undefined
    ? ['--filter', `label=cowork.uid=${assertUid(uid)}`]
    : ['--filter', `label=${LABEL_MANAGED}`];
  const [c, v] = await Promise.all([
    docker(['ps', '-a', ...filters, '--format', '{{.Label "cowork.sid"}}']),
    docker(['volume', 'ls', ...filters, '--format', '{{.Label "cowork.sid"}}']),
  ]);
  return [...new Set(`${c}\n${v}`.split('\n').map((s) => s.trim()).filter(Boolean))];
}

/**
 * 对账:删除不在 keep 里的孤儿会话(容器 + volume)。对齐 daemon reconcileSessions 语义。
 * uid 传入时 scope 到该用户(只清该用户的孤儿,绝不动别人的会话)。
 */
export async function reconcile(keepSids, uid) {
  const keep = new Set(keepSids);
  const removed = [];
  for (const sid of await listSessions(uid)) {
    if (!keep.has(sid)) { await removeContainer(sid, { keepVolume: false }); removed.push(sid); }
  }
  return removed;
}

/** 列出当前 running 的受管会话容器 sid(R4 空闲回收扫描用)。 */
export async function listRunning() {
  const out = await docker(['ps', '--filter', `label=${LABEL_MANAGED}`, '--filter', 'status=running', '--format', '{{.Label "cowork.sid"}}']);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** 健康:docker 可用性 + 受管会话数。 */
export async function health() {
  const ver = (await docker(['version', '--format', '{{.Server.Version}}'])).trim();
  return { ok: true, dockerVersion: ver, sessions: (await listSessions()).length };
}

export { AGENT_UID, IMAGE, SINGLE_UID };
export const _internals = { name, volumeName, IMAGE, ASSETS_DIR };
