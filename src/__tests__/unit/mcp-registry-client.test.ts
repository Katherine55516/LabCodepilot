/**
 * Unit tests for mcp-registry-client 的纯归一化逻辑（不打网络）。
 *
 * Run: npx tsx --test src/__tests__/unit/mcp-registry-client.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toMarketplaceDto, dedupeLatest } from '../../lib/mcp-registry-client';

const META = 'io.modelcontextprotocol.registry/official';

describe('toMarketplaceDto', () => {
  it('package 服务器：提取 registryTypes / 命名空间(domain)', () => {
    const dto = toMarketplaceDto({
      server: {
        name: 'ai.agenttrust/mcp-server',
        title: 'AgentTrust',
        description: 'desc',
        version: '1.1.1',
        repository: { url: 'https://github.com/x/y' },
        packages: [{ registryType: 'npm', identifier: '@agenttrust/mcp-server' }],
      },
      _meta: { [META]: { status: 'active', isLatest: true } },
    });
    assert.equal(dto.name, 'ai.agenttrust/mcp-server');
    assert.equal(dto.namespace, 'ai.agenttrust');
    assert.equal(dto.namespaceKind, 'domain');
    assert.equal(dto.hasPackages, true);
    assert.equal(dto.hasRemotes, false);
    assert.deepEqual(dto.registryTypes, ['npm']);
    assert.equal(dto.repositoryUrl, 'https://github.com/x/y');
    assert.equal(dto.status, 'active');
    assert.equal(dto.source, 'official');
  });

  it('io.github.* → namespaceKind=github', () => {
    const dto = toMarketplaceDto({
      server: { name: 'io.github.bytedance/mcp-server-filesystem', version: '1.0.0', packages: [{ registryType: 'npm', identifier: 'x' }] },
    });
    assert.equal(dto.namespaceKind, 'github');
    assert.equal(dto.namespace, 'io.github.bytedance');
  });

  it('远程服务器：提取 remoteTypes', () => {
    const dto = toMarketplaceDto({
      server: { name: 'ac.inference.sh/mcp', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://x' }] },
    });
    assert.equal(dto.hasRemotes, true);
    assert.equal(dto.hasPackages, false);
    assert.deepEqual(dto.remoteTypes, ['streamable-http']);
  });
});

describe('dedupeLatest', () => {
  it('同名多版本折叠为 isLatest', () => {
    const items = [
      { server: { name: 'a/b', version: '1.0.0' }, _meta: { [META]: { isLatest: false } } },
      { server: { name: 'a/b', version: '1.0.1' }, _meta: { [META]: { isLatest: true } } },
      { server: { name: 'c/d', version: '2.0.0' }, _meta: { [META]: { isLatest: true } } },
    ];
    const out = dedupeLatest(items);
    assert.equal(out.length, 2);
    const ab = out.find((x) => x.server.name === 'a/b');
    assert.equal(ab?.server.version, '1.0.1');
  });

  it('无 isLatest 标记时保留首个出现', () => {
    const items = [
      { server: { name: 'a/b', version: '1.0.0' } },
      { server: { name: 'a/b', version: '0.9.0' } },
    ];
    const out = dedupeLatest(items);
    assert.equal(out.length, 1);
    assert.equal(out[0].server.version, '1.0.0');
  });

  it('忽略无 name 的脏数据', () => {
    const items = [{ server: { name: '', version: '1' } as never }, { server: { name: 'a/b', version: '1' } }];
    assert.equal(dedupeLatest(items).length, 1);
  });
});
