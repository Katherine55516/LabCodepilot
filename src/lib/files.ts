import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import os from 'os';
import iconv from 'iconv-lite';
import type { FileTreeNode, FilePreview, TextFileEncoding } from '@/types';

// User-requested whitelist for directories starting with `.` — these
// bypass BOTH the "skip hidden" filter in scanDirectoryRecursive AND the
// IGNORED_DIRS check below, so they appear and recurse normally in the
// file tree. `.planning` is a user working dir; `.git` lets users browse
// git internals (note: large repos can take time to expand on click since
// objects/ may contain tens of thousands of files); `.claude` holds the
// project's Claude config (settings.json, agents, commands, skills, hooks).
//
// IMPORTANT — display vs. write-protection differ per entry:
//   - `.git` is ALSO in BLOCKED_SEGMENTS (write-protected): users can browse
//     but cannot mkdir/write/delete/rename inside it, so repo state is safe.
//   - `.claude` is intentionally NOT in BLOCKED_SEGMENTS: it is user-authored
//     config meant to be edited, so it stays browsable AND editable.
const ALLOWED_HIDDEN_DIRS = new Set([
  '.planning',
  '.git',
  '.claude',
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  // '.git' removed — surfaced via ALLOWED_HIDDEN_DIRS above. Restore
  // this line if you want .git hidden from the file tree again.
  'dist',
  '.next',
  '__pycache__',
  '.cache',
  '.turbo',
  'coverage',
  '.output',
  'build',
]);

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  prisma: 'prisma',
  env: 'dotenv',
  lua: 'lua',
  r: 'r',
  php: 'php',
  dart: 'dart',
  zig: 'zig',
};

export function getFileLanguage(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return LANGUAGE_MAP[normalized] || 'plaintext';
}

export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

/**
 * Check if a path is a filesystem root (e.g., `/`, `C:\`, `D:\`).
 * Used to prevent using root as a baseDir for file browsing.
 */
export function isRootPath(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved === path.parse(resolved).root;
}

export async function scanDirectory(dir: string, depth: number = 3): Promise<FileTreeNode[]> {
  const resolvedDir = path.resolve(dir);

  // turbopackIgnore hints: every fs.* / createReadStream here takes a runtime
  // user-supplied path, so Turbopack's NFT can't statically resolve what's
  // touched. Without these, Turbopack conservatively pulls the whole project
  // into the route's NFT list (and surfaces it as "next.config.ts was
  // unexpectedly traced" warnings on `npm run build`).
  try {
    await fs.access(/*turbopackIgnore: true*/ resolvedDir);
  } catch {
    return [];
  }

  return scanDirectoryRecursive(resolvedDir, depth);
}

async function scanDirectoryRecursive(dir: string, depth: number): Promise<FileTreeNode[]> {
  if (depth <= 0) return [];

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  // Sort: directories first, then files, both alphabetically
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    // Skip hidden files/dirs (except .env* and the ALLOWED_HIDDEN_DIRS
    // whitelist defined at the top of this file).
    if (
      entry.name.startsWith('.') &&
      !entry.name.startsWith('.env') &&
      !ALLOWED_HIDDEN_DIRS.has(entry.name)
    ) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const children = await scanDirectoryRecursive(fullPath, depth - 1);
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).replace(/^\./, '');
      let size: number | undefined;
      try {
        const stat = await fs.stat(/*turbopackIgnore: true*/ fullPath);
        size = stat.size;
      } catch {
        // Skip files we can't stat
      }

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        size,
        extension: ext || undefined,
      });
    }
  }

  return nodes;
}

/**
 * Per-extension line caps for preview API.
 *
 * Code, prose (Markdown / text), and unknown files all use the generous
 * DEFAULT_LINE_CAP — the preview panel exists to read whole files, so a
 * multi-thousand-line source file must display in full, not get cut off at
 * the first screenful. Only bulk-data formats that are routinely enormous and
 * rarely read top-to-bottom (logs, delimited data) keep a tighter cap.
 *
 * Every cap is still bounded by ABSOLUTE_LINE_CEILING and BYTE_CEILING, which
 * are the real safety nets against pathologically large files.
 */
const EXTENSION_LINE_CAPS: Record<string, number> = {
  log: 10000,
  csv: 10000,
  tsv: 10000,
};

