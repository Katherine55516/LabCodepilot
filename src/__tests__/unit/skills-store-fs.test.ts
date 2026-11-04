/**
 * Unit tests for electron/skills-store-fs.ts — 技能市场（内部）解压与落位层。
 *
 * 用手工构造的 zip 字节流（stored 无压缩,含 UTF-8 flag 与 unix mode）驱动
 * 真实的 yauzl 解压循环,不依赖 python/外部 zip 工具。覆盖:
 * - 正常包解压（中文文件名/嵌套目录/目录条目）
 * - zip-slip（../ 与绝对路径）拒绝且不落盘
 * - symlink 条目拒绝
 * - replaceDirAtomic:全新落位 / 原子替换旧目录（旧内容清净、无 .bak 残留）
 *
 * Run with: npx tsx --test src/__tests__/unit/skills-store-fs.test.ts
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  extractZip,
  replaceDirAtomic,
  skillsRootDir,
  loadLedgerHealed,
  saveLedger,
} from '../../../electron/skills-store-fs';
import { LEDGER_BASENAME, LEDGER_VERSION, type Ledger } from '../../../electron/skills-store-core';

// ── 手工 zip 构造器（stored,无压缩）──────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntrySpec {
  name: string;
  data?: string;
  /** unix mode（如 0o120777 = symlink）;缺省普通文件 0o100644 / 目录 0o040755。 */
  mode?: number;
}

