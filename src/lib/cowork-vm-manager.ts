/**
 * cowork-vm-manager.ts — 沙箱 VM 生命周期管理器(server 侧单例)。
 *
 * P1-B:把 POC 的 vm-up.sh 用 Node 重写成常驻状态机,去掉"手动起 VM"。
 * 放 server 侧(而非 electron main)的原因:`npm run dev` 没有 main 进程,
 * dev 与打包版共用同一套逻辑,claude-client 直接调用,不依赖 IPC。
 *
 * 镜像流水线 M1 起,宿主与 guest 的唯一通道是 vsock:
 * - seed 由 cowork-seed.ts 生成(daemon/systemd 经 cloud-init 首启自注入),
 *   SSH/scp provisioning 链整体退役,宿主不再需要知道 VM 的 IP
 * - 就绪判定 = 轮询 vsock health(首启含 cloud-init 自注入 ~60-90s,二次
 *   启动 systemd 拉 daemon ~15s)
 * - claude binary 缺失时经 vsock installBinary 推入(health 一次探测拿全)
 *
 * 职责:
 * - 懒启动:沙箱会话首条消息 → ensureRunning() → spawn vfkit + 等 vsock 就绪
 * - 健康:定期探活,失联标记 crashed,下次 ensureRunning 自动重建
 * - 空闲回收:无活跃沙箱会话 N 分钟 → stop
 * - 进程纪律:pid 文件(孤儿回收,同 electron 主进程惯例)+ 退出清理
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { ensureSeedIso, EXPECTED_DAEMON_VERSION } from './cowork-seed';
// M3:路径单一事实源在 cowork-paths(资产目录正式化 + 随包 vfkit 解析)
import {
  IMAGE_PATH as DISK, CLAUDE_BIN_PATH as HOST_CLAUDE_BIN,
  EFI_STORE_PATH as EFI_STORE, VFKIT_PID_FILE, CONSOLE_LOG_PATH as CONSOLE_LOG,
  VSOCK_SOCKET_PATH as VSOCK_SOCKET, vfkitBin,
} from './cowork-paths';

const VM_MAC = '72:20:43:d4:38:62';
const RESTFUL_URI = 'tcp://127.0.0.1:47899';
// P1-C: vsock 运行时通道。vfkit connect 模式 → guest daemon 当 server,
// 宿主连这个 unix socket。port 与 daemon/客户端约定一致。
const VSOCK_PORT = 1024;

// 首启含 cloud-init 自注入(growpart + write_files + systemd enable,~60-90s),
// 二次启动 daemon 由 systemd 秒级拉起 —— 超时按首启给足。
const READY_TIMEOUT_MS = 240_000;
const HEALTH_INTERVAL_MS = 20_000;
const IDLE_SHUTDOWN_MS = 15 * 60_000;

export type VmPhase = 'stopped' | 'starting' | 'running' | 'crashed';

export interface VmStatus {
  phase: VmPhase;
  reason?: string;
}

/**
 * P1-D 进度事件:VM 启动窗口(冷启动数秒~数十秒)期间对外广播阶段,供 claude-client
 * 转成 vm_status SSE、前端显示"沙箱准备中"。用模块级监听器集合(挂 globalThis 抗
 * hot-reload)而非回调参数,因为 ensureRunning 用共享 startingPromise,并发调用者
 * 都该收到同一进度流。
 */
export type VmProgressPhase = 'starting' | 'booting' | 'provisioning' | 'ready' | 'failed';
export interface VmProgress { phase: VmProgressPhase; detail?: string }
type VmProgressListener = (p: VmProgress) => void;

const PROGRESS_KEY = '__coworkVmProgress__';
function progressListeners(): Set<VmProgressListener> {
  const g = globalThis as Record<string, unknown>;
  if (!g[PROGRESS_KEY]) g[PROGRESS_KEY] = new Set<VmProgressListener>();
  return g[PROGRESS_KEY] as Set<VmProgressListener>;
}
function emitProgress(phase: VmProgressPhase, detail?: string): void {
  for (const l of progressListeners()) {
    try { l({ phase, detail }); } catch { /* listener error ignored */ }
  }
}
/** 订阅 VM 启动进度,返回取消订阅函数。 */
export function onVmProgress(cb: VmProgressListener): () => void {
  progressListeners().add(cb);
  return () => { progressListeners().delete(cb); };
}

interface VmState {
  phase: VmPhase;
  proc: ChildProcess | null;
  startingPromise: Promise<VmStatus> | null;
  healthTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  activeSessions: Set<string>;
  reason?: string;
}

