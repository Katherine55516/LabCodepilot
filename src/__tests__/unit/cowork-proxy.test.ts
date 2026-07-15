import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

const proxyMod = () => import(path.resolve(__dirname, '../../lib/cowork-proxy.ts'));

describe('cowork-proxy: 一次性 token 生命周期(P3-B)', () => {
  it('registerSession 幂等(同会话复用同 token)+ token/baseUrl 形态', async () => {
    const { registerSession, revokeSession } = await proxyMod();
    const r1 = registerSession('a1b2c3d4e5f6', { realKey: 'sk-real-1', realBase: 'https://api.example.com', authStyle: 'api_key' });
    assert.match(r1.token, /^cwk_[0-9a-f]{48}$/, 'token 是 cwk_ + 24字节hex');
    assert.match(r1.baseUrl, /^http:\/\/[0-9.]+:8788$/, 'baseUrl 指向网关:8788');
    // 同会话再注册(换了凭证)→ 复用同 token
    const r2 = registerSession('a1b2c3d4e5f6', { realKey: 'sk-real-2', realBase: 'https://api.example.com', authStyle: 'auth_token' });
    assert.equal(r2.token, r1.token, '同会话幂等复用 token');
    revokeSession('a1b2c3d4e5f6');
  });

  it('revokeSession 废止后同会话拿到新 token(旧 token 失效)', async () => {
    const { registerSession, revokeSession } = await proxyMod();
    const first = registerSession('deadbeef0001', { realKey: 'k', realBase: 'https://x', authStyle: 'api_key' });
    revokeSession('deadbeef0001');
    const second = registerSession('deadbeef0001', { realKey: 'k', realBase: 'https://x', authStyle: 'api_key' });
    assert.notEqual(second.token, first.token, '废止后必须换新 token');
    revokeSession('deadbeef0001');
  });

  it('不同会话拿到不同 token', async () => {
    const { registerSession, revokeSession } = await proxyMod();
    const ra = registerSession('sessionaaaa11', { realKey: 'k', realBase: 'https://x', authStyle: 'api_key' });
    const rb = registerSession('sessionbbbb22', { realKey: 'k', realBase: 'https://x', authStyle: 'api_key' });
    assert.notEqual(ra.token, rb.token);
    revokeSession('sessionaaaa11');
    revokeSession('sessionbbbb22');
  });

  it('discoverGatewayIp 返回 vmnet 网段(有 VM 时 192.168.64.x,否则回退 .1)', async () => {
    const { discoverGatewayIp } = await proxyMod();
    assert.match(discoverGatewayIp(), /^192\.168\.64\.\d+$/);
  });
});
