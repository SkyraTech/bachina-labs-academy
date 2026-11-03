import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4200',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm exec ng serve --port 4200 --host 127.0.0.1',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: true,
    timeout: 120000,
  },
});

