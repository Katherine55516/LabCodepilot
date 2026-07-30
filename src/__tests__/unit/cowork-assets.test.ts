import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const assetsMod = () => import(path.resolve(__dirname, '../../lib/cowork-assets.ts'));

describe('cowork-assets: manifest 锚定纪律', () => {
  it('claude 平台子包版本与宿主 SDK 严格一致(版本锁:升级 SDK 必须同步 CLAUDE_SDK_VERSION)', async () => {
    const { CLAUDE_SDK_VERSION } = await assetsMod();
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
    const dep = String(pkg.dependencies['@anthropic-ai/claude-agent-sdk']).replace(/^[~^]/, '');
    assert.equal(CLAUDE_SDK_VERSION, dep);
  });

  it('底镜 URL 锚定 dated build,绝不指向 latest(latest 漂移会让 sha512 校验失效)', async () => {
    const { IMAGE_URLS, IMAGE_BUILD, IMAGE_FILENAME } = await assetsMod();
    assert.ok(IMAGE_URLS.length >= 2, 'primary + fallback source');
    for (const url of IMAGE_URLS) {
      assert.ok(!url.includes('/latest/'), `no latest in ${url}`);
      assert.ok(url.includes(`/${IMAGE_BUILD}/`), `dated dir in ${url}`);
      assert.ok(url.endsWith(IMAGE_FILENAME), `dated filename in ${url}`);
    }
    assert.ok(IMAGE_FILENAME.includes(IMAGE_BUILD));
  });

  it('sha512 常量形状与体积常量自洽(稀疏扩容目标 > 原始体积)', async () => {
    const { IMAGE_SHA512, IMAGE_SIZE, IMAGE_SPARSE_SIZE } = await assetsMod();
    assert.match(IMAGE_SHA512, /^[0-9a-f]{128}$/);
    assert.ok(IMAGE_SIZE >= 3 * 1024 ** 3);
    assert.ok(IMAGE_SPARSE_SIZE > IMAGE_SIZE);
  });

  it('claude tarball/metadata URL 构造(npmmirror 主源 + npmjs 兜底)', async () => {
    const { claudeTarballUrl, claudeMetadataUrl, CLAUDE_REGISTRIES, CLAUDE_SDK_VERSION, CLAUDE_PLATFORM_PKG } = await assetsMod();
    assert.ok(CLAUDE_REGISTRIES[0].includes('npmmirror'));
    for (const reg of CLAUDE_REGISTRIES) {
      const t = claudeTarballUrl(reg);
      assert.ok(t.startsWith(reg));
      assert.ok(t.endsWith(`claude-agent-sdk-linux-arm64-${CLAUDE_SDK_VERSION}.tgz`));
      assert.ok(claudeMetadataUrl(reg) === `${reg}/${CLAUDE_PLATFORM_PKG}/${CLAUDE_SDK_VERSION}`);
    }
  });
});

describe('cowork-assets: 状态面(no-throw,只读)', () => {
  it('getAssetsStatus / assetsReady / preflightDiskSpace 纯探测不抛错', async () => {
    const { getAssetsStatus, assetsReady, preflightDiskSpace } = await assetsMod();
    const s = getAssetsStatus();
    assert.ok(['ready', 'downloading', 'missing', 'failed'].includes(s.overall));
    assert.ok(s.totalPct >= 0 && s.totalPct <= 100);
    for (const a of [s.image, s.claude]) {
      assert.ok(['missing', 'downloading', 'verifying', 'installing', 'ready', 'failed'].includes(a.state));
      assert.ok(a.pct >= 0 && a.pct <= 100);
    }
    assert.equal(typeof assetsReady(), 'boolean');
    const pre = preflightDiskSpace();
    assert.ok(pre === null || typeof pre === 'string');
  });

  it('两资产都 ready 时 overall=ready 且 totalPct=100(开发机资产在位的真值)', async () => {
    const { getAssetsStatus, assetsReady } = await assetsMod();
    if (assetsReady()) {
      const s = getAssetsStatus();
      assert.equal(s.overall, 'ready');
      assert.equal(s.totalPct, 100);
      assert.equal(s.image.state, 'ready');
      assert.equal(s.claude.state, 'ready');
      assert.equal(s.usable, true);
    }
  });

  it('M3 版本戳:资产在位时懒栽种 installed-*.json,当前 manifest 下无升级信号', async () => {
    const { assetsReady, imageNeedsUpgrade, claudeNeedsUpgrade, getAssetsStatus } = await assetsMod();
    const paths = await import(path.resolve(__dirname, '../../lib/cowork-paths.ts'));
    if (!assetsReady()) return; // 资产不在位的机器跳过
    assert.equal(imageNeedsUpgrade(), false);
    assert.equal(claudeNeedsUpgrade(), false);
    // 懒栽种应已落盘,且 build/version 与 manifest 一致
    const imgMarker = JSON.parse(fs.readFileSync(paths.IMAGE_MARKER_PATH, 'utf8'));
    const claudeMarker = JSON.parse(fs.readFileSync(paths.CLAUDE_MARKER_PATH, 'utf8'));
    const { IMAGE_BUILD, CLAUDE_SDK_VERSION } = await assetsMod();
    assert.equal(imgMarker.build, IMAGE_BUILD);
    assert.equal(claudeMarker.version, CLAUDE_SDK_VERSION);
    assert.equal(getAssetsStatus().upgradeAvailable, false);
  });
});
