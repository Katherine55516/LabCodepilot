/**
 * cowork-vm-manager.ts — 沙箱 VM 生命周期管理器(server 侧单例)。
 *
 * P1-B:把 POC 的 vm-up.sh 用 Node 重写成常驻状态机,去掉"手动起 VM"。
 * 放 server 侧(而非 electron main)的原因:`npm run dev` 没有 main 进程,
 * dev 与打包版共用同一套逻辑,claude-client 直接调用,不依赖 IPC。
 *
 * 职责:
 * - 懒启动:沙箱会话首条消息 → ensureRunning() → spawn vfkit + 等 SSH 就绪
 * - 健康:定期探活,失联标记 crashed,下次 ensureRunning 自动重建
 * - 空闲回收:无活跃沙箱会话 N 分钟 → stop
 * - 进程纪律:pid 文件(孤儿回收,同 electron 主进程惯例)+ 退出清理
 * - binary 部署:VM 就绪后确保 ~/bin/claude 存在(缺则从宿主推入,复刻 Cowork installSdk)
 *
 * 传输/资产沿用 POC 目录 ~/.codepilot/cowork-poc(镜像/seed/SSH 密钥);
 * P1-C 换 vsock+daemon 时本模块的对外契约(ensureRunning/getStatus/stop)不变。
 */
import { spawn, execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const POC_DIR = path.join(os.homedir(), '.codepilot', 'cowork-poc');
const DISK = path.join(POC_DIR, 'images', 'debian-12-genericcloud-arm64.raw');
const SEED = path.join(POC_DIR, 'images', 'seed.iso');
const EFI_STORE = path.join(POC_DIR, 'efi-variable-store');
const VM_IP_FILE = path.join(POC_DIR, 'vm-ip');
const VFKIT_PID_FILE = path.join(POC_DIR, 'vfkit.pid');
const CONSOLE_LOG = path.join(POC_DIR, 'vm-console.log');
const SSH_KEY = path.join(POC_DIR, 'ssh', 'id_ed25519');
const HOST_CLAUDE_BIN = path.join(POC_DIR, 'bin', 'package', 'claude');
const GUEST_HOSTNAME = 'cowork-poc';
const GUEST_USER = 'agent';
const VM_MAC = '72:20:43:d4:38:62';
const RESTFUL_URI = 'tcp://127.0.0.1:47899';
// P1-C: vsock 运行时通道。vfkit connect 模式 → guest daemon 当 server,
// 宿主连这个 unix socket。port 与 daemon/客户端约定一致。
const VSOCK_PORT = 1024;
const VSOCK_SOCKET = path.join(POC_DIR, 'vsock-1024.sock');
const GUEST_DAEMON_PATH = '/home/agent/cowork-daemon.py';

const READY_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 20_000;
const IDLE_SHUTDOWN_MS = 15 * 60_000;

export type VmPhase = 'stopped' | 'starting' | 'running' | 'crashed';

export interface VmStatus {
  phase: VmPhase;
  ip: string | null;
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
  ip: string | null;
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
      phase: 'stopped', ip: null, proc: null, startingPromise: null,
      healthTimer: null, idleTimer: null, activeSessions: new Set<string>(),
    } as VmState;
  }
  return g[STATE_KEY] as VmState;
}

function sshBaseArgs(connectTimeout = 8): string[] {
  return [
    '-i', SSH_KEY,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR',
    '-o', `ConnectTimeout=${connectTimeout}`,
  ];
}

/**
 * 从 macOS `/var/db/dhcpd_leases` 文本按 guest hostname 反查 IP。
 * 导出供单测:vmnet 的 hw_address 用 DHCP client-id 格式(与 --device mac= 不
 * 一致),所以必须按 hostname 匹配;同一 hostname 有多条历史租约时取最后一条
 * (最新)。纯函数,不碰文件系统。
 */
export function parseLeaseIp(leasesText: string, hostname: string = GUEST_HOSTNAME): string | null {
  let ip: string | null = null;
  for (const block of leasesText.split('}')) {
    if (!block.includes(`name=${hostname}`)) continue;
    const m = block.match(/ip_address=([0-9.]+)/);
    if (m) ip = m[1]; // 取最后一条匹配租约
  }
  return ip;
}

