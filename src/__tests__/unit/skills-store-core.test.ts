/**
 * Unit tests for electron/skills-store-core.ts — 技能市场（内部）纯逻辑核心。
 *
 * Pure module (no electron / fs), imported directly. Covers:
 * - parseHubFailure：契约 body 解析、401→not-logged-in、状态码兜底、
 *   Retry-After 提取、未知 code 原样透传
 * - 台账 parse/serialize 容错往返 + healLedger 自愈
 * - mergeInstallState：未装/已装/可更新/DEPRECATED 恒不更新
 * - resolveDirName：沿用/slug/后缀/耗尽四分支 + sanitize 防御
 * - zip 守卫：symlink 识别、路径围栏、内容根判定
 *
 * Run with: npx tsx --test src/__tests__/unit/skills-store-core.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHubFailure,
  parseLedger,
  serializeLedger,
  healLedger,
  mergeInstallState,
  sanitizeSlugForDir,
  resolveDirName,
  isSymlinkEntry,
  entryPathIsContained,
  findSkillContentRoot,
  LEDGER_VERSION,
  type Ledger,
  type LedgerEntry,
} from '../../../electron/skills-store-core';

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    slug: 'pdf-toolkit',
    dirName: 'pdf-toolkit',
    displayName: 'PDF 工具箱',
    contentHash: 'aaa111',
    etag: '"aaa111"',
    downloadVersion: 4,
    installedAt: '2026-07-27T10:00:00Z',
    ...overrides,
  };
}

function ledgerWith(skills: Record<string, LedgerEntry>): Ledger {
  return { version: LEDGER_VERSION, skills };
}

// ── parseHubFailure ──────────────────────────────────────────────────────────

describe('parseHubFailure', () => {
  it('parses the contract error envelope {"detail":{"code","message"}}', () => {
    const f = parseHubFailure(403, { detail: { code: 'SKILL_NOT_VISIBLE', message: '无权查看' } });
    assert.equal(f.error, 'SKILL_NOT_VISIBLE');
    assert.equal(f.status, 403);
    assert.equal(f.message, '无权查看');
  });

  it('maps 401 to not-logged-in regardless of body', () => {
    const f = parseHubFailure(401, { detail: { code: 'ANYTHING' } });
    assert.equal(f.error, 'not-logged-in');
  });

  it('falls back by status when body is unparseable', () => {
    assert.equal(parseHubFailure(503, null).error, 'SKILLS_NOT_CONFIGURED');
    assert.equal(parseHubFailure(429, 'oops').error, 'RATE_LIMITED');
    assert.equal(parseHubFailure(500, undefined).error, 'HUB_UNAVAILABLE');
    assert.equal(parseHubFailure(502, { detail: 'not-an-object' }).error, 'HUB_UNAVAILABLE');
  });

  it('extracts Retry-After seconds for RATE_LIMITED only', () => {
    const limited = parseHubFailure(429, { detail: { code: 'RATE_LIMITED', message: '' } }, '30');
    assert.equal(limited.retryAfter, 30);
    // 非数字/负值不设
    assert.equal(parseHubFailure(429, null, 'soon').retryAfter, undefined);
    assert.equal(parseHubFailure(429, null, '-5').retryAfter, undefined);
    // 非 RATE_LIMITED 即便带头也不设
    const other = parseHubFailure(403, { detail: { code: 'USER_NOT_ACTIVE', message: '' } }, '30');
    assert.equal(other.retryAfter, undefined);
  });

  it('passes unknown codes through verbatim (client falls to generic branch)', () => {
    const f = parseHubFailure(400, { detail: { code: 'SOME_FUTURE_CODE', message: 'x' } });
    assert.equal(f.error, 'SOME_FUTURE_CODE');
  });
});

// ── 台账 ─────────────────────────────────────────────────────────────────────

describe('ledger parse/serialize', () => {
  it('round-trips a valid ledger', () => {
    const src = ledgerWith({ ck123: entry() });
    const parsed = parseLedger(serializeLedger(src));
    assert.deepEqual(parsed, src);
  });

  it('returns an empty ledger for null / corrupt / non-object input', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '{"skills": 42}']) {
      const l = parseLedger(raw as string | null | undefined);
      assert.deepEqual(l, { version: LEDGER_VERSION, skills: {} });
    }
  });

  it('drops entries missing dirName/slug, tolerates missing optional fields', () => {
    const raw = JSON.stringify({
      version: 1,
      skills: {
        good: { slug: 's', dirName: 'd' },
        noDir: { slug: 's' },
        noSlug: { dirName: 'd' },
        junk: 42,
      },
    });
    const l = parseLedger(raw);
    assert.deepEqual(Object.keys(l.skills), ['good']);
    // 缺省字段有安全默认值
    assert.equal(l.skills.good.displayName, 's');
    assert.equal(l.skills.good.contentHash, '');
    assert.equal(l.skills.good.downloadVersion, 0);
  });
});

describe('healLedger', () => {
  it('removes entries whose skill dir is gone, keeps the rest', () => {
    const l = ledgerWith({
      keep: entry({ dirName: 'alive' }),
      drop: entry({ dirName: 'gone' }),
    });
    const { ledger, removed } = healLedger(l, (dir) => dir === 'alive');
    assert.deepEqual(Object.keys(ledger.skills), ['keep']);
    assert.deepEqual(removed, ['drop']);
  });

  it('no-ops on an empty ledger', () => {
    const { ledger, removed } = healLedger(ledgerWith({}), () => true);
    assert.deepEqual(removed, []);
    assert.deepEqual(ledger.skills, {});
  });
});

// ── mergeInstallState ────────────────────────────────────────────────────────

describe('mergeInstallState', () => {
  it('marks uninstalled items and preserves unknown fields verbatim', () => {
    const item = { id: 'ck1', slug: 'x', someFutureField: { nested: true } };
    const merged = mergeInstallState(item, ledgerWith({}));
    assert.equal(merged.isInstalled, false);
    assert.equal(merged.hasUpdate, false);
    assert.deepEqual(merged.someFutureField, { nested: true });
  });

  it('flags hasUpdate when hub contentHash differs from ledger', () => {
    const ledger = ledgerWith({ ck1: entry({ contentHash: 'old' }) });
    const same = mergeInstallState({ id: 'ck1', contentHash: 'old' }, ledger);
    assert.equal(same.isInstalled, true);
    assert.equal(same.hasUpdate, false);
    const diff = mergeInstallState({ id: 'ck1', contentHash: 'new' }, ledger);
    assert.equal(diff.hasUpdate, true);
    assert.equal(diff.installedAt, '2026-07-27T10:00:00Z');
  });

  it('never flags update for DEPRECATED (本地保留、停止更新)', () => {
    const ledger = ledgerWith({ ck1: entry({ contentHash: 'old' }) });
    const merged = mergeInstallState({ id: 'ck1', contentHash: 'new', state: 'DEPRECATED' }, ledger);
    assert.equal(merged.isInstalled, true);
    assert.equal(merged.hasUpdate, false);
  });

  it('treats missing/empty hashes as no-update (avoid false badge)', () => {
    const ledger = ledgerWith({ ck1: entry({ contentHash: '' }) });
    assert.equal(mergeInstallState({ id: 'ck1', contentHash: 'x' }, ledger).hasUpdate, false);
    assert.equal(mergeInstallState({ id: 'ck1' }, ledger).hasUpdate, false);
  });
});

// ── resolveDirName ───────────────────────────────────────────────────────────

describe('sanitizeSlugForDir', () => {
  it('keeps kebab-case slugs as-is', () => {
    assert.equal(sanitizeSlugForDir('pdf-toolkit'), 'pdf-toolkit');
  });

  it('neutralizes path characters and leading dots', () => {
    assert.equal(sanitizeSlugForDir('../evil'), '-evil'); // '..' → '--' 去头点后剩 '-evil'? 实测为准
    assert.equal(sanitizeSlugForDir('.hidden'), 'hidden');
    assert.equal(sanitizeSlugForDir('a/b\\c'), 'a-b-c');
    assert.equal(sanitizeSlugForDir(''), 'skill');
    assert.equal(sanitizeSlugForDir('///'), '---');
  });
});

describe('resolveDirName', () => {
  const ID = 'ckaaaabbbbccccdddd';

  it('reuses the ledger dirName for reinstall/update', () => {
    const ledger = ledgerWith({ [ID]: entry({ dirName: 'custom-dir' }) });
    assert.equal(resolveDirName('pdf-toolkit', ID, ledger, new Set(['custom-dir'])), 'custom-dir');
  });

  it('uses the slug when the dir is free', () => {
    assert.equal(resolveDirName('pdf-toolkit', ID, ledgerWith({}), new Set()), 'pdf-toolkit');
  });

  it('suffixes with id prefix when the slug dir is taken by anything else', () => {
    // 目录被占（无论是外部安装还是用户自建）
    assert.equal(
      resolveDirName('pdf-toolkit', ID, ledgerWith({}), new Set(['pdf-toolkit'])),
      `pdf-toolkit--${ID.slice(0, 8)}`,
    );
    // 目录不存在但被台账里另一条目预定（目录手删后的窗口期）
    const ledger = ledgerWith({ other: entry({ dirName: 'pdf-toolkit' }) });
    assert.equal(
      resolveDirName('pdf-toolkit', ID, ledger, new Set()),
      `pdf-toolkit--${ID.slice(0, 8)}`,
    );
  });

  it('returns null when even the suffixed name is taken (practically unreachable)', () => {
    const taken = new Set(['pdf-toolkit', `pdf-toolkit--${ID.slice(0, 8)}`]);
    assert.equal(resolveDirName('pdf-toolkit', ID, ledgerWith({}), taken), null);
  });
});

// ── zip 守卫 ─────────────────────────────────────────────────────────────────

describe('isSymlinkEntry', () => {
  it('detects S_IFLNK in the high 16 bits, passes regular files/dirs', () => {
    assert.equal(isSymlinkEntry(0o120777 << 16), true);
    assert.equal(isSymlinkEntry(0o100644 << 16), false); // 普通文件
    assert.equal(isSymlinkEntry(0o040755 << 16), false); // 目录
    assert.equal(isSymlinkEntry(0), false); // Windows 产 zip 无 unix mode
  });
});

describe('entryPathIsContained', () => {
  it('accepts normal relative entries, rejects escapes', () => {
    assert.equal(entryPathIsContained('/dest', 'SKILL.md'), true);
    assert.equal(entryPathIsContained('/dest', 'a/b/c.txt'), true);
    assert.equal(entryPathIsContained('/dest', '../evil.txt'), false);
    assert.equal(entryPathIsContained('/dest', 'a/../../evil.txt'), false);
    assert.equal(entryPathIsContained('/dest', '/etc/passwd'), false);
  });

  it('rejects sibling-prefix escape (/dest vs /dest-evil)', () => {
    assert.equal(entryPathIsContained('/dest', '../dest-evil/x'), false);
  });
});

describe('findSkillContentRoot', () => {
  it('root SKILL.md → "."', () => {
    const root = findSkillContentRoot({
      files: ['SKILL.md', 'readme.txt'],
      dirs: ['scripts'],
      hasSkillMdInDir: () => false,
    });
    assert.equal(root, '.');
  });

  it('single wrapper dir containing SKILL.md → that dir', () => {
    const root = findSkillContentRoot({
      files: [],
      dirs: ['pdf-toolkit-v4'],
      hasSkillMdInDir: (d) => d === 'pdf-toolkit-v4',
    });
    assert.equal(root, 'pdf-toolkit-v4');
  });

  it('rejects: no SKILL.md anywhere / multiple top dirs / wrapper without SKILL.md', () => {
    assert.equal(
      findSkillContentRoot({ files: ['x.txt'], dirs: [], hasSkillMdInDir: () => false }),
      null,
    );
    assert.equal(
      findSkillContentRoot({ files: [], dirs: ['a', 'b'], hasSkillMdInDir: () => true }),
      null,
    );
    assert.equal(
      findSkillContentRoot({ files: [], dirs: ['a'], hasSkillMdInDir: () => false }),
      null,
    );
    // 外壳目录 + 根散文件并存 → 结构可疑,拒绝
    assert.equal(
      findSkillContentRoot({ files: ['stray.txt'], dirs: ['a'], hasSkillMdInDir: () => true }),
      null,
    );
  });
});
