import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

const mod = () => import(path.resolve(__dirname, '../../lib/settings-route.ts'));

/**
 * /settings 兼容层的落点计算。设置本体已改成全局弹窗,这个路由只负责「打开弹窗 +
 * 把地址栏换回用户原本待着的页面」,落点算错会把人甩到别的会话甚至站外。
 */
describe('settings-route: readLastNonSettingsPath', () => {
  const store = new Map<string, string>();
  let originalWindow: unknown;

  beforeEach(() => {
    store.clear();
    originalWindow = (globalThis as Record<string, unknown>).window;
    // 最小 window shim —— 只用到 sessionStorage
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
    (globalThis as Record<string, unknown>).sessionStorage = (
      (globalThis as Record<string, unknown>).window as { sessionStorage: unknown }
    ).sessionStorage;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = originalWindow;
    delete (globalThis as Record<string, unknown>).sessionStorage;
  });

  it('没有记录时回落 /chat', async () => {
    const m = await mod();
    assert.equal(m.readLastNonSettingsPath(), m.SETTINGS_FALLBACK_PATH);
    assert.equal(m.SETTINGS_FALLBACK_PATH, '/chat');
  });

  it('返回记录下来的会话路径(带 query 也原样保留)', async () => {
    const m = await mod();
    store.set(m.LAST_NON_SETTINGS_PATH_KEY, '/chat/abc123?tab=files');
    assert.equal(m.readLastNonSettingsPath(), '/chat/abc123?tab=files');
  });

  it('拒绝协议相对地址(//evil.com)—— 否则 replace 会把人送出站', async () => {
    const m = await mod();
    store.set(m.LAST_NON_SETTINGS_PATH_KEY, '//evil.com/pwn');
    assert.equal(m.readLastNonSettingsPath(), m.SETTINGS_FALLBACK_PATH);
  });

  it('拒绝非站内绝对路径(http:// 开头)', async () => {
    const m = await mod();
    store.set(m.LAST_NON_SETTINGS_PATH_KEY, 'https://evil.com');
    assert.equal(m.readLastNonSettingsPath(), m.SETTINGS_FALLBACK_PATH);
  });
});