/** DHCP 租约表按 guest hostname 反查 IP(读文件 + parseLeaseIp)。 */
function readLeaseIp(): string | null {
  try {
    return parseLeaseIp(fs.readFileSync('/var/db/dhcpd_leases', 'utf8'));
  } catch {
    return null;
  }
}

async function sshOk(ip: string, timeoutMs = 6000): Promise<boolean> {
  try {
    await execFileAsync('ssh', [...sshBaseArgs(4), `${GUEST_USER}@${ip}`, 'true'], { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
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

export function isImageProvisioned(): boolean {
  return fs.existsSync(DISK) && fs.existsSync(SEED) && fs.existsSync(SSH_KEY);
}

/** VM 就绪后确保 ~/bin/claude 存在;缺则从宿主推入(复刻 Cowork installSdk 动态部署)。 */
async function ensureGuestBinary(ip: string): Promise<void> {
  const has = await execFileAsync('ssh', [...sshBaseArgs(), `${GUEST_USER}@${ip}`, 'test -x ~/bin/claude && echo yes || echo no'], { timeout: 10000 })
    .then((r) => r.stdout.trim() === 'yes')
    .catch(() => false);
  if (has) return;
  if (!fs.existsSync(HOST_CLAUDE_BIN)) {
    throw new Error('guest claude binary missing and no host copy to push');
  }
  await execFileAsync('ssh', [...sshBaseArgs(), `${GUEST_USER}@${ip}`, 'mkdir -p ~/bin'], { timeout: 10000 });
  await execFileAsync('scp', [...sshBaseArgs(), HOST_CLAUDE_BIN, `${GUEST_USER}@${ip}:~/bin/claude`], { timeout: 300_000 });
  await execFileAsync('ssh', [...sshBaseArgs(), `${GUEST_USER}@${ip}`, 'chmod +x ~/bin/claude'], { timeout: 10000 });
}

/** 仓库内 daemon 脚本路径(dev 从 cwd 解析,打包版靠 cowork_forwarder_path 同目录)。 */
function hostDaemonPath(): string | null {
  const candidates: string[] = [];
  try {
    const { getSetting } = require('./db') as typeof import('./db');
    const fwd = (getSetting('cowork_forwarder_path') || '').trim();
    if (fwd) candidates.push(path.join(path.dirname(fwd), 'cowork-daemon.py'));
  } catch { /* db not available */ }
  candidates.push(path.join(process.cwd(), 'scripts/poc/cowork/cowork-daemon.py'));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * 确保 guest vsock daemon 在跑(P1-C 运行时通道)。先 vsock 健康探测;不健康则
 * SSH 一次性推 daemon.py + nohup 启动,再探。SSH 仅用于 provisioning(与推
 * claude binary 同性质);运行时数据流全走 vsock。生产形态会把 daemon 烘进镜像
 * 用 systemd 开机自启,彻底无 SSH。
 */
async function ensureDaemon(ip: string): Promise<void> {
  const { vsockHealthy } = await import('./cowork-vsock');
  if (await vsockHealthy(3000)) return;
  const daemonSrc = hostDaemonPath();
  if (!daemonSrc) {
    console.warn('[cowork-vm] daemon script not found on host — cannot provision vsock daemon');
    return;
  }
  console.log('[cowork-vm] provisioning vsock daemon…');
  await execFileAsync('scp', [...sshBaseArgs(), daemonSrc, `${GUEST_USER}@${ip}:${GUEST_DAEMON_PATH}`], { timeout: 30000 });
  // 先杀旧实例(独立 ssh 调用 + bracket trick 防自杀:pkill 的模式串
  // `[c]owork-daemon.py` 在本命令行里字面是 `[c]owork…`,正则却匹配 `cowork…`,
  // 于是不会误杀这条 kill 命令自身。原先单命令里带 python3 路径 → 自匹配自杀,
  // daemon 永远起不来)。
  await execFileAsync('ssh', [...sshBaseArgs(), `${GUEST_USER}@${ip}`,
    `pkill -f '[c]owork-daemon.py' 2>/dev/null; true`,
  ], { timeout: 10000 }).catch(() => { /* 没有旧实例可杀 */ });
  // 再起(独立 ssh:本命令行含脚本路径但无 pkill,不会被杀);setsid+nohup 脱离会话常驻
  await execFileAsync('ssh', [...sshBaseArgs(), `${GUEST_USER}@${ip}`,
    `setsid nohup python3 ${GUEST_DAEMON_PATH} >/tmp/cowork-daemon.log 2>&1 < /dev/null & sleep 0.5; echo started`,
  ], { timeout: 15000 });
  // 等 daemon 在 vsock 上就绪
  for (let i = 0; i < 20; i++) {
    if (await vsockHealthy(2000)) { console.log('[cowork-vm] vsock daemon ready'); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vsock daemon did not become healthy after provisioning');
}

function clearHealth(s: VmState): void {
  if (s.healthTimer) { clearInterval(s.healthTimer); s.healthTimer = null; }
}

function startHealth(s: VmState): void {
  clearHealth(s);
  s.healthTimer = setInterval(async () => {
    if (s.phase !== 'running' || !s.ip) return;
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
  return { phase: s.phase, ip: s.ip, reason: s.reason };
}

/**
 * 确保 VM 就绪。幂等 + 并发安全(多个沙箱会话同一回合并发调用只启动一次)。
 * 成功返回 { phase:'running', ip }。失败返回 { phase:'crashed'/'stopped', reason }。
 */
export async function ensureRunning(): Promise<VmStatus> {
  const s = state();

  if (s.phase === 'running' && s.ip) {
    // 快速校验仍活着(pid 可能被外部杀掉)
    if (existingVfkitPid() || (await sshOk(s.ip, 4000))) return getStatus();
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

      // 复用外部已在跑的 vfkit(POC 手动启动的、或上次本进程启动的)
      const alivePid = existingVfkitPid();
      if (alivePid) {
        const ip = readLeaseIp();
        if (ip && (await sshOk(ip))) {
          s.ip = ip;
          fs.writeFileSync(VM_IP_FILE, ip);
          emitProgress('provisioning', 'preparing sandbox');
          await ensureGuestBinary(ip).catch((e) => console.warn('[cowork-vm] ensureGuestBinary:', e?.message));
          await ensureDaemon(ip).catch((e) => console.warn('[cowork-vm] ensureDaemon:', e?.message));
          s.phase = 'running';
          s.reason = undefined;
          emitProgress('ready');
          startHealth(s);
          resetIdleTimer(s);
          console.log(`[cowork-vm] reused existing vfkit pid=${alivePid} ip=${ip}`);
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
      s.ip = null;
      emitProgress('starting', 'launching sandbox VM');
      console.log('[cowork-vm] spawning vfkit…');

      // 陈旧 vsock socket 文件会让 vfkit 的 ListenUnix bind 失败,先清
      try { fs.rmSync(VSOCK_SOCKET, { force: true }); } catch { /* ignore */ }
      const proc = spawn('vfkit', [
        '--cpus', '2', '--memory', '2048',
        '--bootloader', `efi,variable-store=${EFI_STORE},create`,
        '--device', `virtio-blk,path=${DISK}`,
        '--device', `virtio-blk,path=${SEED}`,
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
          s.ip = null;
          clearHealth(s);
        }
      });

      // 轮询 DHCP 租约 + SSH 就绪
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (s.phase !== 'starting') break; // exit 回调可能已改状态
        const ip = readLeaseIp();
        if (ip && (await sshOk(ip))) {
          s.ip = ip;
          fs.writeFileSync(VM_IP_FILE, ip);
          emitProgress('provisioning', 'preparing sandbox');
          await ensureGuestBinary(ip);
          await ensureDaemon(ip);
          s.phase = 'running';
          s.reason = undefined;
          emitProgress('ready');
          startHealth(s);
          resetIdleTimer(s);
          console.log(`[cowork-vm] ready ip=${ip} pid=${proc.pid}`);
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
  s.ip = null;
  s.phase = 'stopped';
  s.reason = undefined;
  try { fs.rmSync(VFKIT_PID_FILE, { force: true }); } catch { /* ignore */ }
}
