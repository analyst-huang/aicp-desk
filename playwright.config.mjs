import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:18765',
    channel: process.env.AICP_TEST_BROWSER || undefined,
    headless: true,
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:18765',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
