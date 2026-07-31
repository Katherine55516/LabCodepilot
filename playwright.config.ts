import { defineConfig } from '@playwright/test';

// Worktree 测试用非默认 PORT 启动时，Playwright 必须复用同一端口；缺省仍为 3000，
// CI/主工作区行为不变。`npm run dev` 会继承当前进程的 PORT。
const port = process.env.PORT || '3000';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './src/__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
