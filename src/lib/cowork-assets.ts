/**
 * cowork-assets.ts — 沙箱资产下载器(镜像流水线 M2)。
 *
 * 消灭"新机器要手动预置"的两大资产:
 * - Debian 底镜 raw(~3GB):中科大源为主、cloud.debian.org 兜底。**锚定 dated
 *   build 而非 latest**(latest 会漂移导致校验失败),官方 SHA512SUMS 值固化为
 *   常量,下载后全量校验。完成后稀疏扩容到 8GiB(APFS 零成本,guest 首启
 *   growpart 吃满,workspace 余量翻倍)。
 * - claude linux binary(~253MB):`@anthropic-ai/claude-agent-sdk-linux-arm64`
 *   平台子包(npmmirror 为主、npmjs 兜底),**版本与宿主 SDK 严格一致**
 *   (CLAUDE_SDK_VERSION 有单测锁定 package.json),integrity 取自 registry
 *   元数据;tgz 用系统 tar 解出 package/claude。
 *
 * 下载引擎:HTTP Range 断点续传(.part 文件;续传前先重哈希已有前缀)、
 * sha512 流式校验、下载前磁盘预检、多源顺序 failover(镜像内容一致,续传可
 * 跨源,最终校验兜底)。状态为 server 侧单例(globalThis 抗 hot-reload),
 * UI 经 /api/cowork/status 轮询。取消保留 .part,下次点下载自动续传。
 *
 * 显式触发(D3):只有用户点「下载」才开始,绝不启动时偷跑。
 * 版本升级(bump 纪律):换底镜 build 时同步更新 IMAGE_BUILD/IMAGE_SHA512/
 * IMAGE_SIZE 三个常量;claude 版本随 package.json 升级由单测强制同步。
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  IMAGES_DIR, IMAGE_PATH, IMAGE_MARKER_PATH,
  CLAUDE_BIN_PATH, CLAUDE_MARKER_PATH, EFI_STORE_PATH, COWORK_ROOT,
} from './cowork-paths';

// M3 起路径单一事实源在 cowork-paths.ts;这里保留 re-export 兼容既有 import。
export { IMAGE_PATH, CLAUDE_BIN_PATH } from './cowork-paths';

// ── 底镜 manifest(dated build 锚定;2026-07-14 实测:此 build=当期 latest,
//    sha512 与官方 SHA512SUMS 一致,USTC 全量下载+首启验证通过)──
export const IMAGE_BUILD = '20260712-2537';
export const IMAGE_FILENAME = `debian-12-genericcloud-arm64-${IMAGE_BUILD}.raw`;
export const IMAGE_URLS = [
  `https://mirrors.ustc.edu.cn/debian-cdimage/cloud/bookworm/${IMAGE_BUILD}/${IMAGE_FILENAME}`,
  `https://cloud.debian.org/images/cloud/bookworm/${IMAGE_BUILD}/${IMAGE_FILENAME}`,
];
export const IMAGE_SHA512 = '7caf037e3ce78f8faf8ca75eedcafa2865708cfceda2522170cf7276362e80c0ba878af48d5d5eb5543df42f4e015edc5fb6d3fc023c5c8bafd2d0e9e599ed0a';
export const IMAGE_SIZE = 3221225472;
/** 下载完成后 raw 的稀疏扩容目标(guest 首启 growpart 吃满)。 */
export const IMAGE_SPARSE_SIZE = 8 * 1024 ** 3;

// ── claude binary manifest(与宿主 SDK 同版本;单测锁 package.json)──
export const CLAUDE_SDK_VERSION = '0.3.203';
export const CLAUDE_PLATFORM_PKG = '@anthropic-ai/claude-agent-sdk-linux-arm64';
export const CLAUDE_REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org'];

export function claudeTarballUrl(registry: string): string {
  return `${registry}/${CLAUDE_PLATFORM_PKG}/-/claude-agent-sdk-linux-arm64-${CLAUDE_SDK_VERSION}.tgz`;
}
export function claudeMetadataUrl(registry: string): string {
  return `${registry}/${CLAUDE_PLATFORM_PKG}/${CLAUDE_SDK_VERSION}`;
}

/** 磁盘预检余量(校验/解包/临时文件)。 */
const PREFLIGHT_MARGIN = 512 * 1024 ** 2;
/** claude tgz 估算体积(仅预检用;实际以 registry 元数据为准)。 */
const CLAUDE_TGZ_ESTIMATE = 400 * 1024 ** 2;