/**
 * Generous default — covers virtually every real source file. Was 1000, which
 * cut code previews off mid-file (everything past line 1000 was invisible in
 * the preview panel). Raised so code files display completely; the absolute
 * ceiling + byte ceiling below still guard against pathological inputs.
 */
const DEFAULT_LINE_CAP = 50000;

/** Hard ceiling — no preview can exceed this even if extension allows more. */
const ABSOLUTE_LINE_CEILING = 100000;

/** Single-file byte ceiling. Files larger than this return file_too_large. */
const BYTE_CEILING = 10 * 1024 * 1024;  // 10 MB

/** Number of bytes read for binary detection before committing to preview. */
const BINARY_DETECTION_SAMPLE = 4096;

/** Extension-free filenames (e.g. LICENSE, README) get default cap. */
function getLineCap(ext: string, userMax?: number): number {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  const extensionCap = EXTENSION_LINE_CAPS[normalized] ?? DEFAULT_LINE_CAP;
  const withUserMax = userMax ? Math.min(userMax, extensionCap) : extensionCap;
  return Math.min(withUserMax, ABSOLUTE_LINE_CEILING);
}

/**
 * Detect if a byte buffer is likely binary content.
 * Uses the classic heuristic: any NUL byte or >30% non-printable/non-whitespace
 * means the file is not safe to render as UTF-8 text.
 */
function looksBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let nonText = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0) return true;  // NUL byte → definitely binary
    // Printable ASCII + common whitespace (tab, LF, CR, FF)
    if (b === 9 || b === 10 || b === 12 || b === 13 || (b >= 32 && b <= 126)) continue;
    // High bytes could be multi-byte UTF-8; count them as "possibly non-text"
    if (b >= 128) continue;  // Treat as potential UTF-8 continuation
    nonText++;
  }
  return nonText / buf.length > 0.3;
}

/**
 * Validate that a byte sample is well-formed UTF-8 (lead-byte class +
 * continuation-byte check; overlong/surrogate pedantry intentionally
 * skipped — GBK text fails within a couple of bytes anyway).
 *
 * `allowTruncatedTail` tolerates one incomplete multi-byte sequence at the
 * very end of the sample: the fixed-size detection window can cut a
 * character in half, which must not misclassify the file as non-UTF-8.
 */
function isValidUtf8(buf: Buffer, allowTruncatedTail: boolean): boolean {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b <= 0x7f) { i++; continue; }
    let continuations: number;
    if ((b & 0xe0) === 0xc0) continuations = 1;
    else if ((b & 0xf0) === 0xe0) continuations = 2;
    else if ((b & 0xf8) === 0xf0) continuations = 3;
    else return false;
    if (i + continuations >= buf.length) return allowTruncatedTail;
    for (let j = 1; j <= continuations; j++) {
      if ((buf[i + j] & 0xc0) !== 0x80) return false;
    }
    i += continuations + 1;
  }
  return true;
}

/**
 * Detect the text encoding of a file from its leading byte sample.
 * Strategy: pure ASCII / valid UTF-8 (incl. BOM) → utf-8; anything with
 * high bytes that fails strict UTF-8 validation → gbk. GBK/GB2312 is the
 * dominant non-UTF-8 encoding for this app's user base; files in other
 * legacy encodings (Big5, Shift_JIS, Latin-1) will decode wrong either
 * way, so the misclassification does not regress them vs. the old
 * hardcoded-UTF-8 behavior.
 */
function detectEncoding(sample: Buffer, sampleIsWholeFile: boolean): TextFileEncoding {
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return 'utf-8';  // UTF-8 BOM
  }
  let hasHighBytes = false;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] >= 0x80) { hasHighBytes = true; break; }
  }
  if (!hasHighBytes) return 'utf-8';  // pure ASCII
  return isValidUtf8(sample, !sampleIsWholeFile) ? 'utf-8' : 'gbk';
}

/**
 * Structured errors thrown by readFilePreview. The API route maps these to
 * HTTP status codes + error codes so callers can branch on the kind.
 */
export class FilePreviewError extends Error {
  constructor(public code: 'not_found' | 'not_a_file' | 'file_too_large' | 'binary_not_previewable' | 'read_failed', message: string, public meta?: Record<string, unknown>) {
    super(message);
    this.name = 'FilePreviewError';
  }
}

