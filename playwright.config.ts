import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/ui',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8792',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node dist/server/index.js',
    url: 'http://127.0.0.1:8792/healthz',
    reuseExistingServer: false,
    env: {
      PORT: '8792',
      HOST: '127.0.0.1',
      DATA_DIR: `artifacts/ui-server-${Date.now()}`,
      NODE_ENV: 'test',
      BOT_STEP_MS: '250',
      DISCONNECT_TAKEOVER_MS: '1500',
    },
    timeout: 20000,
  },
});
