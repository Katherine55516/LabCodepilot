/**
 * Installer downloader + avoid-redownload + sha256 verification + pending state.
 *
 * Design inlined from the sibling project (exec-plan §7.1):
 *   - 固定文件名落 app.getPath('temp')（同版本同路径 → 复用前提）
 *   - 三层避免重下：① 固定名 ② 同名文件 hash 复用 ③ pending-update.json 跨会话
 *   - sha256 三处校验；{final}.{pid}.tmp 原子 rename，半截文件永不复用
 *   - 用 Electron net（跟随 30x 重定向 + 走 session 代理）流式下载，按 file_size 推进度
 *
 * pending-update.json 落在 getAnlcodeDir()（与登录 session_token/configs 同目录）。
 */

import { app, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getAnlcodeDir } from '../auth/paths';
import { logInfo, logWarn } from '../auth/log';

/** Cross-session record of a downloaded-and-verified installer. */
export interface PendingUpdate {
  version: string;
  filePath: string;
  sha256: string;
  fileSize: number;
  mustUpgrade: boolean;
  downloadUrl: string;
  releaseNotes: string;
  releaseDate: string;
}

export type ProgressCallback = (transferred: number, total: number) => void;

const PENDING_FILE = 'pending-update.json';

/** Stable local installer filename per platform + version (enables reuse). */
export function installerFileName(version: string): string {
  if (process.platform === 'win32') return `AI-Native-Lab-Setup-${version}.exe`;
  return `AI-Native-Lab-Update-${version}.dmg`;
}

export function installerPath(version: string): string {
  return path.join(app.getPath('temp'), installerFileName(version));
}

/** Stream-compute the SHA-256 (hex) of a file. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function hexEq(a: string, b: string): boolean {
  return (a || '').toLowerCase() === (b || '').toLowerCase();
}

/**
 * Download `url` → `destPath`, computing sha256 + byte count as it streams.
 * Electron `net` follows 30x redirects and honours the session proxy.
 */
function downloadToFile(
  url: string,
  destPath: string,
  expectedSize: number,
  onProgress?: ProgressCallback,
): Promise<{ sha256: string; size: number }> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);
    const hash = crypto.createHash('sha256');
    let received = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try { fileStream.destroy(); } catch { /* ignore */ }
      reject(err);
    };

    const request = net.request(url);
    request.on('response', (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 400) {
        fail(new Error(`download HTTP ${status}`));
        return;
      }
      const r = response as unknown as NodeJS.ReadableStream;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        hash.update(chunk);
        const ok = fileStream.write(chunk);
        if (expectedSize > 0 && onProgress) onProgress(received, expectedSize);
        // Backpressure: pause the response until the file stream drains.
        if (!ok) {
          r.pause();
          fileStream.once('drain', () => { try { r.resume(); } catch { /* ignore */ } });
        }
      });
      response.on('end', () => {
        if (settled) return;
        fileStream.end(() => {
          settled = true;
          resolve({ sha256: hash.digest('hex'), size: received });
        });
      });
      response.on('error', (e: Error) => fail(e));
    });
    request.on('error', (e: Error) => fail(e));
    request.end();
  });
}

/**
 * Ensure the installer for `pending` is present and verified locally, reusing an
 * existing same-hash file when possible. Returns the verified final path.
 * Throws 'sha256-mismatch' / 'size-mismatch' / download errors (file removed).
 */
export async function ensureInstaller(pending: PendingUpdate, onProgress?: ProgressCallback): Promise<string> {
  const dest = pending.filePath;

  // Layer 2: reuse an existing same-name file if its hash matches the server's.
  if (fs.existsSync(dest)) {
    try {
      const existing = await sha256File(dest);
      if (hexEq(existing, pending.sha256)) {
        if (pending.fileSize > 0 && onProgress) onProgress(pending.fileSize, pending.fileSize);
        logInfo(`[updater] reuse existing installer ${path.basename(dest)}`);
        return dest;
      }
    } catch { /* fall through to re-download */ }
    await fs.promises.unlink(dest).catch(() => {});
  }

  // Download to a pid-scoped tmp, verify sha256 + size, then atomic rename.
  const tmp = `${dest}.${process.pid}.tmp`;
  await fs.promises.unlink(tmp).catch(() => {});
  const { sha256, size } = await downloadToFile(pending.downloadUrl, tmp, pending.fileSize, onProgress);

  if (!hexEq(sha256, pending.sha256)) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw new Error('sha256-mismatch');
  }
  if (pending.fileSize > 0 && size !== pending.fileSize) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw new Error('size-mismatch');
  }

  await fs.promises.rename(tmp, dest);
  logInfo(`[updater] downloaded + verified ${path.basename(dest)} (${size} bytes)`);
  return dest;
}

// ── pending-update.json (cross-session reuse) ──────────────────────────────

function pendingFilePath(): string {
  return path.join(getAnlcodeDir(), PENDING_FILE);
}

export function writePending(p: PendingUpdate): void {
  try {
    fs.writeFileSync(pendingFilePath(), JSON.stringify(p, null, 2), 'utf-8');
  } catch (e) {
    logWarn(`[updater] writePending failed: ${(e as Error).message}`);
  }
}

export function readPending(): PendingUpdate | null {
  try {
    const raw = fs.readFileSync(pendingFilePath(), 'utf-8');
    const p = JSON.parse(raw) as Partial<PendingUpdate>;
    if (p && typeof p.version === 'string' && typeof p.filePath === 'string' && typeof p.sha256 === 'string') {
      return {
        version: p.version,
        filePath: p.filePath,
        sha256: p.sha256,
        fileSize: typeof p.fileSize === 'number' ? p.fileSize : 0,
        mustUpgrade: p.mustUpgrade === true,
        downloadUrl: typeof p.downloadUrl === 'string' ? p.downloadUrl : '',
        releaseNotes: typeof p.releaseNotes === 'string' ? p.releaseNotes : '',
        releaseDate: typeof p.releaseDate === 'string' ? p.releaseDate : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try { fs.unlinkSync(pendingFilePath()); } catch { /* ignore */ }
}

/** Best-effort delete of a downloaded installer file. */
export function deleteInstallerFile(filePath: string): void {
  try { if (filePath) fs.unlinkSync(filePath); } catch { /* ignore */ }
}
