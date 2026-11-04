/**
 * 管理面数据源(用量后台 P0,只读)—— 供账号后端 admin 拉取,普通用户不可达
 * (index.mjs 的 /admin/* 分支只认 uid === ADMIN_UID 的 token,见 D3:账号后端
 * 服务端持 HMAC secret 自签;用户 token 恒为真实 UUID,不可能碰撞)。
 *
 * - readAuditSince(offset):审计日志按字节增量读取。fileId = 首行 sha256 前 16 位,
 *   截断/清空/轮转后首行必变 → 拉取端(账号后端)检测到 fileId 变化即归零重拉,
 *   PG 侧 UNIQUE 约束兜底去重(见 exec-plan cowork-usage-admin D6)。
 * - getStats():/admin/stats 入口 —— **内存快照 + 后台异步刷新**,响应恒为毫秒级。
 *   采集本体 collectStats()(活跃容器资源 + 全部会话卷 + 大小)只在后台跑:
 *   docker stats --no-stream 天然 ~2s 采样,卷大小的 docker system df 随卷数量
 *   线性变慢(几十上百个会话卷时可到几十秒)—— 在请求路径上现采,叠加账号后端
 *   10s 超时,就是用量后台「每次都慢/经常超时」的根因。
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

// —— 卷大小缓存(60s)+ in-flight 去重 + 陈旧回退:df 是本模块唯一分钟级操作 ——
// 不用 du:服务进程跑在非 root 的 cowork 用户下,穿越不了 root 属主的 docker
// data-root(userns-remap 子目录),du 恒失败(生产实测 sizeBytes 全 null)。
// docker daemon 自己算则只需 docker 组权限,一次调用拿全部卷。
// 缓存过期后**不等**新 df:先回旧值,df 后台跑完落缓存 —— 卷大小变化很慢,
// 陈旧 ≤ 分钟级无所谓;并发请求共享同一次 df(此前各起一个,daemon 越忙越慢,正反馈恶化)。
let volSizeCache = { at: 0, sizes: new Map() };
let volSizeInflight = null;

/** docker 的人类可读大小("7.368kB"/"1.2MB"/"0B",10 进制)→ 字节。 */
function parseDockerSize(s) {
  const m = /^([\d.]+)\s*([kMGT]?)B$/i.exec(String(s || '').trim());
  if (!m) return null;
  const mult = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12 }[m[2].toLowerCase()] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

async function volumeSizes() {
  if (Date.now() - volSizeCache.at < 60_000) return volSizeCache.sizes;
  if (!volSizeInflight) {
    volSizeInflight = (async () => {
      try {
        const out = await docker(['system', 'df', '-v', '--format', 'json']);
        const sizes = new Map();
        for (const v of JSON.parse(out).Volumes || []) {
          if (v?.Name) sizes.set(v.Name, parseDockerSize(v.Size));
        }
        volSizeCache = { at: Date.now(), sizes };
      } catch {
        // 拿不到:保留旧值(陈旧大小好过全 null),同样进入 60s 冷却,别连环撞失败的 df
        volSizeCache = { at: Date.now(), sizes: volSizeCache.sizes };
      } finally {
        volSizeInflight = null;
      }
    })();
  }
  if (volSizeCache.at > 0) return volSizeCache.sizes; // 有旧值(含失败冷却)就不等这次 df
  await volSizeInflight;                              // 冷启动首采:等一次
  return volSizeCache.sizes;
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
  const sizes = await volumeSizes();

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
    // 一个会话现在有两个卷(workspace 产物 + state=claude 的 HOME),按 sid 合并成一行、
    // 大小求和 —— 否则同一个会话会在面板里出现两条。全 null(拿不到 df)才报 null。
    volumes: [...volumes.reduce((acc, v) => {
      const row = acc.get(v.sid) || { sid: v.sid, uid: v.uid, sizeBytes: null };
      const size = sizes.get(v.name);
      if (size != null) row.sizeBytes = (row.sizeBytes ?? 0) + size;
      acc.set(v.sid, row);
      return acc;
    }, new Map()).values()],
  };
}

// —— /admin/stats 快照层:请求恒即时返回,采集转后台(见模块 docstring)——
// 刻意不做启动预热:selftest 与冷启动的第一次调用都依赖「现场采集」语义
// (预热快照会早于测试造的会话,断言必挂);冷启动只慢这一次,之后恒快照。
const STATS_SNAPSHOT_TTL = 15_000;
let statsSnapshot = null; // { at, data }
let statsInflight = null; // 采集去重:并发请求共享同一次 collectStats

function refreshStats() {
  if (!statsInflight) {
    statsInflight = collectStats()
      .then((data) => { statsSnapshot = { at: Date.now(), data }; return data; })
      .finally(() => { statsInflight = null; });
  }
  return statsInflight;
}

/** /admin/stats 入口。有快照(哪怕过期)立即返回并后台刷新;冷启动等首采。 */
export async function getStats() {
  if (statsSnapshot && Date.now() - statsSnapshot.at < STATS_SNAPSHOT_TTL) return statsSnapshot.data;
  const p = refreshStats();
  if (statsSnapshot) { p.catch(() => {}); return statsSnapshot.data; } // 刷新失败留旧快照,下一请求再触发
  return p; // 冷启动:等首采;失败抛给路由 → 非 200,账号后端按 live 降级处理
}
