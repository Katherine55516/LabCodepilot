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

it('temporary backend failures do not claim the local model protocol is unsupported',async()=>{
 for(const status of [429,500,502,503,504])await assert.rejects(requirePptByokCapabilities((async()=>Response.json({}, {status})) as typeof fetch),/暂时繁忙|连接超时/);
});

it('quality routing and image jobs require matching server capability versions',async()=>{
 const {requirePptByokCapabilities}=await import('../../lib/ppt-byok-contract');
 const base={protocolVersion:1,transport:'desktop-model-jobs',credentialLocation:'desktop',requiresOpenClient:true,maxPromptBytes:2000000,maxResultBytes:4000000,jobTimeoutMs:900000,concurrency:3};
 const fetcher=(body:unknown)=>(async()=>Response.json({byok:body})) as typeof fetch;
 await assert.rejects(()=>requirePptByokCapabilities(fetcher(base),{executionPolicy:true}),/协议不兼容/);
 await requirePptByokCapabilities(fetcher({...base,executionPolicyVersion:1,multimodalVersion:1}),{executionPolicy:true,vision:true});
 await assert.rejects(()=>requirePptByokCapabilities(fetcher({...base,executionPolicyVersion:1}),{vision:true}),/协议不兼容/);
});
