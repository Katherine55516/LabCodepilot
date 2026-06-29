/**
 * Locks the AI_LabTest environments.json contract produced by
 * src/lib/test-accounts-export.ts. Field names, shapes and coercions must
 * match what AI_LabTest's loadEnvCfg reads back (verified against the
 * framework source). See docs/handover/test-account-settings.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toEnvironmentsJson, sanitizeAccountKey } from '@/lib/test-accounts-export';
import type { TestAccountSystemView, TestEnvironment } from '@/types';

function env(overrides: Partial<TestEnvironment> = {}): TestEnvironment {
  return {
    label: '本地开发环境',
    frontendBaseUrl: '',
    apiBaseUrl: '',
    healthEndpoint: '',
    defaultAccountKey: '',
    accounts: [],
    ...overrides,
  };
}

function system(local: TestEnvironment, sit: TestEnvironment): TestAccountSystemView {
  return {
    id: 'sys1',
    name: 'Order Service',
    project_root: '/tmp/order',
    sort_order: 0,
    environments: { local, sit },
    created_at: '',
    updated_at: '',
  };
}

describe('toEnvironmentsJson — top level', () => {
  it('emits $schema, default=local, allowedEnvs=[local,sit]', () => {
    const json = toEnvironmentsJson(system(env(), env({ label: 'SIT 集成测试环境' }))) as Record<string, unknown>;
    assert.equal(typeof json.$schema, 'string');
    assert.equal(json.default, 'local');
    assert.deepEqual(json.allowedEnvs, ['local', 'sit']);
    assert.deepEqual(Object.keys(json.environments as object), ['local', 'sit']);
    // key order must match AI_LabTest output
    assert.deepEqual(Object.keys(json), ['$schema', 'default', 'allowedEnvs', 'environments']);
  });
});

describe('toEnvironmentsJson — per environment', () => {
  it('coerces empty URLs to TBD and empty health to /, sets tags', () => {
    const json = toEnvironmentsJson(system(env(), env())) as { environments: Record<string, Record<string, unknown>> };
    const local = json.environments.local;
    assert.equal(local.frontendBaseUrl, 'TBD');
    assert.equal(local.apiBaseUrl, 'TBD');
    assert.equal(local.healthEndpoint, '/');
    assert.equal(local.tag, 'local');
    assert.equal(json.environments.sit.tag, 'SIT');
  });

  it('keeps real URLs and falls back defaultAccount to first account key', () => {
    const local = env({
      frontendBaseUrl: 'http://localhost:3000',
      apiBaseUrl: 'http://127.0.0.1:8080',
      healthEndpoint: '/api/health',
      defaultAccountKey: '',
      accounts: [{ key: 'admin', role: 'admin', authMethod: 'password', username: 'u', password: 'p' }],
    });
    const json = toEnvironmentsJson(system(local, env())) as { environments: Record<string, Record<string, unknown>> };
    assert.equal(json.environments.local.frontendBaseUrl, 'http://localhost:3000');
    assert.equal(json.environments.local.apiBaseUrl, 'http://127.0.0.1:8080');
    assert.equal(json.environments.local.healthEndpoint, '/api/health');
    assert.equal(json.environments.local.defaultAccount, 'admin');
  });

  it('honors an explicit defaultAccount', () => {
    const local = env({
      defaultAccountKey: 'viewer',
      accounts: [
        { key: 'admin', role: 'admin', authMethod: 'password' },
        { key: 'viewer', role: 'viewer', authMethod: 'password' },
      ],
    });
    const json = toEnvironmentsJson(system(local, env())) as { environments: Record<string, Record<string, unknown>> };
    assert.equal(json.environments.local.defaultAccount, 'viewer');
  });
});

describe('toEnvironmentsJson — account shapes (authType by shape)', () => {
  it('password account: {key,role,username,password}, no authType', () => {
    const local = env({ accounts: [{ key: 'admin', role: 'admin', authMethod: 'password', username: 'yeqb001', password: '123456' }] });
    const json = toEnvironmentsJson(system(local, env())) as { environments: Record<string, { accounts: Record<string, unknown>[] }> };
    const a = json.environments.local.accounts[0];
    assert.deepEqual(a, { key: 'admin', role: 'admin', username: 'yeqb001', password: '123456' });
    assert.equal('authType' in a, false);
  });

  it('token account: token+capturedAt+storageType+storageKey, no authType', () => {
    const local = env({ accounts: [{ key: 'admin', role: 'admin', authMethod: 'token', token: 'jwt', storageType: 'header', storageKey: 'Authorization' }] });
    const json = toEnvironmentsJson(system(local, env())) as { environments: Record<string, { accounts: Record<string, unknown>[] }> };
    const a = json.environments.local.accounts[0];
    assert.deepEqual(a, { key: 'admin', role: 'admin', token: 'jwt', capturedAt: '', storageType: 'header', storageKey: 'Authorization' });
    assert.equal('authType' in a, false);
  });

  it('token account: storageType/storageKey default to header/Authorization', () => {
    const local = env({ accounts: [{ key: 'admin', role: 'admin', authMethod: 'token', token: 'jwt' }] });
    const json = toEnvironmentsJson(system(local, env())) as { environments: Record<string, { accounts: Record<string, unknown>[] }> };
    const a = json.environments.local.accounts[0];
    assert.equal(a.storageType, 'header');
    assert.equal(a.storageKey, 'Authorization');
  });

  it('capture account: only {key,role,authType:capture}', () => {
    const local = env({ accounts: [{ key: 'qa user', role: 'qa', authMethod: 'capture', captured: true, capturedAt: 'x' }] });
    const json = toEnvironmentsJson(system(local, env())) as { environments: Record<string, { accounts: Record<string, unknown>[] }> };
    const a = json.environments.local.accounts[0];
    assert.deepEqual(a, { key: 'qa user', role: 'qa', authType: 'capture' });
  });
});

describe('sanitizeAccountKey', () => {
  it('replaces non [A-Za-z0-9_-] with _ (matches AI_LabTest runner)', () => {
    assert.equal(sanitizeAccountKey('qa user'), 'qa_user');
    assert.equal(sanitizeAccountKey('admin@v1'), 'admin_v1');
    assert.equal(sanitizeAccountKey('role-1_a'), 'role-1_a');
    assert.equal(sanitizeAccountKey('管理员'), '___');
  });
});