// Survive Next.js dev hot-reload / route module re-eval by parking the singleton
// on globalThis (same pattern the stream-session-manager listeners use).
const STATE_KEY = '__coworkVmState__';
function state(): VmState {
  const g = globalThis as Record<string, unknown>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      phase: 'stopped', proc: null, startingPromise: null,
      healthTimer: null, idleTimer: null, activeSessions: new Set<string>(),
    } as VmState;
  }
  return g[STATE_KEY] as VmState;
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * VM 就绪判定(P3-A):不只是 daemon 应答,还要求 v4+ daemon 已提权到 root。
 * 升级重灌时 daemon 可能先以旧 unit(User=agent)开机自启就 vsock 应答,而
 * cloud-init runcmd 的 restart 才把它提权到 root —— 若此时开跑回合,exec 的
 * setuid 降权(user=/group=)会失败、claude 秒退。故 fail-secure:daemon 非
 * root 时不算就绪,继续等 cloud-init 完成(旧 daemon 无 uid 字段 → 不卡)。
 */
async function vsockRootReady(timeoutMs = 4000): Promise<boolean> {
  const { vsockHealth } = await import('./cowork-vsock');
  const h = await vsockHealth(timeoutMs);
  if (!h.ok) return false;
  if (h.version !== undefined && h.version >= 4 && h.uid !== 0) return false;
  return true;
}

/** 是否已有一台我们的 vfkit 在跑(pid 文件存活),用于跨进程复用与孤儿判定。 */
function existingVfkitPid(): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(VFKIT_PID_FILE, 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) return pid;
  } catch { /* no pidfile */ }
  return null;
}

/**
 * 进程退出时尽力关掉本进程启动的 VM。next-server 优雅退出(打包版 app 退出、
 * dev Ctrl-C)会触发,避免 vfkit 变孤儿。best-effort:同步 kill,不等确认。
 * 幂等注册(hot-reload 多次 import 不重复挂)。
 */
function registerExitCleanupOnce(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.__coworkVmExitHooked) return;
  g.__coworkVmExitHooked = true;
  const killOwn = () => {
    const s = state();
    const pid = s.proc?.pid;
    if (pid && isPidAlive(pid)) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    }
  };
  process.once('exit', killOwn);
  process.once('SIGTERM', () => { killOwn(); process.exit(0); });
  process.once('SIGINT', () => { killOwn(); process.exit(0); });
}

/**
 * 镜像就绪判定:M1 起只看底镜 raw(seed 按需生成,SSH 密钥不再是前置)。
 * M2 会演进为下载器的资产状态机。
 */
export function isImageProvisioned(): boolean {
  return fs.existsSync(DISK);
}

/**
 * VM 就绪后确保 guest 具备执行面(全 vsock,零 SSH):
 * - daemon 版本哨兵:正常永远一致(改 daemon 必 bump SEED_TEMPLATE_VERSION →
 *   instance-id 变化 → cloud-init 重跑);不一致只告警,下次重启自愈
 * - v1 daemon(SSH 时代注入,health 无 version 字段)兼容:必然已被旧链路推过
 *   binary,跳过检查,VM 重启后经新 seed 升级
 * - claude binary 缺失 → installBinary 流式推入
 */
async function provisionGuest(): Promise<void> {
  const { vsockHealth, rpcInstallBinary } = await import('./cowork-vsock');
  const h = await vsockHealth(6000);
  if (!h.ok) throw new Error('guest daemon not healthy after boot');
  if (h.version === undefined) {
    console.warn('[cowork-vm] guest daemon is v1 (pre-seed era) — skipping binary check until next VM restart');
    return;
  }
  if (h.version !== EXPECTED_DAEMON_VERSION) {
    console.warn(`[cowork-vm] guest daemon version=${h.version}, expected=${EXPECTED_DAEMON_VERSION} — will re-provision on next boot`);
  }
  // 缺失 → 推;或 daemon v3 上报的大小与宿主不符(app 升级 SDK 后 guest 旧
  // binary 版本偏斜)→ 重推覆盖(installBinary 是 .part+原子替换,可安全覆盖)
  const hostSize = fs.existsSync(HOST_CLAUDE_BIN) ? fs.statSync(HOST_CLAUDE_BIN).size : 0;
  const sizeSkew = h.claude === true && typeof h.claudeSize === 'number' && hostSize > 0 && h.claudeSize !== hostSize;
  if (!h.claude || sizeSkew) {
    if (!hostSize) {
      throw new Error('guest claude binary missing and no host copy to push');
    }
    emitProgress('provisioning', 'installing agent runtime');
    console.log(`[cowork-vm] pushing claude binary into guest via vsock…${sizeSkew ? ' (version skew: guest size differs)' : ''}`);
    await rpcInstallBinary('claude', HOST_CLAUDE_BIN);
    console.log('[cowork-vm] claude binary installed in guest');
  }
}

