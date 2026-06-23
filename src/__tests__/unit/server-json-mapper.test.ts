/**
 * Unit tests for server-json-mapper — server.json → MCPServerConfig 映射。
 *
 * Run: npx tsx --test src/__tests__/unit/server-json-mapper.test.ts
 *
 * 覆盖 Phase-0 POC 验证的 5 类 + build 模式 + 边界条件。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapServer,
  buildConfig,
  flattenArgs,
  packageSpec,
  suggestKey,
  slugify,
  type ServerJson,
} from '../../lib/server-json-mapper';

describe('mapServer — package (stdio)', () => {
  it('npm 基础 → npx -y identifier@version', () => {
    const s: ServerJson = {
      name: 'ai.adeu/adeu',
      version: '1.7.1',
      packages: [{ registryType: 'npm', identifier: '@adeu/mcp-server', version: '1.7.1', transport: { type: 'stdio' } }],
    };
    const r = mapServer(s);
    assert.equal(r.kind, 'stdio');
    assert.deepEqual(r.config, { command: 'npx', args: ['-y', '@adeu/mcp-server@1.7.1'] });
    assert.equal(r.requiredInputs.length, 0);
  });

  it('npm + 密钥env → 占位符 + requiredInputs 标 secret', () => {
    const s: ServerJson = {
      name: 'ai.agenttrust/mcp-server',
      version: '1.1.1',
      packages: [{
        registryType: 'npm', identifier: '@agenttrust/mcp-server', version: '1.1.1', transport: { type: 'stdio' },
        environmentVariables: [{ name: 'AGENTTRUST_API_KEY', isRequired: true, isSecret: true, description: 'API key' }],
      }],
    };
    const r = mapServer(s);
    assert.equal(r.config?.command, 'npx');
    assert.deepEqual(r.config?.args, ['-y', '@agenttrust/mcp-server@1.1.1']);
    assert.equal(r.config?.env?.AGENTTRUST_API_KEY, '${mcp_ai_agenttrust_mcp_server_AGENTTRUST_API_KEY}');
    assert.equal(r.requiredInputs.length, 1);
    assert.equal(r.requiredInputs[0].isSecret, true);
    assert.equal(r.requiredInputs[0].settingKey, 'mcp_ai_agenttrust_mcp_server_AGENTTRUST_API_KEY');
  });

  it('pypi → uvx identifier@version', () => {
    const s: ServerJson = {
      name: 'ai.adeu/adeu',
      version: '1.5.2',
      packages: [{ registryType: 'pypi', identifier: 'adeu', version: '1.5.2', transport: { type: 'stdio' } }],
    };
    const r = mapServer(s);
    assert.deepEqual(r.config, { command: 'uvx', args: ['adeu@1.5.2'] });
  });

  it('oci + 密钥env → docker run -i --rm -e NAME image', () => {
    const s: ServerJson = {
      name: 'ai.aliengiraffe/spotdb',
      version: '0.1.0',
      packages: [{
        registryType: 'oci', identifier: 'docker.io/aliengiraffe/spotdb:0.1.0', transport: { type: 'stdio' },
        environmentVariables: [{ name: 'X-API-Key', isSecret: true }],
      }],
    };
    const r = mapServer(s);
    assert.equal(r.config?.command, 'docker');
    assert.deepEqual(r.config?.args, ['run', '-i', '--rm', '-e', 'X-API-Key', 'docker.io/aliengiraffe/spotdb:0.1.0']);
    assert.equal(r.config?.env?.['X-API-Key'], '${mcp_ai_aliengiraffe_spotdb_X-API-Key}');
  });

  it('runtimeHint 覆盖默认运行器；named/positional 参数按序展开', () => {
    const s: ServerJson = {
      name: 'x.y/z',
      version: '1.0.0',
      packages: [{
        registryType: 'npm', identifier: 'z-server', version: '1.0.0', runtimeHint: 'bunx',
        runtimeArguments: [{ type: 'named', name: '--port', value: '8080' }],
        packageArguments: [{ type: 'positional', value: 'serve' }],
      }],
    };
    const r = mapServer(s);
    // runtimeHint=bunx → 不是 npx → 不注入 -y
    assert.deepEqual(r.config?.args, ['--port', '8080', 'z-server@1.0.0', 'serve']);
  });

  it('已有 -y 时 npx 不重复注入', () => {
    const s: ServerJson = {
      name: 'x.y/z', version: '1.0.0',
      packages: [{ registryType: 'npm', identifier: 'z', version: '1.0.0', runtimeArguments: [{ type: 'positional', value: '-y' }] }],
    };
    const r = mapServer(s);
    assert.deepEqual(r.config?.args, ['-y', 'z@1.0.0']);
  });

  it('version=latest 或 pinVersion=false 时不钉版本', () => {
    const s: ServerJson = {
      name: 'x.y/z', version: 'latest',
      packages: [{ registryType: 'npm', identifier: 'z', version: 'latest' }],
    };
    assert.deepEqual(mapServer(s).config?.args, ['-y', 'z']);

    const s2: ServerJson = { name: 'x.y/z', version: '2.0.0', packages: [{ registryType: 'npm', identifier: 'z', version: '2.0.0' }] };
    assert.deepEqual(mapServer(s2, { pinVersion: false }).config?.args, ['-y', 'z']);
  });
});

describe('mapServer — remote', () => {
  it('streamable-http → {type:http, url}', () => {
    const s: ServerJson = { name: 'ac.inference.sh/mcp', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://sh.inference.ac' }] };
    const r = mapServer(s);
    assert.equal(r.kind, 'remote');
    assert.deepEqual(r.config, { type: 'http', url: 'https://sh.inference.ac' });
  });

  it('远程 + 密钥 headers → Authorization 占位符', () => {
    const s: ServerJson = {
      name: 'ai.adadvisor/mcp-server', version: '1.0.0',
      remotes: [{ type: 'streamable-http', url: 'https://api.adadvisor.ai/mcp', headers: [{ name: 'Authorization', isSecret: true, isRequired: true }] }],
    };
    const r = mapServer(s);
    assert.equal(r.config?.type, 'http');
    assert.equal(r.config?.headers?.Authorization, '${mcp_ai_adadvisor_mcp_server_Authorization}');
  });

  it('sse 类型保留', () => {
    const s: ServerJson = { name: 'a/b', version: '1.0.0', remotes: [{ type: 'sse', url: 'https://x/sse' }] };
    assert.equal(mapServer(s).config?.type, 'sse');
  });

  it('优先 streamable-http 而非 sse', () => {
    const s: ServerJson = {
      name: 'a/b', version: '1.0.0',
      remotes: [{ type: 'sse', url: 'https://x/sse' }, { type: 'streamable-http', url: 'https://x/mcp' }],
    };
    assert.deepEqual(mapServer(s).config, { type: 'http', url: 'https://x/mcp' });
  });

  it('url 模板变量进入 requiredInputs', () => {
    const s: ServerJson = { name: 'a/b', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://api.x.com/{tenant_id}/mcp' }] };
    const r = mapServer(s);
    const urlVar = r.requiredInputs.find((i) => i.target === 'urlVar');
    assert.ok(urlVar);
    assert.equal(urlVar?.name, 'tenant_id');
  });
});

describe('buildConfig — 用用户值构建最终配置', () => {
  it('密钥 → secretsToStore 存明文，config 留占位符', () => {
    const s: ServerJson = {
      name: 'ai.agenttrust/mcp-server', version: '1.1.1',
      packages: [{ registryType: 'npm', identifier: '@agenttrust/mcp-server', version: '1.1.1', environmentVariables: [{ name: 'AGENTTRUST_API_KEY', isSecret: true, isRequired: true }] }],
    };
    const { config, secretsToStore } = buildConfig(s, { AGENTTRUST_API_KEY: 'sk-real-123' });
    assert.equal(config.env?.AGENTTRUST_API_KEY, '${mcp_ai_agenttrust_mcp_server_AGENTTRUST_API_KEY}');
    assert.equal(secretsToStore['mcp_ai_agenttrust_mcp_server_AGENTTRUST_API_KEY'], 'sk-real-123');
  });

  it('非密 env → 内联用户值', () => {
    const s: ServerJson = {
      name: 'a/b', version: '1.0.0',
      packages: [{ registryType: 'npm', identifier: 'b', version: '1.0.0', environmentVariables: [{ name: 'BASE_PATH', isRequired: true }] }],
    };
    const { config, secretsToStore } = buildConfig(s, { BASE_PATH: '/data' });
    assert.equal(config.env?.BASE_PATH, '/data');
    assert.deepEqual(secretsToStore, {});
  });

  it('url 模板变量被替换进 url', () => {
    const s: ServerJson = { name: 'a/b', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://api.x.com/{tenant_id}/mcp' }] };
    const { config } = buildConfig(s, { tenant_id: 'acme' });
    assert.equal(config.url, 'https://api.x.com/acme/mcp');
  });

  it('缺省回落 default', () => {
    const s: ServerJson = {
      name: 'a/b', version: '1.0.0',
      packages: [{ registryType: 'npm', identifier: 'b', version: '1.0.0', environmentVariables: [{ name: 'MODE', default: 'fast' }] }],
    };
    const { config } = buildConfig(s, {});
    assert.equal(config.env?.MODE, 'fast');
  });
});

describe('工具函数', () => {
  it('flattenArgs 处理 named / positional / default', () => {
    assert.deepEqual(flattenArgs([{ type: 'named', name: '--x', value: '1' }, { type: 'positional', default: 'd' }]), ['--x', '1', 'd']);
    assert.deepEqual(flattenArgs(undefined), []);
  });

  it('packageSpec 钉版本逻辑', () => {
    assert.equal(packageSpec({ identifier: 'p', version: '1.2.3' }), 'p@1.2.3');
    assert.equal(packageSpec({ identifier: 'p', version: 'latest' }), 'p');
    assert.equal(packageSpec({ identifier: 'p' }), 'p');
  });

  it('suggestKey / slugify', () => {
    assert.equal(suggestKey('ai.agenttrust/mcp-server'), 'mcp-server');
    assert.equal(slugify('ai.agenttrust/mcp-server'), 'ai_agenttrust_mcp_server');
  });
});