// ---------------------------------------------------------------------------
// File I/O helpers shared by write / mkdir / rename / delete API routes.
// Kept here so every write path enforces the same path-safety contract —
// callers cannot accidentally create an "almost the same" validator that
// misses a bypass.
// ---------------------------------------------------------------------------

/**
 * Directory/file names that must never be written, renamed, moved to, or
 * deleted through the file I/O API. The check runs against every path
 * segment so e.g. `foo/.git/bar` is also rejected, not just top-level .git.
 *
 * `.env*` is matched by prefix in `isBlockedPath`; everything else is an
 * exact basename match.
 */
const BLOCKED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.cache',
  // macOS system dirs
  'Library',
  'System',
  // Windows reserved dirs
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'System32',
]);

/** Filenames Windows refuses (reserved device names, case-insensitive). */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

export type FileIOErrorCode =
  | 'path_unsafe'
  | 'root_path'
  | 'symlink_detected'
  | 'blocked_directory'
  | 'already_exists'
  | 'not_found'
  | 'parent_not_exists'
  | 'not_a_file'
  | 'not_a_directory'
  | 'dir_not_empty'
  | 'cross_base_dir'
  | 'trash_unavailable'
  | 'invalid_filename'
  | 'write_failed';

/**
 * Structured errors thrown by the file I/O API helpers (write / mkdir /
 * rename / delete). The API routes map `.code` to appropriate HTTP status
 * codes (400 / 403 / 404 / 409 / 500) and surface the i18n-keyed messages
 * to the client.
 */
export class FileIOError extends Error {
  constructor(
    public code: FileIOErrorCode,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FileIOError';
  }
}

/**
 * Returns true if any segment of the resolved path matches our blocked
 * directory set (exact match) OR starts with `.env` (covers .env, .env.local,
 * .env.production etc.). The check intentionally runs on the *resolved*
 * path so `./../.git` is caught after normalization.
 */
export function isBlockedPath(resolvedPath: string): boolean {
  const segments = resolvedPath.split(path.sep).filter(Boolean);
  return segments.some(
    (seg) => BLOCKED_SEGMENTS.has(seg) || seg.startsWith('.env'),
  );
}

/**
 * Reject filenames the OS or UX layer cannot handle safely: empty string,
 * Windows reserved device names, names containing NUL, or paths with
 * embedded directory separators (callers must pass names, not paths).
 *
 * This is stricter than strictly necessary on macOS/Linux but keeps the
 * cross-platform contract uniform.
 */
export function isValidFilename(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.includes('\0')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  const withoutExt = name.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED.has(withoutExt)) return false;
  return true;
}

/**
 * Assert that a resolved target path is safe to write/modify relative to
 * an optional baseDir. Throws FileIOError with a specific code the API
 * route can map to the right HTTP status — never returns a generic
 * "path unsafe" without detail, so the UI can show actionable messages.
 *
 * Throws for: root paths (`/`, `C:\`), blocked directories (.git, node_modules,
 * .env*, system dirs), paths that resolve outside `baseDir` (defaulting to
 * the user's home directory when `baseDir` is absent).
 */
export function assertWritablePath(resolvedPath: string, baseDir?: string): void {
  if (isRootPath(resolvedPath)) {
    throw new FileIOError('root_path', `Refusing to operate on filesystem root: ${resolvedPath}`);
  }
  if (isBlockedPath(resolvedPath)) {
    throw new FileIOError(
      'blocked_directory',
      `Path is inside a protected directory: ${resolvedPath}`,
    );
  }
  const base = baseDir ? path.resolve(baseDir) : os.homedir();
  if (!isPathSafe(base, resolvedPath)) {
    throw new FileIOError(
      'path_unsafe',
      `Path escapes base directory: ${resolvedPath} (base ${base})`,
    );
  }
}

/**
 * Walk the path chain and throw if any segment is a symlink. This prevents
 * attackers from tricking the API into writing through a symlink pointing
 * outside `baseDir` (TOCTOU-resistant to a reasonable degree — a racing
 * attacker could still swap a segment after check, but covers the common case).
 *
 * Caller is responsible for resolving path before calling.
 */
