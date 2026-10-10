import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/frontend/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:8182',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'node scripts/frontend/e2e-server.mjs',
    url: 'http://127.0.0.1:8182/health/ready',
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: [['list']],
});
