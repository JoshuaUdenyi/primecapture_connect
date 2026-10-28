import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3000', headless: true, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  webServer: { command: 'npm run dev:demo', url: 'http://localhost:3000/login', reuseExistingServer: !process.env.CI, timeout: 120000 },
});