/** 极简 zip 写入器:local header + central directory + EOCD,全 stored。 */
function buildZip(specs: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const spec of specs) {
    const nameBuf = Buffer.from(spec.name, 'utf-8');
    const dataBuf = Buffer.from(spec.data ?? '', 'utf-8');
    const crc = crc32(dataBuf);
    const isDir = spec.name.endsWith('/');
    const mode = spec.mode ?? (isDir ? 0o040755 : 0o100644);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 flag
    lfh.writeUInt16LE(0, 8); // stored
    lfh.writeUInt16LE(0, 10); // time
    lfh.writeUInt16LE(0x21, 12); // date（非零任意合法值）
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(dataBuf.length, 18);
    lfh.writeUInt32LE(dataBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    locals.push(lfh, nameBuf, dataBuf);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE((3 << 8) | 20, 4); // made by unix
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0x21, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(dataBuf.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra len
    cdh.writeUInt16LE(0, 32); // comment len
    cdh.writeUInt16LE(0, 34); // disk
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE((mode << 16) >>> 0, 38); // external attrs:unix mode 高 16 位
    cdh.writeUInt32LE(offset, 42);
    centrals.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + dataBuf.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(specs.length, 8);
  eocd.writeUInt16LE(specs.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

// ── 测试脚手架 ───────────────────────────────────────────────────────────────

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-store-fs-test-'));
after(() => fs.rmSync(workRoot, { recursive: true, force: true }));

let seq = 0;
function scratch(): string {
  const dir = path.join(workRoot, `case-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeZip(specs: ZipEntrySpec[]): string {
  const p = path.join(workRoot, `fixture-${seq++}.zip`);
  fs.writeFileSync(p, buildZip(specs));
  return p;
}

// ── extractZip ───────────────────────────────────────────────────────────────

describe('extractZip', () => {
  it('extracts a normal skill package (nested dirs, chinese filenames, dir entries)', async () => {
    const zip = writeZip([
      { name: 'SKILL.md', data: '---\nname: pdf-toolkit\n---\n# 工具箱\n' },
      { name: 'scripts/', data: '' },
      { name: 'scripts/run.sh', data: '#!/bin/sh\necho ok\n' },
      { name: '参考资料/说明文档.md', data: '中文内容\n' },
      { name: 'a/b/c/deep.txt', data: 'deep\n' },
    ]);
    const dest = scratch();
    await extractZip(zip, dest);
    assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf-8').includes('工具箱'), true);
    assert.equal(fs.readFileSync(path.join(dest, 'scripts/run.sh'), 'utf-8').includes('echo ok'), true);
    assert.equal(fs.readFileSync(path.join(dest, '参考资料/说明文档.md'), 'utf-8'), '中文内容\n');
    assert.equal(fs.existsSync(path.join(dest, 'a/b/c/deep.txt')), true);
  });

  it('rejects ../ path traversal and writes nothing outside dest', async () => {
    const zip = writeZip([
      { name: 'ok.txt', data: 'fine' },
      { name: '../evil.txt', data: 'escaped' },
    ]);
    const dest = scratch();
    await assert.rejects(() => extractZip(zip, dest), /relative path|escape/i);
    assert.equal(fs.existsSync(path.join(path.dirname(dest), 'evil.txt')), false);
  });

  it('rejects absolute path entries', async () => {
    const zip = writeZip([{ name: '/tmp/evil-abs.txt', data: 'escaped' }]);
    const dest = scratch();
    await assert.rejects(() => extractZip(zip, dest), /absolute|escape/i);
  });

  it('rejects symlink entries via unix mode bits', async () => {
    const zip = writeZip([
      { name: 'link-to-passwd', data: '/etc/passwd', mode: 0o120777 },
      { name: 'SKILL.md', data: 'x' },
    ]);
    const dest = scratch();
    await assert.rejects(() => extractZip(zip, dest), /symlink/i);
    // 拒绝后不得把链接内容当普通文件落盘
    assert.equal(fs.existsSync(path.join(dest, 'link-to-passwd')), false);
  });

  it('rejects garbage that is not a zip', async () => {
    const p = path.join(workRoot, `fixture-${seq++}.zip`);
    fs.writeFileSync(p, 'this is not a zip at all');
    await assert.rejects(() => extractZip(p, scratch()));
  });
});

// ── replaceDirAtomic ─────────────────────────────────────────────────────────

describe('replaceDirAtomic', () => {
  it('moves a fresh dir into place when dest does not exist', () => {
    const src = scratch();
    fs.writeFileSync(path.join(src, 'SKILL.md'), 'v1');
    const dest = path.join(workRoot, `dest-${seq++}`);
    replaceDirAtomic(src, dest);
    assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf-8'), 'v1');
    assert.equal(fs.existsSync(src), false);
  });

  it('replaces an existing dir wholesale (old files gone, no .bak left behind)', () => {
    const dest = path.join(workRoot, `dest-${seq++}`);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'SKILL.md'), 'old');
    fs.writeFileSync(path.join(dest, 'stale.txt'), 'stale');

    const src = scratch();
    fs.writeFileSync(path.join(src, 'SKILL.md'), 'new');

    replaceDirAtomic(src, dest);
    assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf-8'), 'new');
    // 旧版本残留文件必须消失(整目录替换,不是覆盖合并)
    assert.equal(fs.existsSync(path.join(dest, 'stale.txt')), false);
    // 无备份目录残留
    const siblings = fs.readdirSync(path.dirname(dest));
    assert.equal(siblings.some((n) => n.startsWith(path.basename(dest) + '.bak-')), false);
  });
});

// ── 台账 fs 层(CODEPILOT_SKILLS_ROOT_OVERRIDE 注入临时安装根)──────────────────

describe('ledger fs (loadLedgerHealed / saveLedger)', () => {
  function withRoot<T>(fn: (root: string) => T): T {
    const root = path.join(workRoot, `skills-root-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    process.env.CODEPILOT_SKILLS_ROOT_OVERRIDE = root;
    try {
      return fn(root);
    } finally {
      delete process.env.CODEPILOT_SKILLS_ROOT_OVERRIDE;
    }
  }

  function entry(dirName: string) {
    return {
      slug: dirName,
      dirName,
      displayName: dirName,
      contentHash: 'h1',
      etag: '"h1"',
      downloadVersion: 1,
      installedAt: '2026-07-28T00:00:00Z',
    };
  }

  function installDir(root: string, dirName: string): void {
    fs.mkdirSync(path.join(root, dirName), { recursive: true });
    fs.writeFileSync(path.join(root, dirName, 'SKILL.md'), '---\nname: x\n---\n');
  }

  it('honors the root override and round-trips via real files (no .tmp residue)', () => {
    withRoot((root) => {
      assert.equal(skillsRootDir(), root);
      installDir(root, 'pdf-toolkit');
      const src: Ledger = { version: LEDGER_VERSION, skills: { ck1: entry('pdf-toolkit') } };
      saveLedger(src);
      assert.equal(fs.existsSync(path.join(root, LEDGER_BASENAME)), true);
      assert.equal(fs.existsSync(path.join(root, `${LEDGER_BASENAME}.tmp`)), false);
      const { ledger, removed } = loadLedgerHealed();
      assert.deepEqual(removed, []);
      assert.deepEqual(ledger, src);
    });
  });

  it('self-heals after「我的技能」-style deletion and persists the healed ledger', () => {
    withRoot((root) => {
      installDir(root, 'alive');
      installDir(root, 'doomed');
      saveLedger({ version: LEDGER_VERSION, skills: { ckA: entry('alive'), ckB: entry('doomed') } });

      // 模拟「我的技能」删除:整目录移除(修复后的 DELETE 语义)
      fs.rmSync(path.join(root, 'doomed'), { recursive: true, force: true });

      const first = loadLedgerHealed();
      assert.deepEqual(first.removed, ['ckB']);
      assert.deepEqual(Object.keys(first.ledger.skills), ['ckA']);
      // 自愈结果已回写磁盘:重读不再出现死条目
      const second = loadLedgerHealed();
      assert.deepEqual(second.removed, []);
      assert.deepEqual(Object.keys(second.ledger.skills), ['ckA']);
    });
  });

  it('treats a dir whose SKILL.md is gone as dead (legacy file-only deletion)', () => {
    withRoot((root) => {
      installDir(root, 'husk');
      saveLedger({ version: LEDGER_VERSION, skills: { ckH: entry('husk') } });
      fs.unlinkSync(path.join(root, 'husk', 'SKILL.md')); // 旧 DELETE 语义只删文件
      const { ledger, removed } = loadLedgerHealed();
      assert.deepEqual(removed, ['ckH']);
      assert.deepEqual(ledger.skills, {});
    });
  });

  it('survives a corrupt ledger file on disk', () => {
    withRoot((root) => {
      fs.writeFileSync(path.join(root, LEDGER_BASENAME), '{not json');
      const { ledger, removed } = loadLedgerHealed();
      assert.deepEqual(removed, []);
      assert.deepEqual(ledger, { version: LEDGER_VERSION, skills: {} });
    });
  });
});
