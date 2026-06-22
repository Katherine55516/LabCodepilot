import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Execution-step evidence collection (ported from ai-lab-test-framework runner.js).
 *
 * During execution the AI drives Playwright and captures screenshots/videos per
 * case. We want them all to land in AI_LabTest/report/_evidence/{task}-{env}/ with
 * sane names, so the report can reference them. Three mechanisms (the framework's):
 *   1. MCP launcher shim — chdir the MCP process to the evidence dir before loading
 *      the CLI, so relative-named writes land there (stdio MCP can't take a `cwd`).
 *   2. sweepStrayEvidence — after the run, move evidence-shaped files created this
 *      run from the project root / report top-level INTO the evidence dir.
 *   3. normalizeEvidenceExt — give extension-less files a real ext via magic-number.
 *
 * sweep/normalize/sniff are pure fs functions — unit-tested in
 * src/__tests__/unit/test-evidence.test.ts. (The shim's chdir effect only proves
 * out on a real browser run.)
 */

/** Magic-number sniff → image/video extension, or null if unknown. */
export function sniffExt(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'; // EBML/Matroska
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  return null;
}

// A file is "evidence-shaped" if it has a media ext or a TC- case-id prefix.
const MEDIA_EXT_RE = /\.(png|jpe?g|webm|gif)$/i;
function isEvidenceName(name: string): boolean {
  return MEDIA_EXT_RE.test(name) || /^TC-/i.test(name);
}

/**
 * Move stray evidence files created during THIS run from `dirs` into `evidenceDir`.
 * @param dirs        directories to sweep (e.g. project root, AI_LabTest/report)
 * @param evidenceDir absolute destination dir
 * @param sinceMs     only files with mtime ≥ this (the run's start) are swept
 * @returns absolute paths of moved files
 */
export function sweepStrayEvidence(opts: { dirs: string[]; evidenceDir: string; sinceMs: number }): string[] {
  const moved: string[] = [];
  try { fs.mkdirSync(opts.evidenceDir, { recursive: true }); } catch { return moved; }
  const evidenceResolved = path.resolve(opts.evidenceDir);
  for (const dir of opts.dirs) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !isEvidenceName(e.name)) continue;
      const src = path.join(dir, e.name);
      if (path.resolve(src) === path.resolve(path.join(opts.evidenceDir, e.name))) continue; // already there
      let st: fs.Stats;
      try { st = fs.statSync(src); } catch { continue; }
      if (st.mtimeMs < opts.sinceMs) continue; // not from this run
      // never sweep the evidence dir into itself
      if (path.resolve(dir) === evidenceResolved) continue;
      const dest = path.join(opts.evidenceDir, e.name);
      try { fs.renameSync(src, dest); moved.push(dest); } catch { /* skip locked/failed */ }
    }
  }
  return moved;
}

/** Append a magic-number-sniffed extension to extension-less files in `dir`. */
export function normalizeEvidenceExt(dir: string): string[] {
  const fixed: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return fixed; }
  for (const e of entries) {
    if (!e.isFile() || path.extname(e.name)) continue; // already has an extension
    const src = path.join(dir, e.name);
    let buf: Buffer;
    try { buf = fs.readFileSync(src); } catch { continue; }
    const ext = sniffExt(buf);
    if (!ext) continue;
    const dest = `${src}.${ext}`;
    try { fs.renameSync(src, dest); fixed.push(dest); } catch { /* skip */ }
  }
  return fixed;
}

// Shim that chdir's to the evidence dir, then loads the real Playwright MCP CLI.
// (Agent SDK stdio MCP servers can't take a `cwd`, so we wrap the launch.)
const MCP_LAUNCHER_SRC = [
  '// AI_LabTest 自动生成：Playwright MCP 启动垫片（chdir 到证据目录后加载 CLI），可安全删除。',
  'try { process.chdir(process.env.AILAB_MCP_CWD); } catch {}',
  'const cli = process.env.AILAB_MCP_CLI;',
  'process.argv.splice(1, 1, cli); // argv[1]=垫片路径 → 换成 cli 路径，其余 MCP 参数原样后随',
  'require(cli);',
  '',
].join('\n');

/** Write the MCP launcher shim to a temp file; returns its path. */
export function writeMcpLauncherShim(): string {
  const shimPath = path.join(os.tmpdir(), 'ailab-mcp-launcher.cjs');
  fs.writeFileSync(shimPath, MCP_LAUNCHER_SRC, 'utf-8');
  return shimPath;
}
