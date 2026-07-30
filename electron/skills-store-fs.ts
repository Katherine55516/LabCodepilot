/**
 * 技能市场（内部）— 解压与目录落位层。只依赖 node 内建 + yauzl + core,
 * 不 import electron/auth,因此可被单测直接驱动（真实 zip 字节流,见
 * skills-store-fs.test.ts 的手工 zip 构造器）。上层胶水在 skills-store.ts。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';

import {
  LEDGER_BASENAME,
  MAX_ZIP_ENTRIES,
  MAX_UNCOMPRESSED_BYTES,
  isSymlinkEntry,
  entryPathIsContained,
  parseLedger,
  serializeLedger,
  healLedger,
  type Ledger,
} from './skills-store-core';

// ── 安装台账（fs 侧;纯逻辑在 core）──────────────────────────────────────────

/**
 * 安装根。CODEPILOT_SKILLS_ROOT_OVERRIDE 是单测注入口(真实主目录不可作
 * 测试靶场),生产不设。
 */
export function skillsRootDir(): string {
  const override = process.env.CODEPILOT_SKILLS_ROOT_OVERRIDE?.trim();
  return override || path.join(os.homedir(), '.claude', 'skills');
}

function ledgerPath(): string {
  return path.join(skillsRootDir(), LEDGER_BASENAME);
}

function hasSkillDir(dirName: string): boolean {
  return fs.existsSync(path.join(skillsRootDir(), dirName, 'SKILL.md'));
}

/**
 * 读台账并就地自愈:目录(或其 SKILL.md)已不存在的条目移除并回写 —
 * 用户从「我的技能」删除只动目录不动台账,靠这里兜底避免幽灵「已安装」。
 * removed 交调用方记日志(本层不依赖 electron 日志设施)。
 */
export function loadLedgerHealed(): { ledger: Ledger; removed: string[] } {
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(ledgerPath(), 'utf-8');
  } catch {
    raw = null;
  }
  const { ledger, removed } = healLedger(parseLedger(raw), hasSkillDir);
  if (removed.length > 0) {
    try {
      saveLedger(ledger);
    } catch {
      // 写失败不阻断读路径 — 下次再愈
    }
  }
  return { ledger, removed };
}

export function saveLedger(ledger: Ledger): void {
  const dir = skillsRootDir();
  fs.mkdirSync(dir, { recursive: true });
  // 临时文件 + rename,避免半写台账
  const tmp = path.join(dir, `${LEDGER_BASENAME}.tmp`);
  fs.writeFileSync(tmp, serializeLedger(ledger), 'utf-8');
  fs.renameSync(tmp, ledgerPath());
}

/**
 * yauzl 解压循环 + 守卫（方案 §8 安全清单）。守卫三重:yauzl 自带文件名校验
 * （拒 ../、绝对路径、反斜杠,POC 已验证）、core 的 symlink/路径围栏/
 * 条目数/解压后总量上限、目标写入前 mkdir 限定在 destDir 内。
 */
export function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('zip open failed'));
        return;
      }
      let entries = 0;
      let totalBytes = 0;
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        try {
          zipfile.close();
        } catch {
          // already closed
        }
        reject(e);
      };
      zipfile.on('error', fail);
      zipfile.on('entry', (entry) => {
        if (settled) return;
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) return fail(new Error('too many zip entries'));
        if (isSymlinkEntry(entry.externalFileAttributes)) {
          return fail(new Error(`symlink entry rejected: ${entry.fileName}`));
        }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
          return fail(new Error('uncompressed size cap exceeded'));
        }
        if (!entryPathIsContained(destDir, entry.fileName)) {
          return fail(new Error(`path escape rejected: ${entry.fileName}`));
        }
        const target = path.join(destDir, entry.fileName);
        if (entry.fileName.endsWith('/')) {
          try {
            fs.mkdirSync(target, { recursive: true });
          } catch (e) {
            return fail(e as Error);
          }
          zipfile.readEntry();
          return;
        }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
        } catch (e) {
          return fail(e as Error);
        }
        zipfile.openReadStream(entry, (err2, stream) => {
          if (settled) return;
          if (err2 || !stream) return fail(err2 ?? new Error('zip stream open failed'));
          const out = fs.createWriteStream(target);
          stream.on('error', fail);
          out.on('error', fail);
          out.on('close', () => {
            if (!settled) zipfile.readEntry();
          });
          stream.pipe(out);
        });
      });
      zipfile.on('end', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zipfile.readEntry();
    });
  });
}

/**
 * 原子替换目录:旧目录先挪备份位,新内容 rename 进场（跨卷 EXDEV 时退化为
 * cpSync),成功后删备份;任何一步失败回滚旧目录,不留半成品。
 */
export function replaceDirAtomic(srcDir: string, dest: string): void {
  const bak = `${dest}.bak-${process.pid}-${Date.now()}`;
  const hadOld = fs.existsSync(dest);
  if (hadOld) fs.renameSync(dest, bak);
  try {
    try {
      fs.renameSync(srcDir, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        fs.cpSync(srcDir, dest, { recursive: true });
      } else {
        throw e;
      }
    }
    if (hadOld) fs.rmSync(bak, { recursive: true, force: true });
  } catch (e) {
    if (hadOld && !fs.existsSync(dest)) {
      try {
        fs.renameSync(bak, dest);
      } catch {
        // 回滚失败:备份目录留在原地供人工恢复,不吞原始错误
      }
    }
    throw e;
  }
}