/**
 * Verify the *real* target of `resolvedPath` still lives under the real
 * `baseDir`. This covers the symlink-escape class of bugs that plain
 * `isPathSafe` misses, because the textual path can stay inside baseDir
 * while the symlink it points to sits outside.
 *
 * Both the target and the base are `realpath`'d so the check is
 * resilient when the *workspace itself* is a symlink (common on macOS
 * project folders placed inside ~/Library symlinks etc.) — without the
 * base-side realpath, legitimate workspace reads get falsely flagged.
 *
 * Returns the resolved real target. Callers that still want to read
 * via the original path should do so (the file system will walk the
 * same link chain anyway); the return value is mainly for logging /
 * response payloads.
 *
 * Throws FileIOError with code `path_unsafe` on escape, `symlink_detected`
 * if `rejectIfSymlink` is true and the target is a symlink, or
 * `not_found` when target doesn't exist and `allowMissing` isn't set.
 */
export async function assertRealPathInBase(
  resolvedPath: string,
  baseDir: string | undefined,
  opts: { rejectIfSymlink?: boolean; allowMissing?: boolean } = {},
): Promise<string | null> {
  const base = baseDir ? path.resolve(baseDir) : os.homedir();
  let realBase: string;
  try {
    realBase = await fs.realpath(base);
  } catch {
    // Base dir not existing shouldn't bring the whole check down;
    // fall back to the textual base so the downstream isPathSafe
    // still rejects anything obviously outside.
    realBase = base;
  }

  // When rejectIfSymlink is set we also need to know whether the target
  // itself is a symlink (distinct from whether any parent is). lstat
  // doesn't follow the final link, so we can inspect that first.
  if (opts.rejectIfSymlink) {
    try {
      const linkStat = await fs.lstat(resolvedPath);
      if (linkStat.isSymbolicLink()) {
        throw new FileIOError(
          'symlink_detected',
          `Refusing to operate on a symlink: ${resolvedPath}`,
        );
      }
    } catch (err) {
      if (err instanceof FileIOError) throw err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw new FileIOError('write_failed', `lstat failed: ${String(err)}`);
      }
      // ENOENT: target doesn't exist yet. If allowMissing, continue; else
      // bail out as not_found below.
      if (!opts.allowMissing) {
        throw new FileIOError('not_found', `Path does not exist: ${resolvedPath}`);
      }
      return null;
    }
  }

  let realTarget: string;
  try {
    realTarget = await fs.realpath(resolvedPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      if (opts.allowMissing) return null;
      throw new FileIOError('not_found', `Path does not exist: ${resolvedPath}`);
    }
    throw new FileIOError('write_failed', `realpath failed: ${String(err)}`);
  }

  if (!isPathSafe(realBase, realTarget)) {
    throw new FileIOError(
      'path_unsafe',
      `Real path escapes base directory: real=${realTarget} realBase=${realBase}`,
      { realTarget, realBase },
    );
  }

  return realTarget;
}

