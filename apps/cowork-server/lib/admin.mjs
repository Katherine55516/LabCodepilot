/**
 * 管理面数据源(用量后台 P0,只读)—— 供账号后端 admin 拉取,普通用户不可达
 * (index.mjs 的 /admin/* 分支只认 uid === ADMIN_UID 的 token,见 D3:账号后端
 * 服务端持 HMAC secret 自签;用户 token 恒为真实 UUID,不可能碰撞)。
 *
 * - readAuditSince(offset):审计日志按字节增量读取。fileId = 首行 sha256 前 16 位,
 *   截断/清空/轮转后首行必变 → 拉取端(账号后端)检测到 fileId 变化即归零重拉,
 *   PG 侧 UNIQUE 约束兜底去重(见 exec-plan cowork-usage-admin D6)。
 * - collectStats():docker 现查现返(活跃容器资源 + 全部会话卷 + 大小)。
 *   卷大小 du 现算,60s 缓存 —— 现在 19 个卷毫秒级,几百个卷时也只有首查慢。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _internals as auditInternals } from './audit.mjs';

const execFileP = promisify(execFile);

export const ADMIN_UID = '__admin__';

const AUDIT_FILE = auditInternals.AUDIT_FILE;
// 单次响应上限:防首拉一口气吞整个文件把响应撑爆;拉取端循环续拉即可。
const MAX_CHUNK = 1024 * 1024;

async function docker(args) {
  const { stdout } = await execFileP('docker', args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

function fileIdOf(fd, size) {
  if (size <= 0) return '';
  const buf = Buffer.alloc(Math.min(size, 4096));
  fs.readSync(fd, buf, 0, buf.length, 0);
  const nl = buf.indexOf(0x0a);
  const firstLine = nl === -1 ? buf : buf.subarray(0, nl);
  return crypto.createHash('sha256').update(firstLine).digest('hex').slice(0, 16);
}

/** 审计日志增量读取。offset 越界(文件被截断变小)→ 从 0 重读并由 fileId 提示重置。 */
export function readAuditSince(offset = 0) {
  let fd;
  try {
    fd = fs.openSync(AUDIT_FILE, 'r');
  } catch {
    return { lines: [], nextOffset: 0, fileSize: 0, fileId: '' }; // 尚无审计文件
  }
  try {
    const { size } = fs.fstatSync(fd);
    const fileId = fileIdOf(fd, size);
    let from = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    if (from > size) from = 0; // 截断信号:配合 fileId 变化,拉取端归零
    const len = Math.min(size - from, MAX_CHUNK);
    if (len <= 0) return { lines: [], nextOffset: from, fileSize: size, fileId };
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    // 只消费到最后一个完整行:半行(写入中)留给下一轮,nextOffset 停在行首
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) return { lines: [], nextOffset: from, fileSize: size, fileId };
    const chunk = buf.subarray(0, lastNl + 1).toString('utf8');
    const lines = chunk.split('\n').filter(Boolean);
    return { lines, nextOffset: from + lastNl + 1, fileSize: size, fileId };
  } finally {
    fs.closeSync(fd);
  }
}

// —— 卷大小缓存(60s):du 是唯一相对贵的操作 ——
let volSizeCache = { at: 0, sizes: new Map() };

async function volumeSizes(volNames) {
  const now = Date.now();
  if (now - volSizeCache.at < 60_000) return volSizeCache.sizes;
  const sizes = new Map();
  for (const vol of volNames) {
    try {
      const mp = (await docker(['volume', 'inspect', vol, '--format', '{{.Mountpoint}}'])).trim();
      const { stdout } = await execFileP('du', ['-sk', mp]);
      sizes.set(vol, parseInt(stdout.split('\t')[0], 10) * 1024);
    } catch {
      sizes.set(vol, null); // 拿不到就 null,不让单卷失败拖垮整个 stats
    }
  }
  volSizeCache = { at: now, sizes };
  return sizes;
}

/** 实时状态:活跃容器(资源占用)+ 全部会话卷(归属/大小)。 */
export async function collectStats() {
  // 会话卷全量(卷 = 会话存在的事实源;容器可能已被 TTL 回收)
  const volLines = (await docker([
    'volume', 'ls', '--filter', 'label=cowork.managed=1',
    '--format', '{{.Name}}\t{{.Label "cowork.sid"}}\t{{.Label "cowork.uid"}}',
  ])).trim();
  const volumes = volLines ? volLines.split('\n').map((l) => {
    const [name, sid, uid] = l.split('\t');
    return { name, sid: sid || '', uid: uid || '' };
  }) : [];
  const sizes = await volumeSizes(volumes.map((v) => v.name));

  // 活跃会话容器(排除 cowork-proxy:它没有 cowork.sid label)
  const psLines = (await docker([
    'ps', '--filter', 'label=cowork.managed=1',
    '--format', '{{.Names}}\t{{.Label "cowork.sid"}}\t{{.Label "cowork.uid"}}\t{{.RunningFor}}',
  ])).trim();
  const containers = psLines ? psLines.split('\n')
    .map((l) => { const [name, sid, uid, runningFor] = l.split('\t'); return { name, sid: sid || '', uid: uid || '', runningFor }; })
    .filter((c) => c.sid) : [];

  // 资源占用(docker stats 不支持 label filter,按容器名点名)
  let stats = [];
  if (containers.length) {
    try {
      const out = (await docker(['stats', '--no-stream', '--format', '{{json .}}', ...containers.map((c) => c.name)])).trim();
      stats = out ? out.split('\n').map((l) => JSON.parse(l)) : [];
    } catch { /* stats 失败不拖垮整体 */ }
  }
  const statByName = new Map(stats.map((s) => [s.Name, s]));

  return {
    ok: true,
    containers: containers.map((c) => {
      const s = statByName.get(c.name);
      return {
        sid: c.sid, uid: c.uid, runningFor: c.runningFor,
        cpu: s?.CPUPerc ?? null, mem: s?.MemUsage ?? null, net: s?.NetIO ?? null, pids: s?.PIDs ?? null,
      };
    }),
    volumes: volumes.map((v) => ({ sid: v.sid, uid: v.uid, sizeBytes: sizes.get(v.name) ?? null })),
  };
}
