import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import iconv from 'iconv-lite';
import {
  FileIOError,
  assertNoSymlinkInChain,
  assertRealPathInBase,
  assertWritablePath,
  isValidFilename,
} from '@/lib/files';
import type { ErrorResponse } from '@/types';

/*
 * POST /api/files/write — write a file (create or overwrite) with full
 * path-safety enforcement. See docs/exec-plans/active/markdown-artifact-overhaul.md
 * §4.1 for the design contract.
 *
 * Body:
 *   {
 *     path: string;              // absolute, or relative under baseDir
 *     baseDir?: string;          // scope cap; defaults to ~ (user home)
 *     content: string;           // text content (JSON string, i.e. UTF-16 in transit)
 *     encoding?: 'utf-8'|'gbk';  // on-disk encoding; default utf-8. Pass the
 *                                //   encoding reported by /api/files/preview so
 *                                //   GBK files are not silently transcoded.
 *     overwrite?: boolean;       // default false — 409 if target exists
 *     createParents?: boolean;   // default false — 404 if parent missing
 *   }
 *
 * Error codes (mapped to HTTP status by this route):
 *   path_unsafe (403), root_path (403), symlink_detected (403),
 *   blocked_directory (403), invalid_filename (400),
 *   already_exists (409), parent_not_exists (404), write_failed (500)
 */

interface WriteBody {
  path?: unknown;
  baseDir?: unknown;
  content?: unknown;
  encoding?: unknown;
  overwrite?: unknown;
  createParents?: unknown;
}

export async function POST(request: NextRequest) {
  let body: WriteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ErrorResponse>(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const filePath = typeof body.path === 'string' ? body.path : '';
  const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
  const content = typeof body.content === 'string' ? body.content : '';
  const overwrite = body.overwrite === true;
  const createParents = body.createParents === true;

  // Reject unknown encodings loudly instead of silently defaulting to
  // utf-8 — a typo'd value falling through would transcode the file.
  const encoding = typeof body.encoding === 'string' ? body.encoding.toLowerCase() : 'utf-8';
  if (encoding !== 'utf-8' && encoding !== 'gbk') {
    return NextResponse.json<ErrorResponse>(
      { error: `Unsupported encoding: ${String(body.encoding)}`, code: 'invalid_encoding' },
      { status: 400 },
    );
  }

  if (!filePath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path', code: 'invalid_filename' },
      { status: 400 },
    );
  }

  const resolvedPath = path.resolve(filePath);
  const basename = path.basename(resolvedPath);

  try {
    if (!isValidFilename(basename)) {
      throw new FileIOError('invalid_filename', `Invalid filename: ${basename}`);
    }
    assertWritablePath(resolvedPath, baseDir);
    await assertNoSymlinkInChain(path.dirname(resolvedPath));

    // Target-side check: symlinks refused, real path must live in real
    // baseDir. Unified helper so this path matches preview/mkdir/rename/
    // delete — no more per-route symlink drift.
    const realTarget = await assertRealPathInBase(resolvedPath, baseDir, {
      rejectIfSymlink: true,
      allowMissing: true,
    });
    const exists = realTarget !== null;
    if (exists && !overwrite) {
      throw new FileIOError('already_exists', `File already exists: ${filePath}`);
    }

    // Parent directory handling: if it doesn't exist, respect createParents.
    const parent = path.dirname(resolvedPath);
    try {
      await fs.access(parent);
    } catch {
      if (createParents) {
        // Parent creation is also subject to path safety — re-check each ancestor.
        assertWritablePath(parent, baseDir);
        await fs.mkdir(parent, { recursive: true });
      } else {
        throw new FileIOError('parent_not_exists', `Parent directory does not exist: ${parent}`);
      }
    }

    // Write in the caller-declared on-disk encoding so a GBK file edited
    // via the preview panel round-trips instead of flipping to UTF-8.
    // gb18030 codec: strict superset of GBK — byte-identical for the GBK
    // range, and chars outside it get valid 4-byte sequences, not '?'.
    let bytesWritten: number;
    if (encoding === 'gbk') {
      const encoded = iconv.encode(content, 'gb18030');
      await fs.writeFile(resolvedPath, encoded);
      bytesWritten = encoded.length;
    } else {
      await fs.writeFile(resolvedPath, content, { encoding: 'utf-8' });
      bytesWritten = Buffer.byteLength(content, 'utf-8');
    }

    return NextResponse.json({ path: resolvedPath, bytes_written: bytesWritten });
  } catch (error) {
    if (error instanceof FileIOError) {
      const status = codeToStatus(error.code);
      return NextResponse.json<ErrorResponse>(
        { error: error.message, code: error.code, ...error.meta },
        { status },
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Write failed' },
      { status: 500 },
    );
  }
}

function codeToStatus(code: string): number {
  switch (code) {
    case 'path_unsafe':
    case 'root_path':
    case 'symlink_detected':
    case 'blocked_directory':
      return 403;
    case 'invalid_filename':
      return 400;
    case 'already_exists':
      return 409;
    case 'parent_not_exists':
    case 'not_found':
      return 404;
    default:
      return 500;
  }
}