function clearHealth(s: VmState): void {
  if (s.healthTimer) { clearInterval(s.healthTimer); s.healthTimer = null; }
}

function startHealth(s: VmState): void {
  clearHealth(s);
  s.healthTimer = setInterval(async () => {
    if (s.phase !== 'running') return;
    // P1-C:健康探测走 vsock daemon(它挂了 = 通道断了,即使 VM 还活着也要重建)
    const { vsockHealthy } = await import('./cowork-vsock');
    const ok = await vsockHealthy(6000);
    if (!ok && s.phase === 'running') {
      // 二次确认,避免瞬时抖动误判
      const retry = await vsockHealthy(6000);
      if (!retry && s.phase === 'running') {
        console.warn('[cowork-vm] vsock health check failed twice → marking crashed');
        s.phase = 'crashed';
        s.reason = 'health check failed';
        clearHealth(s);
      }
    }
  }, HEALTH_INTERVAL_MS);
  // Node 定时器不阻止进程退出
  s.healthTimer.unref?.();
}

function resetIdleTimer(s: VmState): void {
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  if (s.activeSessions.size > 0) return; // 有活跃会话不回收
  s.idleTimer = setTimeout(() => {
    if (s.activeSessions.size === 0 && s.phase === 'running') {
      console.log('[cowork-vm] idle timeout → stopping VM');
      void stop();
    }
  }, IDLE_SHUTDOWN_MS);
  s.idleTimer.unref?.();
}

export function getStatus(): VmStatus {
  const s = state();
  return { phase: s.phase, reason: s.reason };
}

/**
 * 确保 VM 就绪。幂等 + 并发安全(多个沙箱会话同一回合并发调用只启动一次)。
 * 成功返回 { phase:'running' }。失败返回 { phase:'crashed'/'stopped', reason }。
 */
export async function ensureRunning(): Promise<VmStatus> {
  const s = state();

  if (s.phase === 'running') {
    // 快速校验仍活着(pid 可能被外部杀掉)
    const { vsockHealthy } = await import('./cowork-vsock');
    if (existingVfkitPid() || (await vsockHealthy(4000))) return getStatus();
    s.phase = 'crashed';
    s.reason = 'vfkit process gone';
  }

  if (s.startingPromise) return s.startingPromise;

  s.startingPromise = (async (): Promise<VmStatus> => {
    try {
      registerExitCleanupOnce();
      if (!isImageProvisioned()) {
        s.phase = 'stopped';
        s.reason = 'image_not_provisioned';
        return getStatus();
      }
      const { vsockHealthy } = await import('./cowork-vsock');

      // 复用外部已在跑的 vfkit(vm-up.sh 手动启动的、或上次本进程启动的)
      const alivePid = existingVfkitPid();
      if (alivePid) {
        if (await vsockRootReady(4000)) {
          emitProgress('provisioning', 'preparing sandbox');
          await provisionGuest();
          s.phase = 'running';
          s.reason = undefined;
          emitProgress('ready');
          startHealth(s);
          resetIdleTimer(s);
          fireSessionReconcile();
          console.log(`[cowork-vm] reused existing vfkit pid=${alivePid}`);
          return getStatus();
        }
        // Pidfile points to a live vfkit we can't reach (wedged VM, or an
        // orphan from a previous next-server process). Reap it before spawning
        // fresh so we never leave a duplicate VM running.
        console.warn(`[cowork-vm] existing vfkit pid=${alivePid} unreachable → reaping before respawn`);
        try { process.kill(alivePid, 'SIGKILL'); } catch { /* already gone */ }
      }

      s.phase = 'starting';
      s.reason = undefined;
      emitProgress('starting', 'launching sandbox VM');

      // M1:seed 由代码生成(daemon/systemd 经 cloud-init 首启自注入)。
      // 内容寻址 + 存在即复用,常态是零成本;daemon/模板变更时自动重造。
      const seedIso = await ensureSeedIso();

      // M3:随包 vfkit 优先(免 brew 前置),dev 回退 PATH
      const vfkit = vfkitBin();
      console.log(`[cowork-vm] spawning vfkit… (${vfkit})`);
      // 陈旧 vsock socket 文件会让 vfkit 的 ListenUnix bind 失败,先清
      try { fs.rmSync(VSOCK_SOCKET, { force: true }); } catch { /* ignore */ }
      const proc = spawn(vfkit, [
        '--cpus', '2', '--memory', '2048',
        '--bootloader', `efi,variable-store=${EFI_STORE},create`,
        '--device', `virtio-blk,path=${DISK}`,
        '--device', `virtio-blk,path=${seedIso}`,
        '--device', `virtio-net,nat,mac=${VM_MAC}`,
        '--device', `virtio-serial,logFilePath=${CONSOLE_LOG}`,
        '--device', 'virtio-rng',
        '--device', `virtio-vsock,port=${VSOCK_PORT},socketURL=${VSOCK_SOCKET},connect`,
        '--restful-uri', RESTFUL_URI,
      ], { stdio: 'ignore', detached: false });

      s.proc = proc;
      if (proc.pid) fs.writeFileSync(VFKIT_PID_FILE, String(proc.pid));
      proc.on('exit', (code) => {
        console.warn(`[cowork-vm] vfkit exited code=${code}`);
        if (s.phase === 'running' || s.phase === 'starting') {
          s.phase = 'crashed';
          s.reason = `vfkit exited (${code})`;
          clearHealth(s);
        }
      });

      // 轮询 vsock 就绪(daemon 由 systemd 开机拉起;首启多一段 cloud-init 注入)
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (s.phase !== 'starting') break; // exit 回调可能已改状态
        if (await vsockRootReady(2500)) {
          await provisionGuest();
          s.phase = 'running';
          s.reason = undefined;
          emitProgress('ready');
          startHealth(s);
          resetIdleTimer(s);
          fireSessionReconcile();
          console.log(`[cowork-vm] ready pid=${proc.pid}`);
          return getStatus();
        }
        emitProgress('booting', 'waiting for sandbox to boot');
        await new Promise((r) => setTimeout(r, 2000));
      }

      // 超时:杀掉半死进程
      s.phase = 'crashed';
      s.reason = s.reason || 'vm did not become ready in time';
      emitProgress('failed', s.reason);
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      return getStatus();
    } catch (err) {
      s.phase = 'crashed';
      s.reason = err instanceof Error ? err.message : String(err);
      emitProgress('failed', s.reason);
      return getStatus();
    } finally {
      s.startingPromise = null;
    }
  })();

  return s.startingPromise;
}