export async function assertNoSymlinkInChain(resolvedPath: string): Promise<void> {
  let cursor = resolvedPath;
  while (cursor && cursor !== path.parse(cursor).root) {
    try {
      const stat = await fs.lstat(/*turbopackIgnore: true*/ cursor);
      if (stat.isSymbolicLink()) {
        throw new FileIOError(
          'symlink_detected',
          `Path contains a symlink: ${cursor}`,
        );
      }
    } catch (err) {
      if (err instanceof FileIOError) throw err;
      // ENOENT for not-yet-created paths is fine — the final write will
      // create it, and its parent has already been walked.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw new FileIOError('write_failed', `Failed to lstat ${cursor}: ${String(err)}`);
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export async function readFilePreview(filePath: string, userMaxLines?: number): Promise<FilePreview> {
  const resolvedPath = path.resolve(filePath);

  // Same turbopackIgnore rationale as scanDirectory — runtime-dynamic path.
  try {
    await fs.access(/*turbopackIgnore: true*/ resolvedPath);
  } catch {
    throw new FilePreviewError('not_found', `File not found: ${filePath}`);
  }

  const stat = await fs.stat(/*turbopackIgnore: true*/ resolvedPath);
  if (!stat.isFile()) {
    throw new FilePreviewError('not_a_file', `Not a file: ${filePath}`);
  }

  const bytesTotal = stat.size;

  // Guard 1: hard byte ceiling. Refuse before opening the stream to avoid
  // wasting memory on files beyond what any UI can usefully display.
  if (bytesTotal > BYTE_CEILING) {
    throw new FilePreviewError(
      'file_too_large',
      `File too large to preview: ${bytesTotal} bytes (limit ${BYTE_CEILING})`,
      { bytes_total: bytesTotal, byte_limit: BYTE_CEILING },
    );
  }

  // Guard 2: binary detection on the first 4KB. Must run before we commit to
  // UTF-8 stream decoding; otherwise binary files produce garbage + may throw
  // deep inside createInterface. The same sample doubles as the encoding
  // detection window: GBK high-byte pairs pass looksBinary (both bytes are
  // ≥0x40 and NUL-free) but fail strict UTF-8 validation.
  let encoding: TextFileEncoding = 'utf-8';
  try {
    const fd = await fs.open(/*turbopackIgnore: true*/ resolvedPath, 'r');
    try {
      const sampleSize = Math.min(BINARY_DETECTION_SAMPLE, bytesTotal);
      const sample = Buffer.alloc(sampleSize);
      await fd.read(sample, 0, sampleSize, 0);
      if (looksBinary(sample)) {
        throw new FilePreviewError(
          'binary_not_previewable',
          `Binary file cannot be previewed: ${filePath}`,
          { bytes_total: bytesTotal },
        );
      }
      encoding = detectEncoding(sample, sampleSize === bytesTotal);
    } finally {
      await fd.close();
    }
  } catch (err) {
    if (err instanceof FilePreviewError) throw err;
    throw new FilePreviewError('read_failed', `Failed to sample file: ${String(err)}`);
  }

  const ext = path.extname(resolvedPath).replace(/^\./, '');
  const language = getFileLanguage(ext);
  const maxLines = getLineCap(ext, userMaxLines);

  // Stream-read only up to maxLines to avoid loading entire large files.
  let collectedLines: string[] = [];
  let scannedLineCount = 0;
  let hitLimit = false;

  if (encoding === 'gbk') {
    // Non-UTF-8 path: Node streams cannot decode GBK natively, and the
    // byte ceiling above already guarantees ≤10MB, so a whole-file read +
    // decode is affordable and far simpler than a hand-rolled streaming
    // decoder. gb18030 is a strict superset of GBK/GB2312 — identical for
    // the GBK range, and rare four-byte chars decode instead of breaking.
    let decoded: string;
    try {
      const raw = await fs.readFile(/*turbopackIgnore: true*/ resolvedPath);
      decoded = iconv.decode(raw, 'gb18030');
    } catch (err) {
      throw new FilePreviewError('read_failed', `Failed to read file: ${String(err)}`);
    }
    const allLines = decoded.split(/\r\n|\r|\n/);
    // split() yields a trailing '' when the text ends with a line
    // terminator; readline does not emit that phantom line — match it.
    if (allLines.length > 1 && (decoded.endsWith('\n') || decoded.endsWith('\r'))) {
      allLines.pop();
    }
    scannedLineCount = allLines.length;
    hitLimit = allLines.length > maxLines;
    collectedLines = hitLimit ? allLines.slice(0, maxLines) : allLines;
  } else {
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(/*turbopackIgnore: true*/ resolvedPath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        scannedLineCount++;
        if (collectedLines.length < maxLines) {
          collectedLines.push(line);
        } else {
          hitLimit = true;
          rl.close();
          stream.destroy();
        }
      });

      rl.on('close', () => resolve());
      rl.on('error', reject);
      stream.on('error', reject);
    });
  }

  // Whole-file (gbk) path counts every line, so the count is always exact.
  // The streaming path is exact only when it read to EOF; on early stop,
  // estimate total from size (heuristic: ~60 bytes/line).
  const estimatedTotalLines = Math.max(1, Math.ceil(bytesTotal / 60));
  const lineCountExact = encoding === 'gbk' || !hitLimit;
  const lineCount = lineCountExact
    ? scannedLineCount
    : Math.max(scannedLineCount, estimatedTotalLines);

  const content = collectedLines.join('\n');

  return {
    path: resolvedPath,
    content,
    language,
    encoding,
    line_count: lineCount,
    line_count_exact: lineCountExact,
    truncated: hitLimit,
    bytes_read: Buffer.byteLength(content, 'utf-8'),
    bytes_total: bytesTotal,
  };
}
