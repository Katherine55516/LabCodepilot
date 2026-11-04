import fs from 'node:fs';
import {selectPptOption} from '../helpers';
import { test, expect } from '@playwright/test';
import { pptParityFixture } from '../fixtures/ppt-parity';

test('API setup saves explicit protocol, synchronizes models and exposes them in PPT @smoke', async ({ page }, info) => {
  // This full settings/editor journey includes cold Next route compilation.
  test.setTimeout(180000);
  const fixture = pptParityFixture();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let provider: Record<string, unknown> | null = null;
  let saved: Record<string, unknown> | null = null;
  const modelIds = ['ppt应用测试'];
  let protocolVersion = 2;
  await page.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    let body: unknown;
    if (path === '/api/providers') {
      if (req.method() === 'POST') { saved = req.postDataJSON(); provider = { ...saved, id: 'local-fixture', source: 'local', api_key: '***fixture' }; }
      body = req.method() === 'POST' ? { provider } : { providers: provider ? [provider] : [], env_detected: {} };
    } else if (path === '/api/providers/local-fixture') {
      const update = req.postDataJSON(); expect(update.api_key).toBeUndefined(); provider = { ...provider, ...update }; body = { provider };
    } else if (path === '/api/providers/models') body = { groups: provider ? [{ provider_id: 'local-fixture', models: modelIds.map(value => ({ value, label: value })) }] : [] };
    else if (path === '/api/providers/test') { expect(req.postDataJSON().protocol).toBe('openai-compatible'); body = { success: true }; }
    else if (path === '/api/providers/local-fixture/models/discover') { modelIds.push('another-supported-id'); body = { discovered: 2, models: modelIds.map(model_id => ({ model_id })) }; }
    else if (path === '/api/providers/local-fixture/models') { modelIds.push(req.postDataJSON().model_id); body = { models: modelIds.map(model_id => ({ model_id })) }; }
    else if (path === '/api/ppt/model-jobs') body = { jobs: [] };
    else if (path === '/api/ppt/capabilities') body = { byok: { protocolVersion,executionPolicyVersion:1,multimodalVersion:1, transport: 'desktop-model-jobs', credentialLocation: 'desktop', requiresOpenClient: true, maxPromptBytes: 2000000, maxResultBytes: 4000000, jobTimeoutMs: 300000, concurrency: 3 } };
    if (body !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const result = await fixture.handle(req.method(), path, req.postData() ? req.postDataJSON() : {});
    if (result) return route.fulfill({ status: result.status, contentType: result.contentType || 'application/json', body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/settings#providers', {waitUntil:'domcontentloaded'});
  const preset = page.getByText('OpenAI-compatible API', { exact: true });
  await preset.locator('..').locator('..').getByRole('button').click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByPlaceholder('OpenAI-compatible API', { exact: true }).fill('newapi_channel_conn');
  await dialog.getByPlaceholder('https://api.example.com', { exact: true }).fill('https://newapi.ai-native-lab.com/v1');
  await dialog.locator('input[type="password"]').fill('mock-key-never-a-real-key');
  await dialog.getByPlaceholder('Exact model ID', { exact: true }).fill('ppt应用测试');
  await dialog.getByRole('button', { name: /测试连接|Test Connection/ }).click();
  await expect(dialog.getByText(/连接成功|Connection successful/)).toBeVisible({timeout:15000});
  await dialog.getByRole('button', { name: '连接', exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ name: 'newapi_channel_conn', protocol: 'openai-compatible', api_key: 'mock-key-never-a-real-key', role_models_json: JSON.stringify({ default: 'ppt应用测试' }) });
  const providerRow = page.getByText('newapi_channel_conn', { exact: true }).locator('..').locator('..').locator('..');
  await providerRow.getByRole('button', { name: /编辑|Edit/ }).click();
  await expect(dialog.locator('input[type="password"]')).toHaveValue('');
  await dialog.getByRole('button', { name: '同步 API 模型列表' }).click();
  await expect(dialog.getByRole('status')).toContainText('已同步 2');
  await dialog.getByRole('textbox', { name: '添加模型 ID' }).fill('manual-model-id');
  await dialog.getByRole('button', { name: '添加', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('模型已添加');
  await dialog.getByRole('button', { name: '更新', exact: true }).click();
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0,{timeout:15000});
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await page.getByTestId('ppt-quality-settings').locator('summary').filter({hasText:'高级：执行策略'}).click();await page.getByTestId('ppt-quality-settings').locator('summary').filter({hasText:'查看模型分工与预算'}).click();
  const selector = page.getByTestId('ppt-quality-settings').getByRole('combobox').first();
  await selector.click();await expect(page.getByRole('option')).toHaveCount(modelIds.length);await page.keyboard.press('Escape');
  for(const field of (await page.getByTestId('ppt-quality-settings').getByRole('combobox').all()).slice(0,6))await selectPptOption(field,'local-fixture::ppt应用测试');
  await expect(page.getByText(/本地 API：密钥留在本机/)).toBeVisible();
  const cdp = await page.context().newCDPSession(page); await cdp.send('Runtime.enable');
  await page.screenshot({ path: info.outputPath('ppt-byok-model-picker.png') });
  const snapshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(info.outputPath('ppt-byok-cdp.png'), Buffer.from(snapshot.data, 'base64'));
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Teaching template/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  await page.getByRole('textbox', { name: '输入 Prompt', exact: true }).fill('Explain input validation and implementation constraints in 12 pages.');
  const generate = page.getByRole('button', { name: '继续：生成大纲', exact: true });
  await expect(generate).toBeEnabled(); await generate.click();
  await expect(page.getByText('PPT 客户端与服务端的本地模型协议不兼容，请更新配套服务。', { exact: true })).toBeVisible();
  expect(fixture.payloads.some(payload => payload.configId === 'byok:local-fixture')).toBe(false);
  await page.screenshot({ path: info.outputPath('ppt-byok-incompatible-server.png') });
  protocolVersion = 1;
  await generate.click();
  await expect.poll(() => fixture.payloads.some(payload => payload.configId === 'byok:local-fixture' && payload.model === 'ppt应用测试')).toBe(true);
  await cdp.detach();
  expect(errors).toEqual([]);
});
