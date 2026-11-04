import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

/*
 * POST /api/files/reveal — reveal a file/folder in the OS file manager,
 * selecting/highlighting the item inside its parent folder.
 *
 * This is the browser/dev fallback for Electron's shell.showItemInFolder;
 * the packaged app prefers the IPC path (window.electronAPI.shell.
 * showItemInFolder) and only falls back here when it is unavailable.
 *
 *   macOS   → open -R <path>            (reveal + select in Finder)
 *   Windows → explorer /select,<path>   (reveal + select in Explorer)
 *   Linux   → xdg-open <parentDir>      (no standard "select"; open parent)
 *
 * Body: { path }
 *
 * Uses execFile (not exec) so the path is passed as a single argv entry —
 * no shell interpolation, so paths with spaces/quotes/metacharacters are
 * safe.
 */
export async function POST(req: NextRequest) {
  let target = '';
  try {
    const body = await req.json();
    target = typeof body?.path === 'string' ? body.path : '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!target) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const resolved = path.resolve(target);

  // Must exist — surface a clear 404 instead of silently launching the file
  // manager on a stale/deleted path.
  try {
    await fs.lstat(resolved);
  } catch {
    return NextResponse.json({ error: 'Path not found' }, { status: 404 });
  }

  const platform = process.platform;
  let file: string;
  let args: string[];
  if (platform === 'darwin') {
    file = 'open';
    args = ['-R', resolved];
  } else if (platform === 'win32') {
    // explorer.exe requires the comma-glued form "/select,<path>" as ONE argv
    // entry; it also exits with code 1 even on success, so we don't treat a
    // non-zero exit as failure below.
    file = 'explorer.exe';
    args = [`/select,${resolved}`];
  } else {
    // No portable "reveal + select" on Linux; open the containing directory.
    file = 'xdg-open';
    args = [path.dirname(resolved)];
  }

  return new Promise<NextResponse>((resolve) => {
    execFile(file, args, (err) => {
      // Windows explorer.exe returns exit code 1 on success — ignore it.
      if (err && !(platform === 'win32')) {
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      } else {
        resolve(NextResponse.json({ ok: true }));
      }
    });
  });
}
