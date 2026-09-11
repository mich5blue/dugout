import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    /*
      Always start a fresh server. Reusing whatever is already on this port
      silently serves a stale `next build`, which produced runs that flapped
      between 11 passing and 6 failing on identical code — the worst kind of
      test failure, because it looks like a real regression.
    */
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
