import { defineConfig } from 'playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}/`, locale: 'zh-TW' },
  webServer: {
    command: 'node scripts/build.mjs --e2e --preview',
    port: PORT,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
  },
});