export type AssetState = 'missing' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'failed';

export interface AssetProgress {
  state: AssetState;
  receivedBytes: number;
  totalBytes: number;
  /** 0-100(missing=0,ready=100)。 */
  pct: number;
  error?: string;
}

export interface AssetsStatus {
  image: AssetProgress;
  claude: AssetProgress;
  overall: 'ready' | 'downloading' | 'missing' | 'failed';
  totalPct: number;
  /**
   * M3:当前落盘资产是否可用(文件都在)。升级下载期间 overall='downloading'
   * 但 usable 仍为 true —— UI 的"能不能开工/发消息"看这个,别看 overall
   * (否则可选升级会误禁办公会话)。
   */
  usable: boolean;
  /** M3:有新版可下载(app 更新携带了新 manifest,现有资产仍可用)。 */
  upgradeAvailable: boolean;
}

interface AssetRuntime {
  state: AssetState;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

interface AssetsRuntime {
  active: boolean;
  abort: AbortController | null;
  image: AssetRuntime;
  claude: AssetRuntime;
}

const STATE_KEY = '__coworkAssetsState__';
function runtime(): AssetsRuntime {
  const g = globalThis as Record<string, unknown>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      active: false,
      abort: null,
      image: { state: 'missing', receivedBytes: 0, totalBytes: IMAGE_SIZE },
      claude: { state: 'missing', receivedBytes: 0, totalBytes: 0 },
    } as AssetsRuntime;
  }
  return g[STATE_KEY] as AssetsRuntime;
}

/** 执行门:两资产文件都在(guest 侧 binary 的推入由 provisionGuest 兜底)。 */
export function assetsReady(): boolean {
  return fs.existsSync(IMAGE_PATH) && fs.existsSync(CLAUDE_BIN_PATH);
}

// ── 版本戳(M3):installed-*.json 记录已装版本,与代码 manifest 常量比对得升级信号 ──