/**
 * E4.1 存储对账(fire-and-forget,不阻塞就绪):VM 每次 ready 后,把
 * guest 内 /home/agent/sessions 下「DB 里已不存在的会话」的孤儿目录删掉。
 * removeSessionDir 在 VM 休眠时删除会话是 best-effort 失败的 —— 不对账
 * 的话残留会累积占满 guest 磁盘。keep 名单取全量现存会话 id(不只沙箱:
 * 历史上开过沙箱后来关掉的会话,其 VM 产物目录同样保留)。
 */
function fireSessionReconcile(): void {
  // P3-C 安全审计:两个就绪点(reuse/fresh boot)都经此,一处记 vm_start。
  void import('./cowork-audit').then((m) => m.audit('vm_start'));
  (async () => {
    try {
      const { getAllSessions } = require('./db') as typeof import('./db');
      const keep = getAllSessions().map((sess) => sess.id);
      const { reconcileSessionDirs } = await import('./cowork-transfer');
      const removed = await reconcileSessionDirs(keep);
      console.log(`[cowork-vm] guest session reconcile: keep=${keep.length}, removed=${removed.length}${removed.length ? ` (${removed.join(', ')})` : ''}`);
    } catch (err) {
      // 对账失败不致命(下次 ready 再试);老 daemon 不认识该 op 时也走这里
      console.warn('[cowork-vm] session reconcile failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  })();
}

/** 标记一个沙箱会话为活跃(阻止空闲回收)。回合结束调 release。 */
export function markSessionActive(sessionId: string): void {
  const s = state();
  s.activeSessions.add(sessionId);
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
}

export function releaseSession(sessionId: string): void {
  const s = state();
  s.activeSessions.delete(sessionId);
  resetIdleTimer(s);
}

export async function stop(): Promise<void> {
  const s = state();
  clearHealth(s);
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  const pid = s.proc?.pid || existingVfkitPid();
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    // 3s 后仍在就强杀
    setTimeout(() => { try { if (isPidAlive(pid)) process.kill(pid, 'SIGKILL'); } catch { /* ignore */ } }, 3000);
  }
  s.proc = null;
  s.phase = 'stopped';
  s.reason = undefined;
  try { fs.rmSync(VFKIT_PID_FILE, { force: true }); } catch { /* ignore */ }
  if (pid) void import('./cowork-audit').then((m) => m.audit('vm_stop')); // P3-C 审计
}
