import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compatibleBaseUrl, discoverCompatibleModels, probeCompatibleModel, compatibleConnectionSuggestion } from '../../lib/openai-compatible-api';
import { getPreset } from '../../lib/provider-catalog';
import { isPptProxyPath } from '../../lib/ppt-proxy-path';

describe('OpenAI-compatible API', () => {
  it('distinguishes authentication from upstream model failures without echoing bodies', () => {
    assert.match(compatibleConnectionSuggestion('API HTTP 401'), /key/);
    assert.match(compatibleConnectionSuggestion('API HTTP 503'), /upstream model/);
    assert.match(compatibleConnectionSuggestion('API HTTP 429'), /quota/);
  });
  it('normalizes roots without duplicating version or custom paths', () => {
    assert.equal(compatibleBaseUrl('https://newapi.ai-native-lab.com'), 'https://newapi.ai-native-lab.com/v1');
    assert.equal(compatibleBaseUrl('https://api.example/v1/'), 'https://api.example/v1');
    assert.equal(compatibleBaseUrl('https://api.example/api/v1'), 'https://api.example/api/v1');
    for (const url of ['ftp://example.com', 'https://secret@example.com', 'https://example.com?key=secret']) assert.throws(() => compatibleBaseUrl(url));
  });
  it('discovers exact Unicode IDs and sends Bearer only to the explicit endpoint', async () => {
    const fetcher = (async (url, init) => {
      assert.equal(url, 'https://api.example/v1/models');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only-key');
      assert.equal(init?.redirect, 'error');
      return Response.json({ data: [{ id: 'ppt应用测试' }, { id: 'ppt应用测试' }, { id: null }, { id: '' }] });
    }) as typeof fetch;
    assert.deepEqual(await discoverCompatibleModels('https://api.example', 'test-only-key', fetcher), ['ppt应用测试']);
  });
  it('probes Chat Completions and rejects an empty or failing model response', async () => {
    const fetcher = (async (url, init) => {
      assert.equal(url, 'https://api.example/v1/chat/completions');
      assert.equal(JSON.parse(String(init?.body)).model, 'ppt应用测试');
      assert.equal(JSON.parse(String(init?.body)).max_tokens, 128);
      return Response.json({ choices: [{ message: { content: 'OK' } }], model: 'actual' });
    }) as typeof fetch;
    assert.equal((await probeCompatibleModel('https://api.example', 'fake', 'ppt应用测试', fetcher)).actualModel, 'actual');
    await assert.rejects(probeCompatibleModel('https://api.example', 'fake', 'model', (async () => Response.json({ error: 'fake secret key echoed' }, { status: 401 })) as typeof fetch), error => error instanceof Error && error.message === 'API HTTP 401');
    await assert.rejects(probeCompatibleModel('https://api.example', 'fake', 'model', (async () => Response.json({ choices: [] })) as typeof fetch));
  });
  it('provides an explicit OpenAI-compatible preset and narrowly allows model job routes', () => {
    assert.equal(getPreset('openai-compatible')?.protocol, 'openai-compatible');
    assert.equal(isPptProxyPath(['model-jobs']), true);
    assert.equal(isPptProxyPath(['model-jobs', 'a'.repeat(32), 'claim']), true);
    assert.equal(isPptProxyPath(['model-jobs', 'a'.repeat(32), 'complete']), true);
    assert.equal(isPptProxyPath(['model-jobs', '../etc', 'claim']), false);
    assert.equal(isPptProxyPath(['model-jobs', 'a'.repeat(32), 'keys']), false);
  });
});
