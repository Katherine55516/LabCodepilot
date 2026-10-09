import { it } from 'node:test';
import assert from 'node:assert/strict';
import { requirePptByokCapabilities } from '../../lib/ppt-byok-contract';
import { isPptProxyPath } from '../../lib/ppt-proxy-path';

it('verifies the real server capability contract before creation', async () => {
  const source = '../../../apps/cowork-server/lib/ppt-model-jobs.mjs';
  const { PPT_BYOK_CAPABILITIES: byok } = await import(source);
  const ok = (async (url, init) => {
    assert.equal(url, '/api/ppt/capabilities'); assert.equal(init?.cache, 'no-store');
    return Response.json({ byok });
  }) as typeof fetch;
  assert.equal((await requirePptByokCapabilities(ok)).protocolVersion, 1);
  assert.equal(isPptProxyPath(['capabilities']), true);
  assert.equal(isPptProxyPath(['capabilities', 'keys']), false);
  for (const body of [{}, { jobs: [] }, { byok: { ...byok, protocolVersion: 2 } }, { byok: { ...byok, credentialLocation: 'server' } }, { byok: { ...byok, maxPromptBytes: undefined } }, { byok: { ...byok, maxResultBytes: '4000000' } }]) {
    await assert.rejects(requirePptByokCapabilities((async () => Response.json(body)) as typeof fetch), /不兼容/);
  }
  await assert.rejects(requirePptByokCapabilities((async () => Response.json({}, { status: 401 })) as typeof fetch), /登录/);
  await assert.rejects(requirePptByokCapabilities((async () => Response.json({}, { status: 404 })) as typeof fetch), /部署/);
});