function readJsonMarker(file: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJsonMarker(file: string, obj: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn('[cowork-assets] marker write failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/**
 * 懒栽种:资产在位但无版本戳(legacy 手动预置/M2 前下载)→ 按当前 manifest
 * 补戳。对现存两台真机是事实正确的(盘与 binary 均为当前锚定版本)。
 */
function ensureMarkers(): void {
  if (fs.existsSync(IMAGE_PATH) && !readJsonMarker(IMAGE_MARKER_PATH)) {
    writeJsonMarker(IMAGE_MARKER_PATH, { build: IMAGE_BUILD, sha512: IMAGE_SHA512, stampedBy: 'lazy' });
  }
  if (fs.existsSync(CLAUDE_BIN_PATH) && !readJsonMarker(CLAUDE_MARKER_PATH)) {
    writeJsonMarker(CLAUDE_MARKER_PATH, { version: CLAUDE_SDK_VERSION, stampedBy: 'lazy' });
  }
}

/** 底镜有新版:文件在位但已装 build ≠ 代码锚定 build(app 更新携带新 manifest)。 */
export function imageNeedsUpgrade(): boolean {
  if (!fs.existsSync(IMAGE_PATH)) return false;
  ensureMarkers();
  return String(readJsonMarker(IMAGE_MARKER_PATH)?.build || '') !== IMAGE_BUILD;
}

/** claude binary 有新版:已装版本 ≠ 宿主 SDK 版本(app 升级 SDK 后触发)。 */
export function claudeNeedsUpgrade(): boolean {
  if (!fs.existsSync(CLAUDE_BIN_PATH)) return false;
  ensureMarkers();
  return String(readJsonMarker(CLAUDE_MARKER_PATH)?.version || '') !== CLAUDE_SDK_VERSION;
}

function probeIdle(r: AssetRuntime, file: string, total: number): AssetProgress {
  // 空闲态按文件系统真值报告(下载态按运行时进度报告)
  if (r.state === 'downloading' || r.state === 'verifying' || r.state === 'installing') {
    const pct = r.totalBytes > 0 ? Math.min(99, Math.floor((r.receivedBytes / r.totalBytes) * 100)) : 0;
    return { state: r.state, receivedBytes: r.receivedBytes, totalBytes: r.totalBytes, pct, error: r.error };
  }
  if (fs.existsSync(file)) {
    return { state: 'ready', receivedBytes: total, totalBytes: total, pct: 100 };
  }
  if (r.state === 'failed') {
    return { state: 'failed', receivedBytes: r.receivedBytes, totalBytes: r.totalBytes || total, pct: 0, error: r.error };
  }
  return { state: 'missing', receivedBytes: 0, totalBytes: total, pct: 0 };
}

export function getAssetsStatus(): AssetsStatus {
  const r = runtime();
  const image = probeIdle(r.image, IMAGE_PATH, IMAGE_SIZE);
  const claude = probeIdle(r.claude, CLAUDE_BIN_PATH, r.claude.totalBytes || CLAUDE_TGZ_ESTIMATE);
  let overall: AssetsStatus['overall'];
  if (r.active) overall = 'downloading';
  else if (image.state === 'ready' && claude.state === 'ready') overall = 'ready';
  else if (image.state === 'failed' || claude.state === 'failed') overall = 'failed';
  else overall = 'missing';
  // 加权总进度:按字节权重(底镜占绝对大头)
  const totalBytes = image.totalBytes + claude.totalBytes;
  const gotBytes =
    (image.state === 'ready' ? image.totalBytes : image.receivedBytes) +
    (claude.state === 'ready' ? claude.totalBytes : claude.receivedBytes);
  const totalPct = overall === 'ready' ? 100 : totalBytes > 0 ? Math.min(99, Math.floor((gotBytes / totalBytes) * 100)) : 0;
  const usable = assetsReady();
  const upgradeAvailable = !r.active && (imageNeedsUpgrade() || claudeNeedsUpgrade());
  return { image, claude, overall, totalPct, usable, upgradeAvailable };
}

/** 已有 .part 前缀重新灌进哈希(断点续传的校验连续性)。 */
async function hashExisting(file: string, hash: crypto.Hash): Promise<number> {
  if (!fs.existsSync(file)) return 0;
  const size = fs.statSync(file).size;
  if (size === 0) return 0;
  await pipeline(fs.createReadStream(file), async (source) => {
    for await (const chunk of source) hash.update(chunk as Buffer);
  });
  return size;
}

/**
 * 单文件下载(多源顺序 failover + Range 续传 + sha512 流式校验)。
 * expectedSha512 为空时跳过哈希比对(claude 走 registry integrity 单独校验)。
 * onBytes 每块回调累计字节。
 */
async function downloadToPart(opts: {
  urls: string[];
  partPath: string;
  expectedSize?: number;
  expectedSha512?: string;
  signal: AbortSignal;
  onBytes: (received: number, total: number) => void;
}): Promise<void> {
  const { urls, partPath, expectedSize, expectedSha512, signal, onBytes } = opts;
  fs.mkdirSync(path.dirname(partPath), { recursive: true });
  let lastErr: unknown = null;
  for (const url of urls) {
    try {
      const hash = crypto.createHash('sha512');
      const offset = await hashExisting(partPath, hash);
      const headers: Record<string, string> = {};
      if (offset > 0) headers.Range = `bytes=${offset}-`;
      const res = await fetch(url, { headers, signal });
      if (res.status === 200 && offset > 0) {
        // 源不支持 Range → 从零重来(重置文件;先取消未消费的响应体防连接悬挂)
        await res.body?.cancel().catch(() => { /* ignore */ });
        fs.truncateSync(partPath, 0);
        return await downloadToPart({ ...opts, urls: [url] });
      }
      if (res.status !== 200 && res.status !== 206) {
        throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      }
      const lenHeader = res.headers.get('content-length');
      const total = expectedSize ?? (lenHeader ? offset + Number(lenHeader) : 0);
      if (!res.body) throw new Error('empty response body');
      const ws = fs.createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' });
      let received = offset;
      await pipeline(
        Readable.fromWeb(res.body as import('stream/web').ReadableStream),
        async function* (source) {
          for await (const chunk of source) {
            hash.update(chunk as Buffer);
            received += (chunk as Buffer).length;
            onBytes(received, total);
            yield chunk;
          }
        },
        ws,
      );
      if (expectedSize && received !== expectedSize) {
        throw new Error(`size mismatch: got ${received}, expected ${expectedSize}`);
      }
      if (expectedSha512) {
        const actual = hash.digest('hex');
        if (actual !== expectedSha512) {
          // 校验失败的 .part 是脏数据,删掉防止死循环续传
          fs.rmSync(partPath, { force: true });
          throw new Error('checksum mismatch (corrupted download removed, please retry)');
        }
      }
      return;
    } catch (err) {
      if (signal.aborted) throw new Error('cancelled');
      lastErr = err;
      console.warn(`[cowork-assets] source failed (${url}):`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** registry 元数据取 integrity(sha512-<b64>)与 tarball 体积。 */
async function fetchClaudeDist(signal: AbortSignal): Promise<{ sha512Hex: string; size: number }> {
  let lastErr: unknown = null;
  for (const reg of CLAUDE_REGISTRIES) {
    try {
      const res = await fetch(claudeMetadataUrl(reg), { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = (await res.json()) as { dist?: { integrity?: string; size?: number } };
      const integrity = meta.dist?.integrity || '';
      const m = integrity.match(/^sha512-(.+)$/);
      if (!m) throw new Error('registry metadata missing sha512 integrity');
      return { sha512Hex: Buffer.from(m[1], 'base64').toString('hex'), size: meta.dist?.size || 0 };
    } catch (err) {
      if (signal.aborted) throw new Error('cancelled');
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function extractClaude(tgzPath: string): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-claude-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn('tar', ['-xzf', tgzPath, '-C', tmp, 'package/claude'], { stdio: 'ignore' });
      p.once('error', reject);
      p.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
    });
    const extracted = path.join(tmp, 'package', 'claude');
    if (!fs.existsSync(extracted)) throw new Error('package/claude not found in tarball');
    fs.mkdirSync(path.dirname(CLAUDE_BIN_PATH), { recursive: true });
    fs.chmodSync(extracted, 0o755);
    // 跨设备安全:同卷 rename;tmpdir 与 home 不同卷时退化为 copy+rename
    try {
      fs.renameSync(extracted, CLAUDE_BIN_PATH);
    } catch {
      fs.copyFileSync(extracted, CLAUDE_BIN_PATH + '.part');
      fs.chmodSync(CLAUDE_BIN_PATH + '.part', 0o755);
      fs.renameSync(CLAUDE_BIN_PATH + '.part', CLAUDE_BIN_PATH);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tgzPath, { force: true });
  }
}

/** 下载前磁盘预检:返回 null=通过,否则为缺口描述(GiB)。 */
export function preflightDiskSpace(): string | null {
  let free = Number.POSITIVE_INFINITY;
  try {
    const st = fs.statfsSync(os.homedir());
    free = st.bsize * st.bavail;
  } catch {
    return null; // 探测不了就放行,下载写盘失败自会报错
  }
  let need = PREFLIGHT_MARGIN;
  if (!fs.existsSync(IMAGE_PATH) || imageNeedsUpgrade()) {
    const partPath = path.join(IMAGES_DIR, IMAGE_FILENAME + '.part');
    const have = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    need += Math.max(0, IMAGE_SIZE - have);
  }
  if (!fs.existsSync(CLAUDE_BIN_PATH) || claudeNeedsUpgrade()) need += CLAUDE_TGZ_ESTIMATE;
  if (free < need) {
    const needGiB = (need / 1024 ** 3).toFixed(1);
    const freeGiB = (free / 1024 ** 3).toFixed(1);
    return `disk_space: need ~${needGiB} GiB free, only ${freeGiB} GiB available`;
  }
  return null;
}

async function downloadImage(r: AssetsRuntime, signal: AbortSignal, upgrade: boolean): Promise<void> {
  if (fs.existsSync(IMAGE_PATH) && !upgrade) { r.image.state = 'ready'; return; }
  const partPath = path.join(IMAGES_DIR, IMAGE_FILENAME + '.part');
  r.image = { state: 'downloading', receivedBytes: 0, totalBytes: IMAGE_SIZE };
  await downloadToPart({
    urls: IMAGE_URLS,
    partPath,
    expectedSize: IMAGE_SIZE,
    expectedSha512: IMAGE_SHA512,
    signal,
    onBytes: (received) => { r.image.receivedBytes = received; },
  });
  r.image.state = 'verifying'; // 哈希在流式中完成;此处只剩落位
  if (upgrade) {
    // 换盘窗口:停 VM(办公回合下条消息自动重建)+ 重置 EFI 变量(新盘新身份);
    // 旧盘被 rename 原子覆盖即隐式 GC,guest 内旧会话目录随盘消失(产物列表
    // 由既有的在线对账/回合末快照自愈)。
    const { stop } = await import('./cowork-vm-manager');
    await stop();
    try { fs.rmSync(EFI_STORE_PATH, { force: true }); } catch { /* ignore */ }
    console.log('[cowork-assets] image upgrade: VM stopped, EFI store reset');
  }
  fs.renameSync(partPath, IMAGE_PATH);
  // 稀疏扩容:APFS 零成本,guest 首启 growpart 吃满(M2 起新下的盘 workspace 更大)
  try { fs.truncateSync(IMAGE_PATH, IMAGE_SPARSE_SIZE); } catch { /* 失败不致命,3GiB 也能用 */ }
  writeJsonMarker(IMAGE_MARKER_PATH, { build: IMAGE_BUILD, sha512: IMAGE_SHA512, stampedBy: 'download' });
  r.image.state = 'ready';
  r.image.receivedBytes = IMAGE_SIZE;
  console.log('[cowork-assets] image installed:', IMAGE_PATH);
}

async function downloadClaude(r: AssetsRuntime, signal: AbortSignal, upgrade: boolean): Promise<void> {
  if (fs.existsSync(CLAUDE_BIN_PATH) && !upgrade) { r.claude.state = 'ready'; return; }
  r.claude = { state: 'downloading', receivedBytes: 0, totalBytes: 0 };
  const dist = await fetchClaudeDist(signal);
  r.claude.totalBytes = dist.size;
  const tgzPath = path.join(COWORK_ROOT, 'bin', `claude-${CLAUDE_SDK_VERSION}.tgz.part`);
  await downloadToPart({
    urls: CLAUDE_REGISTRIES.map(claudeTarballUrl),
    partPath: tgzPath,
    expectedSize: dist.size || undefined,
    expectedSha512: dist.sha512Hex,
    signal,
    onBytes: (received, total) => {
      r.claude.receivedBytes = received;
      if (!r.claude.totalBytes && total) r.claude.totalBytes = total;
    },
  });
  r.claude.state = 'installing';
  await extractClaude(tgzPath); // rename 原子覆盖旧 binary;guest 侧偏斜由 daemon v3 claudeSize 自愈
  writeJsonMarker(CLAUDE_MARKER_PATH, { version: CLAUDE_SDK_VERSION, stampedBy: 'download' });
  r.claude.state = 'ready';
  console.log('[cowork-assets] claude binary installed:', CLAUDE_BIN_PATH);
}

/**
 * 开始下载缺失资产(显式触发,幂等:进行中调用直接返回当前状态)。
 * fire-and-forget:立即返回状态,进度经 getAssetsStatus() 轮询。
 */
export function startAssetsDownload(): AssetsStatus {
  const r = runtime();
  if (r.active) return getAssetsStatus();
  const upgradeImage = imageNeedsUpgrade();
  const upgradeClaude = claudeNeedsUpgrade();
  if (assetsReady() && !upgradeImage && !upgradeClaude) return getAssetsStatus();
  const spaceErr = preflightDiskSpace();
  if (spaceErr) {
    if (!fs.existsSync(IMAGE_PATH) || upgradeImage) r.image = { ...r.image, state: 'failed', error: spaceErr };
    if (!fs.existsSync(CLAUDE_BIN_PATH) || upgradeClaude) r.claude = { ...r.claude, state: 'failed', error: spaceErr };
    return getAssetsStatus();
  }
  r.active = true;
  r.abort = new AbortController();
  const signal = r.abort.signal;
  void (async () => {
    const tasks: Array<Promise<void>> = [];
    tasks.push(
      downloadImage(r, signal, upgradeImage).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        r.image = { ...r.image, state: msg === 'cancelled' ? 'missing' : 'failed', error: msg === 'cancelled' ? undefined : msg };
      }),
    );
    tasks.push(
      downloadClaude(r, signal, upgradeClaude).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        r.claude = { ...r.claude, state: msg === 'cancelled' ? 'missing' : 'failed', error: msg === 'cancelled' ? undefined : msg };
      }),
    );
    await Promise.all(tasks);
    r.active = false;
    r.abort = null;
    console.log('[cowork-assets] download round finished:', JSON.stringify(getAssetsStatus().overall));
  })();
  return getAssetsStatus();
}

/** 取消当前下载(保留 .part,下次开始自动续传)。 */
export function cancelAssetsDownload(): AssetsStatus {
  const r = runtime();
  r.abort?.abort();
  return getAssetsStatus();
}
