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
// 运行期 pip 源覆盖(可选):设了就注入 PIP_INDEX_URL(pip 的 env 优先级高于镜像内
// /etc/pip.conf)。阿里云部署配内网源 mirrors.cloud.aliyuncs.com → agent 装长尾包
// 走内网零公网带宽;不设 = 镜像默认(公网阿里镜像)。见 OPERATIONS.md §9。
const PIP_INDEX_URL = (process.env.COWORK_PIP_INDEX_URL || '').trim();
// ⚠️ http 索引 pip 会直接拒绝("not a trusted or secure host"),必须同时给
// PIP_TRUSTED_HOST。阿里云内网源**只能走 http**:它的 https 证书签给
// mirrors-ssl.aliyuncs.com / mirrors.aliyun.com,用 mirrors.cloud.aliyuncs.com
// 访问必然 hostname mismatch(2026-07-28 生产实测,构建期与运行期同病)。
// 只对 http 放宽,https 索引照常验证证书。
const PIP_TRUSTED_HOST = (() => {
  if (!PIP_INDEX_URL.startsWith('http://')) return '';
  try { return new URL(PIP_INDEX_URL).hostname; } catch { return ''; }
})();
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

// —— cowork.kind:区分「用户的办公会话」与「定时任务的常驻工作区」——
//
// ⚠️ 这个 label 存在的唯一理由:**reconcile 不能删定时任务的工作区**。
// reconcile 收的是客户端传来的 keep 列表(客户端本地有哪些会话),而客户端**根本
// 不知道 routine 的 sid** —— 定时任务是服务端实体。不打这个标、不在 listSessions
// 里排掉的话,用户每打开一次 app 就会把自己所有定时任务的累积文件清空一次。
// 加它的成本是一行 label,不加的代价是数据丢失且用户无从察觉。
const KIND_SESSION = 'session';
const KIND_ROUTINE = 'routine';
const KIND_RE = /^[a-z]{1,16}$/;
function assertKind(kind) {
  if (!KIND_RE.test(kind)) throw new Error('invalid kind');
  return kind;
}

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
export async function ensureVolume(sid, uid = SINGLE_UID, kind = KIND_SESSION) {
  assertUid(uid);
  const vol = volumeName(sid);
  if (await volumeExists(sid)) return vol;
  await docker(['volume', 'create', '--label', LABEL_MANAGED, '--label', `cowork.sid=${sid}`, '--label', `cowork.uid=${uid}`, '--label', `cowork.kind=${assertKind(kind)}`, vol]);
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
export async function ensureContainer(sid, uid = SINGLE_UID, kind = KIND_SESSION) {
  assertUid(uid);
  assertKind(kind);
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
  await ensureVolume(sid, uid, kind);
  await ensureNetwork();
  await docker([
    'run', '-d', '--name', cname,
    '--label', LABEL_MANAGED, '--label', `cowork.sid=${sid}`, '--label', `cowork.uid=${uid}`,
    '--label', `cowork.kind=${kind}`,
    // 专用网络:claude 经容器名访问 cred-proxy sidecar(RD6);R4 出网禁内网也针对本网络。
    '--network', NET,
    // 非 root 跑:claude 的 --dangerously-skip-permissions(办公 full_access)禁止 root。
    '--user', `${AGENT_UID}:${AGENT_UID}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', MEM, '--pids-limit', PIDS, '--cpus', CPUS,
    // HOME 放 tmpfs(不在 workspace 内):claude 的状态文件(~/.claude* 等)不落持久
    // volume,否则回合末产物 diff 会把它们当用户产物;容器存活期内跨回合仍持久。
    '-e', 'HOME=/home/agent',
    ...(PIP_INDEX_URL ? ['-e', `PIP_INDEX_URL=${PIP_INDEX_URL}`] : []),
    ...(PIP_TRUSTED_HOST ? ['-e', `PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}`] : []),
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
export async function listSessions(uid, { excludeKind } = {}) {
  const filters = uid !== undefined
    ? ['--filter', `label=cowork.uid=${assertUid(uid)}`]
    : ['--filter', `label=${LABEL_MANAGED}`];
  const [c, v] = await Promise.all([
    docker(['ps', '-a', ...filters, '--format', '{{.Label "cowork.sid"}}']),
    docker(['volume', 'ls', ...filters, '--format', '{{.Label "cowork.sid"}}']),
  ]);
  const all = new Set(`${c}\n${v}`.split('\n').map((s) => s.trim()).filter(Boolean));
  if (!excludeKind) return [...all];
  // docker 没有「label 不等于」过滤器,只能正查一次要排除的那类再做差集。
  // R1-R3 时代建的资源没有 cowork.kind 标签 —— 它们不会出现在这个正查结果里,
  // 于是天然被当成 session 参与 reconcile,与改动前行为一致(不误伤、不误留)。
  const ex = new Set(await listSessionsOfKind(excludeKind, uid));
  return [...all].filter((s) => !ex.has(s));
}

/** 列出指定 kind 的 sid(容器 ∪ volume)。uid 省略 = 全部用户。 */
export async function listSessionsOfKind(kind, uid) {
  const filters = ['--filter', `label=cowork.kind=${assertKind(kind)}`];
  if (uid !== undefined) filters.push('--filter', `label=cowork.uid=${assertUid(uid)}`);
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
  // ⚠️ excludeKind:'routine' 是本函数最重要的一个参数。keep 列表来自客户端,而客户端
  // 不知道 routine 的 sid(那是服务端实体)—— 不排掉的话每次 reconcile 都会把用户
  // 所有定时任务的累积工作区当孤儿删光。
  for (const sid of await listSessions(uid, { excludeKind: KIND_ROUTINE })) {
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

export { AGENT_UID, IMAGE, SINGLE_UID, KIND_SESSION, KIND_ROUTINE };
export const _internals = { name, volumeName, IMAGE, ASSETS_DIR };
