import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', viewport: { width: 390, height: 844 }, locale: 'zh-CN', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/preview-server.mjs', url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 15000 },
});
